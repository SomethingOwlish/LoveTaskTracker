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
  // «другая» валюта (свой код, например GBP) — без символа, с кодом
  if (cur && !CURRENCIES[cur] && /^[A-Z]{3}$/.test(cur)) {
    const v = Math.round((Number(n) || 0) * 100) / 100;
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(v)} ${cur}`;
  }
  const c = CURRENCIES[cur] ? cur : DEFAULT_BASE;
  const digits = CURRENCIES[c].digits;
  fmtCache[c] ||= new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const s = fmtCache[c].format(digits === 0 && Math.abs(v) >= 100 ? Math.round(v) : v);
  return `${s} ${CURRENCIES[c].symbol}`;
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

// Код валюты из поля «другое»: три латинские буквы → верхний регистр, иначе ''.
export function normCode(s) {
  const c = String(s || '').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : '';
}

// Курс «1 from = ? to» по кэшу fx; null — если одной из валют в кэше нет
// (тогда курс вводится руками).
export function fxRate(from, to, fx) {
  if (!from || !to) return null;
  if (from === to) return 1;
  const rates = { ...FALLBACK_FX.rates, ...(fx?.rates || {}) };
  const a = rates[from]; const b = rates[to];
  return a > 0 && b > 0 ? b / a : null;
}
