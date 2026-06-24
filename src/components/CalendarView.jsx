import { useMemo, useState } from 'react';
import { DOW, monthTitle, isSameDay, toDate, fmtDate } from '../lib/util';
import { createEvent, deleteEvent } from '../lib/db';

export function CalendarView({ tasks, events, me, onOpen }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [selected, setSelected] = useState(new Date());

  // Точки в дне: дедлайны задач + события.
  const items = useMemo(() => {
    const list = [];
    tasks.forEach((t) => { const d = toDate(t.deadline); if (d) list.push({ date: d, kind: 'task', ref: t }); });
    events.forEach((e) => { const d = toDate(e.date); if (d) list.push({ date: d, kind: 'event', ref: e }); });
    return list;
  }, [tasks, events]);

  const grid = useMemo(() => {
    const first = new Date(cursor);
    const startDow = (first.getDay() + 6) % 7; // Пн=0
    const days = [];
    const start = new Date(first);
    start.setDate(1 - startDow);
    for (let i = 0; i < 42; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      days.push(d);
    }
    return days;
  }, [cursor]);

  const dayItems = (d) => items.filter((it) => isSameDay(it.date, d));
  const selItems = dayItems(selected);

  const move = (delta) => {
    const n = new Date(cursor);
    n.setMonth(n.getMonth() + delta);
    setCursor(n);
  };

  const addEvent = async () => {
    const title = prompt('Название события');
    if (!title) return;
    const at = new Date(selected);
    at.setHours(12, 0, 0, 0);
    await createEvent({ title, date: at, allDay: true, authorUid: me.uid });
  };

  return (
    <div>
      <div className="cal-head">
        <button className="btn btn-sm" onClick={() => move(-1)}>‹</button>
        <h2>{monthTitle(cursor)}</h2>
        <button className="btn btn-sm" onClick={() => move(1)}>›</button>
      </div>

      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {grid.map((d, i) => {
          const dim = d.getMonth() !== cursor.getMonth();
          const today = isSameDay(d, new Date());
          const sel = isSameDay(d, selected);
          const its = dayItems(d);
          return (
            <div
              key={i}
              className={`cal-cell ${dim ? 'dim' : ''} ${today ? 'today' : ''}`}
              style={sel ? { boxShadow: 'var(--ring)' } : undefined}
              onClick={() => setSelected(new Date(d))}
            >
              <span>{d.getDate()}</span>
              <div className="dots">
                {its.slice(0, 4).map((it, k) => <span key={k} className="ev-dot" />)}
              </div>
            </div>
          );
        })}
      </div>

      <div className="cal-day-list">
        <div className="cal-head">
          <h2 style={{ fontSize: 15 }}>{fmtDate(selected)}</h2>
          <button className="btn btn-sm btn-accent" onClick={addEvent}>+ событие</button>
        </div>
        {selItems.length === 0 && <p className="empty" style={{ padding: 20 }}>На этот день пусто.</p>}
        {selItems.map((it, i) => (
          it.kind === 'task' ? (
            <div key={i} className="task" style={{ marginBottom: 8 }} onClick={() => onOpen(it.ref)}>
              <h3 style={{ fontSize: 14 }}>⌛ {it.ref.title}</h3>
            </div>
          ) : (
            <div key={i} className="card" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}>📌 {it.ref.title}</span>
              <button className="btn btn-sm btn-ghost" style={{ color: 'var(--bad)' }} onClick={() => deleteEvent(it.ref.id)}>×</button>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
