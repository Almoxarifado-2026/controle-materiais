'use strict';

// Fumaça no Chromium do SITE PUBLICADO (dist/), servido sob /repo/ como no GitHub Pages de projeto.
// Não usa Firebase real: as chamadas a *.googleapis.com são abortadas. Cobre o que dá para provar sem rede:
// bundle carrega, CSP não bloqueia, caminhos relativos, modo consulta, login, erros amigáveis.
// Requer Playwright + Chromium (mesmo requisito de tests/e2e-navegador.js).

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');

const SITE = path.join(__dirname, '..');
const DIST = path.join(SITE, '..', 'dist');
const PREFIXO = '/repo';

function carregarPlaywright() {
  const candidatos = ['playwright'];
  try { candidatos.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* sem npm global */ }
  for (const c of candidatos) { try { return require(c); } catch { /* próximo */ } }
  return null;
}
const playwright = carregarPlaywright();
if (!playwright) { console.error('NÃO EXECUTADO: Playwright não encontrado.'); process.exit(2); }

execSync('node build.mjs', { cwd: SITE, stdio: 'ignore' });

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };
let configFalsa = false;
const CFG_REAL_FALSA = "window.FIREBASE_CONFIG={apiKey:'chave-falsa',authDomain:'x.firebaseapp.com',projectId:'demo-x',appId:'1:1:web:1'};";

const servidor = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith(`${PREFIXO}/`)) { res.writeHead(404); return res.end('fora do prefixo'); }
  let rel = url.pathname.slice(PREFIXO.length + 1) || 'index.html';
  if (rel === 'firebase-config.js' && configFalsa) { res.writeHead(200, { 'Content-Type': TIPOS['.js'] }); return res.end(CFG_REAL_FALSA); }
  const arq = path.join(DIST, rel);
  if (!arq.startsWith(DIST) || !fs.existsSync(arq) || fs.statSync(arq).isDirectory()) { res.writeHead(404); return res.end('nao'); }
  res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arq)] || 'application/octet-stream' });
  res.end(fs.readFileSync(arq));
});

let total = 0;
let falhas = 0;
async function t(nome, fn) {
  total += 1;
  try { await fn(); console.log(`✅ PASS - ${nome}`); } catch (err) {
    falhas += 1;
    console.log(`❌ FAIL - ${nome}\n   ${String(err && err.message).split('\n').join('\n   ')}`);
  }
}

(async () => {
  await new Promise((r) => servidor.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${servidor.address().port}${PREFIXO}/`;
  const browser = await playwright.chromium.launch();

  async function abrir() {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    const erros = [];
    const externas = [];
    page.on('pageerror', (e) => erros.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|net::ERR/i.test(m.text())) erros.push(`console.${m.type()}: ${m.text()}`); });
    await page.route(/googleapis\.com/, (r) => { externas.push(r.request().url()); return r.abort(); });
    await page.route((u) => !u.href.startsWith('http://127.0.0.1') && !/googleapis\.com/.test(u.href), (r) => { externas.push(`PROIBIDA ${r.request().url()}`); return r.abort(); });
    return { ctx, page, erros, externas };
  }

  await t('N01 — Sem configuração do Firebase: o site carrega sob /repo/ (caminhos relativos), sem erro de JS nem violação de CSP; modo consulta e Configurações escondida', async () => {
    configFalsa = false;
    const { ctx, page, erros } = await abrir();
    await page.goto(base);
    await page.waitForSelector('.acesso-estado');
    assert.match(await page.textContent('.acesso-estado'), /Modo consulta \(somente leitura\)/);
    assert.equal((await page.textContent('.acesso-botao')).trim(), 'Entrar para editar');
    assert.equal(await page.isVisible('.nav-item[data-rota="configuracoes"]'), false);
    assert.equal(await page.evaluate(() => document.body.classList.contains('modo-leitura')), true);
    assert.equal(await page.evaluate(() => typeof globalThis.__CM_FETCH__), 'function', 'bundle nuvem.js carregou');
    await page.waitForTimeout(500);
    assert.deepEqual(erros, []);
    await ctx.close();
  });

  await t('N02 — Sem configuração: telas mostram erro amigável (nunca tela em branco/stack) e o menu continua navegável', async () => {
    configFalsa = false;
    const { ctx, page, erros } = await abrir();
    await page.goto(base + '#/historico');
    await page.waitForFunction(() => /erro|não foi possível|tente/i.test(document.querySelector('#conteudo')?.textContent || ''), null, { timeout: 15000 });
    const txt = await page.textContent('#conteudo');
    assert.doesNotMatch(txt, /undefined|NaN|\[object|at .*\.js:\d+/);
    await page.click('.nav-item[data-rota="graficos"]');
    await page.waitForFunction(() => location.hash === '#/graficos');
    assert.deepEqual(erros.filter((e) => /pageerror/.test(e)), []);
    await ctx.close();
  });

  await t('N03 — Diálogo de login: abre, valida campos vazios, e sem Firebase configurado explica o que falta (sem travar)', async () => {
    configFalsa = false;
    const { ctx, page } = await abrir();
    await page.goto(base);
    await page.click('.acesso-botao');
    assert.equal(await page.isVisible('dialog.acesso-dialogo'), true);
    await page.click('dialog button[type="submit"]');
    assert.match(await page.textContent('.acesso-erro'), /Informe e-mail e senha/);
    await page.fill('#acesso-email', 'alguem@teste.com');
    await page.fill('#acesso-senha', 'qualquer-coisa');
    await page.click('dialog button[type="submit"]');
    await page.waitForFunction(() => /ainda não foi configurado/i.test(document.querySelector('.acesso-erro')?.textContent || ''));
    assert.equal((await page.textContent('dialog button[type="submit"]')).trim(), 'Entrar', 'botão volta ao normal');
    await page.click('dialog button:has-text("Cancelar")');
    assert.equal(await page.isVisible('dialog.acesso-dialogo'), false);
    await ctx.close();
  });

  await t('N04 — Com configuração presente (rede bloqueada): só se tenta falar com *.googleapis.com; login mostra erro de conexão amigável e permanece em modo consulta; nada de recurso externo além do Firebase', async () => {
    configFalsa = true;
    const { ctx, page, externas } = await abrir();
    await page.goto(base);
    await page.click('.acesso-botao');
    await page.fill('#acesso-email', 'alguem@teste.com');
    await page.fill('#acesso-senha', 'qualquer-coisa');
    await page.click('dialog button[type="submit"]');
    await page.waitForFunction(() => /sem conexão|não foi possível|tente/i.test(document.querySelector('.acesso-erro')?.textContent || ''), null, { timeout: 20000 });
    assert.match(await page.textContent('.acesso-estado'), /Modo consulta/);
    assert.ok(externas.some((u) => /identitytoolkit\.googleapis\.com/.test(u)), `tentou o Auth: ${externas.join(', ')}`);
    assert.ok(!externas.some((u) => u.startsWith('PROIBIDA')), externas.join(', '));
    await ctx.close();
  });

  await t('N05 — Escrita sem login é recusada com mensagem clara na tela de Lançamento (nada é enviado ao Firestore)', async () => {
    configFalsa = true;
    const { ctx, page, externas } = await abrir();
    await page.goto(base + '#/lancar');
    await page.waitForSelector('#conteudo section');
    // Chama o cliente real diretamente (as telas dependem da lista de materiais, que exige o Firestore).
    const r = await page.evaluate(async () => {
      const resp = await globalThis.__CM_FETCH__('/api/registros', { method: 'POST', body: JSON.stringify({ materialId: 'x', pesoKg: 1, dataRecebimento: '2026-01-01' }) });
      return { status: resp.status, json: await resp.json() };
    });
    assert.equal(r.status, 401);
    assert.match(r.json.erro, /Entre com seu e-mail e senha/);
    assert.ok(!externas.some((u) => /firestore\.googleapis\.com.*Write/.test(u)), 'nenhuma gravação tentada');
    await ctx.close();
  });

  await browser.close();
  servidor.close();
  console.log(`\nSite publicado (Chromium) — Total: ${total} | PASS: ${total - falhas} | FAIL: ${falhas}`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
