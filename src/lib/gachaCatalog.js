// Каталог персонажей: что есть в игре (src/gacha/*.json, обновляется скриптом
// scripts/gacha-catalog.mjs или руками) + свои персонажи игрока из Firestore.
// Отметки «есть у меня» хранятся в gachaRoster: owned = { id: { cons, note } }.
import { GAMES } from './gacha.js';
import { guideFor } from '../gacha/guides.js';

const loaders = {
  genshin: () => import('../gacha/genshin.json'),
  hsr: () => import('../gacha/hsr.json'),
  endfield: () => import('../gacha/endfield.json'),
};
const cache = {};
export function loadCatalog(game) {
  if (!cache[game]) cache[game] = loaders[game]().then((m) => m.default || m);
  return cache[game];
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
