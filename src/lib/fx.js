// Курсы валют для сводок. Берём бесплатный open.er-api.com (без ключа, есть
// динар) не чаще раза в 12 часов и кэшируем в Firestore fx/latest, чтобы
// второй телефон не дёргал API. Реальные курсы обмена у вас в переводах
// (сколько ушло / сколько пришло) — они хранятся в самих операциях.
import { db } from '../firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';

const REF = doc(db, 'fx', 'latest');
const MAX_AGE = 12 * 3600 * 1000;
import { FALLBACK_FX as FALLBACK } from './currency';

export function subscribeRates(cb) {
  let refreshed = false;
  // includeMetadataChanges — иначе при кэше не узнаем, что сервер ответил, и курс не обновится
  return onSnapshot(REF, { includeMetadataChanges: true }, (s) => {
    const d = s.data();
    cb(d?.rates ? d : FALLBACK);
    // старый кэш хранил только 4 валюты — обновляем, чтобы появились остальные
    const stale = !d?.updatedAt || Date.now() - d.updatedAt > MAX_AGE || Object.keys(d.rates || {}).length < 10;
    if (stale && !refreshed && !s.metadata.fromCache) {
      refreshed = true;
      refreshRates().catch(() => {});
    }
  }, () => cb(FALLBACK));
}

async function refreshRates() {
  const r = await fetch('https://open.er-api.com/v6/latest/EUR');
  const j = await r.json();
  if (j.result !== 'success') return;
  // храним все курсы (~160 чисел): нужны и для валюты «другое» в операциях
  const rates = { EUR: 1 };
  Object.entries(j.rates || {}).forEach(([c, v]) => { if (/^[A-Z]{3}$/.test(c) && v > 0) rates[c] = v; });
  await setDoc(REF, { base: 'EUR', rates, updatedAt: Date.now() });
}

export { convert, fxRate } from './currency';
