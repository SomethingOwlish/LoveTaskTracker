import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, writeBatch, deleteField,
  onSnapshot, query, orderBy, where, serverTimestamp, Timestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { nextFutureRecurrence } from './recurrence';
import { tsMs } from './util';

const tasksCol = collection(db, 'tasks');
const eventsCol = collection(db, 'events');
const notifsCol = collection(db, 'notifications');

/* ---------------- Подписки (realtime) ---------------- */
export function subscribeTasks(cb) {
  // Без серверного orderBy: у новой задачи createdAt секунду = null и при
  // orderBy она уходит вниз/не видна до ответа сервера. Сортируем на клиенте,
  // считая новые (pending) самыми свежими — тогда они появляются сразу сверху.
  return onSnapshot(tasksCol, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    cb(list);
  });
}
export function subscribeEvents(cb) {
  const q = query(eventsCol, orderBy('date', 'asc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function subscribeComments(taskId, cb) {
  const q = query(collection(db, 'tasks', taskId, 'comments'), orderBy('createdAt', 'asc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

/* ---------------- Задачи ---------------- */
export async function createTask(data) {
  const title = data.title?.trim() || 'Без названия';
  const assigneeUid = data.assigneeUid || data.authorUid;
  const ref = await addDoc(tasksCol, {
    title,
    description: data.description || '',
    authorUid: data.authorUid,
    assigneeUid,
    status: 'open',
    needsReview: !!data.needsReview,
    priorityMatrix: { importance: data.importance ?? 0, urgency: data.urgency ?? 0 },
    deadline: data.deadline ? Timestamp.fromDate(new Date(data.deadline)) : null,
    estimateMin: data.estimateMin ?? null,
    actualMin: data.actualMin ?? null,
    tags: data.tags || [],
    projectTags: data.projectTags || [],
    link: data.link || null,
    checklist: data.checklist || [],
    recurrence: data.recurrence || 'none',
    likes: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  });
  // задачу поставил другой — уведомляем исполнителя
  if (assigneeUid && assigneeUid !== data.authorUid) {
    await addNotification({ type: 'assigned', taskId: ref.id, taskTitle: title, actorUid: data.authorUid, recipientUid: assigneeUid });
  }
  return ref;
}

export async function updateTask(id, patch) {
  const clean = { ...patch, updatedAt: serverTimestamp() };
  if ('deadline' in patch) {
    clean.deadline = patch.deadline ? Timestamp.fromDate(new Date(patch.deadline)) : null;
  }
  return updateDoc(doc(db, 'tasks', id), clean);
}

export async function deleteTask(id) {
  return deleteDoc(doc(db, 'tasks', id));
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
    return updateDoc(doc(db, 'tasks', task.id), { status: 'in_review', updatedAt: serverTimestamp() });
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
  const patch = { status, completedAt: serverTimestamp(), updatedAt: serverTimestamp() };
  const repeats = task.recurrence && task.recurrence !== 'none';
  if (repeats && !task.nextTaskId) {
    const nextRef = doc(tasksCol);
    batch.set(nextRef, recurrenceCopy(task));
    patch.nextTaskId = nextRef.id;
  }
  batch.update(ref, patch);
  return batch.commit();
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
  const patch = { status: 'open', completedAt: null, updatedAt: serverTimestamp() };
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
  return onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    cb(list);
  });
}

async function addNotification(n) {
  return addDoc(notifsCol, { ...n, createdAt: serverTimestamp() });
}

export async function clearNotifications(list) {
  await Promise.all((list || []).map((n) => deleteDoc(doc(db, 'notifications', n.id))));
}

/* ---------------- События календаря ---------------- */
export async function createEvent(data) {
  return addDoc(eventsCol, {
    title: data.title?.trim() || 'Событие',
    date: Timestamp.fromDate(new Date(data.date)),
    allDay: data.allDay ?? true,
    taskId: data.taskId || null,
    authorUid: data.authorUid,
    createdAt: serverTimestamp(),
  });
}
export async function deleteEvent(id) {
  return deleteDoc(doc(db, 'events', id));
}

/* ---------------- Настроение ---------------- */
// moodLegends/{uid} = { items: [{id, color, label}] } — у каждого своя легенда.
// moods/{uid}_{YYYY-MM-DD} = { uid, day, itemId, color, label, note }
export function subscribeMoods(cb) {
  return onSnapshot(collection(db, 'moods'), (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}
export function subscribeMoodLegends(cb) {
  return onSnapshot(collection(db, 'moodLegends'), (snap) => {
    const map = {};
    snap.docs.forEach((d) => { map[d.id] = d.data().items || []; });
    cb(map);
  });
}
export async function saveMoodLegend(uid, items) {
  return setDoc(doc(db, 'moodLegends', uid), { items, updatedAt: serverTimestamp() });
}
export async function setMood(uid, day, item, note = '') {
  return setDoc(doc(db, 'moods', `${uid}_${day}`), {
    uid, day, itemId: item.id, color: item.color, label: item.label, note: note || '',
    updatedAt: serverTimestamp(),
  });
}
export async function setMoodNote(uid, day, note) {
  return updateDoc(doc(db, 'moods', `${uid}_${day}`), { note, updatedAt: serverTimestamp() });
}
export async function clearMood(uid, day) {
  return deleteDoc(doc(db, 'moods', `${uid}_${day}`));
}

/* ---------------- Мурмур (фильмы / сериалы / игры) ---------------- */
const murmurCol = collection(db, 'murmur');
export function subscribeMurmur(cb) {
  return onSnapshot(murmurCol, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    list.sort((a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
    cb(list);
  });
}
export async function addMurmur({ kind, title, note = '', link = '', uid }) {
  const t = title.trim();
  if (!t) return;
  return addDoc(murmurCol, {
    kind, title: t, note, link: link || null,
    addedBy: uid, wantedBy: [uid],
    status: 'want', ratings: {}, reviews: {},
    createdAt: serverTimestamp(), doneAt: null, doneBy: null,
  });
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
    patch.doneAt = serverTimestamp();
    patch.doneBy = uid;
  }
  return updateDoc(doc(db, 'murmur', item.id), patch);
}
export async function unwatchMurmur(item) {
  return updateDoc(doc(db, 'murmur', item.id), { status: 'want', doneAt: null, doneBy: null, ratings: {}, reviews: {} });
}
