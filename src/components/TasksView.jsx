import { useMemo, useState } from 'react';
import { TaskCard } from './TaskCard';
import { isActive, isClosed } from '../lib/util';

export function TasksView({ tasks, me, users, userOf, onOpen }) {
  const [filter, setFilter] = useState('active');

  const projects = useMemo(() => {
    const s = new Set();
    tasks.forEach((t) => (t.projectTags || []).forEach((p) => s.add(p)));
    return [...s];
  }, [tasks]);
  const [project, setProject] = useState(null);

  const list = useMemo(() => {
    let r = tasks;
    if (filter === 'active') r = r.filter(isActive);
    else if (filter === 'mine') r = r.filter((t) => t.assigneeUid === me.uid && isActive(t));
    else if (filter === 'partner') r = r.filter((t) => t.assigneeUid !== me.uid && isActive(t));
    else if (filter === 'review') r = r.filter((t) => t.status === 'in_review' && t.authorUid === me.uid);
    else if (filter === 'done') r = r.filter(isClosed);
    if (project) r = r.filter((t) => (t.projectTags || []).includes(project));
    return r;
  }, [tasks, filter, project, me.uid]);

  const reviewCount = tasks.filter((t) => t.status === 'in_review' && t.authorUid === me.uid).length;

  const F = [
    ['active', 'Активные'],
    ['mine', 'Мои'],
    ['partner', 'Партнёра'],
    ['review', `На проверке${reviewCount ? ' · ' + reviewCount : ''}`],
    ['done', 'Закрытые'],
  ];

  return (
    <div>
      <div className="filters">
        {F.map(([k, l]) => (
          <button key={k} className={`pill ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>

      {projects.length > 0 && (
        <div className="filters">
          <button className={`pill ${!project ? 'on' : ''}`} onClick={() => setProject(null)}>Все проекты</button>
          {projects.map((p) => (
            <button key={p} className={`pill ${project === p ? 'on' : ''}`} onClick={() => setProject(p)}>{p}</button>
          ))}
        </div>
      )}

      {list.length === 0 ? (
        <div className="empty">Здесь пусто. Жми «+», чтобы добавить задачу.</div>
      ) : (
        list.map((t) => <TaskCard key={t.id} task={t} me={me} userOf={userOf} onOpen={onOpen} />)
      )}
    </div>
  );
}
