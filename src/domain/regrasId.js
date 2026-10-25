'use strict';

// ============================================================
// Regra PADRÃO de ID de material (Sprint de integração dos repositories).
//
// Extraída de src/domain/materiais.js SEM mudar uma vírgula da regra, para
// quebrar um ciclo de dependência que a integração criaria
// (domínio/materiais -> repositories -> SQLite -> filterBuilder -> domínio/materiais).
// É função pura: não conhece banco.
//
// É a regra do SQLite (inteiro positivo; texto só com dígitos, sem zero à
// esquerda). O domínio usa, nas operações reais, o normalizarId() do repository
// ATIVO (que no modo SQLite é exatamente esta regra); esta função continua sendo
// o padrão de normalizarFiltro() quando nenhum repository é informado.
// ============================================================

function normalizarIdMaterial(id) {
  let n = null;
  if (typeof id === 'number') n = id;
  else if (typeof id === 'string' && /^[1-9][0-9]*$/.test(id)) n = Number(id);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

module.exports = { normalizarIdMaterial };
