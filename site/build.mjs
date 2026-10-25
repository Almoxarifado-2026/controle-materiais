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

// Carimba o service worker com um ID único deste deploy (hash de todos os arquivos do site).
// O sw.js muda a cada publicação -> o navegador baixa a versão nova e o app se atualiza sozinho.
{
  const { createHash } = await import('node:crypto');
  const { readdir, readFile } = await import('node:fs/promises');
  const hash = createHash('sha256');
  async function varrer(dir) {
    const itens = (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const it of itens) {
      const p = path.join(dir, it.name);
      if (it.isDirectory()) await varrer(p);
      else if (path.relative(dist, p) !== 'sw.js') hash.update(path.relative(dist, p)).update(await readFile(p));
    }
  }
  await varrer(dist);
  const build = hash.digest('hex').slice(0, 12);
  const swPath = path.join(dist, 'sw.js');
  const sw = await readFile(swPath, 'utf8');
  if (!sw.includes('__BUILD__')) throw new Error('sw.js sem o marcador __BUILD__');
  await writeFile(swPath, sw.replace('__BUILD__', build));
  console.log('sw.js carimbado com build', build);
}

// GitHub Pages: sem Jekyll (nada de arquivos ignorados por convenção).
await writeFile(path.join(dist, '.nojekyll'), '');
console.log('dist/ pronto.');
