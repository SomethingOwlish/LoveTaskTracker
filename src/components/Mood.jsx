import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { Sheet, Seg } from './Sheet';
import { DOW, monthTitle, isSameDay, dayKey, fromDayKey, fmtDate, fmtWeekday, uid6 } from '../lib/util';
import { saveMoodLegend, setMood, clearMood, setMoodNote, subscribeMoods, subscribeDoneOnDay, subscribeMyMood } from '../lib/db';
import { toast } from '../lib/toast';
import {
  DEFAULT_MOOD_LEGEND, MAX_MOODS_PER_DAY, legendOf, resolveMood, moodIndex, moodItems, moodIds,
  toggleMoodItem, moodCellStyle, monthCounts, missingDefaults, shouldRemind,
} from '../lib/mood';

export { DEFAULT_MOOD_LEGEND, legendOf, resolveMood, moodIndex };

/* ---------- Выбор цветов дня ---------- */
// Нажатие добавляет или снимает цвет; за день можно выбрать несколько.
function MoodPicker({ legend, mine, onChange, collapse = 0 }) {
  const ids = moodIds(mine);
  const [all, setAll] = useState(false);
  const hidden = collapse && !all ? legend.slice(collapse).filter((it) => !ids.includes(it.id)) : [];
  const shown = hidden.length ? legend.filter((it) => !hidden.includes(it)) : legend;
  return (
    <>
      <div className="mood-picker">
        {shown.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`mood-chip ${ids.includes(it.id) ? 'on' : ''}`}
            style={{ '--mc': it.color }}
            aria-pressed={ids.includes(it.id)}
            onClick={() => onChange(toggleMoodItem(moodItems(mine), it))}
          >
            <span className="mood-dot" />{it.label}
          </button>
        ))}
        {hidden.length > 0 && (
          <button type="button" className="mood-chip more" onClick={() => setAll(true)}>ещё {hidden.length}…</button>
        )}
      </div>
      {ids.length > 0 && (
        <p className="hint" style={{ marginBottom: 0 }}>
          {ids.length >= MAX_MOODS_PER_DAY ? `Максимум ${MAX_MOODS_PER_DAY} цвета — следующий заменит самый первый.` : 'Можно выбрать несколько цветов.'}
        </p>
      )}
    </>
  );
}

function MoodDots({ mood }) {
  return <span className="mood-dots">{mood.items.map((x) => <span key={x.id} className="mood-dot" style={{ background: x.color }} />)}</span>;
}

/* ---------- Виджет «Настроение сегодня» (на экране «Сегодня») ---------- */
export function MoodTodayWidget({ me, partner, moods, legends }) {
  const idx = useMemo(() => moodIndex(moods), [moods]);
  const today = dayKey();
  const mine = idx[`${me.uid}_${today}`];
  const theirs = partner ? resolveMood(idx[`${partner.uid}_${today}`], legends) : null;
  const legend = legendOf(legends, me.uid);
  const [sheet, setSheet] = useState(false);
  const marked = moodItems(mine).length > 0;

  return (
    <div className={`card mood-today ${marked ? '' : 'remind'}`}>
      <div className="mood-today-head">
        <span className="section-title" style={{ margin: 0 }}>Настроение сегодня</span>
        {partner && (
          <span className="mood-partner" title={theirs ? theirs.label : 'ещё не отметил(а)'}>
            <Avatar email={partner.email} avatar={partner.avatar} />
            {theirs
              ? <><MoodDots mood={theirs} /> <span className="mood-partner-label">{theirs.label}</span></>
              : <span style={{ color: 'var(--text-dim)' }}>—</span>}
          </span>
        )}
      </div>
      {!marked && (
        <div className="mood-remind">
          <i className="fa-solid fa-palette" /> Сегодня ещё без отметки. Каким был день? Выбери один или несколько цветов.
        </div>
      )}
      <MoodPicker legend={legend} mine={mine} collapse={8} onChange={(items) => setMood(me.uid, today, items, mine?.note)} />
      {marked && (
        <button type="button" className="link-btn" onClick={() => setSheet(true)}>
          {mine.note ? `«${mine.note}»` : '+ заметка о дне'}
        </button>
      )}
      {sheet && <MoodDaySheet day={today} me={me} partner={partner} idx={idx} legends={legends} onClose={() => setSheet(false)} />}
    </div>
  );
}

/* ---------- Напоминание при входе ---------- */
// Раз в день, если своё настроение за сегодня не отмечено, — тост с кнопкой,
// которая сразу открывает отметку дня (с любого экрана).
export function MoodReminder({ me, partner, moods, legends }) {
  const [today, setToday] = useState(dayKey());
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ loaded: false, marked: false });
  useEffect(() => {
    const upd = () => setToday(dayKey());
    document.addEventListener('visibilitychange', upd);
    return () => document.removeEventListener('visibilitychange', upd);
  }, []);
  useEffect(() => {
    setState({ loaded: false, marked: false });
    return subscribeMyMood(me.uid, today, (m, fromServer) => setState((p) => ({
      loaded: p.loaded || fromServer, marked: moodItems(m).length > 0,
    })));
  }, [me.uid, today]);

  const key = 'moodReminded:' + me.uid;
  useEffect(() => {
    let remindedDay = null;
    try { remindedDay = localStorage.getItem(key); } catch { /* приватный режим */ }
    if (!shouldRemind({ ...state, remindedDay, today })) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(key, today); } catch { /* приватный режим */ }
      toast('Настроение за сегодня ещё не отмечено — каким был день?', {
        ms: 12000, action: { label: 'Отметить', fn: () => setOpen(true) },
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [state, today, key]);

  const idx = useMemo(() => moodIndex(moods || []), [moods]);
  return open ? <MoodDaySheet day={today} me={me} partner={partner} idx={idx} legends={legends} onClose={() => setOpen(false)} /> : null;
}

/* ---------- Календарь настроений ---------- */
export function MoodCalendar({ me, partner, legends }) {
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setDate(1); return d; });
  const [whose, setWhose] = useState('both');
  const [openDay, setOpenDay] = useState(null);
  const [editLegend, setEditLegend] = useState(false);

  const grid = useMemo(() => {
    const startDow = (cursor.getDay() + 6) % 7;
    const start = new Date(cursor);
    start.setDate(1 - startDow);
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  }, [cursor]);

  // читаем отметки только видимых 6 недель
  const [moods, setMoods] = useState([]);
  const fromKey = dayKey(grid[0]);
  const toKey = dayKey(grid[41]);
  useEffect(() => subscribeMoods(fromKey, toKey, setMoods), [fromKey, toKey]);
  const idx = useMemo(() => moodIndex(moods), [moods]);

  const move = (delta) => { const n = new Date(cursor); n.setMonth(n.getMonth() + delta); setCursor(n); };
  const now = new Date();

  // статистика за месяц: сколько дней каким цветом (у выбранного человека)
  const statsUid = whose === 'partner' ? partner?.uid : me.uid;
  const monthStats = useMemo(() => {
    if (!statsUid) return [];
    const legend = legendOf(legends, statsUid);
    const counts = monthCounts(moods, statsUid, cursor.getFullYear(), cursor.getMonth());
    return legend.map((it) => ({ ...it, n: counts[it.id] || 0 })).filter((x) => x.n > 0);
  }, [moods, legends, statsUid, cursor]);

  const cellStyle = (d) => {
    const k = dayKey(d);
    const a = resolveMood(idx[`${me.uid}_${k}`], legends);
    const b = partner ? resolveMood(idx[`${partner.uid}_${k}`], legends) : null;
    return moodCellStyle(a, b, whose);
  };

  return (
    <div>
      <Seg
        value={whose}
        onChange={setWhose}
        options={[['me', 'Моё'], ['partner', partner?.name || 'Партнёр'], ['both', 'Оба']]}
        className="mb"
      />

      <div className="cal-head">
        <button className="btn btn-sm icon-btn" onClick={() => move(-1)} aria-label="Предыдущий месяц">‹</button>
        <h2>{monthTitle(cursor)}</h2>
        <button className="btn btn-sm icon-btn" onClick={() => move(1)} aria-label="Следующий месяц">›</button>
      </div>

      <div className="cal-grid">
        {DOW.map((d) => <div key={d} className="cal-dow">{d}</div>)}
        {grid.map((d, i) => {
          const dim = d.getMonth() !== cursor.getMonth();
          const future = d > now && !isSameDay(d, now);
          return (
            <button
              type="button"
              key={i}
              className={`cal-cell mood-cell ${dim ? 'dim' : ''} ${isSameDay(d, now) ? 'today' : ''}`}
              style={cellStyle(d)}
              disabled={future}
              onClick={() => setOpenDay(dayKey(d))}
            >
              <span>{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      {whose === 'both' && <p className="hint">Верхняя половина дня — {me.name}, нижняя — {partner?.name}. Несколько цветов за день — полосками.</p>}

      {monthStats.length > 0 && (
        <>
          <div className="section-title">За месяц</div>
          <div className="mood-bar">
            {monthStats.map((s) => <span key={s.id} style={{ flex: s.n, background: s.color }} title={`${s.label}: ${s.n}`} />)}
          </div>
          <div className="chips" style={{ marginTop: 8 }}>
            {monthStats.map((s) => <span key={s.id} className="chip"><span className="mood-dot" style={{ background: s.color }} />{s.label} · {s.n}</span>)}
          </div>
        </>
      )}

      <div className="section-title">Легенды</div>
      <LegendRow user={me} legend={legendOf(legends, me.uid)} onEdit={() => setEditLegend(true)} />
      {partner && <LegendRow user={partner} legend={legendOf(legends, partner.uid)} />}

      {openDay && <MoodDaySheet day={openDay} me={me} partner={partner} idx={idx} legends={legends} onClose={() => setOpenDay(null)} />}
      {editLegend && <LegendEditor uid={me.uid} legend={legendOf(legends, me.uid)} onClose={() => setEditLegend(false)} />}
    </div>
  );
}

function LegendRow({ user, legend, onEdit }) {
  return (
    <div className="card legend-row">
      <div className="row" style={{ alignItems: 'center', marginBottom: 8 }}>
        <span className="who"><Avatar email={user.email} avatar={user.avatar} /> {user.name}</span>
        {onEdit && <button className="btn btn-sm" style={{ flex: 'none' }} onClick={onEdit}><i className="fa-solid fa-pen" /> Изменить</button>}
      </div>
      <div className="chips">
        {legend.map((it) => <span key={it.id} className="chip"><span className="mood-dot" style={{ background: it.color }} />{it.label}</span>)}
      </div>
    </div>
  );
}

/* ---------- Шторка дня ---------- */
function MoodDaySheet({ day, me, partner, idx, legends, onClose }) {
  const mine = idx[`${me.uid}_${day}`];
  const theirs = partner ? resolveMood(idx[`${partner.uid}_${day}`], legends) : null;
  const [note, setNote] = useState(mine?.note || '');
  const legend = legendOf(legends, me.uid);
  const d = fromDayKey(day);

  const marked = moodItems(mine).length > 0;

  // что успели сделать в этот день — помогает вспомнить, каким он был
  const [done, setDone] = useState(null);
  useEffect(() => subscribeDoneOnDay(day, setDone), [day]);
  const doneBy = (uid) => (done || []).filter((t) => t.assigneeUid === uid && (t.status === 'done' || t.status === 'approved'));
  const saveNote = () => { if (marked && note !== (mine.note || '')) setMoodNote(me.uid, day, note); };

  return (
    <Sheet title={`${fmtDate(d)}, ${fmtWeekday(d)}`} onClose={() => { saveNote(); onClose(); }}>
      <div className="section-title" style={{ marginTop: 0 }}>Моё настроение</div>
      <MoodPicker legend={legend} mine={mine} onChange={(items) => setMood(me.uid, day, items, note)} />
      <div className="field" style={{ marginTop: 12 }}>
        <label>Заметка</label>
        <textarea className="input" value={note} disabled={!marked} placeholder={marked ? 'Как прошёл день?' : 'Сначала выбери цвет'}
          onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
      </div>
      {marked && (
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--bad)' }} onClick={() => { clearMood(me.uid, day); onClose(); }}>
          Убрать отметку
        </button>
      )}

      <div className="section-title">Сделано в этот день</div>
      {done === null ? <p className="hint"><i className="fa-solid fa-spinner fa-spin" /></p> : (
        <div className="done-day">
          {[me, partner].filter(Boolean).map((u) => {
            const list = doneBy(u.uid);
            return (
              <div key={u.uid} className="done-col">
                <div className="who"><Avatar email={u.email} avatar={u.avatar} /> {u.name} · {list.length}</div>
                {list.length ? list.slice(0, 8).map((t) => <div key={t.id} className="done-item"><i className="fa-solid fa-check" /> {t.title}</div>)
                  : <div className="hint" style={{ margin: 0 }}>—</div>}
                {list.length > 8 && <div className="hint" style={{ margin: 0 }}>и ещё {list.length - 8}</div>}
              </div>
            );
          })}
        </div>
      )}

      {partner && (
        <>
          <div className="section-title">{partner.name}</div>
          {theirs ? (
            <div className="card">
              <div className="chips">
                {theirs.items.map((x) => <span key={x.id} className="chip"><span className="mood-dot" style={{ background: x.color }} />{x.label}</span>)}
              </div>
              {theirs.note && <p style={{ margin: '8px 0 0' }}>«{theirs.note}»</p>}
            </div>
          ) : <p className="hint">Пока без отметки.</p>}
        </>
      )}
    </Sheet>
  );
}

/* ---------- Редактор своей легенды ---------- */
function LegendEditor({ uid, legend, onClose }) {
  const [items, setItems] = useState(() => legend.map((x) => ({ ...x })));
  const suggest = missingDefaults(items);
  const upd = (id, patch) => setItems((p) => p.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const save = async () => {
    const clean = items.map((x) => ({ ...x, label: x.label.trim() || 'Без названия' }));
    await saveMoodLegend(uid, clean);
    onClose();
  };
  return (
    <Sheet
      title="Моя легенда"
      onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-accent" onClick={save}>Сохранить</button></>}
    >
      <p className="hint" style={{ marginTop: 0 }}>Цвета и подписи видишь ты и партнёр — твои дни у него отображаются по твоей легенде.</p>
      {items.map((it) => (
        <div key={it.id} className="row legend-edit">
          <label className="swatch custom on" style={{ background: it.color, flex: 'none' }}>
            <input type="color" value={it.color} onChange={(e) => upd(it.id, { color: e.target.value })} aria-label="Цвет" />
          </label>
          <input className="input" value={it.label} onChange={(e) => upd(it.id, { label: e.target.value })} placeholder="Подпись" />
          <button type="button" className="btn btn-ghost icon-btn" style={{ flex: 'none' }} aria-label="Удалить"
            onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}>×</button>
        </div>
      ))}
      <button type="button" className="btn btn-block" onClick={() => setItems((p) => [...p, { id: uid6(), color: '#888888', label: '' }])}>
        + Добавить цвет
      </button>
      {suggest.length > 0 && (
        <>
          <div className="section-title">Добавить из набора</div>
          <div className="chips">
            {suggest.map((it) => (
              <button key={it.id} type="button" className="chip as-btn" onClick={() => setItems((p) => [...p, { ...it }])}>
                <span className="mood-dot" style={{ background: it.color }} />+ {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}
