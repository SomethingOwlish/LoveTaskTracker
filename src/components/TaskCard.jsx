export const TaskCard = ({ task }) => (
  <div className="glass p-5 border-l-4 border-[var(--accent)] space-y-3">
    <div className="flex justify-between items-start">
      <h3 className="font-bold text-lg">{task.title}</h3>
      <div className="flex gap-2">
        <span className="text-[10px] uppercase bg-white/10 px-2 py-1 rounded">{task.project || 'Без проекта'}</span>
        <button className="w-6 h-6 border rounded-full" /> {/* Кнопка выполненности */}
      </div>
    </div>
    <p className="text-sm opacity-80">{task.description}</p>
    <div className="flex flex-wrap gap-2">
      {task.tags?.map(t => <span key={t} className="text-[10px] underline">{t}</span>)}
    </div>
    <div className="flex justify-between text-[11px] opacity-50">
      <span>Срок: {task.deadline || 'Без срока'}</span>
      <span>Приоритет: {task.priority || 'Средний'}</span>
    </div>
    <div className="grid grid-cols-2 gap-2 mt-2 border-t border-white/10 pt-2">
      <div className="text-[10px] opacity-40">Ссылка: {task.link || 'Нет'}</div>
      <div className="text-[10px] opacity-40">Чеклист: {task.checklist?.length || 0} пунктов</div>
    </div>
  </div>
);