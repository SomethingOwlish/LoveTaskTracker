/* Пакетное редактирование задач — только на компьютере (широкий экран и мышь):
   на телефоне длинная панель и выбор десятков карточек неудобны, а свайпы
   карточек там важнее. «Выбрать» → отмечаешь задачи → внизу панель:
   проект, срок, раскидать по дням, кому, важность. У каждой правки — «Отменить». */
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { bulkPatches, fromDateInput } from '../lib/bulk';
import { bulkUpdateTasks } from '../lib/db';
import { projectsOf } from '../lib/util';
import { toast, reportError } from '../lib/toast';

export const BulkCtx = createContext(null);
export const useBulk = () => useContext(BulkCtx);

const DESKTOP = '(min-width: 900px) and (hover: hover) and (pointer: fine)';
export function useIsDesktop() {
  const get = () => typeof window !== 'undefined' && !!window.matchMedia?.(DESKTOP).matches;
  const [ok, setOk] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(DESKTOP);
    if (!mq) return undefined;
    const on = () => setOk(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return ok;
}

// Состояние выбора; order — порядок задач в видимом списке (для «раскидать»).
export function useBulkState() {
  const [on, setOn] = useState(false);
  const [sel, setSel] = useState(() => new Set());
  const [order, setOrder] = useState([]);
  return useMemo(() => ({
    on,
    sel,
    order,
    setOrder,
    start: () => setOn(true),
    stop: () => { setOn(false); setSel(new Set()); },
    has: (id) => sel.has(id),
    toggle: (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }),
    setMany: (ids, value) => setSel((s) => { const n = new Set(s); ids.forEach((id) => (value ? n.add(id) : n.delete(id))); return n; }),
    clear: () => setSel(new Set()),
  }), [on, sel, order]);
}

// Список сообщает панели, в каком порядке видны задачи.
export function useBulkOrder(ids) {
  const bulk = useBulk();
  const key = ids.join('|');
  useEffect(() => {
    if (bulk?.on) bulk.setOrder(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulk?.on, key]);
}

// «Выбрать все» / «Снять» для группы задач (раздел или весь список).
export function SelectGroup({ ids }) {
  const bulk = useBulk();
  if (!bulk?.on || !ids.length) return null;
  const all = ids.every((id) => bulk.sel.has(id));
  return (
    <button type="button" className="bulk-group" onClick={(e) => { e.stopPropagation(); bulk.setMany(ids, !all); }}>
      {all ? 'снять' : 'выбрать все'}
    </button>
  );
}

const tomorrowInput = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function BulkBar({ tasks, me, partner }) {
  const bulk = useBulk();
  const [project, setProject] = useState('');
  const [date, setDate] = useState('');
  const [start, setStart] = useState(tomorrowInput);
  const [perDay, setPerDay] = useState(1);
  const [everyDays, setEveryDays] = useState(1);
  const [skipWeekends, setSkipWeekends] = useState(false);
  const [busy, setBusy] = useState(false);
  const projects = useMemo(() => projectsOf(tasks, me.uid), [tasks, me.uid]);

  if (!bulk?.on) return null;

  // выбранные — в порядке, как видны в списке
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const ordered = [
    ...bulk.order.filter((id) => bulk.sel.has(id)),
    ...[...bulk.sel].filter((id) => !bulk.order.includes(id)),
  ].map((id) => byId.get(id)).filter(Boolean);
  const n = ordered.length;

  const apply = async (action, label) => {
    const entries = bulkPatches(ordered, action);
    if (!entries.length) return toast('Нечего менять — у выбранных уже так.');
    setBusy(true);
    try {
      await bulkUpdateTasks(entries.map(({ id, patch }) => ({ id, patch })));
      toast(`${label}: ${entries.length}`, {
        ms: 8000,
        action: { label: 'Отменить', fn: () => bulkUpdateTasks(entries.map(({ id, before }) => ({ id, patch: before }))).catch((e) => reportError(e)) },
      });
    } catch (e) {
      reportError(e, 'Не сохранилось');
    } finally {
      setBusy(false);
    }
  };

  const dis = busy || !n;
  return (
    <>
    <div className="bulk-spacer" aria-hidden="true" />
    <div className="bulk-bar" role="region" aria-label="Пакетное редактирование">
      <div className="bulk-row bulk-head">
        <b>Выбрано: {n}</b>
        {n > 0 && <button type="button" className="link-btn" onClick={bulk.clear}>снять выбор</button>}
        <span className="spacer" />
        <button type="button" className="btn btn-sm" onClick={bulk.stop}>Готово</button>
      </div>

      <div className="bulk-row">
        <span className="bulk-lbl">Проект</span>
        <input className="input bulk-input" list="bulk-projects" value={project} placeholder="название"
          onChange={(e) => setProject(e.target.value)} />
        <datalist id="bulk-projects">{projects.map((p) => <option key={p} value={p} />)}</datalist>
        <button type="button" className="btn btn-sm" disabled={dis || !project.trim()} onClick={() => apply({ type: 'project', value: project, mode: 'add' }, 'Проект добавлен')}>Добавить</button>
        <button type="button" className="btn btn-sm" disabled={dis || !project.trim()} onClick={() => apply({ type: 'project', value: project, mode: 'set' }, 'Проект заменён')}>Заменить</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={dis} onClick={() => apply({ type: 'project', mode: 'clear' }, 'Проекты убраны')}>Убрать все</button>
      </div>

      <div className="bulk-row">
        <span className="bulk-lbl">Срок</span>
        <input type="date" className="input bulk-input" value={date} onChange={(e) => setDate(e.target.value)} />
        <button type="button" className="btn btn-sm" disabled={dis || !date} onClick={() => apply({ type: 'deadline', date: fromDateInput(date) }, 'Срок поставлен')}>Всем этот день</button>
      </div>

      <div className="bulk-row">
        <span className="bulk-lbl">Раскидать</span>
        <span>с</span>
        <input type="date" className="input bulk-input" value={start} onChange={(e) => setStart(e.target.value)} />
        <span>по</span>
        <input type="number" min="1" max="20" className="input bulk-num" value={perDay} onChange={(e) => setPerDay(e.target.value)} />
        <span>в день, через</span>
        <input type="number" min="1" max="30" className="input bulk-num" value={everyDays} onChange={(e) => setEveryDays(e.target.value)} />
        <span>дн.</span>
        <label className="bulk-check"><input type="checkbox" checked={skipWeekends} onChange={(e) => setSkipWeekends(e.target.checked)} /> без выходных</label>
        <button type="button" className="btn btn-sm btn-primary" disabled={dis || !start}
          onClick={() => apply({ type: 'spread', start: fromDateInput(start), perDay: +perDay, everyDays: +everyDays, skipWeekends }, 'Раскидано по дням')}>
          Раскидать
        </button>
      </div>

      <div className="bulk-row">
        <span className="bulk-lbl">Кому</span>
        {[me, partner].filter(Boolean).map((u) => (
          <button key={u.uid} type="button" className="btn btn-sm" disabled={dis} onClick={() => apply({ type: 'assignee', uid: u.uid }, `Теперь у: ${u.name}`)}>
            <Avatar email={u.email} avatar={u.avatar} /> {u.uid === me.uid ? 'Себе' : u.name}
          </button>
        ))}
      </div>

      <div className="bulk-row">
        <span className="bulk-lbl">Важность</span>
        <button type="button" className="btn btn-sm" disabled={dis} onClick={() => apply({ type: 'importance', value: 3 }, 'Отмечено важным')}>Важно</button>
        <button type="button" className="btn btn-sm btn-ghost" disabled={dis} onClick={() => apply({ type: 'importance', value: 0 }, 'Снята важность')}>Обычная</button>
      </div>
      <div className="bulk-hint">Раскидывает в том порядке, в каком задачи стоят в списке.</div>
    </div>
    </>
  );
}
