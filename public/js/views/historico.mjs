// Histórico: apresenta GET /api/registros (linhas e totais), exatamente como o backend devolve.
// O filtro é do backend: nenhuma filtragem/soma/ordenação é refeita aqui.
import { ErroApi, MSG_RESPOSTA } from '../api.mjs';
import { formatarData, formatarInteiro, formatarKg, texto } from '../format.mjs';
import { htmlVazio, montarTelaComFiltros } from './comum.mjs';

/** Template puro da tabela de registros (usado também na tela de lançamento). */
export function htmlTabelaRegistros(registros) {
  const linhas = registros
    .map((r) => `<tr>
      <td data-label="Data" class="data">${formatarData(r.data_recebimento)}</td>
      <td data-label="Material">${texto(r.material_nome)}</td>
      <td data-label="Categoria">${texto(r.material_categoria)}</td>
      <td data-label="Peso" class="num">${formatarKg(r.peso_kg)}</td>
      <td data-label="Observação" class="obs">${texto(r.observacao)}</td>
    </tr>`)
    .join('');
  return `<div class="tabela-area"><table class="tabela tabela-empilhavel" data-tabela="registros">
    <thead><tr><th scope="col">Data</th><th scope="col">Material</th><th scope="col">Categoria</th><th scope="col" class="num">Peso</th><th scope="col">Observação</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

export function htmlTotaisHistorico(totais) {
  return `<div class="cartoes cartoes-3">
    <div class="cartao"><span class="cartao-rotulo">Lançamentos</span><span class="cartao-valor">${formatarInteiro(totais.quantidade_registros)}</span></div>
    <div class="cartao"><span class="cartao-rotulo">Total de peso</span><span class="cartao-valor">${formatarKg(totais.total_kg)}</span></div>
    <div class="cartao"><span class="cartao-rotulo">Média por lançamento</span><span class="cartao-valor">${formatarKg(totais.media_kg)}</span></div>
  </div>`;
}

export function templateHistorico(resposta) {
  if (!resposta || !Array.isArray(resposta.registros) || !resposta.totais || typeof resposta.totais !== 'object') {
    throw new ErroApi(MSG_RESPOSTA, { tipo: 'resposta' });
  }
  if (resposta.registros.length === 0) {
    return `${htmlTotaisHistorico(resposta.totais)}${htmlVazio('Nenhum lançamento encontrado', 'Não há pesagens para os filtros e o período selecionados.')}`;
  }
  return `${htmlTotaisHistorico(resposta.totais)}${htmlTabelaRegistros(resposta.registros)}`;
}

export function montar({ raiz, api, ativa }) {
  return montarTelaComFiltros({
    raiz, api, ativa,
    titulo: 'Histórico',
    subtitulo: 'Todas as pesagens registradas, da mais recente para a mais antiga.',
    buscar: (cliente, filtros) => cliente.registros(filtros),
    desenhar: templateHistorico,
  });
}
