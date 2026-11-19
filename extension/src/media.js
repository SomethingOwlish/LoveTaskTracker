/* Распознавание фильма / сериала / игры на открытой странице.

   collectPageSignals — выполняется ВНУТРИ страницы (chrome.scripting.executeScript),
   поэтому самодостаточна: никаких внешних переменных и импортов.
   detectMedia — чистая функция: по собранным сигналам решает, что это за страница.

   Источники по убыванию доверия:
   1) правила для известных сайтов (тип — по адресу страницы);
   2) разметка schema.org в JSON-LD (Movie / TVSeries / VideoGame);
   3) og:type (video.movie / video.tv_show / video.episode). */

export function collectPageSignals() {
  const meta = (k) => document.querySelector(`meta[property="${k}"], meta[name="${k}"]`)?.content || '';
  const ld = [];
  document.querySelectorAll('script[type="application/ld+json"]').forEach((s) => {
    // Letterboxd и др. оборачивают JSON в /* <![CDATA[ */ … /* ]]> */
    const text = s.textContent.replace(/\/\*[\s\S]*?\*\//g, '');
    try { ld.push(JSON.parse(text)); } catch { /* битый JSON-LD — пропускаем */ }
  });
  return {
    url: location.href,
    canonical: document.querySelector('link[rel="canonical"]')?.href || meta('og:url') || '',
    docTitle: document.title || '',
    ogTitle: meta('og:title'),
    ogType: meta('og:type'),
    ogImage: meta('og:image') || meta('twitter:image'),
    h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 200),
    siteName: meta('og:site_name'),
    // цена товара из мета-тегов и микроразметки (для вишлиста, см. shop.js)
    price: meta('product:price:amount') || meta('og:price:amount')
      || document.querySelector('[itemprop="price"]')?.getAttribute('content')
      || document.querySelector('[itemprop="price"]')?.textContent?.trim()?.slice(0, 40) || '',
    currency: meta('product:price:currency') || meta('og:price:currency')
      || document.querySelector('[itemprop="priceCurrency"]')?.getAttribute('content') || '',
    ld,
  };
}

/* ---------- правила для сайтов ----------
   kind: 'movie' | 'series' | 'game' — тип известен по адресу;
   'auto' — страница точно про фильм/сериал, тип берём из разметки (по умолчанию movie). */
const SITES = [
  [/(^|\.)kinopoisk\.ru$/, (p) => (/^\/series\/\d+/.test(p) ? 'series' : /^\/film\/\d+/.test(p) ? 'movie' : null)],
  [/(^|\.)imdb\.com$/, (p) => (/^\/(\w{2}\/)?title\/tt\d+\/?$/.test(p) ? 'auto' : null)],
  [/(^|\.)letterboxd\.com$/, (p) => (/^\/film\/[^/]+\/?$/.test(p) ? 'movie' : null)],
  [/(^|\.)themoviedb\.org$/, (p) => (/^\/movie\/\d+/.test(p) ? 'movie' : /^\/tv\/\d+/.test(p) ? 'series' : null)],
  [/(^|\.)shikimori\.(one|me|io)$/, (p) => (/^\/animes\/\w+/.test(p) ? 'auto-series' : null)],
  [/(^|\.)myshows\.me$/, (p) => (/^\/view\/\d+/.test(p) ? 'series' : null)],
  [/^store\.steampowered\.com$/, (p) => (/^\/app\/\d+/.test(p) ? 'game' : null)],
  [/(^|\.)gog\.com$/, (p) => (/\/game\/[^/]+/.test(p) ? 'game' : null)],
  [/^store\.epicgames\.com$/, (p) => (/\/p\/[^/]+/.test(p) ? 'game' : null)],
  [/(^|\.)metacritic\.com$/, (p) => (/^\/game\/[^/]+/.test(p) ? 'game' : /^\/movie\/[^/]+/.test(p) ? 'movie' : /^\/tv\/[^/]+/.test(p) ? 'series' : null)],
  [/(^|\.)igdb\.com$/, (p) => (/^\/games\/[^/]+/.test(p) ? 'game' : null)],
  [/(^|\.)backloggd\.com$/, (p) => (/^\/games\/[^/]+/.test(p) ? 'game' : null)],
  [/^store\.playstation\.com$/, (p) => (/\/(concept|product)\/[^/]+/.test(p) ? 'game' : null)],
  [/(^|\.)xbox\.com$/, (p) => (/\/games\/store\//.test(p) ? 'game' : null)],
];

// Для меню правого клика — где показывать пункт «В Мурмур».
export const MURMUR_SITE_PATTERNS = [
  '*://*.kinopoisk.ru/*', '*://*.imdb.com/*', '*://letterboxd.com/*', '*://*.themoviedb.org/*',
  '*://shikimori.one/*', '*://shikimori.me/*', '*://shikimori.io/*', '*://myshows.me/*', '*://store.steampowered.com/*',
  '*://*.gog.com/*', '*://store.epicgames.com/*', '*://*.metacritic.com/*', '*://*.igdb.com/*',
  '*://*.backloggd.com/*', '*://store.playstation.com/*', '*://*.xbox.com/*',
  '*://*.ivi.ru/*', '*://okko.tv/*', '*://*.kion.ru/*', '*://*.netflix.com/*', '*://tv.apple.com/*',
];

const LD_KINDS = [[/VideoGame/, 'game'], [/TVSeries|TVSeason|TVEpisode/, 'series'], [/Movie/, 'movie']];
const OG_KINDS = { 'video.movie': 'movie', 'video.tv_show': 'series', 'video.episode': 'series' };

function flattenLd(list) {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    out.push(x);
    if (x['@graph']) walk(x['@graph']);
  };
  walk(list);
  return out;
}

function ldKind(node) {
  const t = [].concat(node['@type'] || []).join(' ');
  return LD_KINDS.find(([re]) => re.test(t))?.[1] || null;
}

function ldImage(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return ldImage(img[0]);
  return img.url || img.contentUrl || '';
}

function yearOf(s) {
  const m = String(s || '').match(/\b(18|19|20)\d{2}\b/);
  return m ? Number(m[0]) : null;
}

/* «Save 50% on Hades II on Steam» → «Hades II»,
   «Дюна (2021) — смотреть онлайн в хорошем качестве — Кинопоиск» → «Дюна (2021)»,
   «Dune: Part Two (2024) ⭐ 8.5 | Action, Adventure» → «Dune: Part Two (2024)». */
export function cleanMediaTitle(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(Save \d+% on |Сэкономьте \d+% при покупке |Скидка \d+% на )/i, '');
  t = t.replace(/ (on|в|на) Steam$/i, '');
  t = t.replace(/\s+(⭐|\|).*$/, '');
  t = t.replace(/\s+[—–-]\s+(смотреть|watch|buy|купить|скачать|download|play|играть)(?=\s|$).*$/i, '');
  // хвост с названием сайта: «… — Кинопоиск», «… | GOG.com»
  const site = t.match(/^(.{2,}?)\s+[—–|·-]\s+([^—–|·]{2,25})$/);
  if (site && /кинопоиск|imdb|letterboxd|tmdb|shikimori|шикимори|myshows|steam|gog|epic|metacritic|igdb|backloggd|playstation|xbox|ivi|okko|кион|kion|netflix|apple/i.test(site[2])) t = site[1];
  return t.trim();
}

// «Ведьмак (сериал, 2019 – 2023)» → { title: «Ведьмак», year: 2019 }
export function splitYear(title) {
  const m = title.match(/^(.*?)\s*\(([^()]*\b(?:18|19|20)\d{2}\b[^()]*)\)\s*$/);
  return m && m[1] ? { title: m[1].trim(), year: yearOf(m[2]) } : { title, year: null };
}

export function detectMedia(sig) {
  let url;
  try { url = new URL(sig.canonical || sig.url); } catch { return null; }
  let pageUrl;
  try { pageUrl = new URL(sig.url); } catch { pageUrl = url; }
  // canonical с другого сайта (бывает у зеркал) не берём
  if (url.hostname.replace(/^www\./, '') !== pageUrl.hostname.replace(/^www\./, '')) url = pageUrl;
  const host = pageUrl.hostname.replace(/^www\./, '');

  // страница «не найдено» по адресу фильма — не фильм
  if (/\b404\b|not found|не найден/i.test(`${sig.docTitle} ${sig.h1}`)) return null;

  const rule = SITES.find(([re]) => re.test(pageUrl.hostname));
  const siteKind = rule ? rule[1](pageUrl.pathname) : null;

  const node = flattenLd(sig.ld || []).find(ldKind);
  const fromLd = node ? ldKind(node) : null;
  const fromOg = OG_KINDS[sig.ogType] || null;

  let kind = siteKind && !siteKind.startsWith('auto') ? siteKind : (fromLd || fromOg);
  if (!kind && siteKind === 'auto') kind = 'movie';
  if (!kind && siteKind === 'auto-series') kind = 'series';
  if (!kind) return null;

  // у эпизода/сезона берём название сериала
  const series = node && /TVEpisode|TVSeason/.test([].concat(node['@type']).join(' ')) ? node.partOfSeries : null;
  const ldName = (series?.name || node?.name || '').trim();
  const rawTitle = ldName || sig.ogTitle || sig.h1 || sig.docTitle;
  const split = splitYear(cleanMediaTitle(rawTitle));
  if (!split.title) return null;

  const year = yearOf(node?.datePublished || node?.releaseDate || node?.startDate || node?.dateCreated || series?.startDate) || split.year;
  const poster = ldImage(node?.image) || sig.ogImage || '';

  url.hash = '';
  return {
    kind,
    title: split.title,
    year,
    poster: /^https?:\/\//.test(poster) ? poster : '',
    link: url.href,
    source: host,
  };
}
