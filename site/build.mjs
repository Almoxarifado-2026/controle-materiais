// Gera dist/ (site estático para GitHub Pages / Firebase Hosting):
//   1. copia public/ para dist/
//   2. empacota site/src/entrada.js (Firebase + domínio + repositories Firestore) em dist/js/nuvem.js
// Uso: cd site && npm ci && npm run build
import { build } from 'esbuild';
import { cp, rm, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = path.dirname(fileURLToPath(import.meta.url));
const raiz = path.join(aqui, '..');
const dist = path.join(raiz, 'dist');

// No bundle, o provedor Node (que lê PERSISTENCIA e usa import() de caminho) é trocado
// pelo provedor do navegador. O domínio continua importando '../repositories/provedor'.
const trocarProvedor = {
  name: 'trocar-provedor',
  setup(b) {
    b.onResolve({ filter: /repositories[\\/]provedor$/ }, () => ({ path: path.join(aqui, 'src', 'provedorWeb.js') }));
  },
};

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(raiz, 'public'), dist, { recursive: true });

await build({
  entryPoints: [path.join(aqui, 'src', 'entrada.js')],
  outfile: path.join(dist, 'js', 'nuvem.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  plugins: [trocarProvedor],
  logLevel: 'info',
});

// GitHub Pages: sem Jekyll (nada de arquivos ignorados por convenção).
await writeFile(path.join(dist, '.nojekyll'), '');
console.log('dist/ pronto.');
