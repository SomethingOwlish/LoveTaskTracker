import { describe, it, expect } from 'vitest';
import {
  SPECIES, BY_ID, newRun, economy, rewardsFor, taskReward, ensureShop, buy, sell, move, mergeAll,
  simulate, wildSquad, levelOf, squadSize, START_COINS, BENCH_SIZE, runScore, reroll,
} from '../src/game/engine.js';

const NO_REWARDS = { coins: 0, xp: 0 };
const common = SPECIES.find((s) => s.rar === 'common').id;

describe('награды за задачи', () => {
  it('обычная задача — две монеты, без опыта', () => {
    expect(taskReward({})).toEqual({ coins: 2, xp: 0 });
  });
  it('важная даёт опыт по важности, срочная и чеклист — монеты', () => {
    expect(taskReward({ priorityMatrix: { importance: 3, urgency: 2 }, checklist: [1, 2, 3, 4, 5] })).toEqual({ coins: 5, xp: 3 });
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
    expect(r.coins).toBe(4);
    expect(r.xp).toBe(2);
    expect(r.list.map((x) => x.id)).toEqual(['b', 'a']);
  });
});

describe('уровни', () => {
  it('отряд растёт с уровнем до четырёх', () => {
    expect(levelOf(0)).toBe(1);
    expect(levelOf(4)).toBe(2);
    expect(squadSize(1)).toBe(2);
    expect(squadSize(levelOf(100))).toBe(4);
  });
});

describe('лавка и слияние', () => {
  const run0 = () => {
    const run = newRun('2026-11-16');
    run.shop = { key: 'x', ids: [common, common, common, common, common] };
    return run;
  };
  it('лавка детерминирована по дню и меняется после переброса', () => {
    const r = newRun('w');
    const a = ensureShop(r, 'me', '2026-11-18', 1);
    expect(ensureShop(r, 'me', '2026-11-18', 1).shop).toEqual(a.shop);
    const rr = reroll(a, economy(a, NO_REWARDS)).run;
    expect(ensureShop(rr, 'me', '2026-11-18', 1).shop.key).not.toBe(a.shop.key);
  });
  it('покупка тратит монеты, три одинаковых сливаются в ★★', () => {
    let run = run0();
    run.bonus = 100;
    for (let i = 0; i < 3; i++) run = buy(run, economy(run, NO_REWARDS), i).run;
    const units = run.bench.filter(Boolean);
    expect(units).toHaveLength(1);
    expect(units[0].st).toBe(2);
    expect(economy(run, NO_REWARDS).coins).toBe(START_COINS + 100 - 9);
  });
  it('в отряде улучшенная особь остаётся в отряде', () => {
    const run = newRun('w');
    run.squad[0] = { s: common, st: 1, u: 'a' };
    run.bench[0] = { s: common, st: 1, u: 'b' };
    run.bench[1] = { s: common, st: 1, u: 'c' };
    const m = mergeAll(run);
    expect(m.squad[0].st).toBe(2);
    expect(m.bench.filter(Boolean)).toHaveLength(0);
  });
  it('нельзя купить без денег и при полной скамейке', () => {
    const run = run0();
    expect(buy({ ...run, spent: START_COINS }, economy({ ...run, spent: START_COINS }, NO_REWARDS), 0).error).toBeTruthy();
    const other = SPECIES.filter((s) => s.id !== common).slice(0, BENCH_SIZE);
    const full = { ...run, bonus: 100, bench: other.map((s, i) => ({ s: s.id, st: 1, u: 'x' + i })) };
    expect(buy(full, economy(full, NO_REWARDS), 0).error).toBeTruthy();
  });
  it('продажа возвращает вложенное, отряд закрыт выше уровня', () => {
    let run = run0();
    run = buy(run, economy(run, NO_REWARDS), 0).run;
    const eco = economy(run, NO_REWARDS);
    expect(move(run, eco, { where: 'bench', i: 0 }, { where: 'squad', i: 3 }).error).toBeTruthy();
    run = move(run, eco, { where: 'bench', i: 0 }, { where: 'squad', i: 0 }).run;
    expect(run.squad[0].s).toBe(common);
    run = sell(run, 'squad', 0).run;
    expect(economy(run, NO_REWARDS).coins).toBe(START_COINS);
  });
});

describe('бой', () => {
  const sq = (ids, st = 1) => ids.map((s, i) => ({ s, st, u: 'u' + i }));
  it('детерминирован по seed и заканчивается', () => {
    const a = sq(SPECIES.slice(0, 4).map((s) => s.id));
    const b = sq(SPECIES.slice(10, 14).map((s) => s.id));
    const x = simulate(a, b, 'seed');
    const y = simulate(a, b, 'seed');
    expect(x).toEqual(y);
    expect([0, 1, -1]).toContain(x.winner);
    expect(x.frames.at(-1).kind).toBe('end');
  });
  it('★★★ почти всегда бьёт тех же ★', () => {
    const ids = SPECIES.slice(20, 24).map((s) => s.id);
    let wins = 0;
    for (let i = 0; i < 30; i++) if (simulate(sq(ids, 3), sq(ids, 1), 's' + i).winner === 0) wins++;
    expect(wins).toBeGreaterThanOrEqual(28);
  });
  it('пустой отряд проигрывает без боя', () => {
    expect(simulate([], sq([common]), 's').winner).toBe(1);
  });
  it('дикая стая растёт к воскресенью', () => {
    expect(wildSquad('s', 0)).toHaveLength(2);
    expect(wildSquad('s', 6)).toHaveLength(4);
    expect(wildSquad('s', 6).every((u) => BY_ID[u.s] && u.st >= 2)).toBe(true);
  });
  it('финал стоит двух очков', () => {
    expect(runScore({ battles: { a: { result: 'win' }, b: { result: 'win', final: true }, c: { result: 'loss' } } })).toEqual({ wins: 2, losses: 1, points: 3 });
  });
});
