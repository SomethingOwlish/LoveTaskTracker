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

// Сколько цветов можно отметить за один день: больше в ячейку календаря
// уже не поместится различимо.
export const MAX_MOODS_PER_DAY = 4;

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
  return { items, color: items[0].color, label: items.map((x) => x.label).join(', '), note: mood.note || '' };
}

// Новый набор выбранных пунктов после нажатия на item: снять, если уже
// выбран; добавить, если есть место; иначе заменить самый старый.
export function toggleMoodItem(current, item, max = MAX_MOODS_PER_DAY) {
  const list = current.filter((x) => x.itemId !== item.id);
  if (list.length < current.length) return list;
  const next = [...list, { itemId: item.id, color: item.color, label: item.label }];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function moodIndex(moods) {
  const m = {};
  moods.forEach((x) => { m[`${x.uid}_${x.day}`] = x; });
  return m;
}

// CSS-градиент: цвета дня равными вертикальными полосами.
export function stripes(colors) {
  if (!colors.length) return null;
  if (colors.length === 1) return `linear-gradient(${colors[0]}, ${colors[0]})`;
  const w = 100 / colors.length;
  const stops = colors.map((c, i) => `${c} ${+(i * w).toFixed(2)}% ${+((i + 1) * w).toFixed(2)}%`);
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// Фон ячейки календаря. Для двоих: верхняя половина — первый, нижняя — второй.
export function moodCellStyle(a, b, whose) {
  const ca = a ? a.items.map((x) => x.color) : [];
  const cb = b ? b.items.map((x) => x.color) : [];
  if (whose === 'me') return ca.length ? { background: stripes(ca) } : undefined;
  if (whose === 'partner') return cb.length ? { background: stripes(cb) } : undefined;
  if (!ca.length && !cb.length) return undefined;
  const none = 'linear-gradient(transparent, transparent)';
  return {
    backgroundImage: `${ca.length ? stripes(ca) : none}, ${cb.length ? stripes(cb) : none}`,
    backgroundSize: '100% 50%, 100% 50%',
    backgroundPosition: 'top, bottom',
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
