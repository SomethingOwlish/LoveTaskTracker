// /api/media — поиск фильмов/сериалов (TMDB) и игр (RAWG) для Мурмура.
// Ключи живут только в секретах воркера (TMDB_TOKEN, RAWG_KEY), в коде и в
// браузере их нет. Запрос пускаем только с действующим входом Firebase
// одного из двух аккаунтов — чтобы чужие не тратили ваши лимиты.

const PROJECT = 'tasktrackergando';
const ALLOWED = ['argentummortis@gmail.com', 'arentakasi@gmail.com'];
const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let jwksCache = { keys: null, until: 0 };
async function jwks() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const r = await fetch(JWKS_URL);
  const j = await r.json();
  jwksCache = { keys: j.keys, until: Date.now() + 3600 * 1000 };
  return j.keys;
}

const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

// Проверка ID-токена Firebase (RS256, ключи Google). Возвращает email или null.
export async function verifyFirebaseToken(token) {
  try { return await verify(token); } catch { return null; } // битый токен → просто «нет входа»
}
async function verify(token) {
  const [h, p, sig] = (token || '').split('.');
  if (!sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== PROJECT || payload.iss !== `https://securetoken.google.com/${PROJECT}`) return null;
  if (!(payload.exp > now) || !(payload.iat <= now + 60)) return null;
  const jwk = (await jwks()).find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  const email = (payload.email || '').toLowerCase();
  return ok && payload.email_verified && ALLOWED.includes(email) ? email : null;
}

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'private, max-age=300' },
});

async function tmdb(kind, q, env) {
  const path = kind === 'series' ? 'tv' : 'movie';
  const u = new URL(`https://api.themoviedb.org/3/search/${path}`);
  u.searchParams.set('query', q);
  u.searchParams.set('language', 'ru-RU');
  u.searchParams.set('include_adult', 'false');
  const r = await fetch(u, { headers: { Authorization: `Bearer ${env.TMDB_TOKEN}`, accept: 'application/json' } });
  if (!r.ok) throw new Error(`TMDB ${r.status}`);
  const j = await r.json();
  return (j.results || []).slice(0, 6).map((x) => ({
    id: `tmdb:${path}:${x.id}`,
    title: x.title || x.name,
    original: x.original_title || x.original_name,
    year: (x.release_date || x.first_air_date || '').slice(0, 4),
    poster: x.poster_path ? `https://image.tmdb.org/t/p/w185${x.poster_path}` : null,
    overview: (x.overview || '').slice(0, 400),
    rating: x.vote_average ? Math.round(x.vote_average * 10) / 10 : null,
    link: `https://www.themoviedb.org/${path}/${x.id}`,
  }));
}

async function rawg(q, env) {
  const u = new URL('https://api.rawg.io/api/games');
  u.searchParams.set('key', env.RAWG_KEY);
  u.searchParams.set('search', q);
  u.searchParams.set('page_size', '6');
  const r = await fetch(u);
  if (!r.ok) throw new Error(`RAWG ${r.status}`);
  const j = await r.json();
  return (j.results || []).map((x) => ({
    id: `rawg:${x.id}`,
    title: x.name,
    year: (x.released || '').slice(0, 4),
    poster: x.background_image ? x.background_image.replace('/media/', '/media/crop/600/400/') : null,
    overview: (x.genres || []).map((g) => g.name).join(', '),
    rating: x.metacritic || null,
    link: `https://rawg.io/games/${x.slug}`,
  }));
}

export async function handleMedia(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!(await verifyFirebaseToken(token))) return json({ error: 'unauthorized' }, 401);
  const url = new URL(request.url);
  const kind = url.searchParams.get('kind');
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  if (!q) return json({ results: [] });
  if (kind === 'game') {
    if (!env.RAWG_KEY) return json({ error: 'no_key', key: 'RAWG_KEY' }, 503);
    return json({ results: await rawg(q, env) });
  }
  if (!env.TMDB_TOKEN) return json({ error: 'no_key', key: 'TMDB_TOKEN' }, 503);
  return json({ results: await tmdb(kind, q, env) });
}
