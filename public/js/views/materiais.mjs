// ============================================================
// Materiais: cadastrar, editar, ativar e inativar (NÃO existe exclusão).
// As regras (nome obrigatório, duplicidade sem diferenciar maiúsculas, limites de
// tamanho...) são do backend; esta tela envia os dados e mostra a resposta/mensagem.
// APIs: GET /api/materiais?incluirInativos=true, POST /api/materiais,
//       PATCH /api/materiais/:id, PATCH /api/materiais/:id/ativar|desativar.
// ============================================================

import { ErroApi } from '../api.mjs';
import { esc, texto } from '../format.mjs';
import { categoriasDistintas, htmlAviso, htmlCabecalho, htmlCarregando, htmlErro, htmlVazio, mensagemDe } from './comum.mjs';

export function templateFormMaterial(material, categorias) {
  const editando = Boolean(material);
  const opcoes = categorias.map((c) => `<option value="${esc(c)}"></option>`).join('');
  return `<section class="painel" aria-labelledby="t-form-material">
    <h2 class="painel-titulo" id="t-form-material">${editando ? `Editar material — ${esc(material.nome)}` : 'Novo material'}</h2>
    <form class="formulario" id="form-material" data-modo="${editando ? 'editar' : 'novo'}" novalidate>
      <div class="campo">
        <label for="m-nome">Nome <span class="obrigatorio" aria-hidden="true">*</span></label>
        <input id="m-nome" name="nome" type="text" autocomplete="off" value="${editando ? esc(material.nome) : ''}">
      </div>
      <div class="campo">
        <label for="m-categoria">Categoria <span class="opcional">(opcional)</span></label>
        <input id="m-categoria" name="categoria" type="text" autocomplete="off" list="m-categorias" value="${editando ? esc(material.categoria ?? '') : ''}">
        <datalist id="m-categorias">${opcoes}</datalist>
      </div>
      <div class="formulario-acoes">
        <button type="submit" class="btn btn-primario" data-botao="salvar">${editando ? 'Salvar alterações' : 'Cadastrar material'}</button>
        ${editando ? '<button type="button" class="btn" data-acao="cancelar-edicao">Cancelar edição</button>' : ''}
      </div>
    </form>
    <div data-regiao="retorno"></div>
  </section>`;
}

export function templateTabelaMateriais(materiais) {
  if (materiais.length === 0) {
    return htmlVazio('Nenhum material cadastrado', 'Use o formulário acima para cadastrar o primeiro material.');
  }
  const linhas = materiais
    .map((m) => {
      const ativo = m.ativo === 1;
      return `<tr data-material-id="${esc(m.id)}">
        <td data-label="Nome">${texto(m.nome)}</td>
        <td data-label="Categoria">${texto(m.categoria)}</td>
        <td data-label="Status"><span class="selo ${ativo ? 'selo-ativo' : 'selo-inativo'}">${ativo ? 'Ativo' : 'Inativo'}</span></td>
        <td data-label="Ações" class="acoes">
          <button type="button" class="btn btn-pequeno" data-acao="editar" data-id="${esc(m.id)}">Editar</button>
          <button type="button" class="btn btn-pequeno" data-acao="${ativo ? 'inativar' : 'ativar'}" data-id="${esc(m.id)}">${ativo ? 'Inativar' : 'Ativar'}</button>
        </td>
      </tr>`;
    })
    .join('');
  return `<div class="tabela-area"><table class="tabela tabela-empilhavel" data-tabela="materiais">
    <thead><tr><th scope="col">Nome</th><th scope="col">Categoria</th><th scope="col">Status</th><th scope="col">Ações</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

export async function montar({ raiz, api, ativa, toast }) {
  raiz.innerHTML = `${htmlCabecalho('Materiais', 'Cadastre e mantenha os materiais. Materiais não são excluídos: inative para impedir novos lançamentos e preservar o histórico.')}
    <div data-regiao="formulario"></div>
    <h2 class="secao-titulo">Materiais cadastrados</h2>
    <div data-regiao="lista">${htmlCarregando()}</div>`;
  const regForm = raiz.querySelector('[data-regiao="formulario"]');
  const regLista = raiz.querySelector('[data-regiao="lista"]');
  let materiais = [];
  let sequencia = 0;

  const desenharForm = (material = null, retornoHtml = '') => {
    regForm.innerHTML = templateFormMaterial(material, categoriasDistintas(materiais));
    raiz.querySelector('[data-regiao="retorno"]').innerHTML = retornoHtml;
  };

  async function carregarLista() {
    const minha = ++sequencia;
    regLista.innerHTML = htmlCarregando();
    try {
      const resposta = await api.listarMateriais({ incluirInativos: true });
      if (!ativa() || minha !== sequencia) return false;
      if (!Array.isArray(resposta)) throw new ErroApi('O servidor devolveu uma resposta inesperada. Tente novamente.', { tipo: 'resposta' });
      materiais = resposta;
      regLista.innerHTML = templateTabelaMateriais(materiais);
      return true;
    } catch (err) {
      if (!ativa() || minha !== sequencia) return false;
      regLista.innerHTML = htmlErro(mensagemDe(err));
      return false;
    }
  }

  async function iniciar() {
    if (await carregarLista()) desenharForm();
    else regForm.innerHTML = '';
  }

  raiz.addEventListener('submit', async (ev) => {
    if (ev.target.id !== 'form-material') return;
    ev.preventDefault();
    const form = ev.target;
    const editando = form.dataset.modo === 'editar';
    const idEditado = editando ? Number(regForm.dataset.editando) : null;
    const dados = new FormData(form);
    const corpo = { nome: String(dados.get('nome') ?? ''), categoria: String(dados.get('categoria') ?? '') };
    const botao = form.querySelector('[data-botao="salvar"]');
    const retorno = raiz.querySelector('[data-regiao="retorno"]');
    botao.disabled = true;
    botao.textContent = 'Salvando…';
    retorno.innerHTML = '';
    try {
      const salvo = editando ? await api.editarMaterial(idEditado, corpo) : await api.criarMaterial(corpo);
      if (!ativa()) return;
      const nomeSalvo = salvo && typeof salvo.nome === 'string' ? salvo.nome : corpo.nome;
      await carregarLista();
      if (!ativa()) return;
      delete regForm.dataset.editando;
      desenharForm(null, htmlAviso('sucesso', editando ? `Material "${nomeSalvo}" atualizado.` : `Material "${nomeSalvo}" cadastrado.`));
    } catch (err) {
      if (!ativa()) return;
      if (!(err instanceof ErroApi)) console.error('Falha ao salvar material:', err);
      retorno.innerHTML = htmlAviso('erro', mensagemDe(err));
      botao.disabled = false;
      botao.textContent = editando ? 'Salvar alterações' : 'Cadastrar material';
    }
  });

  raiz.addEventListener('click', async (ev) => {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;

    if (acao === 'tentar-novamente') {
      iniciar();
    } else if (acao === 'cancelar-edicao') {
      delete regForm.dataset.editando;
      desenharForm();
    } else if (acao === 'editar') {
      const material = materiais.find((m) => String(m.id) === alvo.dataset.id);
      if (!material) return;
      regForm.dataset.editando = String(material.id);
      desenharForm(material);
      const campo = raiz.querySelector('#m-nome');
      campo.scrollIntoView({ block: 'center' });
      campo.focus();
    } else if (acao === 'ativar' || acao === 'inativar') {
      const material = materiais.find((m) => String(m.id) === alvo.dataset.id);
      const nome = material ? material.nome : 'material';
      alvo.disabled = true;
      try {
        if (acao === 'ativar') await api.ativarMaterial(alvo.dataset.id);
        else await api.desativarMaterial(alvo.dataset.id);
        if (!ativa()) return;
        await carregarLista();
        if (!ativa()) return;
        toast(acao === 'ativar' ? `Material "${nome}" ativado.` : `Material "${nome}" inativado. O histórico foi preservado.`, 'sucesso');
      } catch (err) {
        if (!ativa()) return;
        if (!(err instanceof ErroApi)) console.error('Falha ao alterar status do material:', err);
        alvo.disabled = false;
        toast(mensagemDe(err), 'erro');
      }
    }
  });

  return iniciar();
}
