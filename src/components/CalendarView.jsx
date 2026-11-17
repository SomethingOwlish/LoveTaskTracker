import { useMemo, useState } from 'react';
import { DOW, monthTitle, isSameDay, toDate, fmtDate } from '../lib/util';
import { createEvent, deleteEvent } from '../lib/db';
import { Seg, loadPref, savePref } from './Sheet';
import { MoodCalendar } from './Mood';

export function CalendarView({ tasks, events, me, users, moods, moodLegends, onOpen }) {
  const [mode, setModeState] = useState(() => loadPref('calMode', 'plan'));
  const setMode = (m) => { setModeState(m); savePref('calMode', m); };
  const partner = users.find((u) => u.uid !== me.uid);
  return (
    <div>
      <Seg value={mode} onChange={setMode} options={[['plan', 'План'], ['mood', 'Настроение']]} className="mb" />
      {mode === 'plan'
        ? <PlanCalendar tasks={tasks} events={events} me={me} onOpen={onOpen} />
        : <MoodCalendar me={me} partner={partner} moods={moods} legends={moodLegends} />}
    </div>
  );
}

function PlanCalendar({ tasks, events, me, onOpen }) {
  const [adding, setAdding] = useState(false);
  const [evTitle, setEvTitle] = useState('');
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

  const addEvent = () => {
    const title = evTitle.trim();
    if (!title) return;
    const at = new Date(selected);
    at.setHours(12, 0, 0, 0);
    createEvent({ title, date: at, allDay: true, authorUid: me.uid }).catch((e) => alert(e.message));
    setEvTitle('');
    setAdding(false);
  };

  return (
    <div>
      <div className="cal-head">
        <button className="btn btn-sm icon-btn" onClick={() => move(-1)} aria-label="Предыдущий месяц">‹</button>
        <h2>{monthTitle(cursor)}</h2>
        <button className="btn btn-sm icon-btn" onClick={() => move(1)} aria-label="Следующий месяц">›</button>
      </div>

      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {grid.map((d, i) => {
          const dim = d.getMonth() !== cursor.getMonth();
          const today = isSameDay(d, new Date());
          const sel = isSameDay(d, selected);
          const its = dayItems(d);
          return (
            <button
              type="button"
              key={i}
              className={`cal-cell ${dim ? 'dim' : ''} ${today ? 'today' : ''}`}
              style={sel ? { boxShadow: 'var(--ring)' } : undefined}
              onClick={() => setSelected(new Date(d))}
            >
              <span>{d.getDate()}</span>
              <div className="dots">
                {its.slice(0, 4).map((it, k) => <span key={k} className={`ev-dot ${it.kind}`} />)}
              </div>
            </button>
          );
        })}
      </div>

      <div className="cal-day-list">
        <div className="cal-head">
          <h2 style={{ fontSize: 15 }}>{fmtDate(selected)}</h2>
          <button className="btn btn-sm btn-accent" onClick={() => setAdding((v) => !v)}>+ событие</button>
        </div>
        {adding && (
          <div className="row" style={{ marginBottom: 10 }}>
            <input className="input" autoFocus value={evTitle} placeholder="Что за событие?" enterKeyHint="done"
              onChange={(e) => setEvTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addEvent(); }} />
            <button className="btn btn-accent" style={{ flex: 'none' }} onClick={addEvent}>OK</button>
          </div>
        )}
        {selItems.length === 0 && <p className="empty" style={{ padding: 20 }}>На этот день пусто.</p>}
        {selItems.map((it, i) => (
          it.kind === 'task' ? (
            <div key={i} className="task" style={{ marginBottom: 8 }} onClick={() => onOpen(it.ref)}>
              <h3 style={{ fontSize: 14 }}><i className="fa-regular fa-clock" /> {it.ref.title}</h3>
            </div>
          ) : (
            <div key={i} className="card" style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1 }}><i className="fa-solid fa-thumbtack" /> {it.ref.title}</span>
              <button className="btn btn-sm btn-ghost icon-btn" style={{ color: 'var(--bad)' }} aria-label="Удалить событие"
                onClick={() => { if (confirm('Удалить событие?')) deleteEvent(it.ref.id); }}>×</button>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
