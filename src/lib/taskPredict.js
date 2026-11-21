// Угадать проект (категорию) задачи по названию: ищем прошлые задачи с
// похожими словами и берём их проекты. Слова грубо «стеммим» — первые 5 букв,
// чтобы «купить продукты» и «продуктов» совпадали.
const words = (s) => (s || '').toLowerCase().replace(/ё/g, 'е')
  .split(/[^a-zа-я0-9]+/).filter((w) => w.length >= 3).map((w) => w.slice(0, 5));

export function predictProjects(title, tasks, known = [], limit = 3) {
  const ws = new Set(words(title));
  if (!ws.size) return [];
  const score = {};
  const add = (p, v) => { score[p] = (score[p] || 0) + v; };
  tasks.forEach((t) => {
    const proj = t.projectTags || [];
    if (!proj.length) return;
    const tw = new Set(words(t.title));
    let hit = 0;
    ws.forEach((w) => { if (tw.has(w)) hit += 1; });
    if (hit) proj.forEach((p) => add(p, hit));
  });
  // название проекта прямо в тексте задачи — сильный сигнал
  known.forEach((p) => { if (words(p).some((w) => ws.has(w))) add(p, 3); });
  return Object.entries(score).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([p]) => p);
}

// Строки списка → названия задач (маркеры «- », «• », «1. » убираем)
export const splitLines = (text) => (text || '').split('\n')
  .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);
