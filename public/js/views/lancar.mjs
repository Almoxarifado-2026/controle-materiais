// ============================================================
// Lançar Pesagem: formulário que envia POST /api/registros.
// A tela NÃO valida regra de negócio (peso > 0, data real, material ativo...):
// o backend valida e devolve a mensagem, que é exibida como veio.
// Só a lista de materiais ATIVOS (GET /api/materiais) e os lançamentos recentes
// (GET /api/registros, período padrão do backend) são lidos das APIs.
// ============================================================

import { ErroApi } from '../api.mjs';
import { esc, formatarData, formatarInteiro, formatarKg, hojeIso } from '../format.mjs';
import { htmlAviso, htmlCabecalho, htmlCarregando, htmlErro, htmlVazio, mensagemDe } from './comum.mjs';
import { htmlTabelaRegistros } from './historico.mjs';

const LIMITE_RECENTES = 10; // só quantas linhas exibir aqui; o total real vem da API

/**
 * Converte o texto digitado em número para o JSON (vírgula decimal pt-BR aceita).
 * Se não parecer um número, devolve o texto ORIGINAL: o backend rejeita com a própria mensagem.
 * Campo vazio -> undefined (omitido; o backend diz que é obrigatório).
 */
export function lerPeso(bruto) {
  const t = String(bruto ?? '').trim();
  if (t === '') return undefined;
  if (/^\d+([.,]\d+)?$/.test(t)) return Number(t.replace(',', '.'));
  return t;
}

export function lerMaterialId(bruto) {
  const t = String(bruto ?? '').trim();
  return t === '' ? undefined : t;
}

export function templateFormulario(materiais, hoje = hojeIso()) {
  const opcoes = materiais.map((m) => `<option value="${esc(m.id)}">${esc(m.nome)}${m.categoria ? ` — ${esc(m.categoria)}` : ''}</option>`).join('');
  return `<section class="painel" aria-labelledby="t-form">
    <h2 class="painel-titulo" id="t-form">Nova pesagem</h2>
    <form class="formulario" id="form-lancamento" novalidate>
      <div class="campo">
        <label for="l-material">Material <span class="obrigatorio" aria-hidden="true">*</span></label>
        <select id="l-material" name="materialId"><option value="">Selecione o material…</option>${opcoes}</select>
      </div>
      <div class="campo">
        <label for="l-peso">Peso (kg) <span class="obrigatorio" aria-hidden="true">*</span></label>
        <input id="l-peso" name="pesoKg" type="text" inputmode="decimal" autocomplete="off" placeholder="Ex.: 12,5">
      </div>
      <div class="campo">
        <label for="l-data">Data do recebimento <span class="obrigatorio" aria-hidden="true">*</span></label>
        <input id="l-data" name="dataRecebimento" type="date" value="${esc(hoje)}">
      </div>
      <div class="campo campo-largo">
        <label for="l-obs">Observação <span class="opcional">(opcional)</span></label>
        <textarea id="l-obs" name="observacao" rows="3"></textarea>
      </div>
      <div class="formulario-acoes">
        <button type="submit" class="btn btn-primario" data-botao="salvar">Salvar pesagem</button>
      </div>
    </form>
    <div data-regiao="retorno"></div>
  </section>`;
}

export function templateRecentes(resposta) {
  if (!resposta || !Array.isArray(resposta.registros) || !resposta.totais) throw new ErroApi('O servidor devolveu uma resposta inesperada. Tente novamente.', { tipo: 'resposta' });
  if (resposta.registros.length === 0) {
    return htmlVazio('Nenhuma pesagem neste mês', 'Assim que você salvar uma pesagem, ela aparece aqui.');
  }
  const total = resposta.totais.quantidade_registros;
  const mostrados = Math.min(resposta.registros.length, LIMITE_RECENTES);
  return `<p class="nota">Mostrando ${formatarInteiro(mostrados)} de ${formatarInteiro(total)} lançamento(s) do período. Veja tudo na tela Histórico.</p>
    ${htmlTabelaRegistros(resposta.registros.slice(0, LIMITE_RECENTES))}`;
}

export async function montar({ raiz, api, ativa }) {
  raiz.innerHTML = `${htmlCabecalho('Lançar Pesagem', 'Registre o peso em kg de um material ativo.')}<div data-regiao="conteudo">${htmlCarregando()}</div>`;
  const conteudo = raiz.querySelector('[data-regiao="conteudo"]');
  let sequenciaRecentes = 0;

  async function carregarRecentes() {
    const regiao = raiz.querySelector('[data-regiao="recentes"]');
    if (!regiao) return;
    const minha = ++sequenciaRecentes;
    regiao.innerHTML = htmlCarregando('Carregando lançamentos…');
    try {
      const resposta = await api.registros({});
      if (!ativa() || minha !== sequenciaRecentes) return;
      const periodo = resposta.filtroAplicado || {};
      const titulo = periodo.dataInicial && periodo.dataFinal ? `${formatarData(periodo.dataInicial)} a ${formatarData(periodo.dataFinal)}` : '';
      raiz.querySelector('[data-regiao="recentes-periodo"]').textContent = titulo ? `Período: ${titulo}` : '';
      regiao.innerHTML = templateRecentes(resposta);
    } catch (err) {
      if (!ativa() || minha !== sequenciaRecentes) return;
      regiao.innerHTML = htmlErro(mensagemDe(err));
    }
  }

  async function iniciar() {
    conteudo.innerHTML = htmlCarregando();
    let materiais;
    try {
      materiais = await api.listarMateriais(); // somente ativos (regra do backend)
      if (!ativa()) return;
      if (!Array.isArray(materiais)) throw new ErroApi('O servidor devolveu uma resposta inesperada. Tente novamente.', { tipo: 'resposta' });
    } catch (err) {
      if (!ativa()) return;
      conteudo.innerHTML = htmlErro(mensagemDe(err));
      return;
    }
    if (materiais.length === 0) {
      conteudo.innerHTML = htmlVazio(
        'Nenhum material ativo disponível',
        'Cadastre ou ative um material para poder lançar pesagens.',
        '<a class="btn btn-primario" href="#/materiais">Ir para Materiais</a>'
      );
      return;
    }
    conteudo.innerHTML = `${templateFormulario(materiais)}
      <h2 class="secao-titulo">Lançamentos recentes <span class="secao-nota" data-regiao="recentes-periodo"></span></h2>
      <div data-regiao="recentes"></div>`;
    await carregarRecentes();
  }

  raiz.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'form-lancamento') return;
    ev.preventDefault();
    const form = ev.target;
    const retorno = raiz.querySelector('[data-regiao="retorno"]');
    const botao = form.querySelector('[data-botao="salvar"]');
    const dados = new FormData(form);
    const observacao = String(dados.get('observacao') ?? '');
    const dataRecebimento = String(dados.get('dataRecebimento') ?? '');
    const corpo = {
      materialId: lerMaterialId(dados.get('materialId')),
      pesoKg: lerPeso(dados.get('pesoKg')),
      dataRecebimento: dataRecebimento === '' ? undefined : dataRecebimento,
      observacao: observacao.trim() === '' ? undefined : observacao,
    };
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    retorno.innerHTML = '';
    try {
      const criado = await api.lancarPeso(corpo);
      if (!ativa()) return;
      retorno.innerHTML = htmlAviso('sucesso', `Pesagem registrada: ${formatarKg(criado.peso_kg)} de ${criado.material_nome ?? 'material'} em ${formatarData(criado.data_recebimento)}.`);
      form.elements.pesoKg.value = '';
      form.elements.observacao.value = '';
      form.elements.pesoKg.focus();
      await carregarRecentes();
    } catch (err) {
      if (!ativa()) return;
      if (!(err instanceof ErroApi)) console.error('Falha ao salvar pesagem:', err);
      retorno.innerHTML = htmlAviso('erro', mensagemDe(err));
    } finally {
      botao.disabled = false;
      botao.textContent = 'Salvar pesagem';
    }
  });

  raiz.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-acao="tentar-novamente"]')) {
      if (raiz.querySelector('[data-regiao="recentes"]')) carregarRecentes();
      else iniciar();
    }
  });

  return iniciar();
}
