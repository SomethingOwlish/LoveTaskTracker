// Мелочи, общие для формы и фонового скрипта. Без Firebase.
import { USERS, userByEmail, partnerEmail } from '../../src/config.js';

// «Задача Гусику», «Поручить Совушке» — имена в дательном падеже.
const DATIVE = { 'Совушка': 'Совушке', 'Гусик': 'Гусику' };

export function person(email) {
  const info = userByEmail(email);
  if (!info) return null;
  const e = email.toLowerCase();
  return { uid: e, email: e, name: info.name, avatar: info.avatar, dative: DATIVE[info.name] || info.name };
}

export function partnerOf(email) {
  const p = partnerEmail(email);
  return p && USERS[p] ? person(p) : null;
}

// Длинное выделение не влезает в название: берём начало (до конца первого
// предложения, но не длиннее 100 символов), а весь текст кладём в описание.
export function taskFromText(raw) {
  const text = (raw || '').replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return { title: '', description: '' };
  const oneLine = text.replace(/\s*\n\s*/g, ' ');
  if (oneLine.length <= 120 && !text.includes('\n')) return { title: oneLine, description: '' };
  // несколько строк: короткая первая строка — готовое название
  const first = text.split('\n')[0].trim();
  if (text.includes('\n') && first.length >= 3 && first.length <= 100) return { title: first, description: text };
  const sentence = oneLine.match(/^(.{10,100}?[.!?…])(\s|$)/);
  const title = sentence ? sentence[1] : oneLine.slice(0, 100).replace(/\s+\S*$/, '') + '…';
  return { title, description: text };
}

/* ---------- Сроки (как в приложении: к 18:00) ---------- */
function at18(d) {
  d.setHours(18, 0, 0, 0);
  return d;
}
export const DEADLINES = {
  none: { label: 'Без срока', date: () => null },
  today: { label: 'Сегодня', date: () => at18(new Date()) },
  tomorrow: { label: 'Завтра', date: () => { const d = new Date(); d.setDate(d.getDate() + 1); return at18(d); } },
  week: {
    label: 'До воскресенья',
    date: () => {
      const d = new Date();
      d.setDate(d.getDate() + ((7 - d.getDay()) % 7));
      at18(d);
      if (d < new Date()) d.setDate(d.getDate() + 7); // воскресенье вечером → следующее
      return d;
    },
  },
};

// Матрица Эйзенхауэра: в приложении «важно/срочно» — это значение ≥ 0,
// поэтому «не важно» и «не срочно» — отрицательные.
export const QUADRANTS = {
  do: { label: 'Важно и срочно', importance: 3, urgency: 3 },
  plan: { label: 'Важно', importance: 3, urgency: -3 },
  delegate: { label: 'Срочно', importance: -3, urgency: 3 },
  later: { label: 'Потом', importance: -3, urgency: -3 },
};

export function splitTags(s) {
  return [...new Set((s || '').split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean))];
}

// Ссылки, которые не имеет смысла прикреплять к задаче.
export function isUsefulUrl(url) {
  return /^https?:\/\//.test(url || '');
}

// «Дюна (2024) — Кинопоиск» → «Дюна (2024)»: убираем хвост с названием сайта.
export function cleanPageTitle(title) {
  const t = (title || '').trim();
  const m = t.match(/^(.{5,}?)\s+[—–|·-]\s+[^—–|·]{2,30}$/);
  return m ? m[1] : t;
}
