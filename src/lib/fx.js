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
  return onSnapshot(REF, (s) => {
    const d = s.data();
    cb(d?.rates ? d : FALLBACK);
    const stale = !d?.updatedAt || Date.now() - d.updatedAt > MAX_AGE;
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
  const rates = { EUR: 1 };
  ['RSD', 'USD', 'RUB'].forEach((c) => { if (j.rates?.[c]) rates[c] = j.rates[c]; });
  await setDoc(REF, { base: 'EUR', rates, updatedAt: Date.now() });
}

export { convert } from './currency';
