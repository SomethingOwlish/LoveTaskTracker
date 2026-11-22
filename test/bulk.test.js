import { describe, it, expect } from 'vitest';
import { spreadDates, bulkPatches, fromDateInput } from '../src/lib/bulk.js';

const ymd = (d) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
// пятница, 20 ноября 2026
const fri = new Date(2026, 10, 20, 10, 0);

describe('spreadDates', () => {
  it('по одной в день', () => {
    expect(spreadDates(3, { start: fri }).map(ymd)).toEqual(['2026-11-20', '2026-11-21', '2026-11-22']);
  });
  it('по две в день, через день, без выходных', () => {
    const r = spreadDates(5, { start: fri, perDay: 2, everyDays: 1, skipWeekends: true });
    expect(r.map(ymd)).toEqual(['2026-11-20', '2026-11-20', '2026-11-23', '2026-11-23', '2026-11-24']);
    expect(r[0].getHours()).toBe(23);
  });
  it('старт в выходной без выходных — с понедельника', () => {
    expect(spreadDates(1, { start: new Date(2026, 10, 21), skipWeekends: true }).map(ymd)).toEqual(['2026-11-23']);
  });
  it('через 3 дня', () => {
    expect(spreadDates(3, { start: fri, everyDays: 3 }).map(ymd)).toEqual(['2026-11-20', '2026-11-23', '2026-11-26']);
  });
});

describe('bulkPatches', () => {
  const tasks = [
    { id: 'a', projectTags: [], deadline: 'X', assigneeUid: 'me', priorityMatrix: { importance: 0, urgency: 3 } },
    { id: 'b', projectTags: ['Дом'], deadline: null, assigneeUid: 'gus', priorityMatrix: { importance: 3, urgency: 0 } },
  ];
  it('проект: добавить / заменить / убрать', () => {
    expect(bulkPatches(tasks, { type: 'project', value: 'DMC', mode: 'add' }).map((e) => e.patch.projectTags)).toEqual([['DMC'], ['Дом', 'DMC']]);
    expect(bulkPatches(tasks, { type: 'project', value: 'Дом', mode: 'add' }).map((e) => e.id)).toEqual(['a']);
    expect(bulkPatches(tasks, { type: 'project', value: '#DMC', mode: 'set' })[1].patch.projectTags).toEqual(['DMC']);
    const clear = bulkPatches(tasks, { type: 'project', mode: 'clear' });
    expect(clear.map((e) => [e.id, e.before.projectTags])).toEqual([['b', ['Дом']]]);
  });
  it('раскидать — по порядку, с прежним сроком для отмены', () => {
    const r = bulkPatches(tasks, { type: 'spread', start: fri });
    expect(r.map((e) => ymd(e.patch.deadline))).toEqual(['2026-11-20', '2026-11-21']);
    expect(r[0].before.deadline).toBe('X');
  });
  it('кому и важность — только где меняется; urgency сохраняется', () => {
    expect(bulkPatches(tasks, { type: 'assignee', uid: 'gus' }).map((e) => e.id)).toEqual(['a']);
    const imp = bulkPatches(tasks, { type: 'importance', value: 3 });
    expect(imp).toHaveLength(1);
    expect(imp[0].patch.priorityMatrix).toEqual({ importance: 3, urgency: 3 });
  });
  it('fromDateInput', () => {
    expect(ymd(fromDateInput('2026-12-01'))).toBe('2026-12-1');
    expect(fromDateInput('')).toBeNull();
  });
});
