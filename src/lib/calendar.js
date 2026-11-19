// Логика календаря без React и Firestore — чтобы её можно было тестировать.
// Дни храним ключами YYYY-MM-DD (как в настроении): они не зависят от
// часового пояса и сравниваются как строки.
import { dayKey, fromDayKey, addDays, toDate } from './util';

// 6 недель по 7 дней, начиная с понедельника недели, в которой 1-е число.
export function monthGrid(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1, 12);
  const start = addDays(first, -((first.getDay() + 6) % 7));
  const weeks = [];
  for (let w = 0; w < 6; w++) {
    const week = [];
    for (let i = 0; i < 7; i++) week.push(dayKey(addDays(start, w * 7 + i)));
    weeks.push(week);
  }
  return weeks;
}

// Старые однодневные события (коллекция events: { title, date }) → общий вид.
export function normalizeLegacyEvent(e) {
  const d = toDate(e.date);
  if (!d) return null;
  const k = dayKey(d);
  return { ...e, start: k, end: k, legacy: true };
}

// Событие с поправкой на перепутанные даты: конец не раньше начала.
export function eventRange(e) {
  const start = e.start;
  const end = e.end && e.end >= start ? e.end : start;
  return { start, end };
}

export function eventOnDay(e, key) {
  const { start, end } = eventRange(e);
  return start <= key && key <= end;
}

export function eventDays(e) {
  const { start, end } = eventRange(e);
  return Math.round((fromDayKey(end) - fromDayKey(start)) / 86400000) + 1;
}

/* Раскладка событий недели по дорожкам (полоски в сетке).
   Возвращает { bars: [{ ev, col, span, lane, cont, more }], hidden: {key: n} }:
   col — 1..7, span — сколько дней в этой неделе, cont/more — событие
   началось раньше / продолжается дальше этой недели. Всё, что не влезло
   в maxLanes дорожек, считается в hidden по дням. */
export function layoutWeek(events, week, maxLanes = 3) {
  const first = week[0];
  const last = week[week.length - 1];
  const segs = events
    .map((ev) => ({ ev, ...eventRange(ev) }))
    .filter((s) => s.start <= last && s.end >= first)
    .map((s) => {
      const from = s.start < first ? first : s.start;
      const to = s.end > last ? last : s.end;
      const col = week.indexOf(from) + 1;
      const span = week.indexOf(to) - week.indexOf(from) + 1;
      return { ev: s.ev, col, span, cont: s.start < first, more: s.end > last };
    })
    // длинные — выше, чтобы полоски не рвались
    .sort((a, b) => a.col - b.col || b.span - a.span || String(a.ev.title).localeCompare(String(b.ev.title)));

  const lanes = []; // lanes[i] = последний занятый столбец
  const bars = [];
  const hidden = {};
  segs.forEach((s) => {
    let lane = lanes.findIndex((end) => end < s.col);
    if (lane === -1) { lane = lanes.length; lanes.push(0); }
    lanes[lane] = s.col + s.span - 1;
    if (lane < maxLanes) bars.push({ ...s, lane });
    else for (let i = 0; i < s.span; i++) { const k = week[s.col - 1 + i]; hidden[k] = (hidden[k] || 0) + 1; }
  });
  return { bars, hidden };
}

// Задачи, которые попадают в календарь: со сроком и из выбранных проектов.
export function calendarTasks(tasks, projects) {
  const set = new Set(projects || []);
  if (!set.size) return [];
  return tasks.filter((t) => t.deadline && (t.projectTags || []).some((p) => set.has(p)));
}

// Подпись диапазона: «18 ноября» или «18 – 20 ноября» / «30 ноября – 2 декабря».
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function fmtRange(start, end) {
  const a = fromDayKey(start);
  const b = fromDayKey(end || start);
  if (start === (end || start)) return `${a.getDate()} ${MONTHS[a.getMonth()]}`;
  if (a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear()) return `${a.getDate()} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
  return `${a.getDate()} ${MONTHS[a.getMonth()]} – ${b.getDate()} ${MONTHS[b.getMonth()]}`;
}

// Поля события для записи в calEvents (без служебных меток времени).
export function cleanEventData(data) {
  const start = data.start;
  const end = data.end && data.end >= start ? data.end : start;
  return {
    title: (data.title || '').trim().slice(0, 300) || 'Событие',
    description: (data.description || '').slice(0, 4000),
    start,
    end,
    participants: Array.isArray(data.participants) ? data.participants : [],
    color: data.color || null,
    link: (data.link || '').trim() || null,
  };
}
