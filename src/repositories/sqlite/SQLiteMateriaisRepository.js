'use strict';

const { MateriaisRepository } = require('../contratos');
const { erroNaoEncontrado, erroDuplicado, erroValidacao } = require('../../domain/erros');
const { chaveNome } = require('../util');
const { normalizarNomeMaterial, normalizarCategoriaMaterial } = require('../invariantes');
const { normalizarIdSqlite, materialDeLinha, obterGetDbPadrao } = require('./comum');

// ============================================================
// Implementação SQLite de MateriaisRepository (Sprint 4).
//
// Mesmo SQL e mesmas garantias do domínio legado (src/domain/materiais.js):
// duplicidade case-insensitive pt-BR checada DENTRO de transação + UNIQUE binário
// do schema como barreira final; nada é excluído; schema inalterado.
// Todo SQL é parametrizado.
// ============================================================

class SQLiteMateriaisRepository extends MateriaisRepository {
  constructor({ getDb = obterGetDbPadrao(), agora = () => new Date() } = {}) {
    super();
    this._getDb = getDb;
    this._agora = agora;
  }

  normalizarId(valor) {
    return normalizarIdSqlite(valor);
  }

  _ts() {
    return this._agora().toISOString();
  }

  _linha(db, id) {
    return db.prepare('SELECT * FROM materiais WHERE id = ?').get(id) || null;
  }

  _exigirNomeDisponivel(db, nome, ignorarId = null) {
    const chave = chaveNome(nome);
    const conflito = db
      .prepare('SELECT id, nome FROM materiais')
      .all()
      .find((m) => m.id !== ignorarId && chaveNome(m.nome) === chave);
    if (conflito) throw erroDuplicado(`Já existe um material com o nome "${conflito.nome}".`);
  }

  _traduzir(err, nome) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY')) {
      return erroDuplicado(`Já existe um material com o nome "${nome}".`);
    }
    return err;
  }

  async listar({ incluirInativos = false } = {}) {
    if (typeof incluirInativos !== 'boolean') throw erroValidacao('incluirInativos deve ser verdadeiro ou falso.');
    const sql = incluirInativos
      ? 'SELECT * FROM materiais ORDER BY nome'
      : 'SELECT * FROM materiais WHERE ativo = 1 ORDER BY nome';
    return this._getDb().prepare(sql).all().map(materialDeLinha);
  }

  async buscarPorId(id) {
    const n = this.normalizarId(id);
    if (n === null) return null;
    const l = this._linha(this._getDb(), n);
    return l ? materialDeLinha(l) : null;
  }

  async contarPorStatus() {
    const linhas = this._getDb().prepare('SELECT ativo, COUNT(*) AS n FROM materiais GROUP BY ativo').all();
    const contagem = { ativos: 0, inativos: 0 };
    for (const { ativo, n } of linhas) {
      if (ativo === 1) contagem.ativos = n;
      else contagem.inativos = n;
    }
    return contagem;
  }

  async criar(dados) {
    if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
      throw erroValidacao('Os dados do material devem ser informados como um objeto.');
    }
    const nome = normalizarNomeMaterial(dados.nome);
    const categoria = normalizarCategoriaMaterial(dados.categoria) ?? null;
    const db = this._getDb();
    const ts = this._ts();
    let id;
    try {
      id = db.transaction(() => {
        this._exigirNomeDisponivel(db, nome);
        const info = db
          .prepare('INSERT INTO materiais (nome, categoria, ativo, criado_em, atualizado_em) VALUES (?, ?, 1, ?, ?)')
          .run(nome, categoria, ts, ts);
        if (info.changes !== 1) throw new Error('Falha ao persistir material: nenhuma linha afetada.');
        return Number(info.lastInsertRowid);
      })();
    } catch (err) {
      throw this._traduzir(err, nome);
    }
    return materialDeLinha(this._linha(db, id));
  }

  async atualizar(id, campos = {}) {
    const n = this.normalizarId(id);
    if (n === null) throw erroValidacao(`ID de material inválido: ${String(id).slice(0, 40)}.`);
    if (campos === null || typeof campos !== 'object' || Array.isArray(campos)) {
      throw erroValidacao('Os campos a atualizar devem ser informados como um objeto.');
    }
    const nomeNovo = campos.nome !== undefined ? normalizarNomeMaterial(campos.nome) : undefined;
    const categoriaNova = normalizarCategoriaMaterial(campos.categoria);
    const db = this._getDb();
    let nomeFinal = nomeNovo;
    try {
      db.transaction(() => {
        const atual = this._linha(db, n);
        if (!atual) throw erroNaoEncontrado(`Material ${n} não encontrado.`);
        nomeFinal = nomeNovo !== undefined ? nomeNovo : atual.nome;
        const categoriaFinal = categoriaNova !== undefined ? categoriaNova : atual.categoria;
        this._exigirNomeDisponivel(db, nomeFinal, n);
        const info = db
          .prepare('UPDATE materiais SET nome = ?, categoria = ?, atualizado_em = ? WHERE id = ?')
          .run(nomeFinal, categoriaFinal, this._ts(), n);
        if (info.changes !== 1) throw new Error('Falha ao persistir atualização do material.');
      })();
    } catch (err) {
      throw this._traduzir(err, nomeFinal);
    }
    return materialDeLinha(this._linha(db, n));
  }

  async definirAtivo(id, ativo) {
    const n = this.normalizarId(id);
    if (n === null) throw erroValidacao(`ID de material inválido: ${String(id).slice(0, 40)}.`);
    const db = this._getDb();
    const valor = ativo ? 1 : 0;
    db.transaction(() => {
      const atual = this._linha(db, n);
      if (!atual) throw erroNaoEncontrado(`Material ${n} não encontrado.`);
      if (atual.ativo === valor) return;
      const info = db.prepare('UPDATE materiais SET ativo = ?, atualizado_em = ? WHERE id = ?').run(valor, this._ts(), n);
      if (info.changes !== 1) throw new Error('Falha ao persistir alteração de status do material.');
    })();
    return materialDeLinha(this._linha(db, n));
  }
}

module.exports = { SQLiteMateriaisRepository };
