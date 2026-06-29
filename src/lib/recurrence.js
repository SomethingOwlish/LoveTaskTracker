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
    case 'monthly':
      d.setMonth(d.getMonth() + 1);
      break;
    default:
      break;
  }
  return d;
}
