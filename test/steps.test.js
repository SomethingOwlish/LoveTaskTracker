import { describe, it, expect } from 'vitest';
import { stepCoins } from '../src/lib/steps.js';
import { rewardsFor } from '../src/game/engine.js';
import { parseStepsBody, dayIn, handleSteps } from '../worker/steps.js';

describe('монеты за шаги', () => {
  it('до 5 000 — 0, от 5 000 до 10 999 — 5, дальше +1 за тысячу', () => {
    expect(stepCoins(0)).toBe(0);
    expect(stepCoins(4999)).toBe(0);
    expect(stepCoins(5000)).toBe(5);
    expect(stepCoins(9999)).toBe(5);
    expect(stepCoins(10000)).toBe(5);
    expect(stepCoins(10999)).toBe(5);
    expect(stepCoins(11000)).toBe(6);
    expect(stepCoins(15500)).toBe(10);
    expect(stepCoins(undefined)).toBe(0);
  });
  it('в игре — только свои дни этой недели', () => {
    const steps = [
      { uid: 'me', day: '2026-11-23', steps: 12000 }, // 7
      { uid: 'me', day: '2026-11-24', steps: 6000 },  // 5
      { uid: 'me', day: '2026-11-22', steps: 20000 }, // прошлая неделя
      { uid: 'you', day: '2026-11-23', steps: 20000 },
      { uid: 'me', day: '2026-11-30', steps: 20000 }, // следующая
    ];
    const r = rewardsFor({ steps }, 'me', new Date(2026, 10, 23));
    expect(r.steps.coins).toBe(12);
    expect(r.steps.total).toBe(18000);
    expect(r.coins).toBe(12);
  });
});

describe('воркер /api/steps', () => {
  const key = 'abcdefghijklmnopqrstuvwxyz012345';
  it('разбор тела', () => {
    expect(parseStepsBody({ key, steps: 8532 }, '2026-11-20')).toEqual({ key, steps: 8532, day: '2026-11-20' });
    expect(parseStepsBody({ key, steps: '8 532,4' }, '2026-11-20').steps).toBe(8532);
    expect(parseStepsBody({ key, steps: '8532.7' }, '2026-11-20').steps).toBe(8532);
    expect(parseStepsBody({ key, steps: 100, date: '2026-11-18' }, '2026-11-20').day).toBe('2026-11-18');
    expect(parseStepsBody({ key, steps: 100, date: '2026-11-10' }, '2026-11-20').error).toBeTruthy();
    expect(parseStepsBody({ key, steps: 100, date: '2026-11-21' }, '2026-11-20').error).toBeTruthy();
    expect(parseStepsBody({ key: 'short', steps: 1 }, '2026-11-20').error).toBeTruthy();
    expect(parseStepsBody({ key, steps: -5 }, '2026-11-20').error).toBeTruthy();
    expect(parseStepsBody({ key, steps: 'много' }, '2026-11-20').error).toBeTruthy();
  });
  it('день — в часовом поясе Белграда', () => {
    expect(dayIn('Europe/Belgrade', new Date('2026-11-19T23:30:00Z'))).toBe('2026-11-20');
    expect(dayIn('Europe/Belgrade', new Date('2026-11-19T22:30:00Z'))).toBe('2026-11-19');
  });
  it('без POST и без сервисного ключа — понятная ошибка', async () => {
    const get = await handleSteps(new Request('https://x/api/steps'), {});
    expect(get.status).toBe(405);
    const noSa = await handleSteps(new Request('https://x/api/steps', { method: 'POST', body: '{}' }), {});
    expect(noSa.status).toBe(500);
  });
});

describe('воркер /api/steps — весь путь с подменённым Google', () => {
  it('подписывает JWT, находит ключ, пишет максимум за день', async () => {
    const kp = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', kp.privateKey));
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(String.fromCharCode(...der)).replace(/(.{64})/g, '$1\n')}\n-----END PRIVATE KEY-----\n`;
    const sa = { client_email: 'sa@tasktrackergando.iam.gserviceaccount.com', private_key: pem };
    const key = 'abcdefghijklmnopqrstuvwxyz012345';
    const store = { [`stepKeys/${key}`]: { uid: { stringValue: 'owl@example.com' } } };
    const calls = [];
    const orig = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
      calls.push([init.method || 'GET', String(url)]);
      if (String(url).startsWith('https://oauth2.googleapis.com/token')) {
        const jwt = new URLSearchParams(init.body).get('assertion');
        const [h, c, s] = jwt.split('.');
        const dec = (x) => Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
        const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', kp.publicKey, dec(s), new TextEncoder().encode(`${h}.${c}`));
        if (!ok) return new Response('bad sig', { status: 400 });
        return Response.json({ access_token: 'tok', expires_in: 3600 });
      }
      const path = decodeURIComponent(String(url).split('/documents/')[1].split('?')[0]);
      if (init.method === 'PATCH') { store[path] = JSON.parse(init.body).fields; return Response.json({}); }
      return store[path] ? Response.json({ fields: store[path] }) : new Response('', { status: 404 });
    };
    try {
      const env = { FIREBASE_SERVICE_ACCOUNT: JSON.stringify(sa) };
      const send = (steps, k = key) => handleSteps(new Request('https://x/api/steps', { method: 'POST', body: JSON.stringify({ key: k, steps }) }), env);
      const day = dayIn('Europe/Belgrade');
      const sendToday = (steps) => handleSteps(new Request('https://x/api/steps', { method: 'POST', body: JSON.stringify({ key, steps }) }), env);
      let r = await (await sendToday(12345)).json();
      expect(r).toMatchObject({ ok: true, day, steps: 12345, coins: 7 });
      r = await (await sendToday(8000)).json(); // меньше — остаётся максимум
      expect(r.steps).toBe(12345);
      expect(store[`steps/owl@example.com_${day}`].steps.integerValue).toBe('12345');
      const bad = await send(100, 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzz');
      expect(bad.status).toBe(403);
      expect(calls.filter(([, u]) => u.includes('oauth2')).length).toBe(1); // токен кэшируется
    } finally {
      globalThis.fetch = orig;
    }
  });
});
