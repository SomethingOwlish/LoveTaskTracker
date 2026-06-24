export const TaskList = ({ tasks }) => (
  <div className="flex flex-col gap-4">
    {tasks.length === 0 ? (
      <div className="text-center mt-10 opacity-50">Задач пока нет. Добавь первую!</div>
    ) : (
      tasks.map(t => (
        <div key={t.id} className="glass-card p-5 border-l-4 border-[var(--accent)] hover:bg-white/10 transition">
          <h3 className="font-bold text-lg mb-1">{t.title}</h3>
          <p className="text-sm opacity-70 mb-3">{t.description || 'Без описания'}</p>
          <div className="flex gap-2">
            <span className="text-[10px] uppercase tracking-wider font-bold opacity-50 border border-current px-2 py-0.5 rounded">
              {t.priority || 'Обычный'}
            </span>
          </div>
        </div>
      ))
    )}
  </div>
);