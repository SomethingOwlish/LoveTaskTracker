import { describe, it, expect } from 'vitest';
import { detectProduct, parsePrice, normCurrency, cleanProductTitle } from '../extension/src/shop';
import { buildWish } from '../src/lib/wishMath';

const sig = (o) => ({ url: '', canonical: '', docTitle: '', ogTitle: '', ogType: '', ogImage: '', h1: '', price: '', currency: '', ld: [], ...o });

describe('detectProduct', () => {
  it('JSON-LD Product с ценой', () => {
    expect(detectProduct(sig({
      url: 'https://www.ozon.ru/product/naushniki-sony-123456/?from=x#reviews',
      docTitle: 'Наушники Sony WH-1000XM5 купить по цене 29 990 ₽ в интернет-магазине OZON',
      ld: [{ '@type': 'Product', name: 'Наушники Sony WH-1000XM5', image: ['https://ir.ozone.ru/1.jpg'], offers: { '@type': 'Offer', price: '29990', priceCurrency: 'RUB' } }],
    }))).toEqual({
      title: 'Наушники Sony WH-1000XM5', price: 29990, currency: 'RUB', image: 'https://ir.ozone.ru/1.jpg',
      link: 'https://www.ozon.ru/product/naushniki-sony-123456/?from=x', source: 'ozon.ru', type: 'need',
    });
  });
  it('AggregateOffer в @graph — минимальная цена', () => {
    const p = detectProduct(sig({
      url: 'https://shop.example.rs/p/plед',
      ld: [{ '@graph': [{ '@type': 'WebPage' }, { '@type': 'Product', name: 'Pled', offers: { '@type': 'AggregateOffer', lowPrice: 3490, highPrice: 5000, priceCurrency: 'RSD' } }] }],
    }));
    expect(p).toMatchObject({ title: 'Pled', price: 3490, currency: 'RSD' });
  });
  it('магазин по адресу без разметки — название из заголовка, без цены', () => {
    const p = detectProduct(sig({ url: 'https://www.wildberries.ru/catalog/1234567/detail.aspx', ogTitle: 'Плед с совами — купить в интернет-магазине Wildberries' }));
    expect(p).toMatchObject({ title: 'Плед с совами', price: null, currency: null, source: 'wildberries.ru' });
  });
  it('мета-теги цены (og:type product)', () => {
    const p = detectProduct(sig({ url: 'https://x.com/item', ogType: 'product', ogTitle: 'Кружка', price: '12.50', currency: 'eur' }));
    expect(p).toMatchObject({ title: 'Кружка', price: 12.5, currency: 'EUR' });
  });
  it('Steam — тип «Для игр»', () => {
    const p = detectProduct(sig({ url: 'https://store.steampowered.com/app/1145350/Hades_II/', ogTitle: 'Save 20% on Hades II on Steam' }));
    expect(p).toMatchObject({ title: 'Hades II', type: 'games' });
  });
  it('обычная страница — не товар', () => {
    expect(detectProduct(sig({ url: 'https://habr.com/ru/articles/1/', ogType: 'article', ogTitle: 'Статья' }))).toBe(null);
    expect(detectProduct(sig({ url: 'https://www.ozon.ru/product/x/', docTitle: '404 — страница не найдена' }))).toBe(null);
  });
});

describe('цены и валюты', () => {
  it('parsePrice', () => {
    expect(parsePrice('1 299,90 ₽')).toBe(1299.9);
    expect(parsePrice('1.299,90')).toBe(1299.9);
    expect(parsePrice('1,299.90')).toBe(1299.9);
    expect(parsePrice('29 990')).toBe(29990);
    expect(parsePrice('3.490')).toBe(3490);
    expect(parsePrice('')).toBe(null);
    expect(parsePrice('бесплатно')).toBe(null);
  });
  it('normCurrency', () => {
    expect(normCurrency('RUR')).toBe('RUB');
    expect(normCurrency('₽')).toBe('RUB');
    expect(normCurrency('din.')).toBe('RSD');
    expect(normCurrency('usd')).toBe('USD');
    expect(normCurrency('рублей')).toBe(null);
  });
  it('cleanProductTitle', () => {
    expect(cleanProductTitle('Кружка | Магазин Посуды')).toBe('Кружка');
    expect(cleanProductTitle('Купить Кружку')).toBe('Кружку');
  });
  it('товар из расширения → документ вишлиста', () => {
    const w = buildWish({ title: 'Кружка', url: 'https://x.com/item', price: 12.5, currency: 'EUR', type: 'cute', ownerUid: 'me', image: 'https://x.com/i.jpg', source: 'x.com' });
    expect(w).toMatchObject({ title: 'Кружка', url: 'https://x.com/item', price: 12.5, currency: 'EUR', type: 'cute', image: 'https://x.com/i.jpg', source: 'x.com' });
    expect(buildWish({ title: 'a', image: 'javascript:alert(1)' }).image).toBe(null);
  });
});
