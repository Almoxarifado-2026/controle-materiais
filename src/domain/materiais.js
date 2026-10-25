'use strict';

const { obterRepositorios } = require('../repositories/provedor');
const { normalizarIdMaterial } = require('./regrasId');
const { materialParaApi } = require('./formatoApi');
const { erroValidacao, erroNaoEncontrado } = require('./erros');

// ============================================================
// Domínio: Materiais (Sprint 2 — consolidação do cadastro).
//
// - Nenhum nome de material é hardcoded: o cadastro é 100% dinâmico.
// - "Excluir" NÃO existe de propósito: materiais são ativados/desativados
//   para nunca quebrar o histórico de registros_peso que os referencia.
// - TODA regra de validação de material vive neste arquivo (fonte única);
//   o servidor HTTP só repassa a entrada e traduz o erro para status.
// - Integração dos repositories: este módulo NÃO acessa banco. A persistência
//   (consultas, transação, unicidade atômica do nome, tradução de erro do banco)
//   é do MateriaisRepository ativo (src/repositories/provedor.js). Aqui ficam as
//   regras de negócio: campos aceitos, validação, mensagens e ordem das checagens.
//   Todas as operações são assíncronas (o contrato dos repositories é assíncrono).
//   O retorno mantém o formato da v1.10.0 (snake_case, ativo 0/1): formatoApi.js.
// ============================================================

const NOME_MAX = 120;
const CATEGORIA_MAX = 60;
const CAMPOS_CRIAR = ['nome', 'categoria'];
const CAMPOS_EDITAVEIS = ['nome', 'categoria'];
// eslint-disable-next-line no-control-regex
const CARACTERES_DE_CONTROLE = /[\u0000-\u001F\u007F]/;

async function repositorio() {
  return (await obterRepositorios()).materiais;
}

// ------------------------------------------------------------
// Validação de entrada
// ------------------------------------------------------------

/**
 * Converte um ID (número, ou texto só com dígitos vindo da URL) em inteiro
 * positivo seguro. Retorna null se não for um ID válido — nunca "adivinha"
 * (rejeita "abc", "1.5", "-1", "0", "1e3", " 1", NaN, objetos...).
 * Regra pura em src/domain/regrasId.js (a do modo SQLite; ver lá).
 */
const normalizarId = normalizarIdMaterial;

function exigirId(id, normalizar = normalizarId) {
  const n = normalizar(id);
  if (n === null) {
    throw erroValidacao(
      `ID de material inválido: ${String(id).slice(0, 40)}. Informe um número inteiro positivo.`
    );
  }
  return n;
}

function exigirObjetoComCampos(dados, permitidos) {
  if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
    throw erroValidacao('Os dados do material devem ser informados como um objeto JSON.');
  }
  const extras = Object.keys(dados).filter((c) => !permitidos.includes(c));
  if (extras.length > 0) {
    let msg = `Campo(s) não permitido(s): ${extras.join(', ')}. Campos aceitos: ${permitidos.join(', ')}.`;
    if (extras.includes('ativo')) {
      msg += ' Para ativar ou desativar use as operações próprias de ativação/desativação.';
    }
    throw erroValidacao(msg);
  }
}

/** Valida e normaliza o nome (trim + NFC). Nunca aceita valor inválido em silêncio. */
function validarNome(valor) {
  if (valor === undefined || valor === null) {
    throw erroValidacao('Nome do material é obrigatório.');
  }
  if (typeof valor !== 'string') {
    throw erroValidacao('Nome do material deve ser um texto.');
  }
  const nome = valor.trim().normalize('NFC');
  if (nome === '') {
    throw erroValidacao('Nome do material não pode ser vazio (nem conter somente espaços).');
  }
  if (nome.length > NOME_MAX) {
    throw erroValidacao(`Nome do material deve ter no máximo ${NOME_MAX} caracteres.`);
  }
  if (CARACTERES_DE_CONTROLE.test(nome)) {
    throw erroValidacao('Nome do material não pode conter caracteres de controle (quebra de linha, tabulação etc.).');
  }
  return nome;
}

/**
 * Categoria é opcional. Retorna:
 *   undefined -> não informada (na edição: manter a atual)
 *   null      -> sem categoria (null, "" ou somente espaços)
 *   string    -> categoria normalizada (trim + NFC)
 */
function validarCategoria(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== 'string') {
    throw erroValidacao('Categoria do material deve ser um texto (ou vazia).');
  }
  const categoria = valor.trim().normalize('NFC');
  if (categoria === '') return null;
  if (categoria.length > CATEGORIA_MAX) {
    throw erroValidacao(`Categoria do material deve ter no máximo ${CATEGORIA_MAX} caracteres.`);
  }
  if (CARACTERES_DE_CONTROLE.test(categoria)) {
    throw erroValidacao('Categoria do material não pode conter caracteres de controle.');
  }
  return categoria;
}

// ------------------------------------------------------------
// Duplicidade
// ------------------------------------------------------------
// A regra ("Vidro" == "vidro": NFC + minúsculas pt-BR) e a mensagem
// 'Já existe um material com o nome "X".' são aplicadas pelo repository DENTRO da
// mesma transação da gravação (atomicidade), com a UNIQUE do schema (SQLite) ou o
// índice de nomes (Firestore) como barreira final — ver
// src/repositories/sqlite/SQLiteMateriaisRepository.js e
// src/repositories/firestore/FirestoreMateriaisRepository.js.

// ------------------------------------------------------------
// Consultas
// ------------------------------------------------------------

/**
 * Consulta tolerante: retorna o material ou null (inclusive para ID inválido).
 * Usada internamente e por registrosPeso. Para a API use obter(), que
 * distingue ID inválido (validação) de material inexistente.
 */
async function buscarPorId(id) {
  const repo = await repositorio();
  return materialParaApi(await repo.buscarPorId(id));
}

/** Consulta estrita por ID: ID inválido -> erro de validação; inexistente -> não encontrado. */
async function obter(id) {
  const repo = await repositorio();
  const n = exigirId(id, (v) => repo.normalizarId(v));
  const material = await repo.buscarPorId(n);
  if (!material) throw erroNaoEncontrado(`Material ${n} não encontrado.`);
  return materialParaApi(material);
}

/** Padrão: só ativos. { incluirInativos: true } -> todos (uso administrativo). Ordem: nome. */
async function listar({ incluirInativos = false } = {}) {
  if (typeof incluirInativos !== 'boolean') {
    throw erroValidacao('incluirInativos deve ser verdadeiro ou falso.');
  }
  const repo = await repositorio();
  return (await repo.listar({ incluirInativos })).map(materialParaApi);
}

/**
 * Quantidade de materiais do CADASTRO ATUAL por status (Sprint 5 — Dashboard):
 * { ativos, inativos }. Não depende de registros (um material sem nenhum
 * lançamento conta normalmente) e não recebe filtro algum: é o retrato do
 * cadastro no momento da consulta. Somente leitura.
 */
async function contarPorStatus() {
  return (await repositorio()).contarPorStatus();
}

// ------------------------------------------------------------
// Escrita
// ------------------------------------------------------------

async function criar(dados) {
  exigirObjetoComCampos(dados, CAMPOS_CRIAR);
  const nome = validarNome(dados.nome);
  const categoria = validarCategoria(dados.categoria) ?? null;
  // O repository grava (com a checagem de duplicidade na mesma transação) e
  // devolve o material RELIDO do banco (confirma a persistência).
  const repo = await repositorio();
  return materialParaApi(await repo.criar({ nome, categoria }));
}

/**
 * Edita nome e/ou categoria. Campo ausente (undefined) = manter o atual.
 * categoria null/""/espaços = remove a categoria. nome nunca pode ser vazio.
 * O ID, criado_em, o status ativo e os registros de peso NÃO são tocados
 * (os registros referenciam o materialId, que não muda).
 */
async function atualizar(id, dados = {}) {
  const repo = await repositorio();
  const idValido = exigirId(id, (v) => repo.normalizarId(v));
  await obter(idValido);

  exigirObjetoComCampos(dados, CAMPOS_EDITAVEIS);
  if (dados.nome === undefined && dados.categoria === undefined) {
    throw erroValidacao('Informe ao menos um campo para editar: nome ou categoria.');
  }
  const campos = {};
  if (dados.nome !== undefined) campos.nome = validarNome(dados.nome);
  if (dados.categoria !== undefined) campos.categoria = validarCategoria(dados.categoria);
  return materialParaApi(await repo.atualizar(idValido, campos));
}

/**
 * Ativar/desativar é idempotente: se o material já está no estado pedido,
 * nada é gravado (atualizado_em não muda) e o material atual é retornado.
 * Desativar NÃO exclui nada nem toca nos registros de peso.
 */
async function setAtivo(id, ativo) {
  const existente = await obter(id);
  const repo = await repositorio();
  return materialParaApi(await repo.definirAtivo(existente.id, ativo));
}

const ativar = (id) => setAtivo(id, true);
const desativar = (id) => setAtivo(id, false);

module.exports = {
  criar,
  buscarPorId,
  // Regra ÚNICA de ID de material (inteiro positivo; texto só com dígitos).
  // Exposta para que registrosPeso valide materialId sem duplicar a regra.
  normalizarId,
  obter,
  listar,
  contarPorStatus,
  atualizar,
  ativar,
  desativar,
  limites: { NOME_MAX, CATEGORIA_MAX },
};
