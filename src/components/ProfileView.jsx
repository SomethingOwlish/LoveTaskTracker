import { useState } from 'react';
import { Avatar } from './Avatar';
import { startOfToday, startOfWeek, toDate, isActive, isClosed, projectsOf } from '../lib/util';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';

export const PROJECT_PALETTE = [
  '#d99873', '#c9a24b', '#a4453f', '#85925a', '#bd9a63',
  '#00f2ff', '#ff2bd6', '#39ff8a', '#8a6bff', '#ffae00',
  '#6aa0d8', '#d86a9e',
];

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

export function ProfileView({ tasks, me, users, theme, setTheme, accent, setAccent, projectColors, setProjectColor }) {
  const [view, setView] = useState(me.uid); // чьи смотрим
  const who = users.find((u) => u.uid === view) || me;
  const s = statsFor(tasks, view);
  const myProjects = projectsOf(tasks, me.uid);
  const [editProj, setEditProj] = useState(null);

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

          <div className="section-title">Цвета проектов</div>
          {myProjects.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Появятся, когда заведёшь проекты в задачах.</p>}
          {myProjects.map((p) => (
            <div key={p} style={{ marginBottom: 10 }}>
              <div
                className="row"
                style={{ alignItems: 'center', cursor: 'pointer' }}
                onClick={() => setEditProj(editProj === p ? null : p)}
              >
                <span style={{ width: 16, height: 16, borderRadius: 4, flex: 'none', background: projectColors[p] || 'var(--text-dim)', border: '1px solid var(--border)' }} />
                <span className="chip project" style={{ flex: 'none' }}>{p}</span>
                <span className="spacer" style={{ flex: 1 }} />
                <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>{editProj === p ? 'скрыть' : 'изменить'}</span>
              </div>
              {editProj === p && (
                <div className="swatches" style={{ marginTop: 8 }}>
                  {PROJECT_PALETTE.map((c) => (
                    <span key={c} className={`swatch ${projectColors[p] === c ? 'on' : ''}`} style={{ background: c }} onClick={() => setProjectColor(p, c)} />
                  ))}
                </div>
              )}
            </div>
          ))}

          <button className="btn btn-ghost btn-block" style={{ marginTop: 28, color: 'var(--text-dim)' }} onClick={() => signOut(auth)}>
            Выйти
          </button>
        </>
      )}
    </div>
  );
}

export { ACCENTS };
