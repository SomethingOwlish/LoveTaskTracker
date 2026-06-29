import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, where, serverTimestamp, Timestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { nextRecurrence } from './recurrence';
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
  // иначе закрываем
  await updateDoc(doc(db, 'tasks', task.id), {
    status: 'done',
    completedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await maybeSpawnRecurrence(task);
}

export async function reopenTask(task) {
  return updateDoc(doc(db, 'tasks', task.id), {
    status: 'open', completedAt: null, updatedAt: serverTimestamp(),
  });
}

/* Ревью: автор принимает или возвращает. */
export async function approveTask(task) {
  await updateDoc(doc(db, 'tasks', task.id), {
    status: 'approved', completedAt: serverTimestamp(), updatedAt: serverTimestamp(),
  });
  await maybeSpawnRecurrence(task);
}
export async function returnTask(task) {
  return updateDoc(doc(db, 'tasks', task.id), {
    status: 'in_progress', updatedAt: serverTimestamp(),
  });
}

async function maybeSpawnRecurrence(task) {
  if (!task.recurrence || task.recurrence === 'none') return;
  const base = task.deadline?.toDate ? task.deadline.toDate() : new Date();
  const next = nextRecurrence(base, task.recurrence);
  await addDoc(tasksCol, {
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
    likes: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    completedAt: null,
  });
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
