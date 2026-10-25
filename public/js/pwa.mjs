// Registra o service worker (instalação no celular). Só em https: no programa de Windows (.exe)
// e em localhost não é necessário.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.debug('Service worker não registrado:', err));
  });
}
