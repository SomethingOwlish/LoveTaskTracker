import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MOOD_LEGEND, MIN_SHARE, legendOf, moodItems, resolveMood, toggleMoodItem, moveShareBoundary, toPercents, moodShares,
  moodCellStyle, monthCounts, missingDefaults, shouldRemind, stripes,
} from '../src/lib/mood.js';

const legacy = { uid: 'a', day: '2026-11-03', itemId: 'good', color: '#000', label: 'Старое', note: 'n' };
const multi = { uid: 'a', day: '2026-11-04', items: [{ itemId: 'great', color: '#111', label: 'x' }, { itemId: 'sad', color: '#222', label: 'y' }] };

describe('набор состояний', () => {
  it('расширенный, без повторов, старые id на месте', () => {
    expect(DEFAULT_MOOD_LEGEND.length).toBeGreaterThanOrEqual(12);
    expect(DEFAULT_MOOD_LEGEND.length).toBeLessThanOrEqual(16);
    const ids = DEFAULT_MOOD_LEGEND.map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(DEFAULT_MOOD_LEGEND.map((x) => x.color)).size).toBe(ids.length);
    ['great', 'good', 'calm', 'tired', 'sad', 'angry'].forEach((id) => expect(ids).toContain(id));
  });
  it('сохранённая легенда не подменяется, а новые пункты предлагаются', () => {
    const mine = [{ id: 'great', color: '#f00', label: 'Супер' }, { id: 'z', color: '#0f0', label: 'грустно' }];
    expect(legendOf({ a: mine }, 'a')).toBe(mine);
    expect(legendOf({}, 'a')).toBe(DEFAULT_MOOD_LEGEND);
    const miss = missingDefaults(mine).map((x) => x.id);
    expect(miss).not.toContain('great');
    expect(miss).not.toContain('sad'); // совпало по названию
    expect(miss).toContain('love');
  });
});

describe('несколько цветов за день', () => {
  it('старая запись читается как один цвет', () => {
    expect(moodItems(legacy)).toEqual([{ itemId: 'good', color: '#000', label: 'Старое' }]);
    const r = resolveMood(legacy, {});
    expect(r.items).toHaveLength(1);
    expect(r.color).toBe('#8cc084'); // цвет из текущей легенды
    expect(r.note).toBe('n');
  });
  it('удалённый из легенды пункт берётся из снимка', () => {
    const r = resolveMood({ ...legacy, itemId: 'gone' }, {});
    expect(r.items[0]).toMatchObject({ color: '#000', label: 'Старое' });
  });
  it('новая запись — все цвета', () => {
    const r = resolveMood(multi, {});
    expect(r.items.map((x) => x.id)).toEqual(['great', 'sad']);
    expect(r.label).toBe('Отлично, Грустно');
  });
  it('нажатие добавляет и снимает, без ограничения на число цветов', () => {
    const L = DEFAULT_MOOD_LEGEND;
    let cur = toggleMoodItem([], L[0]);
    expect(cur[0].pct).toBe(100);
    cur = toggleMoodItem(cur, L[1]);
    expect(cur.map((x) => x.itemId)).toEqual(['great', 'good']);
    expect(cur.map((x) => x.pct)).toEqual([50, 50]);
    expect(toggleMoodItem(cur, L[0])).toEqual([{ itemId: 'good', color: L[1].color, label: L[1].label, pct: 100 }]);
    for (let i = 2; i < 8; i++) cur = toggleMoodItem(cur, L[i]);
    expect(cur).toHaveLength(8);
    expect(cur.reduce((a, x) => a + x.pct, 0)).toBe(100);
  });
  it('доли: проценты в сумме 100, старые записи поровну', () => {
    expect(toPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(toPercents([3, 1])).toEqual([75, 25]);
    expect(moodShares(multi.items)).toEqual([50, 50]);
    expect(resolveMood(multi, {}).items.map((x) => x.pct)).toEqual([50, 50]);
  });
  it('новый цвет ужимает остальные пропорционально, снятый отдаёт долю', () => {
    const L = DEFAULT_MOOD_LEGEND;
    const two = [{ itemId: 'a', pct: 80 }, { itemId: 'b', pct: 20 }];
    const three = toggleMoodItem(two, L[0]);
    expect(three.map((x) => x.pct)).toEqual([54, 13, 33]);
    expect(toggleMoodItem(three, L[0]).map((x) => x.pct)).toEqual([81, 19]); // ±1% от округления
  });
  it('граница двигает только соседние полосы и не даёт сжать до нуля', () => {
    const it3 = [{ itemId: 'a', pct: 40 }, { itemId: 'b', pct: 30 }, { itemId: 'c', pct: 30 }];
    expect(moveShareBoundary(it3, 1, 98).map((x) => x.pct)).toEqual([40, 60 - MIN_SHARE, MIN_SHARE]);
    expect(moveShareBoundary(it3, 0, 10).map((x) => x.pct)).toEqual([10, 60, 30]);
    expect(moveShareBoundary(it3, 0, -50).map((x) => x.pct)).toEqual([MIN_SHARE, 70 - MIN_SHARE, 30]);
    expect(moveShareBoundary(it3, 2, 50)).toBe(it3);
  });
  it('ячейка: полосы по долям, для двоих — лево и право', () => {
    expect(stripes(['#a'])).toBe('linear-gradient(#a, #a)');
    expect(stripes(['#a', '#b'])).toBe('linear-gradient(90deg, #a 0% 50%, #b 50% 100%)');
    expect(stripes([{ color: '#a', pct: 70 }, { color: '#b', pct: 30 }])).toBe('linear-gradient(90deg, #a 0% 70%, #b 70% 100%)');
    const a = resolveMood(multi, {});
    expect(moodCellStyle(a, null, 'me').background).toContain('90deg');
    expect(moodCellStyle(null, null, 'both')).toBeUndefined();
    const both = moodCellStyle(a, null, 'both');
    expect(both.backgroundPosition).toBe('left, right');
    expect(both.backgroundImage).toContain('transparent');
  });
  it('статистика месяца считает каждый цвет дня', () => {
    const c = monthCounts([legacy, multi, { ...multi, uid: 'b' }, { ...multi, day: '2026-12-01' }], 'a', 2026, 10);
    expect(c).toEqual({ good: 1, great: 1, sad: 1 });
  });
});

describe('напоминание', () => {
  it('только после ответа сервера, без отметки, раз в день', () => {
    const today = '2026-11-19';
    expect(shouldRemind({ loaded: false, marked: false, remindedDay: null, today })).toBe(false);
    expect(shouldRemind({ loaded: true, marked: true, remindedDay: null, today })).toBe(false);
    expect(shouldRemind({ loaded: true, marked: false, remindedDay: today, today })).toBe(false);
    expect(shouldRemind({ loaded: true, marked: false, remindedDay: '2026-11-18', today })).toBe(true);
  });
});
