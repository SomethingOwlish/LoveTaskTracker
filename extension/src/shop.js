/* Распознавание товара для вишлиста.

   Сигналы страницы собирает collectPageSignals из media.js (одна инъекция на
   вкладку), здесь — чистая функция detectProduct: по ним решает, товар ли это,
   и достаёт название, цену, валюту и картинку.

   Источники по убыванию доверия:
   1) разметка schema.org Product в JSON-LD (её ставят почти все магазины);
   2) og:type product / мета-теги product:price:*, itemprop="price";
   3) правила для известных магазинов — по адресу карточки товара. */

const SHOPS = [
  [/(^|\.)ozon\.(ru|by|kz)$/, (p) => /^\/product\//.test(p)],
  [/(^|\.)wildberries\.(ru|by|kz|am|rs)$/, (p) => /^\/catalog\/\d+\/detail/.test(p)],
  [/^market\.yandex\.ru$/, (p) => /^\/(product|card)--?/.test(p)],
  [/(^|\.)aliexpress\.(com|ru|us)$/, (p) => /^\/item\/\d+/.test(p)],
  [/(^|\.)amazon\.[a-z.]+$/, (p) => /\/(dp|gp\/product)\/[A-Z0-9]{10}/.test(p)],
  [/(^|\.)ebay\.[a-z.]+$/, (p) => /^\/itm\//.test(p)],
  [/(^|\.)etsy\.com$/, (p) => /\/listing\/\d+/.test(p)],
  [/(^|\.)temu\.com$/, (p) => /-g-\d+\.html/.test(p)],
  [/(^|\.)ikea\.com$/, (p) => /\/p\/[^/]+/.test(p)],
  [/(^|\.)lamoda\.(ru|by|kz)$/, (p) => /^\/p\/[^/]+/.test(p)],
  [/(^|\.)dns-shop\.ru$/, (p) => /^\/product\//.test(p)],
  [/(^|\.)avito\.ru$/, (p) => /_\d{6,}$/.test(p)],
  [/(^|\.)kupujemprodajem\.com$/, (p) => /\/oglas\/|\/\d{6,}/.test(p)],
  [/(^|\.)gigatron\.rs$/, (p) => /\/[^/]+-\d+$/.test(p)],
  [/(^|\.)tehnomanija\.rs$/, (p) => /\/p\//.test(p)],
  [/(^|\.)idea\.rs$/, (p) => /\/proizvod\//.test(p)],
  // игровые магазины — сразу тип «Для игр»
  [/^store\.steampowered\.com$/, (p) => /^\/app\/\d+/.test(p), 'games'],
  [/(^|\.)gog\.com$/, (p) => /\/game\/[^/]+/.test(p), 'games'],
  [/^store\.epicgames\.com$/, (p) => /\/p\/[^/]+/.test(p), 'games'],
  [/^store\.playstation\.com$/, (p) => /\/(concept|product)\/[^/]+/.test(p), 'games'],
  [/(^|\.)xbox\.com$/, (p) => /\/games\/store\//.test(p), 'games'],
  [/(^|\.)nintendo\.com$/, (p) => /\/store\/products\//.test(p), 'games'],
];

const CUR_ALIASES = { RUR: 'RUB', '₽': 'RUB', 'РУБ': 'RUB', 'Р': 'RUB', '€': 'EUR', '$': 'USD', DIN: 'RSD', 'ДИН': 'RSD' };
export function normCurrency(c) {
  const v = String(c || '').trim().toUpperCase().replace(/\.$/, '');
  if (!v) return null;
  if (CUR_ALIASES[v]) return CUR_ALIASES[v];
  return /^[A-Z]{3}$/.test(v) ? v : null;
}

// «1 299,90 ₽» / «1.299,90» / «1,299.90» / 1299 → число; мусор — null.
export function parsePrice(raw) {
  if (typeof raw === 'number') return raw > 0 ? raw : null;
  let s = String(raw || '').replace(/[^\d.,]/g, '');
  if (!s) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  const dec = Math.max(lastDot, lastComma);
  // разделитель дробной части — последний, если за ним 1–2 цифры
  if (dec >= 0 && s.length - dec - 1 <= 2) {
    s = s.slice(0, dec).replace(/[.,]/g, '') + '.' + s.slice(dec + 1);
  } else {
    s = s.replace(/[.,]/g, '');
  }
  const v = Number(s);
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
}

function flattenLd(list) {
  const out = [];
  const walk = (x) => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    out.push(x);
    if (x['@graph']) walk(x['@graph']);
    if (x.mainEntity) walk(x.mainEntity);
  };
  walk(list);
  return out;
}
const isProduct = (n) => /\b(Product|ProductGroup|IndividualProduct|VideoGame|SoftwareApplication)\b/.test([].concat(n['@type'] || []).join(' ')) && n.offers;

function ldImage(img) {
  if (!img) return '';
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return ldImage(img[0]);
  return img.url || img.contentUrl || '';
}

// Цена из offers: одно предложение, список или AggregateOffer (берём минимальную).
function offerPrice(offers) {
  const list = [].concat(offers || []).flatMap((o) => (o?.offers ? [].concat(o.offers) : [o]));
  let best = null;
  list.forEach((o) => {
    if (!o) return;
    const p = parsePrice(o.price ?? o.lowPrice ?? o.priceSpecification?.price);
    if (p && (!best || p < best.price)) best = { price: p, currency: normCurrency(o.priceCurrency ?? o.priceSpecification?.priceCurrency) };
  });
  return best;
}

// «Наушники Sony WH-1000XM5 купить по цене 29 990 ₽ в интернет-магазине OZON» → «Наушники Sony WH-1000XM5»
export function cleanProductTitle(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(Save \d+% on |Купить )/i, '');
  t = t.replace(/\s*[—–|-]?\s*(купить|buy|kupi|cena|цена|price)(?=[\s,.:]|$).*$/i, '');
  t = t.replace(/ (on|в|на) Steam$/i, '');
  const site = t.match(/^(.{2,}?)\s+[—–|·:-]\s+([^—–|·:]{2,30})$/);
  if (site && /(ozon|wildberries|яндекс|market|aliexpress|amazon|ebay|etsy|temu|ikea|lamoda|dns|avito|kupujem|gigatron|tehnomanija|idea|steam|gog|epic|playstation|xbox|nintendo|shop|store|магазин)/i.test(site[2])) t = site[1];
  return t.trim().slice(0, 300);
}

export function detectProduct(sig) {
  let url;
  try { url = new URL(sig.url); } catch { return null; }
  if (/\b404\b|not found|не найден/i.test(`${sig.docTitle} ${sig.h1}`)) return null;

  const node = flattenLd(sig.ld || []).find(isProduct);
  const rule = SHOPS.find(([re, path]) => re.test(url.hostname) && path(url.pathname));
  const ogProduct = /^(og:)?product/i.test(sig.ogType || '');
  const metaPrice = parsePrice(sig.price);
  if (!node && !rule && !ogProduct && !metaPrice) return null;

  const fromLd = node ? offerPrice(node.offers) : null;
  const price = fromLd?.price || metaPrice || null;
  const currency = (fromLd?.price && fromLd.currency) || normCurrency(sig.currency) || null;
  const title = cleanProductTitle((node?.name || '').trim() || sig.ogTitle || sig.h1 || sig.docTitle);
  if (!title) return null;
  const image = ldImage(node?.image) || sig.ogImage || '';

  url.hash = '';
  return {
    title,
    price,
    currency,
    image: /^https?:\/\//.test(image) ? image : '',
    link: url.href,
    source: url.hostname.replace(/^www\./, ''),
    type: rule?.[2] || (node && /VideoGame/.test([].concat(node['@type']).join(' ')) ? 'games' : 'need'),
  };
}
