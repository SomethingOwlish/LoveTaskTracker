// Форма «Новая задача» во всплывающем окне расширения.
// Всё общение с Firebase — через фоновый скрипт (background.js).
import { DEADLINES, QUADRANTS, taskFromText, splitTags, isUsefulUrl, cleanPageTitle } from './shared.js';
import { OAUTH_CLIENT_ID, REDIRECT_URI } from '../config.js';

const $app = document.getElementById('app');

/* ---------- мелочи ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function call(type, extra = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...extra });
  if (!res?.ok) { const e = new Error(res?.error || 'Нет ответа'); e.code = res?.code; throw e; }
  return res.result;
}

const prefs = {
  async get() {
    const d = await chrome.storage.local.get(['who', 'theme', 'recentProjects']);
    return { who: d.who || 'me', theme: d.theme || 'academia', recentProjects: d.recentProjects || [] };
  },
  set: (obj) => chrome.storage.local.set(obj),
};

// Аватарки — те же сова и гусь, что в приложении.
const AVATARS = {
  owl: `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="currentColor" opacity=".16"/><path d="M16 26c0-10 7-16 16-16s16 6 16 16v8c0 11-7 18-16 18s-16-7-16-18v-8z" fill="currentColor" opacity=".9"/><circle cx="24" cy="29" r="8" fill="var(--surface)"/><circle cx="40" cy="29" r="8" fill="var(--surface)"/><circle cx="24" cy="29" r="3.4" fill="currentColor"/><circle cx="40" cy="29" r="3.4" fill="currentColor"/><path d="M28 34l4 4 4-4z" fill="var(--warn)"/><path d="M19 12l7 7M45 12l-7 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  goose: `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="currentColor" opacity=".16"/><path d="M40 12c-9 0-15 6-15 14v2c-6 1-11 6-11 13 0 8 7 13 17 13 11 0 19-6 19-16V26c0-8-3-14-9-14z" fill="currentColor" opacity=".9"/><circle cx="38" cy="24" r="3.2" fill="var(--surface)"/><circle cx="38" cy="24" r="1.5" fill="currentColor"/><path d="M46 26l10-2-10-4z" fill="var(--warn)"/></svg>`,
};
const ava = (p) => `<span class="ava">${AVATARS[p?.avatar] || AVATARS.owl}</span>`;

// Что открыто во вкладке: адрес, заголовок и выделенный текст.
async function readTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let selection = '';
  if (tab?.id && isUsefulUrl(tab.url)) {
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const el = document.activeElement;
          if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) && el.selectionEnd > el.selectionStart) {
            return el.value.slice(el.selectionStart, el.selectionEnd);
          }
          return String(window.getSelection() || '');
        },
      });
      selection = r?.result || '';
    } catch { /* страницы Chrome и магазина расширений читать нельзя */ }
  }
  return { url: tab?.url || '', title: tab?.title || '', selection };
}

/* ---------- экран входа ---------- */
function renderSignIn(error = '') {
  const hint = !OAUTH_CLIENT_ID
    ? `<p class="hint">Расширение ещё не настроено: впиши <code>OAUTH_CLIENT_ID</code> в <code>extension/config.js</code> и пересобери. Адрес возврата для Google Cloud:<br><code class="sel">${esc(REDIRECT_URI)}</code></p>`
    : '';
  $app.innerHTML = `
    <div class="signin">
      <div class="logo">${AVATARS.owl}${AVATARS.goose}</div>
      <h1>Совушка &amp; Гусик</h1>
      <p class="dim">Войди тем же Google-аккаунтом, что и в трекере.</p>
      <button class="btn btn-primary" id="signin" ${OAUTH_CLIENT_ID ? '' : 'disabled'}>Войти через Google</button>
      ${error ? `<p class="error">${esc(error)}</p>` : ''}
      ${hint}
    </div>`;
  document.getElementById('signin')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Открываю окно Google…';
    try {
      await call('signIn');
      start();
    } catch (err) {
      renderSignIn(err.message);
    }
  });
}

/* ---------- форма ---------- */
function renderForm({ me, partner }, tab, saved) {
  const fromSel = taskFromText(tab.selection);
  const hasLink = isUsefulUrl(tab.url);
  const s = {
    who: saved.who === 'partner' && partner ? 'partner' : 'me',
    deadline: 'none',
    quad: null,
    attachLink: hasLink,
    needsReview: false,
  };
  let host = '';
  try { host = new URL(tab.url).hostname.replace(/^www\./, ''); } catch { /* пусто */ }

  const chip = (group, key, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" data-group="${group}" data-key="${key}">${esc(label)}</button>`;

  $app.innerHTML = `
    <form id="f" autocomplete="off">
      <header class="head">
        ${ava(me)}
        <h1>Новая задача</h1>
        <button type="button" class="icon-btn" id="theme" title="Сменить тему" aria-label="Сменить тему">◐</button>
        <button type="button" class="icon-btn" id="open" title="Открыть трекер" aria-label="Открыть трекер">↗</button>
      </header>

      <textarea id="title" class="input title" rows="2" placeholder="Что сделать?">${esc(fromSel.title || cleanPageTitle(tab.title))}</textarea>
      <div id="note-wrap" ${fromSel.description ? '' : 'hidden'}>
        <textarea id="note" class="input" rows="3" placeholder="Заметка">${esc(fromSel.description)}</textarea>
      </div>
      <button type="button" class="link-btn" id="add-note" ${fromSel.description ? 'hidden' : ''}>+ заметка</button>

      ${hasLink ? `
      <label class="row attach">
        <input type="checkbox" id="attach" checked />
        <span class="url" title="${esc(tab.url)}">🔗 ${esc(host)}</span>
      </label>` : ''}

      <div class="field">
        <span class="lbl">Кому</span>
        <div class="seg" id="who">
          <button type="button" class="seg-btn ${s.who === 'me' ? 'on' : ''}" data-who="me">${ava(me)} Себе</button>
          ${partner ? `<button type="button" class="seg-btn ${s.who === 'partner' ? 'on' : ''}" data-who="partner">${ava(partner)} ${esc(partner.dative)}</button>` : ''}
        </div>
        <label class="row review" id="review-row" ${s.who === 'partner' ? '' : 'hidden'}>
          <input type="checkbox" id="review" /> <span>С проверкой — вернётся мне на ревью</span>
        </label>
      </div>

      <div class="field">
        <span class="lbl">Срок</span>
        <div class="chips">
          ${Object.entries(DEADLINES).map(([k, v]) => chip('deadline', k, v.label, k === s.deadline)).join('')}
          ${chip('deadline', 'custom', 'Дата…', false)}
        </div>
        <input type="datetime-local" id="custom" class="input" hidden />
      </div>

      <div class="field">
        <span class="lbl">Матрица</span>
        <div class="chips">${Object.entries(QUADRANTS).map(([k, v]) => chip('quad', k, v.label, false)).join('')}</div>
      </div>

      <div class="two">
        <div class="field">
          <span class="lbl">Проект</span>
          <input id="project" class="input" list="projects" placeholder="—" />
          <datalist id="projects">${saved.recentProjects.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
        </div>
        <div class="field">
          <span class="lbl">Теги</span>
          <input id="tags" class="input" placeholder="через запятую" />
        </div>
      </div>

      <button type="submit" class="btn btn-primary" id="save">Создать <kbd>⌘↵</kbd></button>
      <p class="error" id="err" hidden></p>
      <footer class="foot">
        <span class="dim">${esc(me.name)}</span>
        <button type="button" class="link-btn" id="signout">выйти</button>
      </footer>
    </form>`;

  const $ = (id) => document.getElementById(id);
  const title = $('title');
  title.focus();
  title.select();
  autoGrow(title);
  title.addEventListener('input', () => autoGrow(title));

  $('add-note').addEventListener('click', () => { $('note-wrap').hidden = false; $('add-note').hidden = true; $('note').focus(); });
  $('attach')?.addEventListener('change', (e) => { s.attachLink = e.target.checked; });
  $('open').addEventListener('click', () => { call('openApp'); window.close(); });
  $('theme').addEventListener('click', toggleTheme);
  $('signout').addEventListener('click', async () => { await call('signOut'); renderSignIn(); });

  $('who').addEventListener('click', (e) => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    s.who = b.dataset.who;
    $('who').querySelectorAll('[data-who]').forEach((x) => x.classList.toggle('on', x === b));
    $('review-row').hidden = s.who !== 'partner';
    prefs.set({ who: s.who });
  });

  $app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const { group, key } = b.dataset;
    if (group === 'deadline') {
      s.deadline = key;
      $app.querySelectorAll('[data-group="deadline"]').forEach((x) => x.classList.toggle('on', x === b));
      $('custom').hidden = key !== 'custom';
      if (key === 'custom') $('custom').focus();
    } else {
      // квадрант можно снять повторным нажатием
      s.quad = s.quad === key ? null : key;
      $app.querySelectorAll('[data-group="quad"]').forEach((x) => x.classList.toggle('on', x.dataset.key === s.quad));
    }
  }));

  // Enter в названии — создать; Shift+Enter — новая строка; ⌘/Ctrl+Enter — откуда угодно.
  $('f').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey || (e.target === title && !e.shiftKey)) {
      e.preventDefault();
      $('f').requestSubmit();
    }
  });

  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('err');
    err.hidden = true;
    const t = title.value.trim();
    if (!t) { title.focus(); return; }

    let deadline = null;
    if (s.deadline === 'custom') deadline = $('custom').value ? new Date($('custom').value) : null;
    else deadline = DEADLINES[s.deadline].date();

    const project = $('project').value.trim();
    const q = s.quad ? QUADRANTS[s.quad] : null;
    const assignee = s.who === 'partner' && partner ? partner : me;
    const data = {
      title: t,
      description: $('note')?.value.trim() || '',
      link: s.attachLink && hasLink ? tab.url : null,
      assigneeUid: assignee.uid,
      needsReview: assignee.uid !== me.uid && $('review').checked,
      deadline: deadline ? deadline.toISOString() : null,
      importance: q?.importance ?? 0,
      urgency: q?.urgency ?? 0,
      projectTags: project ? [project] : [],
      tags: splitTags($('tags').value),
    };

    const btn = $('save');
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      const res = await call('createTask', { data });
      if (project) prefs.set({ recentProjects: [project, ...saved.recentProjects.filter((p) => p !== project)].slice(0, 10) });
      renderDone(res, assignee, me);
    } catch (ex) {
      if (ex.code === 'NOT_SIGNED_IN') return renderSignIn(ex.message);
      err.textContent = 'Не сохранилось: ' + ex.message;
      err.hidden = false;
      btn.disabled = false;
      btn.innerHTML = 'Создать <kbd>⌘↵</kbd>';
    }
  });
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

/* ---------- готово ---------- */
function renderDone(res, assignee, me) {
  const toPartner = assignee.uid !== me.uid;
  $app.innerHTML = `
    <div class="done">
      <div class="check">✓</div>
      <h1>${toPartner ? `Поручено: ${esc(assignee.name)}` : 'Задача создана'}</h1>
      <p class="dim">${esc(res.title)}</p>
      <div class="actions">
        <button class="btn" id="open">Открыть</button>
        <button class="btn" id="more">Ещё одну</button>
        <button class="btn btn-ghost" id="undo">Отменить</button>
      </div>
    </div>`;
  // Закрываемся сами, если человек не тянется к кнопкам.
  let timer = setTimeout(() => window.close(), 1800);
  $app.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
  document.getElementById('open').onclick = () => { call('openApp', { taskId: res.id }); window.close(); };
  document.getElementById('more').onclick = () => { clearTimeout(timer); start({ blank: true }); };
  document.getElementById('undo').onclick = async (e) => {
    clearTimeout(timer);
    e.target.disabled = true;
    await call('undoTask', { id: res.id, notifId: res.notifId }).catch(() => {});
    $app.querySelector('h1').textContent = 'Отменено';
    timer = setTimeout(() => window.close(), 900);
  };
}

/* ---------- тема ---------- */
async function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'cyberpunk' ? 'academia' : 'cyberpunk';
  document.documentElement.dataset.theme = next;
  prefs.set({ theme: next });
}

/* ---------- старт ---------- */
async function start({ blank = false } = {}) {
  const saved = await prefs.get();
  document.documentElement.dataset.theme = saved.theme;
  try {
    const [status, tab] = await Promise.all([call('status'), readTab()]);
    if (!status.me) return renderSignIn();
    renderForm(status, blank ? { ...tab, title: '', selection: '' } : tab, saved);
  } catch (e) {
    renderSignIn(e.message);
  }
}

start();
