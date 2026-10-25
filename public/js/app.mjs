// ============================================================
// Aplicação: navegação por hash (#/dashboard, #/lancar, ...), montagem das telas
// e avisos (toasts). Nenhuma regra de negócio, nenhum armazenamento local.
// ============================================================

import { api } from './api.mjs';
import { MSG_INESPERADO, htmlErro } from './views/comum.mjs';
import * as configuracoes from './views/configuracoes.mjs';
import * as dashboard from './views/dashboard.mjs';
import * as graficos from './views/graficos.mjs';
import * as historico from './views/historico.mjs';
import * as lancar from './views/lancar.mjs';
import * as materiais from './views/materiais.mjs';
import * as relatorios from './views/relatorios.mjs';

/** Toda entrada do menu corresponde a uma tela real. */
export const ROTAS = {
  dashboard: { titulo: 'Dashboard', tela: dashboard },
  lancar: { titulo: 'Lançar Pesagem', tela: lancar },
  materiais: { titulo: 'Materiais', tela: materiais },
  historico: { titulo: 'Histórico', tela: historico },
  graficos: { titulo: 'Gráficos', tela: graficos },
  relatorios: { titulo: 'Relatórios', tela: relatorios },
  configuracoes: { titulo: 'Configurações', tela: configuracoes },
};
const ROTA_PADRAO = 'dashboard';

const principal = document.getElementById('conteudo');
const areaToasts = document.getElementById('toasts');
let geracao = 0; // identifica a tela atual: respostas de telas antigas são descartadas

/** Aviso temporário (sucesso/erro) de operações de escrita. */
function toast(mensagem, tipo = 'sucesso') {
  const el = document.createElement('div');
  el.className = `toast toast-${tipo === 'erro' ? 'erro' : 'sucesso'}`;
  el.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
  el.textContent = mensagem;
  areaToasts.append(el);
  setTimeout(() => el.remove(), tipo === 'erro' ? 8000 : 5000);
}

function rotaAtual() {
  const m = /^#\/([a-z]+)$/.exec(location.hash);
  return m && Object.hasOwn(ROTAS, m[1]) ? m[1] : null;
}

async function mostrar() {
  const chave = rotaAtual();
  if (chave === null) {
    location.replace(`#/${ROTA_PADRAO}`); // dispara "hashchange" com a rota válida
    return;
  }
  const minha = ++geracao;
  const { titulo, tela } = ROTAS[chave];
  document.title = `${titulo} — Controle de Materiais`;
  for (const link of document.querySelectorAll('.nav-item')) {
    if (link.dataset.rota === chave) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const secao = document.createElement('section');
  secao.className = 'tela';
  secao.dataset.tela = chave;
  principal.replaceChildren(secao);
  try {
    await tela.montar({ raiz: secao, api, toast, ativa: () => minha === geracao });
  } catch (err) {
    console.error('Falha ao montar a tela:', err);
    if (minha === geracao) secao.innerHTML = htmlErro(MSG_INESPERADO, { repetir: false });
  }
  if (minha === geracao) {
    const cabecalho = secao.querySelector('#titulo-pagina');
    if (cabecalho) cabecalho.focus({ preventScroll: true });
  }
}

window.addEventListener('hashchange', mostrar);
window.addEventListener('unhandledrejection', (ev) => {
  // AbortError interno do SDK do Firebase (conexão fechada/reaberta): não é falha da tela,
  // e o pedido real já é tratado por api.mjs. Não deve virar aviso vermelho para o usuário.
  if (ev.reason && ev.reason.name === 'AbortError') {
    console.debug('AbortError ignorado:', ev.reason);
    ev.preventDefault();
    return;
  }
  console.error('Erro não tratado:', ev.reason);
  toast(MSG_INESPERADO, 'erro');
});
mostrar();
