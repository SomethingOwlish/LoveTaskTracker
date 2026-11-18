// Firebase в расширении. Живёт только в фоновом скрипте (service worker):
// форма и меню общаются с ним сообщениями, так что вход и запись — в одном месте.
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithCredential, signOut as fbSignOut,
} from 'firebase/auth/web-extension';
import {
  getFirestore, collection, addDoc, deleteDoc, doc, serverTimestamp, Timestamp,
} from 'firebase/firestore/lite';
import { FIREBASE_PROJECT } from '../../src/firebaseConfig.js';
import { buildTaskDoc, assignedNotification } from '../../src/lib/taskDoc.js';
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
