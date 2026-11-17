import { useMemo, useRef, useState } from 'react';
import { TaskCard } from './TaskCard';
import { MatrixView } from './MatrixView';
import { Avatar } from './Avatar';
import { Seg, loadPref, savePref } from './Sheet';
import { MoodTodayWidget } from './Mood';
import { isActive, isClosed, projectsOf, toDate, startOfToday, endOfToday, fmtDate, fmtWeekday } from '../lib/util';
import { createTask } from '../lib/db';

export function TasksView({ tasks, me, users, userOf, onOpen, projectColors, moods, moodLegends, initialMode }) {
  const [mode, setModeState] = useState(() => (['today', 'list', 'matrix'].includes(initialMode) ? initialMode : loadPref('tasksMode', 'today')));
  const setMode = (m) => { setModeState(m); savePref('tasksMode', m); };
  const partner = users.find((u) => u.uid !== me.uid);

  return (
    <div>
      <Seg
        value={mode}
        onChange={setMode}
        options={[['today', 'Сегодня'], ['list', 'Все задачи'], ['matrix', 'Матрица']]}
        className="mb"
      />

      {mode !== 'matrix' && (
        <QuickAdd me={me} partner={partner} deadline={mode === 'today' ? endOfToday : null} />
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
    </div>
  );
}

/* ---------- Быстрое создание: каждая строка — отдельная задача ---------- */
function QuickAdd({ me, partner, deadline }) {
  const [text, setText] = useState('');
  const [toPartner, setToPartner] = useState(false);
  const [flash, setFlash] = useState('');
  const ref = useRef(null);

  const lines = text.split('\n').map((l) => l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);

  const submit = () => {
    if (!lines.length) return;
    const assigneeUid = toPartner && partner ? partner.uid : me.uid;
    const dl = deadline ? deadline() : null;
    // не ждём ответа сервера — задачи появятся сразу из локального кэша
    lines.forEach((title) => {
      createTask({ title, authorUid: me.uid, assigneeUid, deadline: dl }).catch((e) => alert('Не сохранилось: ' + e.message));
    });
    setFlash(lines.length === 1 ? 'Добавлено' : `Добавлено: ${lines.length}`);
    setTimeout(() => setFlash(''), 1500);
    setText('');
    ref.current?.focus();
  };

  const who = toPartner && partner ? partner : me;

  return (
    <div className="quick-add">
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
        placeholder={deadline ? 'Задача на сегодня…' : 'Быстрая задача…'}
        enterKeyHint="done"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
      />
      <button type="button" className="qa-send" onClick={submit} disabled={!lines.length} aria-label="Создать">
        {flash ? <i className="fa-solid fa-check" /> : lines.length > 1 ? `+${lines.length}` : <i className="fa-solid fa-arrow-up" />}
      </button>
      {text.includes('\n') && <div className="qa-hint">Каждая строка станет отдельной задачей · для: {who.name}</div>}
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

      {review.length > 0 && <><div className="section-title warn">Ждут твоей проверки · {review.length}</div>{review.map(card)}</>}
      {overdue.length > 0 && <><div className="section-title bad">Просрочено · {overdue.length}</div>{overdue.map(card)}</>}
      {today.length > 0 && <><div className="section-title">На сегодня · {today.length}</div>{today.map(card)}</>}

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

  const list = useMemo(() => {
    let r = tasks;
    if (filter === 'active') r = r.filter(isActive);
    else if (filter === 'mine') r = r.filter((t) => t.assigneeUid === me.uid && isActive(t));
    else if (filter === 'partner') r = r.filter((t) => t.assigneeUid !== me.uid && isActive(t));
    else if (filter === 'review') r = r.filter((t) => t.status === 'in_review' && t.authorUid === me.uid);
    else if (filter === 'nodate') r = r.filter((t) => isActive(t) && !t.deadline);
    else if (filter === 'done') r = r.filter(isClosed);
    if (project) r = r.filter((t) => (t.projectTags || []).includes(project));
    return r;
  }, [tasks, filter, project, me.uid]);

  const reviewCount = tasks.filter((t) => t.status === 'in_review' && t.authorUid === me.uid).length;

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

      {list.length === 0 ? (
        <div className="empty">Здесь пусто.</div>
      ) : (
        list.map((t) => <TaskCard key={t.id} task={t} me={me} userOf={userOf} onOpen={onOpen} projectColors={projectColors} />)
      )}
    </div>
  );
}
