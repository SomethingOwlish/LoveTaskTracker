// Firestore для гача-трекера. Экономим чтения:
//  • gacha/{email}_{игра} — маленькая сводка (pity, топ-дропы) — единственное,
//    что читается при открытии вкладки;
//  • gachaLog/… — вся история кусками, читается только при импорте, ручном
//    вводе и в «Истории целиком»;
//  • gachaRoster/{email}_{игра} — план развития и отряды, только в своих разделах.
import { db, auth } from '../firebase';
import {
  collection, doc, getDocs, setDoc, writeBatch, onSnapshot, query, where, serverTimestamp, deleteField,
} from 'firebase/firestore';
import { reportError } from './toast';
import { GAMES, summarize, chunkPulls, poolOf, mergePulls, fromHoyo, fromEndfield } from './gacha';

const key = (uid, game) => `${uid}_${game}`;

export function subscribeGachaSummary(uid, game, cb) {
  return onSnapshot(doc(db, 'gacha', key(uid, game)),
    (s) => cb(s.exists() ? s.data() : {}), (e) => { reportError(e); cb({}); });
}

export async function loadGachaLog(uid, game) {
  const snap = await getDocs(query(collection(db, 'gachaLog'), where('owner', '==', key(uid, game))));
  const pulls = [];
  const chunks = [];
  snap.docs.forEach((d) => { chunks.push(d.id); pulls.push(...(d.data().pulls || [])); });
  return { pulls: mergePulls([], pulls).pulls, chunks };
}

// Сохранить историю целиком (по копилкам и кускам) и пересчитать сводку.
export async function saveGachaLog(uid, game, pulls, oldChunks = [], extra = {}) {
  const owner = key(uid, game);
  const byPool = {};
  pulls.forEach((p) => { const k = poolOf(game, p.g) || 'other'; (byPool[k] = byPool[k] || []).push(p); });
  const batch = writeBatch(db);
  const ids = new Set();
  Object.entries(byPool).forEach(([pool, list]) => {
    chunkPulls(list).forEach((part, n) => {
      const id = `${owner}_${pool}_${n}`;
      ids.add(id);
      batch.set(doc(db, 'gachaLog', id), { uid, game, owner, pool, n, pulls: part, updatedAt: serverTimestamp() });
    });
  });
  oldChunks.filter((id) => !ids.has(id)).forEach((id) => batch.delete(doc(db, 'gachaLog', id)));
  batch.set(doc(db, 'gacha', owner), {
    uid, game, pools: summarize(game, pulls), total: pulls.reduce((s, p) => s + (p.c || 1), 0),
    updatedAt: serverTimestamp(), ...extra,
  }, { merge: true });
  await batch.commit();
}

// Поправки 50/50 и список стандартных
export function saveGachaMeta(uid, game, patch) {
  return setDoc(doc(db, 'gacha', key(uid, game)), { uid, game, ...patch }, { merge: true });
}
export function setGachaOverride(uid, game, id, value) {
  return saveGachaMeta(uid, game, { overrides: { [id]: value || deleteField() } });
}

// Ручная запись: дочитываем историю, добавляем, сохраняем.
export async function addManualPull(uid, game, rec) {
  const { pulls, chunks } = await loadGachaLog(uid, game);
  await saveGachaLog(uid, game, mergePulls(pulls, [rec]).pulls, chunks);
}
export async function removePull(uid, game, id) {
  const { pulls, chunks } = await loadGachaLog(uid, game);
  await saveGachaLog(uid, game, pulls.filter((p) => p.i !== id), chunks);
}

/* ---------------- Импорт через воркер ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function page(game, params, type, endId) {
  const token = await auth.currentUser?.getIdToken();
  const r = await fetch('/api/gacha', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ game, params, type, endId }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !j.error) throw new Error(`Сервер не ответил (${r.status})`);
  return j;
}

export class ExpiredLinkError extends Error {}

function upstreamError(game, j) {
  if (game === 'endfield') {
    if (j.retcode === 40100) return new ExpiredLinkError('Токен Endfield недействителен или протух — возьми новый');
    return new Error(`Endfield: ${j.message || j.retcode}`);
  }
  if (j.retcode === -101) return new ExpiredLinkError('Ссылка протухла (живёт ~сутки) — открой историю в игре и скопируй новую');
  if (j.retcode === -100) return new ExpiredLinkError('Ссылка битая — скопируй её заново');
  return new Error(`${GAMES[game].short}: ${j.message || j.retcode}`);
}

// Догружаем только новое: листаем от свежих к старым, пока не встретим
// уже сохранённую запись. onProgress({ type, label, found }).
export async function importGacha(uid, game, params, onProgress = () => {}) {
  const { pulls: existing, chunks } = await loadGachaLog(uid, game);
  const known = new Set(existing.map((p) => p.i));
  const incoming = [];
  const skipped = [];
  const g = GAMES[game];
  for (const type of g.query) {
    const pool = poolOf(game, type);
    let endId = '0';
    let tries = 0;
    for (let guard = 0; guard < 2000; guard += 1) {
      const j = await page(game, params, type, endId);
      if (j.error) {
        if (j.error === 'unauthorized') throw new Error('Нужно заново войти в приложение');
        if ((j.retcode === -110 || j.error.startsWith?.('upstream_')) && tries < 5) { tries += 1; await sleep(1500 * tries); continue; }
        const err = j.error === 'upstream' ? upstreamError(game, j) : new Error(j.error);
        // коллаб-прыжки HSR есть не у всех версий API — их пропускаем, а не валим импорт
        if (err instanceof ExpiredLinkError || !['21', '22'].includes(type)) throw err;
        skipped.push(g.pools[pool].label);
        break;
      }
      tries = 0;
      const list = j.list || [];
      if (!list.length) break;
      let stop = false;
      for (const x of list) {
        const rec = game === 'endfield' ? fromEndfield(x, type) : fromHoyo(x);
        if (known.has(rec.i)) { stop = true; break; }
        known.add(rec.i);
        incoming.push(rec);
      }
      onProgress({ type, label: g.pools[pool].label, found: incoming.length });
      if (stop) break;
      if (game === 'endfield') {
        if (!j.hasMore) break;
        endId = String(list[list.length - 1].seqId);
      } else {
        if (list.length < 20) break;
        endId = String(list[list.length - 1].id);
      }
      await sleep(game === 'endfield' ? 250 : 350); // API не любит частых запросов
    }
  }
  const merged = mergePulls(existing, incoming);
  await saveGachaLog(uid, game, merged.pulls, chunks, { lastImport: Date.now() });
  return { added: merged.added, total: merged.pulls.length, skipped };
}

/* ---------------- План развития и отряды ---------------- */

const EMPTY_ROSTER = { chars: [], teams: [], owned: {}, custom: [] };
export function subscribeRoster(uid, game, cb) {
  return onSnapshot(doc(db, 'gachaRoster', key(uid, game)),
    (s) => cb(s.exists() ? { ...EMPTY_ROSTER, ...s.data() } : { ...EMPTY_ROSTER }),
    (e) => { reportError(e); cb({ ...EMPTY_ROSTER }); });
}
// Пишем документ целиком: план, отряды, отметки «есть у меня» и свои персонажи.
export function saveRoster(uid, game, { chars = [], teams = [], owned = {}, custom = [] }) {
  return setDoc(doc(db, 'gachaRoster', key(uid, game)), { uid, game, chars, teams, owned, custom, updatedAt: serverTimestamp() });
}

/* ---------------- Сессии круток (ручной ввод) ---------------- */

export const RECENT_MAX = 30;
// Записи сессии → в историю; сама сессия → в «Последние крутки» в сводке.
export async function addSession(uid, game, records, session, recent = []) {
  const { pulls, chunks } = await loadGachaLog(uid, game);
  const next = [session, ...recent].slice(0, RECENT_MAX);
  await saveGachaLog(uid, game, mergePulls(pulls, records).pulls, chunks, { recent: next });
}
// Убрать сессию: и из списка, и её записи из истории.
export async function removeSession(uid, game, session, recent = []) {
  const ids = new Set(session.ids || []);
  const { pulls, chunks } = await loadGachaLog(uid, game);
  await saveGachaLog(uid, game, pulls.filter((p) => !ids.has(p.i)), chunks, { recent: recent.filter((s) => s.id !== session.id) });
}
