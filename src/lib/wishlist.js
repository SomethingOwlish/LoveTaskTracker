import { db } from '../firebase';
import {
  collection, doc, addDoc, updateDoc, deleteDoc, onSnapshot, query, where, serverTimestamp,
} from 'firebase/firestore';
import { tsMs } from './util';
import { reportError } from './toast';
import { buildWish } from './wishMath';

/* wishlist/{id} { title, url|null, price|null, currency|null, type: need|games|gift|cute,
                   ownerUid, note, status: want|got, gotAt?, gotBy?, authorUid, createdAt }
   Живьём читаем только то, что ещё хотим; добытое (архив) — по запросу. */
const col = collection(db, 'wishlist');

const sub = (q, cb, sort) => onSnapshot(q, (snap) => {
  const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  if (sort) list.sort(sort);
  cb(list);
}, (e) => reportError(e));

export const subscribeWishes = (cb) => sub(query(col, where('status', '==', 'want')), cb, (a, b) => tsMs(b.createdAt) - tsMs(a.createdAt));
// без orderBy: равенство + сортировка по другому полю потребовали бы составной индекс
export const subscribeGotWishes = (cb) => sub(query(col, where('status', '==', 'got')), cb, (a, b) => tsMs(b.gotAt) - tsMs(a.gotAt));

export function saveWish(id, data, authorUid) {
  const w = buildWish(data);
  if (!w) return Promise.resolve();
  if (id) return updateDoc(doc(col, id), w);
  return addDoc(col, { ...w, status: 'want', authorUid, createdAt: serverTimestamp() });
}
export const markWishGot = (id, uid) => updateDoc(doc(col, id), { status: 'got', gotAt: serverTimestamp(), gotBy: uid });
export const unmarkWishGot = (id) => updateDoc(doc(col, id), { status: 'want', gotAt: null, gotBy: null });
export const deleteWish = (id) => deleteDoc(doc(col, id));
