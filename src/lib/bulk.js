/* Пакетное редактирование задач (только на компьютере): чистые функции,
   которые считают правки. Запись — bulkUpdateTasks в db.js. */

function at2359(d) {
  const x = new Date(d);
  x.setHours(23, 59, 0, 0);
  return x;
}
const isWeekend = (d) => d.getDay() === 0 || d.getDay() === 6;

/* Раскидать count задач по дням начиная со start:
   perDay — сколько задач в день, everyDays — шаг между днями,
   skipWeekends — субботы и воскресенья пропускаем. */
export function spreadDates(count, { start, perDay = 1, everyDays = 1, skipWeekends = false }) {
  const per = Math.max(1, Math.floor(perDay) || 1);
  const step = Math.max(1, Math.floor(everyDays) || 1);
  let day = at2359(start);
  if (skipWeekends) while (isWeekend(day)) day.setDate(day.getDate() + 1);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (i > 0 && i % per === 0) {
      day = new Date(day);
      day.setDate(day.getDate() + step);
      if (skipWeekends) while (isWeekend(day)) day.setDate(day.getDate() + 1);
    }
    out.push(new Date(day));
  }
  return out;
}

// «2026-11-25» из <input type="date"> → дата в 23:59 по местному времени.
export function fromDateInput(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || '');
  return m ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 0, 0) : null;
}

/* Правки для выбранных задач. tasks — в порядке, как они видны в списке.
   action:
     { type: 'project', value, mode: 'add' | 'set' | 'clear' }
     { type: 'deadline', date }
     { type: 'spread', start, perDay, everyDays, skipWeekends }
     { type: 'assignee', uid }
     { type: 'importance', value }   // 3 — важно, 0 — обычная
   Возвращает [{ id, patch, before }] — before нужен для «Отменить». */
export function bulkPatches(tasks, action) {
  const keep = (t, keys) => Object.fromEntries(keys.map((k) => [k, t[k] ?? null]));
  switch (action.type) {
    case 'project': {
      const v = (action.value || '').trim().replace(/^#/, '');
      return tasks.map((t) => {
        const cur = t.projectTags || [];
        let next;
        if (action.mode === 'clear') next = [];
        else if (!v) return null;
        else if (action.mode === 'set') next = [v];
        else next = cur.includes(v) ? cur : [...cur, v];
        if (next.length === cur.length && next.every((x, i) => x === cur[i])) return null;
        return { id: t.id, patch: { projectTags: next }, before: { projectTags: cur } };
      }).filter(Boolean);
    }
    case 'deadline':
      if (!action.date) return [];
      return tasks.map((t) => ({ id: t.id, patch: { deadline: at2359(action.date) }, before: keep(t, ['deadline']) }));
    case 'spread': {
      if (!action.start) return [];
      const dates = spreadDates(tasks.length, action);
      return tasks.map((t, i) => ({ id: t.id, patch: { deadline: dates[i] }, before: keep(t, ['deadline']) }));
    }
    case 'assignee':
      return tasks
        .filter((t) => t.assigneeUid !== action.uid)
        .map((t) => ({ id: t.id, patch: { assigneeUid: action.uid }, before: { assigneeUid: t.assigneeUid } }));
    case 'importance':
      return tasks.map((t) => {
        const pm = t.priorityMatrix || { importance: 0, urgency: 0 };
        if ((pm.importance ?? 0) === action.value) return null;
        return { id: t.id, patch: { priorityMatrix: { ...pm, importance: action.value } }, before: { priorityMatrix: pm } };
      }).filter(Boolean);
    default:
      return [];
  }
}
