import { useState } from 'react';
import { Avatar } from './Avatar';
import { startOfToday, startOfWeek, toDate, isActive, isClosed } from '../lib/util';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

const ACCENTS = {
  academia: [
    { name: 'Терракота', c: '#d99873' },
    { name: 'Охра', c: '#c9a24b' },
    { name: 'Бордо', c: '#a4453f' },
    { name: 'Олива', c: '#85925a' },
    { name: 'Латунь', c: '#bd9a63' },
  ],
  cyberpunk: [
    { name: 'Циан', c: '#00f2ff' },
    { name: 'Маджента', c: '#ff2bd6' },
    { name: 'Неон', c: '#39ff8a' },
    { name: 'Электрик', c: '#8a6bff' },
    { name: 'Янтарь', c: '#ffae00' },
  ],
};

function statsFor(tasks, uid) {
  const today = startOfToday();
  const week = startOfWeek();
  let open = 0, doneToday = 0, doneWeek = 0;
  tasks.forEach((t) => {
    if (t.assigneeUid !== uid) return;
    if (isActive(t)) open++;
    if (isClosed(t)) {
      const c = toDate(t.completedAt);
      if (c && c >= today) doneToday++;
      if (c && c >= week) doneWeek++;
    }
  });
  return { open, doneToday, doneWeek };
}

export function ProfileView({ tasks, me, users, theme, setTheme, accent, setAccent }) {
  const [view, setView] = useState(me.uid); // чьи смотрим
  const who = users.find((u) => u.uid === view) || me;
  const s = statsFor(tasks, view);

  return (
    <div>
      <div className="seg" style={{ marginBottom: 16 }}>
        {users.map((u) => (
          <button key={u.uid} className={view === u.uid ? 'on' : ''} onClick={() => setView(u.uid)}>
            <Avatar email={u.email} avatar={u.avatar} /> {u.name}
          </button>
        ))}
      </div>

      <div className="profile-hero">
        <Avatar email={who.email} avatar={who.avatar} size="xl" />
        <div>
          <div className="name">{who.name}</div>
          <div className="mail">{who.email}</div>
        </div>
      </div>

      <div className="stats">
        <div className="stat"><div className="n">{s.open}</div><div className="l">Открыто</div></div>
        <div className="stat"><div className="n">{s.doneToday}</div><div className="l">За сегодня</div></div>
        <div className="stat"><div className="n">{s.doneWeek}</div><div className="l">За неделю</div></div>
      </div>

      {view === me.uid && (
        <>
          <div className="section-title">Тема</div>
          <div className="theme-pick">
            <div className={`opt ${theme === 'academia' ? 'on' : ''}`} onClick={() => setTheme('academia')}>Дарк-академия</div>
            <div className={`opt ${theme === 'cyberpunk' ? 'on' : ''}`} onClick={() => setTheme('cyberpunk')}>Киберпанк</div>
          </div>

          <div className="section-title">Акцент</div>
          <div className="swatches">
            {(ACCENTS[theme] || []).map((a) => (
              <span
                key={a.c}
                className={`swatch ${accent === a.c ? 'on' : ''}`}
                style={{ background: a.c }}
                title={a.name}
                onClick={() => setAccent(a.c)}
              />
            ))}
          </div>

          <button className="btn btn-ghost btn-block" style={{ marginTop: 28, color: 'var(--text-dim)' }} onClick={() => signOut(auth)}>
            Выйти
          </button>
        </>
      )}
    </div>
  );
}

export { ACCENTS };
