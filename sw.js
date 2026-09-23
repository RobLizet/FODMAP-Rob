/* Service worker: app-shell offline beschikbaar (stale-while-revalidate).
 * Verhoog CACHE bij een update als je wilt dat iedereen direct de nieuwe versie krijgt. */
const CACHE = 'fodmap-scanner-v14';
const ASSETS = [
  './', './index.html', './app.js', './fodmap.js', './manifest.json',
  './icon-192.png', './icon-512.png', './icon-maskable-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return; // Open Food Facts e.d. gaan direct naar het netwerk

  e.respondWith(caches.open(CACHE).then(async cache => {
    const cached = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) return cached;
    const res = await net;
    if (res) return res;
    return req.mode === 'navigate' ? (await cache.match('./index.html')) || Response.error() : Response.error();
  }));
});
