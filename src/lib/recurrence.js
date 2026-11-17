// Пересчёт следующей даты для повторяющейся задачи.
export function nextRecurrence(base, kind) {
  const d = new Date(base.getTime());
  switch (kind) {
    case 'daily':
      d.setDate(d.getDate() + 1);
      break;
    case 'weekly':
      d.setDate(d.getDate() + 7);
      break;
    case 'biweekly':
      d.setDate(d.getDate() + 14);
      break;
    case 'monthly': {
      // 31 января + месяц = 28/29 февраля, а не 3 марта
      const day = d.getDate();
      d.setDate(1);
      d.setMonth(d.getMonth() + 1);
      const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      d.setDate(Math.min(day, last));
      break;
    }
    default:
      break;
  }
  return d;
}

// Следующая дата строго в будущем: если задачу закрыли с опозданием на
// несколько периодов, новая не должна сразу оказаться просроченной.
export function nextFutureRecurrence(base, kind, now = new Date()) {
  let d = nextRecurrence(base, kind);
  let guard = 0;
  while (d <= now && guard++ < 1000) d = nextRecurrence(d, kind);
  return d;
}

export const RECURRENCE_LABEL = {
  none: 'Без повтора',
  daily: 'Каждый день',
  weekly: 'Каждую неделю',
  biweekly: 'Раз в две недели',
  monthly: 'Каждый месяц',
};
