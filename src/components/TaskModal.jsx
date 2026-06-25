import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { toDate, toLocalInput, fmtDateTime } from '../lib/util';
import {
  createTask, updateTask, deleteTask, completeTask, reopenTask,
  approveTask, returnTask, addComment, subscribeComments,
} from '../lib/db';

function Switch({ on, onChange, label }) {
  return (
    <div className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="track"><span className="knob" /></span>
      <span>{label}</span>
    </div>
  );
}

function TagEditor({ value, onChange, placeholder, kind, suggestions = [] }) {
  const [text, setText] = useState('');
  const add = (raw) => {
    const v = (raw ?? text).trim().replace(/^#/, '');
    if (v && !value.includes(v)) onChange([...value, v]);
    setText('');
  };
  const avail = suggestions.filter((s) => !value.includes(s));
  return (
    <div>
      <div className="chips" style={{ marginBottom: value.length ? 8 : 0 }}>
        {value.map((t) => (
          <span key={t} className={`chip ${kind}`}>
            {kind === 'project' ? t : '#' + t}
            <span className="x" onClick={() => onChange(value.filter((x) => x !== t))}>×</span>
          </span>
        ))}
      </div>
      <input
        className="input"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        onBlur={() => add()}
      />
      {avail.length > 0 && (
        <div className="chips" style={{ marginTop: 8 }}>
          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>есть:</span>
          {avail.map((s) => (
            <button type="button" key={s} className={`chip ${kind}`} style={{ opacity: 0.7, cursor: 'pointer' }} onClick={() => add(s)}>
              {kind === 'project' ? s : '#' + s} +
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ChecklistEditor({ items, onChange }) {
  const [text, setText] = useState('');
  const add = () => {
    const v = text.trim();
    if (!v) return;
    onChange([...items, { id: Math.random().toString(36).slice(2, 8), text: v, done: false }]);
    setText('');
  };
  return (
    <div>
      {items.map((it) => (
        <div key={it.id} className="row" style={{ alignItems: 'center', marginBottom: 6 }}>
          <button
            type="button"
            className={`check ${it.done ? 'on' : ''}`}
            style={{ flex: 'none', width: 22, height: 22, fontSize: 12 }}
            onClick={() => onChange(items.map((x) => (x.id === it.id ? { ...x, done: !x.done } : x)))}
          >
            {it.done ? '✓' : ''}
          </button>
          <span style={{ flex: 1, textDecoration: it.done ? 'line-through' : 'none', color: it.done ? 'var(--text-dim)' : 'var(--text)' }}>
            {it.text}
          </span>
          <button type="button" className="btn btn-sm btn-ghost" style={{ flex: 'none' }} onClick={() => onChange(items.filter((x) => x.id !== it.id))}>×</button>
        </div>
      ))}
      <input
        className="input"
        value={text}
        placeholder="Пункт чеклиста + Enter"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
      />
    </div>
  );
}

export function TaskModal({ task, me, users, userOf, onClose, projectSuggestions = [], tagSuggestions = [] }) {
  const editing = !!task;
  const [f, setF] = useState(() => ({
    title: task?.title || '',
    description: task?.description || '',
    assigneeUid: task?.assigneeUid || me.uid,
    importance: task?.priorityMatrix?.importance ?? 0,
    urgency: task?.priorityMatrix?.urgency ?? 0,
    deadline: task?.deadline ? toLocalInput(toDate(task.deadline)) : '',
    estimateMin: task?.estimateMin ?? '',
    actualMin: task?.actualMin ?? '',
    tags: task?.tags || [],
    projectTags: task?.projectTags || [],
    link: task?.link || '',
    checklist: task?.checklist || [],
    needsReview: task?.needsReview ?? false,
    recurrence: task?.recurrence || 'none',
  }));
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));

  const [comments, setComments] = useState([]);
  const [cText, setCText] = useState('');
  useEffect(() => {
    if (!editing) return;
    return subscribeComments(task.id, setComments);
  }, [editing, task?.id]);

  const payload = useMemo(() => ({
    title: f.title,
    description: f.description,
    authorUid: task?.authorUid || me.uid,
    assigneeUid: f.assigneeUid,
    importance: Number(f.importance),
    urgency: Number(f.urgency),
    deadline: f.deadline || null,
    estimateMin: f.estimateMin === '' ? null : Number(f.estimateMin),
    actualMin: f.actualMin === '' ? null : Number(f.actualMin),
    tags: f.tags,
    projectTags: f.projectTags,
    link: f.link.trim() || null,
    checklist: f.checklist,
    needsReview: f.needsReview,
    recurrence: f.recurrence,
  }), [f, task, me.uid]);

  const save = async () => {
    if (editing) {
      await updateTask(task.id, {
        title: payload.title, description: payload.description, assigneeUid: payload.assigneeUid,
        priorityMatrix: { importance: payload.importance, urgency: payload.urgency },
        deadline: payload.deadline, estimateMin: payload.estimateMin, actualMin: payload.actualMin,
        tags: payload.tags, projectTags: payload.projectTags, link: payload.link,
        checklist: payload.checklist, needsReview: payload.needsReview, recurrence: payload.recurrence,
      });
    } else {
      await createTask(payload);
    }
    onClose();
  };

  // ревью: я автор и задача пришла на проверку
  const iAmAuthor = task && task.authorUid === me.uid;
  const inReview = task?.status === 'in_review';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{editing ? 'Задача' : 'Новая задача'}</h2>
          <button className="close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        <div className="field">
          <label>Название</label>
          <input className="input" value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Что нужно сделать" />
        </div>

        <div className="field">
          <label>Описание</label>
          <textarea className="input" value={f.description} onChange={(e) => set('description', e.target.value)} placeholder="Подробности" />
        </div>

        <div className="field">
          <label>Исполнитель</label>
          <div className="seg">
            {users.map((u) => (
              <button key={u.uid} className={f.assigneeUid === u.uid ? 'on' : ''} onClick={() => set('assigneeUid', u.uid)}>
                <Avatar email={u.email} avatar={u.avatar} /> {u.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label>Важность (← важно · не важно →): {f.importance > 0 ? '+' : ''}{f.importance}</label>
          <div className="slider-row">
            <input type="range" min="-5" max="5" value={f.importance} onChange={(e) => set('importance', Number(e.target.value))} />
            <span className="val">{f.importance > 0 ? '+' : ''}{f.importance}</span>
          </div>
        </div>
        <div className="field">
          <label>Срочность (↑ срочно · не срочно ↓): {f.urgency > 0 ? '+' : ''}{f.urgency}</label>
          <div className="slider-row">
            <input type="range" min="-5" max="5" value={f.urgency} onChange={(e) => set('urgency', Number(e.target.value))} />
            <span className="val">{f.urgency > 0 ? '+' : ''}{f.urgency}</span>
          </div>
        </div>

        <div className="field">
          <label>Дедлайн</label>
          <input className="input" type="datetime-local" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} />
          <div className="row" style={{ marginTop: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => { const d = new Date(); d.setHours(18, 0, 0, 0); set('deadline', toLocalInput(d)); }}>Сегодня</button>
            <button type="button" className="btn btn-sm" onClick={() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(18, 0, 0, 0); set('deadline', toLocalInput(d)); }}>Завтра</button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => set('deadline', '')}>Очистить</button>
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label>Оценка, мин</label>
            <input className="input" type="number" min="0" value={f.estimateMin} onChange={(e) => set('estimateMin', e.target.value)} placeholder="—" />
          </div>
          <div className="field">
            <label>Факт, мин</label>
            <input className="input" type="number" min="0" value={f.actualMin} onChange={(e) => set('actualMin', e.target.value)} placeholder="—" />
          </div>
        </div>

        <div className="field">
          <label>Проекты</label>
          <TagEditor value={f.projectTags} onChange={(v) => set('projectTags', v)} placeholder="Проект + Enter" kind="project" suggestions={projectSuggestions} />
        </div>
        <div className="field">
          <label>Теги</label>
          <TagEditor value={f.tags} onChange={(v) => set('tags', v)} placeholder="Тег + Enter" kind="tag" suggestions={tagSuggestions} />
        </div>

        <div className="field">
          <label>Ссылка</label>
          <input className="input" value={f.link} onChange={(e) => set('link', e.target.value)} placeholder="https://" />
        </div>

        <div className="field">
          <label>Чеклист</label>
          <ChecklistEditor items={f.checklist} onChange={(v) => set('checklist', v)} />
        </div>

        <div className="row" style={{ alignItems: 'center', marginBottom: 14 }}>
          <Switch on={f.needsReview} onChange={(v) => set('needsReview', v)} label="С проверкой автором" />
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Повтор</label>
            <select className="input" value={f.recurrence} onChange={(e) => set('recurrence', e.target.value)}>
              <option value="none">Без повтора</option>
              <option value="daily">Каждый день</option>
              <option value="weekly">Каждую неделю</option>
              <option value="monthly">Каждый месяц</option>
            </select>
          </div>
        </div>

        {/* Ревью-флоу */}
        {inReview && iAmAuthor && (
          <div className="card surface-2" style={{ marginBottom: 14 }}>
            <p style={{ margin: '0 0 10px', fontSize: 14 }}>Задача выполнена и ждёт твоей проверки.</p>
            <div className="row">
              <button className="btn btn-accent" onClick={async () => { await approveTask(task); onClose(); }}>Принять</button>
              <button className="btn" onClick={async () => { await returnTask(task); onClose(); }}>Вернуть в работу</button>
            </div>
          </div>
        )}
        {inReview && !iAmAuthor && (
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 14 }}>Ждёт проверки автором.</p>
        )}

        {/* Комментарии */}
        {editing && (
          <>
            <div className="section-title" style={{ marginTop: 8 }}>Комментарии</div>
            {comments.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: 13 }}>Пока тихо.</p>}
            {comments.map((c) => {
              const cu = userOf(c.authorUid);
              return (
                <div key={c.id} className="comment">
                  <Avatar email={cu?.email} avatar={cu?.avatar} />
                  <div className="body">
                    <div className="meta">{cu?.name} · {fmtDateTime(toDate(c.createdAt)) || 'сейчас'}</div>
                    {c.text}
                  </div>
                </div>
              );
            })}
            <div className="row" style={{ marginTop: 6 }}>
              <input className="input" value={cText} onChange={(e) => setCText(e.target.value)} placeholder="Написать…"
                onKeyDown={(e) => { if (e.key === 'Enter') { addComment(task.id, me.uid, cText); setCText(''); } }} />
              <button className="btn" style={{ flex: 'none' }} onClick={() => { addComment(task.id, me.uid, cText); setCText(''); }}>→</button>
            </div>
          </>
        )}

        {/* Вторичные действия */}
        {editing && (
          <div className="row" style={{ marginTop: 16 }}>
            {(task.status === 'done' || task.status === 'approved')
              ? <button className="btn" onClick={async () => { await reopenTask(task); onClose(); }}>Вернуть в работу</button>
              : <button className="btn" onClick={async () => { await completeTask(task); onClose(); }}>Выполнено</button>}
            <button className="btn btn-ghost" style={{ flex: 'none', color: 'var(--bad)' }}
              onClick={async () => { if (confirm('Удалить задачу?')) { await deleteTask(task.id); onClose(); } }}>
              Удалить
            </button>
          </div>
        )}

        {/* Липкая панель снизу: всегда под большим пальцем */}
        <div className="sheet-foot">
          <button className="btn" onClick={onClose}>Отмена</button>
          <button className="btn btn-accent" onClick={save}>{editing ? 'Сохранить' : 'Создать'}</button>
        </div>
      </div>
    </div>
  );
}
