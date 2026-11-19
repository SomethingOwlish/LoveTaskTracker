// Сколько записей ждут моей оценки (партнёр отметил просмотренным, я ещё нет).
export function murmurAwaitingMe(items, uid) {
  return items.filter((x) => x.status === 'done' && x.ratings?.[uid] == null).length;
}

// Новая запись Мурмура — общая для приложения и расширения Chrome.
// serverTimestamp передаётся снаружи (у firestore и firestore/lite он свой).
// poster / year / source заполняет расширение, когда берёт фильм или игру со страницы;
// media — то, что нашёл поиск TMDB/RAWG в приложении (см. lib/media.js mediaFields).
export function buildMurmurDoc({ kind, title, note = '', link = '', uid, poster = null, year = null, source = null, media = null }, { serverTimestamp }) {
  const t = (title || '').trim();
  if (!t) return null;
  return {
    kind, title: t, note, link: link || null,
    poster: poster || null, year: year || null, source: source || null,
    ...(media || {}), // найденное поиском в приложении: постер, год, описание, рейтинг…
    addedBy: uid, wantedBy: [uid],
    status: 'want', ratings: {}, reviews: {},
    createdAt: serverTimestamp(), doneAt: null, doneBy: null,
  };
}

// «Повторить»: новая карточка «Заново …» из уже просмотренной/пройденной.
// Старая запись с оценками и отзывами остаётся в архиве как есть.
// Сезоны сериала берём, отметки серий — нет: смотрим с начала.
const AGAIN_KEEP = ['kind', 'title', 'note', 'link', 'poster', 'year', 'source', 'overview', 'extRating', 'extId', 'seasons', 'tvStatus'];
export function againDoc(item, uid, { serverTimestamp }) {
  const copy = {};
  AGAIN_KEEP.forEach((k) => { if (item[k] !== undefined) copy[k] = item[k]; });
  return {
    ...copy,
    again: true, againOf: item.id || null,
    addedBy: uid, wantedBy: [uid],
    status: 'want', ratings: {}, reviews: {},
    createdAt: serverTimestamp(), doneAt: null, doneBy: null,
  };
}

// Та же ли это вещь, что уже лежит в Мурмуре? Ремейки и одноимённые сериалы —
// разные записи, поэтому одного названия мало:
// 1) есть ID базы (extId вида «tmdb:movie:123») у обоих — решает он;
// 2) иначе название + год + тип (фильм / сериал / игра). Год без него —
//    не совпадение: лучше редкий дубль, чем ремейк, который нельзя добавить.
const normTitle = (t) => String(t || '').trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const normYear = (y) => { const n = parseInt(y, 10); return Number.isFinite(n) ? n : null; };
export function sameMurmur(item, cand) {
  if (!item || !cand) return false;
  if (item.extId && cand.extId) return item.extId === cand.extId;
  if (item.kind !== cand.kind) return false;
  if (normTitle(item.title) !== normTitle(cand.title)) return false;
  const a = normYear(item.year), b = normYear(cand.year);
  return a != null && a === b;
}

// Заголовок карточки: «Заново» перед названием у повтора.
export const murmurTitle = (item) => (item.again ? `Заново: ${item.title}` : item.title);

// Порядок «Хотим»: начатые игры, затем то, что хотят оба, затем новые.
export function wantOrder(a, b, ms) {
  return (b.startedAt ? 1 : 0) - (a.startedAt ? 1 : 0)
    || (b.wantedBy?.length || 0) - (a.wantedBy?.length || 0)
    || ms(b.createdAt) - ms(a.createdAt);
}
