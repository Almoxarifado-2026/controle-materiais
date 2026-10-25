'use strict';

const fs = require('node:fs');
const Database = require('better-sqlite3');
const { getDb, closeDb, checkIntegrity } = require('../db/database');
const { criarBackup } = require('./backup');
const config = require('../../config/config');

// ============================================================
// Restauração.
//
// Proteção contra restauração acidental (exigência explícita do
// Sprint 1, preservada):
//   1. Exige confirmar: true explícito — nunca restaura "por padrão".
//   2. Valida que o arquivo de origem existe e passa em
//      integrity_check ANTES de tocar no banco atual.
//   3. Antes de sobrescrever, cria automaticamente um backup de
//      segurança do estado atual chamando o MESMO núcleo de backup
//      (criarBackup, motivo "pre_restauracao") — não há lógica de
//      backup duplicada aqui. Se esse backup falhar, a restauração
//      é abortada e o banco atual NÃO é tocado.
//   4. Fecha a conexão ativa antes de substituir o arquivo.
//   5. A troca do arquivo é feita copiando para um arquivo temporário
//      e depois renomeando sobre o banco (rename é atômico no mesmo
//      diretório): se a cópia falhar no meio (disco cheio, etc.), o
//      banco atual permanece intacto — nunca fica meio sobrescrito.
//   6. Depois da troca, reabre o banco e roda integrity_check de novo.
// ============================================================

async function restaurar({ arquivoOrigem, confirmar = false } = {}) {
  if (confirmar !== true) {
    throw new Error(
      'Restauração bloqueada: é necessário confirmar explicitamente (confirmar: true) para evitar restauração acidental.'
    );
  }
  if (!arquivoOrigem || !fs.existsSync(arquivoOrigem)) {
    throw new Error(`Arquivo de backup não encontrado: ${arquivoOrigem}`);
  }

  // Valida integridade do backup de origem antes de qualquer alteração.
  const origemDb = new Database(arquivoOrigem, { readonly: true });
  try {
    checkIntegrity(origemDb);
  } finally {
    origemDb.close();
  }

  // Backup de segurança do estado atual, para tornar a operação reversível.
  const backupSeguranca = await criarBackup({ motivo: 'pre_restauracao' });

  // Fecha a conexão ativa antes de substituir o arquivo físico
  // (closeDb faz checkpoint do WAL, deixando o -wal vazio).
  closeDb();

  const temporario = `${config.paths.dbFile}.restauracao-tmp`;
  try {
    fs.copyFileSync(arquivoOrigem, temporario);

    // Remove eventuais arquivos de WAL/SHM órfãos da versão anterior,
    // para que a próxima abertura não misture estados.
    for (const ext of ['-wal', '-shm']) {
      const p = config.paths.dbFile + ext;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    fs.renameSync(temporario, config.paths.dbFile);
  } catch (err) {
    fs.rmSync(temporario, { force: true });
    throw new Error(
      `Falha ao substituir o banco (banco atual preservado). Backup de segurança: ${backupSeguranca.arquivo}. Detalhe: ${err.message}`
    );
  }

  // Reabre o banco restaurado e confirma a integridade do resultado final.
  checkIntegrity(getDb());

  return {
    restauradoDe: arquivoOrigem,
    backupDeSegurancaCriado: backupSeguranca.arquivo,
    restauradoEm: new Date().toISOString(),
  };
}

module.exports = { restaurar };
