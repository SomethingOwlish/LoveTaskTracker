// Всплывающее окно расширения: «Новая задача» и (на странице фильма/игры) «В Мурмур».
// Всё общение с Firebase — через фоновый скрипт (background.js).
import { DEADLINES, QUADRANTS, taskFromText, splitTags, isUsefulUrl, cleanPageTitle } from './shared.js';
import { collectPageSignals, detectMedia } from './media.js';
import { detectProduct } from './shop.js';
import { WISH_TYPES } from '../../src/lib/wishMath.js';
import { parseTaskList, toTaskData, htmlHasStructure, htmlToListText } from '../../src/lib/taskImport.js';
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
    const d = await chrome.storage.local.get(['who', 'ui', 'recentProjects']);
    return { who: d.who || 'me', ui: d.ui || null, recentProjects: d.recentProjects || [] };
  },
  set: (obj) => chrome.storage.local.set(obj),
};

// Аватарки — те же сова и гусь, что в приложении.
const AVATARS = {
  owl: `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="currentColor" opacity=".16"/><path d="M16 26c0-10 7-16 16-16s16 6 16 16v8c0 11-7 18-16 18s-16-7-16-18v-8z" fill="currentColor" opacity=".9"/><circle cx="24" cy="29" r="8" fill="var(--surface)"/><circle cx="40" cy="29" r="8" fill="var(--surface)"/><circle cx="24" cy="29" r="3.4" fill="currentColor"/><circle cx="40" cy="29" r="3.4" fill="currentColor"/><path d="M28 34l4 4 4-4z" fill="var(--warn)"/><path d="M19 12l7 7M45 12l-7 7" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>`,
  goose: `<svg viewBox="0 0 64 64" fill="none" aria-hidden="true"><circle cx="32" cy="32" r="32" fill="currentColor" opacity=".16"/><path d="M40 12c-9 0-15 6-15 14v2c-6 1-11 6-11 13 0 8 7 13 17 13 11 0 19-6 19-16V26c0-8-3-14-9-14z" fill="currentColor" opacity=".9"/><circle cx="38" cy="24" r="3.2" fill="var(--surface)"/><circle cx="38" cy="24" r="1.5" fill="currentColor"/><path d="M46 26l10-2-10-4z" fill="var(--warn)"/></svg>`,
};
const ava = (p) => `<span class="ava">${AVATARS[p?.avatar] || AVATARS.owl}</span>`;

// Что открыто во вкладке: адрес, заголовок, выделенный текст и — если это
// страница фильма, сериала или игры — что именно (media).
async function readTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  let selection = '';
  let selectionHtml = '';
  let media = null;
  let product = null;
  if (tab?.id && isUsefulUrl(tab.url)) {
    try {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: collectPageSignals });
      media = r?.result ? detectMedia(r.result) : null;
      product = r?.result ? detectProduct(r.result) : null;
    } catch { /* нет доступа к странице */ }
    try {
      // во всех фреймах: артефакт Claude живёт во фрейме; берём первый непустой
      const func = () => {
        const el = document.activeElement;
        if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text')) && el.selectionEnd > el.selectionStart) {
          return { text: el.value.slice(el.selectionStart, el.selectionEnd), html: '' };
        }
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount || !String(sel)) return null;
        const box = document.createElement('div');
        for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
        return { text: String(sel), html: box.innerHTML };
      };
      const res = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, func })
        .catch(() => chrome.scripting.executeScript({ target: { tabId: tab.id }, func }));
      const hit = res.map((r) => r?.result).find((r) => r?.text?.trim());
      if (hit) { selection = hit.text; selectionHtml = hit.html; }
    } catch { /* страницы Chrome и магазина расширений читать нельзя */ }
  }
  return { url: tab?.url || '', title: tab?.title || '', selection, selectionHtml, media, product };
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
function renderTaskForm($panel, { me, partner }, tab, saved) {
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

  $panel.innerHTML = `
    <form id="f" autocomplete="off">
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
    </form>`;

  const $ = (id) => document.getElementById(id);
  const title = $('title');
  autoGrow(title);
  title.addEventListener('input', () => autoGrow(title));

  $('add-note').addEventListener('click', () => { $('note-wrap').hidden = false; $('add-note').hidden = true; $('note').focus(); });
  $('attach')?.addEventListener('change', (e) => { s.attachLink = e.target.checked; });

  $('who').addEventListener('click', (e) => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    s.who = b.dataset.who;
    $('who').querySelectorAll('[data-who]').forEach((x) => x.classList.toggle('on', x === b));
    $('review-row').hidden = s.who !== 'partner';
    prefs.set({ who: s.who });
  });

  $panel.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    const { group, key } = b.dataset;
    if (group === 'deadline') {
      s.deadline = key;
      $panel.querySelectorAll('[data-group="deadline"]').forEach((x) => x.classList.toggle('on', x === b));
      $('custom').hidden = key !== 'custom';
      if (key === 'custom') $('custom').focus();
    } else {
      // квадрант можно снять повторным нажатием
      s.quad = s.quad === key ? null : key;
      $panel.querySelectorAll('[data-group="quad"]').forEach((x) => x.classList.toggle('on', x.dataset.key === s.quad));
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
      renderDone({
        heading: assignee.uid !== me.uid ? `Поручено: ${assignee.name}` : 'Задача создана',
        title: res.title,
        taskId: res.id,
        undo: () => call('undoTask', { id: res.id, notifId: res.notifId }),
      });
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

/* ---------- Мурмур ---------- */
const KINDS = { movie: 'Фильм', series: 'Сериал', game: 'Игра' };

function renderMurmurForm($panel, { me, partner }, media) {
  const s = { kind: media.kind, existing: null };
  $panel.innerHTML = `
    <form id="m" autocomplete="off">
      <div class="media">
        ${media.poster ? `<img class="poster" src="${esc(media.poster)}" alt="" referrerpolicy="no-referrer" />` : '<div class="poster empty">🎬</div>'}
        <div class="media-body">
          <div class="seg kinds" id="kinds">
            ${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="seg-btn ${k === s.kind ? 'on' : ''}" data-kind="${k}">${v}</button>`).join('')}
          </div>
          <textarea id="m-title" class="input title" rows="2">${esc(media.title)}</textarea>
          <div class="dim small">${[media.year, media.source].filter(Boolean).map(esc).join(' · ')}</div>
        </div>
      </div>
      <input id="m-note" class="input" placeholder="Заметка — где смотреть, кто посоветовал…" />
      <p class="dupe" id="dupe" hidden></p>
      <button type="submit" class="btn btn-primary" id="m-save">＋ В Мурмур <kbd>↵</kbd></button>
      <p class="error" id="m-err" hidden></p>
    </form>`;

  const $ = (id) => document.getElementById(id);
  const title = $('m-title');
  autoGrow(title);
  title.addEventListener('input', () => autoGrow(title));

  $('kinds').addEventListener('click', (e) => {
    const b = e.target.closest('[data-kind]');
    if (!b) return;
    s.kind = b.dataset.kind;
    $('kinds').querySelectorAll('[data-kind]').forEach((x) => x.classList.toggle('on', x === b));
    checkDupe(); // фильм и сериал с одним названием — разные записи
  });

  // Уже есть в списке? Тогда вместо «добавить» — «я тоже хочу» или просто сообщаем.
  // Сверяем по ссылке, иначе по названию + году + типу.
  let checkN = 0;
  const checkDupe = () => {
    const n = ++checkN;
    s.existing = null;
    $('dupe').hidden = true;
    const btn = $('m-save');
    btn.disabled = false;
    btn.innerHTML = '＋ В Мурмур <kbd>↵</kbd>';
    call('findMurmur', { link: s.kind === media.kind ? media.link : null, title: media.title, year: media.year, kind: s.kind }).then((ex) => {
      if (!ex || n !== checkN) return;
      s.existing = ex;
      const dupe = $('dupe');
      const done = ex.status === 'done';
      const iWant = ex.wantedBy.includes(me.uid);
      const others = ex.wantedBy.filter((u) => u !== me.uid).length && partner ? partner.name : '';
      dupe.hidden = false;
      dupe.textContent = done
        ? `Уже ${ex.kind === 'game' ? 'прошли' : 'посмотрели'} — «${ex.title}» в архиве Мурмура.`
        : iWant ? `Уже в «Хотим»${others ? ` — и ${others} тоже хочет` : ''}.`
          : `«${ex.title}» уже в «Хотим»${others ? ` — хочет ${others}` : ''}.`;
      const btn = $('m-save');
      if (done || iWant) { btn.disabled = true; btn.textContent = 'Уже в списке'; }
      else { btn.innerHTML = '♥ Я тоже хочу <kbd>↵</kbd>'; }
    }).catch(() => { /* проверка не удалась — просто даём добавить */ });
  };
  checkDupe();

  $('m').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('m').requestSubmit(); }
  });

  $('m').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('m-err');
    err.hidden = true;
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const btn = $('m-save');
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      if (s.existing) {
        await call('wantMurmur', { id: s.existing.id });
        return renderDone({ heading: 'Отметили: хочу', title: s.existing.title, openTab: 'murmur' });
      }
      const res = await call('addMurmur', {
        data: { kind: s.kind, title: t, note: $('m-note').value.trim(), link: media.link, poster: media.poster || null, year: media.year, source: media.source },
      });
      renderDone({ heading: `${KINDS[res.kind]} в Мурмуре`, title: res.title, openTab: 'murmur', undo: () => call('undoMurmur', { id: res.id }) });
    } catch (ex) {
      if (ex.code === 'NOT_SIGNED_IN') return renderSignIn(ex.message);
      err.textContent = 'Не сохранилось: ' + ex.message;
      err.hidden = false;
      btn.disabled = false;
      btn.innerHTML = '＋ В Мурмур <kbd>↵</kbd>';
    }
  });
}

/* ---------- Вишлист ---------- */
const CURS = ['RSD', 'EUR', 'USD', 'RUB'];
const CUR_SYM = { RSD: 'дин.', EUR: '€', USD: '$', RUB: '₽' };

// product — распознанный товар; на обычной странице — заголовок и адрес вкладки.
function renderWishForm($panel, { me, partner }, tab) {
  const p = tab.product || { title: cleanPageTitle(tab.title), link: isUsefulUrl(tab.url) ? tab.url : '', price: null, currency: null, image: '', source: '', type: 'need' };
  const s = { type: p.type || 'need', owner: me.uid, currency: p.currency || 'RSD', existing: null };
  const curs = CURS.includes(s.currency) ? CURS : [...CURS, s.currency];
  $panel.innerHTML = `
    <form id="w" autocomplete="off">
      <div class="media">
        ${p.image ? `<img class="poster wish" src="${esc(p.image)}" alt="" referrerpolicy="no-referrer" />` : '<div class="poster wish empty">🎁</div>'}
        <div class="media-body">
          <textarea id="w-title" class="input title" rows="2" placeholder="Что хочется?">${esc(p.title)}</textarea>
          <div class="price-row">
            <input id="w-price" class="input" inputmode="decimal" placeholder="Цена" value="${p.price ?? ''}" />
            <div class="chips" id="w-cur">${curs.map((c) => `<button type="button" class="chip ${c === s.currency ? 'on' : ''}" data-cur="${c}">${esc(CUR_SYM[c] || c)}</button>`).join('')}</div>
          </div>
          <div class="dim small">${esc(p.source || '')}</div>
        </div>
      </div>
      <div class="field">
        <div class="chips" id="w-type">${WISH_TYPES.map((t) => `<button type="button" class="chip ${t.id === s.type ? 'on' : ''}" data-type="${t.id}">${esc(t.label)}</button>`).join('')}</div>
      </div>
      <div class="field">
        <div class="seg" id="w-owner">
          <button type="button" class="seg-btn on" data-owner="${esc(me.uid)}">${ava(me)} Мне</button>
          ${partner ? `<button type="button" class="seg-btn" data-owner="${esc(partner.uid)}">${ava(partner)} ${esc(partner.dative)}</button>` : ''}
        </div>
      </div>
      <input id="w-note" class="input" style="margin-top:10px" placeholder="Заметка — размер, цвет…" />
      <p class="dupe" id="w-dupe" hidden></p>
      <button type="submit" class="btn btn-primary" id="w-save">＋ В вишлист <kbd>↵</kbd></button>
      <p class="error" id="w-err" hidden></p>
    </form>`;

  const $ = (id) => document.getElementById(id);
  const title = $('w-title');
  autoGrow(title);
  title.addEventListener('input', () => autoGrow(title));
  const pick = (box, attr, set) => box.addEventListener('click', (e) => {
    const b = e.target.closest(`[data-${attr}]`);
    if (!b) return;
    set(b.dataset[attr]);
    box.querySelectorAll(`[data-${attr}]`).forEach((x) => x.classList.toggle('on', x === b));
  });
  pick($('w-cur'), 'cur', (v) => { s.currency = v; });
  pick($('w-type'), 'type', (v) => { s.type = v; });
  pick($('w-owner'), 'owner', (v) => { s.owner = v; });

  if (p.link) {
    call('findWish', { url: p.link }).then((ex) => {
      if (!ex) return;
      const d = $('w-dupe');
      d.hidden = false;
      d.textContent = ex.status === 'got' ? `«${ex.title}» уже добыто.` : `«${ex.title}» уже в вишлисте.`;
      $('w-save').textContent = 'Всё равно добавить';
    }).catch(() => {});
  }

  $('w').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'BUTTON') { e.preventDefault(); $('w').requestSubmit(); }
  });
  $('w').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('w-err');
    err.hidden = true;
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const raw = $('w-price').value.replace(/[\s\u00a0]/g, '').replace(',', '.');
    const price = raw ? Number(raw) : null;
    const btn = $('w-save');
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    try {
      const res = await call('addWish', {
        data: { title: t, url: p.link || null, price: Number.isFinite(price) ? price : null, currency: s.currency, type: s.type, ownerUid: s.owner, note: $('w-note').value.trim(), image: p.image || null, source: p.source || null },
      });
      const whose = partner && s.owner === partner.uid ? ` — для: ${partner.name}` : '';
      renderDone({ heading: `В вишлисте${whose}`, title: res.title, openTab: 'wishlist', undo: () => call('undoWish', { id: res.id }) });
    } catch (ex) {
      if (ex.code === 'NOT_SIGNED_IN') return renderSignIn(ex.message);
      err.textContent = 'Не сохранилось: ' + ex.message;
      err.hidden = false;
      btn.disabled = false;
      btn.innerHTML = '＋ В вишлист <kbd>↵</kbd>';
    }
  });
}

/* ---------- список задач ----------
   Вставили, перетащили или выделили список (например, из артефакта Claude) —
   разбираем на задачи, показываем, что получится, и создаём пачкой.
   Правила разбора — в src/lib/taskImport.js. */
function listTextFrom(sel, html) {
  return htmlHasStructure(html) ? htmlToListText(html) : (sel || '');
}

function renderListForm($panel, { me, partner }, text, tab, saved) {
  const people = [{ key: 'me', name: me.name }, ...(partner ? [{ key: 'partner', name: partner.name }] : [])];
  const s = { who: saved.who === 'partner' && partner ? 'partner' : 'me', deadline: 'none', skip: new Set(), flip: new Set(), items: [] };
  const hasLink = isUsefulUrl(tab.url);
  const chip = (key, label, on) => `<button type="button" class="chip ${on ? 'on' : ''}" data-key="${key}">${esc(label)}</button>`;

  $panel.innerHTML = `
    <form id="lf" autocomplete="off">
      <textarea id="l-text" class="input" rows="5" placeholder="Вставь или перетащи сюда список: пункт — задача, подпункты — чеклист, «## заголовок» — проект, @${esc(partner?.name || 'имя')} — кому, «завтра» или «до 20.11» — срок, «!» — важно">${esc(text)}</textarea>
      <ul class="l-preview" id="l-preview"></ul>

      <div class="field">
        <span class="lbl">Кому, если не сказано</span>
        <div class="seg" id="l-who">
          <button type="button" class="seg-btn ${s.who === 'me' ? 'on' : ''}" data-who="me">${ava(me)} Себе</button>
          ${partner ? `<button type="button" class="seg-btn ${s.who === 'partner' ? 'on' : ''}" data-who="partner">${ava(partner)} ${esc(partner.dative)}</button>` : ''}
        </div>
      </div>
      <div class="field">
        <span class="lbl">Срок, если не сказано</span>
        <div class="chips" id="l-dl">${Object.entries(DEADLINES).map(([k, v]) => chip(k, v.label, k === s.deadline)).join('')}</div>
      </div>
      ${hasLink ? '<label class="row attach"><input type="checkbox" id="l-attach" /> <span>Ссылку на страницу — во все задачи</span></label>' : ''}

      <button type="submit" class="btn btn-primary" id="l-save">Создать</button>
      <p class="error" id="l-err" hidden></p>
    </form>`;

  const $ = (id) => document.getElementById(id);
  const area = $('l-text');
  const whoOf = (t, i) => {
    const w = t.who || s.who;
    return s.flip.has(i) && partner ? (w === 'me' ? 'partner' : 'me') : w;
  };
  const chosen = () => s.items.map((t, i) => [t, i]).filter(([, i]) => !s.skip.has(i));
  const fmt = (d) => d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });

  const draw = () => {
    const dl = DEADLINES[s.deadline].date();
    $('l-preview').innerHTML = s.items.map((t, i) => {
      const off = s.skip.has(i);
      const p = whoOf(t, i) === 'partner' && partner ? partner : me;
      const d = t.deadline || dl;
      return `<li class="${off ? 'off' : ''}" data-i="${i}">
        <button type="button" class="l-check ${off ? '' : 'on'}" data-act="skip" aria-label="${off ? 'Добавить' : 'Не добавлять'}">${off ? '' : '✓'}</button>
        <span class="l-title">${t.important ? '<b class="l-imp">!</b>' : ''}${esc(t.title)}</span>
        ${t.projectTags[0] ? `<span class="l-chip">${esc(t.projectTags[0])}</span>` : ''}
        ${t.checklist.length ? `<span class="l-chip">☑ ${t.checklist.length}</span>` : ''}
        ${d ? `<span class="l-chip">${esc(fmt(d))}</span>` : ''}
        ${partner ? `<button type="button" class="l-who" data-act="who" title="Для: ${esc(p.name)} — нажми, чтобы сменить">${ava(p)}</button>` : ''}
      </li>`;
    }).join('') || (area.value.trim() ? '<li class="dim">Не нашла задач в этом тексте.</li>' : '');
    const n = chosen().length;
    $('l-save').disabled = !n;
    $('l-save').innerHTML = n > 1 ? `Создать ${n} <kbd>⌘↵</kbd>` : 'Создать <kbd>⌘↵</kbd>';
  };
  const reparse = () => {
    s.items = parseTaskList(area.value, { people });
    s.skip = new Set();
    s.flip = new Set();
    draw();
  };

  // вставка и перетаскивание: из HTML восстанавливаем маркеры и вложенность
  const insert = (chunk) => {
    const a = area.selectionStart ?? area.value.length;
    const b = area.selectionEnd ?? area.value.length;
    const before = area.value.slice(0, a);
    const glue = before && !before.endsWith('\n') && chunk.includes('\n') ? '\n' : '';
    area.value = before + glue + chunk + area.value.slice(b);
    reparse();
  };
  area.addEventListener('input', reparse);
  area.addEventListener('paste', (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!htmlHasStructure(html)) return;
    e.preventDefault();
    insert(htmlToListText(html));
  });
  $panel.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('drop'); });
  $panel.addEventListener('dragleave', (e) => { if (!$panel.contains(e.relatedTarget)) area.classList.remove('drop'); });
  $panel.addEventListener('drop', (e) => {
    area.classList.remove('drop');
    const chunk = listTextFrom(e.dataTransfer.getData('text/plain'), e.dataTransfer.getData('text/html'));
    if (!chunk) return;
    e.preventDefault();
    insert(chunk);
  });

  $('l-preview').addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    const li = e.target.closest('[data-i]');
    if (!b || !li) return;
    const i = +li.dataset.i;
    const set = b.dataset.act === 'skip' ? s.skip : s.flip;
    set.has(i) ? set.delete(i) : set.add(i);
    draw();
  });
  $('l-who').addEventListener('click', (e) => {
    const b = e.target.closest('[data-who]');
    if (!b) return;
    s.who = b.dataset.who;
    $('l-who').querySelectorAll('[data-who]').forEach((x) => x.classList.toggle('on', x === b));
    prefs.set({ who: s.who });
    draw();
  });
  $('l-dl').addEventListener('click', (e) => {
    const b = e.target.closest('[data-key]');
    if (!b) return;
    s.deadline = b.dataset.key;
    $('l-dl').querySelectorAll('[data-key]').forEach((x) => x.classList.toggle('on', x === b));
    draw();
  });
  $('lf').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('lf').requestSubmit(); }
  });

  $('lf').addEventListener('submit', async (e) => {
    e.preventDefault();
    const list = chosen();
    if (!list.length) return;
    const err = $('l-err');
    err.hidden = true;
    const btn = $('l-save');
    btn.disabled = true;
    btn.textContent = 'Сохраняю…';
    const dl = DEADLINES[s.deadline].date();
    const link = $('l-attach')?.checked ? tab.url : null;
    const made = [];
    try {
      // по одной: если что-то упадёт, уже созданные останутся и их можно отменить
      for (const [t, i] of list) {
        const data = toTaskData({ ...t, who: whoOf(t, i) }, { me, partner, authorUid: me.uid, defaults: { deadline: dl, link } });
        data.deadline = data.deadline ? new Date(data.deadline).toISOString() : null;
        made.push(await call('createTask', { data }));
      }
      const names = made.map((r) => r.title);
      renderDone({
        heading: made.length === 1 ? 'Задача создана' : `Создано задач: ${made.length}`,
        title: names.length > 3 ? `${names.slice(0, 3).join(', ')} и ещё ${names.length - 3}` : names.join(', '),
        taskId: made.length === 1 ? made[0].id : null,
        undo: () => Promise.all(made.map((r) => call('undoTask', { id: r.id, notifId: r.notifId }))),
      });
    } catch (ex) {
      if (ex.code === 'NOT_SIGNED_IN') return renderSignIn(ex.message);
      err.textContent = `Не сохранилось${made.length ? ` (создано ${made.length} из ${list.length})` : ''}: ${ex.message}`;
      err.hidden = false;
      btn.disabled = false;
      btn.innerHTML = 'Создать <kbd>⌘↵</kbd>';
    }
  });

  reparse();
}

/* ---------- общий каркас: шапка, вкладки, подвал ---------- */
function renderMain(status, tab, saved, pending = null) {
  const { me } = status;
  const { media, product } = tab;
  // текст для вкладки «Списком»: из меню «Разобрать в задачи» или выделение
  const listText = pending ?? listTextFrom(tab.selection, tab.selectionHtml);
  // сама выбирается, только если выделен именно список (пункты или заголовки), а не абзацы
  const isList = !!pending || ((htmlHasStructure(tab.selectionHtml) || /^\s*(?:[-*+•]|\d{1,3}[.)])\s/m.test(tab.selection))
    && parseTaskList(listText).length > 1);
  // по умолчанию: список — «Списком», фильм/игра — Мурмур, товар — вишлист; если что-то выделено — задача
  const picked = !tab.selection.trim();
  let current = isList ? 'list' : picked && media ? 'murmur' : picked && product ? 'wish' : 'task';
  const TABS = [...(media ? [['murmur', '🎬 Мурмур']] : []), ['wish', '🎁 Вишлист'], ['task', '✓ Задача'], ['list', '☰ Списком']];
  const HEAD = { murmur: 'В Мурмур', wish: 'В вишлист', task: 'Новая задача', list: 'Задачи списком' };
  const FOCUS = { murmur: 'm-title', wish: 'w-title', task: 'title', list: 'l-text' };
  $app.innerHTML = `
    <header class="head">
      ${ava(me)}
      <h1 id="heading"></h1>
      <button type="button" class="icon-btn" id="open" title="Открыть трекер" aria-label="Открыть трекер">↗</button>
    </header>
    <div class="tabs" role="tablist" style="grid-template-columns: repeat(${TABS.length}, 1fr)">
      ${TABS.map(([k, l]) => `<button type="button" role="tab" data-tab="${k}">${l}</button>`).join('')}
    </div>
    <section id="p-murmur" hidden></section>
    <section id="p-wish" hidden></section>
    <section id="p-task" hidden></section>
    <section id="p-list" hidden></section>
    <footer class="foot">
      <span class="dim">${esc(me.name)}</span>
      <button type="button" class="link-btn" id="signout">выйти</button>
    </footer>`;

  const $ = (id) => document.getElementById(id);
  renderTaskForm($('p-task'), status, tab, saved);
  if (media) renderMurmurForm($('p-murmur'), status, media);
  renderWishForm($('p-wish'), status, tab);
  renderListForm($('p-list'), status, isList ? listText : '', tab, saved);

  const show = (name) => {
    current = name;
    ['task', 'murmur', 'wish', 'list'].forEach((k) => { $(`p-${k}`).hidden = name !== k; });
    $('heading').textContent = HEAD[name];
    $app.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    const input = $(FOCUS[name]);
    autoGrow(input); // в скрытой панели высоту не посчитать — считаем при показе
    input.focus();
    if (name !== 'list') input.select();
  };
  $app.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => show(b.dataset.tab)));
  $('open').addEventListener('click', () => { call('openApp', { tab: { murmur: 'murmur', wish: 'wishlist' }[current] }); window.close(); });
  $('signout').addEventListener('click', async () => { await call('signOut'); renderSignIn(); });
  show(current);
}

/* ---------- готово ---------- */
// heading — заголовок, title — что сохранили; taskId / openTab — куда ведёт «Открыть»;
// undo — функция отмены (если её нет, кнопки «Отменить» не будет).
function renderDone({ heading, title, taskId, openTab, undo }) {
  $app.innerHTML = `
    <div class="done">
      <div class="check">✓</div>
      <h1>${esc(heading)}</h1>
      <p class="dim">${esc(title)}</p>
      <div class="actions">
        <button class="btn" id="open">Открыть</button>
        <button class="btn" id="more">Ещё</button>
        ${undo ? '<button class="btn btn-ghost" id="undo">Отменить</button>' : ''}
      </div>
    </div>`;
  // Закрываемся сами, если человек не тянется к кнопкам.
  let timer = setTimeout(() => window.close(), 1800);
  $app.addEventListener('mouseenter', () => clearTimeout(timer), { once: true });
  document.getElementById('open').onclick = () => { call('openApp', { taskId, tab: openTab }); window.close(); };
  document.getElementById('more').onclick = () => { clearTimeout(timer); start({ blank: true }); };
  if (undo) {
    document.getElementById('undo').onclick = async (e) => {
      clearTimeout(timer);
      e.target.disabled = true;
      await undo().catch(() => {});
      $app.querySelector('h1').textContent = 'Отменено';
      timer = setTimeout(() => window.close(), 900);
    };
  }
}

/* ---------- тема ----------
   Та же тема и акцент, что выбраны в приложении (userState.ui). Последнюю
   известную держим в chrome.storage, чтобы окно не мигало при открытии. */
const THEMES = ['academia', 'cyberpunk', 'rowan', 'dusk'];
function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return false;
  const n = parseInt(m[1], 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}
function applyUi(ui) {
  const root = document.documentElement;
  root.dataset.theme = THEMES.includes(ui?.theme) ? ui.theme : 'academia';
  if (ui?.accent) {
    root.style.setProperty('--accent', ui.accent);
    root.style.setProperty('--accent-ink', isLight(ui.accent) ? 'var(--ink-dark)' : 'var(--ink-light)');
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-ink');
  }
}
async function syncUi(cached) {
  try {
    const ui = await call('ui');
    if (ui && JSON.stringify(ui) !== JSON.stringify(cached)) { applyUi(ui); prefs.set({ ui }); }
  } catch { /* нет сети — остаёмся на кэше */ }
}

/* ---------- старт ---------- */
// Выделение, отправленное из меню «Разобрать в задачи» (живёт пару минут).
async function takePendingList() {
  try {
    const { pendingList: p } = await chrome.storage.session.get('pendingList');
    if (!p) return null;
    await chrome.storage.session.remove('pendingList');
    if (Date.now() - p.at > 2 * 60 * 1000) return null;
    return { text: listTextFrom(p.text, p.html), url: p.url };
  } catch {
    return null;
  }
}

async function start({ blank = false } = {}) {
  const saved = await prefs.get();
  applyUi(saved.ui);
  try {
    const [status, tab, pending] = await Promise.all([call('status'), readTab(), blank ? null : takePendingList()]);
    if (!status.me) return renderSignIn();
    syncUi(saved.ui);
    // отдельное окошко (если панель не открылась): активная вкладка — сама форма, адрес берём из меню
    const t = pending && new URLSearchParams(location.search).has('list')
      ? { ...tab, url: pending.url, title: '', selection: '', selectionHtml: '', media: null, product: null }
      : tab;
    renderMain(status, blank ? { ...t, title: '', selection: '', selectionHtml: '', media: null, product: null } : t, saved, pending?.text ?? null);
  } catch (e) {
    renderSignIn(e.message);
  }
}

start();
