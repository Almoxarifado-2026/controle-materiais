// ============================================================
// Login da versão online (GitHub Pages + Firebase). Só atua quando js/nuvem.js definiu
// globalThis.__CM_AUTH__; com o servidor Express local não faz nada.
//
// Modelo de acesso: QUALQUER pessoa com o link VÊ tudo (dashboard, gráficos, histórico,
// relatórios). Só quem entra com e-mail e senha lança pesagens e edita materiais — a trava de
// verdade está nas regras do Firestore; aqui só se mostra o estado e se oferece a entrada.
// Sem innerHTML (CSP estrita) e sem armazenar senha: o Firebase guarda a sessão.
// ============================================================

const auth = globalThis.__CM_AUTH__;

function el(tag, atributos = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(atributos)) {
    if (k === 'class') e.className = v;
    else if (k === 'texto') e.textContent = v;
    else e.setAttribute(k, v);
  }
  e.append(...filhos);
  return e;
}

const NS = 'http://www.w3.org/2000/svg';
function icone(...caminhos) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'senha-icone');
  for (const d of caminhos) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
const ICONE_OLHO = ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'];
const ICONE_OLHO_RISCADO = ['M3 3l18 18', 'M10.6 5.1A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.4-1.1', 'M9.9 9.9a3 3 0 0 0 4.2 4.2'];

if (auth) {
  // Backup/restauração são do arquivo de dados local do servidor: não existem na versão online.
  const linkConfig = document.querySelector('.nav-item[data-rota="configuracoes"]');
  if (linkConfig) linkConfig.hidden = true;

  const rodape = document.querySelector('.sidebar-rodape');
  const estado = el('p', { class: 'acesso-estado', 'aria-live': 'polite' });
  const botao = el('button', { type: 'button', class: 'btn btn-pequeno acesso-botao' });

  const dlg = el('dialog', { class: 'acesso-dialogo', 'aria-labelledby': 'acesso-titulo' });
  // name + autocomplete corretos: é isso que deixa o navegador oferecer "Salvar senha" e preencher depois.
  const inEmail = el('input', { id: 'acesso-email', name: 'username', type: 'email', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: '', maxlength: '254' });
  const inSenha = el('input', { id: 'acesso-senha', name: 'password', type: 'password', autocomplete: 'current-password', required: '', maxlength: '128' });
  // Botão "olho": mostra/oculta a senha para conferir o que foi digitado.
  const btnVer = el('button', { type: 'button', class: 'senha-ver', 'aria-label': 'Mostrar senha', 'aria-pressed': 'false' });
  btnVer.append(icone(...ICONE_OLHO));
  function definirSenhaVisivel(visivel) {
    inSenha.type = visivel ? 'text' : 'password';
    btnVer.setAttribute('aria-pressed', String(visivel));
    btnVer.setAttribute('aria-label', visivel ? 'Ocultar senha' : 'Mostrar senha');
    btnVer.replaceChildren(icone(...(visivel ? ICONE_OLHO_RISCADO : ICONE_OLHO)));
  }
  btnVer.addEventListener('click', () => definirSenhaVisivel(inSenha.type === 'password'));
  const erro = el('p', { class: 'acesso-erro', role: 'alert', hidden: '' });
  const btnEntrar = el('button', { type: 'submit', class: 'btn btn-primario', texto: 'Entrar' });
  const btnCancelar = el('button', { type: 'button', class: 'btn', texto: 'Cancelar' });
  const form = el('form', { class: 'acesso-form', method: 'dialog', novalidate: '' },
    el('h2', { id: 'acesso-titulo', texto: 'Entrar para editar' }),
    el('p', { class: 'acesso-ajuda', texto: 'Qualquer pessoa com o link pode consultar. Para lançar pesagens e editar materiais, entre com seu e-mail e senha.' }),
    el('div', { class: 'campo' }, el('label', { for: 'acesso-email', texto: 'E-mail' }), inEmail),
    el('div', { class: 'campo' }, el('label', { for: 'acesso-senha', texto: 'Senha' }), el('div', { class: 'campo-senha' }, inSenha, btnVer)),
    erro,
    el('div', { class: 'acesso-acoes' }, btnCancelar, btnEntrar),
  );
  dlg.append(form);
  document.body.append(dlg);

  function mostrarErro(msg) {
    erro.textContent = msg;
    erro.hidden = !msg;
  }

  btnCancelar.addEventListener('click', () => dlg.close());
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    mostrarErro('');
    if (!inEmail.value.trim() || !inSenha.value) {
      mostrarErro('Informe e-mail e senha.');
      return;
    }
    btnEntrar.disabled = true;
    btnEntrar.textContent = 'Entrando…';
    try {
      const emailUsado = inEmail.value.trim();
      const senhaUsada = inSenha.value;
      await auth.entrar(inEmail.value, inSenha.value);
      // Pede ao navegador para oferecer "Salvar senha" (o app em si NUNCA guarda a senha).
      if (window.PasswordCredential && navigator.credentials && navigator.credentials.store) {
        try { await navigator.credentials.store(new window.PasswordCredential({ id: emailUsado, password: senhaUsada, name: emailUsado })); } catch { /* sem suporte: ignora */ }
      }
      dlg.close();
      // Limpa só depois de fechar, para o navegador conseguir ler o formulário preenchido.
      setTimeout(() => { inSenha.value = ''; definirSenhaVisivel(false); }, 800);
    } catch (err) {
      mostrarErro(err.message);
    } finally {
      btnEntrar.disabled = false;
      btnEntrar.textContent = 'Entrar';
    }
  });

  botao.addEventListener('click', async () => {
    if (auth.usuario()) {
      await auth.sair();
    } else {
      mostrarErro('');
      definirSenhaVisivel(false);
      dlg.showModal();
      inEmail.focus();
    }
  });

  auth.aoMudar((usuario) => {
    document.body.classList.toggle('modo-leitura', !usuario);
    estado.textContent = usuario ? `Editando como ${usuario.email}` : 'Modo consulta (somente leitura)';
    botao.textContent = usuario ? 'Sair' : 'Entrar para editar';
  });

  if (rodape) rodape.prepend(el('div', { class: 'acesso' }, estado, botao));
}
