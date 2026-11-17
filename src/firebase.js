import { initializeApp } from 'firebase/app';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// Конфиг из уже настроенного проекта tasktrackergando.
// Эти ключи публичны по дизайну Firebase — защита делается правилами Firestore
// (см. firestore.rules), а не сокрытием ключа.
const firebaseConfig = {
  apiKey: 'AIzaSyAY0qWBJI0QWJv68PVTlG8YFa_anXuQSZg',
  authDomain: 'tasktrackergando.firebaseapp.com',
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
