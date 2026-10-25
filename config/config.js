'use strict';

const path = require('node:path');

// ============================================================
// Configuração central. Nenhuma credencial é necessária neste
// Sprint porque a persistência é um arquivo SQLite local — não
// há serviço externo, chave de API ou senha envolvida.
// Valores podem ser sobrescritos por variáveis de ambiente,
// mas nenhum valor sensível é hardcoded aqui.
// ============================================================

const ROOT_DIR = path.resolve(__dirname, '..');

const config = {
  env: process.env.NODE_ENV || 'development',

  paths: {
    root: ROOT_DIR,
    dataDir: process.env.DATA_DIR || path.join(ROOT_DIR, 'data'),
    dbFile: process.env.DB_FILE || path.join(ROOT_DIR, 'data', 'controle_materiais.db'),
    schemaFile: path.join(ROOT_DIR, 'src', 'db', 'schema.sql'),
    backupsDir: process.env.BACKUPS_DIR || path.join(ROOT_DIR, 'backups'),
  },

  server: {
    port: Number(process.env.PORT) || 3000,
  },

  schemaVersion: '1.0.0',
};

module.exports = config;
