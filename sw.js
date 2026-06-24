// Простой service worker: кэшируем оболочку приложения для офлайн-открытия.
// Данные всё равно тянутся из Firestore при наличии сети.
const CACHE = 'ltt-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Никогда не кэшируем запросы Firebase/Google — только статику своего origin.
  if (url.origin !== self.location.origin) return;
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
