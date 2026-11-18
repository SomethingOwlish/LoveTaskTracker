import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { FIREBASE_PROJECT } from './firebaseConfig';

// Конфиг проекта — в firebaseConfig.js (его же использует расширение Chrome).
// Вход через Google идёт через страницу /__/auth/handler. На Cloudflare воркер
// проксирует её с нашего же домена (см. worker/index.js) — так вход не ломается
// в Safari/PWA на iPhone. Локально и на старом github.io — напрямую через firebaseapp.com.
const host = typeof location !== 'undefined' ? location.hostname : '';
const proxiedAuth = host && !['localhost', '127.0.0.1'].includes(host) && !host.endsWith('github.io');

const firebaseConfig = {
  ...FIREBASE_PROJECT,
  authDomain: proxiedAuth ? location.host : FIREBASE_PROJECT.authDomain,
};

const app = initializeApp(firebaseConfig);

// Локальный кэш в IndexedDB: на телефоне приложение открывается мгновенно
// с последними данными и работает без сети (изменения доедут при появлении связи).
let firestore;
try {
  firestore = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch {
  firestore = initializeFirestore(app, {});
}
export const db = firestore;
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
