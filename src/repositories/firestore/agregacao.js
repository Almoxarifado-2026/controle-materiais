'use strict';

// ============================================================
// Agregação e ordenação EM CÓDIGO (Sprint 4) — funções PURAS.
//
// O Firestore não tem GROUP BY nem DISTINCT. Estas funções reproduzem, sobre
// documentos já lidos, o que o SQL fazia:
//   totaisDe            -> COUNT(*), SUM(peso), AVG(peso)  (0/0/0 se vazio)
//   materiaisDistintos  -> COUNT(DISTINCT material_id)
//   agruparPorMaterial  -> GROUP BY material_id + ORDER BY peso DESC, nome, id
//   agruparPorBalde     -> GROUP BY substr(data, 1, n)      + ORDER BY chave
//   ordenarRegistros    -> ORDER BY data DESC, (mais recente primeiro)
//
// Diferença numérica documentada: a ordem de soma pode diferir da do SQLite
// (soma em ordem de ID aqui; em ordem de varredura do índice lá). Para dados
// representáveis exatamente o resultado é idêntico; para decimais binários
// inexatos a diferença é da ordem de 1e-12 relativo.
// ============================================================

const { compararIds, compararUtf8 } = require('./../util');

const TAMANHO_BALDE = Object.freeze({ dia: 10, mes: 7, ano: 4 });

/** Soma determinística: percorre em ordem de ID. */
function somar(registros) {
  let total = 0;
  for (const r of [...registros].sort((a, b) => compararIds(a.id, b.id))) total += r.pesoKg;
  return total;
}

function totaisDe(registros) {
  const quantidadeRegistros = registros.length;
  if (quantidadeRegistros === 0) return { quantidadeRegistros: 0, totalKg: 0, mediaKg: 0 };
  const totalKg = somar(registros);
  return { quantidadeRegistros, totalKg, mediaKg: totalKg / quantidadeRegistros };
}

function materiaisDistintos(registros) {
  return new Set(registros.map((r) => r.materialId)).size;
}

/** dataRecebimento DESC; empate: lançamento mais recente (criadoEm) primeiro; depois ID (numérico quando possível) DESC. */
function ordenarRegistros(registros) {
  return [...registros].sort((a, b) => {
    if (a.dataRecebimento !== b.dataRecebimento) return a.dataRecebimento < b.dataRecebimento ? 1 : -1;
    if (a.criadoEm !== b.criadoEm) return a.criadoEm < b.criadoEm ? 1 : -1;
    return compararIds(b.id, a.id);
  });
}

/** materiaisPorId: Map(id -> { nome }). Material ausente é tratado pelo chamador (referência inválida). */
function agruparPorMaterial(registros, materiaisPorId) {
  const soma = new Map();
  for (const r of [...registros].sort((a, b) => compararIds(a.id, b.id))) {
    soma.set(r.materialId, (soma.get(r.materialId) ?? 0) + r.pesoKg);
  }
  return [...soma.entries()]
    .map(([materialId, pesoKg]) => ({ materialId, material: materiaisPorId.get(materialId).nome, pesoKg }))
    .sort((a, b) => {
      if (a.pesoKg !== b.pesoKg) return b.pesoKg - a.pesoKg;
      const porNome = compararUtf8(a.material, b.material);
      return porNome !== 0 ? porNome : compararIds(a.materialId, b.materialId);
    });
}

function agruparPorBalde(registros, granularidade) {
  const tamanho = TAMANHO_BALDE[granularidade];
  if (tamanho === undefined) throw new Error(`granularidade inválida: ${String(granularidade)}`);
  const soma = new Map();
  for (const r of [...registros].sort((a, b) => compararIds(a.id, b.id))) {
    const chave = r.dataRecebimento.slice(0, tamanho);
    soma.set(chave, (soma.get(chave) ?? 0) + r.pesoKg);
  }
  return [...soma.entries()].map(([chave, pesoKg]) => ({ chave, pesoKg })).sort((a, b) => compararUtf8(a.chave, b.chave));
}

module.exports = { totaisDe, materiaisDistintos, ordenarRegistros, agruparPorMaterial, agruparPorBalde, TAMANHO_BALDE };
