import { useState } from 'react';
import { isClosed } from '../lib/util';

export function MatrixView({ tasks, me, users, onOpen, projectColors = {} }) {
  const [scope, setScope] = useState('all'); // all | mine | partner
  const partner = users.find((u) => u.uid !== me.uid);

  const active = tasks.filter((t) => {
    if (isClosed(t)) return false;
    if (scope === 'mine') return t.assigneeUid === me.uid;
    if (scope === 'partner') return t.assigneeUid !== me.uid;
    return true;
  });

  return (
    <div className="matrix-wrap">
      <div className="seg" style={{ marginBottom: 10 }}>
        <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>Мои</button>
        <button className={scope === 'partner' ? 'on' : ''} onClick={() => setScope('partner')}>{partner?.name || 'Партнёр'}</button>
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Все</button>
      </div>

      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 4px' }}>
        Слева — важно, сверху — срочно. Точка задачи на координатной сетке.
      </p>
      <div className="matrix">
        <span className="axislabel lbl-top">Срочно</span>
        <span className="axislabel lbl-bottom">Не срочно</span>
        <span className="axislabel lbl-left">Важно</span>
        <span className="axislabel lbl-right">Не важно</span>

        <div className="axis-v" />
        <div className="axis-h" />

        <span className="q-label q-tl">Делать<br />сейчас</span>
        <span className="q-label q-tr">Делегировать</span>
        <span className="q-label q-bl">Запланировать</span>
        <span className="q-label q-br">Можно<br />не делать</span>

        {active.map((t) => {
          const imp = t.priorityMatrix?.importance ?? 0;
          const urg = t.priorityMatrix?.urgency ?? 0;
          const left = 50 - imp * 9;
          const top = 50 - urg * 9;
          const proj = (t.projectTags || [])[0];
          const color = (proj && projectColors[proj]) || 'var(--accent)';
          return (
            <button
              key={t.id}
              className="dot"
              style={{ left: `${left}%`, top: `${top}%`, background: color }}
              title={t.title}
              onClick={() => onOpen(t)}
            >
              {t.title.slice(0, 1).toUpperCase()}
            </button>
          );
        })}
      </div>
      {active.length === 0 && <p className="empty">Активных задач нет — сетка пустая.</p>}
    </div>
  );
}
