import { useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { auth, provider } from './firebase';
import { ALLOWED_EMAILS, USERS, userByEmail } from './config';
import { subscribeTasks, subscribeEvents, subscribeNotifications, clearNotifications } from './lib/db';
import { projectsOf, allTags, tsMs } from './lib/util';
import { Avatar } from './components/Avatar';
import { TasksView } from './components/TasksView';
import { MatrixView } from './components/MatrixView';
import { CalendarView } from './components/CalendarView';
import { ProfileView } from './components/ProfileView';
import { TaskModal } from './components/TaskModal';
import { Inbox, unreadCount } from './components/Inbox';

const DEFAULT_ACCENT = { academia: '#d99873', cyberpunk: '#00f2ff' };

export default function App() {
  const [user, setUser] = useState(undefined); // undefined = грузится, null = нет
  const [tab, setTab] = useState('tasks');
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
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
    const u1 = subscribeTasks(setTasks);
    const u2 = subscribeEvents(setEvents);
    return () => { u1(); u2(); };
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

      {tab === 'tasks' && <TasksView tasks={tasks} me={me} users={users} userOf={userOf} onOpen={setModal} projectColors={projectColors} />}
      {tab === 'matrix' && <MatrixView tasks={tasks} me={me} users={users} onOpen={setModal} projectColors={projectColors} />}
      {tab === 'calendar' && <CalendarView tasks={tasks} events={events} me={me} onOpen={setModal} />}
      {tab === 'profile' && (
        <ProfileView
          tasks={tasks} me={me} users={users}
          theme={theme} setTheme={setTheme} accent={accent} setAccent={setAccent}
          projectColors={projectColors} setProjectColor={setProjectColor}
        />
      )}

      {(tab === 'tasks' || tab === 'matrix') && (
        <button className="fab" onClick={() => setModal({})} aria-label="Новая задача">+</button>
      )}

      <nav className="nav">
        <button className={tab === 'tasks' ? 'active' : ''} onClick={() => setTab('tasks')}>
          <span className="ico">☑</span>Задачи
        </button>
        <button className={tab === 'matrix' ? 'active' : ''} onClick={() => setTab('matrix')}>
          <span className="ico">⊹</span>Матрица
        </button>
        <button className={tab === 'calendar' ? 'active' : ''} onClick={() => setTab('calendar')}>
          <span className="ico">▦</span>Календарь
        </button>
        <button className={tab === 'profile' ? 'active' : ''} onClick={() => setTab('profile')}>
          <span className="ico">◑</span>Профиль
        </button>
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
