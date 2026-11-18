// Чистые функции бюджета (без Firebase) — их покрывают автотесты.
//
// Деньги и валюты:
//  * amount — в валюте операции (= валюта кошелька, у «вне кошельков» — своя currency);
//  * fee — комиссия/налог в той же валюте. Расход: со счёта уходит amount + fee.
//    Доход: на счёт приходит amount − fee. Перевод: из кошелька уходит amount + fee;
//  * перевод между валютами: toAmount — сколько пришло в валюте кошелька-получателя.
//  * fee попадает в свою категорию (feeCategory: «Комиссии» или «Налоги»).
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
