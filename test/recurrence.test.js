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

import { nextRecurrence as nr2, recurrenceLabel, parseEvery, everyKind } from '../src/lib/recurrence';
import { predictProjects, splitLines } from '../src/lib/taskPredict';
describe('свой интервал повтора', () => {
  it('раз в 3 дня', () => {
    expect(nr2(new Date(2026, 0, 30), 'every:3:d')).toEqual(new Date(2026, 1, 2));
  });
  it('раз в 2 месяца с концом месяца', () => {
    expect(nr2(new Date(2026, 11, 31), 'every:2:m')).toEqual(new Date(2027, 1, 28));
  });
  it('подписи', () => {
    expect(recurrenceLabel('every:3:d')).toBe('Раз в 3 дня');
    expect(recurrenceLabel('every:5:w')).toBe('Раз в 5 недель');
    expect(recurrenceLabel('every:1:m')).toBe('Раз в месяц');
    expect(recurrenceLabel('weekly')).toBe('Каждую неделю');
    expect(parseEvery(everyKind('0', 'd'))).toEqual({ n: 1, unit: 'd' });
  });
});
describe('угадывание проекта и список', () => {
  const tasks = [{ title: 'Купить продукты', projectTags: ['Дом'] }, { title: 'Отчёт по продажам', projectTags: ['Работа'] }];
  it('по похожим словам', () => {
    expect(predictProjects('продуктов на неделю', tasks)).toEqual(['Дом']);
    expect(predictProjects('Работа: созвон', tasks, ['Работа'])).toEqual(['Работа']);
    expect(predictProjects('погладить кота', tasks)).toEqual([]);
  });
  it('строки списка', () => {
    expect(splitLines('- молоко\n\n2. хлеб\n• сыр ')).toEqual(['молоко', 'хлеб', 'сыр']);
  });
});
