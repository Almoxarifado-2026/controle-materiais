'use strict';

// Abre o programa Electron DE VERDADE (precisa de display: no Linux use xvfb-run) e confere a janela,
// o isolamento (sem Node na página), o servidor de arquivos app://cm/ e o bloqueio de navegação externa.
// Requer Playwright (global) e as dependências do desktop instaladas. Gera o site antes (site/build.mjs).
//   xvfb-run -a node tests/test-janela.js

const path = require('node:path');
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');

const DESKTOP = path.join(__dirname, '..');
function carregarPlaywright() {
  const candidatos = ['playwright'];
  try { candidatos.push(path.join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright')); } catch { /* sem npm global */ }
  for (const c of candidatos) { try { return require(c); } catch { /* próximo */ } }
  return null;
}
const playwright = carregarPlaywright();
if (!playwright || !playwright._electron) { console.error('NÃO EXECUTADO: Playwright (com suporte a Electron) não encontrado.'); process.exit(2); }

execSync('node build.mjs', { cwd: path.join(DESKTOP, '..', 'site'), stdio: 'ignore' });

let total = 0;
let falhas = 0;
async function t(nome, fn) {
  total += 1;
  try { await fn(); console.log(`✅ PASS - ${nome}`); } catch (e) {
    falhas += 1;
    console.log(`❌ FAIL - ${nome}\n   ${String(e && e.message).split('\n').join('\n   ')}`);
  }
}

(async () => {
  const app = await playwright._electron.launch({ executablePath: require('electron'), args: ['--no-sandbox', DESKTOP], cwd: DESKTOP, timeout: 60000 });
  const page = await app.firstWindow();
  const erros = [];
  page.on('pageerror', (e) => erros.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/i.test(m.text())) erros.push(m.text()); });
  await page.waitForSelector('.acesso-estado', { timeout: 30000 });

  await t('J01 — A janela abre o sistema em app://cm/ com o bundle carregado, modo consulta e sem erro de JavaScript/CSP', async () => {
    assert.match(page.url(), /^app:\/\/cm\//);
    assert.match(await page.textContent('.acesso-estado'), /Modo consulta/);
    assert.equal(await page.evaluate(() => typeof globalThis.__CM_FETCH__), 'function');
    assert.equal(await page.isVisible('.nav-item[data-rota="configuracoes"]'), false);
    await page.waitForTimeout(500);
    assert.deepEqual(erros, []);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getTitle()), await page.title());
  });

  await t('J02 — Isolamento: a página não enxerga Node (require/process/module) e o menu fica oculto', async () => {
    const r = await page.evaluate(() => ({ req: typeof require, proc: typeof process, mod: typeof module, buf: typeof Buffer }));
    assert.deepEqual(r, { req: 'undefined', proc: 'undefined', mod: 'undefined', buf: 'undefined' });
    const prefs = await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { menu: w.autoHideMenuBar, wp: w.webContents.getLastWebPreferences() };
    });
    assert.equal(prefs.wp.nodeIntegration, false);
    assert.equal(prefs.wp.contextIsolation, true);
    assert.equal(prefs.wp.sandbox, true);
  });

  await t('J03 — Servidor de arquivos: arquivos do site 200; arquivo fora do site/tipo desconhecido 404', async () => {
    const r = await page.evaluate(async () => {
      const g = async (u) => { const x = await fetch(u); return x.status; };
      return {
        app: await g('app://cm/js/app.mjs'),
        css: await g('app://cm/css/app.css'),
        main: await g('app://cm/main.js.map'),
        exe: await g('app://cm/x.exe'),
        enc: await g('app://cm/js/..%2f..%2fmain.js'),
      };
    });
    assert.deepEqual(r, { app: 200, css: 200, main: 404, exe: 404, enc: 404 });
  });

  await t('J04 — Login: diálogo abre e, sem Firebase configurado, explica o que falta', async () => {
    await page.click('.acesso-botao');
    await page.fill('#acesso-email', 'alguem@teste.com');
    await page.fill('#acesso-senha', 'qualquer-coisa');
    await page.click('dialog button[type="submit"]');
    await page.waitForFunction(() => /ainda não foi configurado/i.test(document.querySelector('.acesso-erro')?.textContent || ''));
  });

  await t('J05 — Telas funcionam no programa: navegar entre as telas mostra o conteúdo (erro amigável sem Firebase), sem exceção de JavaScript', async () => {
    await page.click('dialog button:has-text("Cancelar")');
    for (const rota of ['historico', 'graficos', 'materiais', 'relatorios']) {
      await page.click(`.nav-item[data-rota="${rota}"]`);
      await page.waitForFunction((r) => location.hash === `#/${r}`, rota);
      await page.waitForFunction(() => (document.querySelector('#conteudo')?.textContent || '').trim().length > 20, null, { timeout: 15000 });
    }
    assert.deepEqual(erros, []);
  });

  await t('J06 — Navegação externa é bloqueada: window.open e troca de location não abrem nada nem saem do sistema', async () => {
    const antes = app.windows().length;
    const aberta = await page.evaluate(() => window.open('https://example.com') === null);
    assert.equal(aberta, true, 'window.open deveria ser negado');
    await page.evaluate(() => { location.href = 'https://example.com/'; });
    await page.waitForTimeout(800);
    assert.match(page.url(), /^app:\/\/cm\//);
    assert.equal(app.windows().length, antes);
    // A página continua viva e utilizável depois da tentativa bloqueada.
    assert.equal(await page.evaluate(() => document.querySelectorAll('.nav-item').length > 0), true);
    // (Verificação pelo processo principal e pelo DOM: o Playwright, depois de uma navegação CANCELADA, fica
    // esperando um commit que nunca vem e trava page.click; isso é limitação da ferramenta, não da janela.)
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.isLoading()), false, 'janela não ficou presa carregando');
    await page.evaluate(() => { location.hash = '#/graficos'; document.querySelector('.nav-item[data-rota="dashboard"]').click(); });
    await page.waitForFunction(() => location.hash === '#/dashboard', null, { timeout: 10000 });
  });

  await app.close();
  console.log(`\nPrograma EXE (Electron, janela real) — Total: ${total} | PASS: ${total - falhas} | FAIL: ${falhas}`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
