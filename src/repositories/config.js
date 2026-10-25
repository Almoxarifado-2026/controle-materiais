'use strict';

// Seleção do modo de persistência. Único ponto que lê a variável de ambiente
// da camada de repositories. Padrão: sqlite (o comportamento atual).

const MODOS = Object.freeze(['sqlite', 'firestore']);

function obterModoPersistencia(env = process.env) {
  const bruto = typeof env.PERSISTENCIA === 'string' ? env.PERSISTENCIA.trim().toLowerCase() : '';
  if (bruto === '') return 'sqlite';
  if (!MODOS.includes(bruto)) {
    throw new Error(`PERSISTENCIA inválida: "${bruto.slice(0, 30)}". Use: ${MODOS.join(' ou ')}.`);
  }
  return bruto;
}

module.exports = { MODOS, obterModoPersistencia };
