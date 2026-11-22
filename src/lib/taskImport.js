/* Разбор списка задач из текста — общий для приложения и расширения.
   Откуда текст: артефакт Claude, заметка, письмо — что угодно, что
   перетащили, вставили или выделили.

   Что понимаем:
   - пункты списка (- * + • 1. 1)) и чекбоксы «- [ ]» → задачи;
     уже отмеченные «- [x]» пропускаем;
   - вложенные пункты → чеклист задачи;
   - заголовки «## …» → проектный тег для задач под ними;
   - «@Гусик», «@Совушке», «@себе» → кому;
   - «сегодня», «завтра», «послезавтра», «до 20.11», «к пятнице» → срок;
   - отдельный «!» или «!!» → важно;
   - ссылка в пункте → ссылка задачи;
   - блок ```lovetasks с JSON — точный формат без угадываний.
   Если в тексте нет ни одного пункта списка — каждая строка будет задачей. */

const L = '\\p{L}\\p{N}';
// граница слова для кириллицы (\b в JS работает только с латиницей)
const B0 = `(?<![${L}])`;
const B1 = `(?![${L}])`;

const WEEKDAYS = [
  ['воскресен', 0], ['понедельн', 1], ['вторн', 2], ['сред', 3],
  ['четверг', 4], ['пятниц', 5], ['суббот', 6],
];

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x;
}
function addDays(now, n) {
  const x = new Date(now);
  x.setDate(x.getDate() + n);
  return endOfDay(x);
}

// «20.11», «20.11.26», «2026-11-20». Прошедшая дата без года — на следующий год.
function numericDate(s, now) {
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validDate(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/);
  if (!m) return null;
  const day = +m[1];
  const month = +m[2];
  if (m[3]) return validDate(m[3].length === 2 ? 2000 + +m[3] : +m[3], month, day);
  const d = validDate(now.getFullYear(), month, day);
  if (d && d < addDays(now, -60)) d.setFullYear(d.getFullYear() + 1);
  return d;
}
function validDate(y, mo, d) {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const x = new Date(y, mo - 1, d, 23, 59, 0, 0);
  return x.getMonth() === mo - 1 ? x : null;
}

function weekdayDate(word, now) {
  const w = word.toLowerCase();
  const hit = WEEKDAYS.find(([stem]) => w.startsWith(stem));
  if (!hit) return null;
  let diff = (hit[1] - now.getDay() + 7) % 7;
  if (diff === 0) diff = 7; // «к пятнице» в пятницу — это следующая
  return addDays(now, diff);
}

const RELATIVE = { 'сегодня': 0, 'завтра': 1, 'послезавтра': 2 };

const DATE_RE = new RegExp(
  `${B0}(?:(?:до|к|ко|в|во|на)\\s+)?(сегодня|послезавтра|завтра)${B1}` +
  `|${B0}(?:(?:до|к|ко|в|во|на)\\s+)(\\p{L}+)${B1}` +
  `|${B0}(?:(?:до|к|на)\\s+)?(\\d{4}-\\d{1,2}-\\d{1,2}|\\d{1,2}[./]\\d{1,2}(?:[./](?:\\d{4}|\\d{2}))?)(?![\\d./])`,
  'giu',
);

// Найти срок в строке. Возвращает { deadline, rest } — строку без найденного.
export function extractDeadline(text, now = new Date()) {
  let deadline = null;
  const rest = text.replace(DATE_RE, (all, rel, word, num) => {
    if (deadline) return all;
    let d = null;
    if (rel) d = addDays(now, RELATIVE[rel.toLowerCase()]);
    else if (word) d = weekdayDate(word, now);
    // «2.5 кг» — не дата: без «до/к» месяц должен быть из двух цифр
    else if (num && (/^(до|к|на)\s/i.test(all) || /^\d{4}-|^\d{1,2}[./]\d{2}/.test(num))) d = numericDate(num, now);
    if (!d) return all;
    deadline = d;
    return ' ';
  });
  return { deadline, rest };
}

/* people: [{ key: 'me' | 'partner', name: 'Совушка' }]. Имя узнаём по началу:
   «@Гусику», «@гусик», «@Совушке» — всё подходит. */
function whoFromToken(token, people) {
  const t = token.toLowerCase();
  if (['я', 'мне', 'себе', 'me'].includes(t)) return 'me';
  for (const p of people) {
    const n = (p.name || '').toLowerCase();
    if (!n) continue;
    const stem = n.slice(0, Math.max(3, n.length - 1));
    if (t.startsWith(stem) || stem.startsWith(t) && t.length >= 3) return p.key;
  }
  return null;
}

// Markdown → обычный текст; первую ссылку забираем отдельно.
function stripMarkdown(s) {
  let link = null;
  let t = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, txt, url) => { link = link || url; return txt; });
  t = t.replace(/<?(https?:\/\/[^\s>)]+)>?/g, (_, url) => { link = link || url; return ' '; });
  t = t
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,!?:;]|$)/g, '$1$2');
  return { text: t, link };
}

function tidy(s) {
  return s
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s,;:—–-]+|[\s,;:—–-]+$/g, '')
    .trim();
}

/* Одна строка → поля задачи. */
export function parseLine(raw, { people = [], now = new Date() } = {}) {
  const md = stripMarkdown(raw);
  let s = md.text;
  let who = null;
  s = s.replace(new RegExp(`(^|\\s)@([${L}]+)`, 'gu'), (all, pre, name) => {
    const w = whoFromToken(name, people);
    if (!w) return all;
    who = who || w;
    return pre;
  });
  let important = false;
  s = s.replace(/(^|\s)!{1,3}(?=\s|$)/g, (_, pre) => { important = true; return pre; });
  s = s.replace(/^\s*!+\s*/, () => { important = true; return ''; });
  const { deadline, rest } = extractDeadline(s, now);
  const title = tidy(rest);
  return { title: title || tidy(md.text), who, deadline, important, link: md.link };
}

const ITEM_RE = /^(\s*)(?:[-*+•▪◦‣]|\d{1,3}[.)])\s+(?:\[([ xXхХ✓✔])\]\s*)?(.*)$/;
const HEADING_RE = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;

function indentOf(s) {
  return s.replace(/\t/g, '    ').length;
}
const newId = () => Math.random().toString(36).slice(2, 8);

/* ```lovetasks — JSON: массив задач или { tasks: [...] }.
   Поля: title, checklist (строки или {text, done}), who ('me' | 'partner'
   или имя), deadline ('2026-11-25', '25.11', 'завтра'), important,
   project, tags, description, link. */
function fromJson(src, { people, now }) {
  let data;
  try { data = JSON.parse(src); } catch { return null; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.tasks) ? data.tasks : null;
  if (!list) return null;
  return list
    .map((x) => (typeof x === 'string' ? { title: x } : x || {}))
    .filter((x) => String(x.title || '').trim())
    .map((x) => {
      let who = null;
      if (x.who === 'me' || x.who === 'partner') who = x.who;
      else if (x.who) who = whoFromToken(String(x.who).replace(/^@/, ''), people);
      let deadline = null;
      if (x.deadline) deadline = numericDate(String(x.deadline), now) || extractDeadline(String(x.deadline), now).deadline;
      const project = [].concat(x.project || x.projects || []).map(String).filter(Boolean);
      return {
        title: String(x.title).trim(),
        description: x.description ? String(x.description) : '',
        checklist: (x.checklist || []).map((c) => (typeof c === 'string'
          ? { id: newId(), text: c, done: false }
          : { id: newId(), text: String(c.text || ''), done: !!c.done })).filter((c) => c.text.trim()),
        who,
        deadline,
        important: !!x.important,
        projectTags: project,
        tags: [].concat(x.tags || []).map((t) => String(t).replace(/^#/, '')).filter(Boolean),
        link: x.link || null,
      };
    });
}

/* Главное: текст → массив задач.
   opts.people — [{ key, name }] для «@имени»; opts.now — «сегодня» для сроков. */
export function parseTaskList(text, opts = {}) {
  const ctx = { people: opts.people || [], now: opts.now || new Date() };
  const src = String(text || '').replace(/\r\n?/g, '\n').replace(/ /g, ' ');

  // точный формат — только он, остальное не трогаем
  const json = src.match(/(?:`{3,}|~{3,})\s*lovetasks\s*\n([\s\S]*?)\n\s*(?:`{3,}|~{3,})/i);
  if (json) {
    const r = fromJson(json[1], ctx);
    if (r) return r;
  }

  const lines = [];
  let fence = null;
  for (const line of src.split('\n')) {
    const f = line.match(FENCE_RE);
    if (f) {
      if (!fence) fence = f[1][0];
      else if (f[1][0] === fence) fence = null;
      continue;
    }
    if (!fence) lines.push(line);
  }

  const hasItems = lines.some((l) => ITEM_RE.test(l));
  const tasks = [];
  let project = null;
  let last = null; // последняя задача и отступ её пункта
  let lastIndent = 0;
  let skipIndent = null; // отступ пропущенного «[x]» — его подпункты тоже пропускаем

  const make = (raw) => {
    const p = parseLine(raw, ctx);
    if (!p.title) return null;
    return {
      title: p.title, description: '', checklist: [], who: p.who, deadline: p.deadline,
      important: p.important, projectTags: project ? [project] : [], tags: [], link: p.link,
    };
  };

  for (const line of lines) {
    if (!line.trim()) continue;
    const h = line.match(HEADING_RE);
    if (h) {
      const name = tidy(stripMarkdown(h[1]).text).replace(/:$/, '').slice(0, 40);
      project = name || null;
      last = null;
      skipIndent = null;
      continue;
    }
    if (!hasItems) {
      const t = make(line.trim());
      if (t) tasks.push(t);
      continue;
    }
    const m = line.match(ITEM_RE);
    if (!m) {
      // абзац между пунктами — конец вложенности; сам абзац не задача
      if (indentOf(line.match(/^\s*/)[0]) === 0) { last = null; skipIndent = null; }
      continue;
    }
    const indent = indentOf(m[1]);
    const done = !!m[2] && m[2] !== ' ';
    const body = m[3].trim();
    if (!body) continue;
    if (skipIndent !== null && indent > skipIndent) continue;
    skipIndent = null;
    if (last && indent > lastIndent) {
      const text = tidy(stripMarkdown(body).text);
      if (text) last.checklist.push({ id: newId(), text, done });
      continue;
    }
    if (done) { last = null; skipIndent = indent; continue; }
    last = make(body);
    lastIndent = indent;
    if (last) tasks.push(last);
  }
  return tasks;
}

// Похоже ли это на список задач (а не на одну задачу)?
export function looksLikeList(text) {
  return parseTaskList(text).length > 1;
}

/* Разобранная задача → данные для createTask.
   me / partner — { uid }; defaults.who — кому, если в строке не сказано;
   defaults.deadline — срок, если не сказано. */
export function toTaskData(t, { me, partner, authorUid, defaults = {} }) {
  const who = t.who || defaults.who || 'me';
  const assignee = who === 'partner' && partner ? partner : me;
  return {
    title: t.title,
    description: t.description || '',
    checklist: t.checklist || [],
    authorUid,
    assigneeUid: assignee?.uid,
    deadline: t.deadline || defaults.deadline || null,
    importance: t.important ? 3 : 0,
    projectTags: t.projectTags || [],
    tags: t.tags || [],
    link: t.link || defaults.link || null,
  };
}

/* HTML (выделение, перетаскивание, вставка) → текст со списками.
   В text/plain у отрисованного списка браузер теряет маркеры и отступы,
   поэтому собираем текст из HTML сами: <li> → «- », вложенность → отступ,
   <h1..h6> → «## », галочки → «[ ]» / «[x]».
   Функция самодостаточная (без внешних ссылок) — расширение передаёт её
   в chrome.scripting.executeScript, чтобы прочитать выделение на странице. */
export function domToListText(root) {
  const out = [];
  let line = '';
  const flush = () => { if (line.trim()) out.push(line.replace(/\s+$/, '')); line = ''; };
  const BLOCK = /^(P|DIV|SECTION|ARTICLE|BLOCKQUOTE|PRE|TABLE|TR|UL|OL|BR|HR|HEADER|FOOTER|MAIN)$/;
  const walk = (node, depth) => {
    if (node.nodeType === 3) { line += node.nodeValue.replace(/\s+/g, ' '); return; }
    if (node.nodeType !== 1 && node.nodeType !== 11) return;
    const tag = node.tagName || '';
    if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|BUTTON)$/.test(tag)) return;
    if (tag === 'INPUT' && node.type === 'checkbox') { line += node.checked ? '[x] ' : '[ ] '; return; }
    if (/^H[1-6]$/.test(tag)) { flush(); line = '## '; node.childNodes.forEach((c) => walk(c, depth)); flush(); return; }
    if (tag === 'LI') {
      flush();
      line = '  '.repeat(depth) + '- ';
      node.childNodes.forEach((c) => walk(c, /^(UL|OL)$/.test(c.tagName || '') ? depth + 1 : depth));
      flush();
      return;
    }
    if (tag === 'A' && node.href && /^https?:/.test(node.href)) {
      const before = line;
      node.childNodes.forEach((c) => walk(c, depth));
      const txt = line.slice(before.length).trim();
      line = before + (txt && txt !== node.href ? `[${txt}](${node.href})` : node.href);
      return;
    }
    if (BLOCK.test(tag)) flush();
    node.childNodes.forEach((c) => walk(c, depth));
    if (BLOCK.test(tag)) flush();
  };
  walk(root, 0);
  flush();
  return out.join('\n');
}

// Есть ли в HTML что-то, ради чего стоит разбирать его вместо text/plain.
export function htmlHasStructure(html) {
  return /<(li|h[1-6])[\s>]/i.test(html || '');
}

export function htmlToListText(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return domToListText(doc.body);
}
