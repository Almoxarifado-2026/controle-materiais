// Registra o service worker (instalação no celular) e aplica as atualizações sozinho.
// Só em https: no programa de Windows (.exe) e em localhost não é necessário.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Só recarrega se já havia um service worker controlando a página (ou seja, é uma ATUALIZAÇÃO,
  // não a primeira visita), e no máximo uma vez, para nunca entrar em loop.
  const jaTinhaControle = !!navigator.serviceWorker.controller;
  let recarregou = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!jaTinhaControle || recarregou) return;
    recarregou = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    // updateViaCache:'none' = o navegador nunca usa cópia em cache do próprio sw.js ao procurar versão nova.
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
      .then((reg) => {
        const procurar = () => reg.update().catch(() => {});
        // Ao voltar para o app (abrir o PWA de novo, trocar de aba) e a cada 30 min com o app aberto.
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') procurar(); });
        setInterval(procurar, 30 * 60 * 1000);
      })
      .catch((err) => console.debug('Service worker não registrado:', err));
  });
}
