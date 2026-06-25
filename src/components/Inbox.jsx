import { Avatar } from './Avatar';
import { toDate, fmtDate } from '../lib/util';

// Считаем, что требует внимания именно меня.
export function inboxItems(tasks, me) {
  const review = tasks.filter((t) => t.status === 'in_review' && t.authorUid === me.uid);
  const assigned = tasks.filter((t) => t.assigneeUid === me.uid && t.authorUid !== me.uid && ['open', 'in_progress'].includes(t.status));
  const returned = tasks.filter((t) => t.status === 'returned' && t.assigneeUid === me.uid);
  return { review, assigned, returned, total: review.length + assigned.length + returned.length };
}

function Group({ title, items, userOf, onOpen, icon }) {
  if (!items.length) return null;
  return (
    <>
      <div className="section-title" style={{ marginTop: 14 }}>{icon} {title} · {items.length}</div>
      {items.map((t) => {
        const other = userOf(t.authorUid);
        const dl = toDate(t.deadline);
        return (
          <div key={t.id} className="task" style={{ marginBottom: 8 }} onClick={() => onOpen(t)}>
            <div className="task-top"><h3 style={{ fontSize: 15 }}>{t.title}</h3></div>
            <div className="task-meta">
              <span className="who"><Avatar email={other?.email} avatar={other?.avatar} /> {other?.name}</span>
              {dl && <span>⌛ {fmtDate(dl)}</span>}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function Inbox({ tasks, me, userOf, onOpen, onClose }) {
  const { review, assigned, returned, total } = inboxItems(tasks, me);
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Входящие</h2>
          <button className="close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        {total === 0 && <p className="empty">Всё разобрано — пусто 🙌</p>}
        <Group title="Проверить" items={review} userOf={userOf} onOpen={onOpen} icon="🔎" />
        <Group title="Назначено тебе" items={assigned} userOf={userOf} onOpen={onOpen} icon="📥" />
        <Group title="Вернули на доработку" items={returned} userOf={userOf} onOpen={onOpen} icon="↩️" />
      </div>
    </div>
  );
}
