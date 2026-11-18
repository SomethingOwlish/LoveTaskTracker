// Валюты бюджета. Суммы операций хранятся в валюте кошелька; сводки
// пересчитываются в основную валюту (настройка бюджета) по курсу из fx.js.
export const CURRENCIES = {
  RSD: { label: 'Динар', symbol: 'дин.', digits: 0 },
  EUR: { label: 'Евро', symbol: '€', digits: 2 },
  USD: { label: 'Доллар', symbol: '$', digits: 2 },
  RUB: { label: 'Рубль', symbol: '₽', digits: 2 },
};
export const CURRENCY_CODES = Object.keys(CURRENCIES);
export const DEFAULT_BASE = 'RSD';

const fmtCache = {};
export function fmtCur(n, cur = DEFAULT_BASE) {
  const c = CURRENCIES[cur] ? cur : DEFAULT_BASE;
  const digits = CURRENCIES[c].digits;
  fmtCache[c] ||= new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const s = fmtCache[c].format(digits === 0 && Math.abs(v) >= 100 ? Math.round(v) : v);
  return c === 'USD' || c === 'EUR' ? `${s} ${CURRENCIES[c].symbol}` : `${s} ${CURRENCIES[c].symbol}`;
}
export const curOf = (x, base = DEFAULT_BASE) => (x && CURRENCIES[x.currency] ? x.currency : base);

// Запасные курсы (к евро) — пока не загрузились настоящие.
export const FALLBACK_FX = { base: 'EUR', rates: { EUR: 1, RSD: 117.2, USD: 1.1, RUB: 91 }, updatedAt: 0 };

// Пересчёт суммы между валютами через евро.
export function convert(amount, from, to, fx) {
  if (!amount || from === to) return amount || 0;
  const rates = fx?.rates || FALLBACK_FX.rates;
  const a = rates[from]; const b = rates[to];
  if (!a || !b) return amount;
  return (amount / a) * b;
}
