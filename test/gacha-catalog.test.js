import { describe, it, expect } from 'vitest';
import { sessionRecords, sessionPreview, summarize, mergePulls } from '../src/lib/gacha.js';
import { applyDrops, mergeCatalog, filterCatalog } from '../src/lib/gachaCatalog.js';
import genshin from '../src/gacha/genshin.json';
import hsr from '../src/gacha/hsr.json';
import endfield from '../src/gacha/endfield.json';

describe('sessionRecords', () => {
  it('10 круток без редких — одна запись на 10', () => {
    const { records } = sessionRecords({ game: 'hsr', pool: 'char', count: 10, base: 1 });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ c: 10, r: 3, g: '11' });
  });
  it('топ-дроп без номера — в конце, pity считается верно', () => {
    const { records } = sessionRecords({ game: 'hsr', pool: 'char', count: 10, base: 1, drops: [{ n: 'Kafka', r: 5, k: 'c' }, { n: 'Конус', r: 4, k: 'w', at: 3 }] });
    expect(records.map((r) => r.c)).toEqual([2, 1, 6, 1]);
    expect(records[3].n).toBe('Kafka');
    expect(sessionPreview(records, 70, 5)).toEqual({ tops: [{ n: 'Kafka', p: 80 }], pityAfter: 0 });
    const sum = summarize('hsr', mergePulls([], records).pulls);
    expect(sum.char.tops[0].p).toBe(10);
  });
  it('id идут по порядку и не путаются при сортировке', () => {
    const { records } = sessionRecords({ game: 'genshin', pool: 'char', count: 12, base: 5, drops: Array.from({ length: 11 }, (_, i) => ({ n: 'x' + i, r: 4, at: i + 1 })) });
    expect(mergePulls([], records).pulls.map((r) => r.i)).toEqual(records.map((r) => r.i));
  });
  it('ошибки ввода', () => {
    expect(sessionRecords({ game: 'hsr', pool: 'char', count: 0 }).error).toBeTruthy();
    expect(sessionRecords({ game: 'hsr', pool: 'char', count: 1, drops: [{ n: 'a', r: 5 }, { n: 'b', r: 4 }] }).error).toBeTruthy();
    expect(sessionRecords({ game: 'hsr', pool: 'char', count: 5, drops: [{ n: 'a', r: 5, at: 9 }] }).error).toBeTruthy();
    expect(sessionRecords({ game: 'hsr', pool: 'char', count: 5, drops: [{ n: 'a', r: 5, at: 2 }, { n: 'b', r: 4, at: 2 }] }).error).toBeTruthy();
  });
});

describe('каталог', () => {
  it('у каждого персонажа есть id, имя и звёздность; id не повторяются', () => {
    for (const list of [genshin, hsr, endfield]) {
      const ids = new Set();
      for (const c of list) {
        expect(c.id && c.name && c.r).toBeTruthy();
        expect(ids.has(c.id)).toBe(false);
        ids.add(c.id);
      }
    }
  });
  it('выпавший персонаж: новый → есть, повтор → +1 эйдолон (не больше 6)', () => {
    const cat = mergeCatalog('hsr', hsr);
    const kafka = cat.find((c) => c.en === 'Kafka');
    let r = applyDrops('hsr', {}, cat, [{ n: 'кафка', r: 5, k: 'c' }, { n: 'Night on the Milky Way', r: 5, k: 'w' }]);
    expect(r.owned[kafka.id]).toEqual({ cons: 0 });
    expect(r.changed).toHaveLength(1);
    r = applyDrops('hsr', { [kafka.id]: { cons: 6, note: 'x' } }, cat, [{ n: 'Kafka', r: 5, k: 'c' }]);
    expect(r.owned[kafka.id]).toEqual({ cons: 6, note: 'x' });
  });
  it('свои персонажи и фильтры', () => {
    const cat = mergeCatalog('endfield', endfield, [{ id: 'u1', name: 'Новенькая', r: 6 }], { u1: { cons: 1 } });
    expect(cat.find((c) => c.id === 'u1')).toMatchObject({ custom: true, own: { cons: 1 } });
    expect(filterCatalog(cat, { show: 'own' }).map((c) => c.id)).toEqual(['u1']);
    expect(filterCatalog(cat, { q: 'perl' })).toHaveLength(1);
    expect(filterCatalog(cat, { rarity: 4 }).every((c) => c.r === 4)).toBe(true);
  });
  it('подсказки по отрядам находятся по английскому имени', () => {
    const cat = mergeCatalog('genshin', genshin);
    expect(cat.find((c) => c.en === 'Furina').guide.role).toMatch(/Саппорт/);
  });
});
