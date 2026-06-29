import { Avatar } from './Avatar';
import { tsMs } from '../lib/util';

// Описание каждого типа уведомления: иконка (Font Awesome) и текст действия.
const TYPES = {
  assigned: { icon: 'fa-solid fa-clipboard-list', verb: 'поставил(а) задачу' },
  comment: { icon: 'fa-solid fa-comment', verb: 'оставил(а) комментарий' },
  like: { icon: 'fa-solid fa-heart', verb: 'оценил(а) задачу' },
};

export function Inbox({ notifs, userOf, onOpen, onClose, onClear, viewedFrom = 0 }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Уведомления</h2>
          <button className="close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>

        {notifs.length === 0 ? (
          <p className="empty"><i className="fa-regular fa-bell-slash" style={{ marginRight: 8 }} />Пока пусто.</p>
        ) : (
          <>
            <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 10 }}>
              <button className="btn btn-sm btn-ghost" style={{ flex: 'none', color: 'var(--text-dim)' }} onClick={onClear}>
                <i className="fa-solid fa-trash" style={{ marginRight: 6 }} />Очистить все
              </button>
            </div>
            {notifs.map((n) => {
              const t = TYPES[n.type] || TYPES.comment;
              const actor = userOf(n.actorUid);
              const fresh = tsMs(n.createdAt) > viewedFrom;
              return (
                <div key={n.id} className={`notif ${fresh ? 'fresh' : ''}`} onClick={() => onOpen(n.taskId)}>
                  <span className={`notif-ico ${n.type}`}><i className={t.icon} /></span>
                  <div className="notif-body">
                    <div className="notif-line">
                      <span className="who"><Avatar email={actor?.email} avatar={actor?.avatar} /> {actor?.name || '—'}</span>{' '}
                      {t.verb}
                    </div>
                    <div className="notif-title">{n.taskTitle || 'Задача'}</div>
                    {n.type === 'comment' && n.text && <div className="notif-text">«{n.text}»</div>}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// Сколько уведомлений новее последнего просмотра.
export function unreadCount(notifs, readAt) {
  return notifs.filter((n) => tsMs(n.createdAt) > readAt).length;
}
