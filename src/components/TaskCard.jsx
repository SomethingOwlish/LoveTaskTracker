import { Avatar } from './Avatar';
import { toDate, fmtDate, quadrant, isClosed, startOfToday, isSameDay } from '../lib/util';
import { RECURRENCE_LABEL } from '../lib/recurrence';
import { reopenTask, toggleLike } from '../lib/db';
import { completeWithUndo } from '../lib/actions';
import { reportError } from '../lib/toast';

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

  // цвет левой полоски: по первому проекту из настроек смотрящего, иначе акцент
  const proj = (task.projectTags || [])[0];
  const stripe = (proj && projectColors[proj]) || 'var(--accent)';

  const overdue = !closed && dl && dl < startOfToday();
  const dlLabel = dl && (isSameDay(dl, new Date()) ? 'сегодня' : fmtDate(dl));
  const repeats = task.recurrence && task.recurrence !== 'none';

  const onCheck = (e) => {
    e.stopPropagation();
    if (closed) return reopenTask(task).catch((e) => reportError(e));
    if (task.status === 'in_review') return onOpen(task);
    return completeWithUndo(task);
  };

  return (
    <div className={`task ${closed ? 'done' : ''} ${compact ? 'compact' : ''}`} style={{ borderLeftColor: stripe }} onClick={() => onOpen(task)}>
      <div className="task-top">
        <button
          className={`check ${closed ? 'on' : ''}`}
          onClick={onCheck}
          aria-label={closed ? 'Вернуть в работу' : 'Отметить выполненной'}
        >
          {closed ? '✓' : ''}
        </button>
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
        {repeats && <span title={RECURRENCE_LABEL[task.recurrence]}><i className="fa-solid fa-rotate" /> {RECURRENCE_LABEL[task.recurrence].toLowerCase()}</span>}
        {!compact && <span>{q.label}</span>}
        {checkTotal > 0 && (
          <span className="chip tag" style={allDone ? { color: 'var(--good)', borderColor: 'color-mix(in srgb, var(--good) 60%, transparent)' } : undefined}>
            ☑ {checkDone}/{checkTotal}
          </span>
        )}
        {task.link && <span><i className="fa-solid fa-link" /></span>}
      </div>

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
  );
}
