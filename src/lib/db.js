import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc,
  onSnapshot, query, orderBy, serverTimestamp, Timestamp, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import { nextRecurrence } from './recurrence';

const tasksCol = collection(db, 'tasks');
const eventsCol = collection(db, 'events');

/* ---------------- Подписки (realtime) ---------------- */
export function subscribeTasks(cb) {
  const q = query(tasksCol, orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
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
  return addDoc(tasksCol, {
    title: data.title?.trim() || 'Без названия',
    description: data.description || '',
    authorUid: data.authorUid,
    assigneeUid: data.assigneeUid || data.authorUid,
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
  return updateDoc(doc(db, 'tasks', task.id), {
    likes: has ? arrayRemove(uid) : arrayUnion(uid),
  });
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
export async function addComment(taskId, authorUid, text) {
  if (!text.trim()) return;
  return addDoc(collection(db, 'tasks', taskId, 'comments'), {
    authorUid, text: text.trim(), createdAt: serverTimestamp(),
  });
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
