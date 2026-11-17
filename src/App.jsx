import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { auth, provider } from './firebase';
import { ALLOWED_EMAILS, USERS, userByEmail } from './config';
import {
  subscribeTasks, subscribeEvents, subscribeNotifications, clearNotifications,
  subscribeMoods, subscribeMoodLegends, subscribeMurmur,
} from './lib/db';
import { projectsOf, allTags, tsMs } from './lib/util';
import { Avatar } from './components/Avatar';
import { TasksView } from './components/TasksView';
import { CalendarView } from './components/CalendarView';
import { ProfileView } from './components/ProfileView';
import { TaskModal } from './components/TaskModal';
import { Inbox, unreadCount } from './components/Inbox';
import { MurmurView, murmurAwaitingMe } from './components/MurmurView';
import { BudgetView } from './components/BudgetView';
import { loadPref, savePref } from './components/Sheet';

// Ярлык PWA / ссылка вида ?tab=tasks&view=today открывает нужный экран сразу.
const params = new URLSearchParams(window.location.search);
const START_TAB = params.get('tab');
const START_VIEW = params.get('view');

const TABS = [
  ['tasks', 'fa-solid fa-list-check', 'Задачи'],
  ['calendar', 'fa-regular fa-calendar', 'Календарь'],
  ['murmur', 'fa-solid fa-film', 'Мурмур'],
  ['budget', 'fa-solid fa-wallet', 'Бюджет'],
  ['profile', 'fa-regular fa-user', 'Профиль'],
];

const DEFAULT_ACCENT = { academia: '#d99873', cyberpunk: '#00f2ff' };

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = грузится, null = нет
  const [tab, setTabState] = useState(() => (TABS.some(([k]) => k === START_TAB) ? START_TAB : loadPref('tab', 'tasks')));
  const setTab = (t) => { setTabState(t); savePref('tab', t); window.scrollTo(0, 0); };
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [moods, setMoods] = useState([]);
  const [moodLegends, setMoodLegends] = useState({});
  const [murmur, setMurmur] = useState([]);
  const [modal, setModal] = useState(null); // null | {} (new) | task (edit)
  const [showInbox, setShowInbox] = useState(false);

  // цвета проектов — у каждого свои (по email), хранятся локально
  const [projectColors, setProjectColors] = useState({});

  // уведомления
  const [notifs, setNotifs] = useState([]);
  const [readAt, setReadAt] = useState(0);   // когда в последний раз открывали список
  const [viewedFrom, setViewedFrom] = useState(0); // снимок для подсветки в открытом списке

  // тема и акцент. Акцент храним отдельно для каждой темы — поддерживает свой цвет.
  const initialTheme = localStorage.getItem('theme') || 'academia';
  const [theme, setThemeState] = useState(initialTheme);
  const [accent, setAccent] = useState(() => localStorage.getItem('accent:' + initialTheme) || DEFAULT_ACCENT[initialTheme]);

  const setTheme = (t) => {
    setThemeState(t);
    setAccent(localStorage.getItem('accent:' + t) || DEFAULT_ACCENT[t]);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accent);
    localStorage.setItem('accent:' + theme, accent);
  }, [theme, accent]);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (!user) return;
    const unsub = [
      subscribeTasks(setTasks),
      subscribeEvents(setEvents),
      subscribeMoods(setMoods),
      subscribeMoodLegends(setMoodLegends),
      subscribeMurmur(setMurmur),
    ];
    return () => unsub.forEach((u) => u());
  }, [user]);

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

  // загрузка цветов проектов для текущего пользователя
  useEffect(() => {
    if (!me) return;
    try {
      setProjectColors(JSON.parse(localStorage.getItem('projectColors:' + me.email)) || {});
    } catch { setProjectColors({}); }
  }, [me?.email]);

  // подписка на уведомления + загрузка времени последнего прочтения
  useEffect(() => {
    if (!me) return;
    setReadAt(Number(localStorage.getItem('notifReadAt:' + me.email)) || 0);
    return subscribeNotifications(me.uid, setNotifs);
  }, [me?.uid]);

  const unread = useMemo(() => unreadCount(notifs, readAt), [notifs, readAt]);
  const murmurBadge = useMemo(() => (me ? murmurAwaitingMe(murmur, me.uid) : 0), [murmur, me?.uid]);

  const openInbox = () => {
    setViewedFrom(readAt);
    setShowInbox(true);
    const now = Date.now();
    setReadAt(now);
    if (me) localStorage.setItem('notifReadAt:' + me.email, String(now));
  };

  const openFromNotif = (taskId) => {
    const t = tasks.find((x) => x.id === taskId);
    setShowInbox(false);
    if (t) setModal(t);
  };

  const setProjectColor = (project, color) => {
    setProjectColors((prev) => {
      const next = { ...prev, [project]: color };
      if (me) localStorage.setItem('projectColors:' + me.email, JSON.stringify(next));
      return next;
    });
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
        {tab === 'tasks' && (
          <TasksView tasks={tasks} me={me} users={users} userOf={userOf} onOpen={setModal} projectColors={projectColors}
            moods={moods} moodLegends={moodLegends} initialMode={START_VIEW} />
        )}
        {tab === 'calendar' && <CalendarView tasks={tasks} events={events} me={me} users={users} moods={moods} moodLegends={moodLegends} onOpen={setModal} />}
        {tab === 'murmur' && <MurmurView items={murmur} me={me} users={users} userOf={userOf} />}
        {tab === 'budget' && <BudgetView me={me} userOf={userOf} />}
        {tab === 'profile' && (
          <ProfileView
            tasks={tasks} me={me} users={users}
            theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent}
            projectColors={projectColors} setProjectColor={setProjectColor}
          />
        )}
      </main>

      {tab === 'tasks' && (
        <button className="fab" onClick={() => setModal({})} aria-label="Новая задача (подробно)"><i className="fa-solid fa-plus" /></button>
      )}

      <nav className="nav">
        {TABS.map(([k, icon, label]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
            <span className="ico"><i className={icon} />{k === 'murmur' && murmurBadge > 0 && <span className="nav-badge">{murmurBadge}</span>}</span>
            {label}
          </button>
        ))}
      </nav>

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
