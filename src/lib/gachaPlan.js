// План развития и прикидка отрядов — всё вводится вручную (у HoYoLAB нет
// открытого API, у Endfield тоже). Чистая логика, тесты в test/gacha.test.js.
import { GAMES } from './gacha.js';

// Статы, которые чаще всего пишут в гайдах. pct — в процентах.
export const STATS = {
  genshin: [
    ['hp', 'HP'], ['atk', 'Сила атаки'], ['def', 'Защита'], ['em', 'Мастерство стихий'],
    ['er', 'Восст. энергии', 1], ['cr', 'Шанс крита', 1], ['cd', 'Крит. урон', 1], ['dmg', 'Бонус урона', 1],
  ],
  hsr: [
    ['hp', 'HP'], ['atk', 'Сила атаки'], ['def', 'Защита'], ['spd', 'Скорость'],
    ['cr', 'Шанс крита', 1], ['cd', 'Крит. урон', 1], ['be', 'Эффект пробития', 1],
    ['ehr', 'Шанс эффекта', 1], ['err', 'Восст. энергии', 1], ['res', 'Сопр. эффектам', 1],
  ],
  endfield: [
    ['hp', 'HP'], ['atk', 'Атака'], ['def', 'Защита'],
    ['str', 'Сила'], ['agi', 'Ловкость'], ['int', 'Интеллект'], ['will', 'Воля'],
    ['cr', 'Шанс крита', 1], ['cd', 'Крит. урон', 1],
  ],
};

export const GEAR_LEVELS = ['нет', 'слабые', 'норм', 'хорошие', 'топ'];

export function emptyChar(game, name) {
  const g = GAMES[game];
  return {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    name: name.trim(), level: 1, levelTarget: g.levelMax,
    talents: g.talents.map(() => 1), talentTargets: g.talents.map(() => Math.min(9, g.talentMax)),
    cons: 0, weapon: '', gear: 0, gearTarget: 3,
    stats: {}, targets: {}, mats: [], note: '',
  };
}

const num = (v) => (v === '' || v == null || Number.isNaN(Number(v)) ? null : Number(v));
const ratio = (cur, target) => (target > 0 ? Math.max(0, Math.min(1, (cur || 0) / target)) : null);

// Насколько персонаж дотянут до целей (0..1) и чего не хватает.
// gaps: [{ key, label, cur, target, short (0..1 — доля нехватки) }] — от самых больших.
export function charReadiness(game, c) {
  const parts = [];
  const gaps = [];
  const push = (key, label, cur, target, weight = 1) => {
    const r = ratio(cur, target);
    if (r == null) return;
    parts.push([r, weight]);
    if (r < 1) gaps.push({ key, label, cur: cur ?? 0, target, short: 1 - r });
  };
  push('level', 'Уровень', num(c.level), num(c.levelTarget));
  const names = GAMES[game].talents;
  (c.talentTargets || []).forEach((t, i) => push('talent' + i, names[i] || `Талант ${i + 1}`, num(c.talents?.[i]), num(t), 0.5));
  push('gear', GAMES[game].gear, num(c.gear), num(c.gearTarget));
  for (const [key, label, pct] of STATS[game]) {
    const target = num(c.targets?.[key]);
    if (target) push(key, label + (pct ? ', %' : ''), num(c.stats?.[key]), target, 1.5);
  }
  for (const m of c.mats || []) {
    if (num(m.need) > 0) push('mat:' + m.name, m.name, num(m.have), num(m.need), 0.3);
  }
  const w = parts.reduce((s, [, x]) => s + x, 0);
  const score = w ? parts.reduce((s, [r, x]) => s + r * x, 0) / w : 0;
  gaps.sort((a, b) => b.short - a.short);
  return { score, gaps };
}

// Материалы, которых ещё не хватает: [{ name, left }]
export function matsLeft(c) {
  return (c.mats || [])
    .map((m) => ({ name: m.name, left: Math.max(0, (num(m.need) || 0) - (num(m.have) || 0)) }))
    .filter((m) => m.left > 0);
}

// Отряд: общая готовность (среднее по участникам) и что улучшить в первую
// очередь — самые большие нехватки статов из гайда по всем участникам.
export function teamReport(game, team, roster) {
  const members = (team.members || []).map((id) => roster.find((c) => c.id === id)).filter(Boolean);
  const per = members.map((c) => ({ c, ...charReadiness(game, c) }));
  const score = per.length ? per.reduce((s, x) => s + x.score, 0) / per.length : 0;
  const todo = per
    .flatMap((x) => x.gaps.filter((g) => !g.key.startsWith('mat:')).map((g) => ({ ...g, who: x.c.name })))
    .sort((a, b) => b.short - a.short)
    .slice(0, 6);
  return { members: per, score, todo, size: members.length };
}

export function grade(score) {
  if (score >= 0.95) return ['Готов', 'good'];
  if (score >= 0.8) return ['Почти', 'good'];
  if (score >= 0.6) return ['Средне', 'ok'];
  return ['Слабо', 'bad'];
}
