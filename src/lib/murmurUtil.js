// Сколько записей ждут моей оценки (партнёр отметил просмотренным, я ещё нет).
export function murmurAwaitingMe(items, uid) {
  return items.filter((x) => x.status === 'done' && x.ratings?.[uid] == null).length;
}

// Новая запись Мурмура — общая для приложения и расширения Chrome.
// serverTimestamp передаётся снаружи (у firestore и firestore/lite он свой).
// poster / year / source заполняет расширение, когда берёт фильм или игру со страницы.
export function buildMurmurDoc({ kind, title, note = '', link = '', uid, poster = null, year = null, source = null }, { serverTimestamp }) {
  const t = (title || '').trim();
  if (!t) return null;
  return {
    kind, title: t, note, link: link || null,
    poster: poster || null, year: year || null, source: source || null,
    addedBy: uid, wantedBy: [uid],
    status: 'want', ratings: {}, reviews: {},
    createdAt: serverTimestamp(), doneAt: null, doneBy: null,
  };
}
