'use strict';

// ============================================================
// Provedor dos repositories ATIVOS da aplicação (Sprint de integração).
//
// É o ÚNICO lugar da aplicação que decide QUAL persistência está em uso, a
// partir de PERSISTENCIA (src/repositories/config.js; padrão: sqlite), usando a
// factory existente (criarRepositorios). O domínio pede os repositories aqui e
// nunca testa "qual banco está em uso".
//
//   const { materiais, registros } = await obterRepositorios();
//
// - Criados uma única vez (preguiçosamente) e reaproveitados. Se a criação
//   falhar (ex.: PERSISTENCIA inválida, Firestore sem SDK instalado), o erro é
//   devolvido a quem pediu e a próxima chamada tenta de novo (nada fica "preso").
// - Modo firestore: o contexto (instância + SDK) vem de
//   plataforma/src/lib/firebase/persistencia.js, carregado sob demanda com
//   import() — o SDK só é carregado quando PERSISTENCIA=firestore.
// - definirRepositorios()/redefinirRepositorios(): injeção para testes
//   (ex.: rodar o domínio sobre o Firestore FAKE). A aplicação real não as usa.
// ============================================================

const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { criarRepositorios } = require('./index');
const { obterModoPersistencia } = require('./config');
const { verificarMateriais, verificarRegistros } = require('./contratos');

const CAMINHO_CONTEXTO_FIRESTORE = path.join(__dirname, '..', '..', 'plataforma', 'src', 'lib', 'firebase', 'persistencia.js');

let pendente = null; // Promise<{ modo, materiais, registros }>

async function contextoFirestore(env) {
  const modulo = await import(pathToFileURL(CAMINHO_CONTEXTO_FIRESTORE).href);
  return modulo.criarContextoFirestore(env);
}

async function criar(env) {
  const modo = obterModoPersistencia(env);
  if (modo === 'firestore') return criarRepositorios({ modo, firestore: await contextoFirestore(env) });
  return criarRepositorios({ modo });
}

/** Repositories ativos (criados na primeira chamada, conforme PERSISTENCIA). */
function obterRepositorios(env = process.env) {
  if (!pendente) {
    pendente = criar(env);
    pendente.catch(() => { pendente = null; }); // falha não fica em cache: a próxima chamada tenta de novo
  }
  return pendente;
}

/** Injeção (testes): passa a usar estes repositories (o contrato é verificado). */
function definirRepositorios({ modo = 'injetado', materiais, registros }) {
  const repos = { modo, materiais: verificarMateriais(materiais), registros: verificarRegistros(registros) };
  pendente = Promise.resolve(repos);
  return repos;
}

/** Descarta os repositories atuais: a próxima chamada recria conforme PERSISTENCIA. */
function redefinirRepositorios() {
  pendente = null;
}

module.exports = { obterRepositorios, definirRepositorios, redefinirRepositorios };
