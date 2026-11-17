// Мини-шина всплывающих сообщений (тостов). Любой модуль зовёт toast(...),
// компонент <Toasts/> в App показывает их над нижним меню.
const listeners = new Set();
let seq = 0;

export function toast(text, { kind = 'info', ms = 4000, action = null } = {}) {
  const t = { id: ++seq, text, kind, ms, action };
  listeners.forEach((l) => l(t));
  return t.id;
}
export const toastError = (text) => toast(text, { kind: 'error', ms: 6000 });

export function onToast(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Человеческий текст для ошибок Firestore.
export function explainError(e) {
  const code = e?.code || '';
  if (code.includes('permission-denied')) return 'Нет доступа к данным. Проверь, что правила Firestore опубликованы и ты вошла под нужным аккаунтом.';
  if (code.includes('unavailable')) return 'Нет связи с сервером — покажу то, что сохранено на телефоне.';
  if (code.includes('resource-exhausted')) return 'Исчерпан дневной лимит Firestore. Завтра всё заработает снова.';
  if (code.includes('unauthenticated')) return 'Сессия истекла — войди заново.';
  return 'Ошибка: ' + (e?.message || e);
}

// Не спамим одним и тем же сообщением от нескольких подписок сразу.
const recent = new Map();
export function reportError(e, prefix = '') {
  const text = (prefix ? prefix + ': ' : '') + explainError(e);
  const now = Date.now();
  if (recent.get(text) > now - 15000) return;
  recent.set(text, now);
  console.warn(e);
  toastError(text);
}
