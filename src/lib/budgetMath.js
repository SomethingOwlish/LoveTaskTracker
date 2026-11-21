// Чистые функции бюджета (без Firebase) — их покрывают автотесты.
//
// Деньги и валюты:
//  * amount — в валюте операции (= валюта кошелька, у «вне кошельков» — своя currency);
//  * fee — комиссия/налог в той же валюте. Расход: со счёта уходит amount + fee.
//    Доход: на счёт приходит amount − fee. Перевод: из кошелька уходит amount + fee;
//  * перевод между валютами: toAmount — сколько пришло в валюте кошелька-получателя.
//  * fee попадает в свою категорию (feeCategory: «Комиссии» или «Налоги»).
//  * доход/расход в другой валюте (зарплата в долларах на динарную карту):
//    origCurrency/origAmount/origFee — как было введено, rate — курс
//    «1 origCurrency = rate currency»; amount/fee/items уже пересчитаны в
//    валюту кошелька (без кошелька — в основную), поэтому все счётчики и
//    сводки работают с ними как раньше. Старые операции без orig* — как были.
import { toDate } from './util';
import { DEFAULT_BASE, convert } from './currency';

export const FEE_CATEGORIES = ['Комиссии', 'Налоги'];

const num = (v) => Number(v) || 0;
const r2 = (v) => Math.round(v * 100) / 100;

// Как операция двигает счётчики (запланированная — никак).
// w: { walletId: дельта в валюте кошелька }, p: { projectId: { cur, income, expense } }
export function effects(t, sign = 1) {
  const w = {}; const p = {};
  if (!t || t.planned) return { w, p };
  const a = num(t.amount) * sign;
  const fee = num(t.fee) * sign;
  const add = (id, v) => { if (id) w[id] = (w[id] || 0) + v; };
  if (t.type === 'income') add(t.walletId, a - fee);
  if (t.type === 'expense') add(t.walletId, -(a + fee));
  if (t.type === 'transfer') {
    add(t.walletId, -(a + fee));
    add(t.toWalletId, t.toAmount != null ? num(t.toAmount) * sign : a);
  }
  if (t.projectId && (t.type === 'income' || t.type === 'expense')) {
    const cur = t.currency || DEFAULT_BASE;
    // доход проекта — за вычетом налога/комиссии, расход — вместе с комиссией
    p[t.projectId] = t.type === 'income'
      ? { cur, income: a - fee, expense: 0 }
      : { cur, income: 0, expense: a + fee };
  }
  return { w, p };
}

// Разница «новое минус старое» (нули отброшены).
// projects: { id: { CUR: { income, expense } } }
export function effectDiff(next, prev) {
  const n = effects(next, 1);
  const o = effects(prev, -1);
  const wallets = {};
  [n.w, o.w].forEach((m) => Object.entries(m).forEach(([k, v]) => { wallets[k] = (wallets[k] || 0) + v; }));
  Object.keys(wallets).forEach((k) => { wallets[k] = r2(wallets[k]); if (!wallets[k]) delete wallets[k]; });
  const projects = {};
  [n.p, o.p].forEach((m) => Object.entries(m).forEach(([id, x]) => {
    projects[id] ||= {};
    const c = (projects[id][x.cur] ||= { income: 0, expense: 0 });
    c.income += x.income; c.expense += x.expense;
  }));
  Object.entries(projects).forEach(([id, byCur]) => {
    Object.entries(byCur).forEach(([cur, x]) => {
      x.income = r2(x.income); x.expense = r2(x.expense);
      if (!x.income && !x.expense) delete byCur[cur];
    });
    if (!Object.keys(byCur).length) delete projects[id];
  });
  return { wallets, projects };
}

/* ---------- Пересчёт введённой суммы ---------- */
// d: { type, amount, fee, items, origCurrency, rate } — суммы в валюте ввода;
// cur — валюта кошелька (или основная). Возвращает поля для сохранения.
export function convertInput(d, cur) {
  const from = d.origCurrency || cur;
  const rate = Number(d.rate);
  const same = from === cur || d.type === 'transfer';
  if (!same && !(rate > 0)) throw new Error('Нет курса ' + from + ' → ' + cur);
  const k = same ? 1 : rate;
  const items = (d.items || []).map((x) => (same ? x : { ...x, amount: r2(num(x.amount) * k), origAmount: num(x.amount) }));
  return {
    currency: cur,
    amount: r2(num(d.amount) * k),
    fee: r2(num(d.fee) * k),
    items,
    origCurrency: same ? null : from,
    origAmount: same ? null : r2(num(d.amount)),
    origFee: same || !num(d.fee) ? null : r2(num(d.fee)),
    rate: same ? null : rate,
  };
}

// Обратно для формы правки: суммы в валюте ввода
export function inputOf(t) {
  if (!t?.origCurrency || !(t.rate > 0)) return { origCurrency: null, amount: t?.amount, fee: t?.fee, items: t?.items || [], rate: null };
  return {
    origCurrency: t.origCurrency,
    rate: t.rate,
    amount: t.origAmount ?? r2(num(t.amount) / t.rate),
    fee: t.origFee ?? (num(t.fee) ? r2(num(t.fee) / t.rate) : 0),
    items: (t.items || []).map((x) => ({ ...x, amount: x.origAmount ?? r2(num(x.amount) / t.rate) })),
  };
}

/* ---------- Подсчёты ---------- */
export function walletBalances(wallets) {
  const bal = {};
  wallets.forEach((w) => { bal[w.id] = r2(num(w.balance)); });
  return bal;
}

export function inMonth(t, month) {
  const d = toDate(t.date);
  return d && d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
}

// Сумма операции в основной валюте
const toBase = (v, t, base, fx) => convert(v, t.currency || base, base, fx);

// Расходы по категориям в основной валюте. Чек, разбитый на позиции, считается
// по позициям; неразнесённый остаток — по категории операции. Комиссии и налоги
// (в том числе с доходов и переводов) — в свою категорию.
export function byCategory(txs, base = DEFAULT_BASE, fx = null) {
  const m = {};
  const add = (cat, v) => { if (v) m[cat] = (m[cat] || 0) + v; };
  txs.forEach((t) => {
    if (t.planned) return;
    const fee = num(t.fee);
    if (fee) add(t.feeCategory || 'Комиссии', toBase(fee, t, base, fx));
    if (t.type !== 'expense') return;
    let rest = num(t.amount);
    (t.items || []).forEach((it) => {
      add(it.category || t.category, toBase(num(it.amount), t, base, fx));
      rest -= num(it.amount);
    });
    if (rest > 0.004) add(t.category, toBase(rest, t, base, fx));
  });
  return Object.entries(m).map(([cat, sum]) => ({ cat, sum: r2(sum) })).sort((a, b) => b.sum - a.sum);
}

// Пришло / ушло в основной валюте. Доход — до вычета налога, а налог и все
// комиссии считаются расходом (так «Налоги» и «Комиссии» видны в «Куда ушло»).
export function totals(txs, base = DEFAULT_BASE, fx = null) {
  let income = 0; let expense = 0;
  txs.forEach((t) => {
    if (t.planned) return;
    const a = toBase(num(t.amount), t, base, fx);
    const fee = toBase(num(t.fee), t, base, fx);
    if (t.type === 'income') income += a;
    if (t.type === 'expense') expense += a;
    expense += fee;
  });
  return { income: r2(income), expense: r2(expense) };
}

// Итоги проекта: { CUR: { income, expense } } → в основной валюте
export function projectTotals(p, base = DEFAULT_BASE, fx = null) {
  let income = 0; let expense = 0;
  Object.entries(p.totals || {}).forEach(([cur, x]) => {
    income += convert(num(x.income), cur, base, fx);
    expense += convert(num(x.expense), cur, base, fx);
  });
  // старые проекты до мультивалютности хранили income/expense числом
  income += num(p.income); expense += num(p.expense);
  return { income: r2(income), expense: r2(expense) };
}

// Следующая дата регулярного платежа (YYYY-MM-DD → YYYY-MM-DD)
export function nextOccurrence(key, every, day) {
  const [y, m, d] = key.split('-').map(Number);
  const pad = (n) => String(n).padStart(2, '0');
  if (every === 'week') {
    const x = new Date(y, m - 1, d + 7);
    return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`;
  }
  const want = day || d;
  const last = new Date(y, m + 1, 0).getDate(); // последний день следующего месяца
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${pad(nm)}-${pad(Math.min(want, last))}`;
}

/* ---------- Бюджетный месяц: от зарплаты Совы до следующей ----------
   starts — даты зарплат с галочкой «новый месяц» (проведённые). Период —
   [from, to): from — начало дня зарплаты, to — начало дня следующей зарплаты,
   у текущего to = null (следующей ещё не было). До первой такой зарплаты
   периоды — обычные календарные месяцы (последний обрезается зарплатой). */
const sod = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

export function salaryStarts(list) {
  const ms = new Set();
  list.forEach((x) => { const d = x instanceof Date ? x : toDate(x?.date ?? x); if (d && !x?.planned) ms.add(sod(d).getTime()); });
  return [...ms].sort((a, b) => a - b).map((x) => new Date(x));
}

export function periodOf(date, starts = []) {
  const t = date.getTime();
  let i = -1;
  starts.forEach((s, k) => { if (s.getTime() <= t) i = k; });
  if (i >= 0) return { from: starts[i], to: starts[i + 1] || null, salary: true };
  const from = new Date(date.getFullYear(), date.getMonth(), 1);
  let to = new Date(date.getFullYear(), date.getMonth() + 1, 1);
  if (starts[0] && starts[0] < to) to = starts[0];
  return { from, to, salary: false };
}

// Для плана у открытого периода нужен конец — тот же день следующего месяца.
export function periodEnd(p) {
  if (p.to) return p.to;
  const f = p.from;
  const last = new Date(f.getFullYear(), f.getMonth() + 2, 0).getDate();
  return new Date(f.getFullYear(), f.getMonth() + 1, Math.min(f.getDate(), last));
}

// Проведённая операция — в периоде, если с from и до следующей зарплаты;
// запланированная — до ожидаемого конца периода.
export function inPeriod(t, p) {
  const d = toDate(t.date);
  if (!d || d < p.from) return false;
  const end = t.planned ? periodEnd(p) : p.to;
  return !end || d < end;
}

export const prevPeriod = (p, starts) => periodOf(new Date(p.from.getTime() - 1), starts);
export const nextPeriod = (p, starts) => (p.to ? periodOf(p.to, starts) : null);

// Последние n периодов, заканчивая тем, где сейчас now (старые — первыми)
export function lastPeriods(n, starts, now = new Date()) {
  const out = [periodOf(now, starts)];
  while (out.length < n) out.unshift(prevPeriod(out[0], starts));
  return out;
}

/* ---------- План по категориям ----------
   Запланированный расход — это «конверт» на категорию: обычные траты в той же
   категории за период вычитаются из него. Несколько планов одной категории
   расходуются по очереди (по дате). Всё — в основной валюте.
   Возвращает { [id]: { plan, spent, left } }. */
export function planProgress(planned, actual, base = DEFAULT_BASE, fx = null) {
  const pool = {};
  byCategory(actual.filter((t) => !t.planned), base, fx).forEach((c) => { pool[c.cat] = c.sum; });
  const res = {};
  [...planned]
    .filter((t) => t.planned && t.type === 'expense')
    .sort((a, b) => (toDate(a.date) || 0) - (toDate(b.date) || 0))
    .forEach((t) => {
      const plan = r2(toBase(num(t.amount), t, base, fx));
      const use = Math.min(plan, pool[t.category] || 0);
      if (use > 0) pool[t.category] = r2(pool[t.category] - use);
      res[t.id] = { plan, spent: r2(use), left: r2(plan - use) };
    });
  return res;
}
