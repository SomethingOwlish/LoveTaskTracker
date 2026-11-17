// Действия с задачами, которые показывают тост с «Отменить».
import { completeTask, undoComplete, deleteTask, restoreTask } from './db';
import { toast, reportError } from './toast';

export function completeWithUndo(task) {
  completeTask(task).then((res) => {
    res.done?.catch((e) => reportError(e, 'Не сохранилось'));
    const repeats = task.recurrence && task.recurrence !== 'none';
    const text = res.kind === 'review' ? 'Отправлено на проверку' : repeats ? 'Готово! Следующая уже в списке' : 'Готово!';
    toast(text, { ms: 5000, action: { label: 'Отменить', fn: () => undoComplete(task, res).catch((e) => reportError(e)) } });
  }).catch((e) => reportError(e, 'Не сохранилось'));
}

export function deleteWithUndo(task) {
  deleteTask(task).catch((e) => reportError(e, 'Не удалилось'));
  toast(`Удалено: «${task.title}»`, { ms: 6000, action: { label: 'Отменить', fn: () => restoreTask(task).catch((e) => reportError(e)) } });
}
