// Фоновый скрипт: вход, запись задач, меню по правому клику, системные уведомления.
import { getStatus, signIn, signOut, createTask, undoTask } from './backend.js';
import { taskFromText, isUsefulUrl, cleanPageTitle } from './shared.js';
import { APP_URL } from '../config.js';

const ICON = 'icons/128.png';
const openApp = (taskId) => chrome.tabs.create({ url: taskId ? `${APP_URL}/?task=${encodeURIComponent(taskId)}` : APP_URL });

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

/* ---------------- Уведомления ---------------- */
function notify(title, message) {
  chrome.notifications.create({ type: 'basic', iconUrl: ICON, title, message: message || '' });
}

chrome.notifications.onClicked.addListener((id) => {
  const [kind, taskId] = id.split('|');
  if (kind === 't') openApp(taskId);
  chrome.notifications.clear(id);
});

chrome.notifications.onButtonClicked.addListener(async (id, button) => {
  const [kind, taskId, notifId] = id.split('|');
  if (kind !== 't') return;
  chrome.notifications.clear(id);
  if (button === 0) return openApp(taskId);
  try {
    await undoTask(taskId, notifId);
    notify('Отменено', 'Задача удалена.');
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
  openApp: ({ taskId }) => openApp(taskId),
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
