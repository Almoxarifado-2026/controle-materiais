'use strict';

// ============================================================
// Invariantes de PERSISTÊNCIA (Sprint 4) — funções puras.
//
// O domínio continua dono das regras de negócio (mensagens, ordem de
// validação, normalização de entrada vinda da API). Estas funções são a
// "última barreira" dos repositories: o Firestore não tem CHECK/UNIQUE como o
// SQLite, então a camada de persistência NÃO aceita valores que o sistema atual
// rejeita (pesoKg <= 0, data impossível, nome vazio...) mesmo que um chamador
// esqueça de validar. As regras são as MESMAS do domínio legado (limites e
// expressões idênticos); a equivalência é provada por teste de paridade.
// ============================================================

const { validarData } = require('../utils/datas');
const { erroValidacao } = require('../domain/erros');

const NOME_MAX = 120;
const CATEGORIA_MAX = 60;
const PESO_KG_MAX = 1e9;
// eslint-disable-next-line no-control-regex
const CONTROLE_NOME = /[\u0000-\u001F\u007F]/;
// eslint-disable-next-line no-control-regex
const CONTROLE_OBSERVACAO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

function mostrar(valor) {
  if (typeof valor === 'string') return JSON.stringify(valor.length > 40 ? `${valor.slice(0, 40)}…` : valor);
  if (typeof valor === 'number' || typeof valor === 'bigint' || typeof valor === 'boolean') return String(valor);
  if (valor === undefined) return 'undefined';
  return Object.prototype.toString.call(valor);
}

const ausente = (v) => v === undefined || v === null || v === '';

function normalizarNomeMaterial(valor) {
  if (valor === undefined || valor === null) throw erroValidacao('Nome do material é obrigatório.');
  if (typeof valor !== 'string') throw erroValidacao('Nome do material deve ser um texto.');
  const nome = valor.trim().normalize('NFC');
  if (nome === '') throw erroValidacao('Nome do material não pode ser vazio (nem conter somente espaços).');
  if (nome.length > NOME_MAX) throw erroValidacao(`Nome do material deve ter no máximo ${NOME_MAX} caracteres.`);
  if (CONTROLE_NOME.test(nome)) throw erroValidacao('Nome do material não pode conter caracteres de controle.');
  return nome;
}

/** undefined -> undefined (manter); null/""/espaços -> null; texto -> texto normalizado. */
function normalizarCategoriaMaterial(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== 'string') throw erroValidacao('Categoria do material deve ser um texto (ou vazia).');
  const categoria = valor.trim().normalize('NFC');
  if (categoria === '') return null;
  if (categoria.length > CATEGORIA_MAX) throw erroValidacao(`Categoria do material deve ter no máximo ${CATEGORIA_MAX} caracteres.`);
  if (CONTROLE_NOME.test(categoria)) throw erroValidacao('Categoria do material não pode conter caracteres de controle.');
  return categoria;
}

/** pesoKg: somente number, finito, > 0 e <= PESO_KG_MAX. Nunca converte texto. */
function exigirPeso(valor) {
  if (valor === undefined || valor === null) throw erroValidacao('pesoKg é obrigatório (número em kg, maior que zero).');
  if (typeof valor !== 'number') throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. Deve ser um número (não texto).`);
  if (!Number.isFinite(valor)) throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. Deve ser um número finito.`);
  if (valor <= 0) throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. Deve ser maior que zero.`);
  if (valor > PESO_KG_MAX) throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. O máximo por lançamento é ${PESO_KG_MAX} kg.`);
  return valor;
}

/** dataRecebimento: texto YYYY-MM-DD real (validação única de src/utils/datas.js). Nunca vira Timestamp. */
function exigirDataRecebimento(valor, nomeCampo = 'dataRecebimento') {
  if (typeof valor !== 'string') {
    throw erroValidacao(`${nomeCampo} inválida: deve ser um texto no formato YYYY-MM-DD. Valor recebido: ${mostrar(valor)}.`);
  }
  try {
    return validarData(valor, nomeCampo);
  } catch (err) {
    throw erroValidacao(err.message);
  }
}

/** observacao: undefined/null/""/espaços -> null; texto -> trim + NFC. Não-texto é rejeitado. */
function normalizarObservacao(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') throw erroValidacao(`observacao deve ser um texto (ou ficar em branco). Recebido: ${mostrar(valor)}.`);
  if (!valor.isWellFormed()) throw erroValidacao('observacao contém texto Unicode inválido (surrogate isolado).');
  const texto = valor.trim().normalize('NFC');
  if (CONTROLE_OBSERVACAO.test(texto)) throw erroValidacao('observacao não pode conter caracteres de controle (exceto quebra de linha e tab).');
  return texto === '' ? null : texto;
}

function exigirIdMaterial(valor, normalizarId) {
  if (valor === undefined || valor === null) throw erroValidacao('materialId é obrigatório.');
  const id = normalizarId(valor);
  if (id === null) throw erroValidacao(`materialId inválido: ${mostrar(valor)}.`);
  return id;
}

/**
 * Valida o filtro que chega a um repository (já normalizado pelo domínio, mas
 * revalidado: dado inválido nunca vira "consulta vazia"). Mesma semântica do
 * normalizarFiltro() legado, exceto a SINTAXE do ID, que é de cada
 * implementação (SQLite: inteiro positivo; Firestore: string de documento).
 * Ausente = undefined, null ou "".
 */
function normalizarFiltroRepositorio(entrada, normalizarId) {
  if (entrada === undefined) return {};
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw erroValidacao('Os filtros devem ser informados como um objeto (materialId, categoria, dataInicial, dataFinal).');
  }
  const { materialId, categoria, dataInicial, dataFinal } = entrada;
  const filtro = {};
  if (!ausente(materialId)) {
    const id = normalizarId(materialId);
    if (id === null) throw erroValidacao(`materialId inválido: ${mostrar(materialId)}.`);
    filtro.materialId = id;
  }
  if (!ausente(categoria)) {
    if (typeof categoria !== 'string') throw erroValidacao(`categoria inválida: deve ser um texto. Valor recebido: ${mostrar(categoria)}.`);
    filtro.categoria = categoria;
  }
  for (const [campo, valor] of [['dataInicial', dataInicial], ['dataFinal', dataFinal]]) {
    if (ausente(valor)) continue;
    filtro[campo] = exigirDataRecebimento(valor, campo);
  }
  if (filtro.dataInicial !== undefined && filtro.dataFinal !== undefined && filtro.dataInicial > filtro.dataFinal) {
    throw erroValidacao(`Período inválido: dataInicial (${filtro.dataInicial}) é posterior a dataFinal (${filtro.dataFinal}).`);
  }
  return filtro;
}

const GRANULARIDADES = Object.freeze(['dia', 'mes', 'ano']);

function exigirGranularidade(valor) {
  if (!GRANULARIDADES.includes(valor)) {
    throw erroValidacao(`granularidade inválida: ${mostrar(valor)}. Use: ${GRANULARIDADES.join(', ')}.`);
  }
  return valor;
}

module.exports = {
  NOME_MAX,
  CATEGORIA_MAX,
  PESO_KG_MAX,
  GRANULARIDADES,
  normalizarNomeMaterial,
  normalizarCategoriaMaterial,
  exigirPeso,
  exigirDataRecebimento,
  normalizarObservacao,
  exigirIdMaterial,
  normalizarFiltroRepositorio,
  exigirGranularidade,
};
