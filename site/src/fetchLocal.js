'use strict';

// ============================================================
// Roteador "fetch" local (versão online sem servidor).
//
// public/js/api.mjs continua fazendo `fetch('/api/...')`; no site publicado, o fetch é
// SUBSTITUÍDO por criarFetchLocal(), que chama o domínio aqui no navegador (sobre o Firestore)
// e devolve Response com os MESMOS corpos e status HTTP do servidor Express
// (src/server/server.js). Assim as telas, o ErroApi e as mensagens não mudam.
//
// Regras de acesso:
//  - Leitura (GET): livre para quem tem o link.
//  - Escrita (POST/PATCH em materiais e registros): só com login (`autenticado()`).
//    A trava de verdade está nas regras do Firestore (firestore.rules); esta checagem
//    só dá uma mensagem clara em vez de um erro de permissão.
//  - Backup/restauração: não se aplicam (não há arquivo local); responde 501.
// ============================================================

const materiais = require('../../src/domain/materiais');
const registrosPeso = require('../../src/domain/registrosPeso');
const dashboard = require('../../src/domain/dashboard');
const graficos = require('../../src/domain/graficos');
const evolucaoTemporal = require('../../src/domain/evolucaoTemporal');
const { aplicarVisaoPadrao } = require('../../src/filters/filterBuilder');
const { ErroDominio, CODIGOS, erroValidacao } = require('../../src/domain/erros');
const { ErroPersistencia, CODIGOS_PERSISTENCIA } = require('../../src/repositories/erros');

// Mesma tabela do servidor (src/server/server.js).
const STATUS_POR_CODIGO = {
  [CODIGOS.VALIDACAO]: 400,
  [CODIGOS.NAO_ENCONTRADO]: 404,
  [CODIGOS.DUPLICADO]: 409,
  [CODIGOS.MATERIAL_INEXISTENTE]: 400,
  [CODIGOS.MATERIAL_INATIVO]: 400,
};

const MSG_LOGIN = 'Entre com seu e-mail e senha para lançar ou editar.';
const MSG_BACKUP = 'Backup local não se aplica à versão online: os dados ficam salvos no Firebase.';
const MSG_NAO_ENCONTRADA = 'Rota não encontrada.';
const MSG_INTERNO = 'Erro interno ao processar a requisição.';

function resposta(status, json) {
  return new Response(JSON.stringify(json), { status, headers: { 'Content-Type': 'application/json' } });
}

function erroParaResposta(err) {
  if (err instanceof ErroDominio) return resposta(STATUS_POR_CODIGO[err.codigo] || 400, { erro: err.message });
  if (err instanceof ErroPersistencia) {
    return resposta(err.codigo === CODIGOS_PERSISTENCIA.CONEXAO ? 503 : 500, { erro: err.message });
  }
  console.error(err);
  return resposta(500, { erro: MSG_INTERNO });
}

// Equivalente ao req.query do Express: ausente -> undefined; repetido -> array.
function lerQuery(searchParams) {
  const q = {};
  for (const chave of new Set(searchParams.keys())) {
    const todos = searchParams.getAll(chave);
    q[chave] = todos.length > 1 ? todos : todos[0];
  }
  return q;
}

function lerBooleanoQuery(valor, nome) {
  if (valor === undefined) return false;
  if (valor === 'true') return true;
  if (valor === 'false') return false;
  throw erroValidacao(`Parâmetro ${nome} deve ser "true" ou "false".`);
}

function lerCorpo(init) {
  if (!init || init.body === undefined || init.body === null || init.body === '') return {};
  try {
    return JSON.parse(init.body) ?? {};
  } catch {
    throw erroValidacao('JSON inválido no corpo da requisição.');
  }
}

/**
 * @param {{ autenticado?: () => boolean }} [opcoes]
 * @returns {(url: string, init?: object) => Promise<Response>} substituto compatível de fetch
 */
function criarFetchLocal({ autenticado = () => false } = {}) {
  // [método, regex do caminho, escrita?, handler({ id, query, corpo })]
  const rotas = [
    ['POST', /^\/api\/materiais$/, true, async ({ corpo }) => [201, await materiais.criar(corpo)]],
    ['GET', /^\/api\/materiais$/, false, async ({ query }) => [200, await materiais.listar({ incluirInativos: lerBooleanoQuery(query.incluirInativos, 'incluirInativos') })]],
    ['GET', /^\/api\/materiais\/([^/]+)$/, false, async ({ id }) => [200, await materiais.obter(id)]],
    ['PATCH', /^\/api\/materiais\/([^/]+)$/, true, async ({ id, corpo }) => [200, await materiais.atualizar(id, corpo)]],
    ['PATCH', /^\/api\/materiais\/([^/]+)\/ativar$/, true, async ({ id }) => [200, await materiais.ativar(id)]],
    ['PATCH', /^\/api\/materiais\/([^/]+)\/desativar$/, true, async ({ id }) => [200, await materiais.desativar(id)]],
    ['POST', /^\/api\/registros$/, true, async ({ corpo }) => [201, await registrosPeso.criar(corpo)]],
    ['GET', /^\/api\/registros$/, false, async ({ query }) => {
      const { materialId, categoria, dataInicial, dataFinal } = query;
      return [200, await registrosPeso.historico({ materialId, categoria, dataInicial, dataFinal })];
    }],
    ['GET', /^\/api\/dashboard$/, false, async ({ query }) => {
      const { materialId, categoria, visao } = query;
      const { dataInicial, dataFinal } = aplicarVisaoPadrao({ dataInicial: query.dataInicial, dataFinal: query.dataFinal, visao });
      return [200, await dashboard.consultar({ materialId, categoria, dataInicial, dataFinal })];
    }],
    ['GET', /^\/api\/graficos$/, false, async ({ query }) => {
      const { materialId, categoria, visao } = query;
      const { dataInicial, dataFinal } = aplicarVisaoPadrao({ dataInicial: query.dataInicial, dataFinal: query.dataFinal, visao });
      return [200, await graficos.consultar({ materialId, categoria, dataInicial, dataFinal })];
    }],
    ['GET', /^\/api\/dashboard\/evolucao$/, false, async ({ query }) => {
      const { materialId, categoria, dataInicial, dataFinal, visao } = query;
      return [200, await evolucaoTemporal.consultar({ materialId, categoria, dataInicial, dataFinal, visao })];
    }],
  ];

  return async function fetchLocal(entrada, init = {}) {
    const metodo = String(init.method || 'GET').toUpperCase();
    let url;
    try {
      url = new URL(String(entrada), 'http://local.invalid');
    } catch {
      return resposta(400, { erro: 'Requisição inválida.' });
    }
    const caminho = url.pathname;

    if (/^\/api\/backup(\/|$)/.test(caminho)) return resposta(501, { erro: MSG_BACKUP });

    for (const [m, regex, escrita, tratar] of rotas) {
      if (m !== metodo) continue;
      const achou = regex.exec(caminho);
      if (!achou) continue;
      if (escrita && !autenticado()) return resposta(401, { erro: MSG_LOGIN });
      try {
        let id;
        if (achou[1] !== undefined) {
          try { id = decodeURIComponent(achou[1]); } catch { return resposta(400, { erro: 'Requisição inválida.' }); }
        }
        const [status, json] = await tratar({ id, query: lerQuery(url.searchParams), corpo: escrita ? lerCorpo(init) : {} });
        return resposta(status, json);
      } catch (err) {
        return erroParaResposta(err);
      }
    }
    return resposta(404, { erro: MSG_NAO_ENCONTRADA });
  };
}

module.exports = { criarFetchLocal, MSG_LOGIN, MSG_BACKUP };
