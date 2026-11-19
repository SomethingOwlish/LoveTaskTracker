/* Вишлист: чистые функции (без Firestore) — их гоняют тесты. */
import { convert } from './currency';

export const WISH_TYPES = [
  { id: 'need', label: 'Нужно', icon: 'fa-solid fa-circle-exclamation', color: '#d98a5f' },
  { id: 'games', label: 'Для игр', icon: 'fa-solid fa-gamepad', color: '#7c8fd9' },
  { id: 'gift', label: 'Подарите мне', icon: 'fa-solid fa-gift', color: '#c97bb0' },
  { id: 'cute', label: 'Хуета, но милая', icon: 'fa-solid fa-face-smile-wink', color: '#85a96a' },
];
export const WISH_TYPE = Object.fromEntries(WISH_TYPES.map((t) => [t.id, t]));

// Ссылку можно вставить без протокола — «ozon.ru/…» → «https://ozon.ru/…».
// Пустая или не похожая на адрес — null.
export function normalizeUrl(s) {
  const v = String(s || '').trim();
  if (!v) return null;
  const withProto = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withProto);
    if (!u.hostname.includes('.')) return null;
    return u.href;
  } catch {
    return null;
  }
}

// Короткая подпись ссылки: домен без www.
export function urlLabel(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'ссылка'; }
}

// Документ хотелки из полей формы. null — если нет названия.
export function buildWish(data) {
  const title = String(data.title || '').trim().slice(0, 300);
  if (!title) return null;
  const price = Number(data.price);
  return {
    title,
    url: normalizeUrl(data.url),
    price: Number.isFinite(price) && price > 0 ? Math.round(price * 100) / 100 : null,
    currency: data.currency || null,
    type: WISH_TYPE[data.type] ? data.type : 'need',
    ownerUid: data.ownerUid,
    note: String(data.note || '').trim().slice(0, 2000),
  };
}

// Отбор по владельцу ('all' | uid) и типу ('all' | id).
export function filterWishes(list, { owner = 'all', type = 'all' } = {}) {
  return list.filter((w) => (owner === 'all' || w.ownerUid === owner) && (type === 'all' || w.type === type));
}

// Сумма хотелок с ценой в основной валюте; сколько без цены.
export function wishTotal(list, base, fx) {
  let sum = 0;
  let priced = 0;
  list.forEach((w) => {
    if (!w.price) return;
    priced += 1;
    sum += convert(w.price, w.currency || base, base, fx);
  });
  return { sum: Math.round(sum * 100) / 100, priced, unpriced: list.length - priced };
}
