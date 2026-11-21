// Рассылка push-напоминаний. Запускает workflow .github/workflows/push-reminders.yml:
// его дёргает воркер Cloudflare каждые 15 минут (cron в wrangler.jsonc), а
// собственное расписание GitHub — запасное (оно срабатывает нерегулярно). Читает Firestore сервисным ключом
// (секрет FIREBASE_SERVICE_ACCOUNT) и шлёт Web Push (секрет VAPID_PRIVATE_KEY).
//
// Что шлём (каждый настраивает у себя в Профиле → «Уведомления на телефон»):
//  • события от партнёра: поставил(а) задачу, комментарий, сердечко;
//  • «посмотрели — поставь оценку» в Мурмуре;
//  • утренняя сводка: задачи на сегодня, просроченные, платежи по плану;
//  • за час до дедлайна (если у задачи указано время, а не «конец дня»);
//  • вечером — «как прошёл день?», если настроение не отмечено.
import admin from 'firebase-admin';
import webpush from 'web-push';

const SA = process.env.FIREBASE_SERVICE_ACCOUNT;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const APP_URL = process.env.APP_URL || 'https://lovetasktracker.argentummortis.workers.dev/';
const DRY = process.env.DRY_RUN === '1';

if (!SA || !VAPID_PRIVATE || !VAPID_PUBLIC) {
  console.log('Секреты не заданы (FIREBASE_SERVICE_ACCOUNT / VAPID_PRIVATE_KEY / VAPID_PUBLIC_KEY) — пропускаю.');
  process.exit(0);
}

admin.initializeApp({ credential: admin.credential.cert(JSON.parse(SA)) });
const db = admin.firestore();
// subject — настоящий адрес: push-сервис Apple отвечает 403 (BadJwtToken) на
// выдуманный mailto:…invalid, из-за этого уведомления на iPhone не доходили.
webpush.setVapidDetails(new URL(APP_URL).origin, VAPID_PUBLIC, VAPID_PRIVATE);

const NAMES = { 'argentummortis@gmail.com': 'Совушка', 'arentakasi@gmail.com': 'Гусик' };
const DEFAULT_PREFS = { events: true, digest: true, deadlines: true, mood: true, digestTime: '09:00', moodTime: '21:00', tz: 'Europe/Belgrade' };
const ACTIVE = ['open', 'in_progress', 'returned', 'in_review'];

const now = Date.now();
const stateRef = db.doc('pushState/cron');
const state = (await stateRef.get()).data() || {};
// Окно с прошлого запуска. GitHub запускает расписание нерегулярно (бывало
// раз в 6–8 часов), поэтому окно — до суток: события партнёра не теряются.
const from = Math.max(state.lastRun || now - 15 * 60000, now - 24 * 3600000);
// что уже отправлено: { digest: {uid: 'YYYY-MM-DD'}, mood: {...}, dl: {taskId: срок} }
const sentDigest = { ...(state.sentDigest || {}) };
const sentMood = { ...(state.sentMood || {}) };
const sentDl = Object.fromEntries(Object.entries(state.sentDl || {}).filter(([, ms]) => ms > now - 86400000));
const ts = (ms) => admin.firestore.Timestamp.fromMillis(ms);

// --- подписки и настройки ---
const subsSnap = await db.collection('pushSubs').get();
const subsByUid = {};
subsSnap.docs.forEach((d) => { (subsByUid[d.data().uid] ||= []).push(d); });
const uids = Object.keys(subsByUid);
if (!uids.length) { await stateRef.set({ lastRun: now }); console.log('Нет подписок'); process.exit(0); }

const prefs = {};
for (const uid of uids) {
  const st = (await db.doc(`userState/${uid}`).get()).data() || {};
  prefs[uid] = { ...DEFAULT_PREFS, ...(st.push || {}) };
}

// Локальное время пользователя: { key: 'YYYY-MM-DD', min: минута суток }
function local(ms, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { key: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const hm = (s) => { const [h, m] = (s || '0:0').split(':').map(Number); return h * 60 + m; };
// «Время T сегодня уже наступило, но не позже чем на lateMin, и сегодня ещё
// не слали». Не зависит от того, когда был прошлый запуск.
function due(timeStr, tz, sent, uid, lateMin) {
  const b = local(now, tz); const t = hm(timeStr);
  return sent[uid] !== b.key && b.min >= t && b.min - t <= lateMin;
}

const outbox = []; // { uid, title, body, url, tag }
const push = (uid, title, body, url = APP_URL, tag) => { if (subsByUid[uid]) outbox.push({ uid, title, body, url, tag }); };

// --- 1. события от партнёра ---
const VERB = { assigned: 'поставил(а) задачу', comment: 'написал(а) комментарий', like: 'оценил(а) ♥' };
const notifs = await db.collection('notifications').where('createdAt', '>', ts(from)).where('createdAt', '<=', ts(now)).get();
notifs.docs.forEach((d) => {
  const n = d.data();
  if (!prefs[n.recipientUid]?.events) return;
  const who = NAMES[n.actorUid] || 'Партнёр';
  push(n.recipientUid, `${who} ${VERB[n.type] || ''}`.trim(), n.type === 'comment' && n.text ? `«${n.taskTitle}»: ${n.text}` : `«${n.taskTitle}»`, APP_URL, `n-${d.id}`);
});

// --- 2. Мурмур: партнёр отметил просмотренным ---
const watched = await db.collection('murmur').where('doneAt', '>', ts(from)).where('doneAt', '<=', ts(now)).get();
watched.docs.forEach((d) => {
  const m = d.data();
  Object.keys(NAMES).forEach((uid) => {
    if (uid === m.doneBy || m.ratings?.[uid] != null || !prefs[uid]?.events) return;
    push(uid, `${NAMES[m.doneBy] || 'Партнёр'}: «${m.title}» — готово`, 'Поставь свою оценку', `${APP_URL}?tab=murmur`, `m-${d.id}`);
  });
});

// --- 3. утренняя сводка, 4. дедлайны, 5. настроение ---
// сводку — до 5 часов позже назначенного, настроение — до конца дня
const needDigest = uids.filter((u) => prefs[u].digest && due(prefs[u].digestTime, prefs[u].tz, sentDigest, u, 5 * 60));
const needMood = uids.filter((u) => prefs[u].mood && due(prefs[u].moodTime, prefs[u].tz, sentMood, u, 24 * 60));
const needDeadlines = uids.filter((u) => prefs[u].deadlines);

let active = [];
if (needDigest.length || needDeadlines.length) {
  const snap = await db.collection('tasks').where('status', 'in', ACTIVE).get();
  active = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

if (needDigest.length) {
  // запланированные платежи на сегодня — общие для обоих
  const plannedSnap = await db.collection('budgetTx').where('planned', '==', true).get();
  for (const uid of needDigest) {
    const tz = prefs[uid].tz;
    const today = local(now, tz).key;
    const mine = active.filter((t) => t.assigneeUid === uid && t.deadline);
    const todayN = mine.filter((t) => local(t.deadline.toMillis(), tz).key === today).length;
    const overdue = mine.filter((t) => local(t.deadline.toMillis(), tz).key < today).length;
    const pays = plannedSnap.docs.map((d) => d.data()).filter((t) => t.date && local(t.date.toMillis(), tz).key <= today);
    sentDigest[uid] = today;
    if (!todayN && !overdue && !pays.length) continue;
    const parts = [];
    if (todayN) parts.push(`задач на сегодня: ${todayN}`);
    if (overdue) parts.push(`просрочено: ${overdue}`);
    if (pays.length) parts.push(`платежи: ${pays.slice(0, 3).map((p) => p.note || p.category).join(', ')}${pays.length > 3 ? '…' : ''}`);
    push(uid, 'Доброе утро ☀️', parts.join(' · '), `${APP_URL}?tab=tasks&view=today`, `digest-${today}`);
  }
}

for (const uid of needDeadlines) {
  // дедлайн в ближайший час и ещё не напоминали; «конец дня» (23:59) пропускаем
  active.filter((t) => t.assigneeUid === uid && t.deadline).forEach((t) => {
    const dl = t.deadline.toMillis();
    if (dl > now && dl <= now + 3600000 && sentDl[t.id] !== dl && local(dl, prefs[uid].tz).min !== 23 * 60 + 59) {
      const mins = Math.max(1, Math.round((dl - now) / 60000));
      push(uid, mins >= 50 ? 'Через час дедлайн' : `Дедлайн через ${mins} мин`, `«${t.title}»`, `${APP_URL}?tab=tasks&view=today`, `dl-${t.id}`);
      sentDl[t.id] = dl;
    }
  });
}

for (const uid of needMood) {
  const today = local(now, prefs[uid].tz).key;
  sentMood[uid] = today;
  const mood = await db.doc(`moods/${uid}_${today}`).get();
  if (!mood.exists) push(uid, 'Как прошёл день?', 'Отметь настроение цветом — займёт секунду', `${APP_URL}?tab=tasks&view=today`, `mood-${today}`);
}

// --- отправка ---
let sent = 0; let removed = 0;
for (const m of outbox) {
  for (const sub of subsByUid[m.uid] || []) {
    const s = sub.data();
    if (DRY) { console.log('[dry]', m.uid.split('@')[0], m.title, '—', m.body); continue; }
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify({ title: m.title, body: m.body, url: m.url, tag: m.tag }), { TTL: 6 * 3600 });
      sent += 1;
    } catch (e) {
      // 404/410 — подписка умерла; 403 с VapidPkHashMismatch — подписана другим ключом
      const body = String(e.body || '');
      if (e.statusCode === 404 || e.statusCode === 410 || /VapidPkHashMismatch/.test(body)) { await sub.ref.delete(); removed += 1; }
      else console.warn('push error', e.statusCode, body.slice(0, 200), new URL(s.endpoint).host);
    }
  }
}
// в сухом прогоне ничего не помечаем отправленным
await stateRef.set(DRY ? { lastRun: state.lastRun || null } : { lastRun: now, sentDigest, sentMood, sentDl }, { merge: true });
console.log(`Готово: событий ${outbox.length}, отправлено ${sent}, удалено мёртвых подписок ${removed}`);
process.exit(0);
