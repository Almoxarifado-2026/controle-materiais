'use strict';

const fs = require('node:fs');
const Database = require('better-sqlite3');
const config = require('../../config/config');

// ============================================================
// Camada de persistência.
//
// Decisões de arquitetura (Sprint 1):
//
// 1. SQLite via better-sqlite3 (biblioteca madura, API síncrona).
//    A API síncrona é proposital: cada gravação retorna imediatamente
//    a confirmação do banco (changes / lastInsertRowid), então o
//    domínio pode SABER que a gravação foi persistida, em vez de
//    apenas confiar que "salvou na interface".
//
// 2. journal_mode = WAL: tolera quedas de energia/processo com menor
//    risco de corrupção do que o modo padrão, e permite leituras
//    concorrentes enquanto há gravação.
//
// 3. synchronous = FULL: garante que o SQLite espera a confirmação
//    física do disco antes de considerar a transação concluída —
//    prioriza integridade em vez de velocidade máxima, o que é a
//    escolha correta para um histórico que precisa durar anos.
//
// 4. foreign_keys = ON: nenhum registro_peso pode referenciar um
//    material inexistente (integridade referencial).
//
// 5. Nenhuma rotina de exclusão automática de dados existe nesta
//    camada nem em nenhum outro arquivo do código-base deste Sprint.
// ============================================================

let dbInstance = null;

function ensureDataDir() {
  if (!fs.existsSync(config.paths.dataDir)) {
    fs.mkdirSync(config.paths.dataDir, { recursive: true });
  }
}

function applySchema(db) {
  const schemaSql = fs.readFileSync(config.paths.schemaFile, 'utf8');
  db.exec(schemaSql);

  const upsertMeta = db.prepare(
    `INSERT INTO schema_meta (chave, valor) VALUES ('schema_version', ?)
     ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
  );
  upsertMeta.run(config.schemaVersion);
}

/**
 * Retorna a instância singleton do banco, criando e aplicando o
 * schema na primeira chamada. Reaproveitar a mesma conexão evita
 * o custo de reabrir o arquivo a cada operação.
 */
function getDb() {
  if (dbInstance) return dbInstance;

  ensureDataDir();

  dbInstance = new Database(config.paths.dbFile);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('synchronous = FULL');
  dbInstance.pragma('foreign_keys = ON');

  applySchema(dbInstance);

  return dbInstance;
}

/**
 * Fecha a conexão. Usado em testes e em desligamento controlado
 * do processo (para garantir checkpoint do WAL antes de sair).
 */
function closeDb() {
  if (dbInstance) {
    dbInstance.pragma('wal_checkpoint(TRUNCATE)');
    dbInstance.close();
    dbInstance = null;
  }
}

/**
 * Verificação de integridade do arquivo de banco. Usado antes/depois
 * de backups e restaurações, e disponível para diagnósticos.
 * Retorna true se íntegro, ou lança erro com o motivo se não estiver.
 */
function checkIntegrity(db = getDb()) {
  const result = db.pragma('integrity_check');
  const ok = result.length === 1 && result[0].integrity_check === 'ok';
  if (!ok) {
    throw new Error(
      `Falha de integridade do banco: ${JSON.stringify(result)}`
    );
  }
  return true;
}

module.exports = { getDb, closeDb, checkIntegrity, dbFilePath: config.paths.dbFile };
