// Firebase в расширении. Живёт только в фоновом скрипте (service worker):
// форма и меню общаются с ним сообщениями, так что вход и запись — в одном месте.
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithCredential, signOut as fbSignOut,
} from 'firebase/auth/web-extension';
import {
  getFirestore, collection, addDoc, deleteDoc, doc, serverTimestamp, Timestamp,
  query, where, limit, getDocs, getDoc, updateDoc, arrayUnion,
} from 'firebase/firestore/lite';
import { FIREBASE_PROJECT } from '../../src/firebaseConfig.js';
import { buildTaskDoc, assignedNotification } from '../../src/lib/taskDoc.js';
import { buildMurmurDoc, sameMurmur } from '../../src/lib/murmurUtil.js';
import { buildWish } from '../../src/lib/wishMath.js';
import { OAUTH_CLIENT_ID, REDIRECT_URI } from '../config.js';
import { person, partnerOf } from './shared.js';

const app = initializeApp(FIREBASE_PROJECT);
const auth = getAuth(app); // сессия хранится в IndexedDB расширения и переживает перезапуск
const db = getFirestore(app);

export class NotSignedIn extends Error {
  constructor() { super('Нужно войти: нажми на значок расширения.'); this.code = 'NOT_SIGNED_IN'; }
}

// Текущий человек (или null). Ждём, пока Firebase поднимет сохранённую сессию.
export async function getMe() {
  await auth.authStateReady();
  const email = auth.currentUser?.email;
  return email ? person(email) : null;
}

export async function getStatus() {
  const me = await getMe();
  return { me, partner: me ? partnerOf(me.email) : null, configured: !!OAUTH_CLIENT_ID };
}

/* Вход: окно выбора Google-аккаунта (launchWebAuthFlow) → access token →
   вход в Firebase этим токеном. В отличие от chrome.identity.getAuthToken,
   не зависит от того, под каким аккаунтом вошли в сам Chrome. */
export async function signIn() {
  if (!OAUTH_CLIENT_ID) throw new Error('Не задан OAUTH_CLIENT_ID в extension/config.js — см. extension/README.md.');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: OAUTH_CLIENT_ID,
    response_type: 'token',
    redirect_uri: REDIRECT_URI,
    scope: 'openid email profile',
    prompt: 'select_account',
  });
  const back = await chrome.identity.launchWebAuthFlow({ url: url.href, interactive: true });
  const hash = new URLSearchParams(new URL(back).hash.slice(1));
  if (hash.get('error')) throw new Error('Google: ' + hash.get('error'));
  const token = hash.get('access_token');
  if (!token) throw new Error('Google не вернул токен.');

  const res = await signInWithCredential(auth, GoogleAuthProvider.credential(null, token));
  const me = person(res.user.email || '');
  if (!me) {
    const email = res.user.email;
    await fbSignOut(auth);
    throw new Error(`${email} — не наш аккаунт. Войди как Совушка или Гусик.`);
  }
  return me;
}

export async function signOut() {
  await fbSignOut(auth);
}

// Создать задачу. data — поля как у createTask в приложении (без authorUid).
export async function createTask(data) {
  const me = await getMe();
  if (!me) throw new NotSignedIn();
  const task = buildTaskDoc({ ...data, authorUid: me.uid }, { serverTimestamp, Timestamp });
  const ref = await addDoc(collection(db, 'tasks'), task);
  const n = assignedNotification(ref.id, task);
  let notifId = null;
  if (n) notifId = (await addDoc(collection(db, 'notifications'), { ...n, createdAt: serverTimestamp() })).id;
  return { id: ref.id, notifId, title: task.title, assigneeUid: task.assigneeUid };
}

// «Отменить» из уведомления: удаляем задачу и уведомление партнёру о ней.
export async function undoTask(id, notifId) {
  await deleteDoc(doc(db, 'tasks', id));
  if (notifId) await deleteDoc(doc(db, 'notifications', notifId)).catch(() => {});
}

/* ---------------- Мурмур ---------------- */
async function requireMe() {
  const me = await getMe();
  if (!me) throw new NotSignedIn();
  return me;
}

// Есть ли уже такое в Мурмуре: сначала по ссылке (адрес страницы фильма — по сути
// его ID на сайте), потом по названию + году + типу (см. sameMurmur), чтобы
// ремейки и одноимённые сериалы не считались дублями. 1–2 чтения Firestore.
export async function findMurmur({ link, title, year = null, kind = null, extId = null }) {
  await requireMe();
  const col = collection(db, 'murmur');
  const pack = (d) => {
    const x = d.data();
    return { id: d.id, title: x.title, kind: x.kind, status: x.status, wantedBy: x.wantedBy || [] };
  };
  if (link) {
    const snap = await getDocs(query(col, where('link', '==', link), limit(1)));
    if (!snap.empty) return pack(snap.docs[0]);
  }
  const t = title?.trim();
  if (!t || !kind) return null;
  const snap = await getDocs(query(col, where('title', '==', t), limit(20)));
  const me = { title: t, year, kind, extId };
  const hits = snap.docs.filter((d) => sameMurmur(me, d.data()));
  // «Хотим» важнее архива: туда можно добавить своё «хочу»
  const hit = hits.find((d) => d.data().status !== 'done') || hits[0];
  return hit ? pack(hit) : null;
}

export async function addMurmur(data) {
  const me = await requireMe();
  const item = buildMurmurDoc({ ...data, uid: me.uid }, { serverTimestamp });
  if (!item) throw new Error('Пустое название.');
  const ref = await addDoc(collection(db, 'murmur'), item);
  return { id: ref.id, title: item.title, kind: item.kind };
}

// «Я тоже хочу» для уже добавленного партнёром.
export async function wantMurmur(id) {
  const me = await requireMe();
  await updateDoc(doc(db, 'murmur', id), { wantedBy: arrayUnion(me.uid) });
}

export async function undoMurmur(id) {
  await requireMe();
  await deleteDoc(doc(db, 'murmur', id));
}

/* ---------------- Вишлист ---------------- */
// Уже в вишлисте? Ищем по ссылке (одно чтение).
export async function findWish(url) {
  await requireMe();
  if (!url) return null;
  const snap = await getDocs(query(collection(db, 'wishlist'), where('url', '==', url), limit(1)));
  if (snap.empty) return null;
  const x = snap.docs[0].data();
  return { id: snap.docs[0].id, title: x.title, status: x.status, ownerUid: x.ownerUid };
}

export async function addWish(data) {
  const me = await requireMe();
  const w = buildWish({ ownerUid: me.uid, ...data });
  if (!w) throw new Error('Пустое название.');
  const ref = await addDoc(collection(db, 'wishlist'), { ...w, status: 'want', authorUid: me.uid, createdAt: serverTimestamp() });
  return { id: ref.id, title: w.title };
}

export async function undoWish(id) {
  await requireMe();
  await deleteDoc(doc(db, 'wishlist', id));
}

/* ---------------- Тема ---------------- */
// Тема и акцент, выбранные в приложении (userState/{email}.ui).
export async function getUi() {
  const me = await getMe();
  if (!me) return null;
  const snap = await getDoc(doc(db, 'userState', me.uid));
  return snap.exists() ? snap.data().ui || null : null;
}
