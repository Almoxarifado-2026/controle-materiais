'use strict';

// ============================================================
// Factory de repositories (Sprint 4) — ÚNICO ponto que escolhe SQLite ou
// Firestore. O domínio recebe os repositories prontos e nunca testa "qual
// banco está em uso".
//
//   const repos = await criarRepositorios();                           // modo vindo do ambiente (padrão sqlite)
//   const repos = await criarRepositorios({ modo: 'sqlite' });
//   const repos = await criarRepositorios({ modo: 'firestore', firestore: { db, sdk } });
//
// Modo Firestore: `firestore.db` e `firestore.sdk` (módulo do SDK) são
// fornecidos por quem tem a configuração (plataforma/src/lib/firebase/
// persistencia.js). Este módulo não conhece credenciais nem importa o SDK.
// A factory é assíncrona porque o contrato dos repositories é assíncrono.
// ============================================================

const { obterModoPersistencia } = require('./config');
const { verificarMateriais, verificarRegistros } = require('./contratos');
const { erroPersistencia, CODIGOS_PERSISTENCIA } = require('./erros');
const { SQLiteMateriaisRepository } = require('./sqlite/SQLiteMateriaisRepository');
const { SQLiteRegistrosPesoRepository } = require('./sqlite/SQLiteRegistrosPesoRepository');
const { FirestoreMateriaisRepository } = require('./firestore/FirestoreMateriaisRepository');
const { FirestoreRegistrosPesoRepository } = require('./firestore/FirestoreRegistrosPesoRepository');

async function criarRepositorios({ modo, sqlite = {}, firestore, agora } = {}) {
  const escolhido = modo === undefined ? obterModoPersistencia() : obterModoPersistencia({ PERSISTENCIA: modo });
  const opcoesComuns = agora ? { agora } : {};

  if (escolhido === 'sqlite') {
    return {
      modo: 'sqlite',
      materiais: verificarMateriais(new SQLiteMateriaisRepository({ ...sqlite, ...opcoesComuns })),
      registros: verificarRegistros(new SQLiteRegistrosPesoRepository({ ...sqlite, ...opcoesComuns })),
    };
  }

  if (!firestore || !firestore.db || !firestore.sdk) throw erroPersistencia(CODIGOS_PERSISTENCIA.CONFIGURACAO);
  const contexto = { db: firestore.db, sdk: firestore.sdk, ...(firestore.colecoes ? { colecoes: firestore.colecoes } : {}), ...opcoesComuns };
  return {
    modo: 'firestore',
    materiais: verificarMateriais(new FirestoreMateriaisRepository(contexto)),
    registros: verificarRegistros(new FirestoreRegistrosPesoRepository(contexto)),
  };
}

module.exports = {
  criarRepositorios,
  obterModoPersistencia,
  SQLiteMateriaisRepository,
  SQLiteRegistrosPesoRepository,
  FirestoreMateriaisRepository,
  FirestoreRegistrosPesoRepository,
};
