// Дополнения бюджета: регулярные платежи, лимиты категорий, график по месяцам.
import { useEffect, useMemo, useState } from 'react';
import { Sheet, Seg } from './Sheet';
import { reportError } from '../lib/toast';
import {
  saveRecurring, deleteRecurring, deleteTx, subscribeTxRange, totals, catIcon,
  EXPENSE_CATS, INCOME_CATS, FEE_CATEGORIES, POCKET_CATS,
} from '../lib/budget';
import { CURRENCIES, CURRENCY_CODES, fmtCur, curOf } from '../lib/currency';
import { parseMoney, dayKey, fromDayKey, fmtDate, monthTitle } from '../lib/util';

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
      <div className="section-title">Лимит на месяц, {CURRENCIES[base].symbol}</div>
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
export function MonthsChart({ ctx }) {
  const months = useMemo(() => Array.from({ length: 6 }, (_, i) => {
    const d = new Date(); d.setDate(1); d.setHours(12); d.setMonth(d.getMonth() - 5 + i); return d;
  }), []);
  const [list, setList] = useState(null);
  // полгода операций читаем только по явной кнопке
  useEffect(() => {
    const from = new Date(months[0].getFullYear(), months[0].getMonth(), 1);
    const to = new Date(months[5].getFullYear(), months[5].getMonth() + 1, 1);
    return subscribeTxRange(from, to, setList);
  }, [months]);
  if (!list) return <p className="hint"><i className="fa-solid fa-spinner fa-spin" /> Загружаю…</p>;
  const rows = months.map((m) => ({
    m,
    ...totals(list.filter((t) => { const d = t.date?.toDate?.(); return d && d.getMonth() === m.getMonth() && d.getFullYear() === m.getFullYear(); }), ctx.base, ctx.fx),
  }));
  const max = Math.max(1, ...rows.map((r) => Math.max(r.income, r.expense)));
  return (
    <div className="months-chart">
      {rows.map((r) => (
        <div key={r.m.toISOString()} className="mc-col" title={`${monthTitle(r.m)}: +${fmtCur(r.income, ctx.base)} / −${fmtCur(r.expense, ctx.base)}`}>
          <div className="mc-bars">
            <span className="mc-bar inc" style={{ height: `${(r.income / max) * 100}%` }} />
            <span className="mc-bar exp" style={{ height: `${(r.expense / max) * 100}%` }} />
          </div>
          <div className="mc-label">{monthTitle(r.m).slice(0, 3)}</div>
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

export { curOf };
