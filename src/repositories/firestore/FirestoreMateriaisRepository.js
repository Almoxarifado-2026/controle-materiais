'use strict';

const { MateriaisRepository } = require('../contratos');
const { erroNaoEncontrado, erroDuplicado, erroValidacao } = require('../../domain/erros');
const { erroPersistencia, CODIGOS_PERSISTENCIA, traduzirErroFirestore } = require('../erros');
const { chaveNome, chaveParaIdDocumento } = require('../util');
const { normalizarNomeMaterial, normalizarCategoriaMaterial } = require('../invariantes');
const {
  COLECOES,
  normalizarIdFirestore,
  materialDeDocumento,
  dadosDeMaterial,
  funcoesAusentes,
} = require('./mapeamento');

// ============================================================
// Implementação Firestore de MateriaisRepository (Sprint 4).
//
// - O SDK do Firestore e a instância `db` são INJETADOS (nenhuma credencial,
//   nenhum import do SDK e nenhuma leitura de ambiente aqui). Quem monta a
//   instância é a plataforma (configuração da Sprint 3).
// - Unicidade do nome: documento auxiliar materiaisNomesIndex/{chave codificada}
//   escrito na MESMA transação que cria/renomeia o material. A chave usa a
//   mesma regra do domínio legado (NFC + minúsculas pt-BR). Desativar/reativar
//   NÃO libera o nome (o material nunca é excluído), igual ao SQLite.
// - Nenhum método de exclusão existe: material só é ativado/desativado.
// - Toda transação lê antes de escrever (exigência do Firestore) e não tem
//   efeito colateral fora dela (o Firestore pode repetir a função).
// ============================================================

const FUNCOES_SDK = [
  'collection', 'doc', 'getDoc', 'getDocs', 'query', 'where', 'orderBy',
  'runTransaction', 'getAggregateFromServer', 'count',
];

class FirestoreMateriaisRepository extends MateriaisRepository {
  constructor({ db, sdk, agora = () => new Date(), colecoes = COLECOES } = {}) {
    super();
    if (!db || funcoesAusentes(sdk, FUNCOES_SDK).length > 0 || !sdk.Timestamp || typeof sdk.Timestamp.fromDate !== 'function') {
      throw erroPersistencia(CODIGOS_PERSISTENCIA.CONFIGURACAO);
    }
    this._db = db;
    this._sdk = sdk;
    this._agora = agora;
    this._col = sdk.collection(db, colecoes.MATERIAIS);
    this._idx = sdk.collection(db, colecoes.MATERIAIS_NOMES_INDEX);
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

  _refIndice(nome) {
    return this._sdk.doc(this._idx, chaveParaIdDocumento(chaveNome(nome)));
  }

  async _ler(ref) {
    const snap = await this._sdk.getDoc(ref);
    return snap.exists() ? materialDeDocumento(snap.id, snap.data()) : null;
  }

  async listar({ incluirInativos = false } = {}) {
    if (typeof incluirInativos !== 'boolean') throw erroValidacao('incluirInativos deve ser verdadeiro ou falso.');
    const { query, where, orderBy, getDocs } = this._sdk;
    // Índices: ativo+nome (composto, Sprint 3) e nome (automático).
    const q = incluirInativos ? query(this._col, orderBy('nome')) : query(this._col, where('ativo', '==', true), orderBy('nome'));
    return this._executar(async () => (await getDocs(q)).docs.map((d) => materialDeDocumento(d.id, d.data())));
  }

  async buscarPorId(id) {
    const n = this.normalizarId(id);
    if (n === null) return null;
    return this._executar(() => this._ler(this._sdk.doc(this._col, n)));
  }

  async contarPorStatus() {
    const { query, where, getAggregateFromServer, count } = this._sdk;
    return this._executar(async () => {
      const [a, i] = await Promise.all([
        getAggregateFromServer(query(this._col, where('ativo', '==', true)), { n: count() }),
        getAggregateFromServer(query(this._col, where('ativo', '==', false)), { n: count() }),
      ]);
      return { ativos: a.data().n, inativos: i.data().n };
    });
  }

  async criar(dados, { id } = {}) {
    if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
      throw erroValidacao('Os dados do material devem ser informados como um objeto.');
    }
    const nome = normalizarNomeMaterial(dados.nome);
    const categoria = normalizarCategoriaMaterial(dados.categoria) ?? null;
    let idExplicito = null;
    if (id !== undefined) {
      idExplicito = this.normalizarId(id);
      if (idExplicito === null) throw erroValidacao(`ID de material inválido: ${String(id).slice(0, 40)}.`);
    }
    const { doc, runTransaction } = this._sdk;
    const ref = idExplicito !== null ? doc(this._col, idExplicito) : doc(this._col);
    const refIdx = this._refIndice(nome);
    const chave = chaveNome(nome);
    const ts = this._agora();

    return this._executar(async () => {
      await runTransaction(this._db, async (tx) => {
        const idx = await tx.get(refIdx);
        if (idx.exists()) throw erroDuplicado(`Já existe um material com o nome "${idx.data().nome}".`);
        if (idExplicito !== null && (await tx.get(ref)).exists()) {
          throw erroDuplicado(`Já existe um material com o ID "${idExplicito}".`);
        }
        tx.set(refIdx, { materialId: ref.id, chave, nome });
        tx.set(ref, dadosDeMaterial({ nome, categoria, ativo: true, criadoEm: ts, atualizadoEm: ts }, this._sdk.Timestamp));
      });
      return this._ler(ref);
    });
  }

  async atualizar(id, campos = {}) {
    const n = this.normalizarId(id);
    if (n === null) throw erroValidacao(`ID de material inválido: ${String(id).slice(0, 40)}.`);
    if (campos === null || typeof campos !== 'object' || Array.isArray(campos)) {
      throw erroValidacao('Os campos a atualizar devem ser informados como um objeto.');
    }
    const nomeNovo = campos.nome !== undefined ? normalizarNomeMaterial(campos.nome) : undefined;
    const categoriaNova = normalizarCategoriaMaterial(campos.categoria);
    const { doc, runTransaction } = this._sdk;
    const ref = doc(this._col, n);
    const ts = this._agora();

    return this._executar(async () => {
      await runTransaction(this._db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw erroNaoEncontrado(`Material ${n} não encontrado.`);
        const atual = materialDeDocumento(snap.id, snap.data());
        const nome = nomeNovo !== undefined ? nomeNovo : atual.nome;
        const categoria = categoriaNova !== undefined ? categoriaNova : atual.categoria;

        const chaveAntiga = chaveNome(atual.nome);
        const chaveNova = chaveNome(nome);
        const refIdxAntigo = this._refIndice(atual.nome);
        const refIdxNovo = this._refIndice(nome);
        // Leituras primeiro (exigência do Firestore): conflito só importa se a CHAVE muda.
        if (chaveNova !== chaveAntiga) {
          const existente = await tx.get(refIdxNovo);
          if (existente.exists() && existente.data().materialId !== n) {
            throw erroDuplicado(`Já existe um material com o nome "${existente.data().nome}".`);
          }
        }
        // Escritas.
        if (chaveNova !== chaveAntiga) {
          tx.delete(refIdxAntigo);
          tx.set(refIdxNovo, { materialId: n, chave: chaveNova, nome });
        } else if (nome !== atual.nome) {
          tx.set(refIdxNovo, { materialId: n, chave: chaveNova, nome }); // só mudou a caixa: atualiza o nome exibido no índice
        }
        tx.update(ref, { nome, categoria, atualizadoEm: this._sdk.Timestamp.fromDate(ts) });
      });
      return this._ler(ref);
    });
  }

  async definirAtivo(id, ativo) {
    const n = this.normalizarId(id);
    if (n === null) throw erroValidacao(`ID de material inválido: ${String(id).slice(0, 40)}.`);
    const { doc, runTransaction } = this._sdk;
    const ref = doc(this._col, n);
    const valor = Boolean(ativo);
    const ts = this._agora();

    return this._executar(async () => {
      await runTransaction(this._db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw erroNaoEncontrado(`Material ${n} não encontrado.`);
        if (materialDeDocumento(snap.id, snap.data()).ativo === valor) return; // idempotente: nada é gravado
        tx.update(ref, { ativo: valor, atualizadoEm: this._sdk.Timestamp.fromDate(ts) });
      });
      return this._ler(ref);
    });
  }
}

module.exports = { FirestoreMateriaisRepository };
