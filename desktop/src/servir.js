'use strict';

// ============================================================
// Servidor de arquivos do programa (protocolo app://cm/).
// Resolve uma URL para um arquivo DENTRO da pasta do site, sem nunca sair dela:
//  - só o host "cm" (qualquer outro é recusado);
//  - sem "..", sem barra invertida, sem byte nulo, sem caminho absoluto, sem URL malformada;
//  - "/" e pastas viram index.html;
//  - só tipos de arquivo conhecidos (o resto é recusado).
// Função pura, sem Electron: testada em desktop/tests/test-servir.js.
// ============================================================

const path = require('node:path');

const HOST = 'cm';
const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * @param {string} raiz pasta do site (absoluta)
 * @param {string} urlTexto ex.: "app://cm/js/app.mjs?v=1"
 * @returns {{ arquivo: string, tipo: string } | null} null = recusar (404)
 */
function resolverArquivo(raiz, urlTexto) {
  let url;
  try {
    url = new URL(String(urlTexto));
  } catch {
    return null;
  }
  if (url.protocol !== 'app:' || url.hostname !== HOST) return null;

  let caminho;
  try {
    caminho = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (caminho.includes('\0') || caminho.includes('\\')) return null;
  if (caminho.split('/').some((parte) => parte === '..')) return null;

  if (caminho === '' || caminho.endsWith('/')) caminho += 'index.html';
  const relativo = path.posix.normalize(caminho).replace(/^\/+/, '');
  if (relativo === '' || relativo.startsWith('..')) return null;

  const tipo = TIPOS[path.extname(relativo).toLowerCase()];
  if (!tipo) return null;

  const base = path.resolve(raiz);
  const arquivo = path.resolve(base, ...relativo.split('/'));
  const rel = path.relative(base, arquivo);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return { arquivo, tipo };
}

module.exports = { resolverArquivo, HOST, TIPOS };
