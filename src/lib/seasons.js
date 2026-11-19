// Сезоны и серии сериалов в Мурмуре. Общий модуль: им пользуются воркер
// (разбор ответа TMDB) и приложение (прогресс, отметки серий).
//
// В записи Мурмура:
//   seasons:  [{ n: 1, eps: 10, aired: 10 }, …] — номер сезона, серий всего, вышло;
//   tvStatus: 'ended' | 'ongoing' | null;
//   watched:  { s1: [1, 2, 3], s2: [1] } — какие серии посмотрели (вместе, отметка общая);
//   epAt:     { s1e3: 1763...ms } — когда серию отметили (для монет в игре).
// Спецвыпуски (сезон 0) не берём. У старых записей seasons/watched нет — всё работает.

// /tv/{id} в TMDB → { seasons, tvStatus }
export function parseTmdbSeasons(tv) {
  const last = tv?.last_episode_to_air || null;
  const list = (tv?.seasons || [])
    .filter((s) => Number.isInteger(s?.season_number) && s.season_number > 0 && s.episode_count > 0)
    .sort((a, b) => a.season_number - b.season_number);
  const seasons = list.map((s) => {
    const n = s.season_number;
    const eps = s.episode_count;
    let aired = eps;
    if (last && Number.isInteger(last.season_number)) {
      if (n > last.season_number) aired = 0;
      else if (n === last.season_number) aired = Math.min(eps, Math.max(0, last.episode_number || 0));
    } else if (s.air_date === null || (s.air_date && s.air_date > new Date().toISOString().slice(0, 10))) {
      aired = 0; // сезон ещё не вышел, а данных о последней серии нет
    }
    return { n, eps, aired };
  });
  const st = tv?.status || '';
  const tvStatus = /ended|canceled|cancelled/i.test(st) ? 'ended' : st ? 'ongoing' : null;
  return { seasons, tvStatus };
}

export const seasonKey = (n) => `s${n}`;
export const fmtEp = (s, e) => `S${s}E${e}`;

export const hasSeasons = (item) => Array.isArray(item?.seasons) && item.seasons.length > 0;

// Сколько серий сезона можно смотреть (вышедшие; если не знаем — все)
const airedOf = (s) => (Number.isInteger(s.aired) ? s.aired : s.eps);

export function watchedIn(item, n) {
  const w = item?.watched?.[seasonKey(n)];
  return Array.isArray(w) ? w : [];
}

export function isWatched(item, n, e) {
  return watchedIn(item, n).includes(e);
}

// Прогресс по сериалу: сколько посмотрели из вышедших, последняя и следующая серия.
export function seriesProgress(item) {
  if (!hasSeasons(item)) return null;
  let total = 0, seen = 0, last = null, next = null;
  for (const s of item.seasons) {
    const aired = airedOf(s);
    const w = new Set(watchedIn(item, s.n));
    total += aired;
    for (let e = 1; e <= aired; e++) {
      if (w.has(e)) { seen++; last = { s: s.n, e }; } else if (!next) next = { s: s.n, e };
    }
  }
  // следующая — первая непросмотренная после последней просмотренной (пропуски не тормозят)
  if (last) {
    next = null;
    for (const s of item.seasons) {
      if (s.n < last.s) continue;
      const w = new Set(watchedIn(item, s.n));
      for (let e = s.n === last.s ? last.e + 1 : 1; e <= airedOf(s) && !next; e++) if (!w.has(e)) next = { s: s.n, e };
      if (next) break;
    }
  }
  const pct = total ? Math.round((seen / total) * 100) : 0;
  return { seen, total, pct, last, next, complete: total > 0 && seen >= total };
}

// «S2E5 · 37%» — для карточки. null, если ещё ничего не смотрели.
export function progressLabel(p) {
  if (!p || !p.last) return null;
  return `${fmtEp(p.last.s, p.last.e)} · ${p.pct}%`;
}

// Новый список серий сезона после нажатия на серию e
export function toggleEpisode(list, e) {
  const cur = Array.isArray(list) ? list : [];
  return cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e].sort((a, b) => a - b);
}

// Весь сезон: если досмотрен — снять отметки, иначе отметить все вышедшие
export function toggleSeason(item, n) {
  const s = (item.seasons || []).find((x) => x.n === n);
  if (!s) return [];
  const aired = airedOf(s);
  const w = watchedIn(item, n);
  const full = aired > 0 && Array.from({ length: aired }, (_, i) => i + 1).every((e) => w.includes(e));
  return full ? [] : Array.from({ length: aired }, (_, i) => i + 1);
}

// Отметить всё до серии (n, e) включительно — патч для поля watched целиком
export function watchedUpTo(item, n, e) {
  const out = { ...(item.watched || {}) };
  for (const s of item.seasons || []) {
    if (s.n > n) continue;
    const upto = s.n === n ? Math.min(e, airedOf(s)) : airedOf(s);
    const set = new Set(watchedIn(item, s.n));
    for (let i = 1; i <= upto; i++) set.add(i);
    out[seasonKey(s.n)] = [...set].sort((a, b) => a - b);
  }
  return out;
}

export const epKey = (s, e) => `s${s}e${e}`;

// Патч для epAt при смене watched: новым отметкам — время, снятым — del.
// Ключи с точкой — для updateDoc ('epAt.s1e3').
export function epAtPatch(oldWatched, newWatched, now, del) {
  const patch = {};
  const keys = new Set([...Object.keys(oldWatched || {}), ...Object.keys(newWatched || {})]);
  keys.forEach((k) => {
    const n = Number(k.slice(1));
    if (!Number.isInteger(n)) return;
    const before = new Set(Array.isArray(oldWatched?.[k]) ? oldWatched[k] : []);
    const after = new Set(Array.isArray(newWatched?.[k]) ? newWatched[k] : []);
    after.forEach((e) => { if (!before.has(e)) patch[`epAt.${epKey(n, e)}`] = now; });
    before.forEach((e) => { if (!after.has(e)) patch[`epAt.${epKey(n, e)}`] = del; });
  });
  return patch;
}
