import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
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
export const db = getFirestore(app);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
