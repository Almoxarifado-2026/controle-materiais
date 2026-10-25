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

if (auth) {
  // Backup/restauração são do arquivo de dados local do servidor: não existem na versão online.
  const linkConfig = document.querySelector('.nav-item[data-rota="configuracoes"]');
  if (linkConfig) linkConfig.hidden = true;

  const rodape = document.querySelector('.sidebar-rodape');
  const estado = el('p', { class: 'acesso-estado', 'aria-live': 'polite' });
  const botao = el('button', { type: 'button', class: 'btn btn-pequeno acesso-botao' });

  const dlg = el('dialog', { class: 'acesso-dialogo', 'aria-labelledby': 'acesso-titulo' });
  const inEmail = el('input', { id: 'acesso-email', type: 'email', autocomplete: 'username', required: '', maxlength: '254' });
  const inSenha = el('input', { id: 'acesso-senha', type: 'password', autocomplete: 'current-password', required: '', maxlength: '128' });
  const erro = el('p', { class: 'acesso-erro', role: 'alert', hidden: '' });
  const btnEntrar = el('button', { type: 'submit', class: 'btn btn-primario', texto: 'Entrar' });
  const btnCancelar = el('button', { type: 'button', class: 'btn', texto: 'Cancelar' });
  const form = el('form', { class: 'acesso-form', method: 'dialog', novalidate: '' },
    el('h2', { id: 'acesso-titulo', texto: 'Entrar para editar' }),
    el('p', { class: 'acesso-ajuda', texto: 'Qualquer pessoa com o link pode consultar. Para lançar pesagens e editar materiais, entre com seu e-mail e senha.' }),
    el('div', { class: 'campo' }, el('label', { for: 'acesso-email', texto: 'E-mail' }), inEmail),
    el('div', { class: 'campo' }, el('label', { for: 'acesso-senha', texto: 'Senha' }), inSenha),
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
      await auth.entrar(inEmail.value, inSenha.value);
      inSenha.value = '';
      dlg.close();
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
