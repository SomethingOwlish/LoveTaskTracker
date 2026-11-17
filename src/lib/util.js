// Утилиты дат и приоритетов.

export function toDate(ts) {
  if (!ts) return null;
  if (ts.toDate) return ts.toDate();
  return new Date(ts);
}

// Время в миллисекундах. У свежесозданного документа serverTimestamp ещё
// null — считаем его «самым свежим», чтобы он был сверху и помечался непрочитанным.
export function tsMs(ts) {
  if (!ts) return Number.MAX_SAFE_INTEGER;
  return ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
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

// Ключ дня в локальной зоне: 2026-11-17
export function dayKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export function fromDayKey(k) {
  const [y, m, d] = k.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}
export function endOfToday() {
  const x = new Date();
  x.setHours(23, 59, 0, 0);
  return x;
}
export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}
export function fmtWeekday(d) {
  return ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'][d.getDay()];
}

const moneyFmt = new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 2, minimumFractionDigits: 0 });
export function fmtMoney(n) {
  return moneyFmt.format(Math.round((Number(n) || 0) * 100) / 100);
}
// «1 234,5» / «1234.50» / «1 234 ₽» → 1234.5
export function parseMoney(s) {
  if (typeof s === 'number') return s;
  const v = Number(String(s || '').replace(/[\s ₽]/g, '').replace(',', '.'));
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : NaN;
}
export const uid6 = () => Math.random().toString(36).slice(2, 8);
