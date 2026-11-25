import { describe, it, expect } from 'vitest';
import { sessionRecords, sessionPreview, summarize, mergePulls, editTop, classifyTops } from '../src/lib/gacha.js';
import { applyDrops, mergeCatalog, filterCatalog, withUpcoming, nameHints } from '../src/lib/gachaCatalog.js';
import upcoming from '../src/gacha/upcoming.json';
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
    expect(sessionPreview(records, 70, 5)).toMatchObject({ tops: [{ n: 'Kafka', p: 80 }], pityAfter: 0 });
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

describe('порядок в сессии', () => {
  const names = (records) => records.filter((r) => r.n).map((r) => r.n);
  it('без номеров: список идёт по порядку выпадения', () => {
    const { records } = sessionRecords({ game: 'hsr', pool: 'char', count: 10, base: 1, drops: [{ n: 'Жемчуг', r: 5 }, { n: 'Аха', r: 5 }] });
    expect(names(records)).toEqual(['Жемчуг', 'Аха']);
  });
  it('«№1 — последняя»: номера и список считаются с конца', () => {
    const a = sessionRecords({ game: 'hsr', pool: 'char', count: 10, base: 1, order: 'last', drops: [{ n: 'Аха', r: 5 }, { n: 'Жемчуг', r: 5 }] });
    expect(names(a.records)).toEqual(['Жемчуг', 'Аха']);
    const b = sessionRecords({ game: 'hsr', pool: 'char', count: 10, base: 1, order: 'last', drops: [{ n: 'Аха', r: 5, at: 1 }, { n: 'Жемчуг', r: 5, at: 8 }] });
    const pv = sessionPreview(b.records, 0, 5);
    expect(pv.seq.map((d) => [d.n, d.at])).toEqual([['Жемчуг', 3], ['Аха', 10]]);
    expect(pv.tops).toEqual([{ n: 'Жемчуг', p: 3 }, { n: 'Аха', p: 7 }]);
  });
});

describe('правка топ-дропа', () => {
  const sess = () => [
    ...sessionRecords({ game: 'hsr', pool: 'char', count: 10, base: 1, drops: [{ n: 'Kafka', r: 5, at: 6 }, { n: 'Конус', r: 4, k: 'w', at: 3 }] }).records,
    ...sessionRecords({ game: 'hsr', pool: 'char', count: 20, base: 2, drops: [{ n: 'Аха', r: 5, at: 15 }] }).records,
  ];
  const tops = (pulls) => summarize('hsr', mergePulls([], pulls).pulls).char;
  it('позже: двигается только этот дроп', () => {
    const pulls = sess();
    const id = pulls.find((p) => p.n === 'Kafka').i;
    const r = editTop(pulls, 'hsr', id, { pity: 40 });
    const s = tops(r.pulls);
    expect(s.tops.map((t) => t.p)).toEqual([40, 19]);
    expect(s.pity).toBe(5);
  });
  it('раньше: урезаем пустые крутки перед ним, 4★ остаётся', () => {
    const pulls = sess();
    const id = pulls.find((p) => p.n === 'Kafka').i;
    const r = editTop(pulls, 'hsr', id, { pity: 4 });
    expect(tops(r.pulls).tops.map((t) => t.p)).toEqual([4, 19]);
    expect(r.pulls.some((p) => p.n === 'Конус')).toBe(true);
    expect(editTop(pulls, 'hsr', id, { pity: 1 }).error).toBeTruthy(); // перед ним 4★
  });
  it('имя и запрет для импорта', () => {
    const pulls = sess();
    const id = pulls.find((p) => p.n === 'Аха').i;
    expect(editTop(pulls, 'hsr', id, { n: ' Жемчуг ' }).pulls.find((p) => p.i === id).n).toBe('Жемчуг');
    const imported = [{ i: '100', t: '2026-01-01 10:00:00', n: 'Kafka', r: 5, k: 'c', g: '11' }];
    expect(editTop(imported, 'hsr', '100', { pity: 5 }).error).toBeTruthy();
  });
  it('поправки «выиграла 50/50» и «гарант»', () => {
    const t = [{ i: 'a', n: 'Himeko' }, { i: 'b', n: 'Kafka' }, { i: 'c', n: 'Аха' }];
    const r = classifyTops(t, { stdNames: ['Himeko'], overrides: { b: 'fifty', c: 'guar' } });
    expect(r.list.map((x) => x.res)).toEqual(['lost', 'won', 'guar']);
  });
});

describe('анонсы и подсказки имён', () => {
  it('анонс показывается, пока персонажа нет в базе', () => {
    const list = withUpcoming(genshin, upcoming.genshin);
    expect(list.slice(0, 2).map((c) => c.en)).toEqual(['Danica', 'Tsaritsa']);
    expect(withUpcoming([...genshin, { id: 'x', name: 'Даника', en: 'Danica', r: 5 }], upcoming.genshin).filter((c) => c.en === 'Danica')).toHaveLength(1);
  });
  it('у анонсов и Endfield не повторяются id', () => {
    for (const [base, soon] of [[genshin, upcoming.genshin], [hsr, upcoming.hsr], [endfield, upcoming.endfield]]) {
      const ids = withUpcoming(base, soon).map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(endfield.some((c) => c.en === 'Kay') && endfield.some((c) => c.en === 'Mimino')).toBe(true);
  });
  it('подсказки: по началу слова, рус. и англ., нужная редкость выше', () => {
    expect(nameHints(endfield, 'кэ', { top: 6 }).map((c) => c.en)).toContain('Kay');
    expect(nameHints(endfield, 'flow', { top: 6 })[0].en).toBe('Argent Flow');
    const fu = nameHints(genshin, 'ф', { r: 4, top: 5 });
    expect(fu.length).toBeGreaterThan(0);
    expect(fu[0].r).toBe(4);
    expect(nameHints(genshin, 'Фурина', { top: 5 })).toEqual([]); // уже вписано полностью
    expect(nameHints(withUpcoming(genshin, upcoming.genshin), '', { top: 5 }).slice(0, 2).every((c) => c.soon)).toBe(true);
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
