// Утилиты дат и приоритетов.

export function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  return new Date(ts);
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function startOfWeek(d = new Date()) {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // понедельник = 0
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - day);
  return x;
}
export function startOfToday() {
  const x = new Date();
  x.setHours(0, 0, 0, 0);
  return x;
}

const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_NOM = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
export const DOW = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

export function fmtDate(d) {
  if (!d) return null;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
export function fmtDateTime(d) {
  if (!d) return null;
  const t = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${fmtDate(d)}, ${t}`;
}
export function monthTitle(d) {
  return `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
}

// для <input type="datetime-local"> нужен формат YYYY-MM-DDTHH:mm
export function toLocalInput(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Квадрант матрицы по знакам важности/срочности.
export function quadrant(importance, urgency) {
  const imp = importance >= 0;
  const urg = urgency >= 0;
  if (imp && urg) return { key: 'do', label: 'Делать сейчас' };
  if (imp && !urg) return { key: 'plan', label: 'Запланировать' };
  if (!imp && urg) return { key: 'deleg', label: 'Делегировать' };
  return { key: 'drop', label: 'Можно не делать' };
}

export const ACTIVE_STATUSES = ['open', 'in_progress', 'returned', 'in_review'];
export function isActive(t) { return ACTIVE_STATUSES.includes(t.status); }
export function isClosed(t) { return t.status === 'done' || t.status === 'approved'; }

// Проекты конкретного человека = те, что встречаются на задачах,
// где он автор или исполнитель.
export function projectsOf(tasks, uid) {
  const s = new Set();
  tasks.forEach((t) => {
    if (t.authorUid === uid || t.assigneeUid === uid) (t.projectTags || []).forEach((p) => s.add(p));
  });
  return [...s].sort();
}
export function allTags(tasks) {
  const s = new Set();
  tasks.forEach((t) => (t.tags || []).forEach((x) => s.add(x)));
  return [...s].sort();
}
