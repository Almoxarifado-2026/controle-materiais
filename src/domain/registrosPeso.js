'use strict';

const { obterRepositorios } = require('../repositories/provedor');
const { resolverFiltro } = require('../filters/filterBuilder');
const { registroParaApi, totaisParaApi } = require('./formatoApi');
const { validarData } = require('../utils/datas');
const { erroValidacao, erroMaterialInexistente, erroMaterialInativo } = require('./erros');

// ============================================================
// Domínio: Registros de Peso (Sprint 3 — Lançamento de Pesos;
// Sprint 4 — Histórico + Filtros: historico(), somente leitura).
//
// - Histórico permanente: propositalmente NÃO existe função de
//   exclusão nesta camada. Nenhuma rotina apaga registros por idade
//   (nem por qualquer outro critério).
// - Unidade fixa: KG. Nenhuma conversão de unidade é feita.
// - TODA regra de validação do lançamento vive neste arquivo (fonte
//   única); o servidor HTTP só repassa a entrada e traduz o erro.
// - O material vem do cadastro dinâmico (MateriaisRepository ativo; sem lista fixa).
// - A data é validada por src/utils/datas.js (única validação de data).
// - Integração dos repositories: este módulo NÃO acessa banco. Gravação,
//   transação, releitura de confirmação e consultas são do
//   RegistrosPesoRepository ativo (src/repositories/provedor.js). Aqui ficam as
//   regras de negócio (campos aceitos, validação, mensagens, material
//   existente/ativo) e o período padrão do histórico. Operações assíncronas.
//   Retorno no formato da v1.10.0 (snake_case): formatoApi.js.
//
// Precisão do peso (verificada por experimento no SQLite — ver README):
//   peso_kg é REAL = IEEE-754 de 64 bits, o MESMO formato do number do
//   JavaScript. O valor recebido é gravado bit a bit, sem arredondar; ao
//   reler, volta idêntico (Object.is). Nenhuma regra de casas decimais é
//   imposta. A limitação é a da própria dupla precisão (~15-17 dígitos
//   significativos): ex.: 0.1 é a aproximação binária mais próxima de 0.1.
// ============================================================

// Limite superior TÉCNICO (não é regra de negócio de casas decimais):
// sem ele, um único valor perto de 1e308 faria SUM(peso_kg) estourar para
// Infinity e, como não há exclusão de histórico, os totais ficariam
// inutilizáveis para sempre. 1e9 kg (1 milhão de toneladas por lançamento)
// está ordens de grandeza acima de qualquer lançamento real, mantém a
// resolução do double em ~1e-7 kg e mantém qualquer soma muito longe do
// estouro. Constante única: se a operação precisar de outro teto, muda aqui.
const PESO_KG_MAX = 1e9;

const CAMPOS_CRIAR = ['materialId', 'pesoKg', 'dataRecebimento', 'observacao'];

// Observação é texto livre (quebra de linha e tab são legítimos). Rejeita os
// demais caracteres de controle (inclui NUL, que trunca texto em várias
// funções do SQLite) e DEL.
// eslint-disable-next-line no-control-regex
const CONTROLE_PROIBIDO = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

async function repositorio() {
  return (await obterRepositorios()).registros;
}

// Representação segura (nunca lança) de um valor recebido, para mensagens de erro.
function mostrar(valor) {
  if (typeof valor === 'string') return JSON.stringify(valor.length > 40 ? `${valor.slice(0, 40)}…` : valor);
  if (typeof valor === 'number' || typeof valor === 'bigint' || typeof valor === 'boolean') return String(valor);
  if (valor === undefined) return 'undefined';
  return Object.prototype.toString.call(valor); // null, [object Object], [object Array], ...
}

// ------------------------------------------------------------
// Validação de entrada (nada inválido é aceito ou convertido em silêncio)
// ------------------------------------------------------------

function exigirObjetoComCampos(dados) {
  if (dados === null || typeof dados !== 'object' || Array.isArray(dados)) {
    throw erroValidacao(
      'Os dados do lançamento devem ser informados como um objeto JSON com materialId, pesoKg, dataRecebimento e, opcionalmente, observacao.'
    );
  }
  const extras = Object.keys(dados).filter((c) => !CAMPOS_CRIAR.includes(c));
  if (extras.length > 0) {
    throw erroValidacao(
      `Campo(s) não permitido(s): ${extras.join(', ')}. Campos aceitos: ${CAMPOS_CRIAR.join(', ')}.`
    );
  }
}

/** materialId: ID numérico de material (mesma regra da API de materiais). Nome NÃO é aceito. */
function validarMaterialId(valor, normalizarId) {
  if (valor === undefined || valor === null) {
    throw erroValidacao('materialId é obrigatório. Informe o ID numérico de um material cadastrado.');
  }
  const id = normalizarId(valor);
  if (id === null) {
    throw erroValidacao(
      `materialId inválido: ${mostrar(valor)}. Informe o ID (número inteiro positivo) de um material cadastrado; o nome do material não é aceito.`
    );
  }
  return id;
}

/**
 * pesoKg: SOMENTE tipo number (texto como "10" ou "10abc" nunca é convertido),
 * finito, > 0 e <= PESO_KG_MAX. Não arredonda.
 */
function validarPeso(valor) {
  if (valor === undefined || valor === null) {
    throw erroValidacao('pesoKg é obrigatório (número em kg, maior que zero).');
  }
  if (typeof valor !== 'number') {
    throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. Deve ser um número (não texto) em kg, maior que zero.`);
  }
  if (!Number.isFinite(valor)) {
    throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. Deve ser um número finito em kg, maior que zero.`);
  }
  if (valor <= 0) {
    throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. Deve ser maior que zero.`);
  }
  if (valor > PESO_KG_MAX) {
    throw erroValidacao(`pesoKg inválido: ${mostrar(valor)}. O máximo por lançamento é ${PESO_KG_MAX} kg.`);
  }
  return valor;
}

/**
 * Usa a validação ÚNICA de datas (src/utils/datas.js) para toda a regra de calendário;
 * aqui só se converte o erro para erro de domínio.
 * Guarda de tipo: para valor NÃO textual, a mensagem de validarData() faz
 * JSON.stringify(valor), que lança TypeError com BigInt ou objeto circular
 * (achado real deste Sprint). Por isso o valor não textual é rejeitado aqui, com a
 * mesma mensagem, antes de chegar lá. A validação de calendário continua só em datas.js.
 */
function validarDataRecebimento(valor) {
  if (typeof valor !== 'string') {
    throw erroValidacao(
      `data_recebimento inválida: deve ser um texto no formato YYYY-MM-DD. Valor recebido: ${mostrar(valor)}. Use uma data real no formato YYYY-MM-DD.`
    );
  }
  try {
    return validarData(valor, 'data_recebimento');
  } catch (err) {
    throw erroValidacao(err.message);
  }
}

/**
 * observacao é opcional. undefined/null/""/somente espaços -> null.
 * Se informada, deve ser texto (número, booleano, objeto e array são
 * rejeitados — o SQLite converteria um número para "123.0" em silêncio).
 * Espaços externos são removidos e o texto é normalizado para Unicode NFC.
 * Sem limite próprio de tamanho (o limite prático é o do corpo HTTP).
 */
function validarObservacao(valor) {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') {
    throw erroValidacao(`observacao deve ser um texto (ou ficar em branco). Recebido: ${mostrar(valor)}.`);
  }
  if (!valor.isWellFormed()) {
    // Surrogate isolado seria trocado por U+FFFD pelo SQLite (alteração silenciosa).
    throw erroValidacao('observacao contém texto Unicode inválido (surrogate isolado).');
  }
  const texto = valor.trim().normalize('NFC');
  if (CONTROLE_PROIBIDO.test(texto)) {
    throw erroValidacao('observacao não pode conter caracteres de controle (exceto quebra de linha e tab).');
  }
  return texto === '' ? null : texto;
}

// ------------------------------------------------------------
// Escrita
// ------------------------------------------------------------

/**
 * Regra de negócio do material do lançamento, executada pelo repository DENTRO
 * da transação da gravação (mesma atomicidade de antes): inexistente ou inativo
 * -> o lançamento é recusado e nada é gravado. Não cria nem reativa material.
 */
function exigirMaterialLancavel(materialId) {
  return (material) => {
    if (!material) {
      throw erroMaterialInexistente(
        `Material ${materialId} não encontrado. Cadastre o material antes de lançar peso; o lançamento não cria material.`
      );
    }
    if (!material.ativo) {
      throw erroMaterialInativo(
        `Material "${material.nome}" está inativo e não pode receber novos lançamentos. Reative o material para lançar peso.`
      );
    }
  };
}

/**
 * Cria um lançamento de peso. Entrada: { materialId, pesoKg, dataRecebimento, observacao? }.
 *
 * Ordem: valida a FORMA de todos os campos (sem tocar no banco) -> o repository,
 * numa transação, confere o material (existe? ativo? — regra acima) -> grava ->
 * confere a gravação -> RELÊ o registro e compara campo a campo com o enviado.
 * Qualquer divergência lança erro e a transação é desfeita (nada fica gravado).
 */
async function criar(dados) {
  exigirObjetoComCampos(dados);
  const repos = await obterRepositorios();
  const materialId = validarMaterialId(dados.materialId, (v) => repos.materiais.normalizarId(v));
  const pesoKg = validarPeso(dados.pesoKg);
  const dataRecebimento = validarDataRecebimento(dados.dataRecebimento);
  const observacao = validarObservacao(dados.observacao);

  const registro = await repos.registros.criar(
    { materialId, pesoKg, dataRecebimento, observacao },
    { validarMaterial: exigirMaterialLancavel(materialId) }
  );
  return registroParaApi(registro);
}

/** Registro (com nome e categoria ATUAIS do material) ou null. */
async function buscarPorId(id) {
  return registroParaApi(await (await repositorio()).buscarPorId(id));
}

/**
 * Lista registros aplicando o filtro informado (sem período padrão: sem data =
 * todos os registros). Ordem: data de recebimento DESC e, no empate, o
 * lançamento mais recente primeiro. Somente leitura.
 *
 * filtro: { materialId, categoria, dataInicial, dataFinal }
 */
async function listar(filtro = {}) {
  return (await (await repositorio()).listar(filtro)).map(registroParaApi);
}

/** Totais agregados para o filtro informado: { quantidade_registros, total_kg, media_kg }. */
async function totais(filtro = {}) {
  return totaisParaApi(await (await repositorio()).totais(filtro));
}

/**
 * Histórico (Sprint 4): consulta os lançamentos com filtros combináveis
 * (materialId, categoria, dataInicial, dataFinal) e devolve a estrutura
 * { filtroAplicado, totais, registros }.
 *
 * - Somente LEITURA: nada é gravado, alterado ou apagado.
 * - Validação e período padrão: os do filtro centralizado (resolverFiltro, a MESMA
 *   função usada pelo Dashboard) — materialId inválido, data inválida/inexistente e
 *   dataInicial > dataFinal são ErroDominio VALIDACAO. Se NENHUMA data foi informada,
 *   usa o mês atual (periodoMesAtual), calculado a cada chamada e nunca persistido.
 * - listar() e totais() continuam sem período padrão (sem data = todos os registros).
 * - totais e registros vêm de UMA operação do repository (consultarHistorico), que os
 *   lê do MESMO conjunto filtrado (no SQLite, numa única transação de leitura).
 *
 * `dataReferencia` (opcional) só existe para testar a virada de mês de forma determinística.
 */
async function historico(entrada = {}, { dataReferencia = new Date() } = {}) {
  const repos = await obterRepositorios();
  const filtro = resolverFiltro(entrada, { dataReferencia, normalizarId: (v) => repos.materiais.normalizarId(v) });
  const { totais: t, registros } = await repos.registros.consultarHistorico(filtro);
  return { filtroAplicado: filtro, totais: totaisParaApi(t), registros: registros.map(registroParaApi) };
}

module.exports = { criar, buscarPorId, listar, totais, historico, limites: { PESO_KG_MAX } };
