/* ============================================================
   ПОСЛЕМИРЬЕ — недельный рейд на гиганта поверх задач.

   Основа — система «Послемирья»: 124 вида, восемь стихий, четыре класса,
   двенадцать семейств, шесть регионов, одиннадцать групп навыков и десять
   гигантов. Три одинаковых одной звезды сливаются в одну на звезду выше,
   до ★6. Раскладка — как в «Валютных войнах»: строй бьёт, тыл поддерживает,
   всего до одиннадцати.

   Неделя: в понедельник выпадает набор из 30 видов — лавка даёт только их,
   так повторки находятся. В выходные лавка может предложить сразу ★3 тех
   видов, что у тебя уже есть на ★3.

   Каждую неделю выходит один гигант — один для обоих, но урон у каждого
   свой. Задачи, настроение, Мурмур и бюджет дают только монеты. Всё остальное покупается за них.
   Награды не хранятся, а считаются из того, что сделано за неделю.

   Здесь только чистые функции (без Firestore и React) — их гоняют тесты.
   ============================================================ */
import SPECIES from './species.json';
import GIANTS from './giants.json';

export { SPECIES, GIANTS };
export const BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/* ---------------- Редкость: цвет, цена и сила ---------------- */

export const RARITY = {
  common: { name: 'обычное', color: 'green', label: 'зелёное', cost: 1, mult: 1 },
  rare: { name: 'редкое', color: 'blue', label: 'синее', cost: 2, mult: 1.15 },
  very_rare: { name: 'очень редкое', color: 'purple', label: 'фиолетовое', cost: 3, mult: 1.3 },
};
const RAR_KEYS = ['common', 'rare', 'very_rare'];

/* ---------------- Размещение ----------------
   Каждый вид знает, где ему место: в строю, в тылу или где угодно.
   Не на своём месте особь работает на 60%. */

export const PLACE = { front: 'строй', back: 'тыл', both: 'строй или тыл' };
export const MISPLACED = 0.6;
export function placeOf(sp) {
  const [atk, def, , spd] = sp.s[0];
  if (sp.cls === 'guard') return 'front';
  if (sp.cls === 'guide') return 'back';
  if (sp.cls === 'hunter') return spd >= atk ? 'both' : 'front';
  return spd >= def ? 'back' : 'both'; // ловчий
}
export const fits = (sp, row) => { const p = placeOf(sp); return p === 'both' || p === row; };

/* ---------------- Связи ----------------
   Связь включается, когда в команде (строй + тыл) набралось нужное число
   особей с общим признаком. У каждой ступени — свои числа. */

// Стихии: 2 / 4 / 6
export const ELEMENTS = {
  fire: { name: 'Огонь', icon: 'fa-fire', color: '#e0643a', steps: [2, 4, 6], v: [1.25, 1.5, 1.8], text: (x) => `огонь бьёт ×${x}${x >= 1.5 ? ', гигант горит' : ''}` },
  water: { name: 'Вода', icon: 'fa-droplet', color: '#4f9be0', steps: [2, 4, 6], v: [3, 6, 10], text: (x) => `строй лечится на ${x} в раунд` },
  lightning: { name: 'Молния', icon: 'fa-bolt', color: '#e6c84a', steps: [2, 4, 6], v: [0.2, 0.35, 0.5], text: (x) => `разряд: +${Math.round(x * 100)}% урона молнией` },
  ice: { name: 'Лёд', icon: 'fa-snowflake', color: '#8fd3e8', steps: [2, 4, 6], v: [0.1, 0.2, 0.3], text: (x) => `гигант бьёт слабее на ${Math.round(x * 100)}%` },
  wind: { name: 'Ветер', icon: 'fa-wind', color: '#9fd6b0', steps: [2, 4, 6], v: [0.15, 0.3, 0.45], text: (x) => `ветер: ${Math.round(x * 100)}% на второй ход` },
  earth: { name: 'Земля', icon: 'fa-mountain', color: '#b08a5a', steps: [2, 4, 6], v: [10, 20, 35], text: (x) => `щит строю ${x} в начале боя` },
  plants: { name: 'Растения', icon: 'fa-leaf', color: '#7cbf5a', steps: [2, 4, 6], v: [3, 6, 10], text: (x) => `шипы: гигант получает ${x} за удар` },
  sound: { name: 'Звук', icon: 'fa-music', color: '#c58ae0', steps: [2, 4, 6], v: [0.1, 0.2, 0.3], text: (x) => `гигант мажет в ${Math.round(x * 100)}% ударов` },
};

// Классы: 2 / 4 / 6. В строю у каждого свой стиль, в тылу — своя поддержка.
export const CLASSES = {
  guard: { name: 'Страж', icon: 'fa-shield-halved', front: 'принимает удары на себя', back: 'ставит щит самому раненому', steps: [2, 4, 6], v: [0.2, 0.35, 0.5], text: (x) => `стражи получают на ${Math.round(x * 100)}% меньше` },
  hunter: { name: 'Охотник', icon: 'fa-crosshairs', front: 'бьёт сильнее всех', back: 'стреляет вполсилы', steps: [2, 4, 6], v: [0.15, 0.3, 0.45], text: (x) => `${Math.round(x * 100)}% крит ×2 у охотников` },
  guide: { name: 'Проводник', icon: 'fa-hand-sparkles', front: 'бьёт и подлечивает строй', back: 'лечит самого раненого', steps: [2, 4, 6], v: [0.1, 0.2, 0.3], text: (x) => `команда бьёт на ${Math.round(x * 100)}% сильнее` },
  catcher: { name: 'Ловчий', icon: 'fa-link', front: 'бьёт и может сковать гиганта', back: 'может сковать гиганта', steps: [2, 4, 6], v: [0.1, 0.2, 0.3], text: (x) => `гигант пропускает удар в ${Math.round(x * 100)}% раундов` },
};

// Семейства (тип животного): 2 / 3 / 4, у малых семейств — 2 / 3.
export const FAMILIES = {
  birds: { name: 'Птицы', icon: 'fa-dove', steps: [2, 3, 4], v: [0.1, 0.2, 0.3], text: (x) => `птицы ходят дважды в ${Math.round(x * 100)}% раундов` },
  bats: { name: 'Летучие мыши', icon: 'fa-moon', steps: [2, 3], v: [0.08, 0.15], text: (x) => `гигант теряет вас в темноте: ещё ${Math.round(x * 100)}% промахов` },
  reptiles: { name: 'Ящерицы и змеи', icon: 'fa-staff-snake', steps: [2, 3, 4], v: [6, 12, 18], text: (x) => `чешуя: щит ${x} всем в строю` },
  amphibians: { name: 'Лягушки и тритоны', icon: 'fa-frog', steps: [2, 3, 4], v: [2, 4, 6], text: (x) => `слизь лечит всю команду на ${x} в раунд` },
  fish: { name: 'Рыбы', icon: 'fa-fish', steps: [2, 3, 4], v: [5, 9, 14], text: (x) => `рыбы восстанавливают ${x} хитов в раунд` },
  felines: { name: 'Кошачьи', icon: 'fa-cat', steps: [2, 3, 4], v: [0.15, 0.25, 0.35], text: (x) => `кошачьи: ${Math.round(x * 100)}% крит ×2` },
  canines: { name: 'Псовые', icon: 'fa-dog', steps: [2, 3, 4], v: [0.15, 0.3, 0.45], text: (x) => `стая: псовые бьют на ${Math.round(x * 100)}% сильнее` },
  mustelids: { name: 'Куньи', icon: 'fa-otter', steps: [2, 3, 4], v: [3, 6, 9], text: (x) => `кусаются в ответ: гигант получает ${x} за удар` },
  bears: { name: 'Медведи', icon: 'fa-paw', steps: [2, 3], v: [0.15, 0.3], text: (x) => `вся команда крепче на ${Math.round(x * 100)}% хитов` },
  ungulates: { name: 'Копытные', icon: 'fa-horse', steps: [2, 3, 4], v: [12, 24, 40], text: (x) => `топот: ${x} урона гиганту в конце раунда` },
  rodents: { name: 'Грызуны', icon: 'fa-cheese', steps: [2, 3, 4], v: [0.15, 0.3, 0.45], text: (x) => `тыл работает на ${Math.round(x * 100)}% сильнее` },
  insectivores: { name: 'Насекомоядные', icon: 'fa-bug', steps: [2, 3, 4], v: [0.05, 0.1, 0.15], text: (x) => `подтачивают: гигант бьёт слабее на ${Math.round(x * 100)}%` },
};

// Регионы — земляки: 3 / 5.
export const REGIONS = {
  shumnaya_nizina: { name: 'Шумная низина', icon: 'fa-bell', steps: [3, 5], v: [0.1, 0.2], text: (x) => `звон: ${Math.round(x * 100)}% крит ×2 у всех` },
  mrachnyy_les: { name: 'Мрачный лес', icon: 'fa-tree', steps: [3, 5], v: [0.3, 0.6], text: (x) => `засада: первые два раунда урон +${Math.round(x * 100)}%` },
  ruiny_prezhnih: { name: 'Руины прежних', icon: 'fa-archway', steps: [3, 5], v: [0.3, 0.6], text: (x) => `первый павший встаёт с ${Math.round(x * 100)}% хитов` },
  trakt_puteshestvennikov: { name: 'Тракт', icon: 'fa-road', steps: [3, 5], v: [1, 2], text: (x) => `выносливость: вылазка длится на ${x} раунд${x > 1 ? 'а' : ''} дольше` },
  venec: { name: 'Венец', icon: 'fa-mountain-sun', steps: [3, 5], v: [3, 6], text: (x) => `горная закалка: удары по строю слабее на ${x}` },
  zvezdopad: { name: 'Звездопад', icon: 'fa-star', steps: [3, 5], v: [3, 6], text: (x) => `звёздное спокойствие: гневу нужно на ${x} больше` },
};

// Размер команды: большие команды получают свои бонусы.
export const SIZE_BONUS = [
  { n: 9, name: 'Стая', atk: 0.1, shield: 8, wrath: 0, text: '+10% урона и щит 8 строю' },
  { n: 11, name: 'Великая стая', atk: 0.15, shield: 15, wrath: 2, text: '+15% урона, щит 15 и гнев копится медленнее' },
];
export const sizeBonus = (n) => [...SIZE_BONUS].reverse().find((b) => n >= b.n) || null;

// Личный навык особи по её группе навыков: срабатывает на 3-м, 6-м и 9-м раундах.
export const SKILLS = {
  damage: { name: 'Удар', text: 'бьёт вдвое' },
  dot: { name: 'Яд', text: 'гигант теряет хиты каждый раунд до конца боя' },
  weaken: { name: 'Ослабление', text: 'гигант бьёт слабее на 8% (копится)' },
  heal: { name: 'Исцеление', text: 'лечит весь строй' },
  shield: { name: 'Щит', text: 'щит всему строю' },
  stun: { name: 'Оглушение', text: '35% оглушить гиганта на раунд' },
  bind: { name: 'Сковывание', text: 'гигант бьёт на раз меньше в этом раунде' },
  buff: { name: 'Усиление', text: 'команда бьёт на 6% сильнее (копится)' },
  haste: { name: 'Ускорение', text: 'сразу бьёт ещё раз' },
  aoe: { name: 'Взрыв', text: 'бьёт в полтора раза и задевает гнев гиганта' },
  burn: { name: 'Сжигание', text: 'бьёт ×1,3 и поджигает гиганта' },
};
const SKILL_ROUNDS = new Set([3, 6, 9, 12]);

/* ---------------- Константы рана ---------------- */

export const START_COINS = 8;
export const SHOP_SIZE = 5;
export const BENCH_SIZE = 10;
export const FRONT_SIZE = 4;
export const BACK_SIZE = 7;
export const MAX_TEAM = FRONT_SIZE + BACK_SIZE; // 11: стандартные 10 и ещё один в тылу
export const MAX_STARS = 6;
export const PACK_SIZE = 30;
export const PACK_MIX = { common: 18, rare: 9, very_rare: 3 };
export const REROLL_COST = 1;
export const XP_BUY = { cost: 4, xp: 4 };
export const DAILY_XP = 2;
export const INTEREST_STEP = 10;  // +1 монета за каждые 10 отложенных
export const INTEREST_MAX = 5;
export const WEEKEND_STAR3 = 0.3; // шанс места лавки в выходные стать ★3
export const GIANT_HP = 25000; // обычная неделя снимает ~20%, плотная с двумя вылазками в день ~65%
export const BASE_ROUNDS = 10;
export const fightCost = (n) => (n === 0 ? 0 : 3 * n);

// Порог опыта: индекс = уровень − 1. Команда = уровень + 2 (до 11 на девятом).
export const LEVEL_XP = [0, 2, 6, 12, 20, 32, 48, 68, 92];
// Цвета в лавке зависят от уровня: [зелёное, синее, фиолетовое].
const ODDS = [
  [100, 0, 0],
  [85, 15, 0],
  [72, 26, 2],
  [60, 33, 7],
  [50, 37, 13],
  [40, 40, 20],
  [32, 42, 26],
  [25, 43, 32],
  [20, 42, 38],
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

// Картинка и имя формы: форм три, после ★3 особь «пробуждается».
export const imgOf = (sp, st) => sp.img[Math.min(st, 3) - 1];
export const formOf = (sp, st) => (st <= 3 ? sp.forms[st - 1] : `${sp.forms[2]}, пробуждение ${st - 3}`);
export const statsOf = (sp, st) => {
  const m = RARITY[sp.rar].mult;
  const [atk, def, hp, spd] = sp.s[st - 1];
  return [Math.round(atk * m), Math.round(def * m), Math.round(hp * m), spd];
};

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
function shuffle(r, arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

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
export function daysBetween(a, b) {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 864e5);
}
export const isWeekend = (day) => {
  const [y, m, d] = day.split('-').map(Number);
  return dayIndex(new Date(y, m - 1, d)) >= 5;
};

/* ---------------- Гиганты ---------------- */

const WEAK_OF = { fire: 'water', water: 'lightning', lightning: 'earth', ice: 'fire', wind: 'ice', earth: 'water', plants: 'fire', sound: 'wind' };

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
  const n = Math.floor(daysBetween('2026-01-05', week) / 7) || 0;
  const g = GIANTS[((n % GIANTS.length) + GIANTS.length) % GIANTS.length];
  const kids = g.kids.length ? g.kids : SPECIES.filter((s) => s.el === g.el).slice(0, 4).map((s) => s.id);
  return { ...g, kids, weak: WEAK_OF[g.el], auraText: AURAS[g.id] || '' };
}

/* ---------------- Набор недели ----------------
   30 видов: 18 зелёных, 9 синих, 3 фиолетовых, среди них не меньше трёх
   видов стихии-слабости гиганта. Выпадает в понедельник; пока ничего не
   куплено, его можно перебросить. */

export function makePack(seed, giant) {
  const r = rng(seed);
  const out = [];
  RAR_KEYS.forEach((rar) => {
    const pool = shuffle(r, SPECIES.filter((s) => s.rar === rar));
    out.push(...pool.slice(0, PACK_MIX[rar]).map((s) => s.id));
  });
  if (giant) {
    const weakIn = out.filter((id) => BY_ID[id].el === giant.weak).length;
    if (weakIn < 3) {
      const extra = shuffle(r, SPECIES.filter((s) => s.el === giant.weak && s.rar === 'common' && !out.includes(s.id))).slice(0, 3 - weakIn);
      // заменяем зелёных не той стихии, чтобы размер и смесь цветов не поплыли
      extra.forEach((s) => {
        const i = out.findIndex((id) => BY_ID[id].rar === 'common' && BY_ID[id].el !== giant.weak);
        if (i >= 0) out[i] = s.id;
      });
    }
  }
  return out;
}

/* ---------------- Награды ----------------
   Монеты недели считаются из того, что сделано в приложении:
   · задача — 1 монета, с подзадачами — монета за каждую подзадачу;
     важная или срочная — ещё +2 (простая важная = 3); закрыта днём
     раньше срока — ещё +1;
   · настроение — 1 за каждый отмеченный день, +1 если отмечена вся неделя,
     +2 за день, когда отметились оба;
   · Мурмур — фильм или досмотренный сериал 1, пройденная игра 10
     (игры бывают огромные), +1 за свой отзыв; серия сериала — 0,5
     (за неделю округляется вниз, отметка серий общая);
   · бюджет — 1 за каждый день, когда что-то внесено, +1 за разобранный чек. */

export const REWARD = { item: 1, hot: 2, early: 1, moodDay: 1, moodWeek: 1, moodPair: 2, media: 1, game: 10, episode: 0.5, review: 1, budgetDay: 1, receipt: 1 };

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
  return Math.max(1, items) * REWARD.item + (imp > 0 || urg > 0 ? REWARD.hot : 0) + (isEarly(t) ? REWARD.early : 0);
}

// Раньше срока — закрыта в более ранний день, чем срок. Срок по умолчанию —
// конец дня создания, так что «закрыл сегодня» бонуса не даёт.
export function isEarly(t) {
  const done = msOf(t.completedAt);
  const due = msOf(t.deadline);
  return !!done && !!due && dayStr(new Date(done)) < dayStr(new Date(due));
}

export function rewardsFor({ tasks = [], moods = [], media = [], tx = [] }, uid, from) {
  const since = from.getTime();
  const fromKey = dayStr(from);

  const list = [];
  tasks.forEach((t) => {
    if (t.assigneeUid !== uid) return;
    if (t.status !== 'done' && t.status !== 'approved') return;
    const at = msOf(t.completedAt);
    if (!at || at < since) return;
    list.push({ id: t.id, title: t.title, at, coins: taskReward(t), items: (t.checklist || []).length, early: isEarly(t) });
  });
  list.sort((a, b) => b.at - a.at);
  const taskCoins = list.reduce((n, x) => n + x.coins, 0);

  const inWeek = moods.filter((m) => m.day >= fromKey && daysBetween(fromKey, m.day) < 7);
  const mine = new Set(inWeek.filter((m) => m.uid === uid).map((m) => m.day));
  const pairDays = new Set(inWeek.filter((m) => m.uid !== uid && mine.has(m.day)).map((m) => m.day)).size;
  const moodDays = mine.size;
  const moodCoins = moodDays * REWARD.moodDay + (moodDays >= 7 ? REWARD.moodWeek : 0) + pairDays * REWARD.moodPair;

  const seen = media
    .filter((m) => m.status === 'done' && msOf(m.doneAt) >= since && (m.doneBy === uid || m.ratings?.[uid] != null))
    .map((m) => ({ id: m.id, title: m.title, kind: m.kind, at: msOf(m.doneAt), review: !!m.reviews?.[uid]?.trim?.() }))
    .map((m) => ({ ...m, coins: (m.kind === 'game' ? REWARD.game : REWARD.media) + (m.review ? REWARD.review : 0) }))
    .sort((a, b) => b.at - a.at);
  const episodes = media.reduce((n, m) => n + Object.values(m.epAt || {}).filter((t) => msOf(t) >= since).length, 0);
  const episodeCoins = Math.floor(episodes * REWARD.episode);
  const mediaCoins = seen.reduce((n, m) => n + m.coins, 0) + episodeCoins;

  // Повторяющиеся платежи заводятся сами — за них монет нет.
  const myTx = tx.filter((t) => t.authorUid === uid && !t.recurringId && msOf(t.createdAt) >= since);
  const budgetDays = new Set(myTx.map((t) => dayStr(new Date(msOf(t.createdAt))))).size;
  const receipts = myTx.filter((t) => t.receiptId).length;
  const budgetCoins = budgetDays * REWARD.budgetDay + receipts * REWARD.receipt;

  return {
    coins: taskCoins + moodCoins + mediaCoins + budgetCoins,
    list,
    tasks: taskCoins,
    mood: { days: moodDays, pairDays, coins: moodCoins },
    media: { list: seen, episodes, coins: mediaCoins },
    budget: { days: budgetDays, receipts, coins: budgetCoins },
  };
}

/* ---------------- Ран ---------------- */

let uidCounter = 0;
const newUid = () => `${Date.now().toString(36)}${(uidCounter++).toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function newRun(week, today = week, uid = '') {
  return {
    v: 3,
    week,
    pack: makePack(`${uid}|${week}|pack0`, giantOf(week)),
    packRolls: 0,
    spent: 0,
    interest: 0,
    xpBought: 0,
    xpDaily: 0,
    lastTick: today,
    shop: null,     // { key, offers: [{ s, st }] }
    rerolls: 0,
    front: Array(FRONT_SIZE).fill(null),
    back: Array(BACK_SIZE).fill(null),
    bench: Array(BENCH_SIZE).fill(null),
    damage: 0,
    fights: [],
  };
}

// Подтянуть сохранённый ран к текущим размерам (тыл 7, скамейка 10).
export function normalizeRun(run) {
  const fit = (arr, n) => [...(arr || []), ...Array(n).fill(null)].slice(0, Math.max(n, (arr || []).length));
  return { ...run, front: fit(run.front, FRONT_SIZE), back: fit(run.back, BACK_SIZE), bench: fit(run.bench, BENCH_SIZE) };
}

export const isFresh = (run) => (run.spent || 0) === 0 && !teamOf(run).length && !run.bench.some(Boolean) && !(run.fights || []).length;

export function repack(run, uid) {
  if (!isFresh(run)) return fail('Набор меняется только до первой покупки');
  const n = (run.packRolls || 0) + 1;
  return { run: { ...run, packRolls: n, pack: makePack(`${uid}|${run.week}|pack${n}`, giantOf(run.week)), shop: null } };
}

export function economy(run, rewards) {
  const xp = (run.xpBought || 0) + (run.xpDaily || 0);
  const level = levelOf(xp);
  return {
    // Не ниже нуля: при смене правил наград посреди недели баланс не уходит в минус.
    coins: Math.max(0, START_COINS + rewards.coins + (run.interest || 0) - (run.spent || 0)),
    xp, level, slots: teamSize(level), next: nextLevelXp(xp),
  };
}

export const teamOf = (run) => [...run.front, ...run.back].filter(Boolean);
const allUnits = (run) => [...run.front, ...run.back, ...run.bench].filter(Boolean);

export function tick(run, rewards, today) {
  const days = daysBetween(run.lastTick || today, today);
  if (days <= 0) return run;
  let next = { ...run };
  for (let i = 0; i < days; i++) {
    const coins = economy(next, rewards).coins;
    next = { ...next, interest: (next.interest || 0) + interestFor(coins), xpDaily: (next.xpDaily || 0) + DAILY_XP };
  }
  return { ...next, lastTick: today };
}
export const interestFor = (coins) => Math.min(INTEREST_MAX, Math.max(0, Math.floor(coins / INTEREST_STEP)));

// Лавка: только виды набора, цвет — по шансам уровня. В выходные место может
// стать ★3 вида, который у тебя уже есть на ★3.
export function rollShop(seed, level, pack, star3 = []) {
  const r = rng(seed);
  const [c, rr] = oddsFor(level);
  const byRar = { common: [], rare: [], very_rare: [] };
  (pack?.length ? pack : SPECIES.map((s) => s.id)).forEach((id) => byRar[BY_ID[id].rar].push(id));
  return Array.from({ length: SHOP_SIZE }, () => {
    if (star3.length && r() < WEEKEND_STAR3) return { s: pick(r, star3), st: 3 };
    const x = r() * 100;
    let rar = x < c ? 'common' : x < c + rr ? 'rare' : 'very_rare';
    while (!byRar[rar].length) rar = RAR_KEYS[RAR_KEYS.indexOf(rar) - 1] || 'common';
    return { s: pick(r, byRar[rar]), st: 1 };
  });
}

export function star3Species(run) {
  return [...new Set(allUnits(run).filter((u) => u.st >= 3).map((u) => u.s))];
}

export function ensureShop(run, uid, today, level) {
  const key = `${today}#${run.rerolls || 0}#${run.packRolls || 0}`;
  if (run.shop?.key === key) return run; // за день лавка не меняется, даже если вырос уровень
  const star3 = isWeekend(today) ? star3Species(run) : [];
  return { ...run, shop: { key, offers: rollShop(`${uid}|${key}`, level, run.pack, star3) } };
}

const clone = (run) => ({
  ...run,
  front: [...run.front], back: [...run.back], bench: [...run.bench],
  shop: run.shop ? { ...run.shop, offers: [...run.shop.offers] } : null,
  fights: [...(run.fights || [])],
});
function fail(msg) { return { error: msg }; }
const ZONES = ['front', 'back', 'bench'];

export function reroll(run, eco) {
  if (eco.coins < REROLL_COST) return fail('Не хватает монет');
  const next = clone(run);
  next.spent += REROLL_COST;
  next.rerolls = (run.rerolls || 0) + 1;
  next.shop = null;
  return { run: next };
}

export function buyXp(run, eco) {
  if (eco.coins < XP_BUY.cost) return fail('Не хватает монет');
  const next = clone(run);
  next.spent += XP_BUY.cost;
  next.xpBought = (run.xpBought || 0) + XP_BUY.xp;
  return { run: next };
}

export const offerCost = (o) => unitCost(o);

export function buy(run, eco, slot) {
  const o = run.shop?.offers?.[slot];
  if (!o) return fail('Пусто');
  const cost = offerCost(o);
  if (eco.coins < cost) return fail('Не хватает монет');
  const next = clone(run);
  next.spent += cost;
  next.shop.offers[slot] = null;
  const unit = { s: o.s, st: o.st, u: newUid() };
  const free = next.bench.indexOf(null);
  const same = ZONES.flatMap((z) => next[z]).filter((x) => x && x.s === o.s && x.st === o.st).length;
  if (free === -1 && same < 2) return fail('Скамейка заполнена — продай кого-нибудь');
  if (free === -1) next.bench.push(unit); else next.bench[free] = unit;
  const merged = mergeAll(next);
  merged.bench = merged.bench.slice(0, BENCH_SIZE);
  return { run: merged, got: unit };
}

// Три одинаковых одной звезды → одна на звезду выше, цепочкой до ★6.
// Остаётся та, что стоит выше всех: строй, потом тыл, потом скамейка.
export function mergeAll(run) {
  const next = { ...run, front: [...run.front], back: [...run.back], bench: [...run.bench] };
  for (;;) {
    const groups = {};
    ZONES.forEach((z) => next[z].forEach((x, i) => {
      if (!x || x.st >= MAX_STARS) return;
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

/* ---------------- Связи: подсчёт ---------------- */

const GROUPS = [
  { kind: 'el', defs: ELEMENTS, key: (sp) => sp.el },
  { kind: 'cl', defs: CLASSES, key: (sp) => sp.cls },
  { kind: 'fam', defs: FAMILIES, key: (sp) => sp.fam },
  { kind: 'reg', defs: REGIONS, key: (sp) => sp.reg },
];

// Все связи команды: [{ kind, key, n, tier, value, def }]. tier 0 — ещё не включилась.
export function bonds(units) {
  const out = [];
  GROUPS.forEach(({ kind, defs, key }) => {
    const count = {};
    units.forEach((u) => { const k = key(BY_ID[u.s]); if (defs[k]) count[k] = (count[k] || 0) + 1; });
    Object.entries(count).forEach(([k, n]) => {
      const def = defs[k];
      const tier = def.steps.filter((s) => n >= s).length;
      out.push({ kind, key: k, n, tier, value: tier ? def.v[tier - 1] : 0, def });
    });
  });
  return out;
}
const bondValue = (list, kind, key) => list.find((b) => b.kind === kind && b.key === key)?.value || 0;

/* ---------------- Вылазка на гиганта ----------------
   Хиты особи: (10 + хиты × 3) × редкость (у Стража ещё ×1,4). Строй бьёт
   гиганта каждый раунд: атака × сила / 4 × разброс; стихия-слабость ×1,3.
   Тыл не бьёт, а поддерживает. Не на своём месте — 60% силы. На 3-м,
   6-м и 9-м раундах каждая особь применяет личный навык. Гигант бьёт
   строй (дважды, с четверга трижды), копит гнев и на полном бьёт всех.
   Вылазка — 10 раундов (Тракт добавляет) или пока строй не пал. */

export const ENGINE_V = 3;

export function battleHp(sp, st) {
  const [, , hp] = statsOf(sp, st);
  return Math.round((10 + hp * 3) * (sp.cls === 'guard' ? 1.4 : 1));
}
export const giantPower = (day) => 16 + 4 * day;
const WRATH_MAX = 8;

export function simulateRaid(team, giant, day, seed) {
  const r = rng(seed);
  const units = [...(team.front || []), ...(team.back || [])];
  const B = bonds(units);
  const el = (k) => bondValue(B, 'el', k);
  const cl = (k) => bondValue(B, 'cl', k);
  const fam = (k) => bondValue(B, 'fam', k);
  const reg = (k) => bondValue(B, 'reg', k);
  const size = sizeBonus(units.length);
  const kids = new Set(giant.kids);
  const aura = giant.id;

  const mk = (u, row, i) => {
    const sp = BY_ID[u.s];
    const [atk, def, , spd] = statsOf(sp, u.st);
    const max = Math.round(battleHp(sp, u.st) * (1 + fam('bears')));
    return {
      row, i, id: u.s, st: u.st, name: sp.name, el: sp.el, cls: sp.cls, fam: sp.fam, skill: sp.skill,
      atk, def, spd, pow: sp.pow, hp: max, max, shield: 0, skip: 0,
      eff: fits(sp, row) ? 1 : MISPLACED,
    };
  };
  const front = (team.front || []).map((u, i) => mk(u, 'front', i));
  const back = (team.back || []).map((u, i) => mk(u, 'back', i));
  const all = [...front, ...back];

  const frames = [];
  let dealt = 0;
  let wrath = 0;
  let dot = 0;          // яд и поджог: урон гиганту каждый раунд
  let weaken = 0;       // накопленное ослабление гиганта
  let teamBuff = 0;     // накопленное усиление команды
  let revived = false;
  const snap = () => ({ front: front.map((f) => [f.hp, f.shield, f.skip > 0 ? 1 : 0]), back: back.map((f) => [f.hp, f.shield, f.skip > 0 ? 1 : 0]) });
  const log = (text, extra = {}) => frames.push({ text, dmg: dealt, wrath, hp: snap(), ...extra });
  const alive = (arr) => arr.filter((f) => f.hp > 0);
  const lowest = (arr) => alive(arr).sort((a, c) => a.hp / a.max - c.hp / c.max)[0];

  if (!front.length) {
    return { dmg: 0, rounds: 0, wiped: true, frames: [{ text: 'В строю никого — вылазки не было.', dmg: 0, wrath: 0, hp: snap(), kind: 'end' }] };
  }

  // начало боя: щиты земли, чешуи и большой стаи
  const startShield = el('earth') + fam('reptiles') + (size?.shield || 0);
  if (startShield) front.forEach((f) => { f.shield = startShield; });
  const baseAtk = 1 + cl('guide') + (size?.atk || 0);
  const pressure = aura === 'tot_kto_derzhit_nebo' ? 0.85 : 1;
  const giantMiss = el('sound') + fam('bats');
  const thorns = el('plants') + fam('mustelids');
  const wrathMax = WRATH_MAX + reg('zvezdopad') + (size?.wrath || 0);
  const maxRounds = BASE_ROUNDS + reg('trakt_puteshestvennikov');
  log(`${giant.name} выходит навстречу. ${giant.auraText}`, { kind: 'start' });
  const misplaced = all.filter((f) => f.eff < 1);
  if (misplaced.length) log(`Не на своём месте: ${misplaced.map((f) => f.name).join(', ')} — работают вполсилы.`, { kind: 'aura' });

  const hurt = (f, raw) => {
    let d = raw;
    if (f.cls === 'guard') d *= 1 - cl('guard');
    d = Math.max(1, Math.round(d - f.def / 4 - reg('venec')));
    if (f.shield > 0) { const ab = Math.min(f.shield, d); f.shield -= ab; d -= ab; }
    f.hp = Math.max(0, f.hp - d);
    if (f.hp <= 0 && !revived && reg('ruiny_prezhnih')) {
      revived = true;
      f.hp = Math.round(f.max * reg('ruiny_prezhnih'));
      return `${d} — ${f.name} падает, но Руины поднимают его`;
    }
    return `${d}${f.hp <= 0 ? ` — ${f.name} выбывает` : ''}`;
  };
  const strike = (f, mult, round) => {
    let m = baseAtk * (1 + teamBuff) * pressure * f.eff * mult * (0.85 + r() * 0.3);
    if (f.el === giant.weak) m *= 1.3;
    if (f.el === 'fire' && el('fire')) m *= el('fire');
    if (f.el === 'lightning') m *= 1 + el('lightning');
    if (f.fam === 'canines') m *= 1 + fam('canines');
    if (round <= 2) m *= 1 + reg('mrachnyy_les');
    const crit = reg('shumnaya_nizina') + (f.cls === 'hunter' ? cl('hunter') : 0) + (f.fam === 'felines' ? fam('felines') : 0);
    const isCrit = crit > 0 && r() < crit;
    if (isCrit) m *= 2;
    const d = Math.max(1, Math.round((f.atk * f.pow) / 4 * m));
    dealt += d;
    return { d, isCrit };
  };

  // Личный навык. Возвращает текст.
  const useSkill = (f, round, state) => {
    const p = f.eff;
    switch (f.skill) {
      case 'damage': { const { d } = strike(f, 2, round); return `удар ×2: ${d}`; }
      case 'haste': { const { d } = strike(f, 1, round); return `ускорение, ещё удар: ${d}`; }
      case 'aoe': { const { d } = strike(f, 1.5, round); wrath = Math.max(0, wrath - 1); return `взрыв: ${d}, гнев −1`; }
      case 'burn': { const { d } = strike(f, 1.3, round); dot += Math.round(3 * f.st * p); return `сжигание: ${d} и поджог`; }
      case 'dot': { const add = Math.round(4 * f.st * p); dot += add; return `яд: гигант теряет ещё ${add} в раунд`; }
      case 'weaken': { weaken = Math.min(0.4, weaken + 0.08 * p); return `ослабляет гиганта (−${Math.round(weaken * 100)}%)`; }
      case 'buff': { teamBuff += 0.06 * p; return `усиливает команду (+${Math.round(teamBuff * 100)}%)`; }
      case 'heal': { const h = Math.round((4 + 2 * f.st) * p); alive(front).forEach((x) => { x.hp = Math.min(x.max, x.hp + h); }); return `лечит строй на ${h}`; }
      case 'shield': { const s = Math.round((5 + 3 * f.st) * p); alive(front).forEach((x) => { x.shield += s; }); return `щит строю ${s}`; }
      case 'stun': { if (r() < 0.35 * p) { state.stunned = true; return 'оглушает гиганта'; } return 'пытается оглушить — мимо'; }
      case 'bind': { state.bound += 1; return 'сковывает: гигант ударит на раз меньше'; }
      default: return '';
    }
  };

  let round = 0;
  let wiped = false;
  while (round < maxRounds) {
    round++;
    const state = { stunned: false, bound: 0 };
    const skillRound = SKILL_ROUNDS.has(round);

    // ауры начала раунда
    if (aura === 'ta_chto_prinosit_son' && alive(all).length) { const s = pick(r, alive(all)); s.skip = 1; log(`${s.name} засыпает.`, { actor: [s.row, s.i], kind: 'aura' }); }
    if (aura === 'tot_kto_darit_pesnyu' && alive(all).length) { const s = pick(r, alive(all)); s.skip = 1; log(`${s.name} подвывает гиганту и теряет ход.`, { actor: [s.row, s.i], kind: 'aura' }); }
    if (aura === 'tot_kto_derzhit_zemlyu' && round % 2 === 0) {
      const fell = alive(front).filter(() => r() < 0.3);
      fell.forEach((f) => { f.skip = 1; });
      if (fell.length) log(`Земля дрожит: падают ${fell.map((f) => f.name).join(', ')}.`, { kind: 'aura' });
    }

    // строй бьёт гиганта (по скорости)
    for (const f of alive(front).sort((a, c) => c.spd - a.spd)) {
      if (f.skip > 0) { f.skip--; continue; }
      if (aura === 'ta_chto_daet_teplo' && f.el === 'ice' && round % 2 === 0) { log(`${f.name} изнемогает от жара.`, { actor: ['front', f.i], kind: 'aura' }); continue; }
      const extra = (f.el === 'wind' ? el('wind') : 0) + (f.fam === 'birds' ? fam('birds') : 0);
      const turns = r() < extra ? 2 : 1;
      for (let t = 0; t < turns; t++) {
        const { d, isCrit } = strike(f, 1, round);
        let text = `${f.name} → ${d}${isCrit ? ' (крит!)' : ''}${f.el === giant.weak ? ' (слабость)' : ''}${t ? ' — второй ход' : ''}`;
        if (f.cls === 'catcher' && r() < 0.15 * f.eff) { state.stunned = true; text += ', гигант скован'; }
        if (f.cls === 'guide') {
          const low = lowest(front);
          if (low && low.hp < low.max) { low.hp = Math.min(low.max, low.hp + Math.round(4 * f.eff)); text += `, подлечивает ${low.name}`; }
        }
        log(text + '.', { actor: ['front', f.i], kind: 'hit' });
      }
      if (skillRound) log(`${f.name}: ${SKILLS[f.skill].name.toLowerCase()} — ${useSkill(f, round, state)}.`, { actor: ['front', f.i], kind: 'skill' });
    }

    // тыл поддерживает
    const backMult = (aura === 'tot_kto_vedet_v_puti' ? 0.6 : 1) * (1 + fam('rodents'));
    for (const f of alive(back)) {
      if (f.skip > 0) { f.skip--; continue; }
      if (aura === 'ta_chto_unosit_golosa' && r() < 0.5) continue;
      if (aura === 'ta_chto_daet_teplo' && f.el === 'ice' && round % 2 === 0) continue;
      const p = backMult * f.eff;
      if (f.cls === 'hunter') {
        const { d } = strike(f, 0.5 * backMult, round);
        log(`${f.name} стреляет из тыла: ${d}.`, { actor: ['back', f.i], kind: 'hit' });
      } else if (f.cls === 'guard') {
        const t = lowest(front);
        if (t) { const s = Math.round((3 + f.def / 2) * p); t.shield += s; log(`${f.name} прикрывает ${t.name}: щит ${s}.`, { actor: ['back', f.i], kind: 'buff' }); }
      } else if (f.cls === 'guide') {
        const t = lowest(front);
        if (t && t.hp < t.max) { const h = Math.round(t.max * 0.12 * p); t.hp = Math.min(t.max, t.hp + h); log(`${f.name} лечит ${t.name}: +${h}.`, { actor: ['back', f.i], kind: 'heal' }); }
      } else if (f.cls === 'catcher' && r() < 0.15 * p) {
        state.stunned = true;
        log(`${f.name} набрасывает сеть — гигант скован.`, { actor: ['back', f.i], kind: 'buff' });
      }
      if (skillRound) log(`${f.name}: ${SKILLS[f.skill].name.toLowerCase()} — ${useSkill(f, round, state)}.`, { actor: ['back', f.i], kind: 'skill' });
    }
    if (r() < cl('catcher')) state.stunned = true;
    if (el('fire') >= 1.5) dealt += el('fire') >= 1.8 ? 12 : 6;
    if (dot) dealt += dot;

    // гигант бьёт
    const power = giantPower(day) * (1 - el('ice') - fam('insectivores') - weaken);
    if (state.stunned) {
      log(`${giant.name} скован и не бьёт.`, { kind: 'aura' });
    } else {
      let hits = (day >= 3 ? 3 : 2) - state.bound;
      if (aura === 'tot_kto_sterezhet_mashiny' && round % 3 === 0) hits++;
      for (let h = 0; h < hits; h++) {
        if (!alive(front).length) break;
        const targets = alive(front).filter((f) => !kids.has(f.id));
        let t;
        if (h === 0 && aura === 'ta_chto_prinosit_dozhd') t = alive(all).filter((f) => !kids.has(f.id)).sort((a, c) => c.atk - a.atk)[0];
        if (!t) {
          if (!targets.length) { log(`${giant.name} не поднимает лапу на своих детей.`, { kind: 'aura' }); break; }
          const guards = targets.filter((f) => f.cls === 'guard');
          t = guards.length && r() < 0.6 ? pick(r, guards) : pick(r, targets);
        }
        if (r() < giantMiss) { log(`${giant.name} промахивается мимо ${t.name}.`, { target: [t.row, t.i], kind: 'miss' }); continue; }
        const text = hurt(t, power * (0.85 + r() * 0.3));
        if (thorns) dealt += thorns;
        log(`${giant.name} бьёт ${t.name}: ${text}${thorns ? `, шипы ранят гиганта на ${thorns}` : ''}.`, { target: [t.row, t.i], kind: 'hurt' });
      }
    }

    // гнев: дети гиганта в команде злят его быстрее
    wrath += 1 + alive(all).filter((f) => kids.has(f.id)).length;
    if (wrath >= wrathMax) {
      wrath = 0;
      const p = Math.round(giantPower(day) * 0.6 * (1 - weaken));
      alive(all).forEach((f) => hurt(f, p));
      log(`Гнев гиганта: ${giant.wrath || 'удар по всем'} — все получают урон.`, { kind: 'wrath' });
    }

    // конец раунда
    const heal = el('water');
    if (heal) alive(front).forEach((f) => { f.hp = Math.min(f.max, f.hp + heal); });
    if (fam('amphibians')) alive(all).forEach((f) => { f.hp = Math.min(f.max, f.hp + fam('amphibians')); });
    if (fam('fish')) alive(all).filter((f) => f.fam === 'fish').forEach((f) => { f.hp = Math.min(f.max, f.hp + fam('fish')); });
    if (fam('ungulates')) dealt += fam('ungulates');
    if (aura === 'tumannyy_los') alive(all).forEach((f) => { f.hp = Math.max(0, f.hp - 3); });
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
