#!/usr/bin/env node
// Обновить каталог персонажей Genshin и HSR из открытых баз Project Amber
// (gi.yatta.moe / sr.yatta.moe): русские имена, звёздность, стихия, оружие/путь,
// короткое описание и картинка. Запуск: `node scripts/gacha-catalog.mjs`.
// Пишет src/gacha/genshin.json и src/gacha/hsr.json.
// Endfield в этих базах нет — его каталог (src/gacha/endfield.json) правится руками.
// Анонсированных, которых в базах ещё нет, вписывай в src/gacha/upcoming.json:
// когда персонаж появится в базе, анонс скроется сам (сверка по имени).
// Советы по отрядам живут отдельно, в src/gacha/guides.js, и скрипт их не трогает.
import { writeFile } from 'node:fs/promises';

const OUT = new URL('../src/gacha/', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 0; ; i += 1) {
    try {
      const r = await fetch(url, { headers: { 'user-agent': 'gacha-catalog-script' } });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return (await r.json()).data;
    } catch (e) {
      if (i >= tries) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

// «\n», {NICKNAME}, {F#а}{M#} и прочая разметка игры → обычный текст
function clean(s) {
  return String(s || '')
    .replace(/\\n|\n/g, ' ')
    .replace(/\{NICKNAME\}/g, 'Первопроходец')
    .replace(/\{F#([^}]*)\}\{M#([^}]*)\}/g, '$2')
    .replace(/\{M#([^}]*)\}\{F#([^}]*)\}/g, '$1')
    .replace(/\{[FM]#[^}]*\}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function genshin() {
  const [ru, en] = await Promise.all([get('https://gi.yatta.moe/api/v2/ru/avatar'), get('https://gi.yatta.moe/api/v2/en/avatar')]);
  const out = [];
  let traveler = false;
  for (const [id, x] of Object.entries(ru.items)) {
    const isTraveler = id.startsWith('10000005') || id.startsWith('10000007');
    if (isTraveler) {
      if (traveler) continue;
      traveler = true;
    }
    let d = '';
    try {
      const full = await get(`https://gi.yatta.moe/api/v2/ru/avatar/${id}`);
      d = clean(full.fetter?.detail);
      await sleep(120);
    } catch (e) { console.warn('нет описания', id, e.message); }
    out.push({
      id: isTraveler ? 'traveler' : id,
      name: isTraveler ? 'Путешественник' : clean(x.name),
      en: isTraveler ? 'Traveler' : clean(en.items[id]?.name || x.name),
      r: x.rank === 105 ? 5 : x.rank, // 105 — «особые» 5★ (Алой)
      el: isTraveler ? 'Any' : x.element || null,
      w: x.weaponType?.replace('WEAPON_', '') || null,
      region: x.region || null,
      img: `https://gi.yatta.moe/assets/UI/${x.icon}.png`,
      d,
      rel: x.release || 0,
    });
  }
  return out.sort((a, b) => b.rel - a.rel);
}

async function hsr() {
  const [ru, en] = await Promise.all([get('https://sr.yatta.moe/api/v2/ru/avatar'), get('https://sr.yatta.moe/api/v2/en/avatar')]);
  const out = [];
  const paths = new Set();
  for (const [id, x] of Object.entries(ru.items)) {
    const path = x.types?.pathType;
    const isTb = id.startsWith('80');
    // Первопроходец: по одной карточке на путь (мальчик/девочка — одно и то же)
    if (isTb) {
      if (paths.has(path)) continue;
      paths.add(path);
    }
    let d = '';
    let pathRu = null;
    try {
      const full = await get(`https://sr.yatta.moe/api/v2/ru/avatar/${id}`);
      d = clean(full.fetter?.description);
      pathRu = full.types?.pathType?.name || null;
      await sleep(120);
    } catch (e) { console.warn('нет описания', id, e.message); }
    out.push({
      id: isTb ? `tb-${path}` : id,
      name: isTb ? `Первопроходец${pathRu ? ` · ${pathRu}` : ''}` : clean(x.name),
      en: isTb ? `Trailblazer (${path})` : clean(en.items[id]?.name || x.name),
      pathRu,
      r: x.rank,
      el: x.types?.combatType || null,
      w: path || null,
      img: `https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/icon/character/${id}.png`,
      d: isTb ? 'Главный герой: путешествует на Звёздном экспрессе и носит в себе Стелларон. Путь меняется по сюжету.' : d,
      rel: x.release || 0,
    });
  }
  // Одинаковые имена (Март 7 Сохранения и Охоты) — различаем по пути
  const seen = {};
  out.forEach((c) => { seen[c.name] = (seen[c.name] || 0) + 1; });
  out.forEach((c) => { if (seen[c.name] > 1 && !c.id.startsWith('tb-') && c.pathRu) { c.name += ` · ${c.pathRu}`; c.en += ` (${c.w})`; } });
  out.forEach((c) => { delete c.pathRu; });
  return out.sort((a, b) => b.rel - a.rel);
}

for (const [name, fn] of [['genshin', genshin], ['hsr', hsr]]) {
  const list = await fn();
  await writeFile(new URL(`${name}.json`, OUT), JSON.stringify(list, null, 0).replace(/\},\{/g, '},\n{') + '\n');
  console.log(`${name}: ${list.length} персонажей`);
}
