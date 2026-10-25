'use strict';

const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { getDb, checkIntegrity } = require('../db/database');
const config = require('../../config/config');

// ============================================================
// Backup — NÚCLEO ÚNICO e reutilizável.
//
// criarBackup({ motivo }) é a ÚNICA implementação de backup do
// sistema. Todo chamador — hoje o endpoint manual e a restauração
// (backup de segurança), amanhã um agendador — usa esta mesma
// função, mudando apenas o "motivo". Não existe lógica de backup
// paralela em nenhum outro arquivo.
//
//   motivo            quem chama                       status
//   ----------------  -------------------------------  ---------
//   'manual'          POST /api/backup                 REAL
//   'pre_restauracao' restore.js, antes de sobrescrever REAL
//   'automatico'      agendador (a ser implementado)   FUTURO
//
// O motivo entra no nome do arquivo (backup_<timestamp>_<motivo>.db)
// e por isso é normalizado para [a-z0-9_-]: um motivo nunca pode
// injetar separadores de caminho ("../") nem caracteres inválidos.
//
// Como é feito:
//   1. API nativa de backup do SQLite (via better-sqlite3), que gera
//      uma cópia consistente mesmo com o banco em uso e WAL ativo
//      (não é um fs.copyFile, que poderia copiar no meio de uma escrita).
//   2. integrity_check no ARQUIVO gerado, aberto como banco
//      independente — a cópia só é considerada válida se passar.
//   3. Se a verificação falhar, o arquivo inválido é REMOVIDO (um
//      backup corrompido nunca fica na pasta parecendo válido) e o
//      erro é propagado ao chamador.
//
// Um agendador futuro só precisa chamar:
//     await criarBackup({ motivo: 'automatico' })
// e tratar a exceção/registrar o resultado. Nada aqui precisa mudar.
// Nenhuma rotina agendada existe neste Sprint (verificado por teste).
//
// Nenhum backup é apagado por esta camada (sem rotação/expurgo
// automático) — coerente com a regra de retenção de longo prazo.
// ============================================================

function ensureBackupsDir() {
  if (!fs.existsSync(config.paths.backupsDir)) {
    fs.mkdirSync(config.paths.backupsDir, { recursive: true });
  }
}

function normalizarMotivo(motivo) {
  const limpo = String(motivo ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!limpo) {
    throw new Error('Motivo do backup é obrigatório (ex.: "manual", "automatico").');
  }
  return limpo;
}

// Remove os arquivos auxiliares de WAL (-wal/-shm) que podem sobrar ao lado de UM
// arquivo de banco depois que ele é aberto (mesmo em modo readonly): o cabeçalho do
// arquivo de backup herda journal_mode=WAL do banco de origem, então o próprio
// SQLite cria esses dois arquivos ao abrir/verificar o backup. Achado do Sprint 9:
// sem esta limpeza, cada backup deixava dois arquivos extra (uma tentativa de
// checkpoint primeiro garante que nada fica pendente só nesses arquivos auxiliares).
// Nunca lança: é limpeza de melhor esforço, nunca motivo para invalidar um backup
// que já passou no integrity_check.
function limparAuxiliaresWal(caminhoDb, dbAberto = null) {
  if (dbAberto) {
    try {
      dbAberto.pragma('wal_checkpoint(TRUNCATE)');
    } catch {
      // Conexão readonly ou já fechada: segue para a remoção direta dos arquivos.
    }
  }
  for (const sufixo of ['-wal', '-shm']) {
    try {
      fs.rmSync(caminhoDb + sufixo, { force: true });
    } catch {
      // Melhor esforço: arquivo auxiliar não impede o uso do backup.
    }
  }
}

// ------------------------------------------------------------
// Serialização de criarBackup (achado do Sprint 9 — seção 9/concorrência).
//
// db.backup() (better-sqlite3) não suporta duas cópias simultâneas a partir da
// MESMA conexão: sob chamadas concorrentes (ex.: dois cliques/duas requisições
// HTTP de "Criar backup agora" quase ao mesmo tempo), a segunda cópia falhava
// com "unable to open database file" e a criação de backup respondia 500 —
// reproduzido por teste. A correção é mínima e local a este arquivo: uma fila
// (mutex baseado em Promise) garante que só uma cópia roda por vez; chamadas
// concorrentes esperam a vez e são atendidas em sequência, cada uma com seu
// próprio timestamp (elimina também colisão de nome de arquivo no mesmo
// milissegundo). Nenhuma outra arquitetura foi introduzida.
// ------------------------------------------------------------
let filaBackup = Promise.resolve();

function criarBackup(opcoes) {
  const proximo = filaBackup.then(() => criarBackupSerializado(opcoes));
  // A fila avança mesmo se esta chamada falhar, para não travar as próximas.
  filaBackup = proximo.catch(() => {});
  return proximo;
}

async function criarBackupSerializado({ motivo = 'manual' } = {}) {
  const motivoNormalizado = normalizarMotivo(motivo);
  ensureBackupsDir();

  const db = getDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const nomeArquivo = `backup_${timestamp}_${motivoNormalizado}.db`;
  const destino = path.join(config.paths.backupsDir, nomeArquivo);

  // db.backup() é assíncrono (retorna Promise) nesta biblioteca —
  // é preciso aguardar a cópia terminar antes de verificar o arquivo.
  await db.backup(destino);

  // Verifica a integridade do arquivo de backup gerado, abrindo-o
  // como um banco independente — não confia apenas no fato de a
  // cópia ter "terminado sem erro".
  try {
    const backupDb = new Database(destino, { readonly: true });
    try {
      checkIntegrity(backupDb);
    } finally {
      limparAuxiliaresWal(destino, backupDb);
      backupDb.close();
    }
  } catch (err) {
    fs.rmSync(destino, { force: true });
    limparAuxiliaresWal(destino);
    throw new Error(`Backup descartado: o arquivo gerado não passou na verificação de integridade (${err.message})`);
  }

  return {
    arquivo: destino,
    motivo: motivoNormalizado,
    tamanhoBytes: fs.statSync(destino).size,
    criadoEm: new Date().toISOString(),
    integro: true,
  };
}

// Extrai o "motivo" do nome do arquivo (formato gerado por criarBackup: backup_<timestampISO-com-Z>_<motivo>.db).
// Só apresentação/consulta; não é usado para validar nada.
function extrairMotivo(nomeArquivo) {
  const m = /^backup_.+Z_(.+)\.db$/.exec(nomeArquivo);
  return m ? m[1] : null;
}

function listarBackups() {
  ensureBackupsDir();
  return fs
    .readdirSync(config.paths.backupsDir)
    .filter((f) => f.endsWith('.db'))
    .map((f) => {
      const full = path.join(config.paths.backupsDir, f);
      const stat = fs.statSync(full);
      return {
        // Uso INTERNO (domínio/testes) — a camada HTTP (server.js) nunca expõe este
        // campo ao cliente (seção 19 do prompt: caminho físico permanece no servidor).
        arquivo: full,
        nomeArquivo: f,
        motivo: extrairMotivo(f),
        tamanhoBytes: stat.size,
        criadoEm: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.criadoEm.localeCompare(a.criadoEm));
}

// ============================================================
// Resolução SEGURA de identificador -> caminho físico (Sprint 8, seção 11).
//
// A API HTTP nunca recebe nem confia em um caminho absoluto vindo do cliente.
// O cliente manda só o NOME do arquivo (o mesmo "nomeArquivo" devolvido por
// listarBackups()); esta função resolve esse nome para dentro de
// config.paths.backupsDir e REJEITA qualquer coisa que não seja exatamente um
// nome de arquivo de backup gerado por criarBackup:
//   - só letras/números/"_"/"-"/"." são aceitos (sem "/" nem "\\": nenhuma
//     forma de path traversal ou caminho absoluto passa nessa lista);
//   - precisa começar com "backup_" e terminar com ".db" (mesmo padrão gerado
//     por criarBackup — não é possível apontar para outro arquivo qualquer
//     que porventura exista na pasta);
//   - dupla checagem: depois de resolvido, o diretório-pai do caminho final
//     precisa continuar sendo EXATAMENTE backupsDir (defesa em profundidade,
//     caso a lista de caracteres acima precise mudar no futuro);
//   - o arquivo precisa existir.
// As mensagens de erro NUNCA incluem o caminho recebido nem o caminho
// absoluto resolvido (seção 17/19): não há o que vazar.
// ============================================================
const PADRAO_NOME_BACKUP = /^backup_[A-Za-z0-9_.-]+\.db$/;

function resolverCaminhoBackup(nomeArquivo) {
  if (typeof nomeArquivo !== 'string' || !PADRAO_NOME_BACKUP.test(nomeArquivo) || nomeArquivo.includes('..')) {
    throw new Error('Identificador de backup inválido.');
  }
  const base = path.resolve(config.paths.backupsDir);
  const resolvido = path.resolve(base, nomeArquivo);
  if (path.dirname(resolvido) !== base) {
    throw new Error('Identificador de backup inválido.');
  }
  if (!fs.existsSync(resolvido)) {
    throw new Error('Backup não encontrado.');
  }
  return resolvido;
}

// Verificação de integridade de UM backup específico, sob demanda (seção 9: não afirmar
// "íntegro" só porque o arquivo existe; verificar quando solicitado, sem custo a cada
// renderização da lista). Nunca lança por falha de integridade — devolve o resultado.
function verificarIntegridadeBackup(nomeArquivo) {
  const caminho = resolverCaminhoBackup(nomeArquivo); // pode lançar (identificador inválido / não encontrado)
  try {
    const db = new Database(caminho, { readonly: true });
    try {
      checkIntegrity(db);
    } finally {
      // Mesmo achado do Sprint 9 (ver criarBackup): abrir o backup pode recriar
      // -wal/-shm ao lado dele; limpeza de melhor esforço para manter o arquivo único.
      limparAuxiliaresWal(caminho, db);
      db.close();
    }
    return { nomeArquivo, integro: true, status: 'ok' };
  } catch {
    return { nomeArquivo, integro: false, status: 'erro' };
  }
}

module.exports = { criarBackup, listarBackups, resolverCaminhoBackup, verificarIntegridadeBackup };
