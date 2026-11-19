// Чистая логика настроения — без Firebase, чтобы её можно было тестировать.

// Набор состояний по умолчанию — пока человек не настроил свою легенду.
// Первые шесть id совпадают со старым набором: на них ссылаются уже
// сохранённые отметки, менять их нельзя.
export const DEFAULT_MOOD_LEGEND = [
  { id: 'great', color: '#f2c14e', label: 'Отлично' },
  { id: 'good', color: '#8cc084', label: 'Хорошо' },
  { id: 'calm', color: '#7fa7d1', label: 'Спокойно' },
  { id: 'tired', color: '#a58bc9', label: 'Устал(а)' },
  { id: 'sad', color: '#5f6f94', label: 'Грустно' },
  { id: 'angry', color: '#d9675b', label: 'Раздражение' },
  { id: 'love', color: '#f08fb0', label: 'Нежность' },
  { id: 'inspired', color: '#ff9f43', label: 'Вдохновение' },
  { id: 'energetic', color: '#3fc1b0', label: 'Бодро' },
  { id: 'cozy', color: '#d4a373', label: 'Уютно' },
  { id: 'hopeful', color: '#9fd3ef', label: 'Надежда' },
  { id: 'anxious', color: '#b8b26a', label: 'Тревожно' },
  { id: 'stressed', color: '#9c6644', label: 'Перегруз' },
  { id: 'lonely', color: '#8a97a8', label: 'Одиноко' },
  { id: 'bored', color: '#c8c3b8', label: 'Скучно' },
  { id: 'sick', color: '#9bc53d', label: 'Нездоровится' },
];

// Минимальная доля одного цвета дня в процентах — тоньше полосу не разглядеть.
export const MIN_SHARE = 5;

export function legendOf(legends, uid) {
  const l = legends?.[uid];
  return l && l.length ? l : DEFAULT_MOOD_LEGEND;
}

// Состояния из стандартного набора, которых нет в легенде, — их можно
// добавить к своей легенде одним нажатием.
export function missingDefaults(legend) {
  const ids = new Set(legend.map((x) => x.id));
  const labels = new Set(legend.map((x) => x.label.trim().toLowerCase()));
  return DEFAULT_MOOD_LEGEND.filter((x) => !ids.has(x.id) && !labels.has(x.label.toLowerCase()));
}

// Выбранные цвета записи. Новые записи хранят массив items, старые —
// один itemId/color/label на верхнем уровне.
export function moodItems(mood) {
  if (!mood) return [];
  if (Array.isArray(mood.items) && mood.items.length) return mood.items;
  if (mood.itemId || mood.color) return [{ itemId: mood.itemId, color: mood.color, label: mood.label }];
  return [];
}

export const moodIds = (mood) => moodItems(mood).map((x) => x.itemId);

// Отметка дня, показанная по легенде её владельца (подпись и цвет — из его
// текущей легенды; если пункт удалён — из снимка в самой записи).
export function resolveMood(mood, legends) {
  const raw = moodItems(mood);
  if (!raw.length) return null;
  const legend = legendOf(legends, mood.uid);
  const items = raw.map((r) => {
    const it = legend.find((x) => x.id === r.itemId);
    return { id: r.itemId, color: it?.color || r.color || '#888888', label: it?.label || r.label || '?' };
  });
  const pcts = moodShares(raw);
  items.forEach((x, i) => { x.pct = pcts[i]; });
  return { items, color: items[0].color, label: items.map((x) => x.label).join(', '), note: mood.note || '' };
}

// Целые проценты, в сумме ровно 100, пропорционально весам
// (остаток раздаём тем, у кого больше дробная часть).
export function toPercents(weights) {
  const w = weights.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = w.reduce((a, x) => a + x, 0);
  if (!w.length) return [];
  if (!sum) return toPercents(w.map(() => 1));
  const raw = w.map((x) => (x / sum) * 100);
  const out = raw.map(Math.floor);
  let rest = 100 - out.reduce((a, x) => a + x, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((p, q) => q[0] - p[0])
    .forEach(([, i]) => { if (rest > 0) { out[i] += 1; rest -= 1; } });
  return out;
}

// Доли цветов дня в процентах. Старые записи (без pct) — поровну.
export function moodShares(items) {
  if (!items.length) return [];
  const has = items.every((x) => Number.isFinite(x.pct) && x.pct > 0);
  return toPercents(has ? items.map((x) => x.pct) : items.map(() => 1));
}

const withShares = (items, pcts) => items.map((x, i) => ({ ...x, pct: pcts[i] }));

// Новый набор выбранных пунктов после нажатия на item: снять, если уже
// выбран (его доля делится между остальными пропорционально), иначе
// добавить — новый цвет получает равную долю, остальные ужимаются.
export function toggleMoodItem(current, item) {
  const shares = moodShares(current);
  const keep = current.map((x, i) => ({ ...x, pct: shares[i] })).filter((x) => x.itemId !== item.id);
  if (keep.length < current.length) return withShares(keep, toPercents(keep.map((x) => x.pct)));
  const n = keep.length + 1;
  const add = { itemId: item.id, color: item.color, label: item.label, pct: 100 / n };
  const next = [...keep.map((x) => ({ ...x, pct: x.pct * (1 - 1 / n) })), add];
  return withShares(next, toPercents(next.map((x) => x.pct)));
}

// Перетаскивание границы между полосами i и i+1: pos — где теперь граница,
// в процентах от начала полосы. Остальные доли не меняются.
export function moveShareBoundary(items, i, pos) {
  const pcts = moodShares(items);
  if (i < 0 || i >= pcts.length - 1) return items;
  const before = pcts.slice(0, i).reduce((a, x) => a + x, 0);
  const pair = pcts[i] + pcts[i + 1];
  const left = Math.min(pair - MIN_SHARE, Math.max(MIN_SHARE, Math.round(pos - before)));
  if (left === pcts[i]) return items;
  pcts[i] = left;
  pcts[i + 1] = pair - left;
  return withShares(items, pcts);
}

export function moodIndex(moods) {
  const m = {};
  moods.forEach((x) => { m[`${x.uid}_${x.day}`] = x; });
  return m;
}

// CSS-градиент: цвета дня вертикальными полосами слева направо,
// ширина полосы — доля цвета. Принимает цвета или {color, pct}.
export function stripes(list) {
  if (!list.length) return null;
  const items = list.map((x) => (typeof x === 'string' ? { color: x } : x));
  if (items.length === 1) return `linear-gradient(${items[0].color}, ${items[0].color})`;
  const pcts = moodShares(items);
  let at = 0;
  const stops = items.map((x, i) => {
    const from = at;
    at += pcts[i];
    return `${x.color} ${from}% ${at}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Фон ячейки календаря. Для двоих: левая половина — первый, правая — второй,
// между ними тонкий просвет, чтобы полосы двух людей не сливались.
export function moodCellStyle(a, b, whose) {
  const ia = a ? a.items : [];
  const ib = b ? b.items : [];
  if (whose === 'me') return ia.length ? { background: stripes(ia) } : undefined;
  if (whose === 'partner') return ib.length ? { background: stripes(ib) } : undefined;
  if (!ia.length && !ib.length) return undefined;
  const none = 'linear-gradient(transparent, transparent)';
  return {
    backgroundImage: `${ia.length ? stripes(ia) : none}, ${ib.length ? stripes(ib) : none}`,
    backgroundSize: 'calc(50% - 1px) 100%, calc(50% - 1px) 100%',
    backgroundPosition: 'left, right',
    backgroundRepeat: 'no-repeat',
  };
}

// Сколько дней месяца отмечено каждым пунктом (день с двумя цветами
// засчитывается обоим).
export function monthCounts(moods, uid, year, month) {
  const counts = {};
  moods.forEach((m) => {
    if (m.uid !== uid) return;
    const [y, mo] = m.day.split('-').map(Number);
    if (y !== year || mo - 1 !== month) return;
    new Set(moodIds(m)).forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
  });
  return counts;
}

// Показывать ли сегодня тост-напоминание: отметки нет и сегодня ещё не напоминали.
export function shouldRemind({ loaded, marked, remindedDay, today }) {
  return !!loaded && !marked && remindedDay !== today;
}
