'use strict';

// Testes do roteador local (site/src/fetchLocal.js): o MESMO domínio da aplicação sobre o
// Firestore FAKE (tests/repositories/fake-firestore.js), respondendo como o servidor Express.
// Inclui o cliente real public/js/api.mjs por cima do fetch local (ErroApi, mensagens).
// Não usa rede, Firebase real nem Emulator.

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const RAIZ = path.join(__dirname, '..', '..');
const { criarFakeFirestore } = require(path.join(RAIZ, 'tests', 'repositories', 'fake-firestore'));
const { criarRepositorios } = require(path.join(RAIZ, 'src', 'repositories'));
const { definirRepositorios, redefinirRepositorios } = require(path.join(RAIZ, 'src', 'repositories', 'provedor'));
const { erroPersistencia, CODIGOS_PERSISTENCIA } = require(path.join(RAIZ, 'src', 'repositories', 'erros'));
const { criarFetchLocal, MSG_LOGIN } = require('../src/fetchLocal');

let total = 0;
let falhas = 0;
async function t(nome, fn) {
  total += 1;
  try {
    await fn();
    console.log(`✅ PASS - ${nome}`);
  } catch (err) {
    falhas += 1;
    console.log(`❌ FAIL - ${nome}\n   ${String(err && err.message).split('\n').join('\n   ')}`);
  }
}

async function novoAmbiente({ logado = true } = {}) {
  const fake = criarFakeFirestore();
  const repos = await criarRepositorios({ modo: 'firestore', firestore: { db: fake.db, sdk: fake.sdk } });
  definirRepositorios(repos);
  const estado = { logado };
  const f = criarFetchLocal({ autenticado: () => estado.logado });
  const chamar = async (metodo, url, corpo) => {
    const r = await f(url, { method: metodo, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    return { status: r.status, json: await r.json() };
  };
  return { estado, f, chamar };
}

const hoje = () => new Date().toISOString().slice(0, 10);

(async () => {
  await t('W01 — Leitura é livre (sem login): materiais, histórico, dashboard, gráficos e evolução respondem 200 com base vazia', async () => {
    const { chamar, estado } = await novoAmbiente({ logado: false });
    assert.equal(estado.logado, false);
    for (const url of ['/api/materiais', '/api/registros', '/api/dashboard', '/api/graficos', '/api/dashboard/evolucao']) {
      const r = await chamar('GET', url);
      assert.equal(r.status, 200, `${url} -> ${r.status} ${JSON.stringify(r.json)}`);
    }
    assert.deepEqual((await chamar('GET', '/api/materiais')).json, []);
  });

  await t('W02 — Escrita SEM login é recusada (401, mensagem clara) e nada é gravado', async () => {
    const { chamar } = await novoAmbiente({ logado: false });
    const a = await chamar('POST', '/api/materiais', { nome: 'Papelão', categoria: 'Papel' });
    assert.equal(a.status, 401);
    assert.equal(a.json.erro, MSG_LOGIN);
    const b = await chamar('POST', '/api/registros', { materialId: 'x', pesoKg: 1, dataRecebimento: hoje() });
    assert.equal(b.status, 401);
    for (const [m, u] of [['PATCH', '/api/materiais/x'], ['PATCH', '/api/materiais/x/ativar'], ['PATCH', '/api/materiais/x/desativar']]) {
      assert.equal((await chamar(m, u, {})).status, 401, `${m} ${u}`);
    }
    assert.deepEqual((await chamar('GET', '/api/materiais?incluirInativos=true')).json, []);
  });

  await t('W03 — Materiais COM login: criar (201), duplicado (409), inválido (400), obter, editar, desativar/ativar, inexistente (404)', async () => {
    const { chamar } = await novoAmbiente();
    const c = await chamar('POST', '/api/materiais', { nome: 'Papelão', categoria: 'Papel' });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    const id = c.json.id;
    assert.equal(c.json.nome, 'Papelão');
    assert.equal((await chamar('POST', '/api/materiais', { nome: '  papelão ' })).status, 409);
    assert.equal((await chamar('POST', '/api/materiais', { nome: '' })).status, 400);
    assert.equal((await chamar('GET', `/api/materiais/${encodeURIComponent(id)}`)).json.nome, 'Papelão');
    const e = await chamar('PATCH', `/api/materiais/${encodeURIComponent(id)}`, { nome: 'Papelão Branco' });
    assert.equal(e.status, 200, JSON.stringify(e.json));
    assert.equal(e.json.nome, 'Papelão Branco');
    assert.equal((await chamar('PATCH', `/api/materiais/${encodeURIComponent(id)}/desativar`)).json.ativo, 0);
    assert.equal((await chamar('GET', '/api/materiais')).json.length, 0);
    assert.equal((await chamar('GET', '/api/materiais?incluirInativos=true')).json.length, 1);
    assert.equal((await chamar('PATCH', `/api/materiais/${encodeURIComponent(id)}/ativar`)).json.ativo, 1);
    assert.equal((await chamar('GET', '/api/materiais/naoexiste')).status, 404);
    assert.equal((await chamar('GET', '/api/materiais?incluirInativos=talvez')).status, 400);
  });

  await t('W04 — Lançamento de peso: 201 com login; peso/data/material inválidos e material inativo -> 400', async () => {
    const { chamar } = await novoAmbiente();
    const m = (await chamar('POST', '/api/materiais', { nome: 'PET' })).json;
    const ok = await chamar('POST', '/api/registros', { materialId: m.id, pesoKg: 12.5, dataRecebimento: hoje(), observacao: 'lote 1' });
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.peso_kg, 12.5);
    assert.equal((await chamar('POST', '/api/registros', { materialId: m.id, pesoKg: -1, dataRecebimento: hoje() })).status, 400);
    assert.equal((await chamar('POST', '/api/registros', { materialId: m.id, pesoKg: 1, dataRecebimento: '2026-13-40' })).status, 400);
    assert.equal((await chamar('POST', '/api/registros', { materialId: 'inexistente', pesoKg: 1, dataRecebimento: hoje() })).status, 400);
    await chamar('PATCH', `/api/materiais/${encodeURIComponent(m.id)}/desativar`);
    assert.equal((await chamar('POST', '/api/registros', { materialId: m.id, pesoKg: 1, dataRecebimento: hoje() })).status, 400);
  });

  await t('W05 — Histórico, dashboard, gráficos e evolução refletem os lançamentos (totais conferidos à mão) e validam filtros (400)', async () => {
    const { chamar } = await novoAmbiente();
    const a = (await chamar('POST', '/api/materiais', { nome: 'Papelão', categoria: 'Papel' })).json;
    const b = (await chamar('POST', '/api/materiais', { nome: 'PET', categoria: 'Plástico' })).json;
    await chamar('POST', '/api/registros', { materialId: a.id, pesoKg: 10, dataRecebimento: hoje() });
    await chamar('POST', '/api/registros', { materialId: a.id, pesoKg: 5, dataRecebimento: hoje() });
    await chamar('POST', '/api/registros', { materialId: b.id, pesoKg: 20, dataRecebimento: hoje() });
    const h = await chamar('GET', '/api/registros');
    assert.equal(h.status, 200);
    assert.equal(h.json.registros.length, 3);
    assert.equal(h.json.totais.total_kg, 35);
    const f = await chamar('GET', `/api/registros?materialId=${encodeURIComponent(a.id)}`);
    assert.equal(f.json.registros.length, 2);
    assert.equal(f.json.totais.total_kg, 15);
    assert.equal((await chamar('GET', '/api/registros?categoria=Pl%C3%A1stico')).json.registros.length, 1);
    const d = await chamar('GET', '/api/dashboard?visao=mes');
    assert.equal(d.status, 200, JSON.stringify(d.json));
    assert.ok(d.json.indicadores);
    const g = await chamar('GET', '/api/graficos');
    assert.equal(g.status, 200);
    assert.ok(g.json.pizza && g.json.barras);
    const ev = await chamar('GET', '/api/dashboard/evolucao?visao=mes');
    assert.equal(ev.status, 200, JSON.stringify(ev.json));
    assert.equal((await chamar('GET', '/api/registros?dataInicial=2026-02-30')).status, 400);
    assert.equal((await chamar('GET', '/api/registros?dataInicial=2026-05-02&dataFinal=2026-05-01')).status, 400);
    assert.equal((await chamar('GET', '/api/dashboard?visao=invalida')).status, 400);
  });

  await t('W06 — Backup/restauração não existem online (501 com mensagem), rota desconhecida e método errado -> 404', async () => {
    const { chamar } = await novoAmbiente();
    for (const [m, u] of [['GET', '/api/backup'], ['POST', '/api/backup'], ['GET', '/api/backup/integridade'], ['POST', '/api/backup/restaurar'], ['GET', '/api/backup/x.db/integridade']]) {
      const r = await chamar(m, u, m === 'POST' ? {} : undefined);
      assert.equal(r.status, 501, `${m} ${u}`);
      assert.match(r.json.erro, /Firebase/);
    }
    assert.equal((await chamar('GET', '/api/nada')).status, 404);
    assert.equal((await chamar('DELETE', '/api/materiais/x')).status, 404);
    assert.equal((await chamar('DELETE', '/api/registros')).status, 404);
  });

  await t('W07 — Falhas: JSON inválido -> 400; erro de persistência -> 503/500 com mensagem fixa, sem detalhe interno; erro inesperado -> 500 genérico', async () => {
    const { f } = await novoAmbiente();
    const ruim = await f('/api/materiais', { method: 'POST', body: '{nao-e-json' });
    assert.equal(ruim.status, 400);
    assert.match((await ruim.json()).erro, /JSON inválido/);

    const quebrar = (err) => ({
      listar: async () => { throw err; },
    });
    const { criarFakeFirestore: _ } = { criarFakeFirestore };
    const fake = criarFakeFirestore();
    const repos = await criarRepositorios({ modo: 'firestore', firestore: { db: fake.db, sdk: fake.sdk } });

    repos.materiais.listar = async () => { throw erroPersistencia(CODIGOS_PERSISTENCIA.CONEXAO, { codigoOrigem: 'unavailable' }); };
    definirRepositorios(repos);
    const fa = criarFetchLocal({ autenticado: () => true });
    const r503 = await fa('/api/materiais');
    assert.equal(r503.status, 503);
    const msg503 = (await r503.json()).erro;
    assert.ok(typeof msg503 === 'string' && msg503.length > 0);
    assert.ok(!/firestore\.googleapis|unavailable|stack/i.test(msg503));

    repos.materiais.listar = async () => { throw new Error('segredo interno: projeto xyz'); };
    const origErr = console.error;
    console.error = () => {};
    const r500 = await fa('/api/materiais');
    console.error = origErr;
    assert.equal(r500.status, 500);
    assert.doesNotMatch(JSON.stringify(await r500.json()), /segredo|xyz/);
    void quebrar;
  });

  await t('W08 — Cliente REAL (public/js/api.mjs) sobre o fetch local: leitura ok; escrita sem login vira ErroApi 401; com login funciona; backup vira ErroApi 501', async () => {
    const { criarClienteApi, ErroApi } = await import(pathToFileURL(path.join(RAIZ, 'public', 'js', 'api.mjs')).href);
    const { estado, f } = await novoAmbiente({ logado: false });
    const api = criarClienteApi({ fetchImpl: f });
    assert.deepEqual(await api.listarMateriais(), []);
    await assert.rejects(() => api.criarMaterial({ nome: 'Vidro' }), (e) => e instanceof ErroApi && e.tipo === 'http' && e.status === 401 && e.message === MSG_LOGIN);
    estado.logado = true;
    const m = await api.criarMaterial({ nome: 'Vidro' });
    await api.lancarPeso({ materialId: m.id, pesoKg: 3, dataRecebimento: hoje() });
    const h = await api.registros({});
    assert.equal(h.registros.length, 1);
    await assert.rejects(() => api.criarBackup(), (e) => e instanceof ErroApi && e.status === 501);
    await assert.rejects(() => api.dashboard({ dataInicial: '2026-02-30' }), (e) => e instanceof ErroApi && e.status === 400);
  });

  await t('W09 — Provedor do navegador sem Firestore configurado: rejeita com erro de CONFIGURAÇÃO (mensagem fixa), não cai em SQLite e não fica preso em cache', async () => {
    const provedorWeb = require('../src/provedorWeb');
    provedorWeb.redefinirRepositorios();
    await assert.rejects(() => provedorWeb.obterRepositorios(), (e) => e.codigo === CODIGOS_PERSISTENCIA.CONFIGURACAO && typeof e.message === 'string' && e.message.length > 0);
    await assert.rejects(() => provedorWeb.obterRepositorios(), (e) => e.codigo === CODIGOS_PERSISTENCIA.CONFIGURACAO);
    const fake = criarFakeFirestore();
    provedorWeb.configurarFirestore({ db: fake.db, sdk: fake.sdk });
    const r = await provedorWeb.obterRepositorios();
    assert.equal(r.modo, 'firestore');
    assert.equal((await r.materiais.listar({ incluirInativos: true })).length, 0);
  });

  console.log(`\nWeb (roteador local sobre Firestore FAKE) — Total: ${total} | PASS: ${total - falhas} | FAIL: ${falhas}`);
  process.exit(falhas ? 1 : 0);
})();
