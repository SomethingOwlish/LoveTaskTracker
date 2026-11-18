import { describe, it, expect } from 'vitest';
import { effectDiff, byCategory, totals, walletBalances, projectTotals, nextOccurrence } from '../src/lib/budgetMath';
import { convert } from '../src/lib/currency';
import { parseMoney } from '../src/lib/util';

const exp = (o) => ({ type: 'expense', amount: 100, currency: 'RSD', walletId: 'card', category: 'Кафе', planned: false, items: [], ...o });
const fx = { rates: { EUR: 1, RSD: 117, USD: 1.1, RUB: 90 } };

describe('effectDiff — счётчики кошельков и проектов', () => {
  it('новый расход уменьшает кошелёк', () => {
    expect(effectDiff(exp(), null)).toEqual({ wallets: { card: -100 }, projects: {} });
  });
  it('удаление возвращает деньги', () => {
    expect(effectDiff(null, exp())).toEqual({ wallets: { card: 100 }, projects: {} });
  });
  it('правка суммы двигает на разницу', () => {
    expect(effectDiff(exp({ amount: 130.5 }), exp())).toEqual({ wallets: { card: -30.5 }, projects: {} });
  });
  it('смена кошелька переносит сумму', () => {
    expect(effectDiff(exp({ walletId: 'cash' }), exp())).toEqual({ wallets: { cash: -100, card: 100 }, projects: {} });
  });
  it('запланированная не двигает ничего, проведение — двигает', () => {
    expect(effectDiff(exp({ planned: true }), null)).toEqual({ wallets: {}, projects: {} });
    expect(effectDiff(exp(), exp({ planned: true }))).toEqual({ wallets: { card: -100 }, projects: {} });
  });
  it('перевод: минус в одном, плюс в другом', () => {
    const t = { type: 'transfer', amount: 500, walletId: 'card', toWalletId: 'savings', planned: false };
    expect(effectDiff(t, null)).toEqual({ wallets: { card: -500, savings: 500 }, projects: {} });
  });
  it('расход проекта считается и в проекте', () => {
    expect(effectDiff(exp({ projectId: 'p1' }), null)).toEqual({ wallets: { card: -100 }, projects: { p1: { RSD: { income: 0, expense: 100 } } } });
  });
  it('без кошелька — только проект', () => {
    expect(effectDiff({ type: 'income', amount: 1000, currency: 'USD', walletId: null, projectId: 'p1', planned: false }, null))
      .toEqual({ wallets: {}, projects: { p1: { USD: { income: 1000, expense: 0 } } } });
  });
  it('копейки не накапливают ошибку', () => {
    expect(effectDiff(exp({ amount: 0.3 }), exp({ amount: 0.1 })).wallets.card).toBe(-0.2);
  });
});

describe('комиссии, налоги, валюты', () => {
  it('расход с комиссией списывает сумму + комиссию', () => {
    expect(effectDiff(exp({ fee: 4 }), null).wallets).toEqual({ card: -104 });
  });
  it('доход с налогом зачисляет сумму − налог', () => {
    const t = { type: 'income', amount: 3000, fee: 300, feeCategory: 'Налоги', currency: 'USD', walletId: 'usd', planned: false };
    expect(effectDiff(t, null).wallets).toEqual({ usd: 2700 });
  });
  it('перевод USD → EUR: уходит сумма + комиссия, приходит toAmount', () => {
    const t = { type: 'transfer', amount: 1000, fee: 5, currency: 'USD', walletId: 'usd', toWalletId: 'eur', toAmount: 905.3, toCurrency: 'EUR', planned: false };
    expect(effectDiff(t, null).wallets).toEqual({ usd: -1005, eur: 905.3 });
  });
  it('правка комиссии двигает только разницу', () => {
    expect(effectDiff(exp({ fee: 10 }), exp({ fee: 4 })).wallets).toEqual({ card: -6 });
  });
  it('комиссии и налоги попадают в свои категории (с доходов и переводов тоже)', () => {
    const list = [
      exp({ fee: 4 }),
      { type: 'income', amount: 1000, fee: 100, feeCategory: 'Налоги', currency: 'RSD', planned: false },
      { type: 'transfer', amount: 500, fee: 6, currency: 'RSD', planned: false },
    ];
    expect(byCategory(list, 'RSD')).toEqual([
      { cat: 'Кафе', sum: 100 },
      { cat: 'Налоги', sum: 100 },
      { cat: 'Комиссии', sum: 10 },
    ]);
    expect(totals(list, 'RSD')).toEqual({ income: 1000, expense: 210 });
  });
  it('сводки пересчитываются в основную валюту', () => {
    const list = [exp({ amount: 10, currency: 'EUR' }), exp({ amount: 117 })];
    expect(totals(list, 'RSD', fx)).toEqual({ income: 0, expense: 1287 });
    expect(convert(110, 'USD', 'EUR', fx)).toBeCloseTo(100);
  });
  it('итоги проекта по валютам → в основной', () => {
    const p = { totals: { EUR: { income: 100, expense: 10 }, RSD: { income: 0, expense: 117 } } };
    expect(projectTotals(p, 'RSD', fx)).toEqual({ income: 11700, expense: 1287 });
  });
});

describe('nextOccurrence — регулярные платежи', () => {
  it('ежемесячно в тот же день, 31-е → последний день', () => {
    expect(nextOccurrence('2026-11-05', 'month', 5)).toBe('2026-12-05');
    expect(nextOccurrence('2026-12-05', 'month', 5)).toBe('2027-01-05');
    expect(nextOccurrence('2027-01-31', 'month', 31)).toBe('2027-02-28');
    expect(nextOccurrence('2027-02-28', 'month', 31)).toBe('2027-03-31');
  });
  it('еженедельно', () => {
    expect(nextOccurrence('2026-12-29', 'week')).toBe('2027-01-05');
  });
});

describe('byCategory / totals', () => {
  it('разбивка чека по позициям + остаток в категорию операции', () => {
    const t = exp({ amount: 3450.5, category: 'Продукты', items: [
      { title: 'Сыр', amount: 650, category: 'Продукты' },
      { title: 'Корм', amount: 1200, category: 'Питомцы' },
    ] });
    expect(byCategory([t, exp({ planned: true })], 'RSD')).toEqual([
      { cat: 'Продукты', sum: 2250.5 },
      { cat: 'Питомцы', sum: 1200 },
    ]);
  });
  it('итоги без запланированных и переводов', () => {
    expect(totals([exp(), exp({ planned: true }), { type: 'income', amount: 50 }, { type: 'transfer', amount: 999 }]))
      .toEqual({ income: 50, expense: 100 });
  });
  it('остатки кошельков из счётчиков', () => {
    expect(walletBalances([{ id: 'a', balance: 10.004 }, { id: 'b' }])).toEqual({ a: 10, b: 0 });
  });
});

describe('parseMoney', () => {
  it('понимает пробелы, запятую и ₽', () => {
    expect(parseMoney('1 234,5 ₽')).toBe(1234.5);
    expect(parseMoney('abc')).toBeNaN();
  });
});
