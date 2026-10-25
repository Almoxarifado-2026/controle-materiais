'use strict';

// ============================================================
// Provedor dos repositories NO NAVEGADOR (versão online, GitHub Pages + Firebase).
//
// Substitui src/repositories/provedor.js no bundle (site/build.mjs): o domínio continua
// pedindo `obterRepositorios()` e nunca sabe qual persistência está em uso. Aqui só existe
// o Firestore; o contexto { db, sdk } é entregue por site/src/entrada.js após inicializar o
// Firebase. Mesma API pública do provedor original (obterRepositorios / definirRepositorios /
// redefinirRepositorios), para o domínio e os testes funcionarem sem mudança.
// ============================================================

const { FirestoreMateriaisRepository } = require('../../src/repositories/firestore/FirestoreMateriaisRepository');
const { FirestoreRegistrosPesoRepository } = require('../../src/repositories/firestore/FirestoreRegistrosPesoRepository');
const { verificarMateriais, verificarRegistros } = require('../../src/repositories/contratos');
const { erroPersistencia, CODIGOS_PERSISTENCIA } = require('../../src/repositories/erros');

let contexto = null; // { db, sdk }
let pendente = null; // Promise<{ modo, materiais, registros }>

/** Chamado uma vez por entrada.js: liga os repositories ao Firestore já inicializado. */
function configurarFirestore({ db, sdk }) {
  contexto = { db, sdk };
  pendente = null;
}

async function criar() {
  if (!contexto) throw erroPersistencia(CODIGOS_PERSISTENCIA.CONFIGURACAO);
  return {
    modo: 'firestore',
    materiais: verificarMateriais(new FirestoreMateriaisRepository(contexto)),
    registros: verificarRegistros(new FirestoreRegistrosPesoRepository(contexto)),
  };
}

function obterRepositorios() {
  if (!pendente) {
    pendente = criar();
    pendente.catch(() => { pendente = null; }); // falha não fica em cache
  }
  return pendente;
}

function definirRepositorios({ modo = 'injetado', materiais, registros }) {
  const repos = { modo, materiais: verificarMateriais(materiais), registros: verificarRegistros(registros) };
  pendente = Promise.resolve(repos);
  return repos;
}

function redefinirRepositorios() {
  pendente = null;
}

module.exports = { configurarFirestore, obterRepositorios, definirRepositorios, redefinirRepositorios };
