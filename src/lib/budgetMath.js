// Чистые функции бюджета (без Firebase) — их покрывают автотесты.
import { toDate } from './util';

// Как операция двигает счётчики (запланированная — никак).
export function effects(t, sign = 1) {
  const w = {}; const p = {};
  if (!t || t.planned) return { w, p };
  const a = (Number(t.amount) || 0) * sign;
  const add = (id, v) => { if (id) w[id] = (w[id] || 0) + v; };
  if (t.type === 'income') add(t.walletId, a);
  if (t.type === 'expense') add(t.walletId, -a);
  if (t.type === 'transfer') { add(t.walletId, -a); add(t.toWalletId, a); }
  if (t.projectId && (t.type === 'income' || t.type === 'expense')) p[t.projectId] = { [t.type]: a };
  return { w, p };
}


const r2 = (v) => Math.round(v * 100) / 100;

// Разница «новое минус старое» по кошелькам и проектам (нули отброшены).
export function effectDiff(next, prev) {
  const n = effects(next, 1);
  const o = effects(prev, -1);
  const wallets = {};
  [n.w, o.w].forEach((m) => Object.entries(m).forEach(([k, v]) => { wallets[k] = (wallets[k] || 0) + v; }));
  Object.keys(wallets).forEach((k) => { wallets[k] = r2(wallets[k]); if (!wallets[k]) delete wallets[k]; });
  const projects = {};
  [n.p, o.p].forEach((m) => Object.entries(m).forEach(([id, x]) => {
    projects[id] ||= { income: 0, expense: 0 };
    projects[id].income += x.income || 0;
    projects[id].expense += x.expense || 0;
  }));
  Object.keys(projects).forEach((id) => {
    const x = projects[id];
    x.income = r2(x.income); x.expense = r2(x.expense);
    if (!x.income && !x.expense) delete projects[id];
  });
  return { wallets, projects };
}

/* ---------- Подсчёты ---------- */
export function walletBalances(wallets) {
  const bal = {};
  wallets.forEach((w) => { bal[w.id] = Math.round((Number(w.balance) || 0) * 100) / 100; });
  return bal;
}

export function inMonth(t, month) {
  const d = toDate(t.date);
  return d && d.getFullYear() === month.getFullYear() && d.getMonth() === month.getMonth();
}

// Расходы по категориям; если чек разбит на позиции — считаем по позициям,
// а неразнесённый остаток — по категории самой операции.
export function byCategory(txs) {
  const m = {};
  txs.forEach((t) => {
    if (t.type !== 'expense' || t.planned) return;
    let rest = Number(t.amount) || 0;
    (t.items || []).forEach((it) => {
      m[it.category || t.category] = (m[it.category || t.category] || 0) + it.amount;
      rest -= it.amount;
    });
    if (rest > 0.004) m[t.category] = (m[t.category] || 0) + rest;
  });
  return Object.entries(m).map(([cat, sum]) => ({ cat, sum })).sort((a, b) => b.sum - a.sum);
}

export function totals(txs) {
  let income = 0, expense = 0;
  txs.forEach((t) => {
    if (t.planned) return;
    if (t.type === 'income') income += Number(t.amount) || 0;
    if (t.type === 'expense') expense += Number(t.amount) || 0;
  });
  return { income, expense };
}
