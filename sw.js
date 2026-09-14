// Service worker mínimo de Familia de Hamburguesa.
// Estrategia: SIEMPRE red primero. No cachea HTML, así nadie queda con una
// versión vieja de un módulo después de republicar. Solo guarda la última
// copia buena para mostrar algo si el celular se queda sin señal.
const CACHE = 'fdh-v1';

self.addEventListener('install', e => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match('/index.html')))
  );
});
