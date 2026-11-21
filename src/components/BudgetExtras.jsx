// Дополнения бюджета: регулярные платежи, лимиты категорий, график по месяцам.
import { useEffect, useMemo, useState } from 'react';
import { Sheet, Seg } from './Sheet';
import { reportError } from '../lib/toast';
import {
  saveRecurring, deleteRecurring, deleteTx, subscribeTxRange, totals, catIcon, lastPeriods, inPeriod,
  byCategory, spendBy, prevPeriod, fetchTxRange,
  EXPENSE_CATS, INCOME_CATS, FEE_CATEGORIES, POCKET_CATS,
} from '../lib/budget';
import { CURRENCIES, CURRENCY_CODES, fmtCur, curOf } from '../lib/currency';
import { parseMoney, dayKey, fromDayKey, fmtDate } from '../lib/util';

const EVERY = { month: 'каждый месяц', week: 'каждую неделю' };

/* ---------- Регулярные платежи ---------- */
export function RecurringList({ ctx }) {
  const [edit, setEdit] = useState(null); // null | 'new' | rec
  const list = ctx.recurring || [];
  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <div className="section-title" style={{ margin: '22px 0 10px' }}>Регулярные</div>
        <button className="btn btn-sm" style={{ flex: 'none' }} onClick={() => setEdit('new')}><i className="fa-solid fa-plus" /> Добавить</button>
      </div>
      {list.length === 0 && <p className="hint">Квартплата, подписки, карманные — заведи один раз, и они сами будут вставать в план.</p>}
      {list.map((r) => {
        const t = r.template || {};
        const w = ctx.wallets.find((x) => x.id === t.walletId);
        const cur = t.currency || ctx.base;
        return (
          <button key={r.id} type="button" className={`tx-row rec-row ${r.active ? '' : 'off'}`} onClick={() => setEdit(r)}>
            <span className={`tx-ico ${t.type}`}><i className={catIcon(t.category, t.type)} /></span>
            <span className="tx-main">
              <span className="tx-title">{t.note || t.category}</span>
              <span className="tx-sub">{EVERY[r.every]}{r.every === 'month' ? `, ${r.day}-го` : ''} · {w?.name || 'вне кошельков'} · след. {fmtDate(fromDayKey(r.nextDate))}{r.active ? '' : ' · на паузе'}</span>
            </span>
            <span className="tx-right"><span className={`money ${t.type === 'income' ? 'pos' : 'neg'}`}>{fmtCur(t.amount, cur)}</span></span>
          </button>
        );
      })}
      {edit && <RecurringSheet ctx={ctx} rec={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function RecurringSheet({ ctx, rec, onClose }) {
  const t = rec?.template || {};
  const [type, setType] = useState(t.type || 'expense');
  const [note, setNote] = useState(t.note || '');
  const [amount, setAmount] = useState(t.amount != null ? String(t.amount) : '');
  const [fee, setFee] = useState(t.fee ? String(t.fee) : '');
  const [walletId, setWalletId] = useState(t.walletId !== undefined ? t.walletId : (ctx.activeWallets[0]?.id || null));
  const [category, setCategory] = useState(t.category || '');
  const [every, setEvery] = useState(rec?.every || 'month');
  const [start, setStart] = useState(rec?.nextDate || dayKey());
  const [active, setActive] = useState(rec ? rec.active !== false : true);
  const cats = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  const cur = walletId ? ctx.walletCur(walletId) : ctx.base;
  const sum = parseMoney(amount);
  const ok = Number.isFinite(sum) && sum > 0;

  const save = () => {
    if (!ok) return;
    const template = {
      type, note: note.trim(), amount: sum, currency: cur, walletId: walletId || null,
      category: category || cats[cats.length - 1].id,
      fee: parseMoney(fee) || 0, feeCategory: type === 'income' ? 'Налоги' : 'Комиссии',
    };
    const day = Number(start.split('-')[2]);
    saveRecurring(rec?.id, { template, every, day, nextDate: start, active }).catch((e) => reportError(e));
    onClose();
  };

  const remove = () => {
    if (!confirm('Удалить регулярный платёж? Будущие запланированные по нему тоже уберутся.')) return;
    ctx.txs.filter((x) => x.planned && x.recurringId === rec.id).forEach((x) => deleteTx(x, ctx.known).catch(() => {}));
    deleteRecurring(rec.id).catch((e) => reportError(e));
    onClose();
  };

  return (
    <Sheet title={rec ? 'Регулярный платёж' : 'Новый регулярный'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-accent" disabled={!ok} onClick={save}>Сохранить</button></>}>
      <Seg value={type} onChange={(v) => { setType(v); setCategory(''); }} options={[['expense', 'Расход'], ['income', 'Доход']]} className="mb" />
      <div className="field"><label>Название</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Квартплата" /></div>
      <div className="row">
        <div className="field"><label>Сумма, {CURRENCIES[cur].symbol}</label><input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="field"><label>{type === 'income' ? 'Налог' : 'Комиссия'}</label><input className="input" inputMode="decimal" value={fee} placeholder="0" onChange={(e) => setFee(e.target.value)} /></div>
      </div>
      <div className="field">
        <label>Кошелёк</label>
        <div className="chips">
          {ctx.activeWallets.map((w) => (
            <button key={w.id} type="button" className={`chip pick ${walletId === w.id ? 'on' : ''}`} onClick={() => setWalletId(w.id)}><i className={w.icon} /> {w.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Категория</label>
        <div className="chips">
          {cats.map((c) => (
            <button key={c.id} type="button" className={`chip pick ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}><i className={c.icon} /> {c.id}</button>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="field"><label>Как часто</label><Seg value={every} onChange={setEvery} options={[['month', 'Месяц'], ['week', 'Неделя']]} /></div>
        <div className="field"><label>Ближайший раз</label><input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value || dayKey())} /></div>
      </div>
      <p className="hint">Платёж будет сам вставать в «План» примерно за месяц. Когда реально заплатишь — жми «Провести».</p>
      {rec && (
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn" onClick={() => setActive((v) => !v)}>{active ? 'Поставить на паузу' : 'Возобновить'}</button>
          <button className="btn btn-ghost" style={{ color: 'var(--bad)' }} onClick={remove}>Удалить</button>
        </div>
      )}
    </Sheet>
  );
}

/* ---------- Лимиты и основная валюта ---------- */
export function LimitsSheet({ ctx, onClose, save, cats }) {
  const [base, setBase] = useState(ctx.settings.baseCurrency || ctx.base);
  const [vals, setVals] = useState(() => {
    const v = {};
    Object.entries(ctx.settings.limits || {}).forEach(([k, x]) => { v[k] = String(x); });
    return v;
  });
  const pockets = Object.values(POCKET_CATS);
  const ordered = [...pockets, ...cats.map((c) => c.id).filter((c) => !pockets.includes(c) && !FEE_CATEGORIES.includes(c))];

  const submit = () => {
    const limits = {};
    Object.entries(vals).forEach(([k, v]) => { const n = parseMoney(v); if (Number.isFinite(n) && n > 0) limits[k] = n; });
    save({ baseCurrency: base, limits }).catch((e) => reportError(e));
    onClose();
  };

  return (
    <Sheet title="Лимиты и валюта" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-accent" onClick={submit}>Сохранить</button></>}>
      <div className="field">
        <label>Основная валюта сводок</label>
        <Seg value={base} onChange={setBase} options={CURRENCY_CODES.map((c) => [c, `${CURRENCIES[c].symbol} ${c}`])} />
        <div className="hint">В ней считаются «Всего», «Пришло/Ушло», лимиты и графики. Кошельки остаются в своих валютах.</div>
      </div>
      <div className="section-title">Лимит на бюджетный месяц, {CURRENCIES[base].symbol}</div>
      {ordered.map((c) => (
        <div key={c} className="limit-row">
          <span className="cat-name"><i className={catIcon(c, 'expense')} /> {c}</span>
          <input className="input" inputMode="decimal" placeholder="без лимита" value={vals[c] || ''} onChange={(e) => setVals((p) => ({ ...p, [c]: e.target.value }))} />
        </div>
      ))}
    </Sheet>
  );
}

/* ---------- График по месяцам ---------- */
// Последние 6 бюджетных месяцев (от зарплаты до зарплаты; до первой — календарные)
export function MonthsChart({ ctx }) {
  const startsKey = (ctx.starts || []).map((d) => d.getTime()).join(',');
  const periods = useMemo(() => lastPeriods(6, ctx.starts || []), [startsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const [list, setList] = useState(null);
  // полгода операций читаем только по явной кнопке
  const fromMs = periods[0].from.getTime();
  useEffect(() => subscribeTxRange(new Date(fromMs), null, setList), [fromMs]);
  if (!list) return <p className="hint"><i className="fa-solid fa-spinner fa-spin" /> Загружаю…</p>;
  const label = (p) => (p.salary ? fmtDate(p.from).replace(/ (\S{3})\S*$/, ' $1') : p.from.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', ''));
  const rows = periods.map((p) => ({
    m: p.from, title: label(p),
    ...totals(list.filter((t) => !t.planned && inPeriod(t, p)), ctx.base, ctx.fx),
  }));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
  return (
    <div className="months-chart">
      {rows.map((r) => (
        <div key={r.m.toISOString()} className="mc-col" title={`с ${fmtDate(r.m)}: +${fmtCur(r.income, ctx.base)} / −${fmtCur(r.expense, ctx.base)}`}>
          <div className="mc-bars">
            <span className="mc-bar inc" style={{ height: `${(r.income / max) * 100}%` }} />
            <span className="mc-bar exp" style={{ height: `${(r.expense / max) * 100}%` }} />
          </div>
          <div className="mc-label">{r.title}</div>
          <div className="mc-net">{r.income - r.expense >= 0 ? '+' : '−'}{fmtShort(Math.abs(r.income - r.expense))}</div>
        </div>
      ))}
      <div className="mc-legend"><span className="mc-dot inc" /> пришло <span className="mc-dot exp" /> ушло · в {CURRENCIES[ctx.base].symbol}</div>
    </div>
  );
}

function fmtShort(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'м';
  if (n >= 1e3) return Math.round(n / 1e3) + 'к';
  return String(Math.round(n));
}

/* ---------- Итоги бюджетного месяца ---------- */
// Импорт из BudgetView — по кругу, но используется только при отрисовке.
import { WhoSpent, POCKET_OWNER } from './BudgetView';

export function SummarySheet({ ctx, period, title, onClose }) {
  const [list, setList] = useState(null);
  const [prev, setPrev] = useState(null);
  const key = period.from.getTime();
  useEffect(() => subscribeTxRange(period.from, period.to, setList), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const p = prevPeriod(period, ctx.starts || []);
    let alive = true;
    fetchTxRange(p.from, p.to || period.from).then((l) => alive && setPrev(l)).catch(() => {});
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const f = (v) => fmtCur(v, ctx.base);
  if (!list) return <Sheet title={`Итоги · ${title}`} onClose={onClose}><p className="hint"><i className="fa-solid fa-spinner fa-spin" /> Считаю…</p></Sheet>;

  const actual = list.filter((t) => !t.planned && inPeriod(t, period));
  const { income, expense } = totals(actual, ctx.base, ctx.fx);
  const cats = byCategory(actual, ctx.base, ctx.fx);
  const who = spendBy(actual, ctx.base, ctx.fx, POCKET_OWNER);
  const prevExp = prev ? totals(prev, ctx.base, ctx.fx).expense : null;
  const diff = prevExp != null && prevExp > 0 ? expense - prevExp : null;
  const biggest = actual.filter((t) => t.type === 'expense').sort((a, b) => b.amount - a.amount)[0];
  const limits = ctx.settings?.limits || {};
  const over = cats.filter((c) => limits[c.cat] && c.sum > limits[c.cat]);

  return (
    <Sheet title={`Итоги · ${title}`} onClose={onClose}>
      <div className="stats money-stats">
        <div className="stat"><div className="n pos">{f(income)}</div><div className="l">Пришло</div></div>
        <div className="stat"><div className="n neg">{f(expense)}</div><div className="l">Ушло</div></div>
        <div className="stat"><div className={`n ${income - expense >= 0 ? 'pos' : 'neg'}`}>{f(income - expense)}</div><div className="l">{income - expense >= 0 ? 'Отложили' : 'В минус'}</div></div>
      </div>
      {diff != null && (
        <p className="hint" style={{ textAlign: 'center' }}>
          Потратили на <b>{f(Math.abs(diff))}</b> {diff > 0 ? 'больше' : 'меньше'}, чем в прошлом месяце{diff < 0 ? ' 🎉' : ''}
        </p>
      )}
      <div className="section-title">Кто сколько</div>
      <WhoSpent who={who} />
      <div className="section-title">Главные категории</div>
      {cats.slice(0, 6).map((c) => (
        <div key={c.cat} className={`cat-bar ${limits[c.cat] && c.sum > limits[c.cat] ? 'over' : ''}`}>
          <span className="cat-name"><i className={catIcon(c.cat, 'expense')} /> {c.cat}</span>
          <span className="cat-track"><span style={{ width: `${(c.sum / cats[0].sum) * 100}%` }} /></span>
          <span className="cat-sum">{f(c.sum)}</span>
        </div>
      ))}
      {!cats.length && <p className="hint">Расходов не было.</p>}
      {over.length > 0 && <p className="hint bad">Вышли за лимит: {over.map((c) => c.cat).join(', ')}.</p>}
      {biggest && <p className="hint">Самая крупная трата: <b>{biggest.note || biggest.category}</b> — {fmtCur(biggest.amount, curOf(biggest, ctx.base))}.</p>}
    </Sheet>
  );
}

export { curOf };
