// ============================================================
// Configurações (Sprint 8): Integridade do banco + Backup manual + lista de backups
// (verificação sob demanda + restauração protegida por confirmação explícita).
// Toda a regra vive no backend (src/backup/backup.js, src/backup/restore.js); esta tela só
// chama as APIs (via api.mjs) e mostra o que elas devolvem — nenhum cálculo de integridade
// nem de segurança acontece aqui. O navegador nunca acessa o arquivo do banco diretamente.
// APIs: GET/POST /api/backup, GET /api/backup/integridade, GET /api/backup/:id/integridade,
//       POST /api/backup/restaurar.
// ============================================================

import { ErroApi } from '../api.mjs';
import { esc, formatarBytes, formatarDataHora, texto } from '../format.mjs';
import { htmlAviso, htmlCabecalho, htmlCarregando, htmlErro, htmlVazio, mensagemDe } from './comum.mjs';

const TEXTO_CONFIRMACAO_RESTAURACAO =
  'Esta operação substituirá os dados atuais pelos dados do backup selecionado. Um backup de segurança do estado atual será criado antes da restauração. Deseja continuar?';

const RUTULO_MOTIVO = { manual: 'Manual', pre_restauracao: 'Pré-restauração', automatico: 'Automático' };
function rotuloMotivo(motivo) {
  return motivo && RUTULO_MOTIVO[motivo] ? RUTULO_MOTIVO[motivo] : texto(motivo);
}

// ------------------------------------------------------------
// Seção 1: Integridade do banco de dados atual
// ------------------------------------------------------------
export function templateIntegridade({ status = 'desconhecido' } = {}) {
  const selo =
    status === 'ok'
      ? '<span class="selo selo-ativo">Íntegro</span>'
      : status === 'erro'
        ? '<span class="selo selo-erro">Falha de integridade</span>'
        : status === 'verificando'
          ? '<span class="selo selo-inativo">Verificando…</span>'
          : '<span class="selo selo-inativo">Não verificado nesta sessão</span>';
  return `<section class="painel" aria-labelledby="t-integridade">
    <h2 class="painel-titulo" id="t-integridade">Integridade do banco de dados</h2>
    <p class="nota">Confirma se o arquivo do banco pode ser aberto e se sua estrutura está íntegra (verificação real no servidor).</p>
    <p class="integridade-linha">Integridade: ${selo}</p>
    <button type="button" class="btn" data-acao="verificar-integridade" ${status === 'verificando' ? 'disabled' : ''}>
      ${status === 'verificando' ? 'Verificando…' : 'Verificar integridade'}
    </button>
  </section>`;
}

// ------------------------------------------------------------
// Seção 2: Backup manual
// ------------------------------------------------------------
export function templateBackupManual({ criando = false } = {}) {
  return `<section class="painel" aria-labelledby="t-backup">
    <h2 class="painel-titulo" id="t-backup">Backup</h2>
    <p class="nota">Cria uma cópia completa do banco de dados atual e verifica sua integridade antes de disponibilizá-la.</p>
    <button type="button" class="btn btn-primario" data-acao="criar-backup" ${criando ? 'disabled' : ''}>
      ${criando ? 'Criando backup…' : 'Criar backup agora'}
    </button>
    <div data-regiao="retorno-backup"></div>
  </section>`;
}

// ------------------------------------------------------------
// Seção 3: Lista de backups + restauração
// ------------------------------------------------------------
function seloEstadoBackup(estado) {
  if (estado && estado.verificando) return '<span class="selo selo-inativo">Verificando…</span>';
  if (estado && estado.resultado === 'ok') return '<span class="selo selo-ativo">Íntegro</span>';
  if (estado && estado.resultado === 'erro') return '<span class="selo selo-erro">Corrompido</span>';
  return '<span class="selo selo-inativo">Verificado na criação</span>';
}

/**
 * `estadosBackup`: mapa nomeArquivo -> { verificando, resultado: 'ok'|'erro'|null } (verificação sob demanda).
 * `confirmando`: nomeArquivo do backup com o painel de confirmação de restauração aberto (ou null).
 * `restaurando`: true enquanto uma restauração está em andamento (desabilita as ações da lista inteira).
 */
export function templateListaBackups(backups, { estadosBackup = {}, confirmando = null, restaurando = false } = {}) {
  if (!Array.isArray(backups) || backups.length === 0) {
    return htmlVazio('Nenhum backup encontrado', 'Use "Criar backup agora" para gerar o primeiro backup.');
  }
  const linhas = backups
    .map((b) => {
      const nome = b.nomeArquivo;
      const estado = estadosBackup[nome];
      const desabilitado = restaurando || (estado && estado.verificando);
      const linhaPrincipal = `<tr data-backup="${esc(nome)}">
        <td data-label="Data" class="data">${formatarDataHora(b.criadoEm)}</td>
        <td data-label="Tamanho">${formatarBytes(b.tamanhoBytes)}</td>
        <td data-label="Tipo">${texto(rotuloMotivo(b.motivo))}</td>
        <td data-label="Estado">${seloEstadoBackup(estado)}</td>
        <td data-label="Ações" class="acoes">
          <button type="button" class="btn btn-pequeno" data-acao="verificar-backup" data-nome="${esc(nome)}" ${desabilitado ? 'disabled' : ''}>Verificar</button>
          <button type="button" class="btn btn-pequeno btn-perigo" data-acao="restaurar" data-nome="${esc(nome)}" ${desabilitado ? 'disabled' : ''}>Restaurar</button>
        </td>
      </tr>`;
      const confirmarAberto = confirmando === nome;
      const linhaConfirmacao = confirmarAberto
        ? `<tr class="linha-confirmacao" data-confirmacao="${esc(nome)}"><td colspan="5">
            <div class="confirmacao" role="alertdialog" aria-labelledby="conf-titulo-${esc(nome)}">
              <p id="conf-titulo-${esc(nome)}" class="confirmacao-texto">${esc(TEXTO_CONFIRMACAO_RESTAURACAO)}</p>
              <div class="formulario-acoes">
                <button type="button" class="btn" data-acao="cancelar-restaurar" ${restaurando ? 'disabled' : ''}>Cancelar</button>
                <button type="button" class="btn btn-perigo" data-acao="confirmar-restaurar" data-nome="${esc(nome)}" ${restaurando ? 'disabled' : ''}>
                  ${restaurando ? 'Restaurando…' : 'Confirmar restauração'}
                </button>
              </div>
            </div>
          </td></tr>`
        : '';
      return linhaPrincipal + linhaConfirmacao;
    })
    .join('');
  return `<div class="tabela-area"><table class="tabela tabela-empilhavel" data-tabela="backups">
    <thead><tr><th scope="col">Data</th><th scope="col">Tamanho</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Ações</th></tr></thead>
    <tbody>${linhas}</tbody></table></div>`;
}

// ------------------------------------------------------------
// Montagem da tela
// ------------------------------------------------------------
export async function montar({ raiz, api, ativa, toast }) {
  raiz.innerHTML = `${htmlCabecalho('Configurações', 'Backup, restauração e verificação de integridade do banco de dados.')}
    <div class="painel-pilha">
      <div data-regiao="integridade">${htmlCarregando()}</div>
      <div data-regiao="backup-manual"></div>
    </div>
    <h2 class="secao-titulo">Backups existentes</h2>
    <div data-regiao="lista-backups">${htmlCarregando()}</div>`;

  const regIntegridade = raiz.querySelector('[data-regiao="integridade"]');
  const regBackupManual = raiz.querySelector('[data-regiao="backup-manual"]');
  const regLista = raiz.querySelector('[data-regiao="lista-backups"]');

  let integridadeStatus = 'desconhecido';
  let criandoBackup = false;
  let backups = [];
  const estadosBackup = {};
  let confirmando = null;
  let restaurando = false;
  let sequenciaLista = 0;

  const desenharIntegridade = () => {
    regIntegridade.innerHTML = templateIntegridade({ status: integridadeStatus });
  };
  const desenharBackupManual = (retornoHtml = '') => {
    regBackupManual.innerHTML = templateBackupManual({ criando: criandoBackup });
    const reg = raiz.querySelector('[data-regiao="retorno-backup"]');
    if (reg) reg.innerHTML = retornoHtml;
  };
  const desenharLista = () => {
    regLista.innerHTML = templateListaBackups(backups, { estadosBackup, confirmando, restaurando });
  };

  async function carregarLista() {
    const minha = ++sequenciaLista;
    regLista.innerHTML = htmlCarregando();
    try {
      const resposta = await api.listarBackups();
      if (!ativa() || minha !== sequenciaLista) return false;
      if (!Array.isArray(resposta)) throw new ErroApi('O servidor devolveu uma resposta inesperada. Tente novamente.', { tipo: 'resposta' });
      backups = resposta;
      for (const nome of Object.keys(estadosBackup)) {
        if (!backups.some((b) => b.nomeArquivo === nome)) delete estadosBackup[nome];
      }
      desenharLista();
      return true;
    } catch (err) {
      if (!ativa() || minha !== sequenciaLista) return false;
      if (!(err instanceof ErroApi)) console.error('Falha ao listar backups:', err);
      regLista.innerHTML = htmlErro(mensagemDe(err));
      return false;
    }
  }

  async function iniciar() {
    desenharIntegridade();
    desenharBackupManual();
    await carregarLista();
  }

  raiz.addEventListener('click', async (ev) => {
    const alvo = ev.target.closest('[data-acao]');
    if (!alvo) return;
    const acao = alvo.dataset.acao;

    if (acao === 'tentar-novamente') {
      carregarLista();
      return;
    }

    if (acao === 'verificar-integridade') {
      integridadeStatus = 'verificando';
      desenharIntegridade();
      try {
        const resposta = await api.integridadeAtual();
        if (!ativa()) return;
        integridadeStatus = resposta && resposta.integro === true ? 'ok' : 'erro';
      } catch (err) {
        if (!ativa()) return;
        if (!(err instanceof ErroApi)) console.error('Falha ao verificar integridade:', err);
        integridadeStatus = 'erro';
        toast(mensagemDe(err), 'erro');
      }
      desenharIntegridade();
      return;
    }

    if (acao === 'criar-backup') {
      criandoBackup = true;
      desenharBackupManual();
      try {
        const criado = await api.criarBackup();
        if (!ativa()) return;
        criandoBackup = false;
        desenharBackupManual(htmlAviso('sucesso', `Backup criado (${formatarBytes(criado && criado.tamanhoBytes)}).`));
        await carregarLista();
      } catch (err) {
        if (!ativa()) return;
        if (!(err instanceof ErroApi)) console.error('Falha ao criar backup:', err);
        criandoBackup = false;
        desenharBackupManual(htmlAviso('erro', mensagemDe(err)));
      }
      return;
    }

    if (acao === 'verificar-backup') {
      const nome = alvo.dataset.nome;
      estadosBackup[nome] = { verificando: true, resultado: null };
      desenharLista();
      try {
        const resposta = await api.integridadeBackup(nome);
        if (!ativa()) return;
        estadosBackup[nome] = { verificando: false, resultado: resposta && resposta.integro === true ? 'ok' : 'erro' };
      } catch (err) {
        if (!ativa()) return;
        if (!(err instanceof ErroApi)) console.error('Falha ao verificar backup:', err);
        estadosBackup[nome] = { verificando: false, resultado: null };
        toast(mensagemDe(err), 'erro');
      }
      desenharLista();
      return;
    }

    if (acao === 'restaurar') {
      confirmando = alvo.dataset.nome;
      desenharLista();
      const linha = raiz.querySelector(`[data-confirmacao="${CSS.escape(confirmando)}"] .confirmacao`);
      if (linha) linha.scrollIntoView({ block: 'nearest' });
      return;
    }

    if (acao === 'cancelar-restaurar') {
      confirmando = null;
      desenharLista();
      return;
    }

    if (acao === 'confirmar-restaurar') {
      const nome = alvo.dataset.nome;
      restaurando = true;
      desenharLista();
      try {
        await api.restaurarBackup(nome);
        if (!ativa()) return;
        restaurando = false;
        confirmando = null;
        integridadeStatus = 'desconhecido';
        desenharIntegridade();
        toast('Restauração concluída. Os dados atuais foram substituídos pelos do backup selecionado.', 'sucesso');
        await carregarLista();
      } catch (err) {
        if (!ativa()) return;
        if (!(err instanceof ErroApi)) console.error('Falha ao restaurar backup:', err);
        restaurando = false;
        toast(mensagemDe(err), 'erro');
        desenharLista();
      }
    }
  });

  return iniciar();
}
