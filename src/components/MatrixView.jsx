import { useRef, useState } from 'react';
import { isClosed } from '../lib/util';
import { updateTask } from '../lib/db';
import { reportError, toast } from '../lib/toast';

// позиция в % ↔ важность/срочность (-5…5, шаг 9% от центра)
const toScore = (pct) => Math.max(-5, Math.min(5, Math.round((50 - pct) / 9)));

export function MatrixView({ tasks, me, users, onOpen, projectColors = {} }) {
  const [scope, setScope] = useState('all'); // all | mine | partner
  // Перетаскивание точки: пальцем тащишь задачу в другой квадрант, при
  // отпускании сохраняются новые важность/срочность. Короткое касание — открыть.
  const boxRef = useRef(null);
  const [drag, setDrag] = useState(null); // { id, left, top, moved }
  const startDrag = (e, t, left, top) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* палец уже отпущен */ }
    setDrag({ id: t.id, left, top, x: e.clientX, y: e.clientY, moved: false });
  };
  const moveDrag = (e) => {
    if (!drag) return;
    const r = boxRef.current.getBoundingClientRect();
    const moved = drag.moved || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6;
    const left = Math.max(2, Math.min(98, ((e.clientX - r.left) / r.width) * 100));
    const top = Math.max(2, Math.min(98, ((e.clientY - r.top) / r.height) * 100));
    setDrag({ ...drag, left, top, moved });
  };
  const endDrag = (t) => {
    const d = drag;
    setDrag(null);
    if (!d) return;
    if (!d.moved) { onOpen(t); return; }
    const importance = toScore(d.left);
    const urgency = toScore(d.top);
    const prev = t.priorityMatrix || { importance: 0, urgency: 0 };
    if (prev.importance === importance && prev.urgency === urgency) return;
    updateTask(t.id, { priorityMatrix: { importance, urgency } }).catch((e) => reportError(e));
    toast(`«${t.title}»: важность ${importance > 0 ? '+' : ''}${importance}, срочность ${urgency > 0 ? '+' : ''}${urgency}`, {
      ms: 4000, action: { label: 'Отменить', fn: () => updateTask(t.id, { priorityMatrix: prev }).catch((e) => reportError(e)) },
    });
  };
  const partner = users.find((u) => u.uid !== me.uid);

  const active = tasks.filter((t) => {
    if (isClosed(t)) return false;
    if (scope === 'mine') return t.assigneeUid === me.uid;
    if (scope === 'partner') return t.assigneeUid !== me.uid;
    return true;
  });

  // Задачи с одинаковыми координатами (по умолчанию все в 0;0) раскладываем
  // по маленькой спирали вокруг точки, чтобы они не прятались друг под другом.
  const groups = {};
  active.forEach((t) => {
    const imp = t.priorityMatrix?.importance ?? 0;
    const urg = t.priorityMatrix?.urgency ?? 0;
    (groups[`${imp}:${urg}`] ||= { imp, urg, list: [] }).list.push(t);
  });
  const placed = [];
  Object.values(groups).forEach(({ imp, urg, list }) => {
    list.forEach((t, i) => {
      const r = i === 0 ? 0 : 3.2 + 1.1 * Math.floor((i - 1) / 6);
      const a = i * 2.4;
      const left = Math.min(96, Math.max(4, 50 - imp * 9 + r * Math.cos(a)));
      const top = Math.min(96, Math.max(4, 50 - urg * 9 + r * Math.sin(a)));
      placed.push({ t, left, top });
    });
  });

  return (
    <div className="matrix-wrap">
      <div className="seg seg-sm" style={{ marginBottom: 10 }}>
        <button className={scope === 'mine' ? 'on' : ''} onClick={() => setScope('mine')}>Мои</button>
        <button className={scope === 'partner' ? 'on' : ''} onClick={() => setScope('partner')}>{partner?.name || 'Партнёр'}</button>
        <button className={scope === 'all' ? 'on' : ''} onClick={() => setScope('all')}>Все</button>
      </div>

      <p style={{ color: 'var(--text-dim)', fontSize: 13, margin: '0 0 4px' }}>
        Слева — важно, сверху — срочно. Перетащи точку пальцем, чтобы поменять приоритет; коснись — открыть задачу.
      </p>
      <div className="matrix" ref={boxRef}>
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

        {placed.map(({ t, left, top }) => {
          const proj = (t.projectTags || [])[0];
          const color = (proj && projectColors[proj]) || 'var(--accent)';
          return (
            <button
              key={t.id}
              className={`dot ${drag?.id === t.id ? 'dragging' : ''}`}
              style={{
                left: `${drag?.id === t.id ? drag.left : left}%`,
                top: `${drag?.id === t.id ? drag.top : top}%`,
                background: color,
              }}
              title={t.title}
              onPointerDown={(e) => startDrag(e, t, left, top)}
              onPointerMove={moveDrag}
              onPointerUp={() => endDrag(t)}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t); }}
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
