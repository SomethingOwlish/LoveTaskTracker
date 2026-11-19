// /api/gacha — прокси к истории круток (браузер напрямую не может: CORS).
// Одна страница за запрос: на бесплатном тарифе у воркера лимит 50 подзапросов,
// а история — это сотни страниц, поэтому листает браузер, с паузами.
//
// Хосты зашиты здесь, клиент присылает только параметры — так воркер нельзя
// использовать как открытый прокси. Ключи (authkey/токен) нигде не храним.

import { verifyFirebaseToken } from './media.js';

const HOYO = {
  genshin: {
    global: 'https://public-operation-hk4e-sg.hoyoverse.com/gacha_info/api/getGachaLog',
    cn: 'https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog',
  },
  hsr: {
    global: 'https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getGachaLog',
    cn: 'https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog',
  },
};
// Коллаб-прыжки HSR (21/22) отдаются отдельным методом
const HSR_COLLAB = {
  global: 'https://public-operation-hkrpg-sg.hoyoverse.com/common/gacha_record/api/getLdGachaLog',
  cn: 'https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getLdGachaLog',
};
const ENDFIELD = 'https://ef-webview.gryphline.com/api/record/char';

const KEEP = ['authkey_ver', 'sign_type', 'auth_appid', 'region', 'game_biz', 'device_type', 'plat_type', 'game_version', 'timestamp'];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function hoyoPage(body) {
  const { game, params = {}, type, endId } = body;
  if (!HOYO[game] || !params.authkey || !/^\d{1,3}$/.test(String(type))) return json({ error: 'bad_request' }, 400);
  const cn = /_cn$/.test(params.game_biz || '');
  const base = game === 'hsr' && ['21', '22'].includes(String(type)) ? HSR_COLLAB : HOYO[game];
  const u = new URL(cn ? base.cn : base.global);
  KEEP.forEach((k) => { if (params[k]) u.searchParams.set(k, String(params[k])); });
  if (!u.searchParams.has('authkey_ver')) u.searchParams.set('authkey_ver', '1');
  if (!u.searchParams.has('sign_type')) u.searchParams.set('sign_type', '2');
  if (!u.searchParams.has('auth_appid')) u.searchParams.set('auth_appid', 'webview_gacha');
  if (game === 'hsr' && !u.searchParams.has('game_biz')) u.searchParams.set('game_biz', 'hkrpg_global');
  u.searchParams.set('authkey', String(params.authkey));
  u.searchParams.set('lang', 'en'); // английские имена — по ним узнаём стандартных
  u.searchParams.set('gacha_type', String(type));
  if (game === 'genshin') u.searchParams.set('init_type', String(type));
  else u.searchParams.set('default_gacha_type', String(type));
  u.searchParams.set('page', '1');
  u.searchParams.set('size', '20');
  u.searchParams.set('end_id', /^\d+$/.test(String(endId || '')) ? String(endId) : '0');
  const r = await fetch(u);
  const j = await r.json().catch(() => null);
  if (!j) return json({ error: `upstream_${r.status}` }, 502);
  // retcode: 0 — ок, -101 — ссылка протухла, -100 — битая, -110 — слишком часто
  if (j.retcode !== 0) return json({ error: 'upstream', retcode: j.retcode, message: j.message });
  return json({ list: j.data?.list || [] });
}

async function endfieldPage(body) {
  const { params = {}, type, endId } = body;
  if (!params.token || !/^E_CharacterGachaPoolType_\w+$/.test(String(type))) return json({ error: 'bad_request' }, 400);
  const u = new URL(ENDFIELD);
  u.searchParams.set('server_id', /^\d+$/.test(String(params.server_id || '')) ? String(params.server_id) : '3');
  u.searchParams.set('pool_type', String(type));
  u.searchParams.set('lang', 'en-us');
  u.searchParams.set('token', String(params.token));
  if (/^\d+$/.test(String(endId || ''))) u.searchParams.set('seq_id', String(endId));
  const r = await fetch(u, { headers: { accept: 'application/json' } });
  const j = await r.json().catch(() => null);
  if (!j) return json({ error: `upstream_${r.status}` }, 502);
  if (j.code !== 0) return json({ error: 'upstream', retcode: j.code, message: j.msg || j.message });
  return json({ list: j.data?.list || [], hasMore: !!j.data?.hasMore });
}

export async function handleGacha(request) {
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  const token = (request.headers.get('authorization') || '').replace(/^Bearer /, '');
  if (!(await verifyFirebaseToken(token))) return json({ error: 'unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  if (!body) return json({ error: 'bad_request' }, 400);
  return body.game === 'endfield' ? endfieldPage(body) : hoyoPage(body);
}
