// ============================================================
// Dashboard (redesenho no layout de referência).
//
// Fontes de dados — todas são as APIs que já existiam; NENHUM total é inventado no navegador:
//  - GET /api/dashboard           -> 5 cartões de indicadores (e, no período anterior, a comparação);
//  - GET /api/dashboard/evolucao  -> "Evolução de peso no período" (gráfico de área);
//  - GET /api/graficos            -> "Peso por material" e "Distribuição por material" (rosca);
//  - GET /api/registros           -> "Totais por categoria" e "Últimos lançamentos".
//
// Ordem das consultas:
//  1) indicadores, evolução e gráficos saem em PARALELO (Promise.allSettled). Só a falha dos
//     INDICADORES derruba a tela; falha de evolução/gráficos vira estado de erro no próprio painel.
//  2) Depois que a tela aparece, saem juntos os registros do MESMO período que o backend
//     resolveu (filtroAplicado — /api/registros não conhece "visao", então recebe as datas já
//     resolvidas) e os indicadores do período anterior (comparativo.mjs). Cada um preenche a sua
//     parte (os 2 painéis de registros / as setas de variação) assim que chega, sem esperar o outro.
//
// "Totais por categoria" agrupa por categoria as linhas que /api/registros devolveu para o
// período (o backend não tem um agrupamento por categoria); a linha "Total" usa os totais que o
// PRÓPRIO /api/registros devolveu na mesma resposta (mesmo snapshot das linhas).
// ============================================================

import { ErroApi, MSG_RESPOSTA } from '../api.mjs';
import { evolucaoValida, htmlAreaEvolucao, htmlBarrasMaterial, legendaRosca, pizzaValida, svgRosca } from '../charts.mjs';
import { periodoAnterior, variacao } from '../comparativo.mjs';
import { corMaterial, esc, formatarData, formatarInteiro, formatarKg, formatarKgResumo, formatarNumero, formatarPercentual, texto } from '../format.mjs';
import { htmlCarregando, htmlErro, htmlVazio, mensagemDe, montarTelaComFiltros } from './comum.mjs';

const MSG_EVOLUCAO_PERIODO_ABERTO = 'Para exibir a evolução temporal, informe data inicial e data final (ou nenhuma das duas).';

/**
 * true só para o erro ESPERADO da evolução: período aberto (400 — a rota GET
 * /api/dashboard/evolucao exige dataInicial e dataFinal juntas). Qualquer outro erro é
 * INESPERADO e fica visível no painel — nunca é tratado como "sem gráfico".
 */
function ehPeriodoAbertoNaEvolucao(err) {
  return err instanceof ErroApi && err.tipo === 'http' && err.status === 400 && /per[ií]odo limitado/i.test(err.message);
}

// ------------------------------------------------------------
// Ícones (SVG em traço, herdam a cor via currentColor)
// ------------------------------------------------------------
const svg = (d, classe = 'ico') => `<svg class="${classe}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
const ICONES = {
  balanca: svg('M5 20h14M7 20l1.5-11h7L17 20M9.5 9a2.5 2.5 0 0 1 5 0M10 14.5h1.2l.8 1.5.8-1.5H14'),
  peso: svg('M9 7.5a3 3 0 1 1 6 0M6.5 9h11L20 20H4zM10 13v4M10 15l2-2M10 15l2 2M14.5 13.5h1.5v3.5h-1.5'),
  media: svg('M4 19h16M6 15l4-4 3 3 5-6M14 8h4v4'),
  cubo: svg('M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9'),
  camadas: svg('M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4'),
  evolucao: svg('M3 20h18M5 16l4-5 3 3 4-6 3 4'),
  barras: svg('M5 20V11M10 20V5M15 20v-7M20 20V9', 'ico ico-cheio-traco'),
  pizza: svg('M12 3a9 9 0 1 0 9 9h-9zM14.5 2.8A9 9 0 0 1 21.2 9.5H14.5z'),
  tabela: svg('M4 5h16v14H4zM4 10h16M4 14.5h16M9.5 10v9'),
  lista: svg('M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01'),
  seta: svg('M5 12h14M13 6l6 6-6 6', 'ico-seta'),
  sobe: svg('M12 19V5M6 11l6-6 6 6', 'ico-tendencia'),
  desce: svg('M12 5v14M6 13l6 6 6-6', 'ico-tendencia'),
  igual: svg('M5 12h14M13 6l6 6-6 6', 'ico-tendencia'),
};

const ROTULO_GRANULARIDADE = { dia: 'Por dia', mes: 'Por mês', ano: 'Por ano' };

// ------------------------------------------------------------
// Cartões de indicador
// ------------------------------------------------------------
function cartao({ rotulo, valor, dica, cor, icone, chave = '' }) {
  return `<div class="cartao cartao-kpi" data-indicador="${esc(rotulo)}">
    <span class="kpi-icone kpi-${cor}">${ICONES[icone]}</span>
    <div class="kpi-corpo">
      <span class="cartao-rotulo">${esc(rotulo)}</span>
      <div class="kpi-linha">
        <span class="cartao-valor">${esc(valor)}</span>
        ${chave ? `<span class="kpi-tendencia-slot" data-tendencia="${chave}"></span>` : ''}
      </div>
      <span class="cartao-dica">${esc(dica)}</span>
    </div>
  </div>`;
}

/** HTML da seta de variação de um cartão. `estado` é o resultado de variacao() ou { tipo: 'erro' }. */
export function htmlTendencia(estado, rotuloAnterior) {
  if (!estado) return '';
  const base = `em relação ao ${rotuloAnterior}`;
  if (estado.tipo === 'sobe' || estado.tipo === 'desce') {
    const pct = `${Math.round(estado.percentual)}%`;
    const verbo = estado.tipo === 'sobe' ? 'Aumento' : 'Queda';
    return `<span class="kpi-tendencia ${estado.tipo}" title="${esc(`${verbo} de ${pct} ${base}`)}">${ICONES[estado.tipo]}${pct}</span>`;
  }
  if (estado.tipo === 'igual') {
    return `<span class="kpi-tendencia igual" title="${esc(`Sem variação ${base}`)}">${ICONES.igual}0%</span>`;
  }
  const motivo = estado.tipo === 'sem-base' ? `Sem lançamentos no ${rotuloAnterior}` : 'Não foi possível comparar com o período anterior';
  return `<span class="kpi-tendencia igual" title="${esc(motivo)}">—</span>`;
}

function htmlCartoes(i, anterior) {
  const dicaComparacao = anterior ? `em relação ao ${anterior.rotulo}` : 'sem comparação para período aberto';
  return `<div class="kpis">
    ${cartao({ rotulo: 'Quantidade de lançamentos', valor: formatarInteiro(i.totalRegistros), dica: dicaComparacao, cor: 'verde', icone: 'balanca', chave: anterior ? 'totalRegistros' : '' })}
    ${cartao({ rotulo: 'Total de peso', valor: formatarKg(i.totalKg), dica: dicaComparacao, cor: 'azul', icone: 'peso', chave: anterior ? 'totalKg' : '' })}
    ${cartao({ rotulo: 'Média por lançamento', valor: formatarKgResumo(i.mediaKg), dica: dicaComparacao, cor: 'laranja', icone: 'media', chave: anterior ? 'mediaKg' : '' })}
    ${cartao({ rotulo: 'Materiais envolvidos', valor: formatarInteiro(i.materiaisEnvolvidos), dica: 'no período', cor: 'roxo', icone: 'cubo', chave: anterior ? 'materiaisEnvolvidos' : '' })}
    ${cartao({ rotulo: 'Materiais ativos', valor: formatarInteiro(i.materiaisAtivos), dica: `de ${formatarInteiro(i.materiaisAtivos + i.materiaisInativos)} cadastrados`, cor: 'turquesa', icone: 'camadas' })}
  </div>`;
}

// ------------------------------------------------------------
// Painéis
// ------------------------------------------------------------
function painel({ id, icone, titulo, controle = '', corpo, extraClasse = '' }) {
  return `<section class="painel painel-dash${extraClasse}" data-painel="${id}" aria-labelledby="t-${id}">
    <header class="painel-cab">
      <h2 class="painel-titulo" id="t-${id}">${ICONES[icone]}${esc(titulo)}</h2>
      ${controle}
    </header>
    <div class="painel-corpo">${corpo}</div>
  </section>`;
}

function seletor(alvo, rotulo, opcoes, atual) {
  const ops = opcoes.map(([v, r]) => `<option value="${v}"${v === atual ? ' selected' : ''}>${esc(r)}</option>`).join('');
  return `<label class="painel-controle"><span>${esc(rotulo)}</span><select data-alternar="${alvo}">${ops}</select></label>`;
}

const painelVazio = (txt) => `<p class="painel-vazio">${esc(txt)}</p>`;

function painelEvolucao(ev, modo) {
  let corpo;
  let controle = '';
  if (ev.tipo === 'ok' && evolucaoValida(ev.dados && ev.dados.pontos)) {
    const g = ev.dados.granularidade;
    const atual = modo === 'acumulado' ? 'acumulado' : 'periodo';
    controle = seletor('evolucao', 'Visualização', [['periodo', ROTULO_GRANULARIDADE[g] || 'Por período'], ['acumulado', 'Acumulado']], atual);
    corpo = `<div data-variante="periodo"${atual === 'periodo' ? '' : ' hidden'}>${htmlAreaEvolucao(ev.dados.pontos, g, { idGradiente: 'grad-evo-periodo' })}</div>
      <div data-variante="acumulado"${atual === 'acumulado' ? '' : ' hidden'}>${htmlAreaEvolucao(ev.dados.pontos, g, { acumulado: true, idGradiente: 'grad-evo-acumulado' })}</div>`;
  } else if (ev.tipo === 'periodoAberto') {
    corpo = htmlVazio('Evolução indisponível para este período', MSG_EVOLUCAO_PERIODO_ABERTO);
  } else if (ev.tipo === 'erro') {
    corpo = htmlErro(ev.mensagem);
  } else {
    corpo = painelVazio('Sem dados de evolução para o período.');
  }
  return painel({ id: 'evolucao', icone: 'evolucao', titulo: 'Evolução de peso no período', controle, corpo });
}

function pizzaDe(gr) {
  if (!gr || gr.tipo !== 'ok') return null;
  const pizza = gr.dados && gr.dados.pizza;
  return pizzaValida(pizza) ? pizza : null;
}

function painelPesoPorMaterial(gr, modo) {
  let corpo;
  let controle = '';
  const pizza = pizzaDe(gr);
  if (gr.tipo === 'erro') corpo = htmlErro(gr.mensagem);
  else if (!pizza) corpo = htmlErro('Os dados dos gráficos recebidos do servidor são inválidos e não foram exibidos.', { repetir: false });
  else if (pizza.length === 0) corpo = painelVazio('Nenhuma pesagem no período.');
  else {
    const atual = modo === 'percentual' ? 'percentual' : 'kg';
    controle = seletor('peso', 'Visualização', [['kg', 'Por kg'], ['percentual', 'Por %']], atual);
    corpo = `<div data-variante="kg"${atual === 'kg' ? '' : ' hidden'}>${htmlBarrasMaterial(pizza, 'kg')}</div>
      <div data-variante="percentual"${atual === 'percentual' ? '' : ' hidden'}>${htmlBarrasMaterial(pizza, 'percentual')}</div>`;
  }
  return painel({ id: 'peso-material', icone: 'barras', titulo: 'Peso por material', controle, corpo });
}

function painelDistribuicao(gr, totalKg) {
  let corpo;
  const pizza = pizzaDe(gr);
  if (gr.tipo === 'erro') corpo = htmlErro(gr.mensagem);
  else if (!pizza) corpo = htmlErro('Os dados dos gráficos recebidos do servidor são inválidos e não foram exibidos.', { repetir: false });
  else if (pizza.length === 0) corpo = painelVazio('Nenhuma pesagem no período.');
  else corpo = `<div class="rosca-area">${svgRosca(pizza, formatarKg(totalKg))}${legendaRosca(pizza)}</div>`;
  return painel({ id: 'distribuicao', icone: 'pizza', titulo: 'Distribuição por material', corpo });
}

// ------------------------------------------------------------
// Painéis que dependem de /api/registros (preenchidos depois)
// ------------------------------------------------------------

/** Agrupa por categoria as linhas JÁ filtradas pelo backend. Maior peso primeiro. */
export function totaisPorCategoria(registros) {
  const mapa = new Map();
  for (const r of registros) {
    const cat = typeof r.material_categoria === 'string' && r.material_categoria !== '' ? r.material_categoria : 'Sem categoria';
    const acc = mapa.get(cat) || { categoria: cat, quantidade: 0, pesoKg: 0 };
    acc.quantidade += 1;
    acc.pesoKg += typeof r.peso_kg === 'number' && Number.isFinite(r.peso_kg) ? r.peso_kg : 0;
    mapa.set(cat, acc);
  }
  return [...mapa.values()].sort((a, b) => b.pesoKg - a.pesoKg || a.categoria.localeCompare(b.categoria, 'pt-BR'));
}

function registrosValidos(dados) {
  return dados && Array.isArray(dados.registros) && dados.totais && typeof dados.totais === 'object';
}

export function corpoCategorias(estado) {
  if (!estado || estado.tipo === 'carregando') return htmlCarregando();
  if (estado.tipo === 'erro') return htmlErro(estado.mensagem);
  if (!registrosValidos(estado.dados)) return htmlErro(MSG_RESPOSTA, { repetir: false });
  const { registros, totais } = estado.dados;
  if (registros.length === 0) return painelVazio('Nenhuma pesagem no período.');
  const total = totais.total_kg;
  const linhas = totaisPorCategoria(registros).map((c) => `<tr>
      <td data-label="Categoria">${esc(c.categoria)}</td>
      <td data-label="Lançamentos" class="num">${formatarInteiro(c.quantidade)}</td>
      <td data-label="Total de peso" class="num">${formatarKg(c.pesoKg)}</td>
      <td data-label="Participação" class="num">${total > 0 ? formatarPercentual((c.pesoKg * 100) / total) : '—'}</td>
    </tr>`).join('');
  return `<div class="tabela-dash-area"><table class="tabela tabela-dash tabela-empilhavel" data-tabela="categorias">
    <thead><tr><th scope="col">Categoria</th><th scope="col" class="num">Quantidade de lançamentos</th><th scope="col" class="num">Total de peso</th><th scope="col" class="num">Participação</th></tr></thead>
    <tbody>${linhas}</tbody>
    <tfoot><tr>
      <th scope="row">Total</th>
      <td data-label="Lançamentos" class="num">${formatarInteiro(totais.quantidade_registros)}</td>
      <td data-label="Total de peso" class="num">${formatarKg(total)}</td>
      <td data-label="Participação" class="num">${total > 0 ? '100%' : '—'}</td>
    </tr></tfoot>
  </table></div>`;
}

const LIMITE_ULTIMOS = 5;

export function corpoUltimos(estado, cores = new Map()) {
  if (!estado || estado.tipo === 'carregando') return htmlCarregando();
  if (estado.tipo === 'erro') return htmlErro(estado.mensagem);
  if (!registrosValidos(estado.dados)) return htmlErro(MSG_RESPOSTA, { repetir: false });
  const linhas = estado.dados.registros.slice(0, LIMITE_ULTIMOS); // a API já devolve do mais recente para o mais antigo
  if (linhas.length === 0) return painelVazio('Nenhuma pesagem no período.');
  let extra = cores.size;
  const corDe = (id) => {
    if (!cores.has(id)) cores.set(id, corMaterial(extra++));
    return cores.get(id);
  };
  const tr = linhas.map((r) => `<tr>
      <td data-label="Data" class="data">${formatarData(r.data_recebimento)}</td>
      <td data-label="Material"><span class="material-com-cor"><svg class="ponto-cor" viewBox="0 0 10 10" aria-hidden="true"><circle cx="5" cy="5" r="5" fill="${corDe(r.material_id)}"/></svg>${texto(r.material_nome)}</span></td>
      <td data-label="Categoria">${texto(r.material_categoria)}</td>
      <td data-label="Peso (kg)" class="num">${formatarNumero(r.peso_kg)}</td>
      <td data-label="Observação" class="obs">${texto(r.observacao)}</td>
    </tr>`).join('');
  return `<div class="tabela-dash-area"><table class="tabela tabela-dash tabela-ultimos tabela-empilhavel" data-tabela="ultimos">
    <thead><tr><th scope="col">Data</th><th scope="col">Material</th><th scope="col">Categoria</th><th scope="col" class="num">Peso (kg)</th><th scope="col">Observação</th></tr></thead>
    <tbody>${tr}</tbody>
  </table></div>`;
}

/** Cor de cada material = posição dele na série da API de gráficos (mesma cor em toda a tela). */
export function coresPorMaterial(resposta) {
  const cores = new Map();
  const pizza = pizzaDe(resposta && resposta.graficos);
  if (pizza) pizza.forEach((f, i) => cores.set(f.materialId, corMaterial(i)));
  return cores;
}

// ------------------------------------------------------------
// Template da tela (PURO)
// ------------------------------------------------------------
export function templateDashboard(resposta, modos = {}) {
  const i = resposta && resposta.indicadores;
  if (!i || typeof i !== 'object') throw new ErroApi(MSG_RESPOSTA, { tipo: 'resposta' });
  const aviso = i.totalRegistros === 0
    ? htmlVazio('Nenhum lançamento encontrado', 'Não há pesagens para os filtros e o período selecionados. Ajuste os filtros ou lance uma nova pesagem.')
    : '';
  const fa = resposta.filtroAplicado || {};
  const anterior = periodoAnterior(fa.dataInicial, fa.dataFinal);

  const temEvolucao = resposta.evolucao !== undefined;
  const temGraficos = resposta.graficos !== undefined;
  const temRegistros = resposta.registros !== undefined;

  const linha1 = temEvolucao || temGraficos
    ? `<div class="dash-linha dash-linha-1">
        ${temEvolucao ? painelEvolucao(resposta.evolucao, modos.evolucao) : ''}
        ${temGraficos ? painelPesoPorMaterial(resposta.graficos, modos.peso) : ''}
      </div>`
    : '';
  const linha2 = temGraficos || temRegistros
    ? `<div class="dash-linha dash-linha-2">
        ${temGraficos ? painelDistribuicao(resposta.graficos, i.totalKg) : ''}
        ${temRegistros ? painel({ id: 'categorias', icone: 'tabela', titulo: 'Totais por categoria', corpo: corpoCategorias(resposta.registros) }) : ''}
      </div>`
    : '';
  const ultimos = temRegistros
    ? painel({
      id: 'ultimos', icone: 'lista', titulo: 'Últimos lançamentos',
      controle: `<a class="btn btn-mini" href="#/historico">Ver todos${ICONES.seta}</a>`,
      corpo: corpoUltimos(resposta.registros, coresPorMaterial(resposta)),
    })
    : '';

  return `${aviso}
    <h2 class="sr-only">Indicadores do período</h2>
    ${htmlCartoes(i, anterior)}
    ${linha1}
    ${linha2}
    ${ultimos}`;
}

// ------------------------------------------------------------
// Montagem
// ------------------------------------------------------------
export function montar({ raiz, api, ativa }) {
  const modos = { evolucao: 'periodo', peso: 'kg' }; // escolhas dos seletores dos painéis (só apresentação)
  let rodada = 0;

  raiz.addEventListener('change', (ev) => {
    const sel = ev.target.closest && ev.target.closest('select[data-alternar]');
    if (!sel) return;
    modos[sel.dataset.alternar] = sel.value;
    const p = sel.closest('.painel');
    for (const v of p.querySelectorAll('[data-variante]')) v.hidden = v.dataset.variante !== sel.value;
  });

  /**
   * 2ª etapa: registros do período e comparação com o período anterior. As duas consultas saem
   * juntas e cada uma preenche a sua parte da tela assim que chega (uma nunca espera pela outra).
   */
  function complementar(resposta, minha) {
    const fa = resposta.filtroAplicado || {};
    const filtros = resposta.consulta.filtros;
    const valida = () => ativa() && minha === rodada;

    const preencherRegistros = (estado) => {
      if (!valida()) return;
      const corpoCat = raiz.querySelector('[data-painel="categorias"] .painel-corpo');
      if (corpoCat) corpoCat.innerHTML = corpoCategorias(estado);
      const corpoUlt = raiz.querySelector('[data-painel="ultimos"] .painel-corpo');
      if (corpoUlt) corpoUlt.innerHTML = corpoUltimos(estado, coresPorMaterial(resposta));
    };
    api.registros({ ...filtros, dataInicial: fa.dataInicial || '', dataFinal: fa.dataFinal || '' })
      .then((r) => preencherRegistros(registrosValidos(r) ? { tipo: 'ok', dados: r } : { tipo: 'erro', mensagem: MSG_RESPOSTA }))
      .catch((err) => preencherRegistros({ tipo: 'erro', mensagem: mensagemDe(err) }));

    const anterior = periodoAnterior(fa.dataInicial, fa.dataFinal);
    if (!anterior) return;
    const preencherTendencias = (prev) => {
      if (!valida()) return;
      const atual = resposta.indicadores;
      for (const slot of raiz.querySelectorAll('[data-tendencia]')) {
        const chave = slot.dataset.tendencia;
        slot.innerHTML = htmlTendencia(prev ? variacao(atual[chave], prev[chave]) : { tipo: 'erro' }, anterior.rotulo);
      }
    };
    api.dashboard({ ...filtros, dataInicial: anterior.dataInicial, dataFinal: anterior.dataFinal })
      .then((r) => preencherTendencias(r && typeof r.indicadores === 'object' ? r.indicadores : null))
      .catch(() => preencherTendencias(null));
  }

  return montarTelaComFiltros({
    raiz, api, ativa,
    titulo: 'Dashboard',
    subtitulo: 'Indicadores das pesagens registradas.',
    comVisao: true,
    buscar: async (cliente, filtros, visao) => {
      const [rIndicadores, rEvolucao, rGraficos] = await Promise.allSettled([
        cliente.dashboard(filtros, { visao }),
        cliente.evolucaoTemporal(filtros, { visao }),
        cliente.graficos(filtros, { visao }),
      ]);
      if (rIndicadores.status === 'rejected') throw rIndicadores.reason;
      const evolucao = rEvolucao.status === 'fulfilled'
        ? { tipo: 'ok', dados: rEvolucao.value }
        : ehPeriodoAbertoNaEvolucao(rEvolucao.reason)
          ? { tipo: 'periodoAberto' }
          : { tipo: 'erro', mensagem: mensagemDe(rEvolucao.reason) };
      const graficos = rGraficos.status === 'fulfilled'
        ? { tipo: 'ok', dados: rGraficos.value }
        : { tipo: 'erro', mensagem: mensagemDe(rGraficos.reason) };
      return { ...rIndicadores.value, evolucao, graficos, registros: { tipo: 'carregando' }, consulta: { filtros } };
    },
    desenhar: (resposta) => {
      const html = templateDashboard(resposta, modos);
      const minha = ++rodada;
      // roda logo depois que o HTML acima entra na página (montarTelaComFiltros atribui de forma síncrona)
      queueMicrotask(() => complementar(resposta, minha));
      return html;
    },
  });
}
