'use strict';

// ============================================================
// Formato PÚBLICO das entidades (Sprint de integração dos repositories).
//
// Os repositories devolvem entidades canônicas (camelCase, ativo booleano —
// ver src/repositories/contratos.js). A API HTTP e o restante do sistema sempre
// receberam o formato de linha da v1.10.0 (snake_case, ativo 0/1). Para NÃO
// mudar nenhuma resposta, o domínio converte aqui, num único lugar, mantendo a
// MESMA ordem de campos das colunas do schema (SELECT * / r.*).
// Funções puras: não conhecem banco.
// ============================================================

/** Material canônico -> { id, nome, categoria, ativo: 0|1, criado_em, atualizado_em } */
function materialParaApi(m) {
  if (!m) return null;
  return {
    id: m.id,
    nome: m.nome,
    categoria: m.categoria,
    ativo: m.ativo ? 1 : 0,
    criado_em: m.criadoEm,
    atualizado_em: m.atualizadoEm,
  };
}

/** Registro canônico -> { id, material_id, peso_kg, data_recebimento, observacao, criado_em, atualizado_em, material_nome, material_categoria } */
function registroParaApi(r) {
  if (!r) return null;
  return {
    id: r.id,
    material_id: r.materialId,
    peso_kg: r.pesoKg,
    data_recebimento: r.dataRecebimento,
    observacao: r.observacao,
    criado_em: r.criadoEm,
    atualizado_em: r.atualizadoEm,
    material_nome: r.materialNome,
    material_categoria: r.materialCategoria,
  };
}

/** Totais canônicos -> { quantidade_registros, total_kg, media_kg } */
function totaisParaApi(t) {
  return { quantidade_registros: t.quantidadeRegistros, total_kg: t.totalKg, media_kg: t.mediaKg };
}

module.exports = { materialParaApi, registroParaApi, totaisParaApi };
