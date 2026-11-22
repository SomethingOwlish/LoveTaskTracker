import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { reportError } from '../lib/toast';
import { TaskCard } from './TaskCard';
import { MatrixView } from './MatrixView';
import { Avatar } from './Avatar';
import { Seg, loadPref, savePref } from './Sheet';
import { MoodTodayWidget } from './Mood';
import { isActive, isClosed, projectsOf, toDate, startOfToday, endOfToday, fmtDate, fmtWeekday } from '../lib/util';
import { createTask, subscribeClosedTasks } from '../lib/db';
import { parseTaskList, toTaskData, htmlHasStructure, htmlToListText } from '../lib/taskImport';
import { spreadDates } from '../lib/bulk';
import { BulkCtx, BulkBar, SelectGroup, useBulkOrder, useBulkState, useIsDesktop } from './Bulk';

// Календарь тяжелее списков — грузим, только когда открыли вкладку.
const CalendarView = lazy(() => import('./CalendarView').then((m) => ({ default: m.CalendarView })));
const MODES = ['today', 'list', 'matrix', 'calendar'];

export function TasksView({ tasks, me, users, userOf, onOpen, onNew, projectColors, moods, moodLegends, initialMode, calendarProjects }) {
  const [mode, setModeState] = useState(() => {
    if (MODES.includes(initialMode)) return initialMode;
    const saved = loadPref('tasksMode', 'today');
    return MODES.includes(saved) ? saved : 'today';
  });
  const bulk = useBulkState();
  const desktop = useIsDesktop();
  const setMode = (m) => { setModeState(m); savePref('tasksMode', m); bulk.stop(); };
  const partner = users.find((u) => u.uid !== me.uid);
  const canBulk = desktop && (mode === 'today' || mode === 'list');
  useEffect(() => { if (!canBulk && bulk.on) bulk.stop(); }, [canBulk, bulk]);

  return (
    <BulkCtx.Provider value={canBulk ? bulk : null}>
    <div>
      <Seg
        value={mode}
        onChange={setMode}
        options={[['today', 'Сегодня'], ['list', 'Все'], ['matrix', 'Матрица'], ['calendar', 'Календарь']]}
        className="mb tasks-seg"
      />

      {/* пакетное редактирование — только на компьютере */}
      {canBulk && !bulk.on && (
        <button type="button" className="btn btn-sm btn-ghost bulk-start" onClick={bulk.start}>
          <i className="fa-regular fa-square-check" /> Выбрать несколько
        </button>
      )}

      {(mode === 'today' || mode === 'list') && (
        <QuickAdd me={me} partner={partner} deadline={mode === 'today' ? endOfToday : null} projects={projectsOf(tasks, me.uid)} />
      )}

      {mode === 'today' && (
        <TodayList tasks={tasks} me={me} partner={partner} userOf={userOf} onOpen={onOpen}
          projectColors={projectColors} moods={moods} moodLegends={moodLegends} />
      )}
      {mode === 'list' && (
        <AllList tasks={tasks} me={me} userOf={userOf} onOpen={onOpen} projectColors={projectColors} />
      )}
      {mode === 'matrix' && (
        <MatrixView tasks={tasks} me={me} users={users} onOpen={onOpen} projectColors={projectColors} />
      )}
      {mode === 'calendar' && (
        <Suspense fallback={<div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>}>
          <CalendarView tasks={tasks} me={me} users={users} moodLegends={moodLegends} onOpen={onOpen}
            projectColors={projectColors} calendarProjects={calendarProjects} />
        </Suspense>
      )}

      {/* В календаре своя кнопка «+ событие» у выбранного дня — вторая плавающая
          кнопка там только мешала бы. */}
      {mode !== 'calendar' && onNew && !bulk.on && (
        <button className="fab" onClick={onNew} aria-label="Новая задача (подробно)"><i className="fa-solid fa-plus" /></button>
      )}

      {canBulk && <BulkBar tasks={tasks} me={me} partner={partner} />}
    </div>
    </BulkCtx.Provider>
  );
}

/* ---------- Быстрое создание ----------
   Каждая строка или пункт списка — отдельная задача. Можно вставить или
   перетащить сюда список из артефакта Claude: вложенные пункты станут
   чеклистом, «## заголовок» — проектом, «@Гусик» — кому, «завтра» / «до 20.11»
   — сроком, «!» — важным (см. lib/taskImport). */
function QuickAdd({ me, partner, deadline, projects = [] }) {
  const [text, setText] = useState('');
  const [impProject, setImpProject] = useState(''); // проект для всех, у кого не указан
  const [spread, setSpread] = useState(false); // раскидать по дням с завтра
  const [spreadPer, setSpreadPer] = useState(1);
  const [toPartner, setToPartner] = useState(false);
  const [flash, setFlash] = useState('');
  const [drag, setDrag] = useState(false);
  const [skip, setSkip] = useState(() => new Set()); // снятые галочки в предпросмотре
  const [flip, setFlip] = useState(() => new Set()); // кому поменяли вручную
  const ref = useRef(null);

  const people = useMemo(
    () => [{ key: 'me', name: me.name }, ...(partner ? [{ key: 'partner', name: partner.name }] : [])],
    [me.name, partner?.name],
  );
  const parsed = useMemo(() => parseTaskList(text, { people }), [text, people]);
  const defaultWho = toPartner && partner ? 'partner' : 'me';
  const whoOf = (t, i) => {
    const w = t.who || defaultWho;
    return flip.has(i) && partner ? (w === 'me' ? 'partner' : 'me') : w;
  };
  const chosen = parsed.map((t, i) => [t, i]).filter(([, i]) => !skip.has(i));
  // предпросмотр — когда задач несколько или в строке нашлось что-то кроме названия
  const rich = parsed.length > 1 || parsed.some((t) => t.checklist.length || t.who || t.deadline || t.important || t.projectTags.length || t.link);

  const change = (v) => {
    setText(v);
    setSkip(new Set());
    setFlip(new Set());
  };
  const toggle = (setter, i) => setter((s) => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; });

  // «Раскидать»: задачи без своего срока по очереди встают на дни с завтра
  const spreadAt = useMemo(() => {
    const m = new Map();
    if (!spread) return m;
    const idx = chosen.filter(([t]) => !t.deadline).map(([, i]) => i);
    const start = new Date(); start.setDate(start.getDate() + 1);
    spreadDates(idx.length, { start, perDay: +spreadPer || 1 }).forEach((d, k) => m.set(idx[k], d));
    return m;
  }, [spread, spreadPer, chosen.map(([, i]) => i).join(','), parsed]); // eslint-disable-line react-hooks/exhaustive-deps
  const dateOf = (t, i) => t.deadline || spreadAt.get(i) || (deadline ? deadline() : null);
  const projectOf = (t) => (t.projectTags.length ? t.projectTags : impProject.trim() ? [impProject.trim().replace(/^#/, '')] : []);

  const submit = () => {
    if (!chosen.length) return;
    // не ждём ответа сервера — задачи появятся сразу из локального кэша
    chosen.forEach(([t, i]) => {
      const data = toTaskData({ ...t, who: whoOf(t, i), deadline: dateOf(t, i), projectTags: projectOf(t) }, { me, partner, authorUid: me.uid });
      createTask(data).catch((e) => reportError(e, 'Не сохранилось'));
    });
    setFlash(chosen.length === 1 ? 'Добавлено' : `Добавлено: ${chosen.length}`);
    setTimeout(() => setFlash(''), 1500);
    change('');
    setImpProject('');
    setSpread(false);
    ref.current?.focus();
  };

  // Перетащили или вставили отрисованный список: в text/plain браузер теряет
  // маркеры и отступы, поэтому, если есть HTML со списком, берём его.
  const fromTransfer = (dt) => {
    const html = dt.getData('text/html');
    if (htmlHasStructure(html)) return htmlToListText(html, people);
    return dt.getData('text/plain');
  };
  const insert = (chunk) => {
    const el = ref.current;
    const at = el && document.activeElement === el ? el.selectionStart : text.length;
    const end = el && document.activeElement === el ? el.selectionEnd : text.length;
    const before = text.slice(0, at);
    const glue = before && !before.endsWith('\n') && chunk.includes('\n') ? '\n' : '';
    change(before + glue + chunk + text.slice(end));
  };
  const onPaste = (e) => {
    const html = e.clipboardData?.getData('text/html');
    if (!htmlHasStructure(html)) return; // обычная вставка
    e.preventDefault();
    insert(htmlToListText(html, people));
  };
  const onDrop = (e) => {
    setDrag(false);
    const chunk = fromTransfer(e.dataTransfer);
    if (!chunk) return;
    e.preventDefault();
    insert(chunk);
    ref.current?.focus();
  };

  const who = defaultWho === 'partner' ? partner : me;
  const personOf = (k) => (k === 'partner' && partner ? partner : me);

  return (
    <div
      className={`quick-add ${drag ? 'drag' : ''}`}
      onDragOver={(e) => { if ([...e.dataTransfer.types].some((t) => t.startsWith('text/'))) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDrag(false); }}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="qa-who"
        onClick={() => setToPartner((v) => !v)}
        aria-label={`Исполнитель: ${who.name}. Нажми, чтобы сменить`}
        title={`Для: ${who.name}`}
      >
        <Avatar email={who.email} avatar={who.avatar} />
      </button>
      <textarea
        ref={ref}
        className="qa-input"
        rows={Math.min(5, Math.max(1, text.split('\n').length))}
        value={text}
        placeholder={drag ? 'Отпусти — разберу на задачи' : deadline ? 'Задача на сегодня…' : 'Быстрая задача…'}
        enterKeyHint="done"
        onChange={(e) => change(e.target.value)}
        onPaste={onPaste}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <button type="button" className="qa-send" onClick={submit} disabled={!chosen.length} aria-label="Создать">
        {flash ? <i className="fa-solid fa-check" /> : chosen.length > 1 ? `+${chosen.length}` : <i className="fa-solid fa-arrow-up" />}
      </button>
      {rich && (
        <ul className="qa-preview">
          {parsed.map((t, i) => {
            const off = skip.has(i);
            const p = personOf(whoOf(t, i));
            const dl = dateOf(t, i);
            const proj = projectOf(t)[0];
            return (
              <li key={i} className={off ? 'off' : ''}>
                <button type="button" className={`check ${off ? '' : 'on'}`} onClick={() => toggle(setSkip, i)}
                  aria-label={off ? 'Добавить эту задачу' : 'Не добавлять эту задачу'}>{off ? '' : '✓'}</button>
                <span className="qa-p-title">{t.important && <b className="qa-p-imp">!</b>}{t.title}</span>
                <span className="qa-p-meta">
                  {proj && <span className="qa-p-chip">{proj}</span>}
                  {t.checklist.length > 0 && <span className="qa-p-chip"><i className="fa-solid fa-list-check" /> {t.checklist.length}</span>}
                  {t.link && <i className="fa-solid fa-link" title={t.link} />}
                  {t.description && <i className="fa-solid fa-align-left" title={t.description} />}
                  {dl && <span className="qa-p-chip">{fmtDate(dl)}</span>}
                  {partner ? (
                    <button type="button" className="qa-p-who" onClick={() => toggle(setFlip, i)} title={`Для: ${p.name}. Нажми, чтобы сменить`}>
                      <Avatar email={p.email} avatar={p.avatar} />
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {parsed.length > 1 && (
        <div className="qa-opts">
          <label>Проект
            <input className="input" list="qa-projects" value={impProject} placeholder="для задач без проекта"
              onChange={(e) => setImpProject(e.target.value)} />
          </label>
          <datalist id="qa-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
          <label className="qa-opt-check">
            <input type="checkbox" checked={spread} onChange={(e) => setSpread(e.target.checked)} />
            раскидать по дням с завтра, по
            <input type="number" min="1" max="20" className="input qa-num" value={spreadPer} disabled={!spread}
              onChange={(e) => setSpreadPer(e.target.value)} />
            в день
          </label>
        </div>
      )}
      {rich
        ? <div className="qa-hint">Сними галочку, если задача не нужна · аватар — сменить исполнителя</div>
        : text.includes('\n') && <div className="qa-hint">Каждая строка станет отдельной задачей · для: {who.name}</div>}
    </div>
  );
}

/* ---------- Сегодня ---------- */
function TodayList({ tasks, me, partner, userOf, onOpen, projectColors, moods, moodLegends }) {
  const [scope, setScopeState] = useState(() => loadPref('todayScope', 'mine'));
  const setScope = (s) => { setScopeState(s); savePref('todayScope', s); };
  const [showDone, setShowDone] = useState(false);

  const { overdue, today, review, done } = useMemo(() => {
    const t0 = startOfToday();
    const t1 = new Date(t0); t1.setDate(t1.getDate() + 1);
    const mineOnly = (t) => scope === 'all' || t.assigneeUid === me.uid;
    const r = { overdue: [], today: [], review: [], done: [] };
    tasks.forEach((t) => {
      const dl = toDate(t.deadline);
      if (isActive(t) && mineOnly(t)) {
        if (t.status === 'in_review' && t.authorUid === me.uid) return r.review.push(t);
        if (dl && dl < t0) r.overdue.push(t);
        else if (dl && dl < t1) r.today.push(t);
      } else if (isClosed(t) && mineOnly(t)) {
        const c = toDate(t.completedAt);
        if (!c || c >= t0) r.done.push(t); // !c — только что закрыли, сервер ещё не ответил
      }
    });
    const byDl = (a, b) => (toDate(a.deadline) || 0) - (toDate(b.deadline) || 0);
    r.overdue.sort(byDl); r.today.sort(byDl);
    return r;
  }, [tasks, scope, me.uid]);

  const now = new Date();
  const total = today.length + overdue.length;
  useBulkOrder([...review, ...overdue, ...today, ...done].map((t) => t.id));
  const ids = (l) => l.map((t) => t.id);
  const card = (t) => <TaskCard key={t.id} task={t} me={me} userOf={userOf} onOpen={onOpen} projectColors={projectColors} compact />;

  return (
    <div>
      <div className="today-head">
        <div>
          <div className="today-date">{fmtDate(now)}</div>
          <div className="today-sub">{fmtWeekday(now)} · {total ? `${total} в плане` : 'план пуст'}{done.length ? ` · ${done.length} готово` : ''}</div>
        </div>
        <div className="seg seg-sm">
          <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>Мои</button>
          <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Наши</button>
        </div>
      </div>

      {(total + done.length) > 0 && (
        <div className="progress" aria-label="Прогресс дня">
          <span style={{ width: `${(done.length / (total + done.length)) * 100}%` }} />
        </div>
      )}

      <MoodTodayWidget me={me} partner={partner} moods={moods} legends={moodLegends} />

      {review.length > 0 && <><div className="section-title warn">Ждут твоей проверки · {review.length} <SelectGroup ids={ids(review)} /></div>{review.map(card)}</>}
      {overdue.length > 0 && <><div className="section-title bad">Просрочено · {overdue.length} <SelectGroup ids={ids(overdue)} /></div>{overdue.map(card)}</>}
      {today.length > 0 && <><div className="section-title">На сегодня · {today.length} <SelectGroup ids={ids(today)} /></div>{today.map(card)}</>}

      {total === 0 && review.length === 0 && (
        <div className="empty">На сегодня ничего нет. Впиши задачу в строку сверху — она встанет на сегодня.</div>
      )}

      {done.length > 0 && (
        <>
          <button className="section-title as-btn" onClick={() => setShowDone((v) => !v)}>
            Сделано сегодня · {done.length} <i className={`fa-solid fa-chevron-${showDone ? 'up' : 'down'}`} />
          </button>
          {showDone && done.map(card)}
        </>
      )}
    </div>
  );
}

/* ---------- Все задачи (прежний список с фильтрами) ---------- */
function AllList({ tasks, me, userOf, onOpen, projectColors }) {
  const [filter, setFilter] = useState('active');
  const projects = useMemo(() => projectsOf(tasks, me.uid), [tasks, me.uid]);
  const [project, setProject] = useState(null);

  // Архив закрытых грузим только когда открыли фильтр «Закрытые»:
  // в живом списке есть лишь закрытые с начала недели.
  const [closed, setClosed] = useState(null);
  useEffect(() => {
    if (filter !== 'done') return;
    return subscribeClosedTasks(setClosed);
  }, [filter]);

  const list = useMemo(() => {
    let r = filter === 'done' && closed ? closed : tasks;
    if (filter === 'active') r = r.filter(isActive);
    else if (filter === 'mine') r = r.filter((t) => t.assigneeUid === me.uid && isActive(t));
    else if (filter === 'partner') r = r.filter((t) => t.assigneeUid !== me.uid && isActive(t));
    else if (filter === 'review') r = r.filter((t) => t.status === 'in_review' && t.authorUid === me.uid);
    else if (filter === 'nodate') r = r.filter((t) => isActive(t) && !t.deadline);
    else if (filter === 'done') r = r.filter(isClosed);
    if (project) r = r.filter((t) => (t.projectTags || []).includes(project));
    return r;
  }, [tasks, closed, filter, project, me.uid]);

  const reviewCount = tasks.filter((t) => t.status === 'in_review' && t.authorUid === me.uid).length;
  useBulkOrder(list.map((t) => t.id));

  const F = [
    ['active', 'Активные'],
    ['mine', 'Мои'],
    ['partner', 'Партнёра'],
    ['nodate', 'Без срока'],
    ['review', `На проверке${reviewCount ? ' · ' + reviewCount : ''}`],
    ['done', 'Закрытые'],
  ];

  return (
    <div>
      <div className="filters">
        {F.map(([k, l]) => (
          <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {projects.length > 0 && (
        <div className="filters">
          <button className={`pill ${!project ? 'on' : ''}`} onClick={() => setProject(null)}>Все проекты</button>
          {projects.map((p) => (
            <button key={p} className={`pill ${project === p ? 'on' : ''}`} onClick={() => setProject(p)}>{p}</button>
          ))}
        </div>
      )}

      {filter === 'done' && !closed ? (
        <div className="empty"><i className="fa-solid fa-spinner fa-spin" /> Загружаю архив…</div>
      ) : list.length === 0 ? (
        <div className="empty">Здесь пусто.</div>
      ) : (
        <>
          <div className="bulk-all"><SelectGroup ids={list.map((t) => t.id)} /></div>
          {list.map((t) => <TaskCard key={t.id} task={t} me={me} userOf={userOf} onOpen={onOpen} projectColors={projectColors} />)}
        </>
      )}
      {filter === 'done' && closed && closed.length >= 100 && <p className="hint" style={{ textAlign: 'center' }}>Показаны последние 100 закрытых.</p>}
    </div>
  );
}
