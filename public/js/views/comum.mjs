// ============================================================
// Peças compartilhadas pelas telas: estados (carregando/vazio/erro), barra de
// filtros e o fluxo comum das telas filtradas (Dashboard, Histórico, Gráficos).
// Os templates são funções PURAS (recebem dados, devolvem HTML em texto).
// O filtro é único: a barra só coleta valores e o backend interpreta/valida.
// ============================================================

import { ErroApi } from '../api.mjs';
import { esc, formatarData } from '../format.mjs';
import { definirFiltros, haDatasInformadas, limparFiltros, obterFiltros } from '../filtros.mjs';

export const MSG_INESPERADO = 'Ocorreu um erro inesperado ao exibir esta tela. Tente novamente.';

/** Mensagem segura para o usuário: só ErroApi (já amigável) ou texto genérico — nunca stack/detalhe interno. */
export function mensagemDe(err) {
  return err instanceof ErroApi ? err.message : MSG_INESPERADO;
}

// ------------------------------------------------------------
// Estados
// ------------------------------------------------------------
export function htmlCabecalho(titulo, subtitulo = '') {
  return `<header class="pagina-cabecalho">
    <h1 class="pagina-titulo" id="titulo-pagina" tabindex="-1">${esc(titulo)}</h1>
    ${subtitulo ? `<p class="pagina-sub">${esc(subtitulo)}</p>` : ''}
  </header>`;
}

export function htmlCarregando(mensagem = 'Carregando…') {
  return `<div class="estado estado-carregando" data-estado="carregando" role="status" aria-live="polite">
    <span class="spinner" aria-hidden="true"></span><span>${esc(mensagem)}</span>
  </div>`;
}

export function htmlVazio(titulo, texto, extraHtml = '') {
  return `<div class="estado estado-vazio" data-estado="vazio">
    <p class="estado-titulo">${esc(titulo)}</p>
    <p class="estado-texto">${esc(texto)}</p>
    ${extraHtml}
  </div>`;
}

export function htmlErro(mensagem, { repetir = true } = {}) {
  return `<div class="estado estado-erro" data-estado="erro" role="alert">
    <p class="estado-titulo">Não foi possível carregar</p>
    <p class="estado-texto">${esc(mensagem)}</p>
    ${repetir ? '<button type="button" class="btn" data-acao="tentar-novamente">Tentar novamente</button>' : ''}
  </div>`;
}

export function htmlAviso(tipo, mensagem) {
  const papel = tipo === 'erro' ? 'alert' : 'status';
  return `<div class="aviso aviso-${tipo === 'erro' ? 'erro' : 'sucesso'}" role="${papel}" data-aviso="${tipo === 'erro' ? 'erro' : 'sucesso'}">${esc(mensagem)}</div>`;
}

// ------------------------------------------------------------
// Barra de filtros (mesmos 4 filtros do backend, para as 3 telas)
// ------------------------------------------------------------

/** Categorias distintas dos materiais cadastrados (texto exato, como no backend). */
export function categoriasDistintas(materiais) {
  const vistas = new Set();
  for (const m of materiais) if (typeof m.categoria === 'string' && m.categoria !== '') vistas.add(m.categoria);
  return [...vistas].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

// Visão temporal (Sprint 10): campo OPCIONAL da barra de filtros, usado só por Dashboard e
// Gráficos (via { comVisao: true }). Histórico e Relatórios continuam chamando htmlBarraFiltros()
// com 2 argumentos, exatamente como antes — sem o parâmetro `opcoes`, a barra sai IDÊNTICA à das
// Sprints 1–9 (nenhum HTML novo). "visao" NÃO faz parte do filtro compartilhado (filtros.mjs) nem
// é armazenada nele: é um estado de tela, mantido por montarTelaComFiltros (abaixo). Este arquivo
// não interpreta nem calcula período nenhum: só rotula as opções para o usuário escolher.
// Redesenho do Dashboard: a visão virou um controle SEGMENTADO (botões de rádio estilizados),
// na ordem do layout de referência (Dia, Semana, Mês, Ano, Personalizado). Continua sendo o
// mesmo campo "visao" do formulário (name="visao"); o grupo mantém id="f-visao".
const VISOES = [
  ['dia', 'Dia'],
  ['semana', 'Semana'],
  ['mes', 'Mês'],
  ['ano', 'Ano'],
  ['personalizado', 'Personalizado'],
];

function htmlCampoVisao(visaoAtual) {
  const opcoes = VISOES.map(([valor, rotulo]) => `<label class="segmento">
        <input type="radio" name="visao" value="${valor}"${valor === visaoAtual ? ' checked' : ''}>
        <span>${rotulo}</span>
      </label>`).join('');
  return `<fieldset class="campo campo-visao" id="f-visao">
      <legend>Período</legend>
      <div class="segmentado">${opcoes}</div>
    </fieldset>`;
}

const ICONE_FILTRO = '<svg class="btn-icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/></svg>';
const ICONE_LIMPAR = '<svg class="btn-icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg>';

export function htmlBarraFiltros(filtros, materiais, { comVisao = false, visaoAtual = 'mes' } = {}) {
  const opMateriais = materiais
    .map((m) => `<option value="${esc(m.id)}"${String(m.id) === filtros.materialId ? ' selected' : ''}>${esc(m.nome)}${m.ativo === 1 ? '' : ' (inativo)'}</option>`)
    .join('');
  const opCategorias = categoriasDistintas(materiais)
    .map((c) => `<option value="${esc(c)}"${c === filtros.categoria ? ' selected' : ''}>${esc(c)}</option>`)
    .join('');
  return `<form class="filtros${comVisao ? ' filtros-com-visao' : ''}" id="form-filtros" novalidate>
    ${comVisao ? htmlCampoVisao(visaoAtual) : ''}
    <div class="campo">
      <label for="f-material">Material</label>
      <select id="f-material" name="materialId"><option value="">Todos os materiais</option>${opMateriais}</select>
    </div>
    <div class="campo">
      <label for="f-categoria">Categoria</label>
      <select id="f-categoria" name="categoria"><option value="">Todas as categorias</option>${opCategorias}</select>
    </div>
    <div class="campo">
      <label for="f-inicial">Data inicial</label>
      <input id="f-inicial" name="dataInicial" type="date" value="${esc(filtros.dataInicial)}">
    </div>
    <div class="campo">
      <label for="f-final">Data final</label>
      <input id="f-final" name="dataFinal" type="date" value="${esc(filtros.dataFinal)}">
    </div>
    <div class="filtros-acoes">
      <button type="submit" class="btn btn-primario">${ICONE_FILTRO}Aplicar filtros</button>
      <button type="button" class="btn" data-acao="limpar-filtros">${ICONE_LIMPAR}Limpar filtros</button>
    </div>
  </form>`;
}

// Visão temporal (Sprint 10): rótulos de apresentação. NÃO recalcula nada — só nomeia,
// para o usuário, a visão que ELE escolheu e que o backend já usou para resolver o período.
const VISAO_ROTULOS = { dia: 'Dia', semana: 'Semana', mes: 'Mês', ano: 'Ano', personalizado: 'Personalizado' };

/**
 * Linha "Período aplicado" com o que o BACKEND devolveu em filtroAplicado (o frontend não
 * calcula período). `visao` é OPCIONAL (Sprint 10): quando informada (Dashboard/Gráficos, que
 * têm o seletor de visão), a linha identifica a visão ativa ("Visualização: <Rótulo>") e só
 * mostra "período padrão" quando o backend REALMENTE usou o período padrão daquela visão (ou
 * seja, quando `enviados` não tem nenhuma data explícita — a MESMA condição de sempre,
 * `haDatasInformadas`); com datas explícitas, nunca rotula como padrão, seja qual for a visão.
 * Sem `visao` (Histórico/Relatórios, que não têm o seletor), o comportamento é IDÊNTICO ao de
 * antes da Sprint 10: "(mês atual — período padrão)" fixo, porque para essas telas a única
 * visão que existe é sempre "mês atual".
 */
export function htmlPeriodo(aplicado, enviados, materiais, visao) {
  const ap = aplicado && typeof aplicado === 'object' ? aplicado : {};
  const di = ap.dataInicial;
  const df = ap.dataFinal;
  let periodo = 'sem limite de datas';
  if (di && df) periodo = `${formatarData(di)} a ${formatarData(df)}`;
  else if (di) periodo = `a partir de ${formatarData(di)}`;
  else if (df) periodo = `até ${formatarData(df)}`;

  const ehPadrao = !haDatasInformadas(enviados);
  let visaoHtml = '';
  let padrao;
  if (visao === undefined) {
    padrao = ehPadrao ? ' <span class="periodo-padrao">(mês atual — período padrão)</span>' : '';
  } else {
    const rotulo = VISAO_ROTULOS[visao] || visao;
    visaoHtml = ` <span class="periodo-sep" aria-hidden="true">·</span> <span class="periodo-visao">Visualização: ${esc(rotulo)}</span>`;
    padrao = ehPadrao ? ' <span class="periodo-padrao">(período padrão)</span>' : '';
  }

  const chips = [];
  if (ap.materialId !== undefined) {
    const m = materiais.find((x) => x.id === ap.materialId);
    chips.push(`Material: ${m ? m.nome : `nº ${ap.materialId}`}`);
  }
  if (typeof ap.categoria === 'string') chips.push(`Categoria: ${ap.categoria}`);
  const htmlChips = chips.map((c) => `<span class="chip">${esc(c)}</span>`).join('');
  if (visao === undefined) {
    return `<p class="periodo" data-periodo>Período aplicado: <strong>${esc(periodo)}</strong>${visaoHtml}${padrao}${htmlChips}</p>`;
  }
  // Telas com visão (Dashboard/Gráficos): linha do layout de referência, com ícone de calendário
  // e "(Todos os materiais e categorias)" quando nenhum material/categoria foi filtrado.
  const escopo = chips.length === 0
    ? ' <span class="periodo-sep" aria-hidden="true">·</span> <span class="periodo-escopo">(Todos os materiais e categorias)</span>'
    : ` <span class="periodo-sep" aria-hidden="true">·</span> ${htmlChips}`;
  return `<p class="periodo periodo-com-icone" data-periodo><svg class="periodo-icone" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v14H4zM4 10h16M8 3v5M16 3v5"/></svg>Período aplicado: <strong>${esc(periodo)}</strong>${visaoHtml}${padrao}${escopo}</p>`;
}

// ------------------------------------------------------------
// Fluxo comum das telas filtradas
// ------------------------------------------------------------

/**
 * Monta uma tela com barra de filtros: carrega os materiais (para as listas),
 * desenha a barra e pede os dados ao backend a cada "Aplicar/Limpar".
 * `buscar(api, filtros, visao)` chama a API; `desenhar(resposta, filtrosEnviados, materiais)`
 * devolve o HTML do resultado (ou lança ErroApi para exibir erro). Os dois últimos parâmetros de
 * `desenhar` são opcionais — Dashboard, Histórico e Gráficos usam só `resposta`; a tela de
 * Relatórios (Sprint 7) usa os três para identificar os filtros aplicados no relatório sem
 * duplicar a resolução já feita aqui (mesmos `filtros` e `materiais` usados por htmlPeriodo).
 * A barra permanece visível durante recargas.
 *
 * `comVisao`/`visaoInicial` (Sprint 10, opcionais): quando `comVisao` é true, a barra ganha o
 * campo "Visualização do período" (dia/semana/mês/ano/personalizado) e o valor escolhido é
 * repassado como 3º argumento de `buscar` a cada consulta — o backend decide o período; aqui só
 * se guarda QUAL visão está selecionada (uma string), nunca uma data calculada. Sem `comVisao`
 * (padrão), o comportamento é idêntico ao de antes da Sprint 10.
 */
export function montarTelaComFiltros({ raiz, api, ativa, titulo, subtitulo, buscar, desenhar, comVisao = false, visaoInicial = 'mes' }) {
  raiz.innerHTML = `${htmlCabecalho(titulo, subtitulo)}
    <div data-regiao="filtros"></div>
    <div data-regiao="periodo"></div>
    <div data-regiao="resultado">${htmlCarregando()}</div>`;
  const regFiltros = raiz.querySelector('[data-regiao="filtros"]');
  const regPeriodo = raiz.querySelector('[data-regiao="periodo"]');
  const regResultado = raiz.querySelector('[data-regiao="resultado"]');

  let materiais = [];
  let sequencia = 0; // descarta respostas antigas quando o usuário refiltra rápido
  let visao = visaoInicial;

  async function carregarResultado() {
    const minha = ++sequencia;
    const filtros = obterFiltros();
    regPeriodo.innerHTML = '';
    regResultado.innerHTML = htmlCarregando();
    try {
      const resposta = await buscar(api, filtros, visao);
      if (!ativa() || minha !== sequencia) return;
      regPeriodo.innerHTML = htmlPeriodo(resposta.filtroAplicado, filtros, materiais, comVisao ? visao : undefined);
      regResultado.innerHTML = desenhar(resposta, filtros, materiais);
    } catch (err) {
      if (!ativa() || minha !== sequencia) return;
      if (!(err instanceof ErroApi)) console.error('Falha ao exibir tela:', err);
      regResultado.innerHTML = htmlErro(mensagemDe(err));
    }
  }

  async function iniciar() {
    const minha = ++sequencia;
    regFiltros.innerHTML = '';
    regPeriodo.innerHTML = '';
    regResultado.innerHTML = htmlCarregando();
    try {
      materiais = await api.listarMateriais({ incluirInativos: true });
      if (!ativa() || minha !== sequencia) return;
      if (!Array.isArray(materiais)) throw new ErroApi('O servidor devolveu uma resposta inesperada. Tente novamente.', { tipo: 'resposta' });
    } catch (err) {
      if (!ativa() || minha !== sequencia) return;
      regResultado.innerHTML = htmlErro(mensagemDe(err));
      return;
    }
    regFiltros.innerHTML = htmlBarraFiltros(obterFiltros(), materiais, { comVisao, visaoAtual: visao });
    await carregarResultado();
  }

  raiz.addEventListener('submit', (ev) => {
    if (ev.target.id !== 'form-filtros') return;
    ev.preventDefault();
    const dados = new FormData(ev.target);
    definirFiltros({
      materialId: String(dados.get('materialId') ?? ''),
      categoria: String(dados.get('categoria') ?? ''),
      dataInicial: String(dados.get('dataInicial') ?? ''),
      dataFinal: String(dados.get('dataFinal') ?? ''),
    });
    if (comVisao) visao = String(dados.get('visao') ?? visao);
    carregarResultado();
  });
  // Trocar o Período (Dia/Semana/Mês/Ano/Personalizado) já aplica, como um botão segmentado deve fazer.
  raiz.addEventListener('change', (ev) => {
    const alvo = ev.target;
    if (alvo && alvo.name === 'visao' && alvo.form && alvo.form.id === 'form-filtros') alvo.form.requestSubmit();
  });
  raiz.addEventListener('click', (ev) => {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    if (alvo.dataset.acao === 'limpar-filtros') {
      limparFiltros();
      visao = visaoInicial;
      regFiltros.innerHTML = htmlBarraFiltros(obterFiltros(), materiais, { comVisao, visaoAtual: visao });
      carregarResultado();
    } else if (alvo.dataset.acao === 'tentar-novamente') {
      if (regFiltros.innerHTML === '') iniciar();
      else carregarResultado();
    }
  });

  return iniciar();
}
