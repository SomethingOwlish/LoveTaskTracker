import { describe, it, expect } from 'vitest';
import { convertInput, inputOf, effectDiff, totals, byCategory, projectTotals } from '../src/lib/budgetMath';
import { fxRate, normCode, fmtCur } from '../src/lib/currency';

const fx = { rates: { EUR: 1, RSD: 117, USD: 1.1, RUB: 90, GBP: 0.85 } };

describe('fxRate / normCode', () => {
  it('курс через евро', () => {
    expect(fxRate('USD', 'RSD', fx)).toBeCloseTo(106.3636, 3);
    expect(fxRate('RSD', 'RSD', fx)).toBe(1);
    expect(fxRate('GBP', 'RSD', fx)).toBeCloseTo(137.647, 2);
  });
  it('нет валюты в справочнике → null (вводится руками)', () => {
    expect(fxRate('XYZ', 'RSD', fx)).toBeNull();
    expect(fxRate('', 'RSD', fx)).toBeNull();
  });
  it('без загруженных курсов — запасные', () => {
    expect(fxRate('EUR', 'RSD', null)).toBeCloseTo(117.2);
  });
  it('код «другой» валюты', () => {
    expect(normCode(' gbp ')).toBe('GBP');
    expect(normCode('фунт')).toBe('');
    expect(normCode('GB')).toBe('');
  });
  it('формат своей валюты — с кодом', () => {
    expect(fmtCur(12.5, 'GBP')).toMatch(/12,5\s?GBP/);
  });
});

describe('convertInput — доход/расход в другой валюте', () => {
  it('зарплата 1000 $ на динарную карту по курсу 106,5', () => {
    const r = convertInput({ type: 'income', amount: 1000, fee: 100, origCurrency: 'USD', rate: 106.5 }, 'RSD');
    expect(r).toMatchObject({ currency: 'RSD', amount: 106500, fee: 10650, origCurrency: 'USD', origAmount: 1000, origFee: 100, rate: 106.5 });
  });
  it('та же валюта — ничего не пересчитывает', () => {
    const r = convertInput({ type: 'expense', amount: 500, fee: 0, origCurrency: 'RSD', rate: 99 }, 'RSD');
    expect(r).toMatchObject({ currency: 'RSD', amount: 500, origCurrency: null, origAmount: null, rate: null });
  });
  it('перевод не пересчитывается (у него свой «пришло»)', () => {
    expect(convertInput({ type: 'transfer', amount: 10, origCurrency: 'USD', rate: 100 }, 'RSD').amount).toBe(10);
  });
  it('позиции чека тоже пересчитываются, копейки округляются', () => {
    const r = convertInput({ type: 'expense', amount: 1000, origCurrency: 'RUB', rate: 1.2987,
      items: [{ id: 'a', title: 'Сыр', amount: 333.33, category: 'Продукты' }] }, 'RSD');
    expect(r.amount).toBe(1298.7);
    expect(r.items[0]).toMatchObject({ amount: 432.9, origAmount: 333.33 });
  });
  it('без курса — ошибка, а не тихий 1:1', () => {
    expect(() => convertInput({ type: 'income', amount: 1, origCurrency: 'XYZ', rate: NaN }, 'RSD')).toThrow();
  });
  it('inputOf возвращает исходные суммы для правки', () => {
    const saved = convertInput({ type: 'expense', amount: 20, fee: 1, origCurrency: 'EUR', rate: 117,
      items: [{ id: 'a', amount: 5 }] }, 'RSD');
    expect(inputOf(saved)).toMatchObject({ origCurrency: 'EUR', rate: 117, amount: 20, fee: 1, items: [{ amount: 5 }] });
    expect(inputOf({ amount: 7, fee: 0 })).toMatchObject({ origCurrency: null, amount: 7 });
  });
});

describe('итоги и счётчики считают пересчитанное', () => {
  const salary = { type: 'income', walletId: 'card', projectId: 'p1', planned: false,
    ...convertInput({ type: 'income', amount: 1000, fee: 0, origCurrency: 'USD', rate: 106.5 }, 'RSD') };
  const old = { type: 'expense', amount: 300, walletId: 'card', category: 'Кафе', planned: false }; // старая, без валюты

  it('кошелёк и проект получают динары', () => {
    expect(effectDiff(salary, null)).toEqual({ wallets: { card: 106500 }, projects: { p1: { RSD: { income: 106500, expense: 0 } } } });
    expect(projectTotals({ totals: effectDiff(salary, null).projects.p1 }, 'RSD', fx)).toEqual({ income: 106500, expense: 0 });
  });
  it('итоги месяца — по сохранённому курсу, а не сегодняшнему', () => {
    expect(totals([salary, old], 'RSD', fx)).toEqual({ income: 106500, expense: 300 });
  });
  it('правка курса двигает кошелёк на разницу', () => {
    const fixed = { ...salary, ...convertInput({ type: 'income', amount: 1000, origCurrency: 'USD', rate: 107 }, 'RSD') };
    expect(effectDiff(fixed, salary).wallets).toEqual({ card: 500 });
  });
  it('расход в евро с карты в динарах попадает в категории в динарах', () => {
    const t = { type: 'expense', walletId: 'card', category: 'Кафе', planned: false,
      ...convertInput({ type: 'expense', amount: 10, fee: 0, origCurrency: 'EUR', rate: 117 }, 'RSD') };
    expect(byCategory([t, old], 'RSD', fx)).toEqual([{ cat: 'Кафе', sum: 1470 }]);
  });
});
