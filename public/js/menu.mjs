// Menu hambúrguer (celular/tablet). No desktop o botão fica escondido pelo CSS e este módulo
// não muda nada. Sem innerHTML (CSP estrita): só alterna a classe "aberto" e atributos ARIA.
const lateral = document.querySelector('.sidebar');
const botao = document.querySelector('.menu-botao');

if (lateral && botao) {
  const larga = window.matchMedia('(min-width: 901px)');

  function definir(aberto, { foco = false } = {}) {
    lateral.classList.toggle('aberto', aberto);
    botao.setAttribute('aria-expanded', String(aberto));
    botao.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
    if (!aberto && foco) botao.focus();
  }

  botao.addEventListener('click', () => definir(!lateral.classList.contains('aberto')));

  // Escolheu uma tela, ou clicou em Entrar/Sair: fecha o menu.
  lateral.addEventListener('click', (ev) => {
    if (ev.target.closest('.nav-item, .acesso-botao')) definir(false);
  });

  // Tocar fora do menu (no conteúdo) fecha.
  document.addEventListener('click', (ev) => {
    if (lateral.classList.contains('aberto') && !ev.target.closest('.sidebar')) definir(false);
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && lateral.classList.contains('aberto')) definir(false, { foco: true });
  });

  window.addEventListener('hashchange', () => definir(false));
  larga.addEventListener('change', (ev) => { if (ev.matches) definir(false); });
}
