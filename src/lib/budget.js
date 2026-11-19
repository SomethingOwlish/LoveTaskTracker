import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, writeBatch,
  onSnapshot, serverTimestamp, Timestamp, increment, query, where, orderBy, limit,
} from 'firebase/firestore';
import { USERS } from '../config';
import { tsMs } from './util';
import { effectDiff, nextOccurrence } from './budgetMath';
import { DEFAULT_BASE } from './currency';
import { reportError, toastError } from './toast';

/* Модель:
   wallets/{id}        { name, icon, color, order, balance, archived, ownerUid? }
   balance и income/expense у проектов — счётчики, которые меняются тем же
   батчем, что и операция (increment). Поэтому для остатков не нужно читать
   всю историю: грузим только операции открытого месяца и запланированные.
   budgetTx/{id}       { type: income|expense|transfer, amount, currency, walletId|null, toWalletId?,
                         origCurrency?, origAmount?, origFee?, rate?  — если ввели в другой валюте,
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
];
// Карманные деньги — не кошельки, а категории расходов с месячным лимитом.
export const POCKET_CATS = { [owlEmail]: 'Карманные Совы', [gooseEmail]: 'Карманные Гуся' };
const LEGACY_POCKET_WALLETS = ['pocket_owl', 'pocket_goose'];

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
  { id: 'Карманные Совы', icon: 'fa-solid fa-feather' },
  { id: 'Карманные Гуся', icon: 'fa-solid fa-dove' },
  { id: 'Комиссии', icon: 'fa-solid fa-percent' },
  { id: 'Налоги', icon: 'fa-solid fa-landmark' },
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
  }, (e) => reportError(e));
}
const byDateDesc = (a, b) => tsMs(b.date) - tsMs(a.date) || tsMs(b.createdAt) - tsMs(a.createdAt);

// includeMetadataChanges: при локальном кэше подтверждение сервера без изменений
// данных приходит только как смена metadata.fromCache — без этого флага
// разовые действия «после ответа сервера» (засев, прятанье) не срабатывали.
let walletsChecked = false;
export const subscribeWallets = (cb) => onSnapshot(walletsCol, { includeMetadataChanges: true }, (snap) => {
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  onWallets(list, snap, cb);
}, (e) => reportError(e));
const onWallets = (list, snap, cb) => {
  // разовые действия — один раз за запуск, после первого ответа сервера
  if (!snap.metadata.fromCache && !walletsChecked) {
    walletsChecked = true;
    // первый запуск: кошельков нет — заводим стандартные (id фиксированы, гонка не страшна)
    if (!list.length) {
      DEFAULT_WALLETS.forEach(({ id, ...w }) => setDoc(doc(walletsCol, id), { ...w, currency: DEFAULT_BASE, balance: 0, archived: false }, { merge: true }));
    }
    // бывшие кошельки «Карманные …» прячем, если в них ничего нет
    list.forEach((w) => {
      if (LEGACY_POCKET_WALLETS.includes(w.id) && !w.archived && !w.balance) updateDoc(doc(walletsCol, w.id), { archived: true }).catch(() => {});
    });
  }
  cb(list);
};

// Операции за месяц [from, to)
export const subscribeTxRange = (from, to, cb) => sub(
  query(txCol, where('date', '>=', Timestamp.fromDate(from)), where('date', '<', Timestamp.fromDate(to))), cb, byDateDesc);
// Все запланированные (их немного, и нужны просроченные из прошлых месяцев)
// Записи, внесённые с даты from (по времени создания, а не дате операции) — для игры.
export const subscribeTxCreatedSince = (from, cb) => sub(query(txCol, where('createdAt', '>=', Timestamp.fromDate(from))), cb);
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
    currency: d.currency || DEFAULT_BASE,
    fee: Math.round((Number(d.fee) || 0) * 100) / 100,
    feeCategory: d.fee ? (d.feeCategory || 'Комиссии') : null,
    toAmount: d.type === 'transfer' && d.toAmount != null && d.toAmount !== '' ? Math.round(Number(d.toAmount) * 100) / 100 : null,
    toCurrency: d.type === 'transfer' ? d.toCurrency || null : null,
    recurringId: d.recurringId || null,
    walletId: d.walletId || null,
    toWalletId: d.type === 'transfer' ? d.toWalletId || null : null,
    category: d.type === 'transfer' ? 'Перевод' : d.category || 'Другое',
    note: d.note || '',
    date: Timestamp.fromDate(d.date instanceof Date ? d.date : new Date(d.date)),
    planned: !!d.planned,
    projectId: d.projectId || null,
    receiptId: d.receiptId || null,
    items: (d.items || []).filter((x) => x.amount > 0),
    // исходная валюта, если сумма пересчитана (см. convertInput в budgetMath)
    origCurrency: d.origCurrency || null,
    origAmount: d.origCurrency ? Number(d.origAmount) || 0 : null,
    origFee: d.origCurrency && d.origFee ? Number(d.origFee) : null,
    rate: d.origCurrency ? Number(d.rate) || null : null,
  };
}

// Применить разницу «новое минус старое» к кошелькам и проектам в батче.
// known — id существующих кошельков/проектов: обновлять удалённый документ нельзя,
// иначе весь батч упадёт.
function applyEffects(batch, next, prev, known) {
  const { wallets, projects } = effectDiff(next, prev);
  Object.entries(wallets).forEach(([id, v]) => {
    if (known.wallets.has(id)) batch.update(doc(walletsCol, id), { balance: increment(v) });
  });
  Object.entries(projects).forEach(([id, byCur]) => {
    const patch = {};
    Object.entries(byCur).forEach(([cur, x]) => {
      if (x.income) patch[`totals.${cur}.income`] = increment(x.income);
      if (x.expense) patch[`totals.${cur}.expense`] = increment(x.expense);
    });
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
  : addDoc(projCol, { ...data, totals: {}, archived: false, createdAt: serverTimestamp() }));
export const deleteProject = (id) => deleteDoc(doc(projCol, id));

/* ---------- Чеки ---------- */
export async function addReceipt({ image, thumb, qr, authorUid }) {
  const ref = doc(receiptsCol);
  const batch = writeBatch(db);
  batch.set(doc(db, 'receiptImages', ref.id), { data: image });
  batch.set(ref, { status: 'new', thumb, qr: qr || null, txId: null, authorUid, createdAt: serverTimestamp() });
  batch.commit().catch((e) => toastError('Чек не сохранился: ' + e.message));
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

export { walletBalances, inMonth, byCategory, totals, projectTotals, FEE_CATEGORIES } from './budgetMath';

/* ---------- Настройки бюджета ----------
   budgetSettings/main = { baseCurrency, limits: { категория: сумма в основной валюте } } */
const settingsRef = doc(db, 'budgetSettings', 'main');
export const subscribeBudgetSettings = (cb) => onSnapshot(settingsRef, (s) => cb({ baseCurrency: DEFAULT_BASE, limits: {}, ...(s.data() || {}) }), (e) => reportError(e));
export const saveBudgetSettings = (patch) => setDoc(settingsRef, patch, { merge: true });

/* ---------- Регулярные платежи ----------
   budgetRecurring/{id} = { шаблон операции…, every: 'month'|'week', day, nextDate: 'YYYY-MM-DD', active }
   Каждое наступление превращается в запланированную операцию с id rec_{id}_{дата}:
   id детерминированный, поэтому два телефона не создадут дубль. */
const recCol = collection(db, 'budgetRecurring');
export const subscribeRecurring = (cb) => sub(recCol, cb, (a, b) => (a.nextDate || '').localeCompare(b.nextDate || ''));
export const saveRecurring = (id, data) => (id ? updateDoc(doc(recCol, id), data) : addDoc(recCol, { ...data, active: true, createdAt: serverTimestamp() }));
export const deleteRecurring = (id) => deleteDoc(doc(recCol, id));

const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d, 12); };

// Создать запланированные операции на ближайшие ~5 недель. Вызывается при
// открытии бюджета; повторный вызов ничего не дублирует.
export async function materializeRecurring(list, authorUid, horizonDays = 35) {
  const horizon = new Date(Date.now() + horizonDays * 86400000);
  for (const r of list) {
    if (!r.active || !r.nextDate) continue;
    let next = r.nextDate;
    let guard = 0;
    while (keyToDate(next) <= horizon && guard++ < 60) {
      const ref = doc(txCol, `rec_${r.id}_${next}`);
      const exists = await getDoc(ref).then((x) => x.exists()).catch(() => true);
      if (!exists) {
        await setDoc(ref, {
          ...txData({ ...r.template, date: keyToDate(next), planned: true, recurringId: r.id }),
          authorUid, createdAt: serverTimestamp(),
        });
      }
      next = nextOccurrence(next, r.every, r.day);
    }
    if (next !== r.nextDate) await updateDoc(doc(recCol, r.id), { nextDate: next });
  }
}
