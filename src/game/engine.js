/* ============================================================
   ПОСЛЕМИРЬЕ — недельный автобаттлер поверх задач.

   Основа — система «Послемирья»: 124 вида, восемь стихий, четыре класса,
   три одинаковых одной звезды сливаются в одно на звезду выше, отряд из
   четырёх, бонус стихии на ступенях 2 и 4.

   Здесь только чистые функции (без Firestore и React) — их гоняют тесты.
   Состояние рана лежит в userState/{email}.game, награды за задачи
   не хранятся, а пересчитываются из закрытых за неделю задач: отменил
   выполнение — монеты ушли сами.
   ============================================================ */
import SPECIES from './species.json';

export { SPECIES };
export const BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/* ---------------- Справочники ---------------- */

export const ELEMENTS = {
  fire: { name: 'Огонь', icon: 'fa-fire', color: '#e0643a', b2: 'Приёмы огня сильнее ×1,2', b4: 'Попадание огнём поджигает: урон каждый раунд' },
  water: { name: 'Вода', icon: 'fa-droplet', color: '#4f9be0', b2: 'Отряд лечится в конце раунда', b4: 'На третьем раунде смывает все статусы' },
  lightning: { name: 'Молния', icon: 'fa-bolt', color: '#e6c84a', b2: 'Урон перескакивает на соседа вполсилы', b4: 'Перескакивает на двоих' },
  ice: { name: 'Лёд', icon: 'fa-snowflake', color: '#8fd3e8', b2: 'Попадание льдом замедляет', b4: 'Может обездвижить на ход' },
  wind: { name: 'Ветер', icon: 'fa-wind', color: '#9fd6b0', b2: 'Отряд быстрее на 20%', b4: 'Вихрь: урон всем врагам каждый раунд' },
  earth: { name: 'Земля', icon: 'fa-mountain', color: '#b08a5a', b2: 'Щит в начале боя', b4: 'Толчок: урон всем врагам каждый раунд' },
  plants: { name: 'Растения', icon: 'fa-leaf', color: '#7cbf5a', b2: 'Лечение самого раненого в конце раунда', b4: 'Шипы: атакующий получает урон' },
  sound: { name: 'Звук', icon: 'fa-music', color: '#c58ae0', b2: 'Враги хуже попадают по отряду', b4: 'Волна: раз в два раунда оглушает врага' },
};

export const CLASSES = {
  guard: { name: 'Страж', icon: 'fa-shield-halved', role: 'Прикрывает самого раненого', syn: '2+: прикрытие чаще' },
  hunter: { name: 'Охотник', icon: 'fa-crosshairs', role: 'Бьёт слабейшего', syn: '2+: точнее на 1' },
  guide: { name: 'Проводник', icon: 'fa-hand-sparkles', role: 'В первый ход +25% атаки отряду, дальше лечит', syn: '2+: лечит двоих' },
  catcher: { name: 'Ловчий', icon: 'fa-link', role: 'Сковывает самого опасного', syn: '2+: сковывание дольше' },
};

export const RARITY = {
  common: { name: 'обычное', cost: 3 },
  rare: { name: 'редкое', cost: 4 },
  very_rare: { name: 'очень редкое', cost: 5 },
};

export const START_COINS = 6;
export const SHOP_SIZE = 5;
export const BENCH_SIZE = 6;
export const MAX_SQUAD = 4;
export const REROLL_COST = 1;
export const XP_BUY = { cost: 4, xp: 3 };
export const WIN_COINS = 3;
export const LOSS_COINS = 1;

// Порог опыта для уровня: индекс = уровень - 1.
export const LEVEL_XP = [0, 4, 10, 18, 28, 40];
// Шансы редкостей в лавке по уровню: [обычное, редкое, очень редкое].
const ODDS = [
  [85, 15, 0],
  [72, 25, 3],
  [58, 34, 8],
  [45, 40, 15],
  [35, 40, 25],
  [25, 42, 33],
];

export function levelOf(xp) {
  let l = 1;
  LEVEL_XP.forEach((need, i) => { if (xp >= need) l = i + 1; });
  return l;
}
export function nextLevelXp(xp) {
  return LEVEL_XP.find((need) => need > xp) ?? null;
}
// Мест в отряде: 2 на первом уровне, 3 на втором, 4 с третьего.
export function squadSize(level) {
  return Math.min(MAX_SQUAD, level + 1);
}
export function oddsFor(level) {
  return ODDS[Math.min(level, ODDS.length) - 1];
}
export function unitCost(u) {
  // проданная особь возвращает всё, что в неё вложено
  return RARITY[BY_ID[u.s].rar].cost * 3 ** (u.st - 1);
}

/* ---------------- Случайность ---------------- */

export function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function rng(seed) {
  let a = typeof seed === 'string' ? hashStr(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/* ---------------- Даты ---------------- */

const pad = (n) => String(n).padStart(2, '0');
export const dayStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function weekStart(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
export const weekKey = (d = new Date()) => dayStr(weekStart(d));
// 0 = понедельник … 6 = воскресенье (финал)
export const dayIndex = (d = new Date()) => (d.getDay() + 6) % 7;

/* ---------------- Награды за задачи ----------------
   Каждая закрытая задача даёт монеты, важная — ещё и опыт:
   - 2 монеты за задачу, +1 если она была срочной, +1 за каждые 2 пункта
     чеклиста (не больше +3);
   - опыт = важность задачи (ползунок «важно», от +1 до +5).
   Считаются задачи, где ты исполнитель, закрытые с начала недели. */

function msOf(ts) {
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  if (ts.seconds != null) return ts.seconds * 1000;
  return new Date(ts).getTime();
}

export function taskReward(t) {
  const imp = t.priorityMatrix?.importance ?? 0;
  const urg = t.priorityMatrix?.urgency ?? 0;
  const items = (t.checklist || []).length;
  const coins = 2 + (urg > 0 ? 1 : 0) + Math.min(3, Math.floor(items / 2));
  const xp = imp > 0 ? imp : 0;
  return { coins, xp };
}

export function rewardsFor(tasks, uid, from) {
  const since = from.getTime();
  let coins = 0, xp = 0;
  const list = [];
  tasks.forEach((t) => {
    if (t.assigneeUid !== uid) return;
    if (t.status !== 'done' && t.status !== 'approved') return;
    const at = msOf(t.completedAt);
    if (!at || at < since) return;
    const r = taskReward(t);
    coins += r.coins; xp += r.xp;
    list.push({ id: t.id, title: t.title, at, ...r });
  });
  list.sort((a, b) => b.at - a.at);
  return { coins, xp, list };
}

/* ---------------- Ран ---------------- */

let uidCounter = 0;
const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function newRun(week) {
  return {
    week,
    spent: 0,       // потрачено монет
    bonus: 0,       // монеты за бои
    xpBought: 0,    // опыт, купленный за монеты
    shop: null,     // { key, ids: [] }
    rerolls: 0,
    bench: Array(BENCH_SIZE).fill(null),
    squad: Array(MAX_SQUAD).fill(null),
    battles: {},    // { 'YYYY-MM-DD': запись боя }
  };
}

export function economy(run, rewards) {
  const xp = rewards.xp + (run.xpBought || 0);
  const level = levelOf(xp);
  return {
    coins: START_COINS + rewards.coins + (run.bonus || 0) - (run.spent || 0),
    xp, level, slots: squadSize(level), next: nextLevelXp(xp),
  };
}

export function rollShop(seed, level) {
  const r = rng(seed);
  const [c, rr] = oddsFor(level);
  const byRar = { common: [], rare: [], very_rare: [] };
  SPECIES.forEach((s) => byRar[s.rar].push(s.id));
  return Array.from({ length: SHOP_SIZE }, () => {
    const x = r() * 100;
    const rar = x < c ? 'common' : x < c + rr ? 'rare' : 'very_rare';
    return pick(r, byRar[rar]);
  });
}

// Лавка обновляется бесплатно раз в день; перебросы — за монету.
export function ensureShop(run, uid, today, level) {
  const key = `${today}#${run.rerolls || 0}`;
  if (run.shop?.key === key) return run; // за день лавка не меняется, даже если вырос уровень
  return { ...run, shop: { key, ids: rollShop(`${uid}|${key}`, level) } };
}

const clone = (run) => ({
  ...run,
  bench: [...run.bench],
  squad: [...run.squad],
  shop: run.shop ? { ...run.shop, ids: [...run.shop.ids] } : null,
  battles: { ...run.battles },
});

const fail = (msg) => ({ error: msg });

export function reroll(run, eco) {
  if (eco.coins < REROLL_COST) return fail('Не хватает монет');
  const next = clone(run);
  next.spent += REROLL_COST;
  next.rerolls = (run.rerolls || 0) + 1;
  next.shop = null; // пересоберёт ensureShop
  return { run: next };
}

export function buyXp(run, eco) {
  if (eco.coins < XP_BUY.cost) return fail('Не хватает монет');
  const next = clone(run);
  next.spent += XP_BUY.cost;
  next.xpBought = (run.xpBought || 0) + XP_BUY.xp;
  return { run: next };
}

// Покупка: особь идёт на скамейку. Если на скамейке нет места, но покупка
// сразу собирает тройку — всё равно можно (как в автошахматах).
export function buy(run, eco, slot) {
  const id = run.shop?.ids?.[slot];
  if (!id) return fail('Пусто');
  const cost = RARITY[BY_ID[id].rar].cost;
  if (eco.coins < cost) return fail('Не хватает монет');
  const next = clone(run);
  next.spent += cost;
  next.shop.ids[slot] = null;
  const unit = { s: id, st: 1, u: newUid() };
  const free = next.bench.indexOf(null);
  const same = [...next.bench, ...next.squad].filter((x) => x && x.s === id && x.st === 1).length;
  if (free === -1 && same < 2) return fail('Скамейка заполнена — продай кого-нибудь');
  if (free === -1) next.bench.push(unit); else next.bench[free] = unit;
  const merged = mergeAll(next);
  // седьмое место было временным: тройка его уже освободила
  merged.bench = merged.bench.slice(0, BENCH_SIZE);
  return { run: merged, got: unit };
}

// Три одинаковых одной звезды → одна на звезду выше. Цепочкой: три ★★ → ★★★.
export function mergeAll(run) {
  let changed = true;
  const next = { ...run, bench: [...run.bench], squad: [...run.squad] };
  while (changed) {
    changed = false;
    const all = [];
    next.squad.forEach((x, i) => x && all.push({ x, where: 'squad', i }));
    next.bench.forEach((x, i) => x && all.push({ x, where: 'bench', i }));
    const groups = {};
    all.forEach((e) => {
      if (e.x.st >= 3) return;
      const k = `${e.x.s}|${e.x.st}`;
      (groups[k] = groups[k] || []).push(e);
    });
    const trio = Object.values(groups).find((g) => g.length >= 3);
    if (trio) {
      const [keep, ...rest] = trio.slice(0, 3); // отряд идёт первым — улучшенная остаётся в бою
      next[keep.where][keep.i] = { ...keep.x, st: keep.x.st + 1 };
      rest.forEach((e) => { next[e.where][e.i] = null; });
      changed = true;
    }
  }
  return next;
}

export function sell(run, where, i) {
  const u = run[where][i];
  if (!u) return fail('Пусто');
  const next = clone(run);
  next[where][i] = null;
  next.spent -= unitCost(u);
  return { run: next, refund: unitCost(u) };
}

// Переставить особь: между скамейкой и отрядом или внутри них (обмен местами).
export function move(run, eco, from, to) {
  const next = clone(run);
  const a = next[from.where][from.i];
  const b = next[to.where][to.i];
  if (!a) return fail('Пусто');
  if (to.where === 'squad' && to.i >= eco.slots) return fail('Место откроется с уровнем');
  next[to.where][to.i] = a;
  next[from.where][from.i] = b;
  return { run: next };
}

// В отряде больше мест, чем позволяет уровень, быть не может — лишние уходят на скамейку.
export function squadOf(run, slots) {
  return run.squad.slice(0, slots).filter(Boolean);
}

/* ---------------- Отряд: синергии ---------------- */

export function synergies(units) {
  const el = {}, cl = {};
  units.forEach((u) => {
    const s = BY_ID[u.s];
    el[s.el] = (el[s.el] || 0) + 1;
    cl[s.cls] = (cl[s.cls] || 0) + 1;
  });
  const elTier = Object.fromEntries(Object.entries(el).map(([k, n]) => [k, n >= 4 ? 4 : n >= 2 ? 2 : 0]));
  return { el, cl, elTier };
}

/* ---------------- Дикие ---------------- */

// Если у партнёра пусто, бьёмся с дикой стаей: к концу недели она крупнее и злее.
export function wildSquad(seed, day) {
  const r = rng(seed);
  const n = Math.min(4, 2 + Math.floor(day / 2));
  const pool = SPECIES.filter((s) => (day < 3 ? s.rar === 'common' : s.rar !== 'very_rare' || day >= 5));
  return Array.from({ length: n }, (_, i) => {
    const st = day >= 6 ? (i < 2 ? 3 : 2) : day >= 4 ? (i === 0 ? 3 : 2) : day >= 2 ? (i === 0 ? 2 : 1) : 1;
    return { s: pick(r, pool).id, st, u: `w${i}` };
  });
}

/* ---------------- Бой ----------------
   Хиты в бою: 10 + хиты × 3 (у Стража ×1,4). Уклонение: защита / 5, не больше 6.
   Попадание: d20 + точность ≥ 10 + уклонение. Урон: атака × сила / 4 × разброс
   − защита / 4, не меньше 1. Слабость к стихии атакующего — ×1,5.
   Возвращает кадры для повтора и итог. Детерминирован по seed. */

const MAX_ROUNDS = 20;
// Меняется, когда меняются правила боя: старый повтор может разойтись с записанным итогом.
export const ENGINE_V = 1;

// Страж — танк отряда: хитов у него на 40% больше
export function battleHp(sp, st) {
  return Math.round((10 + sp.s[st - 1][2] * 3) * (sp.cls === 'guard' ? 1.4 : 1));
}

function fighter(u, side, i) {
  const sp = BY_ID[u.s];
  const [atk, def, hp, spd] = sp.s[u.st - 1];
  const max = battleHp(sp, u.st);
  return {
    side, i, id: u.s, st: u.st, name: sp.name, el: sp.el, cls: sp.cls, weak: sp.weak,
    atk, def, spd, pow: sp.pow, acc: sp.acc, hp: max, max,
    dodge: Math.min(6, Math.floor(def / 5)),
    shield: 0, stun: 0, burn: 0, slow: false, buffed: false,
  };
}

export function simulate(squadA, squadB, seed) {
  const r = rng(seed);
  const sides = [squadA.map((u, i) => fighter(u, 0, i)), squadB.map((u, i) => fighter(u, 1, i))];
  const syn = [synergies(squadA), synergies(squadB)];
  const tier = (side, el) => syn[side].elTier[el] || 0;
  const clsN = (side, c) => syn[side].cl[c] || 0;
  const frames = [];
  const snap = () => sides.map((s) => s.map((f) => [f.hp, f.shield, f.stun > 0 ? 1 : 0]));
  const log = (text, extra = {}) => frames.push({ text, hp: snap(), ...extra });
  const alive = (side) => sides[side].filter((f) => f.hp > 0);

  if (!squadA.length || !squadB.length) {
    return { winner: squadA.length ? 0 : squadB.length ? 1 : -1, frames: [{ text: 'Битвы не было: одному из отрядов некого выставить.', hp: snap() }], rounds: 0 };
  }

  // старт боя: щит земли, ветер ускоряет
  [0, 1].forEach((side) => {
    if (tier(side, 'earth')) sides[side].forEach((f) => { f.shield = 8; });
    if (tier(side, 'wind')) sides[side].forEach((f) => { f.spd *= 1.2; });
  });
  log('Отряды сходятся.');

  const damage = (_att, def, base) => {
    let dmg = base;
    if (def.shield > 0) {
      const ab = Math.min(def.shield, dmg);
      def.shield -= ab; dmg -= ab;
    }
    def.hp = Math.max(0, def.hp - dmg);
    return dmg;
  };

  const rallied = [false, false];
  let round = 0;
  while (round < MAX_ROUNDS && alive(0).length && alive(1).length) {
    round++;
    const order = [...alive(0), ...alive(1)]
      .map((f) => ({ f, k: (f.slow ? f.spd * 0.7 : f.spd) + r() }))
      .sort((a, b) => b.k - a.k)
      .map((x) => x.f);

    for (const f of order) {
      if (f.hp <= 0) continue;
      const foeSide = 1 - f.side;
      const foes = alive(foeSide);
      if (!foes.length) break;
      if (f.stun > 0) { f.stun--; log(`${f.name} скован и пропускает ход.`, { actor: [f.side, f.i] }); continue; }

      // Проводник: первый ход — клич, дальше лечит раненых
      if (f.cls === 'guide') {
        const allies = alive(f.side);
        if (!f.buffed && !rallied[f.side]) {
          // клич один на отряд: второй Проводник сразу лечит или бьёт
          f.buffed = true;
          rallied[f.side] = true;
          allies.forEach((a) => { a.atk *= 1.25; });
          log(`${f.name} ведёт отряд: атака +25%.`, { actor: [f.side, f.i], kind: 'buff' });
          continue;
        }
        const hurt = allies.filter((a) => a.hp < a.max * 0.5).sort((a, b) => a.hp / a.max - b.hp / b.max);
        if (hurt.length) {
          const targets = hurt.slice(0, clsN(f.side, 'guide') >= 2 ? 2 : 1);
          targets.forEach((a) => { a.hp = Math.min(a.max, a.hp + Math.round(a.max * 0.2)); });
          log(`${f.name} лечит: ${targets.map((a) => a.name).join(', ')}.`, { actor: [f.side, f.i], kind: 'heal' });
          continue;
        }
      }

      // выбор цели по классу
      let target;
      if (f.cls === 'hunter') target = [...foes].sort((a, b) => a.hp - b.hp)[0];
      else if (f.cls === 'catcher') target = [...foes].sort((a, b) => b.atk - a.atk)[0];
      else {
        // Стражи вызывают огонь на себя: без особой цели бьют чаще их
        const taunt = foes.filter((x) => x.cls === 'guard');
        target = taunt.length && r() < 0.5 ? pick(r, taunt) : pick(r, foes);
      }

      // Страж противника прикрывает самого раненого
      const guards = alive(foeSide).filter((g) => g.cls === 'guard' && g !== target && g.stun === 0);
      const mostHurt = [...foes].sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
      const coverChance = clsN(foeSide, 'guard') >= 2 ? 0.65 : 0.5;
      let covered = null;
      if (guards.length && target === mostHurt && r() < coverChance) { covered = target; target = guards[0]; }

      // попадание
      let need = 10 + target.dodge;
      if (tier(foeSide, 'sound')) need += 2;
      const accBonus = f.cls === 'hunter' && clsN(f.side, 'hunter') >= 2 ? 1 : 0;
      const roll = 1 + Math.floor(r() * 20);
      const cover = covered ? ` (${target.name} прикрывает ${covered.name})` : '';
      if (roll + f.acc + accBonus < need) {
        log(`${f.name} → ${target.name}: промах${cover}.`, { actor: [f.side, f.i], target: [target.side, target.i], kind: 'miss' });
        continue;
      }
      let mult = 0.85 + r() * 0.3;
      if (f.el === 'fire' && tier(f.side, 'fire')) mult *= 1.2;
      const weak = target.weak === f.el;
      if (weak) mult *= 1.5;
      if (f.cls === 'hunter') mult *= 0.9; // добивает слабых — бьёт чуть слабее
      const base = Math.max(1, Math.round((f.atk * f.pow) / 4 * mult - target.def / 4));
      const dealt = damage(f, target, base);
      let text = `${f.name} → ${target.name}: ${dealt}${weak ? ' (слабость!)' : ''}${cover}`;

      // эффекты попадания
      if (f.el === 'fire' && tier(f.side, 'fire') >= 4) { target.burn = 3; }
      if (f.el === 'ice' && tier(f.side, 'ice')) {
        target.slow = true;
        if (tier(f.side, 'ice') >= 4 && r() < 0.25) { target.stun = Math.max(target.stun, 1); text += ', обездвижен'; }
      }
      if (f.cls === 'catcher' && r() < 0.25) {
        target.stun = Math.max(target.stun, clsN(f.side, 'catcher') >= 2 ? 2 : 1);
        text += ', скован';
      }
      if (f.el === 'lightning' && tier(f.side, 'lightning')) {
        const others = alive(foeSide).filter((x) => x !== target);
        others.slice(0, tier(f.side, 'lightning') >= 4 ? 2 : 1).forEach((o) => {
          const d = damage(f, o, Math.max(1, Math.round(base / 2)));
          text += `, разряд по ${o.name} ${d}`;
        });
      }
      if (tier(foeSide, 'plants') >= 4 && f.hp > 0) {
        f.hp = Math.max(0, f.hp - 2);
        text += ', шипы ранят в ответ';
      }
      if (target.hp <= 0) text += ` — ${target.name} падает`;
      log(text + '.', { actor: [f.side, f.i], target: [target.side, target.i], kind: 'hit' });
    }

    // конец раунда
    const notes = [];
    [0, 1].forEach((side) => {
      const mine = alive(side);
      const theirs = alive(1 - side);
      if (!mine.length) return;
      if (tier(side, 'water')) mine.forEach((f) => { f.hp = Math.min(f.max, f.hp + 2); });
      if (tier(side, 'water') >= 4 && round === 3) { mine.forEach((f) => { f.stun = 0; f.burn = 0; f.slow = false; }); notes.push('вода смывает статусы'); }
      if (tier(side, 'plants')) {
        const low = [...mine].sort((a, b) => a.hp / a.max - b.hp / b.max)[0];
        low.hp = Math.min(low.max, low.hp + 4);
      }
      if (tier(side, 'wind') >= 4) { theirs.forEach((f) => damage(null, f, 2)); notes.push('вихрь'); }
      if (tier(side, 'earth') >= 4) { theirs.forEach((f) => damage(null, f, 2)); notes.push('толчок земли'); }
      if (tier(side, 'sound') >= 4 && round % 2 === 1 && theirs.length) { const t = pick(r, theirs); t.stun = Math.max(t.stun, 1); notes.push(`волна оглушает ${t.name}`); }
      mine.forEach((f) => { if (f.burn > 0) { f.burn--; damage(null, f, 3); } });
    });
    log(`Конец раунда ${round}${notes.length ? ': ' + notes.join(', ') : ''}.`, { kind: 'round', round });
  }

  const a = alive(0), b = alive(1);
  let winner;
  if (a.length && !b.length) winner = 0;
  else if (b.length && !a.length) winner = 1;
  else {
    // время вышло — по доле оставшихся хитов
    const share = (side) => sides[side].reduce((s, f) => s + f.hp, 0) / sides[side].reduce((s, f) => s + f.max, 0);
    const d = share(0) - share(1);
    winner = Math.abs(d) < 0.02 ? -1 : d > 0 ? 0 : 1;
  }
  log(winner === 0 ? 'Победа!' : winner === 1 ? 'Поражение.' : 'Ничья.', { kind: 'end' });
  return { winner, frames, rounds: round };
}

/* ---------------- Итоги ---------------- */

// Воскресный бой — финал, он стоит двух очков.
export const battlePoints = (b) => (b.result === 'win' ? (b.final ? 2 : 1) : 0);
export function runScore(run) {
  const list = Object.values(run?.battles || {});
  return {
    wins: list.filter((b) => b.result === 'win').length,
    losses: list.filter((b) => b.result === 'loss').length,
    points: list.reduce((s, b) => s + battlePoints(b), 0),
  };
}
