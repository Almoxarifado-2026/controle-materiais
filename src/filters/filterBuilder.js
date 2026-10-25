'use strict';

// ============================================================
// Construtor de filtros centralizado.
//
// Decisão de arquitetura: histórico, dashboard, gráficos,
// relatórios e PDF (Sprints futuros) devem todos consumir esta
// MESMA função para montar a cláusula WHERE. Isso garante que o
// mesmo conjunto de filtros produza sempre o mesmo resultado,
// não importa qual módulo o utiliza — requisito explícito do
// Sprint 1.
//
// Validação (Sprint 4 — Histórico + Filtros): TODA a validação de entrada dos
// filtros vive em normalizarFiltro(), usada por construirFiltro() — logo por
// listar(), totais() e historico() e por qualquer módulo futuro:
//   - materialId: regra de ID do repository ativo (opção normalizarId); padrão =
//     regra única de ID de material (src/domain/regrasId.js, a mesma de materiais.normalizarId).
//     Inteiro positivo; texto só com dígitos (vindo da URL) é aceito; qualquer
//     outra coisa ("abc", "1.5", "0x1", "1e3", array...) é REJEITADA — nunca
//     vira consulta vazia nem é convertida em silêncio. Nome de material NÃO é aceito.
//   - categoria: texto; comparação exata (binária) com o valor armazenado — ver P3
//     no README/relatório. Não é normalizada aqui.
//   - dataInicial / dataFinal: validadas por src/utils/datas.js (a MESMA validação
//     de data_recebimento); datas inexistentes (ex.: 2026-02-31) são rejeitadas.
//   - dataInicial > dataFinal é REJEITADO (antes virava consulta vazia — P2). As
//     datas já validadas têm largura fixa (YYYY-MM-DD), então a comparação de
//     texto é cronológica; nenhum objeto Date é criado.
//   Valor ausente = undefined, null ou "" (filtro não informado).
//   Falhas são ErroDominio de código VALIDACAO (o servidor traduz para 400).
//
// Contrato:
//   normalizarFiltro({ materialId, categoria, dataInicial, dataFinal })
//   -> { materialId?, categoria?, dataInicial?, dataFinal? }  (só as chaves informadas;
//      materialId sempre como número)
//   construirFiltro({ materialId, categoria, dataInicial, dataFinal })
//   -> { whereClause: string, params: any[] }
//
// A cláusula é montada com placeholders parametrizados (?) para
// evitar SQL injection — nunca concatena valores diretamente.
// Pressupõe que a query principal já faz JOIN materiais AS m
// (necessário para filtrar por categoria).
// ============================================================

const { validarData } = require('../utils/datas');
const { normalizarIdMaterial } = require('../domain/regrasId');
const { erroValidacao } = require('../domain/erros');

const ausente = (valor) => valor === undefined || valor === null || valor === '';

// Representação segura (nunca lança) de um valor recebido, para mensagens de erro.
function mostrar(valor) {
  if (typeof valor === 'string') return JSON.stringify(valor.length > 40 ? `${valor.slice(0, 40)}…` : valor);
  if (typeof valor === 'number' || typeof valor === 'bigint' || typeof valor === 'boolean') return String(valor);
  if (valor === undefined) return 'undefined';
  return Object.prototype.toString.call(valor); // null, [object Object], [object Array], ...
}

function normalizarFiltro(entrada = {}, { normalizarId = normalizarIdMaterial } = {}) {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    throw erroValidacao('Os filtros devem ser informados como um objeto (materialId, categoria, dataInicial, dataFinal).');
  }
  const { materialId, categoria, dataInicial, dataFinal } = entrada;
  const filtro = {};

  if (!ausente(materialId)) {
    const id = normalizarId(materialId);
    if (id === null) {
      throw erroValidacao(
        `materialId inválido: ${mostrar(materialId)}. Informe o ID (número inteiro positivo) de um material cadastrado; o nome do material não é aceito.`
      );
    }
    filtro.materialId = id;
  }

  if (!ausente(categoria)) {
    if (typeof categoria !== 'string') {
      throw erroValidacao(`categoria inválida: deve ser um texto. Valor recebido: ${mostrar(categoria)}.`);
    }
    filtro.categoria = categoria;
  }

  for (const [campo, valor] of [['dataInicial', dataInicial], ['dataFinal', dataFinal]]) {
    if (ausente(valor)) continue;
    // Guarda de tipo: a mensagem de validarData() faz JSON.stringify(valor), que lança
    // TypeError com BigInt/objeto circular (P4). Valor não textual é rejeitado aqui,
    // com a mesma mensagem; a validação de calendário continua SÓ em datas.js.
    if (typeof valor !== 'string') {
      throw erroValidacao(
        `${campo} inválida: deve ser um texto no formato YYYY-MM-DD. Valor recebido: ${mostrar(valor)}. Use uma data real no formato YYYY-MM-DD.`
      );
    }
    try {
      validarData(valor, campo);
    } catch (err) {
      throw erroValidacao(err.message);
    }
    filtro[campo] = valor;
  }

  if (filtro.dataInicial !== undefined && filtro.dataFinal !== undefined && filtro.dataInicial > filtro.dataFinal) {
    throw erroValidacao(
      `Período inválido: dataInicial (${filtro.dataInicial}) é posterior a dataFinal (${filtro.dataFinal}). Informe dataInicial menor ou igual a dataFinal.`
    );
  }

  return filtro;
}

function construirFiltro(entrada = {}) {
  const filtro = normalizarFiltro(entrada);
  const condicoes = [];
  const params = [];

  if (filtro.materialId !== undefined) {
    condicoes.push('r.material_id = ?');
    params.push(filtro.materialId);
  }

  if (filtro.categoria !== undefined) {
    condicoes.push('m.categoria = ?');
    params.push(filtro.categoria);
  }

  if (filtro.dataInicial !== undefined) {
    condicoes.push('r.data_recebimento >= ?');
    params.push(filtro.dataInicial);
  }

  if (filtro.dataFinal !== undefined) {
    condicoes.push('r.data_recebimento <= ?');
    params.push(filtro.dataFinal);
  }

  const whereClause = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
  return { whereClause, params };
}

/**
 * Retorna o intervalo (dataInicial, dataFinal) do mês atual, no
 * formato YYYY-MM-DD. Usado pelo Histórico (registrosPeso.historico) e
 * pelo Dashboard (dashboard.consultar), via resolverFiltro(), para abrir
 * sempre no mês corrente sem persistir esse filtro em lugar algum — é
 * calculado em tempo de consulta, a cada acesso. É a ÚNICA definição de
 * "mês atual" do sistema.
 */
function periodoMesAtual(dataReferencia = new Date()) {
  const ano = dataReferencia.getFullYear();
  const mes = dataReferencia.getMonth(); // 0-based
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);

  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  return { dataInicial: fmt(primeiroDia), dataFinal: fmt(ultimoDia) };
}

/**
 * Filtro RESOLVIDO para uma consulta (Sprint 5): valida/normaliza a entrada
 * (normalizarFiltro) e aplica o período padrão — se NENHUMA data foi informada,
 * usa o mês atual (periodoMesAtual); se qualquer data foi informada, o período é
 * exatamente o informado (só dataInicial = dali em diante; só dataFinal = até ali).
 *
 * É a ÚNICA implementação da regra "sem data = mês atual": Histórico e Dashboard
 * chamam esta função, então o mesmo pedido produz sempre o mesmo filtroAplicado.
 * Calculado a cada chamada; nada é persistido. `dataReferencia` (opcional) existe
 * só para testar a virada de mês de forma determinística.
 */
function resolverFiltro(entrada = {}, { dataReferencia = new Date(), normalizarId } = {}) {
  const filtro = normalizarFiltro(entrada, normalizarId ? { normalizarId } : {});
  if (filtro.dataInicial === undefined && filtro.dataFinal === undefined) {
    Object.assign(filtro, periodoMesAtual(dataReferencia));
  }
  return filtro;
}

// ============================================================
// Visão temporal (Sprint 10 — Dashboard Temporal + Gráficos Avançados).
//
// periodoMesAtual() (acima) já era a ÚNICA definição de "mês atual" do
// sistema, usada por resolverFiltro(). As funções abaixo estendem a MESMA
// ideia — um período padrão calculado em tempo de consulta, nunca
// persistido — para outras quatro visões (dia, semana, ano; "personalizado"
// não tem período próprio: é sempre a data informada pelo usuário, e sem
// nenhuma data cai no mesmo "mês atual" de sempre). getMonth()/getDate()
// continuam existindo SÓ neste arquivo (mesma regra do Sprint 5).
// ============================================================

const VISOES_VALIDAS = ['dia', 'semana', 'mes', 'ano', 'personalizado'];

/** visao ausente/vazia -> 'mes' (o padrão de sempre, sem mudança de comportamento). */
function normalizarVisao(visao) {
  if (visao === undefined || visao === null || visao === '') return 'mes';
  if (typeof visao !== 'string' || !VISOES_VALIDAS.includes(visao)) {
    throw erroValidacao(`visao inválida: ${mostrar(visao)}. Use um dos valores: ${VISOES_VALIDAS.join(', ')}.`);
  }
  return visao;
}

const fmtDataLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Dia de hoje (dataReferencia), início = fim. Sem hora: o banco só guarda data (schema.sql). */
function periodoDia(dataReferencia = new Date()) {
  const s = fmtDataLocal(dataReferencia);
  return { dataInicial: s, dataFinal: s };
}

/** Semana de segunda a domingo que contém dataReferencia (ISO: a semana começa na segunda-feira). */
function periodoSemana(dataReferencia = new Date()) {
  const diaSemana = dataReferencia.getDay(); // 0 = domingo ... 6 = sábado
  const deslocamentoAteSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
  const segunda = new Date(dataReferencia.getFullYear(), dataReferencia.getMonth(), dataReferencia.getDate() + deslocamentoAteSegunda);
  const domingo = new Date(segunda.getFullYear(), segunda.getMonth(), segunda.getDate() + 6);
  return { dataInicial: fmtDataLocal(segunda), dataFinal: fmtDataLocal(domingo) };
}

/** Ano corrente (1º de janeiro a 31 de dezembro do ano de dataReferencia). */
function periodoAno(dataReferencia = new Date()) {
  const ano = dataReferencia.getFullYear();
  return { dataInicial: `${ano}-01-01`, dataFinal: `${ano}-12-31` };
}

/**
 * Aplica a visão temporal ao par dataInicial/dataFinal vindo da requisição
 * (Sprint 10 — Dashboard e Gráficos). NÃO valida formato de data (quem valida
 * continua sendo normalizarFiltro/construirFiltro, chamados depois, como
 * sempre): só decide QUAL par dataInicial/dataFinal segue adiante.
 *
 * Regra (única, usada pelas rotas /api/dashboard, /api/graficos e
 * /api/dashboard/evolucao — nenhuma reimplementa isto):
 *   - se dataInicial OU dataFinal já vieram preenchidas, elas SEMPRE vencem:
 *     devolvidas exatamente como vieram (o filtro explícito do usuário nunca
 *     é substituído pela visão, com ou sem visão selecionada);
 *   - só quando as DUAS vierem ausentes/vazias é que o período padrão da
 *     visão é calculado: dia -> periodoDia, semana -> periodoSemana,
 *     ano -> periodoAno, mes/personalizado -> periodoMesAtual (mesmo padrão
 *     de sempre; "personalizado" sem nenhuma data não tem período próprio).
 * Devolve { dataInicial, dataFinal, visao } — visao sempre normalizada.
 */
function aplicarVisaoPadrao({ dataInicial, dataFinal, visao } = {}, { dataReferencia = new Date() } = {}) {
  const visaoNormalizada = normalizarVisao(visao);
  const ausente = (v) => v === undefined || v === null || v === '';
  if (!ausente(dataInicial) || !ausente(dataFinal)) {
    return { dataInicial, dataFinal, visao: visaoNormalizada };
  }
  const periodo =
    visaoNormalizada === 'dia' ? periodoDia(dataReferencia)
    : visaoNormalizada === 'semana' ? periodoSemana(dataReferencia)
    : visaoNormalizada === 'ano' ? periodoAno(dataReferencia)
    : periodoMesAtual(dataReferencia);
  return { ...periodo, visao: visaoNormalizada };
}

module.exports = {
  construirFiltro,
  normalizarFiltro,
  periodoMesAtual,
  resolverFiltro,
  VISOES_VALIDAS,
  normalizarVisao,
  periodoDia,
  periodoSemana,
  periodoAno,
  aplicarVisaoPadrao,
};
