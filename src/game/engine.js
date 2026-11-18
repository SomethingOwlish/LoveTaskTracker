/* ============================================================
   ПОСЛЕМИРЬЕ — недельный рейд на гиганта поверх задач.

   Основа — система «Послемирья»: 124 вида, восемь стихий, четыре класса,
   три одинаковых одной звезды сливаются в одно на звезду выше, и десять
   гигантов. Раскладка команды — как в «Валютных войнах»: четыре бойца
   в строю, до шести в тылу, всего до десяти, места растут с уровнем.

   Каждую неделю выходит один гигант — один для обоих. Каждый собирает
   свою команду и бьёт его сам: урон копится за неделю, а запас здоровья
   у гиганта такой, что свалить его — подвиг.

   Задачи дают только монеты. Всё остальное — особи, опыт, перебросы,
   лишние вылазки — покупается за них. Награды не хранятся, а считаются
   из закрытых за неделю задач: отменил выполнение — монеты ушли.

   Здесь только чистые функции (без Firestore и React) — их гоняют тесты.
   ============================================================ */
import SPECIES from './species.json';
import GIANTS from './giants.json';

export { SPECIES, GIANTS };
export const BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/* ---------------- Справочники ---------------- */

// Бонусы стихий: ступени 2 / 4 / 6 особей этой стихии в команде (строй + тыл).
export const ELEMENTS = {
  fire: { name: 'Огонь', icon: 'fa-fire', color: '#e0643a', tiers: ['огонь бьёт ×1,25', '×1,5 и гигант горит', '×1,8 и гигант горит сильнее'] },
  water: { name: 'Вода', icon: 'fa-droplet', color: '#4f9be0', tiers: ['строй лечится на 3 в раунд', 'на 6 в раунд', 'на 10 в раунд'] },
  lightning: { name: 'Молния', icon: 'fa-bolt', color: '#e6c84a', tiers: ['разряд: +20% урона молнией', '+35%', '+50%'] },
  ice: { name: 'Лёд', icon: 'fa-snowflake', color: '#8fd3e8', tiers: ['гигант бьёт слабее на 10%', 'на 20%', 'на 30%'] },
  wind: { name: 'Ветер', icon: 'fa-wind', color: '#9fd6b0', tiers: ['ветер: 15% на второй ход', '30%', '45%'] },
  earth: { name: 'Земля', icon: 'fa-mountain', color: '#b08a5a', tiers: ['щит строю 10 в начале боя', 'щит 20', 'щит 35'] },
  plants: { name: 'Растения', icon: 'fa-leaf', color: '#7cbf5a', tiers: ['шипы: гигант получает 3 за удар', 'шипы 6', 'шипы 10'] },
  sound: { name: 'Звук', icon: 'fa-music', color: '#c58ae0', tiers: ['гигант мажет в 10% ударов', 'в 20%', 'в 30%'] },
};
const EL_STEPS = [2, 4, 6];

// Классы: в строю — свой стиль боя, в тылу — поддержка. Связь класса: 2 / 4.
export const CLASSES = {
  guard: { name: 'Страж', icon: 'fa-shield-halved', front: 'принимает удары гиганта на себя', back: 'ставит щит самому раненому', tiers: ['стражи получают на 20% меньше', 'на 40% меньше'] },
  hunter: { name: 'Охотник', icon: 'fa-crosshairs', front: 'бьёт сильнее всех', back: 'стреляет вполсилы', tiers: ['15% крит ×2', '30% крит ×2'] },
  guide: { name: 'Проводник', icon: 'fa-hand-sparkles', front: 'бьёт и подлечивает строй', back: 'лечит самого раненого', tiers: ['команда бьёт на 10% сильнее', 'на 20% сильнее'] },
  catcher: { name: 'Ловчий', icon: 'fa-link', front: 'бьёт и может сковать гиганта', back: 'может сковать гиганта', tiers: ['гигант пропускает удар в 10% раундов', 'в 20%'] },
};
const CL_STEPS = [2, 4];

export const RARITY = {
  common: { name: 'обычное', cost: 1 },
  rare: { name: 'редкое', cost: 2 },
  very_rare: { name: 'очень редкое', cost: 3 },
};

export const START_COINS = 8;
export const SHOP_SIZE = 5;
export const BENCH_SIZE = 8;
export const FRONT_SIZE = 4;
export const BACK_SIZE = 6;
export const MAX_TEAM = FRONT_SIZE + BACK_SIZE;
export const REROLL_COST = 1;
export const XP_BUY = { cost: 4, xp: 4 };
export const DAILY_XP = 2;
export const INTEREST_STEP = 10;  // +1 монета за каждые 10 отложенных
export const INTEREST_MAX = 5;
export const GIANT_HP = 10000; // обычная неделя снимает ~20%, продуманная с двумя вылазками в день ~55%
export const MAX_ROUNDS = 10;
// Первая вылазка дня бесплатная, каждая следующая дороже.
export const fightCost = (n) => (n === 0 ? 0 : 3 * n);

// Порог опыта для уровня: индекс = уровень - 1. Команда = уровень + 2 (до 10).
export const LEVEL_XP = [0, 2, 6, 12, 20, 32, 48, 68];
const ODDS = [
  [90, 10, 0],
  [82, 17, 1],
  [72, 25, 3],
  [62, 31, 7],
  [52, 36, 12],
  [42, 40, 18],
  [34, 42, 24],
  [26, 44, 30],
];

export function levelOf(xp) {
  let l = 1;
  LEVEL_XP.forEach((need, i) => { if (xp >= need) l = i + 1; });
  return l;
}
export const nextLevelXp = (xp) => LEVEL_XP.find((need) => need > xp) ?? null;
export const teamSize = (level) => Math.min(MAX_TEAM, level + 2);
export const oddsFor = (level) => ODDS[Math.min(level, ODDS.length) - 1];
// проданная особь возвращает всё, что в неё вложено
export const unitCost = (u) => RARITY[BY_ID[u.s].rar].cost * 3 ** (u.st - 1);

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
export const dayIndex = (d = new Date()) => (d.getDay() + 6) % 7; // 0 = пн … 6 = вс
function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}

/* ---------------- Гиганты ---------------- */

// Слабость гиганта — стихия, к которой чаще всего уязвимы его дети по стихии.
const WEAK_OF = { fire: 'water', water: 'lightning', lightning: 'earth', ice: 'fire', wind: 'ice', earth: 'water', plants: 'fire', sound: 'wind' };

// Ауры по лору «Послемирья», переложенные на бой.
export const AURAS = {
  ta_chto_daet_teplo: 'Жар: ледяные особи ходят через раунд.',
  ta_chto_prinosit_dozhd: 'Молнии: первый удар раунда — в самого сильного, даже в тылу.',
  ta_chto_prinosit_son: 'Сон: каждый раунд одна особь засыпает и пропускает ход.',
  ta_chto_unosit_golosa: 'Немота: тыл действует только в половине раундов.',
  tot_kto_vedet_v_puti: 'Ветер: поддержка из тыла слабее на 40%.',
  tot_kto_darit_pesnyu: 'Вой: каждый раунд одна особь подвывает и теряет ход.',
  tot_kto_derzhit_zemlyu: 'Дрожь: раз в два раунда строй может упасть и потерять ход.',
  tot_kto_derzhit_nebo: 'Давление: вся команда бьёт слабее на 15%.',
  tot_kto_sterezhet_mashiny: 'Искры: каждый третий раунд машины бьют вместе с ним — лишний удар.',
  tumannyy_los: 'Болезнь: туман отнимает у всех по 3 хита в раунд.',
};

export function giantOf(week) {
  // все десять по кругу: номер недели от 5 января 2026 (понедельник)
  const n = Math.floor(daysBetween('2026-01-05', week) / 7);
  const g = GIANTS[((n % GIANTS.length) + GIANTS.length) % GIANTS.length];
  const kids = g.kids.length ? g.kids : SPECIES.filter((s) => s.el === g.el).slice(0, 4).map((s) => s.id);
  return { ...g, kids, weak: WEAK_OF[g.el], auraText: AURAS[g.id] || '' };
}

/* ---------------- Награды за задачи ----------------
   Закрытая задача — 2 монеты; важная +1…+3 (половина важности),
   срочная +1, за каждые 2 пункта чеклиста +1 (до +3).
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
  return 2 + (imp > 0 ? Math.ceil(imp / 2) : 0) + (urg > 0 ? 1 : 0) + Math.min(3, Math.floor(items / 2));
}

export function rewardsFor(tasks, uid, from) {
  const since = from.getTime();
  let coins = 0;
  const list = [];
  tasks.forEach((t) => {
    if (t.assigneeUid !== uid) return;
    if (t.status !== 'done' && t.status !== 'approved') return;
    const at = msOf(t.completedAt);
    if (!at || at < since) return;
    const c = taskReward(t);
    coins += c;
    list.push({ id: t.id, title: t.title, at, coins: c });
  });
  list.sort((a, b) => b.at - a.at);
  return { coins, list };
}

/* ---------------- Ран ---------------- */

let uidCounter = 0;
const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function newRun(week, today = week) {
  return {
    week,
    spent: 0,       // потрачено монет (продажи возвращают)
    interest: 0,    // проценты с накоплений
    xpBought: 0,
    xpDaily: 0,
    lastTick: today, // день, за который уже начислены проценты и опыт
    shop: null,     // { key, ids: [] }
    rerolls: 0,
    front: Array(FRONT_SIZE).fill(null),
    back: Array(BACK_SIZE).fill(null),
    bench: Array(BENCH_SIZE).fill(null),
    damage: 0,      // урон гиганту за неделю
    fights: [],     // вылазки
  };
}

export function economy(run, rewards) {
  const xp = (run.xpBought || 0) + (run.xpDaily || 0);
  const level = levelOf(xp);
  return {
    coins: START_COINS + rewards.coins + (run.interest || 0) - (run.spent || 0),
    xp, level, slots: teamSize(level), next: nextLevelXp(xp),
  };
}

export const teamOf = (run) => [...run.front, ...run.back].filter(Boolean);

// Новый день: проценты с отложенных монет и немного опыта — за каждый
// прошедший день (если не заходила, всё равно начислится).
export function tick(run, rewards, today) {
  const days = daysBetween(run.lastTick || today, today);
  if (days <= 0) return run;
  let next = { ...run };
  for (let i = 0; i < days; i++) {
    const coins = economy(next, rewards).coins;
    next = {
      ...next,
      interest: (next.interest || 0) + Math.min(INTEREST_MAX, Math.max(0, Math.floor(coins / INTEREST_STEP))),
      xpDaily: (next.xpDaily || 0) + DAILY_XP,
    };
  }
  return { ...next, lastTick: today };
}
export const interestFor = (coins) => Math.min(INTEREST_MAX, Math.max(0, Math.floor(coins / INTEREST_STEP)));

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

// Лавка бесплатно обновляется раз в день; перебросы — за монету.
export function ensureShop(run, uid, today, level) {
  const key = `${today}#${run.rerolls || 0}`;
  if (run.shop?.key === key) return run; // за день лавка не меняется, даже если вырос уровень
  return { ...run, shop: { key, ids: rollShop(`${uid}|${key}`, level) } };
}

const clone = (run) => ({
  ...run,
  front: [...run.front], back: [...run.back], bench: [...run.bench],
  shop: run.shop ? { ...run.shop, ids: [...run.shop.ids] } : null,
  fights: [...(run.fights || [])],
});
const fail = (msg) => ({ error: msg });
const ZONES = ['front', 'back', 'bench'];

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

// Покупка идёт на скамейку. Если скамейка полна, но покупка сразу собирает
// тройку — всё равно можно (как в автошахматах).
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
  const same = ZONES.flatMap((z) => next[z]).filter((x) => x && x.s === id && x.st === 1).length;
  if (free === -1 && same < 2) return fail('Скамейка заполнена — продай кого-нибудь');
  if (free === -1) next.bench.push(unit); else next.bench[free] = unit;
  const merged = mergeAll(next);
  merged.bench = merged.bench.slice(0, BENCH_SIZE); // временное девятое место тройка уже освободила
  return { run: merged, got: unit };
}

// Три одинаковых одной звезды → одна на звезду выше. Цепочкой: три ★★ → ★★★.
// Остаётся та, что стоит выше всех: строй, потом тыл, потом скамейка.
export function mergeAll(run) {
  const next = { ...run, front: [...run.front], back: [...run.back], bench: [...run.bench] };
  for (;;) {
    const groups = {};
    ZONES.forEach((z) => next[z].forEach((x, i) => {
      if (!x || x.st >= 3) return;
      const k = `${x.s}|${x.st}`;
      (groups[k] = groups[k] || []).push({ x, z, i });
    }));
    const trio = Object.values(groups).find((g) => g.length >= 3);
    if (!trio) return next;
    const [keep, ...rest] = trio.slice(0, 3);
    next[keep.z][keep.i] = { ...keep.x, st: keep.x.st + 1 };
    rest.forEach((e) => { next[e.z][e.i] = null; });
  }
}

export function sell(run, where, i) {
  const u = run[where][i];
  if (!u) return fail('Пусто');
  const next = clone(run);
  next[where][i] = null;
  next.spent -= unitCost(u);
  return { run: next, refund: unitCost(u) };
}

// Переставить особь (обмен местами). Команда не может быть больше, чем позволяет уровень.
export function move(run, eco, from, to) {
  const next = clone(run);
  const a = next[from.where][from.i];
  const b = next[to.where][to.i];
  if (!a) return fail('Пусто');
  next[to.where][to.i] = a;
  next[from.where][from.i] = b;
  const before = teamOf(run).length;
  const after = teamOf(next).length;
  if (after > eco.slots && after > before) return fail(`В команде ${eco.slots} мест — подними уровень`);
  return { run: next };
}

/* ---------------- Связи ---------------- */

export function bonds(units) {
  const el = {}, cl = {};
  units.forEach((u) => {
    const s = BY_ID[u.s];
    el[s.el] = (el[s.el] || 0) + 1;
    cl[s.cls] = (cl[s.cls] || 0) + 1;
  });
  const step = (n, steps) => steps.filter((x) => n >= x).length; // 0..3
  return {
    el, cl,
    elTier: Object.fromEntries(Object.entries(el).map(([k, n]) => [k, step(n, EL_STEPS)])),
    clTier: Object.fromEntries(Object.entries(cl).map(([k, n]) => [k, step(n, CL_STEPS)])),
  };
}
export { EL_STEPS, CL_STEPS };

/* ---------------- Вылазка на гиганта ----------------
   Хиты особи: 10 + хиты × 3 (у Стража ×1,4). Строй бьёт гиганта каждый
   раунд: атака × сила / 4 × разброс; особи стихии-слабости гиганта ×1,3.
   Тыл не бьёт, а поддерживает. Гигант бьёт строй (дважды за раунд, с
   четверга — трижды), копит гнев и на полном гневе бьёт всех. Вылазка
   кончается через 10 раундов или когда строй пал. Детерминирована по seed. */

export const ENGINE_V = 2;

export function battleHp(sp, st) {
  return Math.round((10 + sp.s[st - 1][2] * 3) * (sp.cls === 'guard' ? 1.4 : 1));
}
export const giantPower = (day) => 16 + 4 * day;
const WRATH_MAX = 8;

function fighter(u, row, i) {
  const sp = BY_ID[u.s];
  const [atk, def, , spd] = sp.s[u.st - 1];
  const max = battleHp(sp, u.st);
  return { row, i, id: u.s, st: u.st, name: sp.name, el: sp.el, cls: sp.cls, atk, def, spd, pow: sp.pow, hp: max, max, shield: 0, skip: 0 };
}

export function simulateRaid(team, giant, day, seed) {
  const r = rng(seed);
  const front = (team.front || []).map((u, i) => fighter(u, 'front', i));
  const back = (team.back || []).map((u, i) => fighter(u, 'back', i));
  const all = [...front, ...back];
  const b = bonds([...(team.front || []), ...(team.back || [])]);
  const elT = (k) => b.elTier[k] || 0;
  const clT = (k) => b.clTier[k] || 0;
  const kids = new Set(giant.kids);
  const auraId = giant.id;

  const frames = [];
  let dealt = 0;
  let wrath = 0;
  const snap = () => ({ front: front.map((f) => [f.hp, f.shield, f.skip > 0 ? 1 : 0]), back: back.map((f) => [f.hp, f.shield, f.skip > 0 ? 1 : 0]) });
  const log = (text, extra = {}) => frames.push({ text, dmg: dealt, wrath, hp: snap(), ...extra });
  const alive = (arr) => arr.filter((f) => f.hp > 0);

  if (!front.length) {
    return { dmg: 0, rounds: 0, wiped: true, frames: [{ text: 'В строю никого — вылазки не было.', dmg: 0, wrath: 0, hp: snap(), kind: 'end' }] };
  }

  // начало боя
  const shield = [0, 10, 20, 35][elT('earth')];
  if (shield) front.forEach((f) => { f.shield = shield; });
  let atkMult = 1 + [0, 0.1, 0.2][clT('guide')];
  if (auraId === 'tot_kto_derzhit_nebo') atkMult *= 0.85;
  log(`${giant.name} выходит навстречу. ${giant.auraText}`, { kind: 'start' });

  const hurt = (f, raw, note) => {
    let d = raw;
    if (f.cls === 'guard') d *= 1 - [0, 0.2, 0.4][clT('guard')];
    d = Math.max(1, Math.round(d - f.def / 4));
    if (f.shield > 0) { const ab = Math.min(f.shield, d); f.shield -= ab; d -= ab; }
    f.hp = Math.max(0, f.hp - d);
    return `${note}${d}${f.hp <= 0 ? ` — ${f.name} выбывает` : ''}`;
  };
  const hitGiant = (f, mult) => {
    let m = atkMult * mult * (0.85 + r() * 0.3);
    if (f.el === giant.weak) m *= 1.3;
    if (f.el === 'fire') m *= [1, 1.25, 1.5, 1.8][elT('fire')];
    if (f.el === 'lightning') m *= 1 + [0, 0.2, 0.35, 0.5][elT('lightning')];
    if (f.cls === 'hunter' && r() < [0, 0.15, 0.3][clT('hunter')]) m *= 2;
    const d = Math.max(1, Math.round((f.atk * f.pow) / 4 * m));
    dealt += d;
    return d;
  };

  let round = 0;
  let wiped = false;
  while (round < MAX_ROUNDS) {
    round++;
    let giantStunned = false;

    // ауры начала раунда
    const sleeper = () => pick(r, alive(all));
    if (auraId === 'ta_chto_prinosit_son' && alive(all).length) { const s = sleeper(); s.skip = 1; log(`${s.name} засыпает.`, { actor: [s.row, s.i], kind: 'aura' }); }
    if (auraId === 'tot_kto_darit_pesnyu' && alive(all).length) { const s = sleeper(); s.skip = 1; log(`${s.name} подвывает гиганту и теряет ход.`, { actor: [s.row, s.i], kind: 'aura' }); }
    if (auraId === 'tot_kto_derzhit_zemlyu' && round % 2 === 0) {
      const fell = alive(front).filter(() => r() < 0.3);
      fell.forEach((f) => { f.skip = 1; });
      if (fell.length) log(`Земля дрожит: падают ${fell.map((f) => f.name).join(', ')}.`, { kind: 'aura' });
    }

    // строй бьёт гиганта (по скорости)
    const order = alive(front).sort((a, c) => c.spd - a.spd);
    for (const f of order) {
      if (f.skip > 0) { f.skip--; continue; }
      if (auraId === 'ta_chto_daet_teplo' && f.el === 'ice' && round % 2 === 0) { log(`${f.name} изнемогает от жара.`, { actor: ['front', f.i], kind: 'aura' }); continue; }
      const turns = r() < [0, 0.15, 0.3, 0.45][f.el === 'wind' ? elT('wind') : 0] ? 2 : 1;
      for (let t = 0; t < turns; t++) {
        const d = hitGiant(f, 1);
        let text = `${f.name} → ${d}${f.el === giant.weak ? ' (слабость!)' : ''}${t ? ' (ветер, второй ход)' : ''}`;
        if (f.cls === 'catcher' && r() < 0.15) { giantStunned = true; text += ', гигант скован'; }
        if (f.cls === 'guide') {
          const low = alive(front).sort((a, c) => a.hp / a.max - c.hp / c.max)[0];
          if (low && low.hp < low.max) { low.hp = Math.min(low.max, low.hp + 4); text += `, подлечивает ${low.name}`; }
        }
        log(text + '.', { actor: ['front', f.i], kind: 'hit' });
      }
    }

    // тыл поддерживает
    const backMult = auraId === 'tot_kto_vedet_v_puti' ? 0.6 : 1;
    for (const f of alive(back)) {
      if (f.skip > 0) { f.skip--; continue; }
      if (auraId === 'ta_chto_unosit_golosa' && r() < 0.5) continue;
      if (auraId === 'ta_chto_daet_teplo' && f.el === 'ice' && round % 2 === 0) continue;
      if (f.cls === 'hunter') {
        const d = hitGiant(f, 0.5 * backMult);
        log(`${f.name} стреляет из тыла: ${d}.`, { actor: ['back', f.i], kind: 'hit' });
      } else if (f.cls === 'guard') {
        const t = alive(front).sort((a, c) => a.hp / a.max - c.hp / c.max)[0];
        if (t) { const s = Math.round((3 + f.def / 2) * backMult); t.shield += s; log(`${f.name} прикрывает ${t.name}: щит ${s}.`, { actor: ['back', f.i], kind: 'buff' }); }
      } else if (f.cls === 'guide') {
        const t = alive(front).sort((a, c) => a.hp / a.max - c.hp / c.max)[0];
        if (t && t.hp < t.max) { const h = Math.round(t.max * 0.12 * backMult); t.hp = Math.min(t.max, t.hp + h); log(`${f.name} лечит ${t.name}: +${h}.`, { actor: ['back', f.i], kind: 'heal' }); }
      } else if (f.cls === 'catcher' && r() < 0.15 * backMult) {
        giantStunned = true;
        log(`${f.name} набрасывает сеть — гигант скован.`, { actor: ['back', f.i], kind: 'buff' });
      }
    }
    if (r() < [0, 0.1, 0.2][clT('catcher')]) giantStunned = true;
    // огонь на 4+ поджигает
    if (elT('fire') >= 2) { const burn = elT('fire') >= 3 ? 12 : 6; dealt += burn; }

    // гигант бьёт
    const power = giantPower(day) * (1 - [0, 0.1, 0.2, 0.3][elT('ice')]);
    if (giantStunned) {
      log(`${giant.name} скован и не бьёт.`, { kind: 'aura' });
    } else {
      let hits = day >= 3 ? 3 : 2;
      if (auraId === 'tot_kto_sterezhet_mashiny' && round % 3 === 0) hits++;
      for (let h = 0; h < hits; h++) {
        const targets = alive(front).filter((f) => !kids.has(f.id));
        if (!alive(front).length) break;
        let t;
        if (h === 0 && auraId === 'ta_chto_prinosit_dozhd') t = alive(all).filter((f) => !kids.has(f.id)).sort((a, c) => c.atk - a.atk)[0];
        if (!t) {
          if (!targets.length) { log(`${giant.name} не поднимает лапу на своих детей.`, { kind: 'aura' }); break; }
          const guards = targets.filter((f) => f.cls === 'guard');
          t = guards.length && r() < 0.6 ? pick(r, guards) : pick(r, targets);
        }
        if (r() < [0, 0.1, 0.2, 0.3][elT('sound')]) { log(`${giant.name} промахивается мимо ${t.name}.`, { target: [t.row, t.i], kind: 'miss' }); continue; }
        const text = hurt(t, power * (0.85 + r() * 0.3), `${giant.name} бьёт ${t.name}: `);
        const thorns = [0, 3, 6, 10][elT('plants')];
        if (thorns) dealt += thorns;
        log(text + (thorns ? `, шипы ранят гиганта на ${thorns}` : '') + '.', { target: [t.row, t.i], kind: 'hurt' });
      }
    }

    // гнев: дети гиганта в команде злят его быстрее
    const kidsIn = alive(all).filter((f) => kids.has(f.id)).length;
    wrath += 1 + kidsIn;
    if (wrath >= WRATH_MAX) {
      wrath = 0;
      const p = Math.round(giantPower(day) * 0.6);
      alive(all).forEach((f) => hurt(f, p, ''));
      log(`Гнев гиганта: ${giant.wrath || 'удар по всем'} — все получают урон.`, { kind: 'wrath' });
    }

    // конец раунда
    const heal = [0, 3, 6, 10][elT('water')];
    if (heal) alive(front).forEach((f) => { f.hp = Math.min(f.max, f.hp + heal); });
    if (auraId === 'tumannyy_los') alive(all).forEach((f) => { f.hp = Math.max(0, f.hp - 3); });
    log(`Конец раунда ${round}: снято ${dealt}.`, { kind: 'round', round });

    if (!alive(front).length) { wiped = true; break; }
  }
  log(wiped ? `Строй пал. За вылазку снято ${dealt}.` : `Вылазка окончена: снято ${dealt}.`, { kind: 'end' });
  return { dmg: dealt, rounds: round, wiped, frames };
}

/* ---------------- Итоги ---------------- */

export const fightsOn = (run, day) => (run.fights || []).filter((f) => f.day === day).length;
export const giantLeft = (run) => Math.max(0, GIANT_HP - (run?.damage || 0));
export const giantDown = (run) => (run?.damage || 0) >= GIANT_HP;
