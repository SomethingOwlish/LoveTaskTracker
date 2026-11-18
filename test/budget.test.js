import { describe, it, expect } from 'vitest';
import { effectDiff, byCategory, totals, walletBalances } from '../src/lib/budgetMath';
import { parseMoney } from '../src/lib/util';

const exp = (o) => ({ type: 'expense', amount: 100, walletId: 'card', category: 'Кафе', planned: false, items: [], ...o });

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
    expect(effectDiff(exp({ projectId: 'p1' }), null)).toEqual({ wallets: { card: -100 }, projects: { p1: { income: 0, expense: 100 } } });
  });
  it('без кошелька — только проект', () => {
    expect(effectDiff({ type: 'income', amount: 1000, walletId: null, projectId: 'p1', planned: false }, null))
      .toEqual({ wallets: {}, projects: { p1: { income: 1000, expense: 0 } } });
  });
  it('копейки не накапливают ошибку', () => {
    expect(effectDiff(exp({ amount: 0.3 }), exp({ amount: 0.1 })).wallets.card).toBe(-0.2);
  });
});

describe('byCategory / totals', () => {
  it('разбивка чека по позициям + остаток в категорию операции', () => {
    const t = exp({ amount: 3450.5, category: 'Продукты', items: [
      { title: 'Сыр', amount: 650, category: 'Продукты' },
      { title: 'Корм', amount: 1200, category: 'Питомцы' },
    ] });
    expect(byCategory([t, exp({ planned: true })])).toEqual([
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
