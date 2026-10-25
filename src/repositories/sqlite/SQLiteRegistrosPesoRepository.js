'use strict';

const { RegistrosPesoRepository } = require('../contratos');
const { erroMaterialInexistente, erroValidacao } = require('../../domain/erros');
const { construirFiltro } = require('../../filters/filterBuilder');
const {
  exigirPeso,
  exigirDataRecebimento,
  normalizarObservacao,
  exigirIdMaterial,
  exigirGranularidade,
} = require('../invariantes');
const { normalizarIdSqlite, materialDeLinha, registroDeLinha, obterGetDbPadrao } = require('./comum');

// ============================================================
// Implementação SQLite de RegistrosPesoRepository (Sprint 4).
//
// Mesmas consultas do domínio legado (registrosPeso, dashboard, graficos,
// evolucaoTemporal). O WHERE vem do construtor de filtro centralizado
// (construirFiltro), a MESMA fonte única do sistema; nenhum valor é concatenado
// no SQL (a única interpolação é ${whereClause}, montada só com condições
// constantes). Somente o criar() escreve; nada é excluído.
// ============================================================

const SELECT_REGISTRO = `
  SELECT r.*, m.nome AS material_nome, m.categoria AS material_categoria
  FROM registros_peso r
  JOIN materiais m ON m.id = r.material_id
`;

const EXPRESSAO_BALDE = Object.freeze({
  dia: 'r.data_recebimento',
  mes: 'substr(r.data_recebimento, 1, 7)',
  ano: 'substr(r.data_recebimento, 1, 4)',
});

class SQLiteRegistrosPesoRepository extends RegistrosPesoRepository {
  constructor({ getDb = obterGetDbPadrao(), agora = () => new Date() } = {}) {
    super();
    this._getDb = getDb;
    this._agora = agora;
  }

  normalizarId(valor) {
    return normalizarIdSqlite(valor);
  }

  _buscar(db, id) {
    const l = db.prepare(`${SELECT_REGISTRO} WHERE r.id = ?`).get(id);
    return l ? registroDeLinha(l) : null;
  }

  _listar(db, filtro) {
    const { whereClause, params } = construirFiltro(filtro);
    const sql = `${SELECT_REGISTRO} ${whereClause} ORDER BY r.data_recebimento DESC, r.id DESC`;
    return db.prepare(sql).all(...params).map(registroDeLinha);
  }

  _totais(db, filtro) {
    const { whereClause, params } = construirFiltro(filtro);
    const sql = `
      SELECT COUNT(*) AS quantidade_registros,
             COALESCE(SUM(r.peso_kg), 0) AS total_kg,
             COALESCE(AVG(r.peso_kg), 0) AS media_kg
      FROM registros_peso r
      JOIN materiais m ON m.id = r.material_id
      ${whereClause}
    `;
    const l = db.prepare(sql).get(...params);
    return { quantidadeRegistros: l.quantidade_registros, totalKg: l.total_kg, mediaKg: l.media_kg };
  }

  _materiaisEnvolvidos(db, filtro) {
    const { whereClause, params } = construirFiltro(filtro);
    const sql = `
      SELECT COUNT(DISTINCT r.material_id) AS materiais_envolvidos
      FROM registros_peso r
      JOIN materiais m ON m.id = r.material_id
      ${whereClause}
    `;
    return db.prepare(sql).get(...params).materiais_envolvidos;
  }

  async criar(dados, { validarMaterial } = {}) {
    if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
      throw erroValidacao('Os dados do registro devem ser informados como um objeto.');
    }
    const materialId = exigirIdMaterial(dados.materialId, (v) => this.normalizarId(v));
    const pesoKg = exigirPeso(dados.pesoKg);
    const dataRecebimento = exigirDataRecebimento(dados.dataRecebimento);
    const observacao = normalizarObservacao(dados.observacao);
    const db = this._getDb();

    return db.transaction(() => {
      const linhaMaterial = db.prepare('SELECT * FROM materiais WHERE id = ?').get(materialId) || null;
      const material = linhaMaterial ? materialDeLinha(linhaMaterial) : null;
      if (typeof validarMaterial === 'function') validarMaterial(material);
      if (!material) throw erroMaterialInexistente(`Material ${materialId} não encontrado.`);

      const ts = this._agora().toISOString();
      const info = db
        .prepare(
          `INSERT INTO registros_peso (material_id, peso_kg, data_recebimento, observacao, criado_em, atualizado_em)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(materialId, pesoKg, dataRecebimento, observacao, ts, ts);
      if (info.changes !== 1) throw new Error('Falha ao persistir registro de peso: nenhuma linha afetada.');

      const relido = this._buscar(db, Number(info.lastInsertRowid));
      const confere =
        relido !== null &&
        relido.materialId === materialId &&
        Object.is(relido.pesoKg, pesoKg) &&
        relido.dataRecebimento === dataRecebimento &&
        relido.observacao === observacao &&
        relido.criadoEm === ts &&
        relido.atualizadoEm === ts;
      if (!confere) throw new Error('Falha ao confirmar a persistência do registro de peso. Nada foi gravado.');
      return relido;
    })();
  }

  async buscarPorId(id) {
    const n = this.normalizarId(id);
    if (n === null) return null;
    return this._buscar(this._getDb(), n);
  }

  async listar(filtro = {}) {
    return this._listar(this._getDb(), filtro);
  }

  async totais(filtro = {}) {
    return this._totais(this._getDb(), filtro);
  }

  async consultarHistorico(filtro = {}) {
    const db = this._getDb();
    return db.transaction(() => ({ totais: this._totais(db, filtro), registros: this._listar(db, filtro) }))();
  }

  async consultarIndicadores(filtro = {}) {
    const db = this._getDb();
    return db.transaction(() => ({
      ...this._totais(db, filtro),
      materiaisEnvolvidos: this._materiaisEnvolvidos(db, filtro),
    }))();
  }

  async pesoPorMaterial(filtro = {}) {
    const { whereClause, params } = construirFiltro(filtro);
    const sql = `
      SELECT r.material_id AS material_id, m.nome AS material, SUM(r.peso_kg) AS peso_total
      FROM registros_peso r
      JOIN materiais m ON m.id = r.material_id
      ${whereClause}
      GROUP BY r.material_id, m.nome
      ORDER BY peso_total DESC, m.nome ASC, r.material_id ASC
    `;
    return this._getDb()
      .prepare(sql)
      .all(...params)
      .map((l) => ({ materialId: l.material_id, material: l.material, pesoKg: l.peso_total }));
  }

  async pesoPorBalde(filtro = {}, granularidade) {
    const g = exigirGranularidade(granularidade);
    const { whereClause, params } = construirFiltro(filtro);
    const sql = `
      SELECT ${EXPRESSAO_BALDE[g]} AS chave, SUM(r.peso_kg) AS peso_total
      FROM registros_peso r
      JOIN materiais m ON m.id = r.material_id
      ${whereClause}
      GROUP BY chave
      ORDER BY chave
    `;
    return this._getDb()
      .prepare(sql)
      .all(...params)
      .map((l) => ({ chave: l.chave, pesoKg: l.peso_total }));
  }
}

module.exports = { SQLiteRegistrosPesoRepository };
