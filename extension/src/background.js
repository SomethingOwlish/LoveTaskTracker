// Фоновый скрипт: вход, запись задач, меню по правому клику, системные уведомления.
import {
  getStatus, signIn, signOut, createTask, undoTask, findMurmur, addMurmur, wantMurmur, undoMurmur,
  findWish, addWish, undoWish, getUi,
} from './backend.js';
import { taskFromText, isUsefulUrl, cleanPageTitle } from './shared.js';
import { collectPageSignals, detectMedia, MURMUR_SITE_PATTERNS } from './media.js';
import { detectProduct } from './shop.js';
import { APP_URL } from '../config.js';

const ICON = 'icons/128.png';
// taskId — открыть карточку задачи; tab — открыть вкладку приложения (murmur и т.п.)
function openApp(taskId, tab) {
  const q = taskId ? `?task=${encodeURIComponent(taskId)}` : tab ? `?tab=${encodeURIComponent(tab)}` : '';
  return chrome.tabs.create({ url: `${APP_URL}/${q}` });
}

/* ---------------- Меню по правому клику ----------------
   Пункты зависят от того, кто вошёл: «Задача себе» и «Задача Гусику/Совушке». */
let menusQueue = Promise.resolve();
function rebuildMenus() {
  menusQueue = menusQueue.then(buildMenus).catch((e) => console.warn('menus', e));
  return menusQueue;
}

async function buildMenus() {
  await chrome.contextMenus.removeAll();
  const add = (props) => chrome.contextMenus.create(props, () => void chrome.runtime.lastError);
  add({ id: 'open-app', title: 'Открыть трекер', contexts: ['action'] });

  const { me, partner } = await getStatus();
  if (!me) {
    add({ id: 'sign-in', title: 'Войти в трекер задач…', contexts: ['page', 'selection', 'link'] });
    return;
  }
  const whom = [['me', 'себе'], ...(partner ? [['partner', partner.dative]] : [])];
  for (const [who, label] of whom) {
    add({ id: `sel:${who}`, title: `Задача ${label}: «%s»`, contexts: ['selection'] });
    add({ id: `link:${who}`, title: `Задача ${label} из ссылки`, contexts: ['link'] });
    add({ id: `page:${who}`, title: `Задача ${label} из этой страницы`, contexts: ['page'] });
  }
  add({ id: 'list', title: 'Разобрать в задачи…', contexts: ['selection'] });
  add({ id: 'murmur', title: 'В Мурмур', contexts: ['page'], documentUrlPatterns: MURMUR_SITE_PATTERNS });
  add({ id: 'wish', title: 'В вишлист', contexts: ['page', 'link'] });
}

chrome.runtime.onInstalled.addListener(rebuildMenus);
chrome.runtime.onStartup.addListener(rebuildMenus);

// Текст ссылки, по которой кликнули правой кнопкой (в info его нет).
async function linkText(tab, frameId, url) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [frameId || 0] },
      func: (href) => {
        const a = [...document.querySelectorAll('a[href]')].find((x) => x.href === href);
        if (!a) return '';
        return (a.innerText || a.getAttribute('aria-label') || a.title || a.querySelector('img')?.alt || '').trim();
      },
      args: [url],
    });
    return r?.result || '';
  } catch {
    return '';
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-app') return openApp();
  if (info.menuItemId === 'sign-in') {
    try { await signIn(); await rebuildMenus(); notify('Готово', 'Вход выполнен — меню задач включено.'); }
    catch (e) { notify('Не получилось войти', e.message); }
    return;
  }

  if (info.menuItemId === 'list') return listFromSelection(tab, info);
  if (info.menuItemId === 'murmur') return murmurFromPage(tab);
  if (info.menuItemId === 'wish') return wishFromPage(tab, info);

  const [source, who] = String(info.menuItemId).split(':');
  let data;
  if (source === 'sel') {
    data = { ...taskFromText(info.selectionText), link: isUsefulUrl(info.pageUrl) ? info.pageUrl : null };
  } else if (source === 'link') {
    const text = info.selectionText || await linkText(tab, info.frameId, info.linkUrl);
    data = { ...taskFromText(text || info.linkUrl), link: info.linkUrl };
  } else if (source === 'page') {
    data = { title: cleanPageTitle(tab?.title) || info.pageUrl, link: isUsefulUrl(info.pageUrl) ? info.pageUrl : null };
  } else {
    return;
  }

  try {
    const { me, partner } = await getStatus();
    const assignee = who === 'partner' && partner ? partner : me;
    const res = await createTask({ ...data, assigneeUid: assignee?.uid });
    const whomText = assignee && me && assignee.uid !== me.uid ? ` → ${assignee.name}` : '';
    chrome.notifications.create(`t|${res.id}|${res.notifId || ''}`, {
      type: 'basic', iconUrl: ICON,
      title: 'Задача создана' + whomText,
      message: res.title,
      buttons: [{ title: 'Открыть' }, { title: 'Отменить' }],
    });
  } catch (e) {
    if (e.code === 'NOT_SIGNED_IN') rebuildMenus();
    notify('Задача не сохранилась', e.message);
  }
});

/* ---------------- Список задач из выделения ----------------
   В info.selectionText Chrome склеивает строки в одну, поэтому читаем
   выделение в том фрейме, где кликнули (артефакт Claude — во фрейме),
   вместе с HTML: из него форма восстановит пункты и вложенность.
   Сам разбор и предпросмотр — в форме (там есть DOMParser). */
async function listFromSelection(tab, info) {
  let picked = { text: info.selectionText || '', html: '' };
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [info.frameId || 0] },
      func: () => {
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return null;
        const box = document.createElement('div');
        for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
        return { text: String(sel), html: box.innerHTML };
      },
    });
    if (r?.result?.text) picked = r.result;
  } catch { /* фрейм с чужого сайта без доступа — остаётся текст из меню */ }
  await chrome.storage.session.set({ pendingList: { ...picked, url: info.pageUrl || '', at: Date.now() } });
  try {
    await chrome.action.openPopup();
  } catch {
    // старый Chrome или окно без фокуса — открываем форму отдельным окошком
    chrome.windows.create({ url: chrome.runtime.getURL('popup.html?list=1'), type: 'popup', width: 380, height: 620 });
  }
}

/* ---------------- Мурмур из правого клика ---------------- */
const KIND_LABEL = { movie: 'Фильм', series: 'Сериал', game: 'Игра' };

async function murmurFromPage(tab) {
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageSignals });
    const media = r?.result ? detectMedia(r.result) : null;
    if (!media) return notify('Не нашла фильм, сериал или игру', 'Открой страницу самого фильма или игры и попробуй ещё раз.');

    const { me } = await getStatus();
    const ex = await findMurmur({ link: media.link, title: media.title, year: media.year, kind: media.kind });
    if (ex?.status === 'done') return notify('Уже в архиве Мурмура', ex.title);
    if (ex && ex.wantedBy.includes(me?.uid)) return notify('Уже в «Хотим»', ex.title);
    if (ex) {
      await wantMurmur(ex.id);
      return notify('Отметили: хочу', ex.title);
    }
    const res = await addMurmur({ kind: media.kind, title: media.title, link: media.link, poster: media.poster || null, year: media.year, source: media.source });
    chrome.notifications.create(`m|${res.id}`, {
      type: 'basic', iconUrl: ICON,
      title: `${KIND_LABEL[res.kind]} в Мурмуре`,
      message: media.year ? `${res.title} (${media.year})` : res.title,
      buttons: [{ title: 'Открыть' }, { title: 'Отменить' }],
    });
  } catch (e) {
    if (e.code === 'NOT_SIGNED_IN') rebuildMenus();
    notify('Не добавилось в Мурмур', e.message);
  }
}

/* ---------------- Вишлист из правого клика ----------------
   По странице товара — с ценой и картинкой; по ссылке или обычной странице —
   просто название и адрес (цену можно дописать в приложении). */
async function wishFromPage(tab, info) {
  try {
    let data;
    if (info.linkUrl) {
      const text = info.selectionText || await linkText(tab, info.frameId, info.linkUrl);
      data = { title: (text || info.linkUrl).trim(), url: info.linkUrl };
    } else {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageSignals });
      const p = r?.result ? detectProduct(r.result) : null;
      data = p
        ? { title: p.title, url: p.link, price: p.price, currency: p.currency, image: p.image || null, source: p.source, type: p.type }
        : { title: cleanPageTitle(tab?.title) || info.pageUrl, url: isUsefulUrl(info.pageUrl) ? info.pageUrl : null };
    }
    const ex = data.url ? await findWish(data.url) : null;
    if (ex) return notify(ex.status === 'got' ? 'Уже добыто' : 'Уже в вишлисте', ex.title);
    const res = await addWish(data);
    const price = data.price ? ` · ${data.price} ${data.currency || ''}`.trimEnd() : '';
    chrome.notifications.create(`w|${res.id}`, {
      type: 'basic', iconUrl: ICON,
      title: 'В вишлисте',
      message: res.title + price,
      buttons: [{ title: 'Открыть' }, { title: 'Отменить' }],
    });
  } catch (e) {
    if (e.code === 'NOT_SIGNED_IN') rebuildMenus();
    notify('Не добавилось в вишлист', e.message);
  }
}

/* ---------------- Уведомления ---------------- */
function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: ICON, title, message: message || '' });
}

chrome.notifications.onClicked.addListener((id) => {
  const [kind, taskId] = id.split('|');
  if (kind === 't') openApp(taskId);
  if (kind === 'm') openApp(null, 'murmur');
  if (kind === 'w') openApp(null, 'wishlist');
  chrome.notifications.clear(id);
});

chrome.notifications.onButtonClicked.addListener(async (id, button) => {
  const [kind, taskId, notifId] = id.split('|');
  if (!['t', 'm', 'w'].includes(kind)) return;
  chrome.notifications.clear(id);
  if (button === 0) return kind === 'm' ? openApp(null, 'murmur') : kind === 'w' ? openApp(null, 'wishlist') : openApp(taskId);
  try {
    if (kind === 'm') await undoMurmur(taskId);
    else if (kind === 'w') await undoWish(taskId);
    else await undoTask(taskId, notifId);
    notify('Отменено', { m: 'Убрали из Мурмура.', w: 'Убрали из вишлиста.' }[kind] || 'Задача удалена.');
  } catch (e) {
    notify('Не получилось отменить', e.message);
  }
});

/* ---------------- Сообщения от формы ---------------- */
const handlers = {
  status: () => getStatus(),
  signIn: async () => {
    const me = await signIn();
    await rebuildMenus();
    // окно Google закрыло форму — открываем её снова (Chrome 127+)
    chrome.action.openPopup?.().catch(() => {});
    return me;
  },
  signOut: async () => { await signOut(); await rebuildMenus(); return true; },
  createTask: ({ data }) => createTask(data),
  undoTask: ({ id, notifId }) => undoTask(id, notifId),
  openApp: ({ taskId, tab }) => openApp(taskId, tab),
  findMurmur: ({ link, title, year, kind, extId }) => findMurmur({ link, title, year, kind, extId }),
  addMurmur: ({ data }) => addMurmur(data),
  wantMurmur: ({ id }) => wantMurmur(id),
  undoMurmur: ({ id }) => undoMurmur(id),
  findWish: ({ url }) => findWish(url),
  addWish: ({ data }) => addWish(data),
  undoWish: ({ id }) => undoWish(id),
  ui: () => getUi(),
};

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve()
    .then(() => h(msg))
    .then((result) => reply({ ok: true, result }))
    .catch((e) => reply({ ok: false, error: e.message, code: e.code }));
  return true; // ответ придёт асинхронно
});
