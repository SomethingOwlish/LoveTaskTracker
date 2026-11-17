import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { Sheet, Seg } from './Sheet';
import { DOW, monthTitle, isSameDay, dayKey, fromDayKey, fmtDate, fmtWeekday, uid6 } from '../lib/util';
import { saveMoodLegend, setMood, clearMood, setMoodNote, subscribeMoods } from '../lib/db';

// Легенда по умолчанию — пока человек не настроил свою.
export const DEFAULT_MOOD_LEGEND = [
  { id: 'great', color: '#f2c14e', label: 'Отлично' },
  { id: 'good', color: '#8cc084', label: 'Хорошо' },
  { id: 'calm', color: '#7fa7d1', label: 'Спокойно' },
  { id: 'tired', color: '#a58bc9', label: 'Устал(а)' },
  { id: 'sad', color: '#5f6f94', label: 'Грустно' },
  { id: 'angry', color: '#d9675b', label: 'Раздражение' },
];

export function legendOf(legends, uid) {
  const l = legends?.[uid];
  return l && l.length ? l : DEFAULT_MOOD_LEGEND;
}

// Отметка дня, показанная по легенде её владельца (подпись и цвет — из его
// текущей легенды; если пункт удалён — из снимка в самой записи).
export function resolveMood(mood, legends) {
  if (!mood) return null;
  const item = legendOf(legends, mood.uid).find((x) => x.id === mood.itemId);
  return { color: item?.color || mood.color, label: item?.label || mood.label, note: mood.note || '' };
}

export function moodIndex(moods) {
  const m = {};
  moods.forEach((x) => { m[`${x.uid}_${x.day}`] = x; });
  return m;
}

/* ---------- Виджет «Настроение сегодня» (на экране «Сегодня») ---------- */
export function MoodTodayWidget({ me, partner, moods, legends }) {
  const idx = useMemo(() => moodIndex(moods), [moods]);
  const today = dayKey();
  const mine = idx[`${me.uid}_${today}`];
  const theirs = partner ? resolveMood(idx[`${partner.uid}_${today}`], legends) : null;
  const legend = legendOf(legends, me.uid);
  const [sheet, setSheet] = useState(false);

  return (
    <div className="card mood-today">
      <div className="mood-today-head">
        <span className="section-title" style={{ margin: 0 }}>Настроение сегодня</span>
        {partner && (
          <span className="mood-partner" title={theirs ? theirs.label : 'ещё не отметил(а)'}>
            <Avatar email={partner.email} avatar={partner.avatar} />
            {theirs
              ? <><span className="mood-dot" style={{ background: theirs.color }} /> {theirs.label}</>
              : <span style={{ color: 'var(--text-dim)' }}>—</span>}
          </span>
        )}
      </div>
      <div className="mood-picker">
        {legend.map((it) => (
          <button
            key={it.id}
            type="button"
            className={`mood-chip ${mine?.itemId === it.id ? 'on' : ''}`}
            style={{ '--mc': it.color }}
            onClick={() => (mine?.itemId === it.id ? setSheet(true) : setMood(me.uid, today, it, mine?.note))}
          >
            <span className="mood-dot" />{it.label}
          </button>
        ))}
      </div>
      {mine && (
        <button type="button" className="link-btn" onClick={() => setSheet(true)}>
          {mine.note ? `«${mine.note}»` : '+ заметка о дне'}
        </button>
      )}
      {sheet && <MoodDaySheet day={today} me={me} partner={partner} idx={idx} legends={legends} onClose={() => setSheet(false)} />}
    </div>
  );
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
    const counts = {};
    moods.forEach((m) => {
      if (m.uid !== statsUid) return;
      const d = fromDayKey(m.day);
      if (d.getMonth() !== cursor.getMonth() || d.getFullYear() !== cursor.getFullYear()) return;
      counts[m.itemId] = (counts[m.itemId] || 0) + 1;
    });
    return legend.map((it) => ({ ...it, n: counts[it.id] || 0 })).filter((x) => x.n > 0);
  }, [moods, legends, statsUid, cursor]);

  const cellStyle = (d) => {
    const k = dayKey(d);
    const a = resolveMood(idx[`${me.uid}_${k}`], legends);
    const b = partner ? resolveMood(idx[`${partner.uid}_${k}`], legends) : null;
    if (whose === 'me') return a ? { background: a.color } : undefined;
    if (whose === 'partner') return b ? { background: b.color } : undefined;
    if (a && b) return { background: `linear-gradient(135deg, ${a.color} 50%, ${b.color} 50%)` };
    if (a) return { background: `linear-gradient(135deg, ${a.color} 50%, transparent 50%)` };
    if (b) return { background: `linear-gradient(135deg, transparent 50%, ${b.color} 50%)` };
    return undefined;
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
      {whose === 'both' && <p className="hint">Левый верхний угол — {me.name}, правый нижний — {partner?.name}.</p>}

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

  const pick = (it) => setMood(me.uid, day, it, note);
  const saveNote = () => { if (mine && note !== (mine.note || '')) setMoodNote(me.uid, day, note); };

  return (
    <Sheet title={`${fmtDate(d)}, ${fmtWeekday(d)}`} onClose={() => { saveNote(); onClose(); }}>
      <div className="section-title" style={{ marginTop: 0 }}>Моё настроение</div>
      <div className="mood-picker">
        {legend.map((it) => (
          <button key={it.id} type="button" className={`mood-chip ${mine?.itemId === it.id ? 'on' : ''}`} style={{ '--mc': it.color }} onClick={() => pick(it)}>
            <span className="mood-dot" />{it.label}
          </button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 12 }}>
        <label>Заметка</label>
        <textarea className="input" value={note} disabled={!mine} placeholder={mine ? 'Как прошёл день?' : 'Сначала выбери цвет'}
          onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
      </div>
      {mine && (
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--bad)' }} onClick={() => { clearMood(me.uid, day); onClose(); }}>
          Убрать отметку
        </button>
      )}

      {partner && (
        <>
          <div className="section-title">{partner.name}</div>
          {theirs ? (
            <div className="card">
              <span className="chip"><span className="mood-dot" style={{ background: theirs.color }} />{theirs.label}</span>
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
    </Sheet>
  );
}
