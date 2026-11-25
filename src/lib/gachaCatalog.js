// Каталог персонажей: что есть в игре (src/gacha/*.json, обновляется скриптом
// scripts/gacha-catalog.mjs или руками) + свои персонажи игрока из Firestore.
// Отметки «есть у меня» хранятся в gachaRoster: owned = { id: { cons, note } }.
import { GAMES } from './gacha.js';
import { guideFor } from '../gacha/guides.js';
import upcoming from '../gacha/upcoming.json';

const loaders = {
  genshin: () => import('../gacha/genshin.json'),
  hsr: () => import('../gacha/hsr.json'),
  endfield: () => import('../gacha/endfield.json'),
};
const cache = {};
export function loadCatalog(game) {
  if (!cache[game]) cache[game] = loaders[game]().then((m) => withUpcoming(m.default || m, upcoming[game]));
  return cache[game];
}

// Анонсированные (src/gacha/upcoming.json, правится руками) — в начало списка,
// пока их нет в базе. Как только скрипт подтянет персонажа, анонс скрывается сам.
export function withUpcoming(base, soon = []) {
  const norm = (s) => String(s || '').toLowerCase().trim();
  const have = new Set(base.flatMap((c) => [norm(c.en), norm(c.name)]));
  return [...soon.filter((c) => !have.has(norm(c.en)) && !have.has(norm(c.name))), ...base];
}

// Подсказки имён при вводе круток: сначала нужной редкости, по совпадению
// с началом имени (рус. или англ.), потом по вхождению; при равенстве — новые выше.
export function nameHints(catalog, q, { r, top, limit = 6 } = {}) {
  const s = String(q || '').toLowerCase().trim();
  const pool = (catalog || []).filter((c) => c.r >= top - 1);
  const score = (c) => {
    const names = [c.name, c.en].map((x) => String(x || '').toLowerCase());
    let m = 0;
    if (s) {
      if (names.some((x) => x === s)) return -1; // уже вписано
      if (names.some((x) => x.startsWith(s) || x.split(/[\s-]/).some((w) => w.startsWith(s)))) m = 2;
      else if (names.some((x) => x.includes(s))) m = 1;
      else return -1;
    }
    return m * 2 + (r && c.r === Number(r) ? 1 : 0);
  };
  // свежие выше: анонсы, потом по дате выхода, без даты — что дописано позже
  const fresh = (x) => (x.c.soon ? 3e9 : x.c.rel || 0) * 1e4 + x.i;
  return pool.map((c, i) => ({ c, sc: score(c), i }))
    .filter((x) => x.sc >= 0)
    .sort((a, b) => b.sc - a.sc || fresh(b) - fresh(a))
    .slice(0, limit)
    .map((x) => x.c);
}

// Стихии: подпись и цвет кружка
export const ELEMENTS = {
  genshin: {
    Fire: ['Пиро', '#ef7a35'], Water: ['Гидро', '#4cc2f1'], Wind: ['Анемо', '#74c2a8'], Electric: ['Электро', '#af8ec1'],
    Grass: ['Дендро', '#a5c83b'], Ice: ['Крио', '#9fd6e3'], Rock: ['Гео', '#fab632'], Any: ['Любая', '#999'],
  },
  hsr: {
    Physical: ['Физический', '#c7c7c7'], Fire: ['Огненный', '#e62929'], Ice: ['Ледяной', '#47c7fd'], Thunder: ['Электрический', '#d376f0'],
    Wind: ['Ветряной', '#00ff9c'], Quantum: ['Квантовый', '#6f60e0'], Imaginary: ['Мнимый', '#f4d258'],
  },
  endfield: {
    Physical: ['Физический', '#c7c7c7'], Heat: ['Жар', '#ef7a35'], Cryo: ['Крио', '#7fd3f0'], Electric: ['Электро', '#e0c93c'], Nature: ['Природа', '#8cc63f'],
  },
};

export const WEAPONS = {
  SWORD_ONE_HAND: 'Одноручный меч', CLAYMORE: 'Двуручный меч', POLE: 'Древковое', BOW: 'Лук', CATALYST: 'Катализатор',
  Warrior: 'Разрушение', Rogue: 'Охота', Mage: 'Эрудиция', Shaman: 'Гармония', Warlock: 'Небытие', Knight: 'Сохранение',
  Priest: 'Изобилие', Memory: 'Память', Elation: 'Радость',
};

export const elementOf = (game, el) => ELEMENTS[game]?.[el] || (el ? [el, '#999'] : null);

// Каталог + свои персонажи, с отметками владения и подсказками.
export function mergeCatalog(game, base = [], custom = [], owned = {}) {
  const ids = new Set(base.map((c) => c.id));
  const all = [...base, ...custom.filter((c) => !ids.has(c.id)).map((c) => ({ ...c, custom: true }))];
  return all.map((c) => ({ ...c, own: owned[c.id] || null, guide: guideFor(game, c.en || c.name) }));
}

// Фильтр и сортировка списка
export function filterCatalog(list, { q = '', rarity = 'all', el = 'all', show = 'all' } = {}) {
  const s = q.trim().toLowerCase();
  return list.filter((c) => (
    (!s || c.name.toLowerCase().includes(s) || String(c.en || '').toLowerCase().includes(s))
    && (rarity === 'all' || String(c.r) === String(rarity))
    && (el === 'all' || c.el === el)
    && (show === 'all' || (show === 'own' ? !!c.own : !c.own))
  ));
}

// Ссылка на поиск гайда (у сайтов-гайдов нет стабильных адресов для всех героев)
export function guideLink(game, c) {
  // у Prydwen адреса Endfield совпадают с нашими id
  if (game === 'endfield' && !c.custom) return `https://www.prydwen.gg/arknights-endfield/characters/${c.id}`;
  const q = `${c.en || c.name} ${GAMES[game].name} build team guide`;
  return `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;
}

// Выпал персонаж из каталога — отмечаем «есть» или +1 к созвездию/эйдолону.
// Сопоставляем по русскому или английскому имени без регистра.
export function applyDrops(game, owned, catalog, drops) {
  const next = { ...owned };
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const changed = [];
  for (const d of drops) {
    if (d.k === 'w') continue;
    const c = catalog.find((x) => norm(x.name) === norm(d.n) || norm(x.en) === norm(d.n));
    if (!c) continue;
    const cur = next[c.id];
    if (!cur) { next[c.id] = { cons: 0 }; changed.push({ name: c.name, cons: 0, isNew: true }); }
    else {
      const cons = Math.min(GAMES[game].consMax, (cur.cons || 0) + 1);
      next[c.id] = { ...cur, cons };
      changed.push({ name: c.name, cons, isNew: false });
    }
  }
  return { owned: next, changed };
}

export function customChar({ name, r, el, img, d }) {
  return {
    id: 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name: name.trim(), en: '', r: Number(r) || 5, el: el || null, img: (img || '').trim(), d: (d || '').trim(),
  };
}
