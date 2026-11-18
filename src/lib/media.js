// Поиск фильмов/сериалов/игр через наш воркер (/api/media), который ходит в
// TMDB и RAWG. Ключи — только в секретах воркера.
import { auth } from '../firebase';

export async function searchMedia(kind, q) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch(`/api/media?kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 503 && j.error === 'no_key') {
    const e = new Error(j.key === 'RAWG_KEY' ? 'Поиск игр ещё не настроен (нет ключа RAWG).' : 'Поиск фильмов ещё не настроен (нет ключа TMDB).');
    e.code = 'no_key';
    throw e;
  }
  if (!r.ok) throw new Error(j.error || `Поиск не ответил (${r.status})`);
  return j.results || [];
}

// Поля, которые сохраняем в запись Мурмура из найденного
export const mediaFields = (m) => ({
  title: m.title,
  poster: m.poster || null,
  year: m.year || null,
  overview: m.overview || '',
  extRating: m.rating ?? null,
  link: m.link || null,
  extId: m.id,
});
