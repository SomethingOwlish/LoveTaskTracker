import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, writeBatch,
  onSnapshot, serverTimestamp, Timestamp,
} from 'firebase/firestore';
import { USERS } from '../config';
import { tsMs, toDate } from './util';

/* Модель:
   wallets/{id}        { name, icon, color, order, initial, archived, ownerUid? }
   budgetTx/{id}       { type: income|expense|transfer, amount, walletId|null, toWalletId?,
                         category, note, date, planned, projectId|null, receiptId|null,
                         items: [{id,title,amount,category}], authorUid, createdAt }
   budgetProjects/{id} { name, note, color, archived, createdAt }
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
function sub(col, cb, sort) {
  return onSnapshot(col, { includeMetadataChanges: false }, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (sort) list.sort(sort);
    cb(list, snap);
  });
}
export const subscribeWallets = (cb) => sub(walletsCol, (list, snap) => {
  // первый запуск: кошельков нет на сервере — заводим стандартные.
  // setDoc с фиксированными id идемпотентен, гонка двух телефонов не страшна.
  if (!list.length && !snap.metadata.fromCache) {
    DEFAULT_WALLETS.forEach(({ id, ...w }) => setDoc(doc(walletsCol, id), { ...w, initial: 0, archived: false }, { merge: true }));
  }
  cb(list);
}, (a, b) => (a.order ?? 0) - (b.order ?? 0));
export const subscribeTx = (cb) => sub(txCol, cb, (a, b) => tsMs(b.date) - tsMs(a.date) || tsMs(b.createdAt) - tsMs(a.createdAt));
export const subscribeProjects = (cb) => sub(projCol, cb, (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
export const subscribeReceipts = (cb) => sub(receiptsCol, cb, (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));

/* ---------- Кошельки ---------- */
export const saveWallet = (id, data) => (id ? updateDoc(doc(walletsCol, id), data) : addDoc(walletsCol, { ...data, archived: false }));

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

export async function saveTx(id, d, authorUid) {
  const batch = writeBatch(db);
  const ref = id ? doc(txCol, id) : doc(txCol);
  const data = txData(d);
  if (id) batch.update(ref, { ...data, updatedAt: serverTimestamp() });
  else batch.set(ref, { ...data, authorUid, createdAt: serverTimestamp() });
  // чек привязан к операции → считаем разобранным
  if (data.receiptId) batch.update(doc(receiptsCol, data.receiptId), { status: 'parsed', txId: ref.id });
  if (d.prevReceiptId && d.prevReceiptId !== data.receiptId) {
    batch.update(doc(receiptsCol, d.prevReceiptId), { status: 'new', txId: null });
  }
  return batch.commit();
}

export async function deleteTx(tx) {
  const batch = writeBatch(db);
  batch.delete(doc(txCol, tx.id));
  if (tx.receiptId) batch.update(doc(receiptsCol, tx.receiptId), { status: 'new', txId: null });
  return batch.commit();
}

// Провести запланированную операцию сегодняшним числом
export const commitPlanned = (tx) => updateDoc(doc(txCol, tx.id), { planned: false, date: Timestamp.now() });

/* ---------- Проекты ---------- */
export const saveProject = (id, data) => (id
  ? updateDoc(doc(projCol, id), data)
  : addDoc(projCol, { ...data, archived: false, createdAt: serverTimestamp() }));
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
export function walletBalances(wallets, txs) {
  const bal = {};
  wallets.forEach((w) => { bal[w.id] = Number(w.initial) || 0; });
  txs.forEach((t) => {
    if (t.planned) return;
    const a = Number(t.amount) || 0;
    if (t.type === 'income' && t.walletId in bal) bal[t.walletId] += a;
    if (t.type === 'expense' && t.walletId in bal) bal[t.walletId] -= a;
    if (t.type === 'transfer') {
      if (t.walletId in bal) bal[t.walletId] -= a;
      if (t.toWalletId in bal) bal[t.toWalletId] += a;
    }
  });
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
