import { useEffect, useMemo, useState } from 'react';
import { DOW, monthTitle, toDate, dayKey, fromDayKey, fmtWeekday, isClosed } from '../lib/util';
import { subscribeCalEvents, subscribeEvents } from '../lib/db';
import { monthGrid, layoutWeek, eventOnDay, eventDays, normalizeLegacyEvent, calendarTasks, fmtRange } from '../lib/calendar';
import { Seg, loadPref, savePref } from './Sheet';
import { Avatar } from './Avatar';
import { MoodCalendar } from './Mood';
import { EventModal } from './EventModal';

export function CalendarView({ tasks, me, users, moodLegends, onOpen, projectColors = {}, calendarProjects = [] }) {
  const [mode, setModeState] = useState(() => loadPref('calMode', 'plan'));
  const setMode = (m) => { setModeState(m); savePref('calMode', m); };
  const partner = users.find((u) => u.uid !== me.uid);
  return (
    <div>
      <Seg value={mode} onChange={setMode} options={[['plan', 'План'], ['mood', 'Настроение']]} className="seg-sm mb" />
      {mode === 'plan'
        ? <PlanCalendar tasks={tasks} me={me} users={users} onOpen={onOpen} projectColors={projectColors} calendarProjects={calendarProjects} />
        : <MoodCalendar me={me} partner={partner} legends={moodLegends} />}
    </div>
  );
}

const MAX_LANES = 3;

function PlanCalendar({ tasks, me, users, onOpen, projectColors, calendarProjects }) {
  const todayKey = dayKey();
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(12, 0, 0, 0); return d; });
  // выбранный день; null — список дня свёрнут
  const [selected, setSelected] = useState(todayKey);
  const [editing, setEditing] = useState(null); // null | {} новое | событие

  const weeks = useMemo(() => monthGrid(cursor), [cursor]);
  const fromKey = weeks[0][0];
  const toKey = weeks[5][6];

  // Многодневные события, которые ещё не закончились к началу сетки…
  const [calEvents, setCalEvents] = useState([]);
  useEffect(() => subscribeCalEvents(fromKey, setCalEvents), [fromKey]);
  // …и старые однодневные из видимого диапазона.
  const [legacy, setLegacy] = useState([]);
  useEffect(() => {
    const from = fromDayKey(fromKey); from.setHours(0, 0, 0, 0);
    const to = fromDayKey(toKey); to.setHours(0, 0, 0, 0); to.setDate(to.getDate() + 1);
    return subscribeEvents(from, to, setLegacy);
  }, [fromKey, toKey]);

  const events = useMemo(() => [
    ...calEvents,
    ...legacy.map(normalizeLegacyEvent).filter(Boolean),
  ].filter((e) => e.start <= toKey && e.end >= fromKey)
    .sort((a, b) => a.start.localeCompare(b.start) || String(a.title).localeCompare(String(b.title))),
  [calEvents, legacy, fromKey, toKey]);

  // Задачи — только из проектов, выбранных в профиле.
  const taskByDay = useMemo(() => {
    const map = {};
    calendarTasks(tasks, calendarProjects).forEach((t) => {
      const k = dayKey(toDate(t.deadline));
      (map[k] = map[k] || []).push(t);
    });
    return map;
  }, [tasks, calendarProjects]);

  const move = (delta) => {
    const n = new Date(cursor);
    n.setMonth(n.getMonth() + delta);
    setCursor(n);
  };
  const goToday = () => {
    const d = new Date(); d.setDate(1); d.setHours(12, 0, 0, 0);
    setCursor(d);
    setSelected(todayKey);
  };
  const pick = (k) => setSelected((cur) => (cur === k ? null : k));

  const colorOf = (e) => e.color || 'var(--accent)';
  const taskColor = (t) => projectColors[(t.projectTags || []).find((p) => calendarProjects.includes(p))] || 'var(--text-dim)';
  const month = cursor.getMonth();

  return (
    <div>
      <div className="cal-head">
        <button className="btn btn-sm icon-btn" onClick={() => move(-1)} aria-label="Предыдущий месяц"><i className="fa-solid fa-chevron-left" /></button>
        <button type="button" className="cal-title" onClick={goToday} title="К сегодняшнему дню">{monthTitle(cursor)}</button>
        <button className="btn btn-sm icon-btn" onClick={() => move(1)} aria-label="Следующий месяц"><i className="fa-solid fa-chevron-right" /></button>
      </div>

      <div className="cal-dows">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
      </div>
      <div className="cal-month">
        {weeks.map((week) => {
          const { bars, hidden } = layoutWeek(events, week, MAX_LANES);
          return (
            <div className="cal-week" key={week[0]}>
              {week.map((k) => {
                const d = fromDayKey(k);
                const ts = taskByDay[k] || [];
                const extra = (hidden[k] || 0);
                return (
                  <button
                    type="button"
                    key={k}
                    className={`cal-cell ${d.getMonth() !== month ? 'dim' : ''} ${k === todayKey ? 'today' : ''} ${k === selected ? 'sel' : ''}`}
                    onClick={() => pick(k)}
                    aria-label={`${d.getDate()}, ${fmtWeekday(d)}`}
                    aria-expanded={k === selected}
                  >
                    <span className="cal-num">{d.getDate()}</span>
                    {(ts.length > 0 || extra > 0) && (
                      <span className="cal-marks">
                        {ts.slice(0, 3).map((t) => (
                          <i key={t.id} className={`cal-tdot ${isClosed(t) ? 'done' : ''}`} style={{ background: taskColor(t) }} />
                        ))}
                        {(ts.length > 3 || extra > 0) && <b>+{Math.max(0, ts.length - 3) + extra}</b>}
                      </span>
                    )}
                  </button>
                );
              })}
              <div className="cal-bars" aria-hidden="true">
                {bars.map((b) => (
                  <span
                    key={b.ev.id + ':' + week[0]}
                    className={`cal-bar ${b.cont ? 'cont' : ''} ${b.more ? 'more' : ''}`}
                    style={{ gridColumn: `${b.col} / span ${b.span}`, gridRow: b.lane + 1, background: colorOf(b.ev) }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {calendarProjects.length === 0 && (
        <p className="hint cal-hint">Здесь события. Задачи появятся, если выбрать проекты в Профиле → «Задачи в календаре».</p>
      )}

      {selected && (
        <DayPanel
          dayK={selected}
          events={events.filter((e) => eventOnDay(e, selected))}
          tasks={taskByDay[selected] || []}
          users={users}
          onEvent={setEditing}
          onTask={onOpen}
          onAdd={() => setEditing({ start: selected, end: selected })}
          onClose={() => setSelected(null)}
          colorOf={colorOf}
          taskColor={taskColor}
        />
      )}

      {editing && (
        <EventModal event={editing.id ? editing : null} initial={editing} me={me} users={users} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function DayPanel({ dayK, events, tasks, users, onEvent, onTask, onAdd, onClose, colorOf, taskColor }) {
  const d = fromDayKey(dayK);
  const who = (e) => users.filter((u) => (e.participants || []).includes(u.uid));
  return (
    <section className="cal-day" aria-label="План дня">
      <div className="cal-day-head">
        <button type="button" className="cal-day-title" onClick={onClose} aria-label="Свернуть день">
          <span>{fmtRange(dayK)}</span>
          <small>{fmtWeekday(d)}</small>
          <i className="fa-solid fa-chevron-up" />
        </button>
        <button className="btn btn-sm btn-accent" onClick={onAdd}><i className="fa-solid fa-plus" /> событие</button>
      </div>

      {events.length === 0 && tasks.length === 0 && <p className="hint" style={{ padding: '6px 2px' }}>На этот день пусто.</p>}

      {events.map((e) => (
        <button type="button" key={e.id} className="cal-item" style={{ '--c': colorOf(e) }} onClick={() => onEvent(e)}>
          <span className="cal-item-bar" />
          <span className="cal-item-body">
            <span className="cal-item-title">{e.title}</span>
            <span className="cal-item-meta">
              {eventDays(e) > 1 ? `${fmtRange(e.start, e.end)} · ${eventDays(e)} дн.` : 'весь день'}
              {e.description ? ' · ' + e.description.split('\n')[0].slice(0, 60) : ''}
            </span>
          </span>
          <span className="cal-item-who">
            {who(e).map((u) => <Avatar key={u.uid} email={u.email} avatar={u.avatar} />)}
          </span>
        </button>
      ))}

      {tasks.map((t) => (
        <button type="button" key={t.id} className={`cal-item task-item ${isClosed(t) ? 'done' : ''}`} style={{ '--c': taskColor(t) }} onClick={() => onTask(t)}>
          <span className="cal-item-dot" />
          <span className="cal-item-body">
            <span className="cal-item-title">{t.title}</span>
            <span className="cal-item-meta">задача · {(t.projectTags || []).join(', ')}</span>
          </span>
          {users.filter((u) => u.uid === t.assigneeUid).map((u) => <span key={u.uid} className="cal-item-who"><Avatar email={u.email} avatar={u.avatar} /></span>)}
        </button>
      ))}
    </section>
  );
}
