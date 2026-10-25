'use strict';

// Mapeamento linha SQLite -> entidade canônica (fonte única para os dois repositories SQLite).

/** Mesma regra de ID do domínio legado: inteiro positivo seguro; texto só com dígitos (sem zero à esquerda). */
function normalizarIdSqlite(id) {
  let n = null;
  if (typeof id === 'number') n = id;
  else if (typeof id === 'string' && /^[1-9][0-9]*$/.test(id)) n = Number(id);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function materialDeLinha(l) {
  return {
    id: l.id,
    nome: l.nome,
    categoria: l.categoria,
    ativo: l.ativo === 1,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
  };
}

function registroDeLinha(l) {
  return {
    id: l.id,
    materialId: l.material_id,
    pesoKg: l.peso_kg,
    dataRecebimento: l.data_recebimento,
    observacao: l.observacao,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    materialNome: l.material_nome,
    materialCategoria: l.material_categoria,
  };
}

function obterGetDbPadrao() {
  // Carregamento tardio: só abre/instancia o banco singleton quando nenhum getDb foi injetado.
  return () => require('../../db/database').getDb();
}

module.exports = { normalizarIdSqlite, materialDeLinha, registroDeLinha, obterGetDbPadrao };
