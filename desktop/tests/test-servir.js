'use strict';

// Servidor de arquivos do programa (src/servir.js): só serve DENTRO da pasta do site.
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolverArquivo } = require('../src/servir');

const RAIZ = path.resolve('/tmp/site-teste');
let total = 0;
let falhas = 0;
function t(nome, fn) {
  total += 1;
  try { fn(); console.log(`✅ PASS - ${nome}`); } catch (e) {
    falhas += 1;
    console.log(`❌ FAIL - ${nome}\n   ${String(e.message).split('\n').join('\n   ')}`);
  }
}
const dentro = (r) => r && !path.relative(RAIZ, r.arquivo).startsWith('..') && !path.isAbsolute(path.relative(RAIZ, r.arquivo));

t('S01 — "/" e pastas viram index.html; arquivos conhecidos têm o tipo certo', () => {
  assert.equal(resolverArquivo(RAIZ, 'app://cm/').arquivo, path.join(RAIZ, 'index.html'));
  assert.equal(resolverArquivo(RAIZ, 'app://cm').arquivo, path.join(RAIZ, 'index.html'));
  assert.equal(resolverArquivo(RAIZ, 'app://cm/js/').arquivo, path.join(RAIZ, 'js', 'index.html'));
  assert.match(resolverArquivo(RAIZ, 'app://cm/index.html').tipo, /^text\/html/);
  assert.match(resolverArquivo(RAIZ, 'app://cm/js/app.mjs').tipo, /^text\/javascript/);
  assert.match(resolverArquivo(RAIZ, 'app://cm/js/nuvem.js').tipo, /^text\/javascript/);
  assert.match(resolverArquivo(RAIZ, 'app://cm/css/app.css').tipo, /^text\/css/);
  assert.equal(resolverArquivo(RAIZ, 'app://cm/js/views/lancar.mjs').arquivo, path.join(RAIZ, 'js', 'views', 'lancar.mjs'));
});

t('S02 — Query e hash são ignorados', () => {
  assert.equal(resolverArquivo(RAIZ, 'app://cm/css/app.css?v=3#x').arquivo, path.join(RAIZ, 'css', 'app.css'));
  assert.equal(resolverArquivo(RAIZ, 'app://cm/index.html#/dashboard').arquivo, path.join(RAIZ, 'index.html'));
});

t('S03 — Fuga da pasta é recusada em todas as formas (.., %2e%2e, %2F, barra invertida, nulo, absoluto)', () => {
  const ruins = [
    'app://cm/../segredo.js', 'app://cm/js/../../segredo.js', 'app://cm/%2e%2e/segredo.js', 'app://cm/%2E%2E/%2E%2E/etc/passwd.txt',
    'app://cm/js/..%2f..%2fsegredo.js', 'app://cm/js/..%5c..%5csegredo.js', 'app://cm/js\\..\\segredo.js', 'app://cm/js/app.mjs%00.png',
    'app://cm//etc/passwd.txt', 'app://cm/C:/Windows/win.ini', 'app://cm/..\\..\\x.js',
  ];
  for (const u of ruins) {
    const r = resolverArquivo(RAIZ, u);
    assert.ok(r === null || dentro(r), `escapou: ${u} -> ${r && r.arquivo}`);
  }
  // ".." literal: o próprio parser de URL colapsa para /segredo.js, que continua DENTRO da pasta (checado acima por `dentro`).
  // %2e%2e também é colapsado (segmento de ponto). O que SOBREVIVE ao parser (%2f, %5c, nulo) o servidor precisa recusar.
  for (const u of ['app://cm/js/..%2f..%2fsegredo.js', 'app://cm/js/..%5c..%5csegredo.js', 'app://cm/js\\..\\segredo.js', 'app://cm/js/app.mjs%00.png']) {
    assert.equal(resolverArquivo(RAIZ, u), null, u);
  }
});

t('S04 — Host/protocolo errados e URLs inválidas são recusados', () => {
  for (const u of ['app://outro/index.html', 'http://cm/index.html', 'file:///etc/passwd.txt', 'https://cm/index.html', 'nao-e-url', '', undefined, null, 'app://cm/%E0%A4%A']) {
    assert.equal(resolverArquivo(RAIZ, u), null, String(u));
  }
});

t('S05 — Só tipos conhecidos: scripts de servidor, executáveis e arquivos sem extensão são recusados', () => {
  for (const u of ['app://cm/main.exe', 'app://cm/x.php', 'app://cm/x.sh', 'app://cm/LICENSE', 'app://cm/x.map', 'app://cm/x.JS.exe']) {
    assert.equal(resolverArquivo(RAIZ, u), null, u);
  }
  assert.ok(resolverArquivo(RAIZ, 'app://cm/CSS/APP.CSS'), 'extensão em maiúsculas é aceita');
});

console.log(`\nPrograma EXE (servidor de arquivos) — Total: ${total} | PASS: ${total - falhas} | FAIL: ${falhas}`);
process.exit(falhas ? 1 : 0);
