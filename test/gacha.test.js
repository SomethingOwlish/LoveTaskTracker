import { describe, it, expect } from 'vitest';
import {
  GAMES, poolOf, parseImportLink, fromHoyo, fromEndfield, cmpId, mergePulls, poolSummary, summarize,
  classifyTops, avgPity, manualTop, manualFiller, chunkPulls,
} from '../src/lib/gacha.js';
import { emptyChar, charReadiness, teamReport, matsLeft } from '../src/lib/gachaPlan.js';

// n пустых 3★, затем дроп редкости r
let seq = 1000;
const filler = (n, g = '301') => Array.from({ length: n }, () => ({ i: String(seq += 1), t: '2026-01-01 10:00:00', n: 'Sword', r: 3, k: 'w', g }));
const drop = (name, r = 5, g = '301') => ({ i: String(seq += 1), t: '2026-01-01 10:00:00', n: name, r, k: 'c', g });

describe('разбор ссылки', () => {
  it('Genshin: authkey с «+» и «/» не портится, лишнее не тащим', () => {
    const url = 'https://gs.hoyoverse.com/genshin/event/e20190909gacha-v3/index.html?win_mode=fullscreen&authkey_ver=1&sign_type=2&auth_appid=webview_gacha&init_type=301&lang=ru&game_biz=hk4e_global&authkey=ab%2Bcd%2Fef%3D%3D&region=os_euro#/log';
    const r = parseImportLink(url);
    expect(r.game).toBe('genshin');
    expect(r.params.authkey).toBe('ab+cd/ef==');
    expect(r.params.region).toBe('os_euro');
    expect(r.params.lang).toBeUndefined();
    expect(r.params.win_mode).toBeUndefined();
  });
  it('Genshin: недокодированный «+» остаётся плюсом', () => {
    const r = parseImportLink('https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog?authkey=a+b/c&game_biz=hk4e_global');
    expect(r.params.authkey).toBe('a+b/c');
  });
  it('HSR по game_biz', () => {
    const r = parseImportLink('https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog?authkey_ver=1&authkey=xyz&game_biz=hkrpg_global');
    expect(r.game).toBe('hsr');
  });
  it('ссылка не от той игры — понятная ошибка', () => {
    const r = parseImportLink('https://x/?authkey=1&game_biz=hkrpg_global', 'genshin');
    expect(r.error).toMatch(/HSR/);
  });
  it('без authkey — ошибка', () => {
    expect(parseImportLink('https://gs.hoyoverse.com/genshin/?lang=ru').error).toBeTruthy();
    expect(parseImportLink('').error).toBeTruthy();
  });
  it('Endfield: ссылка с u8_token, голый токен и «токен:хвост»', () => {
    const a = parseImportLink('https://ef-webview.gryphline.com/page/gacha?u8_token=AbCdEf1234567890xyz&server=3');
    expect(a).toEqual({ game: 'endfield', params: { token: 'AbCdEf1234567890xyz', server_id: '3' } });
    expect(parseImportLink('AbCdEf1234567890xyzQ', 'endfield').params.token).toBe('AbCdEf1234567890xyzQ');
    expect(parseImportLink('"AbCdEf1234567890xyzQ:12345"', 'endfield').params.token).toBe('AbCdEf1234567890xyzQ');
    expect(parseImportLink('коротко', 'endfield').error).toBeTruthy();
  });
});

describe('записи и слияние', () => {
  it('из ответа HoYo', () => {
    const p = fromHoyo({ id: '1700000000000000001', time: '2026-01-02 03:04:05', name: 'Skyward Harp', rank_type: '5', item_type: 'Weapon', gacha_type: '400' });
    expect(p).toEqual({ i: '1700000000000000001', t: '2026-01-02 03:04:05', n: 'Skyward Harp', r: 5, k: 'w', g: '400' });
    expect(poolOf('genshin', p.g)).toBe('char');
    expect(poolOf('hsr', '12')).toBe('weapon');
  });
  it('из ответа Endfield', () => {
    const p = fromEndfield({ seqId: 42, charName: 'Laevatain', rarity: 6, poolName: 'Scorching', isFree: true, gachaTs: '1768000000000' }, 'E_CharacterGachaPoolType_Special');
    expect(p.i).toBe('42');
    expect(p.r).toBe(6);
    expect(p.b).toBe('Scorching');
    expect(p.f).toBe(true);
    expect(p.t).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
  });
  it('большие id сравниваются как числа', () => {
    expect(cmpId('99', '100')).toBeLessThan(0);
    expect(cmpId('1700000000000000002', '1700000000000000001')).toBeGreaterThan(0);
    expect(cmpId('m1', '9999999999999999999')).toBeGreaterThan(0);
  });
  it('повторный импорт не дублирует, порядок по времени и id', () => {
    const a = { i: '10', t: '2026-01-01 10:00:00', n: 'A', r: 3, g: '301' };
    const b = { i: '11', t: '2026-01-01 10:00:00', n: 'B', r: 4, g: '301' };
    const c = { i: '9', t: '2026-01-02 10:00:00', n: 'C', r: 5, g: '301' };
    const first = mergePulls([], [b, a]);
    expect(first.added).toBe(2);
    const again = mergePulls(first.pulls, [a, b, c]);
    expect(again.added).toBe(1);
    expect(again.pulls.map((p) => p.n)).toEqual(['A', 'B', 'C']);
  });
});

describe('pity', () => {
  it('крутка, на которой выпал 5★, и текущий счётчик', () => {
    const pulls = [...filler(75), drop('Furina'), ...filler(9), drop('Bennett', 4), ...filler(3)];
    const s = poolSummary(pulls, 5);
    expect(s.tops).toHaveLength(1);
    expect(s.tops[0].p).toBe(76);
    expect(s.pity).toBe(13);
    expect(s.pity4).toBe(3);
    expect(s.total).toBe(89);
  });
  it('два 5★ подряд в одной десятке — второй на 1-й крутке', () => {
    const s = poolSummary([...filler(9), drop('A'), drop('B')], 5);
    expect(s.tops.map((t) => t.p)).toEqual([10, 1]);
  });
  it('301 и 400 делят счётчик Genshin, оружие — отдельно', () => {
    const pulls = [...filler(30, '301'), ...filler(30, '400'), drop('Neuvillette', 5, '400'), ...filler(10, '302')];
    const sum = summarize('genshin', pulls);
    expect(sum.char.tops[0].p).toBe(61);
    expect(sum.weapon.pity).toBe(10);
  });
  it('ручные записи учитываются как несколько круток', () => {
    const top = manualTop({ game: 'genshin', pool: 'char', name: 'Mavuika', at: 77, currentPity: 10 });
    expect(top.c).toBe(67);
    const s = poolSummary([...filler(10), top], 5);
    expect(s.tops[0].p).toBe(77);
    expect(manualTop({ game: 'genshin', pool: 'char', at: 5, currentPity: 10 }).error).toBeTruthy();
    expect(manualTop({ game: 'genshin', pool: 'char', at: 95, currentPity: 0 }).error).toBeTruthy();
    const f = manualFiller({ game: 'hsr', pool: 'char', count: 20 });
    expect(f).toMatchObject({ c: 20, g: '11', r: 3 });
    expect(manualFiller({ game: 'hsr', pool: 'char', count: 0 }).error).toBeTruthy();
  });
  it('Endfield: 6★ — топ, 5★ сбрасывает «малый» счётчик; круток на текущем баннере', () => {
    const T = 'E_CharacterGachaPoolType_Special';
    const mk = (n, r, b) => ({ i: String(seq += 1), t: '2026-02-01 10:00:00', n, r, k: 'c', g: T, b });
    const pulls = [mk('x', 4, 'A'), mk('Ember', 6, 'A'), mk('y', 5, 'B'), mk('z', 4, 'B'), mk('z', 4, 'B')];
    const s = summarize('endfield', pulls).char;
    expect(s.tops[0].p).toBe(2);
    expect(s.pity).toBe(3);
    expect(s.pity4).toBe(2);
    expect(s.banner).toEqual({ name: 'B', pulls: 3 });
    expect(avgPity(s.tops)).toBe(2);
  });
});

describe('50/50', () => {
  const std = GAMES.genshin.std.char;
  const tops = (names) => names.map((n, i) => ({ i: String(i), n, p: 70 }));

  it('стандартный — проигрыш, следующий — гарант', () => {
    const r = classifyTops(tops(['Furina', 'Diluc', 'Nahida', 'Raiden Shogun']), { stdNames: std });
    expect(r.list.map((x) => x.res)).toEqual(['won', 'lost', 'guar', 'won']);
    expect(r.won).toBe(2);
    expect(r.lost).toBe(1);
    expect(r.rate).toBeCloseTo(2 / 3);
    expect(r.guaranteed).toBe(false);
  });
  it('после проигрыша без новых дропов — гарант на следующий', () => {
    expect(classifyTops(tops(['Qiqi']), { stdNames: std }).guaranteed).toBe(true);
  });
  it('регистр и пробелы в имени не важны', () => {
    expect(classifyTops(tops([' qiqi ']), { stdNames: std }).list[0].res).toBe('lost');
  });
  it('Endfield: без гаранта после проигрыша — каждый раз монетка', () => {
    const r = classifyTops(tops(['Ember', 'Ember', 'Laevatain']), { stdNames: ['Ember'], guarantee: false });
    expect(r.list.map((x) => x.res)).toEqual(['lost', 'lost', 'won']);
    expect(r.guaranteed).toBe(false);
  });
  it('ручная поправка перекрывает список стандартных', () => {
    const r = classifyTops(tops(['Diluc', 'Furina']), { stdNames: std, overrides: { 0: 'won', 1: 'lost' } });
    expect(r.list.map((x) => x.res)).toEqual(['won', 'lost']);
    expect(r.guaranteed).toBe(true);
  });
  it('пустая история', () => {
    const r = classifyTops([], { stdNames: std });
    expect(r.rate).toBeNull();
    expect(avgPity([])).toBeNull();
  });
});

describe('хранение', () => {
  it('режем на куски', () => {
    expect(chunkPulls([])).toEqual([[]]);
    expect(chunkPulls([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('план и отряды', () => {
  it('готовность персонажа и главные нехватки', () => {
    const c = { ...emptyChar('genshin', 'Furina'), level: 90, talents: [9, 9, 9], gear: 3, stats: { cr: 50, cd: 200 }, targets: { cr: 70, cd: 140 } };
    const r = charReadiness('genshin', c);
    expect(r.gaps.map((g) => g.key)).toEqual(['cr']);
    expect(r.score).toBeGreaterThan(0.8);
    expect(r.score).toBeLessThan(1);
  });
  it('материалы: сколько осталось', () => {
    expect(matsLeft({ mats: [{ name: 'Книги', need: 9, have: 4 }, { name: 'Короны', need: 1, have: 1 }] })).toEqual([{ name: 'Книги', left: 5 }]);
  });
  it('отряд: среднее и список улучшений без материалов', () => {
    const a = { ...emptyChar('hsr', 'Acheron'), id: 'a', level: 80, talents: [6, 10, 10, 10], talentTargets: [6, 10, 10, 10], gear: 3, stats: { spd: 120 }, targets: { spd: 134 }, mats: [{ name: 'x', need: 5, have: 0 }] };
    const b = { ...emptyChar('hsr', 'Pela'), id: 'b', level: 80, talents: [6, 10, 10, 10], talentTargets: [6, 10, 10, 10], gear: 3 };
    const r = teamReport('hsr', { members: ['a', 'b', 'gone'] }, [a, b]);
    expect(r.size).toBe(2);
    expect(r.todo.map((t) => t.who)).toEqual(['Acheron']);
    expect(r.todo[0].key).toBe('spd');
    expect(r.members[1].score).toBe(1);
  });
});
