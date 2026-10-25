// Gráficos: desenha pizza e barras a partir de GET /api/graficos (sem recalcular a distribuição).
import { ErroApi, MSG_RESPOSTA } from '../api.mjs';
import { barrasValidas, htmlBarras, legendaPizza, pizzaValida, svgPizza } from '../charts.mjs';
import { htmlVazio, montarTelaComFiltros } from './comum.mjs';

export function templateGraficos(resposta) {
  if (!resposta || !Array.isArray(resposta.pizza) || !Array.isArray(resposta.barras)) {
    throw new ErroApi(MSG_RESPOSTA, { tipo: 'resposta' });
  }
  if (!pizzaValida(resposta.pizza) || !barrasValidas(resposta.barras)) {
    throw new ErroApi('Os dados dos gráficos recebidos do servidor são inválidos e não foram exibidos.', { tipo: 'resposta' });
  }
  if (resposta.pizza.length === 0 && resposta.barras.length === 0) {
    return htmlVazio('Nenhum dado para exibir nos gráficos', 'Não há pesagens para os filtros e o período selecionados.');
  }
  return `<div class="graficos-grade">
    <section class="painel" data-grafico="pizza" aria-labelledby="t-pizza">
      <h2 class="painel-titulo" id="t-pizza">Distribuição do peso por material</h2>
      <div class="pizza-area">${svgPizza(resposta.pizza)}${legendaPizza(resposta.pizza)}</div>
    </section>
    <section class="painel" data-grafico="barras" aria-labelledby="t-barras">
      <h2 class="painel-titulo" id="t-barras">Peso total por material</h2>
      ${htmlBarras(resposta.barras)}
    </section>
  </div>`;
}

export function montar({ raiz, api, ativa }) {
  return montarTelaComFiltros({
    raiz, api, ativa,
    titulo: 'Gráficos',
    subtitulo: 'Pizza e barras calculadas pelo sistema a partir das pesagens reais.',
    comVisao: true, // Sprint 10: mesma visão temporal do Dashboard (dia/semana/mês/ano/personalizado)
    buscar: (cliente, filtros, visao) => cliente.graficos(filtros, { visao }),
    desenhar: templateGraficos,
  });
}
