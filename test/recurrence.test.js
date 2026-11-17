import { describe, it, expect } from 'vitest';
import { nextRecurrence, nextFutureRecurrence } from '../src/lib/recurrence';

const d = (y, m, day, h = 18) => new Date(y, m - 1, day, h, 0, 0, 0);

describe('nextRecurrence', () => {
  it('сдвигает на день/неделю/две недели', () => {
    expect(nextRecurrence(d(2026, 11, 17), 'daily')).toEqual(d(2026, 11, 18));
    expect(nextRecurrence(d(2026, 11, 17), 'weekly')).toEqual(d(2026, 11, 24));
    expect(nextRecurrence(d(2026, 11, 17), 'biweekly')).toEqual(d(2026, 12, 1));
  });
  it('месяц: 31 января → 28 февраля, а не 3 марта', () => {
    expect(nextRecurrence(d(2026, 1, 31), 'monthly')).toEqual(d(2026, 2, 28));
    expect(nextRecurrence(d(2028, 1, 31), 'monthly')).toEqual(d(2028, 2, 29));
    expect(nextRecurrence(d(2026, 12, 15), 'monthly')).toEqual(d(2027, 1, 15));
  });
});

describe('nextFutureRecurrence', () => {
  const now = d(2026, 11, 17, 12);
  it('просроченная на несколько периодов встаёт в будущее', () => {
    expect(nextFutureRecurrence(d(2026, 11, 1), 'weekly', now)).toEqual(d(2026, 11, 22));
  });
  it('сделанная заранее — следующий период после срока', () => {
    expect(nextFutureRecurrence(d(2026, 11, 20), 'weekly', now)).toEqual(d(2026, 11, 27));
  });
  it('ежедневная, закрытая днём со сроком сегодня вечером → завтра', () => {
    expect(nextFutureRecurrence(d(2026, 11, 17), 'daily', now)).toEqual(d(2026, 11, 18));
  });
});
