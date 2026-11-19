import { describe, it, expect } from 'vitest';
import {
  SPECIES, BY_ID, GIANTS, RARITY, newRun, economy, rewardsFor, taskReward, ensureShop, buy, sell, move, mergeAll,
  simulateRaid, giantOf, levelOf, teamSize, tick, START_COINS, BENCH_SIZE, BACK_SIZE, MAX_TEAM, reroll, bonds,
  fightCost, makePack, repack, rollShop, statsOf, placeOf, fits, normalizeRun, sizeBonus, PACK_SIZE,
} from '../src/game/engine.js';

const NONE = { coins: 0 };
const common = SPECIES.find((s) => s.rar === 'common').id;
const unit = (s, st = 1, u = Math.random().toString(36)) => ({ s, st, u });

describe('награды за задачи', () => {
  it('задача — 2 монеты, с подзадачами — монета за каждую', () => {
    expect(taskReward({})).toBe(2);
    expect(taskReward({ checklist: [1] })).toBe(2);
    expect(taskReward({ checklist: [1, 2, 3, 4, 5] })).toBe(5);
    expect(taskReward({ priorityMatrix: { importance: 5, urgency: 2 }, checklist: [1, 2, 3, 4, 5] })).toBe(5 + 3 + 1);
  });
  it('считает только свои закрытые задачи этой недели', () => {
    const from = new Date(2026, 10, 16);
    const at = (d) => ({ toMillis: () => new Date(2026, 10, d).getTime() });
    const tasks = [
      { id: 'a', assigneeUid: 'me', status: 'done', completedAt: at(17) },
      { id: 'b', assigneeUid: 'me', status: 'approved', completedAt: at(18), priorityMatrix: { importance: 2 } },
      { id: 'c', assigneeUid: 'me', status: 'done', completedAt: at(10) },
      { id: 'd', assigneeUid: 'you', status: 'done', completedAt: at(17) },
      { id: 'e', assigneeUid: 'me', status: 'open' },
    ];
    const r = rewardsFor(tasks, 'me', from);
    expect(r.coins).toBe(5);
    expect(r.list.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('уровень и проценты', () => {
  it('команда растёт с уровнем до одиннадцати', () => {
    expect(teamSize(levelOf(0))).toBe(3);
    expect(teamSize(levelOf(1000))).toBe(MAX_TEAM);
    expect(MAX_TEAM).toBe(11);
  });
  it('новый день: проценты с накоплений и опыт за каждый прошедший день', () => {
    const run = newRun('2026-11-16', '2026-11-16');
    const rich = { coins: 40 };
    const next = tick(run, rich, '2026-11-18');
    expect(next.interest).toBe(4 + 5);
    expect(next.xpDaily).toBe(4);
    expect(tick(next, rich, '2026-11-18')).toBe(next);
  });
});

describe('набор недели и лавка', () => {
  it('набор: 30 видов, цвета 18/9/3, слабость гиганта есть', () => {
    const g = giantOf('2026-11-16');
    const p = makePack('x', g);
    expect(new Set(p).size).toBe(PACK_SIZE);
    const by = (rar) => p.filter((id) => BY_ID[id].rar === rar).length;
    expect([by('common'), by('rare'), by('very_rare')]).toEqual([18, 9, 3]);
    expect(p.filter((id) => BY_ID[id].el === g.weak).length).toBeGreaterThanOrEqual(3);
  });
  it('лавка берёт только из набора; на первом уровне только зелёные', () => {
    const pack = makePack('y', null);
    const offers = Array.from({ length: 40 }, (_, i) => rollShop('s' + i, 1, pack)).flat();
    expect(offers.every((o) => pack.includes(o.s) && o.st === 1)).toBe(true);
    expect(offers.every((o) => BY_ID[o.s].rar === 'common')).toBe(true);
  });
  it('в выходные лавка предлагает ★3 только тех, что уже есть на ★3', () => {
    const run = newRun('2026-11-16', '2026-11-21');
    run.front[0] = unit(common, 3);
    const sat = ensureShop(run, 'me', '2026-11-21', 5);
    const wed = ensureShop(run, 'me', '2026-11-18', 5);
    const all = (r) => [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => ensureShop({ ...r, rerolls: k, shop: null }, 'me', r === run ? '2026-11-21' : '2026-11-18', 5).shop.offers);
    expect(sat.shop.offers.length).toBe(5);
    expect(all(run).filter((o) => o.st === 3).every((o) => o.s === common)).toBe(true);
    expect(all(run).some((o) => o.st === 3)).toBe(true);
    expect(wed.shop.offers.every((o) => o.st === 1)).toBe(true);
  });
  it('набор можно перебросить только до первой покупки', () => {
    const run = newRun('2026-11-16', '2026-11-16', 'me');
    const r2 = repack(run, 'me').run;
    expect(r2.pack).not.toEqual(run.pack);
    expect(repack({ ...run, spent: 1 }, 'me').error).toBeTruthy();
  });
  it('лавка детерминирована по дню и меняется после переброса', () => {
    const r = newRun('w');
    const a = ensureShop(r, 'me', '2026-11-18', 1);
    expect(ensureShop(r, 'me', '2026-11-18', 1).shop).toEqual(a.shop);
    const rr = reroll(a, economy(a, NONE)).run;
    expect(ensureShop(rr, 'me', '2026-11-18', 1).shop.key).not.toBe(a.shop.key);
  });
});

describe('редкость и размещение', () => {
  it('синие и фиолетовые сильнее зелёных при тех же базовых статах', () => {
    const sp = SPECIES.find((s) => s.rar === 'very_rare');
    expect(statsOf(sp, 1)[0]).toBeGreaterThan(sp.s[0][0]);
    expect(RARITY.very_rare.mult).toBeGreaterThan(RARITY.rare.mult);
  });
  it('у каждого вида есть место; стражи — строй, проводники — тыл', () => {
    SPECIES.forEach((s) => expect(['front', 'back', 'both']).toContain(placeOf(s)));
    const guard = SPECIES.find((s) => s.cls === 'guard');
    expect(fits(guard, 'front')).toBe(true);
    expect(fits(guard, 'back')).toBe(false);
  });
  it('не на своём месте особь бьёт слабее', () => {
    const g = giantOf('2026-11-16');
    const hunter = SPECIES.find((s) => s.cls === 'hunter' && placeOf(s) === 'front');
    const filler = SPECIES.find((s) => s.cls === 'guard' && s.el !== g.weak);
    const avg = (team) => { let s = 0; for (let i = 0; i < 20; i++) s += simulateRaid(team, g, 0, 'p' + i).dmg; return s / 20; };
    const good = avg({ front: [unit(hunter.id, 2), unit(filler.id, 2)], back: [] });
    const bad = avg({ front: [unit(filler.id, 2)], back: [unit(hunter.id, 2)] });
    expect(good).toBeGreaterThan(bad);
  });
});

describe('слияние и расстановка', () => {
  it('три одинаковых сливаются, остаётся та, что в строю', () => {
    let run = newRun('2026-11-16');
    run.shop = { key: 'x', offers: Array(5).fill({ s: common, st: 1 }) };
    run.front[0] = unit(common, 1, 'f');
    run = buy(run, economy(run, NONE), 0).run;
    run = buy(run, economy(run, NONE), 1).run;
    expect(run.front[0]).toMatchObject({ u: 'f', st: 2 });
    expect(economy(run, NONE).coins).toBe(START_COINS - 2);
  });
  it('звёзды растут до ★6', () => {
    const run = newRun('w');
    run.front[0] = unit(common, 5); run.back[0] = unit(common, 5); run.bench[0] = unit(common, 5);
    expect(mergeAll(run).front[0].st).toBe(6);
    const six = newRun('w');
    six.front[0] = unit(common, 6); six.back[0] = unit(common, 6); six.bench[0] = unit(common, 6);
    expect(mergeAll(six).front[0].st).toBe(6);
    expect(mergeAll(six).back[0]).toBeTruthy();
  });
  it('скамейка на 10, тыл на 7; старый ран подтягивается', () => {
    const run = newRun('w');
    expect(run.bench).toHaveLength(BENCH_SIZE);
    expect(BENCH_SIZE).toBe(10);
    expect(run.back).toHaveLength(BACK_SIZE);
    const old = normalizeRun({ front: [null, null, null, null], back: Array(6).fill(null), bench: Array(8).fill(null) });
    expect(old.back).toHaveLength(7);
    expect(old.bench).toHaveLength(10);
  });
  it('в команду не больше мест, чем даёт уровень; продажа возвращает вложенное', () => {
    let run = newRun('w');
    SPECIES.slice(0, 4).forEach((s, i) => { run.bench[i] = unit(s.id); });
    const eco = economy(run, NONE);
    for (let i = 0; i < 3; i++) run = move(run, eco, { where: 'bench', i }, { where: i < 2 ? 'front' : 'back', i }).run;
    expect(move(run, eco, { where: 'bench', i: 3 }, { where: 'back', i: 3 }).error).toBeTruthy();
    expect(move(run, eco, { where: 'front', i: 0 }, { where: 'back', i: 2 }).error).toBeUndefined();
    const before = economy(run, NONE).coins;
    run = sell(run, 'front', 0).run;
    expect(economy(run, NONE).coins).toBe(before + RARITY[BY_ID[SPECIES[0].id].rar].cost);
  });
  it('лишние вылазки дорожают', () => {
    expect([0, 1, 2].map(fightCost)).toEqual([0, 3, 6]);
  });
});

describe('связи', () => {
  it('четыре вида связей и ступени', () => {
    const fire = SPECIES.filter((s) => s.el === 'fire').slice(0, 6).map((s) => unit(s.id));
    const b = bonds(fire);
    expect(b.find((x) => x.kind === 'el' && x.key === 'fire').tier).toBe(3);
    expect(new Set(b.map((x) => x.kind))).toEqual(new Set(['el', 'cl', 'fam', 'reg']));
  });
  it('бонус размера команды с семи', () => {
    expect(sizeBonus(6)).toBeNull();
    expect(sizeBonus(7).name).toBe('Отряд');
    expect(sizeBonus(11).name).toBe('Великая стая');
  });
});

describe('вылазка на гиганта', () => {
  const team = (n, st = 1) => {
    const u = SPECIES.slice(30, 30 + n).map((s, i) => unit(s.id, st, 'u' + i));
    return { front: u.slice(0, 4), back: u.slice(4) };
  };
  it('все десять гигантов выходят по кругу', () => {
    const ids = new Set();
    let d = new Date(2026, 0, 5);
    for (let i = 0; i < 10; i++) { ids.add(giantOf(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).id); d = new Date(d.getTime() + 7 * 864e5); }
    expect(ids.size).toBe(GIANTS.length);
  });
  it('детерминирована по seed, урон положительный, раундов не больше 12', () => {
    const g = giantOf('2026-11-16');
    const a = simulateRaid(team(6), g, 2, 's');
    expect(simulateRaid(team(6), g, 2, 's')).toEqual(a);
    expect(a.dmg).toBeGreaterThan(0);
    expect(a.rounds).toBeLessThanOrEqual(12);
    expect(a.frames.at(-1).kind).toBe('end');
    expect(a.frames.some((f) => f.kind === 'skill')).toBe(true);
  });
  it('звёзды и размер команды заметно поднимают урон', () => {
    const g = giantOf('2026-11-16');
    const avg = (t) => { let s = 0; for (let i = 0; i < 20; i++) s += simulateRaid(t, g, 3, 'x' + i).dmg; return s / 20; };
    expect(avg(team(9, 2))).toBeGreaterThan(avg(team(3, 1)) * 2);
  });
  it('пустой строй — вылазки нет', () => {
    expect(simulateRaid({ front: [], back: team(2).front }, giantOf('2026-11-16'), 0, 's').dmg).toBe(0);
  });
  it('гигант не бьёт своих детей', () => {
    const g = giantOf('2026-11-16');
    const kids = g.kids.slice(0, 4).map((id, i) => unit(id, 1, 'k' + i));
    const res = simulateRaid({ front: kids, back: [] }, g, 0, 's');
    expect(res.frames.some((f) => f.kind === 'hurt')).toBe(false);
  });
});
