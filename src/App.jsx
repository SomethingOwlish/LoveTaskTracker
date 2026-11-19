import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { auth, provider } from './firebase';
import { ALLOWED_EMAILS, USERS, userByEmail } from './config';
import {
  subscribeTasks, subscribeNotifications, clearNotifications, pruneNotifications, fetchTask,
  subscribeMoods, subscribeMoodLegends, subscribeMurmur, subscribeUserState, saveUserState,
} from './lib/db';
import { Toasts, OfflineBar } from './components/Toasts';
import { ErrorBoundary } from './components/ErrorBoundary';
import { dayKey } from './lib/util';
import { projectsOf, allTags, tsMs } from './lib/util';
import { Avatar } from './components/Avatar';
import { TasksView } from './components/TasksView';
import { MoodReminder } from './components/Mood';
import { TaskModal } from './components/TaskModal';
import { Inbox, unreadCount } from './components/Inbox';
import { murmurAwaitingMe } from './lib/murmurUtil';

// Редкие вкладки грузим по требованию — первый запуск на телефоне легче.
const ProfileView = lazy(() => import('./components/ProfileView').then((m) => ({ default: m.ProfileView })));
const MurmurView = lazy(() => import('./components/MurmurView').then((m) => ({ default: m.MurmurView })));
const GameView = lazy(() => import('./components/GameView').then((m) => ({ default: m.GameView })));
const BudgetView = lazy(() => import('./components/BudgetView').then((m) => ({ default: m.BudgetView })));
import { loadPref, savePref } from './components/Sheet';

// Ярлык PWA / ссылка вида ?tab=tasks&view=today открывает нужный экран сразу.
const params = new URLSearchParams(window.location.search);
// Календарь живёт вкладкой внутри «Задач»: старые ссылки ?tab=calendar ведут туда.
const RAW_TAB = params.get('tab');
const START_TAB = RAW_TAB === 'calendar' ? 'tasks' : RAW_TAB;
const START_VIEW = RAW_TAB === 'calendar' ? 'calendar' : params.get('view');
// ?task=<id> — открыть задачу сразу (ссылка из уведомления расширения Chrome).
const START_TASK = params.get('task');

const TABS = [
  ['tasks', 'fa-solid fa-list-check', 'Задачи'],
  ['murmur', 'fa-solid fa-film', 'Мурмур'],
  ['budget', 'fa-solid fa-wallet', 'Бюджет'],
  ['game', 'fa-solid fa-paw', 'Игра'],
  ['profile', 'fa-regular fa-user', 'Профиль'],
];

const DEFAULT_ACCENT = { academia: '#d99873', cyberpunk: '#00f2ff', rowan: '#d0342c', dusk: '#8350c4' };
const THEMES = Object.keys(DEFAULT_ACCENT);

// Светлый ли цвет: на светлом акценте текст тёмный, на тёмном — светлый.
function isLight(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return true;
  const n = parseInt(m[1], 16);
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // порог, при котором контраст с белым и с почти-чёрным одинаков
  return L > 0.18;
}

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = грузится, null = нет
  const [tab, setTabState] = useState(() => {
    if (TABS.some(([k]) => k === START_TAB)) return START_TAB;
    const saved = loadPref('tab', 'tasks');
    return TABS.some(([k]) => k === saved) ? saved : 'tasks'; // «calendar» из старой версии
  });
  const setTab = (t) => { setTabState(t); savePref('tab', t); window.scrollTo(0, 0); };
  const [tasks, setTasks] = useState([]);
  const [moods, setMoods] = useState([]);
  const [moodLegends, setMoodLegends] = useState({});
  const [murmur, setMurmur] = useState([]);
  const [pushPrefs, setPushPrefs] = useState(null);
  const [modal, setModal] = useState(null); // null | {} (new) | task (edit)
  const [showInbox, setShowInbox] = useState(false);

  // цвета проектов — у каждого свои (по email), хранятся локально
  const [projectColors, setProjectColors] = useState({});
  // проекты, задачи из которых дублируются в календарь — тоже у каждого свои
  const [calendarProjects, setCalendarProjectsState] = useState([]);

  // уведомления
  const [notifs, setNotifs] = useState([]);
  const [readAt, setReadAt] = useState(0);   // когда в последний раз открывали список
  const [viewedFrom, setViewedFrom] = useState(0); // снимок для подсветки в открытом списке

  // тема и акцент. Акцент храним отдельно для каждой темы — поддерживает свой цвет.
  const savedTheme = localStorage.getItem('theme');
  const initialTheme = THEMES.includes(savedTheme) ? savedTheme : 'academia';
  const [theme, setThemeState] = useState(initialTheme);
  const [accent, setAccent] = useState(() => localStorage.getItem('accent:' + initialTheme) || DEFAULT_ACCENT[initialTheme]);

  const setTheme = (t) => {
    setThemeState(t);
    setAccent(localStorage.getItem('accent:' + t) || DEFAULT_ACCENT[t]);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
    // цвет строки состояния на телефоне — под фон темы
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
  }, [theme]);

  useEffect(() => {
    const root = document.documentElement.style;
    root.setProperty('--accent', accent);
    root.setProperty('--accent-ink', isLight(accent) ? 'var(--ink-dark)' : 'var(--ink-light)');
    localStorage.setItem('accent:' + theme, accent);
  }, [theme, accent]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;
    const unsub = [
      subscribeTasks(setTasks),
      subscribeMoodLegends(setMoodLegends),
      subscribeMurmur(setMurmur),
    ];
    return () => unsub.forEach((u) => u());
  }, [user]);

  // После входа, когда телефон свободен, подгружаем остальные вкладки —
  // service worker их закэширует, и они откроются даже без сети.
  useEffect(() => {
    if (!user) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 2500));
    idle(() => {
      import('./components/CalendarView');
      import('./components/ProfileView');
      import('./components/MurmurView');
      import('./components/BudgetView');
      import('./components/GameView');
    });
  }, [user]);

  // Для виджета «Настроение сегодня» нужна только сегодняшняя дата.
  // Ключ дня обновляется, когда приложение возвращают на экран после полуночи.
  const [today, setToday] = useState(dayKey());
  useEffect(() => {
    const upd = () => setToday(dayKey());
    document.addEventListener('visibilitychange', upd);
    window.addEventListener('focus', upd);
    return () => { document.removeEventListener('visibilitychange', upd); window.removeEventListener('focus', upd); };
  }, []);
  useEffect(() => {
    if (!user) return;
    return subscribeMoods(today, today, setMoods);
  }, [user, today]);

  const me = useMemo(() => {
    if (!user?.email) return null;
    const email = user.email.toLowerCase();
    const info = userByEmail(email);
    return info ? { uid: email, email, name: info.name, avatar: info.avatar } : null;
  }, [user]);

  const users = useMemo(
    () => ALLOWED_EMAILS.map((email) => ({ uid: email, email, name: USERS[email].name, avatar: USERS[email].avatar })),
    []
  );
  const userOf = (uid) => {
    const info = userByEmail(uid);
    return info ? { uid, email: uid, ...info } : { uid, email: uid, name: '?', avatar: 'owl' };
  };

  // Личное состояние (цвета проектов, когда читали уведомления) хранится в
  // Firestore userState/{email} — одинаково на телефоне и на компьютере.
  // localStorage — только запасной вариант до первого ответа сервера.
  useEffect(() => {
    if (!me) return;
    let local = {};
    try { local = JSON.parse(localStorage.getItem('projectColors:' + me.email)) || {}; } catch { /* пусто */ }
    setProjectColors(local);
    setReadAt(Number(localStorage.getItem('notifReadAt:' + me.email)) || 0);
    let migrated = false;
    const unsub = subscribeUserState(me.uid, (st, fromServer) => {
      if (st.projectColors) setProjectColors(st.projectColors);
      setCalendarProjectsState(Array.isArray(st.calendarProjects) ? st.calendarProjects : []);
      if (st.notifReadAt) setReadAt((p) => Math.max(p, st.notifReadAt));
      setPushPrefs(st.push || null);
      // разовый перенос старых локальных настроек в Firestore
      if (fromServer && !migrated) {
        migrated = true;
        const patch = {};
        if (!st.projectColors && Object.keys(local).length) patch.projectColors = local;
        const lr = Number(localStorage.getItem('notifReadAt:' + me.email)) || 0;
        if (lr > (st.notifReadAt || 0)) patch.notifReadAt = lr;
        if (Object.keys(patch).length) saveUserState(me.uid, patch).catch(() => {});
      }
    });
    const unsubN = subscribeNotifications(me.uid, setNotifs);
    return () => { unsub(); unsubN(); };
  }, [me?.uid]);

  // ?task=<id>: один раз дочитываем задачу и открываем её карточку
  useEffect(() => {
    if (!me || !START_TASK) return;
    fetchTask(START_TASK).then((t) => { if (t) setModal(t); }).catch(() => {});
    window.history.replaceState(null, '', window.location.pathname);
  }, [me?.uid]);

  const unread = useMemo(() => unreadCount(notifs, readAt), [notifs, readAt]);
  const murmurBadge = useMemo(() => (me ? murmurAwaitingMe(murmur, me.uid) : 0), [murmur, me?.uid]);

  const openInbox = () => {
    setViewedFrom(readAt);
    setShowInbox(true);
    const now = Date.now();
    pruneNotifications(notifs).catch(() => {});
    setReadAt(now);
    if (me) {
      localStorage.setItem('notifReadAt:' + me.email, String(now));
      saveUserState(me.uid, { notifReadAt: now }).catch(() => {});
    }
  };

  const openFromNotif = async (taskId) => {
    setShowInbox(false);
    // старые закрытые задачи не загружены в живой список — дочитываем по id
    const t = tasks.find((x) => x.id === taskId) || await fetchTask(taskId).catch(() => null);
    if (t) setModal(t);
  };

  const setProjectColor = (project, color) => {
    setProjectColors((prev) => {
      const next = { ...prev, [project]: color };
      if (me) {
        localStorage.setItem('projectColors:' + me.email, JSON.stringify(next));
        saveUserState(me.uid, { projectColors: next }).catch(() => {});
      }
      return next;
    });
  };

  const setCalendarProjects = (list) => {
    setCalendarProjectsState(list);
    if (me) saveUserState(me.uid, { calendarProjects: list }).catch(() => {});
  };

  const projectSuggestions = useMemo(() => (me ? projectsOf(tasks, me.uid) : []), [tasks, me?.uid]);
  const tagSuggestions = useMemo(() => allTags(tasks), [tasks]);

  // ---- состояния входа ----
  if (user === undefined) {
    return <div className="login"><div className="box"><p>Загрузка…</p></div></div>;
  }

  if (!user) {
    const login = async () => {
      try {
        await signInWithPopup(auth, provider);
      } catch (e) {
        if (['auth/popup-blocked', 'auth/cancelled-popup-request', 'auth/operation-not-supported-in-this-environment'].includes(e.code)) {
          await signInWithRedirect(auth, provider);
        } else {
          alert('Не удалось войти: ' + e.message);
        }
      }
    };
    return (
      <div className="login">
        <div className="box">
          <div className="pair">
            <Avatar avatar="owl" size="lg" />
            <Avatar avatar="goose" size="lg" />
          </div>
          <h1>Совушка & Гусик</h1>
          <p>Общий трекер задач на двоих.</p>
          <button className="btn btn-accent btn-block" onClick={login}>Войти через Google</button>
        </div>
      </div>
    );
  }

  if (!me) {
    return (
      <div className="login">
        <div className="box">
          <h1>Нет доступа</h1>
          <p>Этот аккаунт ({user.email}) не в списке. Зайди под нужной почтой.</p>
          <button className="btn btn-block" onClick={() => signOut(auth)}>Сменить аккаунт</button>
        </div>
      </div>
    );
  }

  // ---- основное приложение ----
  return (
    <div className="app">
      <OfflineBar />
      <div className="topbar">
        <div className="brand">
          <Avatar email={me.email} avatar={me.avatar} size="lg" />
          <div>
            <h1>{me.name}</h1>
            <div className="sub">задачи на двоих</div>
          </div>
        </div>
        <button className="bell" onClick={openInbox} aria-label="Уведомления">
          <i className="fa-solid fa-bell" />
          {unread > 0 && <span className="bell-badge">{unread}</span>}
        </button>
      </div>

      <main className="screen" key={tab}>
        <ErrorBoundary key={tab}>
        <Suspense fallback={<div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>}>
        {tab === 'tasks' && (
          <TasksView tasks={tasks} me={me} users={users} userOf={userOf} onOpen={setModal} projectColors={projectColors}
            moods={moods} moodLegends={moodLegends} initialMode={START_VIEW}
            calendarProjects={calendarProjects} onNew={() => setModal({})} />
        )}
        {tab === 'murmur' && <MurmurView items={murmur} me={me} users={users} userOf={userOf} />}
        {tab === 'budget' && <BudgetView me={me} userOf={userOf} />}
        {tab === 'game' && <GameView tasks={tasks} me={me} users={users} />}
        {tab === 'profile' && (
          <ProfileView
            tasks={tasks} me={me} users={users}
            theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent}
            projectColors={projectColors} setProjectColor={setProjectColor} pushPrefs={pushPrefs}
            calendarProjects={calendarProjects} setCalendarProjects={setCalendarProjects}
          />
        )}
        </Suspense>
        </ErrorBoundary>
      </main>

      <nav className="nav">
        {TABS.map(([k, icon, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
            <span className="ico"><i className={icon} />{k === 'murmur' && murmurBadge > 0 && <span className="nav-badge">{murmurBadge}</span>}</span>
            {label}
          </button>
        ))}
      </nav>

      <Toasts />
      <MoodReminder me={me} partner={users.find((u) => u.uid !== me.uid)} moods={moods} legends={moodLegends} />

      {showInbox && (
        <Inbox notifs={notifs} userOf={userOf} viewedFrom={viewedFrom}
          onOpen={openFromNotif}
          onClear={() => clearNotifications(notifs)}
          onClose={() => setShowInbox(false)} />
      )}

      {modal !== null && (
        <TaskModal
          task={modal.id ? modal : null}
          me={me}
          users={users}
          userOf={userOf}
          onClose={() => setModal(null)}
          projectSuggestions={projectSuggestions}
          tagSuggestions={tagSuggestions}
        />
      )}
    </div>
  );
}
