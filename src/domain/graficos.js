'use strict';

const { obterRepositorios } = require('../repositories/provedor');
const { resolverFiltro } = require('../filters/filterBuilder');

// ============================================================
// Domínio: Gráficos (Sprint 6) — DADOS dos gráficos de pizza e de barras,
// SOMENTE leitura. Não existe camada visual neste Sprint (ver README): este
// módulo entrega a estrutura real e segura que uma interface futura vai desenhar.
//
// Princípios:
// - UMA fonte de dados: as mesmas tabelas do histórico e do dashboard
//   (registros_peso + materiais). Nada é armazenado, cacheado nem simulado:
//   cada consulta recalcula tudo. Não existe arquivo/tabela de gráfico.
// - UMA lógica de filtros: resolverFiltro() (validação + período padrão = mês
//   atual) e construirFiltro() (WHERE parametrizado) — as MESMAS funções do
//   histórico e do dashboard. Nenhuma validação ou SQL de filtro é
//   reimplementado aqui.
// - Base dos gráficos: SUM(peso_kg) agrupado por material (nunca a quantidade
//   de lançamentos).
// - Material INATIVO com registros dentro do filtro APARECE (não há filtro por
//   `ativo` na consulta). Material sem registro no filtro NÃO aparece (não há
//   barra/fatia de valor zero: o JOIN parte dos registros).
// - Desempenho: UMA consulta agregada (GROUP BY material), número FIXO de
//   consultas — sem N+1, sem consulta por material.
// - Snapshot único: pizza e barras são derivadas do MESMO resultado dessa
//   consulta (mesmas linhas em memória). É impossível pizza e barras
//   descreverem estados diferentes do banco.
// - Precisão: os valores de peso NÃO são arredondados (a apresentação decide
//   as casas decimais). O percentual também não é arredondado, então a soma
//   dos percentuais é 100 a menos do erro de ponto flutuante (~1e-13).
//
// Ordenação (determinística; nome do material é UNIQUE no schema):
//   peso total DESC, nome do material ASC (comparação binária do SQLite, ou
//   seja, por bytes UTF-8, sem depender de locale), id do material ASC (só por
//   segurança). Vale para pizza e barras (mesma ordem nas duas listas).
// ============================================================

/**
 * Monta pizza e barras a partir das linhas JÁ agregadas por material
 * ([{ materialId, material, pesoKg }], já ordenadas). Função pura (sem banco),
 * exportada para permitir teste isolado das bordas numéricas.
 *
 * - Sem linhas, ou total <= 0: ambas as listas vazias (nunca NaN/Infinity).
 * - Valor de peso não finito (só possível por gravação direta no banco, fora
 *   da validação de domínio — pendência P5): lança Error interno; a API
 *   responde 500 genérico. Nunca devolve NaN/Infinity/null como dado.
 */
function montarSeries(linhas) {
  if (linhas.length === 0) return { pizza: [], barras: [] };

  let total = 0;
  for (const l of linhas) {
    if (!Number.isFinite(l.pesoKg)) {
      throw new Error('Inconsistência nos dados de peso: valor não finito encontrado no histórico.');
    }
    total += l.pesoKg;
  }
  if (!Number.isFinite(total)) {
    throw new Error('Inconsistência nos dados de peso: total não finito.');
  }
  if (total <= 0) return { pizza: [], barras: [] };

  return {
    pizza: linhas.map((l) => ({
      materialId: l.materialId,
      material: l.material,
      pesoKg: l.pesoKg,
      // pesoKg / total × 100, escrito como (pesoKg × 100) / total (mesma conta matemática, uma divisão só).
      // Sem arredondamento: o desvio de ponto flutuante da soma dos percentuais é ~1e-14 (medido, ver README).
      percentual: (l.pesoKg * 100) / total,
    })),
    barras: linhas.map((l) => ({
      materialId: l.materialId,
      material: l.material,
      pesoKg: l.pesoKg,
    })),
  };
}

// Integração dos repositories: o peso total por material (UMA consulta agregada, GROUP BY
// material, na ordem peso DESC / nome ASC por bytes / id ASC) é do
// RegistrosPesoRepository.pesoPorMaterial(filtro). Material inativo com registros entra
// normalmente (não há filtro por status). Este módulo não acessa banco.

/**
 * Dados dos gráficos para o filtro informado.
 *
 * entrada: { materialId, categoria, dataInicial, dataFinal } (valores de query string
 * são aceitos; a validação é a do filtro centralizado — falhas são ErroDominio VALIDACAO).
 * Sem nenhuma data -> mês atual (calculado a cada consulta, nunca persistido).
 *
 * Retorna { filtroAplicado, pizza, barras }:
 *   pizza:  [{ materialId, material, pesoKg, percentual }]  (percentual = pesoKg / total × 100)
 *   barras: [{ materialId, material, pesoKg }]
 *
 * `dataReferencia` (opcional) só existe para testar a virada de mês de forma determinística.
 */
async function consultar(entrada = {}, { dataReferencia = new Date() } = {}) {
  const repos = await obterRepositorios();
  const filtro = resolverFiltro(entrada, { dataReferencia, normalizarId: (v) => repos.materiais.normalizarId(v) });
  // pizza e barras saem da MESMA lista de linhas (um único resultado do repository).
  const { pizza, barras } = montarSeries(await repos.registros.pesoPorMaterial(filtro));
  return { filtroAplicado: filtro, pizza, barras };
}

module.exports = { consultar, montarSeries };
