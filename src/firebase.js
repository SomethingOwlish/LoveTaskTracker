import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Конфиг из уже настроенного проекта tasktrackergando.
// Эти ключи публичны по дизайну Firebase — защита делается правилами Firestore
// (см. firestore.rules), а не сокрытием ключа.
// Вход через Google идёт через страницу /__/auth/handler. На Cloudflare воркер
// проксирует её с нашего же домена (см. worker/index.js) — так вход не ломается
// в Safari/PWA на iPhone. Локально и на старом github.io — напрямую через firebaseapp.com.
const host = typeof location !== 'undefined' ? location.hostname : '';
const proxiedAuth = host && !['localhost', '127.0.0.1'].includes(host) && !host.endsWith('github.io');

const firebaseConfig = {
  apiKey: 'AIzaSyAY0qWBJI0QWJv68PVTlG8YFa_anXuQSZg',
  authDomain: proxiedAuth ? location.host : 'tasktrackergando.firebaseapp.com',
  projectId: 'tasktrackergando',
  storageBucket: 'tasktrackergando.firebasestorage.app',
  messagingSenderId: '829759743503',
  appId: '1:829759743503:web:903d54f812bce3270b657a',
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
