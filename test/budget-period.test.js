import { describe, it, expect } from 'vitest';
import { salaryStarts, periodOf, inPeriod, prevPeriod, nextPeriod, lastPeriods, planProgress, periodEnd } from '../src/lib/budgetMath';

const D = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
const starts = salaryStarts([{ date: D(2026, 10, 25) }, { date: D(2026, 11, 24) }, { date: D(2026, 12, 1), planned: true }]);

describe('бюджетный месяц от зарплаты', () => {
  it('запланированная зарплата месяц не открывает', () => {
    expect(starts.map((d) => d.getDate())).toEqual([25, 24]);
  });
  it('текущий период — с последней зарплаты и открыт', () => {
    const p = periodOf(D(2026, 11, 30), starts);
    expect(p.from).toEqual(new Date(2026, 10, 24));
    expect(p.to).toBeNull();
    expect(p.salary).toBe(true);
  });
  it('между зарплатами — закрытый период', () => {
    const p = periodOf(D(2026, 11, 10), starts);
    expect(p.from).toEqual(new Date(2026, 9, 25));
    expect(p.to).toEqual(new Date(2026, 10, 24));
  });
  it('до первой зарплаты — календарный месяц, обрезанный зарплатой', () => {
    const p = periodOf(D(2026, 10, 3), starts);
    expect(p.from).toEqual(new Date(2026, 9, 1));
    expect(p.to).toEqual(new Date(2026, 9, 25));
    expect(prevPeriod(p, starts).from).toEqual(new Date(2026, 8, 1));
    expect(nextPeriod(p, starts).from).toEqual(new Date(2026, 9, 25));
  });
  it('открытый период: факт без конца, план — до того же числа', () => {
    const p = periodOf(D(2026, 11, 30), starts);
    expect(periodEnd(p)).toEqual(new Date(2026, 11, 24));
    expect(inPeriod({ date: D(2027, 1, 5) }, p)).toBe(true);
    expect(inPeriod({ date: D(2027, 1, 5), planned: true }, p)).toBe(false);
    expect(nextPeriod(p, starts)).toBeNull();
  });
  it('последние периоды', () => {
    expect(lastPeriods(3, starts, D(2026, 11, 30)).map((p) => p.from.getDate())).toEqual([1, 25, 24]);
  });
});

describe('план по категориям', () => {
  const plan = (id, amount, d, category = 'Продукты') => ({ id, type: 'expense', planned: true, amount, currency: 'RSD', category, date: D(2026, 11, d) });
  const spend = (amount, category = 'Продукты') => ({ type: 'expense', planned: false, amount, currency: 'RSD', category, items: [] });
  it('трата в категории вычитается из плана', () => {
    expect(planProgress([plan('a', 30000, 25)], [spend(2000), spend(500, 'Кафе')], 'RSD'))
      .toEqual({ a: { plan: 30000, spent: 2000, left: 28000 } });
  });
  it('несколько планов съедаются по очереди', () => {
    const r = planProgress([plan('b', 1000, 28), plan('a', 1000, 25)], [spend(1500)], 'RSD');
    expect(r.a.left).toBe(0);
    expect(r.b.left).toBe(500);
  });
  it('перерасход не уходит в минус', () => {
    expect(planProgress([plan('a', 1000, 25)], [spend(5000)], 'RSD').a).toEqual({ plan: 1000, spent: 1000, left: 0 });
  });
});

import { spendBy, whoseOf, dailyAllowance, guessCategory } from '../src/lib/budgetMath';
import { nextRecurrence, recurrenceLabel } from '../src/lib/recurrence';
import { wantOrder, isStarted } from '../src/lib/murmurUtil';

describe('чья трата', () => {
  const owl = 'owl@x'; const goose = 'goose@x';
  const pockets = { 'Карманные Совы': owl };
  const e = (o) => ({ type: 'expense', planned: false, currency: 'RSD', items: [], authorUid: goose, ...o });
  it('продукты и коммуналка — всегда общие, карманные — владельца', () => {
    expect(whoseOf(e({ category: 'Продукты', forUid: owl }))).toBeNull();
    expect(whoseOf(e({ category: 'Карманные Совы' }), null, pockets)).toBe(owl);
    expect(whoseOf(e({ category: 'Кафе', forUid: owl }))).toBe(owl);
    expect(whoseOf(e({ category: 'Кафе', forUid: null }))).toBeNull();
    expect(whoseOf(e({ category: 'Кафе' }))).toBe(goose); // старая — кто внёс
  });
  it('раскладка с позициями чека', () => {
    const t = e({ category: 'Одежда', forUid: owl, amount: 1000, items: [{ amount: 300, category: 'Продукты' }] });
    expect(spendBy([t], 'RSD')).toEqual({ common: 300, [owl]: 700 });
  });
});

describe('остаток в день и угадывание категории', () => {
  it('делит на дни до конца периода', () => {
    const p = { from: new Date(2026, 10, 24), to: null, salary: true };
    expect(dailyAllowance(1000, p, new Date(2026, 11, 14, 15))).toEqual({ days: 10, perDay: 100 });
  });
  it('словарь и выученное', () => {
    expect(guessCategory('Лидл вечером')).toBe('Продукты');
    expect(guessCategory('такси домой')).toBe('Транспорт');
    expect(guessCategory('лидл', { лидл: 'Дом' })).toBe('Дом');
    expect(guessCategory('что-то')).toBeNull();
  });
});

describe('повтор по дням недели', () => {
  it('пн/ср/пт: с пятницы — на понедельник', () => {
    expect(nextRecurrence(new Date(2026, 10, 20), 'days:1,3,5')).toEqual(new Date(2026, 10, 23));
    expect(recurrenceLabel('days:1,3,5')).toBe('По пн, ср, пт');
    expect(recurrenceLabel('days:1,2,3,4,5')).toBe('По будням');
  });
});

describe('начатые сериалы выше', () => {
  it('серия отмечена — значит начат', () => {
    const a = { watched: { s1: [1] }, wantedBy: [1], createdAt: 1 };
    const b = { wantedBy: [1, 2], createdAt: 2 };
    expect(isStarted(a)).toBe(true);
    expect([b, a].sort((x, y) => wantOrder(x, y, (v) => v))[0]).toBe(a);
  });
});
