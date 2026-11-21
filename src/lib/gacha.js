// Гача-трекер: чистая логика без Firebase и сети — разбор ссылок из игры,
// слияние истории круток без дублей, pity и 50/50. Покрыто тестами в test/gacha.test.js.
//
// Что умеем получить автоматически:
//  • Genshin Impact и Honkai: Star Rail — история круток по authkey-ссылке из кэша
//    игры (как paimon.moe / starrailstation). Ссылка живёт ~24 часа, API отдаёт
//    историю примерно за последние 6–12 месяцев, поэтому всё загруженное копим у себя.
//  • Arknights: Endfield — неофициально: токен с сайта SKPORT (книга записей),
//    API ef-webview.gryphline.com, только поиск персонажей. Оружие — вручную.
// Всё остальное (план развития, статы, отряды) вводится руками.

/* ---------------- Игры и баннеры ---------------- */

// pool — «копилка» pity: в Genshin 301 и 400 (два ивентовых баннера) делят
// один счётчик и гарант. query — какие gacha_type запрашивать у API.
export const GAMES = {
  genshin: {
    name: 'Genshin Impact', short: 'Genshin', top: 5, icon: 'fa-solid fa-wind',
    roll: 'молитва', cons: 'Созвездия', consMax: 6, gear: 'Артефакты',
    talents: ['Обычная атака', 'Навык', 'Взрыв стихии'], talentMax: 10, levelMax: 90,
    pools: {
      char: { label: 'Персонажи', types: ['301', '400'], hard: 90, soft: 74, fifty: 'char', guarantee: true },
      weapon: { label: 'Оружие', types: ['302'], hard: 80, soft: 63, fifty: 'weapon', guarantee: true },
      chronicled: { label: 'Хроники', types: ['500'], hard: 90, soft: 74 },
      standard: { label: 'Стандарт', types: ['200'], hard: 90, soft: 74 },
      beginner: { label: 'Новичок', types: ['100'], hard: 90, soft: 74 },
    },
    query: ['301', '302', '500', '200', '100'],
    // Стандартные 5★ — выпали на ивенте = проиграли 50/50 (75/25 у оружия).
    std: {
      char: ['Diluc', 'Jean', 'Keqing', 'Mona', 'Qiqi', 'Tighnari', 'Dehya', 'Yumemizuki Mizuki'],
      weapon: ['Amos\' Bow', 'Skyward Harp', 'Lost Prayer to the Sacred Winds', 'Skyward Atlas', 'Aquila Favonia',
        'Skyward Blade', 'Wolf\'s Gravestone', 'Skyward Pride', 'Primordial Jade Winged-Spear', 'Skyward Spine'],
    },
  },
  hsr: {
    name: 'Honkai: Star Rail', short: 'HSR', top: 5, icon: 'fa-solid fa-train',
    roll: 'прыжок', cons: 'Эйдолоны', consMax: 6, gear: 'Реликвии',
    talents: ['Базовая атака', 'Навык', 'Суперспособность', 'Талант'], talentMax: 10, levelMax: 80,
    pools: {
      char: { label: 'Персонажи', types: ['11'], hard: 90, soft: 74, fifty: 'char', guarantee: true },
      weapon: { label: 'Конусы', types: ['12'], hard: 80, soft: 66, fifty: 'weapon', guarantee: true },
      collabChar: { label: 'Коллаб: персонажи', types: ['21'], hard: 90, soft: 74, fifty: 'char', guarantee: true },
      collabWeapon: { label: 'Коллаб: конусы', types: ['22'], hard: 80, soft: 66, fifty: 'weapon', guarantee: true },
      standard: { label: 'Стандарт', types: ['1'], hard: 90, soft: 74 },
      beginner: { label: 'Новичок', types: ['2'], hard: 50, soft: 50 },
    },
    query: ['11', '12', '21', '22', '1', '2'],
    std: {
      char: ['Himeko', 'Welt', 'Bronya', 'Gepard', 'Clara', 'Yanqing', 'Bailu'],
      weapon: ['Night on the Milky Way', 'In the Name of the World', 'Something Irreplaceable',
        'But the Battle Isn\'t Over', 'Time Waits for No One', 'Sleep Like the Dead', 'Moment of Victory'],
    },
  },
  endfield: {
    name: 'Arknights: Endfield', short: 'Endfield', top: 6, icon: 'fa-solid fa-industry',
    roll: 'поиск', cons: 'Потенциал', consMax: 5, gear: 'Снаряжение',
    talents: ['Базовая атака', 'Боевой навык', 'Комбо-навык', 'Ультимейт'], talentMax: 12, levelMax: 90,
    pools: {
      // В Endfield гаранта после проигрыша нет: каждый 6★ — монетка 50/50,
      // зато за 120 круток на одном баннере выдают его персонажа (разово).
      char: { label: 'Особый поиск', types: ['E_CharacterGachaPoolType_Special'], hard: 80, soft: 65, fifty: 'char', guarantee: false, spark: 120 },
      weapon: { label: 'Арсенал (вручную)', types: ['weapon'], hard: 80, soft: 80, manualOnly: true },
      standard: { label: 'Базовый поиск', types: ['E_CharacterGachaPoolType_Standard'], hard: 80, soft: 65 },
      beginner: { label: 'Новичок', types: ['E_CharacterGachaPoolType_Beginner'], hard: 80, soft: 65 },
    },
    query: ['E_CharacterGachaPoolType_Special', 'E_CharacterGachaPoolType_Standard', 'E_CharacterGachaPoolType_Beginner'],
    // Список стандартных 6★ надёжно проверить не удалось — заполняется в настройках.
    std: { char: [], weapon: [] },
  },
};

export const GAME_KEYS = Object.keys(GAMES);

// gacha_type → ключ копилки
export function poolOf(game, type) {
  const pools = GAMES[game].pools;
  return Object.keys(pools).find((k) => pools[k].types.includes(String(type))) || null;
}

/* ---------------- Разбор ссылки / токена ---------------- */

// Достаём параметр без URLSearchParams: в authkey бывают «+» и «/», и если
// ссылку вставили недокодированной, URLSearchParams превратит «+» в пробел.
function rawParam(text, name) {
  const m = new RegExp(`[?&#]${name}=([^&#\\s]*)`).exec(text);
  if (!m) return null;
  try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

// Параметры, которые пересылаем в API HoYoverse как есть (остальное воркер ставит сам).
const HOYO_KEEP = ['authkey_ver', 'sign_type', 'auth_appid', 'region', 'game_biz', 'device_type', 'plat_type', 'game_version', 'timestamp'];

// Текст из буфера (ссылка, кусок лога, токен) → что импортировать.
// Возвращает { game, params } или { error }.
export function parseImportLink(text, hint) {
  const s = String(text || '').trim();
  if (!s) return { error: 'Пусто — вставь ссылку' };

  // Endfield: ссылка ef-webview с token/u8_token или голый токен
  const efToken = rawParam(s, 'u8_token') || rawParam(s, 'token');
  if (/gryphline|endfield|skport/i.test(s) || (hint === 'endfield' && !/authkey=/.test(s))) {
    let token = efToken || s;
    // из sessionStorage APP_ROLE_U8_TOKEN приходит «токен:что-то» — нужна часть до двоеточия
    if (!efToken && token.includes(':')) token = token.split(':')[0];
    token = token.replace(/^["']|["']$/g, '').trim();
    if (!/^[\w\-+/=.%]{16,}$/.test(token)) return { error: 'Не похоже на токен Endfield' };
    const server = rawParam(s, 'server_id') || rawParam(s, 'server');
    return { game: 'endfield', params: { token, ...(server ? { server_id: server } : {}) } };
  }

  const authkey = rawParam(s, 'authkey');
  if (!authkey) return { error: 'В ссылке нет authkey — скопируй ссылку на историю целиком' };
  const params = { authkey };
  HOYO_KEEP.forEach((k) => { const v = rawParam(s, k); if (v != null && v !== '') params[k] = v; });

  let game = null;
  const biz = params.game_biz || '';
  if (/^hk4e/.test(biz) || /hk4e|genshin|e20190909gacha/i.test(s)) game = 'genshin';
  else if (/^hkrpg/.test(biz) || /hkrpg|starrail|gacha_record/i.test(s)) game = 'hsr';
  else if (hint === 'genshin' || hint === 'hsr') game = hint;
  if (!game) return { error: 'Не понял, от какой игры ссылка' };
  if (hint && hint !== game) return { error: `Это ссылка от ${GAMES[game].short}, а выбрана ${GAMES[hint].short}` };
  return { game, params };
}

/* ---------------- Записи круток ---------------- */

// Компактная запись (в Firestore храним тысячи таких):
// { i: id, t: 'YYYY-MM-DD HH:mm:ss', n: имя, r: редкость, k: 'c'|'w', g: gacha_type,
//   b?: баннер (Endfield), f?: бесплатная, c?: сколько круток представляет запись (ручной ввод) }

export function fromHoyo(x) {
  return {
    i: String(x.id), t: x.time, n: x.name, r: Number(x.rank_type),
    k: /weapon|light cone|оруж|конус/i.test(x.item_type || '') ? 'w' : 'c',
    g: String(x.gacha_type),
  };
}

export function fromEndfield(x, poolType) {
  const ts = Number(x.gachaTs);
  const rec = {
    i: String(x.seqId), t: ts ? fmtTime(new Date(ts > 1e12 ? ts : ts * 1000)) : '', n: x.charName || x.weaponName || '?',
    r: Number(x.rarity), k: x.weaponName ? 'w' : 'c', g: poolType,
  };
  if (x.poolName) rec.b = x.poolName;
  if (x.isFree) rec.f = true;
  return rec;
}

const pad = (n) => String(n).padStart(2, '0');
export function fmtTime(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// id из API — большие числа строкой: сравниваем по длине, потом посимвольно.
// Ручные записи («m…») идут после числовых с тем же временем.
export function cmpId(a, b) {
  const ma = a[0] === 'm', mb = b[0] === 'm';
  if (ma !== mb) return ma ? 1 : -1;
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}
export function cmpPull(a, b) {
  if (a.t !== b.t) return a.t < b.t ? -1 : 1;
  return cmpId(a.i, b.i);
}

// Слить старое и новое без дублей (по id), по порядку от старых к новым.
export function mergePulls(existing, incoming) {
  const map = new Map();
  (existing || []).forEach((p) => map.set(p.i, p));
  let added = 0;
  (incoming || []).forEach((p) => { if (!map.has(p.i)) { map.set(p.i, p); added += 1; } });
  return { pulls: [...map.values()].sort(cmpPull), added };
}

/* ---------------- Pity ---------------- */

// Сводка по одной копилке: pity каждого топ-дропа, текущий счётчик.
// pulls — уже отсортированы от старых к новым.
export function poolSummary(pulls, top = 5) {
  let pity = 0, pity4 = 0, total = 0;
  const tops = [];
  for (const p of pulls) {
    const c = p.c || 1;
    pity += c; pity4 += c; total += c;
    if (p.r >= top) {
      tops.push({ i: p.i, n: p.n, t: p.t, p: pity, k: p.k, ...(p.b ? { b: p.b } : {}) });
      pity = 0; pity4 = 0;
    } else if (p.r === top - 1) {
      pity4 = 0;
    }
  }
  return { total, pity, pity4, tops };
}

// Все записи игры → { poolKey: сводка }
export function summarize(game, pulls) {
  const g = GAMES[game];
  const by = {};
  for (const p of pulls) {
    const k = poolOf(game, p.g);
    if (k) (by[k] = by[k] || []).push(p);
  }
  const out = {};
  for (const k of Object.keys(by)) {
    const list = by[k].sort(cmpPull);
    out[k] = poolSummary(list, g.top);
    // Endfield: сколько круток на текущем баннере (к разовому гаранту 120)
    if (g.pools[k].spark) {
      const last = list[list.length - 1]?.b;
      if (last) out[k].banner = { name: last, pulls: list.filter((p) => p.b === last).reduce((s, p) => s + (p.c || 1), 0) };
    }
  }
  return out;
}

/* ---------------- 50/50 ---------------- */

// Разметка топ-дропов ивентовой копилки: 'won' — выиграли 50/50,
// 'lost' — выпал стандартный, 'guar' — пришёл по гаранту после проигрыша.
// stdNames — стандартные имена; overrides — ручные поправки { id: 'won'|'lost' }.
export function classifyTops(tops, { stdNames = [], guarantee = true, overrides = {} } = {}) {
  const std = new Set(stdNames.map((n) => n.toLowerCase().trim()));
  let guaranteed = false;
  let won = 0, lost = 0, guar = 0;
  const list = tops.map((t) => {
    const ov = overrides[t.i];
    const isStd = ov ? ov === 'lost' : std.has(String(t.n).toLowerCase().trim());
    let res;
    if (isStd) { res = 'lost'; lost += 1; guaranteed = guarantee; }
    else if (guaranteed) { res = 'guar'; guar += 1; guaranteed = false; }
    else { res = 'won'; won += 1; }
    return { ...t, res };
  });
  const tries = won + lost;
  return { list, won, lost, guar, guaranteed, rate: tries ? won / tries : null };
}

// Средний pity и удача: сколько в среднем круток на топ-дроп
export function avgPity(tops) {
  if (!tops.length) return null;
  return tops.reduce((s, t) => s + t.p, 0) / tops.length;
}

// Цвет pity: рано / обычно / почти на гаранте
export function pityTone(p, pool) {
  if (p <= Math.round(pool.soft * 0.6)) return 'good';
  if (p < pool.soft) return 'ok';
  return 'bad';
}

/* ---------------- Ручной ввод ---------------- */

// Ручной топ-дроп «на крутке №N»: запись должна покрыть недостающие крутки
// после уже учтённых. Возвращает запись или { error }.
export function manualTop({ game, pool, name, at, currentPity, time, kind = 'c', rarity }) {
  const g = GAMES[game];
  const n = Number(at);
  if (!Number.isInteger(n) || n < 1 || n > g.pools[pool].hard) return { error: `Номер крутки — от 1 до ${g.pools[pool].hard}` };
  if (n <= currentPity) return { error: `Уже учтено ${currentPity} круток без топ-дропа — номер должен быть больше` };
  return { i: 'm' + Date.now(), t: time || fmtTime(), n: (name || '?').trim(), r: rarity || g.top, k: kind, g: g.pools[pool].types[0], c: n - currentPity };
}

// «Сделали N круток без топ-дропа»
export function manualFiller({ game, pool, count, time }) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: 'Сколько круток — от 1 до 1000' };
  return { i: 'm' + Date.now(), t: time || fmtTime(), n: '', r: 3, k: 'c', g: GAMES[game].pools[pool].types[0], c: n };
}

/* ---------------- Хранение кусками ---------------- */

// Firestore: документ ≤ 1 МБ. Режем историю копилки на куски по CHUNK записей.
export const CHUNK = 2500;
export function chunkPulls(pulls, size = CHUNK) {
  const out = [];
  for (let i = 0; i < pulls.length; i += size) out.push(pulls.slice(i, i + size));
  return out.length ? out : [[]];
}

/* ---------------- Сессия круток ---------------- */

// «Открутила N раз, выпало вот это» → записи истории в правильном порядке,
// чтобы pity считался верно. drops: [{ n, r, k, at? }] — at: номер крутки
// внутри сессии (1..N); без номера редкие ставим в конец сессии.
// Подряд идущие «пустые» крутки сжимаются в одну запись с c = сколько.
export function sessionRecords({ game, pool, count, drops = [], time, base = Date.now() }) {
  const g = GAMES[game];
  const P = g.pools[pool];
  if (!P) return { error: 'Нет такого баннера' };
  const n = Number(count);
  if (!Number.isInteger(n) || n < 1 || n > 1000) return { error: 'Сколько круток — от 1 до 1000' };
  const list = drops.filter((d) => d && String(d.n || '').trim());
  if (list.length > n) return { error: `Выпало больше (${list.length}), чем круток (${n})` };
  const at = new Map();
  for (const d of list) {
    const p = Number(d.at);
    if (d.at === '' || d.at == null) continue;
    if (!Number.isInteger(p) || p < 1 || p > n) return { error: `Номер крутки у «${d.n}» — от 1 до ${n}` };
    if (at.has(p)) return { error: `Две награды на крутке №${p}` };
    at.set(p, d);
  }
  // без номера — с конца, на свободные места
  let free = n;
  for (const d of list) {
    if (d.at !== '' && d.at != null) continue;
    while (at.has(free)) free -= 1;
    at.set(free, d);
  }
  const type = P.types[0];
  const t = time || fmtTime();
  const out = [];
  let gap = 0;
  const id = () => `m${base}${String(out.length).padStart(3, '0')}`;
  const flush = () => { if (gap) { out.push({ i: id(), t, n: '', r: 3, k: 'c', g: type, c: gap }); gap = 0; } };
  for (let p = 1; p <= n; p += 1) {
    const d = at.get(p);
    if (!d) { gap += 1; continue; }
    flush();
    out.push({ i: id(), t, n: String(d.n).trim(), r: Number(d.r) || g.top - 1, k: d.k === 'w' ? 'w' : 'c', g: type, c: 1 });
  }
  flush();
  return { records: out };
}

// Сколько топ-дропов и на какой крутке (общий pity) они выпадут после сессии.
export function sessionPreview(records, currentPity, top) {
  let pity = currentPity;
  const tops = [];
  for (const r of records) {
    pity += r.c || 1;
    if (r.r >= top) { tops.push({ n: r.n, p: pity }); pity = 0; }
  }
  return { tops, pityAfter: pity };
}
