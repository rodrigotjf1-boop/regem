/* Regem — service worker do quiosque (KDS/Ponto).
 * Objetivo: SHELL offline (a UI abre sem internet). NÃO intercepta a API
 * (outra origem) — chamadas de dados vão direto e o app trata a falha.
 */
const CACHE = 'regem-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // não toca na API/externos

  // Navegação: network-first (mostra o mais novo online; cai no cache offline).
  if (req.mode === 'navigate') {
    e.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const c = await caches.open(CACHE);
          c.put(req, res.clone());
          return res;
        } catch {
          return (
            (await caches.match(req)) ||
            (await caches.match('/kds')) ||
            (await caches.match('/terminal/ponto')) ||
            Response.error()
          );
        }
      })(),
    );
    return;
  }

  // Assets (JS/CSS/img/fonte): stale-while-revalidate.
  e.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const rede = fetch(req)
        .then((res) => {
          // Clona ANTES de devolver: se o consumidor ler o corpo primeiro,
          // clonar depois (dentro do caches.open async) quebra com
          // "Response body is already used".
          const copia = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || rede;
    })(),
  );
});
