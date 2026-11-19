import { useState } from 'react';
import { reportError } from '../lib/toast';
import { createCalEvent, updateCalEvent, deleteCalEvent, deleteEvent } from '../lib/db';
import { dayKey } from '../lib/util';
import { eventDays } from '../lib/calendar';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import { PROJECT_PALETTE } from './ProfileView';

/* Событие календаря: как задача (название, описание, участники, цвет, ссылка),
   но без статуса и может длиться несколько дней. */
export function EventModal({ event, initial = {}, me, users, onClose }) {
  const editing = !!event;
  const src = event || initial;
  const [f, setF] = useState(() => ({
    title: src.title || '',
    description: src.description || '',
    start: src.start || dayKey(),
    end: src.end || src.start || dayKey(),
    participants: src.participants?.length ? src.participants : [me.uid],
    color: src.color || null,
    link: src.link || '',
  }));
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const setStart = (v) => setF((p) => ({ ...p, start: v, end: !p.end || p.end < v ? v : p.end }));
  const setEnd = (v) => setF((p) => ({ ...p, end: v < p.start ? p.start : v }));

  const both = users.map((u) => u.uid);
  const whoKey = f.participants.length > 1 ? 'both' : f.participants[0];
  const setWho = (k) => set('participants', k === 'both' ? both : [k]);

  const valid = f.title.trim() && f.start;
  const save = () => {
    if (!valid) return;
    const data = { ...f, authorUid: event?.authorUid || me.uid };
    let p;
    if (editing && !event.legacy) p = updateCalEvent(event.id, data);
    // старое однодневное событие переносим в новую коллекцию
    else if (editing && event.legacy) p = createCalEvent(data).then(() => deleteEvent(event.id));
    else p = createCalEvent(data);
    p.catch((e) => reportError(e, 'Не сохранилось'));
    onClose();
  };
  const remove = () => {
    if (!confirm(`Удалить событие «${event.title}»?`)) return;
    (event.legacy ? deleteEvent(event.id) : deleteCalEvent(event.id)).catch((e) => reportError(e, 'Не удалилось'));
    onClose();
  };

  const days = eventDays(f);
  const customColor = f.color && !PROJECT_PALETTE.includes(f.color);

  return (
    <Sheet
      title={editing ? 'Событие' : 'Новое событие'}
      onClose={onClose}
      footer={<>
        <button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-accent" onClick={save} disabled={!valid}>{editing ? 'Сохранить' : 'Создать'}</button>
      </>}
    >
      <div className="field">
        <label>Название</label>
        <input className="input" value={f.title} autoFocus={!editing} onChange={(e) => set('title', e.target.value)} placeholder="Что происходит" />
      </div>

      <div className="row">
        <div className="field">
          <label>С</label>
          <input className="input" type="date" value={f.start} onChange={(e) => e.target.value && setStart(e.target.value)} />
        </div>
        <div className="field">
          <label>По</label>
          <input className="input" type="date" value={f.end} min={f.start} onChange={(e) => e.target.value && setEnd(e.target.value)} />
        </div>
      </div>
      <div className="row" style={{ marginTop: -6, marginBottom: 14, alignItems: 'center' }}>
        <span className="hint" style={{ margin: 0 }}>{days > 1 ? `${days} дн.` : 'Один день'}</span>
        <button type="button" className="btn btn-sm" style={{ flex: 'none' }} onClick={() => setEnd(f.start)}>1 день</button>
        <button type="button" className="btn btn-sm" style={{ flex: 'none' }}
          onClick={() => { const d = new Date(f.start + 'T12:00'); d.setDate(d.getDate() + 2); setEnd(dayKey(d)); }}>3 дня</button>
      </div>

      <div className="field">
        <label>Кто</label>
        <div className="seg">
          {users.map((u) => (
            <button key={u.uid} type="button" className={whoKey === u.uid ? 'on' : ''} onClick={() => setWho(u.uid)}>
              <Avatar email={u.email} avatar={u.avatar} /> {u.name}
            </button>
          ))}
          <button type="button" className={whoKey === 'both' ? 'on' : ''} onClick={() => setWho('both')}>Оба</button>
        </div>
      </div>

      <div className="field">
        <label>Описание</label>
        <textarea className="input" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Подробности" />
      </div>

      <div className="field">
        <label>Цвет</label>
        <div className="swatches">
          <span className={`swatch ${!f.color ? 'on' : ''}`} style={{ background: 'var(--accent)' }} title="Акцент" onClick={() => set('color', null)} />
          {PROJECT_PALETTE.map((c) => (
            <span key={c} className={`swatch ${f.color === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set('color', c)} />
          ))}
          <label className={`swatch custom ${customColor ? 'on' : ''}`} title="Свой цвет" style={customColor ? { background: f.color } : undefined}>
            <i className="fa-solid fa-eye-dropper" />
            <input type="color" value={f.color || '#888888'} onChange={(e) => set('color', e.target.value)} />
          </label>
        </div>
      </div>

      <div className="field">
        <label>Ссылка</label>
        <input className="input" value={f.link} onChange={(e) => set('link', e.target.value)} placeholder="https://" />
      </div>

      {editing && (
        <button className="btn btn-ghost btn-block" style={{ color: 'var(--bad)', marginTop: 4 }} onClick={remove}>
          Удалить событие
        </button>
      )}
    </Sheet>
  );
}
