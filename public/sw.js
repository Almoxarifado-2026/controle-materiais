// Service worker mínimo: deixa o app instalável no celular e abre a "casca" mesmo sem internet.
// Estratégia REDE PRIMEIRO: com internet, sempre carrega a versão mais nova do site (nunca fica
// preso numa versão velha). Sem internet, usa a última cópia guardada. Os dados vêm do Firebase
// (outro domínio) e NUNCA passam por este cache.
const CACHE = 'cm-casca-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys()
      .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Firebase e outros domínios: direto na rede

  ev.respondWith(
    fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(req).then((guardado) => guardado || (req.mode === 'navigate' ? caches.match('./') : undefined) || Response.error())),
  );
});
