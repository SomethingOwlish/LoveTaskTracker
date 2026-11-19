import { describe, it, expect } from 'vitest';
import { againDoc, murmurTitle, wantOrder } from '../src/lib/murmurUtil.js';

const ts = () => 'TS';
describe('Мурмур: повторить', () => {
  it('новая карточка «Заново» без оценок и отметок серий, старая не трогается', () => {
    const old = {
      id: 'x', kind: 'series', title: 'Тьма', poster: 'p.jpg', year: 2017, extId: 'tv:1', seasons: [{ n: 1, eps: 10 }],
      status: 'done', ratings: { a: 9 }, reviews: { a: 'огонь' }, watched: { s1: [1, 2] }, epAt: { 's1e1': 1 }, doneAt: 5, startedAt: 3,
    };
    const d = againDoc(old, 'b', { serverTimestamp: ts });
    expect(d).toMatchObject({ kind: 'series', title: 'Тьма', poster: 'p.jpg', seasons: [{ n: 1, eps: 10 }], again: true, againOf: 'x', status: 'want', ratings: {}, reviews: {}, wantedBy: ['b'], doneAt: null, createdAt: 'TS' });
    expect(d.watched).toBeUndefined();
    expect(d.epAt).toBeUndefined();
    expect(d.startedAt).toBeUndefined();
    expect(old.ratings).toEqual({ a: 9 });
    expect(murmurTitle(d)).toBe('Заново: Тьма');
    expect(murmurTitle(old)).toBe('Тьма');
  });
  it('в «Хотим» начатые игры — первыми', () => {
    const ms = (x) => x || 0;
    const list = [
      { id: 'new', createdAt: 3 }, { id: 'both', wantedBy: [1, 2], createdAt: 1 }, { id: 'started', startedAt: 2, createdAt: 0 },
    ];
    expect([...list].sort((a, b) => wantOrder(a, b, ms)).map((x) => x.id)).toEqual(['started', 'both', 'new']);
  });
});
