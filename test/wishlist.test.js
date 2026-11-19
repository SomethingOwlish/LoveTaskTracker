import { describe, it, expect } from 'vitest';
import { normalizeUrl, urlLabel, buildWish, filterWishes, wishTotal } from '../src/lib/wishMath.js';

describe('вишлист', () => {
  it('ссылка: без протокола дописывает https, мусор — null', () => {
    expect(normalizeUrl('ozon.ru/product/1')).toBe('https://ozon.ru/product/1');
    expect(normalizeUrl(' https://www.wildberries.ru/x ')).toBe('https://www.wildberries.ru/x');
    expect(normalizeUrl('')).toBe(null);
    expect(normalizeUrl('просто текст')).toBe(null);
    expect(urlLabel('https://www.wildberries.ru/x')).toBe('wildberries.ru');
  });
  it('хотелка: без названия — null, цена необязательна, тип по умолчанию «нужно»', () => {
    expect(buildWish({ title: '  ' })).toBe(null);
    const w = buildWish({ title: ' Плед ', price: '', type: 'nope', ownerUid: 'me', url: 'x.com' });
    expect(w).toMatchObject({ title: 'Плед', price: null, type: 'need', ownerUid: 'me', url: 'https://x.com/' });
    expect(buildWish({ title: 'a', price: 1500.555, type: 'cute' })).toMatchObject({ price: 1500.56, type: 'cute' });
  });
  it('общий список и по отдельности', () => {
    const list = [
      { id: 1, ownerUid: 'a', type: 'need' }, { id: 2, ownerUid: 'b', type: 'gift' }, { id: 3, ownerUid: 'a', type: 'gift' },
    ];
    expect(filterWishes(list).length).toBe(3);
    expect(filterWishes(list, { owner: 'a' }).map((w) => w.id)).toEqual([1, 3]);
    expect(filterWishes(list, { owner: 'a', type: 'gift' }).map((w) => w.id)).toEqual([3]);
    expect(filterWishes(list, { type: 'gift' }).map((w) => w.id)).toEqual([2, 3]);
  });
  it('сумма — в основной валюте, хотелки без цены считаются отдельно', () => {
    const fx = { rates: { EUR: 1, RSD: 100 } };
    const t = wishTotal([{ price: 10, currency: 'EUR' }, { price: 500, currency: 'RSD' }, { price: null }], 'RSD', fx);
    expect(t).toEqual({ sum: 1500, priced: 2, unpriced: 1 });
  });
});
