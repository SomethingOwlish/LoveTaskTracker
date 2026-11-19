// Приём шагов с iPhone (Быстрые команды → «Получить содержимое URL»).
//
//   POST /api/steps   {"key": "<личный ключ из приложения>", "steps": 8532, "date": "2026-11-20"?}
//
// Ключ создаётся в приложении (Профиль → Шаги с iPhone) и лежит в Firestore
// stepKeys/{key} = { uid }. Шаги пишутся в steps/{uid}_{день} = { uid, day, steps }.
// За день берём максимум из присланного: команду можно запускать сколько
// угодно раз, число только растёт.
//
// В Firestore пишем сервисным ключом (секрет FIREBASE_SERVICE_ACCOUNT воркера) —
// через REST, без SDK: подписываем JWT и меняем его на токен доступа.

import { stepCoins } from '../src/lib/steps.js';

const PROJECT = 'tasktrackergando';
const DOCS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const DEFAULT_TZ = 'Europe/Belgrade';
export const MAX_STEPS = 200000;
export const BACKFILL_DAYS = 3; // можно прислать за сегодня и три дня назад

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8' },
});

// Сегодняшний день в часовом поясе tz: «2026-11-20».
export function dayIn(tz, now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5);

// Разбор тела: Быстрые команды иногда шлют числа строкой и с пробелами.
export function parseStepsBody(body, today) {
  const key = String(body?.key || '').trim();
  if (!/^[a-z0-9]{20,64}$/.test(key)) return { error: 'Нет ключа или он не похож на ключ из приложения.' };
  // «8 532,4» (русская запись) и «8532.4»: пробелы — разделители тысяч, запятая — дробная часть
  const raw = typeof body.steps === 'number' ? body.steps : Number(String(body.steps ?? '').replace(/[\s\u00a0\u202f]/g, '').replace(',', '.'));
  if (!Number.isFinite(raw) || raw < 0 || raw > MAX_STEPS) return { error: 'Шаги — число от 0 до 200 000.' };
  let day = today;
  if (body.date) {
    day = String(body.date).trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { error: 'Дата — в виде 2026-11-20.' };
    const back = daysBetween(day, today);
    if (back < 0 || back > BACKFILL_DAYS) return { error: `Можно прислать только за сегодня и ${BACKFILL_DAYS} дня назад.` };
  }
  return { key, steps: Math.floor(raw), day };
}

/* ---------- токен доступа сервисного аккаунта ---------- */
let cached = null; // { token, exp }
const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64urlStr = (s) => b64url(new TextEncoder().encode(s));

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.exp - 60 > now) return cached.token;
  const head = b64urlStr(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64urlStr(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${claim}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${head}.${claim}.${b64url(sig)}` }),
  });
  if (!res.ok) throw new Error(`Google не выдал токен: ${res.status}`);
  const j = await res.json();
  cached = { token: j.access_token, exp: now + (j.expires_in || 3600) };
  return cached.token;
}

async function getDoc(token, path) {
  const res = await fetch(`${DOCS}/${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore: ${res.status}`);
  return (await res.json()).fields || {};
}

async function setDoc(token, path, fields) {
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&');
  const res = await fetch(`${DOCS}/${path}?${mask}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) throw new Error(`Firestore: ${res.status}`);
}


export async function handleSteps(request, env) {
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Шаги принимаются POST-запросом из Быстрых команд — инструкция в приложении: Профиль → Шаги с iPhone.' }, 405);
  }
  if (!env.FIREBASE_SERVICE_ACCOUNT) return json({ ok: false, error: 'На сервере не задан FIREBASE_SERVICE_ACCOUNT.' }, 500);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Тело запроса — JSON: {"key": "…", "steps": 1234}.' }, 400); }

  const today = dayIn(env.STEPS_TZ || DEFAULT_TZ);
  const p = parseStepsBody(body, today);
  if (p.error) return json({ ok: false, error: p.error }, 400);

  const token = await accessToken(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT));
  const keyDoc = await getDoc(token, `stepKeys/${p.key}`);
  const uid = keyDoc?.uid?.stringValue;
  if (!uid) return json({ ok: false, error: 'Ключ не найден — создай новый в приложении и вставь в команду.' }, 403);

  const id = encodeURIComponent(`${uid}_${p.day}`);
  const old = await getDoc(token, `steps/${id}`);
  const before = Number(old?.steps?.integerValue || 0);
  const steps = Math.max(before, p.steps);
  if (steps !== before || !old) {
    await setDoc(token, `steps/${id}`, {
      uid: { stringValue: uid },
      day: { stringValue: p.day },
      steps: { integerValue: String(steps) },
      updatedAt: { timestampValue: new Date().toISOString() },
    });
  }
  const coins = stepCoins(steps);
  return json({
    ok: true, day: p.day, steps, coins,
    message: `${steps.toLocaleString('ru-RU')} шагов за ${p.day.slice(8)}.${p.day.slice(5, 7)} — ${coins ? `+${coins} мон.` : 'до монет ещё ' + (5000 - steps).toLocaleString('ru-RU')}`,
  });
}
