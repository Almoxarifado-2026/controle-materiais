// ============================================================
// Relatórios (Sprint 7): apresenta GET /api/registros (mesma API do Histórico) com
// identificação clara dos filtros aplicados, resumo e tabela — pronto para impressão
// nativa do navegador ("Imprimir" -> "Salvar como PDF"). Nenhuma regra de negócio é
// duplicada aqui: totais, ordenação e período padrão (mês atual) continuam vindo do
// backend, exatamente como no Histórico. Não existe biblioteca de PDF: a "geração de
// PDF" é o mecanismo nativo do navegador (window.print()) sobre o CSS de impressão em
// public/css/app.css (@media print, escopado à tela de Relatórios).
// Os filtros do relatório são os mesmos do resto da interface (public/js/filtros.mjs):
// só em memória, nunca gravados — recarregar a página volta ao mês atual do backend.
// ============================================================

import { ErroApi, MSG_RESPOSTA } from '../api.mjs';
import { esc, formatarData } from '../format.mjs';
import { htmlVazio, montarTelaComFiltros } from './comum.mjs';
import { htmlTabelaRegistros, htmlTotaisHistorico } from './historico.mjs';

/**
 * Bloco de identificação do relatório: nome do sistema, título, data/hora de geração
 * e os filtros efetivamente usados — cada campo mostrado explicitamente, com "Todos"/
 * "Todas"/"Não informado" quando não preenchido (nunca um valor inventado). O nome do
 * material vem da lista de materiais já carregada pela tela (mesma lista do "Período
 * aplicado" do restante da interface); o período efetivo é o que o BACKEND devolveu em
 * filtroAplicado (o frontend não calcula "mês atual").
 */
export function htmlIdentificacaoRelatorio(filtroAplicado, filtrosEnviados, materiais) {
  const ap = filtroAplicado && typeof filtroAplicado === 'object' ? filtroAplicado : {};
  const enviados = filtrosEnviados && typeof filtrosEnviados === 'object' ? filtrosEnviados : {};
  const listaMateriais = Array.isArray(materiais) ? materiais : [];

  const gerado = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date());

  let material = 'Todos os materiais';
  if (ap.materialId !== undefined) {
    const m = listaMateriais.find((x) => x.id === ap.materialId);
    material = m ? m.nome : `Material nº ${ap.materialId}`;
  }
  const categoria = typeof ap.categoria === 'string' ? ap.categoria : 'Todas as categorias';

  const diInformada = typeof enviados.dataInicial === 'string' && enviados.dataInicial !== '';
  const dfInformada = typeof enviados.dataFinal === 'string' && enviados.dataFinal !== '';
  const dataInicial = diInformada ? formatarData(enviados.dataInicial) : 'Não informado';
  const dataFinal = dfInformada ? formatarData(enviados.dataFinal) : 'Não informado';

  const periodoAplicado = ap.dataInicial && ap.dataFinal ? `${formatarData(ap.dataInicial)} a ${formatarData(ap.dataFinal)}` : 'sem limite de datas';
  const periodoPadrao = !diInformada && !dfInformada;

  return `<div class="relatorio-identificacao">
    <p class="relatorio-marca">Controle de Materiais — Reciclagem e Separação</p>
    <h2 class="relatorio-titulo">Relatório de Pesagens</h2>
    <p class="relatorio-gerado">Gerado em ${esc(gerado)}</p>
    <dl class="relatorio-filtros" data-relatorio="filtros">
      <div><dt>Material</dt><dd>${esc(material)}</dd></div>
      <div><dt>Categoria</dt><dd>${esc(categoria)}</dd></div>
      <div><dt>Data inicial</dt><dd>${esc(dataInicial)}</dd></div>
      <div><dt>Data final</dt><dd>${esc(dataFinal)}</dd></div>
      <div><dt>Período aplicado</dt><dd>${esc(periodoAplicado)}${periodoPadrao ? ' <span class="periodo-padrao">(mês atual — período padrão)</span>' : ''}</dd></div>
    </dl>
  </div>`;
}

/** Template puro: identificação + resumo + tabela (ou estado vazio), a partir da resposta REAL de GET /api/registros. */
export function templateRelatorio(resposta, filtrosEnviados, materiais) {
  if (!resposta || !Array.isArray(resposta.registros) || !resposta.totais || typeof resposta.totais !== 'object') {
    throw new ErroApi(MSG_RESPOSTA, { tipo: 'resposta' });
  }
  const identificacao = htmlIdentificacaoRelatorio(resposta.filtroAplicado, filtrosEnviados, materiais);
  const acoes = `<div class="relatorio-acoes no-print">
    <button type="button" class="btn btn-primario" data-acao="imprimir">Imprimir / Salvar como PDF</button>
  </div>`;
  if (resposta.registros.length === 0) {
    return `${identificacao}${acoes}${htmlVazio('Nenhum registro encontrado', 'Nenhum registro encontrado para os filtros selecionados.')}`;
  }
  return `${identificacao}${acoes}${htmlTotaisHistorico(resposta.totais)}${htmlTabelaRegistros(resposta.registros)}`;
}

export function montar({ raiz, api, ativa }) {
  // Ação própria desta tela (imprimir): não altera o listener genérico de comum.mjs,
  // que já cuida de "limpar-filtros" e "tentar-novamente" para todas as telas filtradas.
  raiz.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-acao="imprimir"]');
    if (alvo) window.print();
  });
  return montarTelaComFiltros({
    raiz, api, ativa,
    titulo: 'Relatórios',
    subtitulo: 'Relatório de pesagens para impressão ou PDF, com os mesmos filtros e dados do Histórico.',
    buscar: (cliente, filtros) => cliente.registros(filtros),
    desenhar: (resposta, filtrosEnviados, materiais) => templateRelatorio(resposta, filtrosEnviados, materiais),
  });
}
