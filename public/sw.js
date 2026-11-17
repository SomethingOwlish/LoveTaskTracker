// Простой service worker: кэшируем оболочку приложения для офлайн-открытия.
// Данные всё равно тянутся из Firestore при наличии сети.
const CACHE = 'ltt-v3';
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
  // служебные страницы входа Firebase — всегда из сети и никогда не в кэш
  if (url.pathname.startsWith('/__/')) return;

  // HTML — сначала сеть: иначе после деплоя телефон показывает старую версию
  // до второго перезапуска. Без сети — из кэша.
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Ассеты с хэшем в имени не меняются — кэш, затем сеть.
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
