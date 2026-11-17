// Сколько записей ждут моей оценки (партнёр отметил просмотренным, я ещё нет).
export function murmurAwaitingMe(items, uid) {
  return items.filter((x) => x.status === 'done' && x.ratings?.[uid] == null).length;
}
