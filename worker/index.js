// Cloudflare Worker: отдаёт собранное приложение (dist) как статику и
// проксирует служебные пути Firebase Auth (/__/auth/*, /__/firebase/*) на
// tasktrackergando.firebaseapp.com.
//
// Зачем: вход через Google открывает страницу /__/auth/handler. Если она живёт
// на другом домене, Safari (особенно в приложении «на экране Домой») режет
// стороннее хранилище, и вход срывается. Через прокси страница входа оказывается
// на том же домене, что и приложение — это рекомендованный Firebase вариант
// «reverse proxy» (см. firebase.google.com/docs/auth/web/redirect-best-practices).
//
// Воркер вызывается только для /__/* (run_worker_first в wrangler.jsonc),
// все остальные запросы — бесплатная статика и в лимит воркеров не входят.

const FIREBASE_HOST = 'tasktrackergando.firebaseapp.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/__/')) {
      const target = new URL(url.pathname + url.search, `https://${FIREBASE_HOST}`);
      const headers = new Headers(request.headers);
      headers.delete('host');
      const res = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        redirect: 'manual',
      });
      return res;
    }
    return env.ASSETS.fetch(request);
  },
};
