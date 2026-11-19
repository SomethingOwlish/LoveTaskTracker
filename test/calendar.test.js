import { describe, it, expect } from 'vitest';
import { monthGrid, layoutWeek, eventOnDay, eventDays, calendarTasks, fmtRange, cleanEventData, normalizeLegacyEvent } from '../src/lib/calendar';
import { buildTaskDoc, defaultDeadline } from '../src/lib/taskDoc';

const week = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22'];

describe('monthGrid', () => {
  it('6 недель с понедельника; ноябрь 2026 начинается с 26 октября', () => {
    const g = monthGrid(new Date(2026, 10, 19));
    expect(g).toHaveLength(6);
    expect(g[0][0]).toBe('2026-10-26');
    expect(g[0][6]).toBe('2026-11-01');
    expect(g[5][6]).toBe('2026-12-06');
  });
});

describe('события', () => {
  it('многодневное событие попадает во все свои дни', () => {
    const e = { start: '2026-11-18', end: '2026-11-20' };
    expect(eventOnDay(e, '2026-11-17')).toBe(false);
    expect(eventOnDay(e, '2026-11-18')).toBe(true);
    expect(eventOnDay(e, '2026-11-20')).toBe(true);
    expect(eventOnDay(e, '2026-11-21')).toBe(false);
    expect(eventDays(e)).toBe(3);
  });
  it('конец раньше начала считается однодневным', () => {
    expect(eventDays({ start: '2026-11-18', end: '2026-11-10' })).toBe(1);
    expect(cleanEventData({ title: ' x ', start: '2026-11-18', end: '2026-11-10' })).toMatchObject({ title: 'x', end: '2026-11-18' });
  });
  it('старое событие с date становится однодневным', () => {
    const e = normalizeLegacyEvent({ id: 'a', title: 'Старое', date: new Date(2026, 10, 5, 12) });
    expect(e).toMatchObject({ start: '2026-11-05', end: '2026-11-05', legacy: true });
  });
  it('fmtRange', () => {
    expect(fmtRange('2026-11-18')).toBe('18 ноября');
    expect(fmtRange('2026-11-18', '2026-11-20')).toBe('18 – 20 ноября');
    expect(fmtRange('2026-11-30', '2026-12-02')).toBe('30 ноября – 2 декабря');
  });
});

describe('layoutWeek', () => {
  it('режет событие по границам недели и раскладывает по дорожкам', () => {
    const evs = [
      { id: 'long', title: 'Отпуск', start: '2026-11-10', end: '2026-11-18' },
      { id: 'a', title: 'А', start: '2026-11-18', end: '2026-11-19' },
      { id: 'b', title: 'Б', start: '2026-11-20', end: '2026-11-25' },
    ];
    const { bars } = layoutWeek(evs, week);
    const by = Object.fromEntries(bars.map((b) => [b.ev.id, b]));
    expect(by.long).toMatchObject({ col: 1, span: 3, cont: true, more: false, lane: 0 });
    expect(by.a).toMatchObject({ col: 3, span: 2, lane: 1 }); // 18-е занято отпуском
    expect(by.b).toMatchObject({ col: 5, span: 3, more: true, lane: 0 });
  });
  it('лишнее сверх дорожек считается по дням', () => {
    const evs = [1, 2, 3, 4].map((i) => ({ id: 'e' + i, title: 'E' + i, start: '2026-11-17', end: '2026-11-17' }));
    const { bars, hidden } = layoutWeek(evs, week, 3);
    expect(bars).toHaveLength(3);
    expect(hidden).toEqual({ '2026-11-17': 1 });
  });
});

describe('calendarTasks', () => {
  const tasks = [
    { id: 1, deadline: new Date(), projectTags: ['Дом'] },
    { id: 2, deadline: new Date(), projectTags: ['Работа'] },
    { id: 3, deadline: null, projectTags: ['Дом'] },
  ];
  it('без выбранных проектов задач в календаре нет', () => {
    expect(calendarTasks(tasks, [])).toEqual([]);
  });
  it('только выбранные проекты и только со сроком', () => {
    expect(calendarTasks(tasks, ['Дом']).map((t) => t.id)).toEqual([1]);
  });
});

describe('срок новой задачи', () => {
  const deps = { serverTimestamp: () => 'ts', Timestamp: { fromDate: (d) => d } };
  it('без срока — сегодня до 23:59', () => {
    const t = buildTaskDoc({ title: 'x', authorUid: 'a' }, deps);
    const want = defaultDeadline();
    expect(t.deadline.getTime()).toBe(want.getTime());
    expect(want.getHours()).toBe(23);
  });
  it('заданный срок не трогаем', () => {
    const d = new Date(2026, 11, 1, 18);
    expect(buildTaskDoc({ title: 'x', authorUid: 'a', deadline: d }, deps).deadline.getTime()).toBe(d.getTime());
  });
});
