import { Avatar } from './Avatar';
import { toDate, fmtDate, quadrant, isClosed } from '../lib/util';
import { completeTask, reopenTask, toggleLike } from '../lib/db';

export function TaskCard({ task, me, userOf, onOpen }) {
  const author = userOf(task.authorUid);
  const assignee = userOf(task.assigneeUid);
  const closed = isClosed(task);
  const dl = toDate(task.deadline);
  const q = quadrant(task.priorityMatrix?.importance ?? 0, task.priorityMatrix?.urgency ?? 0);
  const liked = (task.likes || []).includes(me.uid);
  const checkDone = (task.checklist || []).filter((c) => c.done).length;

  const onCheck = (e) => {
    e.stopPropagation();
    if (closed) return reopenTask(task);
    // задача на проверке закрывается только автором (через карточку задачи)
    if (task.status === 'in_review') return onOpen(task);
    return completeTask(task);
  };

  return (
    <div className={`task ${closed ? 'done' : ''}`} onClick={() => onOpen(task)}>
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

      {task.description && <p className="desc">{task.description}</p>}

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
        {dl && <span>⌛ {fmtDate(dl)}</span>}
        <span>{q.label}</span>
        {task.checklist?.length ? <span>☑ {checkDone}/{task.checklist.length}</span> : null}
        {task.link && <span>🔗</span>}
      </div>

      <div className="task-foot">
        <span className="who" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          от <Avatar email={author?.email} avatar={author?.avatar} /> {author?.name}
        </span>
        <span className="spacer" />
        <button
          className={`like ${liked ? 'on' : ''}`}
          onClick={(e) => { e.stopPropagation(); toggleLike(task, me.uid); }}
        >
          {liked ? '♥' : '♡'} {task.likes?.length || 0}
        </button>
      </div>
    </div>
  );
}
