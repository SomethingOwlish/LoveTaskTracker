import { useState } from 'react';
import { Avatar } from './Avatar';
import { toDate, fmtDate, quadrant, isClosed, startOfToday, isSameDay } from '../lib/util';
import { recurrenceLabel } from '../lib/recurrence';
import { reopenTask, toggleLike, updateTask } from '../lib/db';
import { completeWithUndo, deleteWithUndo } from '../lib/actions';
import { useSwipe, TRIGGER } from '../lib/useSwipe';
import { reportError } from '../lib/toast';
import { useBulk } from './Bulk';

export function TaskCard({ task, me, userOf, onOpen, projectColors = {}, compact = false }) {
  const author = userOf(task.authorUid);
  const assignee = userOf(task.assigneeUid);
  const closed = isClosed(task);
  const dl = toDate(task.deadline);
  const q = quadrant(task.priorityMatrix?.importance ?? 0, task.priorityMatrix?.urgency ?? 0);
  const liked = (task.likes || []).length > 0;
  const canLike = task.assigneeUid !== me.uid; // сердечко ставит только другой партнёр
  const checkTotal = (task.checklist || []).length;
  const checkDone = (task.checklist || []).filter((c) => c.done).length;
  const allDone = checkTotal > 0 && checkDone === checkTotal;
  // задача с чеклистом по нажатию раскрывает пункты — их можно отмечать
  // прямо тут, не открывая редактирование
  const [showList, setShowList] = useState(false);
  const toggleItem = (id) => {
    const next = (task.checklist || []).map((c) => (c.id === id ? { ...c, done: !c.done } : c));
    updateTask(task.id, { checklist: next }).catch((e) => reportError(e, 'Не сохранилось'));
  };
  // режим выбора (пакетное редактирование на компьютере): клик — выбрать
  const bulk = useBulk();
  const selecting = !!bulk?.on;
  const selected = selecting && bulk.has(task.id);
  const onCardClick = () => {
    if (selecting) return bulk.toggle(task.id);
    if (checkTotal > 0) setShowList((v) => !v);
    else onOpen(task);
  };

  // цвет левой полоски: по первому проекту из настроек смотрящего, иначе акцент
  const proj = (task.projectTags || [])[0];
  const stripe = (proj && projectColors[proj]) || 'var(--accent)';

  const overdue = !closed && dl && dl < startOfToday();
  const dlLabel = dl && (isSameDay(dl, new Date()) ? 'сегодня' : fmtDate(dl));
  const repeats = task.recurrence && task.recurrence !== 'none';

  const onCheck = (e) => {
    e.stopPropagation();
    if (selecting) return bulk.toggle(task.id);
    if (closed) return reopenTask(task).catch((e) => reportError(e));
    if (task.status === 'in_review') return onOpen(task);
    return completeWithUndo(task);
  };

  // свайп вправо — выполнено (или вернуть), влево — удалить; у обоих есть «Отменить»
  const { dx, handlers } = useSwipe({
    onRight: task.status === 'in_review' ? null : () => (closed ? reopenTask(task).catch((e) => reportError(e)) : completeWithUndo(task)),
    onLeft: () => deleteWithUndo(task),
  });
  const armed = Math.abs(dx) >= TRIGGER;

  return (
    <div className={`swipe-wrap ${dx > 0 ? 'to-right' : dx < 0 ? 'to-left' : ''} ${armed ? 'armed' : ''}`}>
      {dx !== 0 && (
        <div className="swipe-bg" aria-hidden="true">
          <span className="swipe-done"><i className={`fa-solid ${closed ? 'fa-rotate-left' : 'fa-check'}`} /> {closed ? 'Вернуть' : 'Готово'}</span>
          <span className="swipe-del">Удалить <i className="fa-solid fa-trash" /></span>
        </div>
      )}
    <div className={`task ${closed ? 'done' : ''} ${compact ? 'compact' : ''} ${dx ? 'dragging' : ''} ${selecting ? 'selecting' : ''} ${selected ? 'selected' : ''}`}
      style={{ borderLeftColor: stripe, transform: dx ? `translateX(${dx}px)` : undefined }}
      {...(selecting ? {} : handlers)}
      onClick={onCardClick}>
      <div className="task-top">
        {selecting ? (
          <button className={`check bulk-pick ${selected ? 'on' : ''}`} onClick={onCheck}
            aria-pressed={selected} aria-label={selected ? 'Убрать из выбранных' : 'Выбрать'}>
            {selected ? <i className="fa-solid fa-square-check" /> : ''}
          </button>
        ) : (
          <button
            className={`check ${closed ? 'on' : ''}`}
            onClick={onCheck}
            aria-label={closed ? 'Вернуть в работу' : 'Отметить выполненной'}
          >
            {closed ? '✓' : ''}
          </button>
        )}
        <h3>{task.title}</h3>
        {task.status === 'in_review' && <span className="badge review">на проверке</span>}
        {task.needsReview && task.status !== 'in_review' && !closed && <span className="badge q">с проверкой</span>}
      </div>

      {task.description && !compact && <p className="desc">{task.description}</p>}

      {(task.tags?.length || task.projectTags?.length) ? (
        <div className="chips" style={{ marginTop: 10 }}>
          {task.projectTags?.map((t) => <span key={'p' + t} className="chip project">{t}</span>)}
          {task.tags?.map((t) => <span key={'t' + t} className="chip tag">#{t}</span>)}
        </div>
      ) : null}

      <div className="task-meta">
        <span className="who">
          <Avatar email={assignee?.email} avatar={assignee?.avatar} /> {assignee?.name || '—'}
        </span>
        {dl && <span className={overdue ? 'overdue' : ''}><i className="fa-regular fa-clock" /> {dlLabel}</span>}
        {repeats && <span title={recurrenceLabel(task.recurrence)}><i className="fa-solid fa-rotate" /> {recurrenceLabel(task.recurrence).toLowerCase()}</span>}
        {!compact && <span>{q.label}</span>}
        {checkTotal > 0 && (
          <span className="chip tag cl-toggle" style={allDone ? { color: 'var(--good)', borderColor: 'color-mix(in srgb, var(--good) 60%, transparent)' } : undefined}>
            ☑ {checkDone}/{checkTotal} <i className={`fa-solid fa-chevron-${showList ? 'up' : 'down'}`} style={{ fontSize: 9 }} />
          </span>
        )}
        {task.link && <span><i className="fa-solid fa-link" /></span>}
      </div>

      {showList && checkTotal > 0 && (
        <div className="task-checklist" onClick={(e) => e.stopPropagation()}>
          {task.checklist.map((c) => (
            <button key={c.id} type="button" className={`cl-item ${c.done ? 'done' : ''}`} onClick={() => toggleItem(c.id)}>
              <span className={`check ${c.done ? 'on' : ''}`}>{c.done ? '✓' : ''}</span>
              <span>{c.text}</span>
            </button>
          ))}
          <button type="button" className="btn btn-sm btn-ghost cl-edit" onClick={() => onOpen(task)}>
            <i className="fa-solid fa-pen" /> Открыть задачу
          </button>
        </div>
      )}

      {!compact && <div className="task-foot">
        <span className="who" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          от <Avatar email={author?.email} avatar={author?.avatar} /> {author?.name}
        </span>
        <span className="spacer" />
        {canLike ? (
          <button
            className={`like ${liked ? 'on' : ''}`}
            onClick={(e) => { e.stopPropagation(); toggleLike(task, me.uid); }}
            aria-label={liked ? 'Убрать сердечко' : 'Поставить сердечко'}
          >
            {liked ? '♥' : '♡'}
          </button>
        ) : (
          liked && <span className="like on" aria-label="Партнёру нравится">♥</span>
        )}
      </div>}
    </div>
    </div>
  );
}
