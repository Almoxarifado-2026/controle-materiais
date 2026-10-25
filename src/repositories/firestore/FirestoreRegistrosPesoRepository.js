'use strict';

const { RegistrosPesoRepository } = require('../contratos');
const { erroMaterialInexistente, erroValidacao, erroDuplicado } = require('../../domain/erros');
const { erroPersistencia, CODIGOS_PERSISTENCIA, traduzirErroFirestore } = require('../erros');
const { dividirEmLotes, compararIds } = require('../util');
const {
  exigirPeso,
  exigirDataRecebimento,
  normalizarObservacao,
  exigirIdMaterial,
  exigirGranularidade,
  normalizarFiltroRepositorio,
} = require('../invariantes');
const {
  COLECOES,
  normalizarIdFirestore,
  materialDeDocumento,
  registroDeDocumento,
  dadosDeRegistro,
  comMaterial,
  funcoesAusentes,
} = require('./mapeamento');
const { totaisDe, materiaisDistintos, ordenarRegistros, agruparPorMaterial, agruparPorBalde } = require('./agregacao');

// ============================================================
// Implementação Firestore de RegistrosPesoRepository (Sprint 4).
//
// FILTRO POR CATEGORIA — Abordagem B da Sprint 2 (seção 8), escolhida aqui:
//   registrosPeso NÃO ganha campo "categoria". A categoria é sempre a ATUAL do
//   material (igual ao JOIN do SQLite): 1) busca os materiais da categoria;
//   2) filtra registrosPeso por materialId (operador "in", em lotes de 30 — o
//   limite do Firestore —, consultas em paralelo e união em código). Sem teto de
//   quantidade de materiais por categoria. Decisão sujeita à auditoria.
// Índices usados (Sprint 3, firestore.indexes.json): registrosPeso
//   (materialId ASC, dataRecebimento ASC) e materiais (ativo ASC, nome ASC);
//   os demais são índices de campo único automáticos. NENHUM índice novo.
// Nenhuma consulta usa orderBy: a ordenação é feita em código (necessária para
// unir lotes), o que evita índices extras.
// Agregações: totais() usa Aggregation Queries (count/sum no servidor). As
// consultas com GROUP BY/DISTINCT do SQL leem os documentos do período e
// agregam em código (agregacao.js). Consultas "sem datas" leem TODOS os
// documentos que casam: o domínio sempre resolve um período padrão.
// Escrita: transação (lê o material, executa a guarda de negócio do domínio,
// grava). Nada é excluído.
// ============================================================

const FUNCOES_SDK = [
  'collection', 'doc', 'getDoc', 'getDocs', 'query', 'where', 'documentId',
  'runTransaction', 'getAggregateFromServer', 'count', 'sum',
];
const MAX_IN = 30; // limite de valores do operador "in" do Firestore

class FirestoreRegistrosPesoRepository extends RegistrosPesoRepository {
  constructor({ db, sdk, agora = () => new Date(), colecoes = COLECOES } = {}) {
    super();
    if (!db || funcoesAusentes(sdk, FUNCOES_SDK).length > 0 || !sdk.Timestamp || typeof sdk.Timestamp.fromDate !== 'function') {
      throw erroPersistencia(CODIGOS_PERSISTENCIA.CONFIGURACAO);
    }
    this._db = db;
    this._sdk = sdk;
    this._agora = agora;
    this._regs = sdk.collection(db, colecoes.REGISTROS_PESO);
    this._mats = sdk.collection(db, colecoes.MATERIAIS);
  }

  normalizarId(valor) {
    return normalizarIdFirestore(valor);
  }

  async _executar(fn) {
    try {
      return await fn();
    } catch (err) {
      throw traduzirErroFirestore(err);
    }
  }

  _filtro(filtro) {
    return normalizarFiltroRepositorio(filtro, (v) => this.normalizarId(v));
  }

  // null = sem restrição por material; [] = nada casa; [ids] = só esses materiais.
  async _restricaoDeMaterial(filtro) {
    const { doc, getDoc, getDocs, query, where } = this._sdk;
    if (filtro.materialId !== undefined) {
      if (filtro.categoria === undefined) return [filtro.materialId];
      const snap = await getDoc(doc(this._mats, filtro.materialId));
      if (!snap.exists() || (snap.data().categoria ?? null) !== filtro.categoria) return [];
      return [filtro.materialId];
    }
    if (filtro.categoria !== undefined) {
      const snap = await getDocs(query(this._mats, where('categoria', '==', filtro.categoria)));
      return snap.docs.map((d) => d.id);
    }
    return null;
  }

  _consultas(filtro, restricao) {
    const { query, where } = this._sdk;
    const datas = [];
    if (filtro.dataInicial !== undefined) datas.push(where('dataRecebimento', '>=', filtro.dataInicial));
    if (filtro.dataFinal !== undefined) datas.push(where('dataRecebimento', '<=', filtro.dataFinal));
    if (restricao === null) return [query(this._regs, ...datas)];
    return dividirEmLotes(restricao, MAX_IN).map((lote) =>
      query(this._regs, lote.length === 1 ? where('materialId', '==', lote[0]) : where('materialId', 'in', lote), ...datas)
    );
  }

  // Lê (e converte) todos os registros do filtro, SEM os dados do material.
  async _lerRegistros(filtro) {
    const restricao = await this._restricaoDeMaterial(filtro);
    if (restricao !== null && restricao.length === 0) return [];
    const snaps = await Promise.all(this._consultas(filtro, restricao).map((q) => this._sdk.getDocs(q)));
    const porId = new Map();
    for (const s of snaps) for (const d of s.docs) porId.set(d.id, registroDeDocumento(d.id, d.data()));
    return [...porId.values()];
  }

  // Map(id -> Material) dos materiais referenciados. Referência inexistente = inconsistência de dados.
  async _materiaisPorIds(ids) {
    const unicos = [...new Set(ids)];
    const { query, where, documentId, getDocs } = this._sdk;
    const snaps = await Promise.all(
      dividirEmLotes(unicos, MAX_IN).map((lote) => getDocs(query(this._mats, where(documentId(), 'in', lote))))
    );
    const mapa = new Map();
    for (const s of snaps) for (const d of s.docs) mapa.set(d.id, materialDeDocumento(d.id, d.data()));
    for (const id of unicos) {
      if (!mapa.has(id)) throw erroPersistencia(CODIGOS_PERSISTENCIA.REFERENCIA_INVALIDA);
    }
    return mapa;
  }

  async _registrosCompletos(filtro) {
    const regs = await this._lerRegistros(filtro);
    const mats = await this._materiaisPorIds(regs.map((r) => r.materialId));
    return ordenarRegistros(regs.map((r) => comMaterial(r, mats.get(r.materialId))));
  }

  async criar(dados, { validarMaterial, id } = {}) {
    if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
      throw erroValidacao('Os dados do registro devem ser informados como um objeto.');
    }
    const materialId = exigirIdMaterial(dados.materialId, (v) => this.normalizarId(v));
    const pesoKg = exigirPeso(dados.pesoKg);
    const dataRecebimento = exigirDataRecebimento(dados.dataRecebimento);
    const observacao = normalizarObservacao(dados.observacao);
    let idExplicito = null;
    if (id !== undefined) {
      idExplicito = this.normalizarId(id);
      if (idExplicito === null) throw erroValidacao(`ID de registro inválido: ${String(id).slice(0, 40)}.`);
    }
    const { doc, runTransaction, getDoc, Timestamp } = this._sdk;
    const ref = idExplicito !== null ? doc(this._regs, idExplicito) : doc(this._regs);
    const refMaterial = doc(this._mats, materialId);
    const ts = this._agora();

    return this._executar(async () => {
      let material = null;
      await runTransaction(this._db, async (tx) => {
        const snapMaterial = await tx.get(refMaterial);
        material = snapMaterial.exists() ? materialDeDocumento(snapMaterial.id, snapMaterial.data()) : null;
        if (typeof validarMaterial === 'function') validarMaterial(material);
        if (!material) throw erroMaterialInexistente(`Material ${materialId} não encontrado.`);
        if (idExplicito !== null && (await tx.get(ref)).exists()) {
          throw erroDuplicado(`Já existe um registro com o ID "${idExplicito}".`);
        }
        tx.set(ref, dadosDeRegistro({ materialId, pesoKg, dataRecebimento, observacao, criadoEm: ts, atualizadoEm: ts }, Timestamp));
      });
      // Confirmação real (equivalente à releitura do SQLite): lê o documento e compara.
      const snap = await getDoc(ref);
      if (!snap.exists()) throw erroPersistencia(CODIGOS_PERSISTENCIA.INTEGRIDADE);
      const relido = registroDeDocumento(snap.id, snap.data());
      const confere =
        relido.materialId === materialId &&
        Object.is(relido.pesoKg, pesoKg) &&
        relido.dataRecebimento === dataRecebimento &&
        relido.observacao === observacao &&
        relido.criadoEm === ts.toISOString();
      if (!confere) throw erroPersistencia(CODIGOS_PERSISTENCIA.INTEGRIDADE);
      return comMaterial(relido, material);
    });
  }

  async buscarPorId(id) {
    const n = this.normalizarId(id);
    if (n === null) return null;
    return this._executar(async () => {
      const snap = await this._sdk.getDoc(this._sdk.doc(this._regs, n));
      if (!snap.exists()) return null;
      const reg = registroDeDocumento(snap.id, snap.data());
      const mats = await this._materiaisPorIds([reg.materialId]);
      return comMaterial(reg, mats.get(reg.materialId));
    });
  }

  async listar(filtro = {}) {
    const f = this._filtro(filtro);
    return this._executar(() => this._registrosCompletos(f));
  }

  async totais(filtro = {}) {
    const f = this._filtro(filtro);
    const { getAggregateFromServer, count, sum } = this._sdk;
    return this._executar(async () => {
      const restricao = await this._restricaoDeMaterial(f);
      if (restricao !== null && restricao.length === 0) return { quantidadeRegistros: 0, totalKg: 0, mediaKg: 0 };
      const partes = await Promise.all(
        this._consultas(f, restricao).map((q) => getAggregateFromServer(q, { quantidade: count(), total: sum('pesoKg') }))
      );
      let quantidadeRegistros = 0;
      let totalKg = 0;
      for (const p of partes) {
        quantidadeRegistros += p.data().quantidade;
        totalKg += p.data().total ?? 0;
      }
      return { quantidadeRegistros, totalKg, mediaKg: quantidadeRegistros > 0 ? totalKg / quantidadeRegistros : 0 };
    });
  }

  async consultarHistorico(filtro = {}) {
    const f = this._filtro(filtro);
    // Uma única leitura de documentos: totais e registros descrevem exatamente o MESMO conjunto.
    return this._executar(async () => {
      const registros = await this._registrosCompletos(f);
      return { totais: totaisDe(registros), registros };
    });
  }

  async consultarIndicadores(filtro = {}) {
    const f = this._filtro(filtro);
    return this._executar(async () => {
      const regs = await this._lerRegistros(f);
      return { ...totaisDe(regs), materiaisEnvolvidos: materiaisDistintos(regs) };
    });
  }

  async pesoPorMaterial(filtro = {}) {
    const f = this._filtro(filtro);
    return this._executar(async () => {
      const regs = await this._lerRegistros(f);
      if (regs.length === 0) return [];
      const mats = await this._materiaisPorIds(regs.map((r) => r.materialId));
      return agruparPorMaterial(regs, mats);
    });
  }

  async pesoPorBalde(filtro = {}, granularidade) {
    const g = exigirGranularidade(granularidade);
    const f = this._filtro(filtro);
    return this._executar(async () => agruparPorBalde(await this._lerRegistros(f), g));
  }
}

module.exports = { FirestoreRegistrosPesoRepository, MAX_IN };
