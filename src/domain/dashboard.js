'use strict';

const { obterRepositorios } = require('../repositories/provedor');
const { resolverFiltro } = require('../filters/filterBuilder');

// ============================================================
// Domínio: Dashboard (Sprint 5) — indicadores resumidos, SOMENTE leitura.
//
// Princípios (Sprint 5):
// - UMA fonte de dados: as mesmas tabelas do histórico (registros_peso +
//   materiais). Nada é armazenado, cacheado nem simulado: cada consulta
//   recalcula tudo. Nenhum indicador é gravado como dado permanente.
// - UMA lógica de filtros: resolverFiltro() (validação + período padrão =
//   mês atual) e construirFiltro() (WHERE parametrizado) — as MESMAS funções
//   do histórico. Nenhuma validação ou SQL de filtro é reimplementado aqui.
// - Indicadores dos REGISTROS (respeitam os filtros; unidade: KG):
//     totalRegistros, totalKg, mediaKg  -> registrosPeso.totais(filtro)
//     materiaisEnvolvidos               -> COUNT(DISTINCT material_id) do mesmo filtro
//   Total, quantidade e média vêm da MESMA agregação do histórico (SUM/COUNT/AVG
//   do SQLite), não são recalculados no cliente. Sem registros: 0/0/0 (nunca
//   NaN, Infinity ou undefined).
// - Indicadores do CADASTRO (NÃO respeitam filtro algum — são o retrato do
//   cadastro atual de materiais no momento da consulta):
//     materiaisAtivos, materiaisInativos -> materiais.contarPorStatus()
//   Um material sem nenhum lançamento é contado normalmente; o status ativo
//   NÃO é deduzido dos registros históricos.
// - Material inativo NÃO é escondido: seus registros históricos entram nos
//   indicadores (não há filtro por ativo em nenhuma consulta).
// - Desempenho: 3 consultas agregadas, número FIXO (não cresce com a
//   quantidade de materiais ou registros): sem N+1, sem consulta por material.
//   (Onde elas rodam e como a consistência é mantida: ver bloco abaixo.)
// ============================================================

// ------------------------------------------------------------
// Integração dos repositories: este módulo NÃO acessa banco.
//  - indicadores dos REGISTROS -> RegistrosPesoRepository.consultarIndicadores(filtro)
//    (total, quantidade, média e materiais distintos do MESMO conjunto; no SQLite, 2
//    consultas agregadas numa única transação de leitura — mesmas do legado);
//  - indicadores do CADASTRO   -> MateriaisRepository.contarPorStatus() (1 consulta).
// Número de consultas continua FIXO (3), sem N+1.
//
// Consistência entre as duas partes: são disparadas JUNTAS (Promise.all). No SQLite o
// corpo dos dois métodos é síncrono (better-sqlite3), então os dois executam um logo
// após o outro, no MESMO tique do event loop, sem que nenhuma outra requisição (escrita)
// possa ser atendida entre eles — o retrato é o mesmo do banco. No Firestore são duas
// leituras de rede independentes (ver riscos no relatório da Sprint).
// ------------------------------------------------------------

/**
 * Indicadores do Dashboard para o filtro informado.
 *
 * entrada: { materialId, categoria, dataInicial, dataFinal } (valores de query string
 * são aceitos; a validação é a do filtro centralizado — falhas são ErroDominio VALIDACAO).
 * Sem nenhuma data -> mês atual (calculado a cada consulta, nunca persistido).
 *
 * Retorna { filtroAplicado, indicadores: { totalRegistros, totalKg, mediaKg,
 * materiaisEnvolvidos, materiaisAtivos, materiaisInativos } }.
 *
 * `dataReferencia` (opcional) só existe para testar a virada de mês de forma determinística.
 */
async function consultar(entrada = {}, { dataReferencia = new Date() } = {}) {
  const repos = await obterRepositorios();
  const filtro = resolverFiltro(entrada, { dataReferencia, normalizarId: (v) => repos.materiais.normalizarId(v) });
  const [ind, cadastro] = await Promise.all([
    repos.registros.consultarIndicadores(filtro),
    repos.materiais.contarPorStatus(),
  ]);
  return {
    filtroAplicado: filtro,
    indicadores: {
      totalRegistros: ind.quantidadeRegistros,
      totalKg: ind.totalKg,
      mediaKg: ind.mediaKg,
      materiaisEnvolvidos: ind.materiaisEnvolvidos,
      materiaisAtivos: cadastro.ativos,
      materiaisInativos: cadastro.inativos,
    },
  };
}

module.exports = { consultar };
