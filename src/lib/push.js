// Push-уведомления: подписка браузера (Web Push) хранится в Firestore
// pushSubs/{id}; рассылает их scripts/push/send.mjs через GitHub Actions.
import { db } from '../firebase';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

// Публичный VAPID-ключ кладёт в Firestore scripts/push/setup.mjs
// (секретная половина — в секретах GitHub).
async function vapidPublicKey() {
  const s = await getDoc(doc(db, 'pushConfig', 'vapid'));
  const k = s.data()?.publicKey;
  if (!k) throw new Error('Уведомления ещё не настроены: нужно один раз запустить scripts/push/setup.mjs с сервисным ключом Firebase.');
  return k;
}

export function pushSupport() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
    const standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone;
    if (ios && !standalone) return { ok: false, reason: 'На iPhone уведомления работают только в приложении, добавленном на экран «Домой» (iOS 16.4+).' };
    return { ok: false, reason: 'Этот браузер не поддерживает push-уведомления.' };
  }
  return { ok: true };
}

const b64ToBytes = (s) => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
// id подписки — хэш endpoint, чтобы одно устройство не плодило документы
async function subId(endpoint) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(h)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function registration() {
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) throw new Error('Service worker ещё не установлен — открой приложение по адресу сайта и попробуй снова.');
  return reg;
}

export async function currentSubscription() {
  if (!pushSupport().ok) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

export async function enablePush(uid) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Уведомления запрещены. Разреши их в настройках телефона для этого приложения.');
  const reg = await registration();
  const key = await vapidPublicKey();
  let sub = await reg.pushManager.getSubscription();
  // ключи сменились (повторный setup) — переподписываемся
  if (sub && sub.options?.applicationServerKey) {
    const cur = new Uint8Array(sub.options.applicationServerKey);
    const want = b64ToBytes(key);
    if (cur.length !== want.length || cur.some((b, i) => b !== want[i])) { await sub.unsubscribe(); sub = null; }
  }
  sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  const json = sub.toJSON();
  await setDoc(doc(db, 'pushSubs', await subId(json.endpoint)), {
    uid, endpoint: json.endpoint, keys: json.keys, ua: navigator.userAgent.slice(0, 160), createdAt: serverTimestamp(),
  });
  return sub;
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await deleteDoc(doc(db, 'pushSubs', await subId(sub.endpoint))).catch(() => {});
  await sub.unsubscribe();
}
