'use strict';

// ============================================================
// Mapeamento documento Firestore <-> entidade canônica (Sprint 4).
// Funções PURAS: não importam o SDK (o construtor Timestamp é recebido por
// parâmetro) — por isso são testáveis sem Emulator.
//
// Modelo (aprovado na Sprint 2; ver docs/firebase/sqlite-firestore-mapping.md):
//   materiais/{id}      { nome, categoria|null, ativo:boolean, criadoEm:Timestamp, atualizadoEm:Timestamp }
//   registrosPeso/{id}  { materialId:string, pesoKg:number, dataRecebimento:string 'YYYY-MM-DD',
//                         observacao:string|null, criadoEm:Timestamp, atualizadoEm:Timestamp }
//   materiaisNomesIndex/{chaveCodificada} { materialId, chave, nome }
// dataRecebimento NÃO é Timestamp (decisão da Sprint 2, seção 7).
// ============================================================

const { erroPersistencia, CODIGOS_PERSISTENCIA } = require('../erros');

// Nomes das coleções: mesma fonte de verdade da Sprint 3 (plataforma/src/lib/firebase/colecoes.js);
// a igualdade é verificada por teste.
const COLECOES = Object.freeze({
  MATERIAIS: 'materiais',
  REGISTROS_PESO: 'registrosPeso',
  MATERIAIS_NOMES_INDEX: 'materiaisNomesIndex',
  METADADOS: 'metadados',
});

/** Sintaxe de ID de documento aceita: ID automático (alfanumérico), inteiro migrado ("7") ou texto simples. */
function normalizarIdFirestore(valor) {
  if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor > 0 ? String(valor) : null;
  if (typeof valor !== 'string') return null;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(valor)) return null;
  if (/^__.*__$/.test(valor)) return null; // padrão reservado do Firestore
  return valor;
}

function integridade() {
  return erroPersistencia(CODIGOS_PERSISTENCIA.INTEGRIDADE);
}

function paraIso(ts) {
  if (ts && typeof ts.toDate === 'function') return ts.toDate().toISOString();
  throw integridade();
}

function materialDeDocumento(id, d) {
  if (!d || typeof d.nome !== 'string' || typeof d.ativo !== 'boolean') throw integridade();
  if (d.categoria !== null && d.categoria !== undefined && typeof d.categoria !== 'string') throw integridade();
  return {
    id,
    nome: d.nome,
    categoria: d.categoria ?? null,
    ativo: d.ativo,
    criadoEm: paraIso(d.criadoEm),
    atualizadoEm: paraIso(d.atualizadoEm),
  };
}

function dadosDeMaterial({ nome, categoria, ativo, criadoEm, atualizadoEm }, Timestamp) {
  return {
    nome,
    categoria: categoria ?? null,
    ativo,
    criadoEm: Timestamp.fromDate(criadoEm),
    atualizadoEm: Timestamp.fromDate(atualizadoEm),
  };
}

/** Documento de registro -> entidade SEM os campos do material (a junção é feita pelo repository). */
function registroDeDocumento(id, d) {
  if (
    !d ||
    typeof d.materialId !== 'string' ||
    typeof d.pesoKg !== 'number' ||
    typeof d.dataRecebimento !== 'string' ||
    (d.observacao !== null && d.observacao !== undefined && typeof d.observacao !== 'string')
  ) {
    throw integridade();
  }
  return {
    id,
    materialId: d.materialId,
    pesoKg: d.pesoKg,
    dataRecebimento: d.dataRecebimento,
    observacao: d.observacao ?? null,
    criadoEm: paraIso(d.criadoEm),
    atualizadoEm: paraIso(d.atualizadoEm),
  };
}

function dadosDeRegistro({ materialId, pesoKg, dataRecebimento, observacao, criadoEm, atualizadoEm }, Timestamp) {
  return {
    materialId,
    pesoKg,
    dataRecebimento,
    observacao: observacao ?? null,
    criadoEm: Timestamp.fromDate(criadoEm),
    atualizadoEm: Timestamp.fromDate(atualizadoEm),
  };
}

function comMaterial(registro, material) {
  return { ...registro, materialNome: material.nome, materialCategoria: material.categoria };
}

/** Lista as funções do SDK ausentes (o SDK é injetado; nada é importado aqui). */
function funcoesAusentes(sdk, nomes) {
  return nomes.filter((n) => !sdk || typeof sdk[n] !== 'function');
}

module.exports = {
  COLECOES,
  normalizarIdFirestore,
  materialDeDocumento,
  dadosDeMaterial,
  registroDeDocumento,
  dadosDeRegistro,
  comMaterial,
  funcoesAusentes,
};
