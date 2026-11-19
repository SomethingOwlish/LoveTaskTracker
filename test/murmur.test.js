import { describe, it, expect } from 'vitest';
import { againDoc, murmurTitle, wantOrder, sameMurmur } from '../src/lib/murmurUtil.js';

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

describe('Мурмур: та же ли это запись', () => {
  const dune84 = { kind: 'movie', title: 'Дюна', year: 1984 };
  it('ремейк с тем же названием — другая запись', () => {
    expect(sameMurmur({ kind: 'movie', title: 'Дюна', year: 2021 }, dune84)).toBe(false);
  });
  it('название + год + тип совпали — та же (год строкой из поиска, регистр, ё)', () => {
    expect(sameMurmur({ kind: 'movie', title: 'дюна ', year: '1984' }, dune84)).toBe(true);
    expect(sameMurmur({ kind: 'movie', title: 'Ёлки', year: 2010 }, { kind: 'movie', title: 'Елки', year: 2010 })).toBe(true);
  });
  it('фильм и сериал с одним названием — разные', () => {
    expect(sameMurmur({ kind: 'series', title: 'Дюна', year: 1984 }, dune84)).toBe(false);
  });
  it('без года не считаем дублем', () => {
    expect(sameMurmur({ kind: 'movie', title: 'Дюна', year: null }, dune84)).toBe(false);
    expect(sameMurmur({ kind: 'movie', title: 'Дюна' }, { kind: 'movie', title: 'Дюна' })).toBe(false);
  });
  it('ID базы решает за всех', () => {
    expect(sameMurmur({ extId: 'tmdb:movie:1', kind: 'movie', title: 'А', year: 1 }, { extId: 'tmdb:movie:1', kind: 'movie', title: 'Б', year: 2 })).toBe(true);
    expect(sameMurmur({ extId: 'tmdb:movie:1', ...dune84 }, { extId: 'tmdb:movie:2', ...dune84 })).toBe(false);
  });
});
