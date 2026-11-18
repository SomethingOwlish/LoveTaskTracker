import { describe, it, expect } from 'vitest';
import {
  SPECIES, BY_ID, GIANTS, newRun, economy, rewardsFor, taskReward, ensureShop, buy, sell, move, mergeAll,
  simulateRaid, giantOf, levelOf, teamSize, tick, START_COINS, BENCH_SIZE, reroll, bonds, fightCost, RARITY,
} from '../src/game/engine.js';

const NONE = { coins: 0 };
const common = SPECIES.find((s) => s.rar === 'common').id;
const unit = (s, st = 1, u = Math.random().toString(36)) => ({ s, st, u });

describe('награды за задачи', () => {
  it('задача даёт только монеты: важная, срочная и чеклист — больше', () => {
    expect(taskReward({})).toBe(2);
    expect(taskReward({ priorityMatrix: { importance: 5, urgency: 2 }, checklist: [1, 2, 3, 4, 5] })).toBe(2 + 3 + 1 + 2);
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
  it('команда растёт с уровнем до десяти', () => {
    expect(teamSize(levelOf(0))).toBe(3);
    expect(teamSize(levelOf(1000))).toBe(10);
  });
  it('новый день: проценты с накоплений и опыт за каждый прошедший день', () => {
    const run = newRun('2026-11-16', '2026-11-16');
    const rich = { coins: 40 }; // 8 + 40 = 48 → +4 в день
    const next = tick(run, rich, '2026-11-18');
    expect(next.interest).toBe(4 + 5); // во второй день уже 52 → +5
    expect(next.xpDaily).toBe(4);
    expect(tick(next, rich, '2026-11-18')).toBe(next);
  });
});

describe('лавка, слияние, расстановка', () => {
  const run0 = () => {
    const run = newRun('2026-11-16');
    run.shop = { key: 'x', ids: [common, common, common, common, common] };
    return run;
  };
  it('лавка детерминирована по дню и меняется после переброса', () => {
    const r = newRun('w');
    const a = ensureShop(r, 'me', '2026-11-18', 1);
    expect(ensureShop(r, 'me', '2026-11-18', 1).shop).toEqual(a.shop);
    const rr = reroll(a, economy(a, NONE)).run;
    expect(ensureShop(rr, 'me', '2026-11-18', 1).shop.key).not.toBe(a.shop.key);
  });
  it('три одинаковых сливаются в ★★, остаётся та, что в строю', () => {
    let run = run0();
    run.front[0] = unit(common, 1, 'f');
    run = buy(run, economy(run, NONE), 0).run;
    run = buy(run, economy(run, NONE), 1).run;
    expect(run.front[0]).toMatchObject({ u: 'f', st: 2 });
    expect(run.bench.filter(Boolean)).toHaveLength(0);
    expect(economy(run, NONE).coins).toBe(START_COINS - 2);
  });
  it('цепочка: три ★★ дают ★★★', () => {
    const run = newRun('w');
    run.front[0] = unit(common, 2); run.back[0] = unit(common, 2); run.bench[0] = unit(common, 1); run.bench[1] = unit(common, 1); run.bench[2] = unit(common, 1);
    const m = mergeAll(run);
    expect(m.front[0].st).toBe(3);
    expect([...m.back, ...m.bench].filter(Boolean)).toHaveLength(0);
  });
  it('нельзя купить без денег и при полной скамейке', () => {
    const run = run0();
    const broke = { ...run, spent: START_COINS };
    expect(buy(broke, economy(broke, NONE), 0).error).toBeTruthy();
    const other = SPECIES.filter((s) => s.id !== common).slice(0, BENCH_SIZE);
    const full = { ...run, bench: other.map((s) => unit(s.id)) };
    expect(buy(full, economy(full, NONE), 0).error).toBeTruthy();
  });
  it('в команду не больше мест, чем даёт уровень; продажа возвращает вложенное', () => {
    let run = newRun('w');
    SPECIES.slice(0, 4).forEach((s, i) => { run.bench[i] = unit(s.id); });
    const eco = economy(run, NONE); // уровень 1 → 3 места
    for (let i = 0; i < 3; i++) run = move(run, eco, { where: 'bench', i }, { where: i < 2 ? 'front' : 'back', i }).run;
    expect(move(run, eco, { where: 'bench', i: 3 }, { where: 'back', i: 3 }).error).toBeTruthy();
    // обмен местами внутри команды можно
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
  it('ступени стихий 2/4/6 и классов 2/4', () => {
    const fire = SPECIES.filter((s) => s.el === 'fire').slice(0, 6).map((s) => unit(s.id));
    expect(bonds(fire).elTier.fire).toBe(3);
    expect(bonds(fire.slice(0, 3)).elTier.fire).toBe(1);
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
  it('детерминирована по seed, урон положительный, не больше 10 раундов', () => {
    const g = giantOf('2026-11-16');
    const a = simulateRaid(team(6), g, 2, 's');
    expect(simulateRaid(team(6), g, 2, 's')).toEqual(a);
    expect(a.dmg).toBeGreaterThan(0);
    expect(a.rounds).toBeLessThanOrEqual(10);
    expect(a.frames.at(-1).kind).toBe('end');
  });
  it('звёзды и размер команды заметно поднимают урон', () => {
    const g = giantOf('2026-11-16');
    const avg = (t) => { let s = 0; for (let i = 0; i < 20; i++) s += simulateRaid(t, g, 3, 'x' + i).dmg; return s / 20; };
    expect(avg(team(8, 2))).toBeGreaterThan(avg(team(3, 1)) * 2);
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
