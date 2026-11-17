import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, writeBatch,
  onSnapshot, serverTimestamp, Timestamp, increment, query, where, orderBy, limit,
} from 'firebase/firestore';
import { USERS } from '../config';
import { tsMs, toDate } from './util';

/* Модель:
   wallets/{id}        { name, icon, color, order, balance, archived, ownerUid? }
   balance и income/expense у проектов — счётчики, которые меняются тем же
   батчем, что и операция (increment). Поэтому для остатков не нужно читать
   всю историю: грузим только операции открытого месяца и запланированные.
   budgetTx/{id}       { type: income|expense|transfer, amount, walletId|null, toWalletId?,
                         category, note, date, planned, projectId|null, receiptId|null,
                         items: [{id,title,amount,category}], authorUid, createdAt }
   budgetProjects/{id} { name, note, color, target, income, expense, archived, createdAt }
   receipts/{id}       { status: new|parsed, thumb, qr: {sum,date,raw}|null, txId|null, authorUid, createdAt }
   receiptImages/{id}  { data }  — полное фото отдельно, чтобы список чеков грузился быстро */

const walletsCol = collection(db, 'wallets');
const txCol = collection(db, 'budgetTx');
const projCol = collection(db, 'budgetProjects');
const receiptsCol = collection(db, 'receipts');

const owlEmail = Object.keys(USERS).find((e) => USERS[e].avatar === 'owl');
const gooseEmail = Object.keys(USERS).find((e) => USERS[e].avatar === 'goose');

export const DEFAULT_WALLETS = [
  { id: 'cash', name: 'Наличка', icon: 'fa-solid fa-money-bill-wave', color: '#85925a', order: 0 },
  { id: 'card', name: 'Карта', icon: 'fa-solid fa-credit-card', color: '#6aa0d8', order: 1 },
  { id: 'savings', name: 'Отложено', icon: 'fa-solid fa-piggy-bank', color: '#c9a24b', order: 2 },
  { id: 'pocket_owl', name: 'Карманные Совы', icon: 'fa-solid fa-feather', color: '#d99873', order: 3, ownerUid: owlEmail },
  { id: 'pocket_goose', name: 'Карманные Гуся', icon: 'fa-solid fa-dove', color: '#8a6bff', order: 4, ownerUid: gooseEmail },
];

export const WALLET_ICONS = [
  'fa-solid fa-wallet', 'fa-solid fa-money-bill-wave', 'fa-solid fa-credit-card', 'fa-solid fa-piggy-bank',
  'fa-solid fa-feather', 'fa-solid fa-dove', 'fa-solid fa-building-columns', 'fa-solid fa-coins', 'fa-solid fa-gift',
];

export const EXPENSE_CATS = [
  { id: 'Продукты', icon: 'fa-solid fa-basket-shopping' },
  { id: 'Кафе', icon: 'fa-solid fa-mug-hot' },
  { id: 'Дом', icon: 'fa-solid fa-house' },
  { id: 'Коммуналка', icon: 'fa-solid fa-bolt' },
  { id: 'Транспорт', icon: 'fa-solid fa-bus' },
  { id: 'Здоровье', icon: 'fa-solid fa-heart-pulse' },
  { id: 'Одежда', icon: 'fa-solid fa-shirt' },
  { id: 'Развлечения', icon: 'fa-solid fa-masks-theater' },
  { id: 'Подарки', icon: 'fa-solid fa-gift' },
  { id: 'Связь', icon: 'fa-solid fa-wifi' },
  { id: 'Питомцы', icon: 'fa-solid fa-paw' },
  { id: 'Другое', icon: 'fa-solid fa-ellipsis' },
];
export const INCOME_CATS = [
  { id: 'Зарплата', icon: 'fa-solid fa-briefcase' },
  { id: 'Подработка', icon: 'fa-solid fa-laptop' },
  { id: 'Подарок', icon: 'fa-solid fa-gift' },
  { id: 'Возврат', icon: 'fa-solid fa-rotate-left' },
  { id: 'Другое', icon: 'fa-solid fa-ellipsis' },
];
export function catIcon(id, type) {
  const list = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  return (list.find((c) => c.id === id) || {}).icon || (type === 'transfer' ? 'fa-solid fa-right-left' : 'fa-solid fa-tag');
}

/* ---------- Подписки ---------- */
function sub(q, cb, sort) {
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (sort) list.sort(sort);
    cb(list, snap);
  }, (e) => console.warn('budget subscription', e));
}
const byDateDesc = (a, b) => tsMs(b.date) - tsMs(a.date) || tsMs(b.createdAt) - tsMs(a.createdAt);

export const subscribeWallets = (cb) => sub(walletsCol, (list, snap) => {
  // первый запуск: кошельков нет на сервере — заводим стандартные.
  // setDoc с фиксированными id идемпотентен, гонка двух телефонов не страшна.
  if (!list.length && !snap.metadata.fromCache) {
    DEFAULT_WALLETS.forEach(({ id, ...w }) => setDoc(doc(walletsCol, id), { ...w, balance: 0, archived: false }, { merge: true }));
  }
  cb(list);
}, (a, b) => (a.order ?? 0) - (b.order ?? 0));

// Операции за месяц [from, to)
export const subscribeTxRange = (from, to, cb) => sub(
  query(txCol, where('date', '>=', Timestamp.fromDate(from)), where('date', '<', Timestamp.fromDate(to))), cb, byDateDesc);
// Все запланированные (их немного, и нужны просроченные из прошлых месяцев)
export const subscribePlanned = (cb) => sub(query(txCol, where('planned', '==', true)), cb, byDateDesc);
// Операции одного проекта — только когда проект открыт
export const subscribeProjectTx = (projectId, cb) => sub(query(txCol, where('projectId', '==', projectId)), cb, byDateDesc);
export const subscribeProjects = (cb) => sub(projCol, cb, (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
// Неразобранные чеки — живьём; весь архив чеков — по запросу
export const subscribeReceipts = (cb) => sub(query(receiptsCol, where('status', '==', 'new')), cb, (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
export const subscribeAllReceipts = (cb) => sub(query(receiptsCol, orderBy('createdAt', 'desc'), limit(60)), cb);
export async function fetchTx(id) {
  const s = await getDoc(doc(txCol, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

/* ---------- Кошельки ---------- */
export const saveWallet = (id, data) => (id ? updateDoc(doc(walletsCol, id), data) : addDoc(walletsCol, { balance: 0, ...data, archived: false }));

/* ---------- Операции ---------- */
function txData(d) {
  return {
    type: d.type,
    amount: Math.round(Number(d.amount) * 100) / 100,
    walletId: d.walletId || null,
    toWalletId: d.type === 'transfer' ? d.toWalletId || null : null,
    category: d.type === 'transfer' ? 'Перевод' : d.category || 'Другое',
    note: d.note || '',
    date: Timestamp.fromDate(d.date instanceof Date ? d.date : new Date(d.date)),
    planned: !!d.planned,
    projectId: d.projectId || null,
    receiptId: d.receiptId || null,
    items: (d.items || []).filter((x) => x.amount > 0),
  };
}

// Как операция двигает счётчики (запланированная — никак).
function effects(t, sign = 1) {
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

// Применить разницу «новое минус старое» к кошелькам и проектам в батче.
// known — id существующих кошельков/проектов: обновлять удалённый документ нельзя,
// иначе весь батч упадёт.
function applyEffects(batch, next, prev, known) {
  const n = effects(next, 1);
  const o = effects(prev, -1);
  const wd = { ...n.w };
  Object.entries(o.w).forEach(([k, v]) => { wd[k] = (wd[k] || 0) + v; });
  Object.entries(wd).forEach(([id, v]) => {
    const r = Math.round(v * 100) / 100;
    if (r && known.wallets.has(id)) batch.update(doc(walletsCol, id), { balance: increment(r) });
  });
  const pd = {};
  [n.p, o.p].forEach((m) => Object.entries(m).forEach(([id, x]) => {
    pd[id] ||= { income: 0, expense: 0 };
    pd[id].income += x.income || 0;
    pd[id].expense += x.expense || 0;
  }));
  Object.entries(pd).forEach(([id, x]) => {
    const patch = {};
    if (Math.round(x.income * 100)) patch.income = increment(Math.round(x.income * 100) / 100);
    if (Math.round(x.expense * 100)) patch.expense = increment(Math.round(x.expense * 100) / 100);
    if (Object.keys(patch).length && known.projects.has(id)) batch.update(doc(projCol, id), patch);
  });
}

export async function saveTx(prev, d, authorUid, known) {
  const batch = writeBatch(db);
  const ref = prev ? doc(txCol, prev.id) : doc(txCol);
  const data = txData(d);
  if (prev) batch.update(ref, { ...data, updatedAt: serverTimestamp() });
  else batch.set(ref, { ...data, authorUid, createdAt: serverTimestamp() });
  applyEffects(batch, data, prev, known);
  // чек привязан к операции → считаем разобранным
  if (data.receiptId) batch.update(doc(receiptsCol, data.receiptId), { status: 'parsed', txId: ref.id });
  if (prev?.receiptId && prev.receiptId !== data.receiptId) {
    batch.update(doc(receiptsCol, prev.receiptId), { status: 'new', txId: null });
  }
  return batch.commit();
}

export async function deleteTx(tx, known) {
  const batch = writeBatch(db);
  batch.delete(doc(txCol, tx.id));
  applyEffects(batch, null, tx, known);
  if (tx.receiptId) batch.update(doc(receiptsCol, tx.receiptId), { status: 'new', txId: null });
  return batch.commit();
}

// Провести запланированную операцию сегодняшним числом
export async function commitPlanned(tx, known) {
  const batch = writeBatch(db);
  const now = Timestamp.now();
  batch.update(doc(txCol, tx.id), { planned: false, date: now });
  applyEffects(batch, { ...tx, planned: false }, null, known);
  return batch.commit();
}

/* ---------- Проекты ---------- */
export const saveProject = (id, data) => (id
  ? updateDoc(doc(projCol, id), data)
  : addDoc(projCol, { ...data, income: 0, expense: 0, archived: false, createdAt: serverTimestamp() }));
export const deleteProject = (id) => deleteDoc(doc(projCol, id));

/* ---------- Чеки ---------- */
export async function addReceipt({ image, thumb, qr, authorUid }) {
  const ref = doc(receiptsCol);
  const batch = writeBatch(db);
  batch.set(doc(db, 'receiptImages', ref.id), { data: image });
  batch.set(ref, { status: 'new', thumb, qr: qr || null, txId: null, authorUid, createdAt: serverTimestamp() });
  batch.commit().catch((e) => alert('Чек не сохранился: ' + e.message));
  return ref.id;
}
export async function fetchReceipt(id) {
  const s = await getDoc(doc(receiptsCol, id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}
export async function loadReceiptImage(id) {
  const s = await getDoc(doc(db, 'receiptImages', id));
  return s.exists() ? s.data().data : null;
}
export async function deleteReceipt(r) {
  const batch = writeBatch(db);
  batch.delete(doc(receiptsCol, r.id));
  batch.delete(doc(db, 'receiptImages', r.id));
  if (r.txId) batch.update(doc(txCol, r.txId), { receiptId: null });
  return batch.commit();
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
