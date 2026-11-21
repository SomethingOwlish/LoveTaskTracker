// Повтор задачи. Стандартные: daily / weekly / biweekly / monthly.
// Свой интервал: 'every:N:u', где u — d (дни), w (недели), m (месяцы),
// например 'every:3:d' — раз в три дня.

export function parseEvery(kind) {
  const m = /^every:(\d+):([dwm])$/.exec(kind || '');
  if (!m) return null;
  const n = Math.max(1, Math.min(365, Number(m[1])));
  return { n, unit: m[2] };
}
// По дням недели: 'days:1,3,5' (0 — воскресенье, как в Date.getDay)
export function parseDays(kind) {
  const m = /^days:([0-6](?:,[0-6])*)$/.exec(kind || '');
  return m ? [...new Set(m[1].split(',').map(Number))].sort() : null;
}
export const daysKind = (list) => (list.length ? `days:${[...new Set(list)].sort().join(',')}` : 'none');
export const DOW_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];

export const everyKind = (n, unit) => `every:${Math.max(1, Math.min(365, Math.round(Number(n)) || 1))}:${unit}`;

function addMonths(d, n) {
  // 31 января + месяц = 28/29 февраля, а не 3 марта
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
}

// Пересчёт следующей даты для повторяющейся задачи.
export function nextRecurrence(base, kind) {
  const d = new Date(base.getTime());
  const days = parseDays(kind);
  if (days) {
    // ближайший следующий день из списка (не сегодня)
    for (let i = 0; i < 7; i += 1) {
      d.setDate(d.getDate() + 1);
      if (days.includes(d.getDay())) break;
    }
    return d;
  }
  const ev = parseEvery(kind);
  if (ev) {
    if (ev.unit === 'd') d.setDate(d.getDate() + ev.n);
    if (ev.unit === 'w') d.setDate(d.getDate() + 7 * ev.n);
    if (ev.unit === 'm') addMonths(d, ev.n);
    return d;
  }
  switch (kind) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly':
      addMonths(d, 1);
      break;
    default:
      break;
  }
  return d;
}

// Следующая дата строго в будущем: если задачу закрыли с опозданием на
// несколько периодов, новая не должна сразу оказаться просроченной.
export function nextFutureRecurrence(base, kind, now = new Date()) {
  let d = nextRecurrence(base, kind);
  let guard = 0;
  while (d <= now && guard++ < 1000) d = nextRecurrence(d, kind);
  return d;
}

export const RECURRENCE_LABEL = {
  none: 'Без повтора',
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  biweekly: 'Раз в две недели',
  monthly: 'Каждый месяц',
};

// «раз в 3 дня» / «раз в 2 недели» / «раз в 6 месяцев»
function plural(n, one, few, many) {
  const a = n % 10; const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
const UNIT_WORDS = { d: ['день', 'дня', 'дней'], w: ['неделю', 'недели', 'недель'], m: ['месяц', 'месяца', 'месяцев'] };
export function recurrenceLabel(kind) {
  const days = parseDays(kind);
  if (days) {
    if (days.length === 7) return 'Каждый день';
    // с понедельника
    const order = [1, 2, 3, 4, 5, 6, 0].filter((x) => days.includes(x));
    if (order.join() === '1,2,3,4,5') return 'По будням';
    if (order.join() === '6,0') return 'По выходным';
    return 'По ' + order.map((x) => DOW_SHORT[x]).join(', ');
  }
  const ev = parseEvery(kind);
  if (!ev) return RECURRENCE_LABEL[kind] || RECURRENCE_LABEL.none;
  const w = plural(ev.n, ...UNIT_WORDS[ev.unit]);
  return ev.n === 1 ? `Раз в ${w}` : `Раз в ${ev.n} ${w}`;
}
