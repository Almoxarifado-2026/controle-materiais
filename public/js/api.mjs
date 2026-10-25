// ============================================================
// Cliente das APIs existentes do backend. É o ÚNICO lugar do frontend
// que faz requisições de rede, e só para caminhos "/api/...".
// Não valida regra de negócio: envia o que o usuário informou e devolve o
// que o backend respondeu. Erros viram ErroApi com mensagem amigável —
// nunca detalhe interno, stack trace nem "[object Object]".
// ============================================================

import { paraQuery } from './filtros.mjs';

export class ErroApi extends Error {
  constructor(mensagem, { tipo, status = null } = {}) {
    super(mensagem);
    this.name = 'ErroApi';
    this.tipo = tipo; // 'rede' | 'timeout' | 'http' | 'resposta'
    this.status = status;
  }
}

export const MSG_REDE = 'Não foi possível conectar ao servidor. Verifique se o sistema está em execução e tente novamente.';
export const MSG_TIMEOUT = 'O servidor demorou demais para responder. Tente novamente.';
export const MSG_RESPOSTA = 'O servidor devolveu uma resposta inesperada. Tente novamente.';
export const MSG_GENERICA = 'Não foi possível concluir a operação. Tente novamente.';

export function criarClienteApi({ baseUrl = '', fetchImpl, timeoutMs = 30000 } = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));

  async function requisitar(metodo, caminho, { query, corpo } = {}) {
    const qs = query && Object.keys(query).length ? `?${new URLSearchParams(query).toString()}` : '';
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeoutMs);
    let resposta;
    try {
      resposta = await doFetch(`${baseUrl}${caminho}${qs}`, {
        method: metodo,
        headers: corpo !== undefined ? { 'Content-Type': 'application/json', Accept: 'application/json' } : { Accept: 'application/json' },
        body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
        signal: controle.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw new ErroApi(MSG_TIMEOUT, { tipo: 'timeout' });
      throw new ErroApi(MSG_REDE, { tipo: 'rede' });
    }
    clearTimeout(timer);

    let json = null;
    try {
      json = await resposta.json();
    } catch {
      json = null;
    }

    if (!resposta.ok) {
      const msg = json && typeof json.erro === 'string' && json.erro.trim() !== '' ? json.erro : null;
      throw new ErroApi(msg || (json === null ? MSG_RESPOSTA : MSG_GENERICA), { tipo: 'http', status: resposta.status });
    }
    if (json === null || typeof json !== 'object') {
      throw new ErroApi(MSG_RESPOSTA, { tipo: 'resposta', status: resposta.status });
    }
    return json;
  }

  return {
    // --- leitura (filtros enviados como estão; o backend interpreta e valida) ---
    // `extra` (Sprint 10): parâmetros adicionais que não fazem parte do filtro compartilhado
    // (filtros.mjs) — hoje só `visao`, usado por Dashboard e Gráficos (visão temporal).
    dashboard: (filtros, extra = {}) => requisitar('GET', '/api/dashboard', { query: { ...paraQuery(filtros), ...extra } }),
    registros: (filtros) => requisitar('GET', '/api/registros', { query: paraQuery(filtros) }),
    graficos: (filtros, extra = {}) => requisitar('GET', '/api/graficos', { query: { ...paraQuery(filtros), ...extra } }),
    // Evolução temporal (Sprint 10): peso agrupado por período (dia/mês/ano) para o Dashboard.
    evolucaoTemporal: (filtros, extra = {}) => requisitar('GET', '/api/dashboard/evolucao', { query: { ...paraQuery(filtros), ...extra } }),
    listarMateriais: ({ incluirInativos = false } = {}) =>
      requisitar('GET', '/api/materiais', { query: incluirInativos ? { incluirInativos: 'true' } : {} }),

    // --- escrita (sempre pelas APIs; o frontend nunca toca no banco) ---
    criarMaterial: (dados) => requisitar('POST', '/api/materiais', { corpo: dados }),
    editarMaterial: (id, dados) => requisitar('PATCH', `/api/materiais/${encodeURIComponent(id)}`, { corpo: dados }),
    ativarMaterial: (id) => requisitar('PATCH', `/api/materiais/${encodeURIComponent(id)}/ativar`),
    desativarMaterial: (id) => requisitar('PATCH', `/api/materiais/${encodeURIComponent(id)}/desativar`),
    lancarPeso: (dados) => requisitar('POST', '/api/registros', { corpo: dados }),

    // --- backup / restauração / integridade (Sprint 8) ---
    listarBackups: () => requisitar('GET', '/api/backup'),
    criarBackup: () => requisitar('POST', '/api/backup'),
    integridadeAtual: () => requisitar('GET', '/api/backup/integridade'),
    integridadeBackup: (nomeArquivo) => requisitar('GET', `/api/backup/${encodeURIComponent(nomeArquivo)}/integridade`),
    restaurarBackup: (nomeArquivo) => requisitar('POST', '/api/backup/restaurar', { corpo: { nomeArquivo, confirmar: true } }),
  };
}

/**
 * Cliente padrão do navegador. Com servidor Express, usa o fetch normal (URLs relativas ao próprio
 * servidor). Na versão online (GitHub Pages + Firebase), js/nuvem.js define globalThis.__CM_FETCH__,
 * um substituto de fetch que executa as mesmas rotas no navegador — o restante da interface não muda.
 */
export const api = criarClienteApi({ fetchImpl: globalThis.__CM_FETCH__ });
