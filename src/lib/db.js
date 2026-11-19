import { db, auth } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs, writeBatch, deleteField,
  onSnapshot, query, orderBy, where, limit, serverTimestamp, Timestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { nextFutureRecurrence } from './recurrence';
import { tsMs } from './util';
import { buildTaskDoc, assignedNotification } from './taskDoc';
import { buildMurmurDoc, againDoc } from './murmurUtil';
import { epAtPatch } from './seasons';
import { cleanEventData } from './calendar';
import { reportError } from './toast';

// onSnapshot с понятной ошибкой вместо молча пустого экрана
const listen = (q, fn) => onSnapshot(q, fn, (e) => reportError(e));

const tasksCol = collection(db, 'tasks');
const eventsCol = collection(db, 'events');
const notifsCol = collection(db, 'notifications');

/* ---------------- Подписки (realtime) ----------------
   Читаем только «живые» данные: бесплатный тариф Firestore — 50 000 чтений
   в сутки, а каждая подписка при холодном старте читает все свои документы.
   Архив (старые закрытые задачи, просмотренное в Мурмуре, прошлые месяцы)
   грузится только когда его явно открывают. */

// Несколько запросов → один отсортированный список без дублей.
function mergeSubs(queries, cb, sort) {
  const parts = queries.map(() => null);
  const emit = () => {
    if (parts.some((p) => p === null)) return; // ждём первый ответ от всех
    const map = new Map();
    parts.forEach((list) => list.forEach((x) => map.set(x.id, x)));
    const list = [...map.values()];
    if (sort) list.sort(sort);
    cb(list);
  };
  const unsubs = queries.map((q, i) => listen(q, (snap) => {
    parts[i] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit();
  }));
  return () => unsubs.forEach((u) => u());
}

const newestFirst = (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt);

// Начало текущей недели (Пн) — закрытые с этого момента нужны для «Сделано
// сегодня» и недельной статистики. Всё, что закрыто раньше, — архив.
function weekStartTs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Timestamp.fromDate(d);
}

export function subscribeTasks(cb) {
  return mergeSubs([
    query(tasksCol, where('status', 'in', ['open', 'in_progress', 'returned', 'in_review'])),
    query(tasksCol, where('completedAt', '>=', weekStartTs())),
  ], cb, newestFirst);
}

// Архив закрытых — только по явному запросу (фильтр «Закрытые»).
export function subscribeClosedTasks(cb, max = 100) {
  const q = query(tasksCol, orderBy('completedAt', 'desc'), limit(max));
  return listen(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

// Задачи, закрытые в указанный день (для шторки дня в настроении) — по запросу.
export function subscribeDoneOnDay(day, cb) {
  const [y, m, d] = day.split('-').map(Number);
  const q = query(tasksCol,
    where('completedAt', '>=', Timestamp.fromDate(new Date(y, m - 1, d))),
    where('completedAt', '<', Timestamp.fromDate(new Date(y, m - 1, d + 1))));
  return listen(q, (snap) => cb(snap.docs.map((x) => ({ id: x.id, ...x.data() }))));
}

export async function fetchTask(id) {
  const s = await getDoc(doc(db, 'tasks', id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
}

// Старые однодневные события — только видимый диапазон дат.
export function subscribeEvents(from, to, cb) {
  const q = query(eventsCol, where('date', '>=', Timestamp.fromDate(from)), where('date', '<', Timestamp.fromDate(to)), orderBy('date', 'asc'));
  return listen(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function subscribeComments(taskId, cb) {
  const q = query(collection(db, 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc'));
  return listen(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/* ---------------- Задачи ---------------- */
export async function createTask(data) {
  const task = buildTaskDoc(data, { serverTimestamp, Timestamp });
  const ref = await addDoc(tasksCol, task);
  // задачу поставил другой — уведомляем исполнителя
  const n = assignedNotification(ref.id, task);
  if (n) await addNotification(n);
  return ref;
}

export async function updateTask(id, patch) {
  const clean = { ...patch, updatedAt: serverTimestamp() };
  if ('deadline' in patch) {
    clean.deadline = patch.deadline ? Timestamp.fromDate(new Date(patch.deadline)) : null;
  }
  return updateDoc(doc(db, 'tasks', id), clean);
}

/* Удаление с возможностью отмены: сам документ удаляем сразу, а комментарии
   и уведомления по задаче подчищаем через несколько секунд, если удаление
   не отменили. Отмена восстанавливает документ с тем же id. */
const pendingCleanup = new Map();
export async function deleteTask(task) {
  const id = typeof task === 'string' ? task : task.id;
  await deleteDoc(doc(db, 'tasks', id));
  pendingCleanup.set(id, setTimeout(() => cleanupTask(id).catch(() => {}), 8000));
}
export async function restoreTask(task) {
  clearTimeout(pendingCleanup.get(task.id));
  pendingCleanup.delete(task.id);
  const { id, ...data } = task;
  return setDoc(doc(db, 'tasks', id), data);
}
async function cleanupTask(id) {
  pendingCleanup.delete(id);
  const [comments, notifs] = await Promise.all([
    getDocs(collection(db, 'tasks', id, 'comments')),
    getDocs(query(notifsCol, where('taskId', '==', id))),
  ]);
  await Promise.all([...comments.docs, ...notifs.docs].map((d) => deleteDoc(d.ref)));
}

export async function toggleLike(task, uid) {
  const has = (task.likes || []).includes(uid);
  await updateDoc(doc(db, 'tasks', task.id), {
    likes: has ? arrayRemove(uid) : arrayUnion(uid),
  });
  // поставили лайк — уведомляем исполнителя (чью задачу оценили)
  if (!has && task.assigneeUid && task.assigneeUid !== uid) {
    await addNotification({ type: 'like', taskId: task.id, taskTitle: task.title, actorUid: uid, recipientUid: task.assigneeUid });
  }
}

/* Отметить «выполнено» с учётом ревью-флоу и повторений. */
export async function completeTask(task) {
  // задача с проверкой и ещё не на ревью → отправляем на проверку автору
  if (task.needsReview && task.status !== 'in_review' && task.status !== 'approved') {
    const done = updateDoc(doc(db, 'tasks', task.id), { status: 'in_review', updatedAt: serverTimestamp() });
    return { kind: 'review', done };
  }
  return closeWithRecurrence(task, 'done');
}

/* Ревью: автор принимает или возвращает. */
export async function approveTask(task) {
  return closeWithRecurrence(task, 'approved');
}
export async function returnTask(task) {
  return updateDoc(doc(db, 'tasks', task.id), {
    status: 'in_progress', updatedAt: serverTimestamp(),
  });
}

/* Закрыть задачу и (если она повторяющаяся) одним батчем поставить
   следующую такую же. Ссылка на следующую хранится в nextTaskId — по ней
   повторное закрытие не плодит дубли, а «вернуть в работу» убирает копию. */
async function closeWithRecurrence(task, status) {
  const batch = writeBatch(db);
  const ref = doc(db, 'tasks', task.id);
  // completedAt — время телефона, а не serverTimestamp: пока сервер не ответил,
  // serverTimestamp локально равен null и задача выпала бы из запроса «закрытые
  // за неделю» (а без сети — пропала бы до синхронизации).
  const patch = { status, completedAt: Timestamp.now(), updatedAt: serverTimestamp() };
  // Кто закрыл — ему монеты в игре. При «Принять» закрывает автор, а сделал
  // исполнитель, поэтому там completedBy — исполнитель.
  const me = auth.currentUser?.email?.toLowerCase() || null;
  patch.completedBy = status === 'approved' ? task.assigneeUid : (me || task.assigneeUid);
  const repeats = task.recurrence && task.recurrence !== 'none';
  if (repeats && !task.nextTaskId) {
    const nextRef = doc(tasksCol);
    batch.set(nextRef, recurrenceCopy(task));
    patch.nextTaskId = nextRef.id;
  }
  batch.update(ref, patch);
  // промис не ждём целиком: без сети commit резолвится только после синхронизации,
  // а id следующей копии нужен сразу (для «Отменить»)
  const done = batch.commit();
  return { kind: 'closed', nextTaskId: patch.nextTaskId || null, done };
}

/* «Отменить» после отметки «выполнено»: вернуть прежний статус и убрать
   поставленную следующую копию, если её ещё не трогали. */
export async function undoComplete(task, result) {
  const patch = { status: task.status, updatedAt: serverTimestamp() };
  if (result?.kind === 'closed') {
    patch.completedAt = null;
    patch.completedBy = deleteField();
    patch.nextTaskId = deleteField();
    if (result.nextTaskId) {
      try {
        const snap = await getDoc(doc(db, 'tasks', result.nextTaskId));
        if (snap.exists() && snap.data().status === 'open') await deleteDoc(snap.ref);
      } catch { /* нет сети — копия останется */ }
    }
  }
  return updateDoc(doc(db, 'tasks', task.id), patch);
}

function recurrenceCopy(task) {
  const base = task.deadline?.toDate ? task.deadline.toDate() : (() => { const d = new Date(); d.setHours(23, 59, 0, 0); return d; })();
  const next = nextFutureRecurrence(base, task.recurrence);
  return {
    title: task.title,
    description: task.description || '',
    authorUid: task.authorUid,
    assigneeUid: task.assigneeUid,
    status: 'open',
    needsReview: !!task.needsReview,
    priorityMatrix: task.priorityMatrix || { importance: 0, urgency: 0 },
    deadline: Timestamp.fromDate(next),
    estimateMin: task.estimateMin ?? null,
    actualMin: null,
    tags: task.tags || [],
    projectTags: task.projectTags || [],
    link: task.link || null,
    checklist: (task.checklist || []).map((c) => ({ ...c, done: false })),
    recurrence: task.recurrence,
    prevTaskId: task.id,
    likes: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  };
}

export async function reopenTask(task) {
  const patch = { status: 'open', completedAt: null, completedBy: deleteField(), updatedAt: serverTimestamp() };
  // откат: если при закрытии поставилась следующая копия и её ещё не трогали — убираем
  if (task.nextTaskId) {
    try {
      const snap = await getDoc(doc(db, 'tasks', task.nextTaskId));
      if (snap.exists() && snap.data().status === 'open') await deleteDoc(snap.ref);
    } catch { /* нет сети — просто оставим копию */ }
    patch.nextTaskId = deleteField();
  }
  return updateDoc(doc(db, 'tasks', task.id), patch);
}

/* ---------------- Комментарии ---------------- */
export async function addComment(task, authorUid, text) {
  if (!text.trim()) return;
  const clean = text.trim();
  await addDoc(collection(db, 'tasks', task.id, 'comments'), {
    authorUid, text: clean, createdAt: serverTimestamp(),
  });
  // уведомляем других участников задачи (автора/исполнителя), но не себя
  const recipients = [...new Set([task.authorUid, task.assigneeUid])].filter((u) => u && u !== authorUid);
  await Promise.all(recipients.map((r) =>
    addNotification({ type: 'comment', taskId: task.id, taskTitle: task.title, actorUid: authorUid, recipientUid: r, text: clean.slice(0, 80) })
  ));
}

/* ---------------- Уведомления ---------------- */
export function subscribeNotifications(uid, cb) {
  const q = query(notifsCol, where('recipientUid', '==', uid));
  return listen(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    cb(list);
  });
}

async function addNotification(n) {
  return addDoc(notifsCol, { ...n, createdAt: serverTimestamp() });
}

// Уведомления старше месяца удаляем при открытии списка, чтобы коллекция не росла бесконечно.
export async function pruneNotifications(list, days = 30) {
  const edge = Date.now() - days * 86400000;
  const old = (list || []).filter((n) => n.createdAt && tsMs(n.createdAt) < edge);
  await Promise.all(old.map((n) => deleteDoc(doc(db, 'notifications', n.id))));
}

export async function clearNotifications(list) {
  await Promise.all((list || []).map((n) => deleteDoc(doc(db, 'notifications', n.id))));
}

/* ---------------- Старые однодневные события ----------------
   Коллекция events (до многодневных calEvents): только показываем и удаляем.
   Правка старого события переносит его в calEvents. */
export async function deleteEvent(id) {
  return deleteDoc(doc(db, 'events', id));
}

/* ---------------- События календаря (многодневные) ----------------
   calEvents/{id} = { title, description, start, end, participants, color, link,
   authorUid } — start/end ключи дней YYYY-MM-DD. Читаем только те, что ещё
   не закончились к началу видимой сетки: прошедшие месяцы не грузим. */
const calEventsCol = collection(db, 'calEvents');
export function subscribeCalEvents(fromKey, cb) {
  const q = query(calEventsCol, where('end', '>=', fromKey));
  return listen(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function createCalEvent(data) {
  return addDoc(calEventsCol, {
    ...cleanEventData(data), authorUid: data.authorUid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
}
export async function updateCalEvent(id, data) {
  return updateDoc(doc(db, 'calEvents', id), { ...cleanEventData(data), updatedAt: serverTimestamp() });
}
export async function deleteCalEvent(id) {
  return deleteDoc(doc(db, 'calEvents', id));
}

/* ---------------- Настроение ---------------- */
// moodLegends/{uid} = { items: [{id, color, label}] } — у каждого своя легенда.
// moods/{uid}_{YYYY-MM-DD} = { uid, day, items: [{itemId, color, label}], note,
//   itemId, color, label } — несколько цветов за день; верхние itemId/color/label
//   дублируют первый цвет для старых версий приложения и старых записей.
// Отметки за диапазон дней (ключи YYYY-MM-DD сравниваются как строки).
export function subscribeMoods(fromKey, toKey, cb) {
  const q = query(collection(db, 'moods'), where('day', '>=', fromKey), where('day', '<=', toKey));
  return listen(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
/* ---------------- Шаги с iPhone ----------------
   steps/{uid}_{день} пишет воркер (/api/steps) по личному ключу stepKeys/{ключ}. */
// Обоих за неделю (≤14 документов) и фильтр на клиенте: uid + диапазон дней
// в одном запросе потребовали бы составной индекс.
export function subscribeSteps(uid, fromKey, toKey, cb) {
  const q = query(collection(db, 'steps'), where('day', '>=', fromKey), where('day', '<=', toKey));
  return listen(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((d) => !uid || d.uid === uid)));
}
export function subscribeStepKeys(uid, cb) {
  return listen(query(collection(db, 'stepKeys'), where('uid', '==', uid)), (snap) => cb(snap.docs.map((d) => ({ key: d.id, ...d.data() }))));
}
// Новый ключ: 32 случайных символа [a-z0-9]. Старые удаляем — работает только один.
export async function newStepKey(uid, old = []) {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const key = Array.from(bytes, (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  await setDoc(doc(db, 'stepKeys', key), { uid, createdAt: serverTimestamp() });
  await Promise.all(old.map((k) => deleteDoc(doc(db, 'stepKeys', k))));
  return key;
}

export function subscribeMoodLegends(cb) {
  return listen(collection(db, 'moodLegends'), (snap) => {
    const map = {};
    snap.docs.forEach((d) => { map[d.id] = d.data().items || []; });
    cb(map);
  });
}
export async function saveMoodLegend(uid, items) {
  return setDoc(doc(db, 'moodLegends', uid), { items, updatedAt: serverTimestamp() });
}
// items — выбранные пункты [{itemId, color, label}]; пустой список снимает отметку.
export async function setMood(uid, day, items, note = '') {
  const ref = doc(db, 'moods', `${uid}_${day}`);
  if (!items.length) return deleteDoc(ref);
  const [first] = items;
  return setDoc(ref, {
    uid, day, items, itemId: first.itemId, color: first.color, label: first.label, note: note || '',
    updatedAt: serverTimestamp(),
  });
}
// Своя отметка за день; второй аргумент колбэка — пришёл ли ответ сервера
// (до него пустой кэш ещё не значит «не отмечено»).
export function subscribeMyMood(uid, day, cb) {
  return onSnapshot(doc(db, 'moods', `${uid}_${day}`), { includeMetadataChanges: true },
    (s) => cb(s.exists() ? s.data() : null, !s.metadata.fromCache), (e) => reportError(e));
}
export async function setMoodNote(uid, day, note) {
  return updateDoc(doc(db, 'moods', `${uid}_${day}`), { note, updatedAt: serverTimestamp() });
}
export async function clearMood(uid, day) {
  return deleteDoc(doc(db, 'moods', `${uid}_${day}`));
}

/* ---------------- Мурмур (фильмы / сериалы / игры) ---------------- */
const murmurCol = collection(db, 'murmur');
// Живой список: что хотим + просмотренное за последние 45 дней (для бейджа
// «ждёт твоей оценки»). Весь архив просмотренного — subscribeMurmurDone.
export function subscribeMurmur(cb) {
  const since = Timestamp.fromMillis(Date.now() - 45 * 86400000);
  return mergeSubs([
    query(murmurCol, where('status', '==', 'want')),
    query(murmurCol, where('doneAt', '>=', since)),
  ], cb, newestFirst);
}
export function subscribeMurmurDone(cb) {
  return listen(query(murmurCol, where('status', '==', 'done')), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export async function addMurmur(data) {
  const item = buildMurmurDoc(data, { serverTimestamp });
  if (!item) return;
  return addDoc(murmurCol, item);
}
// «Повторить» — новая карточка «Заново …», старая остаётся в архиве.
export async function againMurmur(item, uid) {
  return addDoc(murmurCol, againDoc(item, uid, { serverTimestamp }));
}
// Игра: «Начали» — в процессе; null — снять отметку.
export async function startMurmur(id, uid) {
  return updateDoc(doc(db, 'murmur', id), uid ? { startedAt: Timestamp.now(), startedBy: uid } : { startedAt: null, startedBy: null });
}
export async function updateMurmur(id, patch) {
  return updateDoc(doc(db, 'murmur', id), patch);
}
export async function deleteMurmur(id) {
  return deleteDoc(doc(db, 'murmur', id));
}
export async function toggleMurmurWant(item, uid) {
  const has = (item.wantedBy || []).includes(uid);
  return updateDoc(doc(db, 'murmur', item.id), { wantedBy: has ? arrayRemove(uid) : arrayUnion(uid) });
}
// Отметить просмотренным (если ещё нет) и/или поставить свою оценку.
export async function rateMurmur(item, uid, rating, review) {
  const patch = { [`ratings.${uid}`]: rating, [`reviews.${uid}`]: review || '' };
  if (item.status !== 'done') {
    patch.status = 'done';
    patch.doneAt = Timestamp.now(); // см. closeWithRecurrence — нужен сразу для запроса «недавно просмотренные»
    patch.doneBy = uid;
  }
  return updateDoc(doc(db, 'murmur', item.id), patch);
}
// Серии сериала (см. lib/seasons.js). Отметка общая — смотрим вместе.
// epAt — когда отмечена каждая серия: за серии этой недели в игре даются монеты.
export async function setMurmurSeasonWatched(item, n, list) {
  const eps = epAtPatch(item.watched, { ...(item.watched || {}), [`s${n}`]: list }, Date.now(), deleteField());
  return updateDoc(doc(db, 'murmur', item.id), { [`watched.s${n}`]: list, watchedAt: serverTimestamp(), ...eps });
}
export async function setMurmurWatched(item, watched) {
  const eps = epAtPatch(item.watched, watched, Date.now(), deleteField());
  return updateDoc(doc(db, 'murmur', item.id), { watched, watchedAt: serverTimestamp(), ...eps });
}
export async function unwatchMurmur(item) {
  return updateDoc(doc(db, 'murmur', item.id), { status: 'want', doneAt: null, doneBy: null, ratings: {}, reviews: {} });
}

/* ---------------- Личное состояние ---------------- */
// userState/{email} = { notifReadAt, projectColors, calendarProjects, push, game }
export function subscribeUserState(uid, cb) {
  return onSnapshot(doc(db, 'userState', uid), { includeMetadataChanges: true }, (s) => cb(s.data() || {}, !s.metadata.fromCache), (e) => reportError(e));
}
// Ран игры заменяется целиком: merge склеил бы старые бои с новыми.
export function saveGame(uid, game) {
  return setDoc(doc(db, 'userState', uid), { game }, { mergeFields: ['game'] });
}
export function saveUserState(uid, patch) {
  return setDoc(doc(db, 'userState', uid), patch, { merge: true });
}
