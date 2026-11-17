import { useEffect, useMemo, useRef, useState } from 'react';
import { Sheet, Seg, Switch, loadPref, savePref } from './Sheet';
import { Avatar } from './Avatar';
import {
  subscribeWallets, subscribeTx, subscribeProjects, subscribeReceipts,
  saveWallet, saveTx, deleteTx, commitPlanned, saveProject, deleteProject,
  addReceipt, loadReceiptImage, deleteReceipt,
  walletBalances, inMonth, byCategory, totals, catIcon,
  EXPENSE_CATS, INCOME_CATS, WALLET_ICONS,
} from '../lib/budget';
import { processReceiptPhoto } from '../lib/receipt';
import { fmtMoney, parseMoney, monthTitle, toDate, dayKey, fmtDate, fmtWeekday, isSameDay, uid6 } from '../lib/util';

const TYPE_LABEL = { expense: 'Расход', income: 'Доход', transfer: 'Перевод' };

export function BudgetView({ me, userOf }) {
  const [wallets, setWallets] = useState([]);
  const [txs, setTxs] = useState([]);
  const [projects, setProjects] = useState([]);
  const [receipts, setReceipts] = useState([]);
  useEffect(() => {
    const u = [subscribeWallets(setWallets), subscribeTx(setTxs), subscribeProjects(setProjects), subscribeReceipts(setReceipts)];
    return () => u.forEach((f) => f());
  }, []);

  const [tab, setTabState] = useState(() => loadPref('budgetTab', 'overview'));
  const setTab = (t) => { setTabState(t); savePref('budgetTab', t); };
  const [month, setMonth] = useState(() => { const d = new Date(); d.setDate(1); d.setHours(12); return d; });
  const [txSheet, setTxSheet] = useState(null); // { tx?, initial? }
  const [walletSheet, setWalletSheet] = useState(null);
  const [showReceipts, setShowReceipts] = useState(false);
  const [projectOpen, setProjectOpen] = useState(null);

  const activeWallets = wallets.filter((w) => !w.archived);
  const balances = useMemo(() => walletBalances(wallets, txs), [wallets, txs]);
  const newReceipts = receipts.filter((r) => r.status !== 'parsed');

  const ctx = {
    me, userOf, wallets, activeWallets, txs, projects, receipts, balances, month, setMonth,
    openTx: (tx, initial) => setTxSheet({ tx, initial }),
    openWallet: setWalletSheet,
    openReceipts: () => setShowReceipts(true),
    openProject: setProjectOpen,
  };

  return (
    <div>
      <Seg value={tab} onChange={setTab} className="mb"
        options={[['overview', 'Обзор'], ['ops', 'Операции'], ['plan', 'План'], ['projects', 'Проекты']]} />

      {tab === 'overview' && <Overview ctx={ctx} newReceipts={newReceipts} />}
      {tab === 'ops' && <Operations ctx={ctx} />}
      {tab === 'plan' && <Plan ctx={ctx} />}
      {tab === 'projects' && <Projects ctx={ctx} />}

      {walletSheet && <WalletSheet ctx={ctx} wallet={walletSheet === 'new' ? null : walletSheet} onClose={() => setWalletSheet(null)} />}
      {showReceipts && <ReceiptsSheet ctx={ctx} onClose={() => setShowReceipts(false)} />}
      {projectOpen && <ProjectSheet ctx={ctx} project={projectOpen === 'new' ? null : projects.find((p) => p.id === projectOpen.id) || projectOpen} onClose={() => setProjectOpen(null)} />}
      {/* операция — последней, чтобы открываться поверх кошелька/проекта */}
      {txSheet && <TxSheet ctx={ctx} tx={txSheet.tx} initial={txSheet.initial} onClose={() => setTxSheet(null)} />}
    </div>
  );
}

/* ---------- Общие куски ---------- */
function MonthNav({ month, setMonth }) {
  const move = (d) => { const n = new Date(month); n.setMonth(n.getMonth() + d); setMonth(n); };
  return (
    <div className="cal-head">
      <button className="btn btn-sm icon-btn" onClick={() => move(-1)} aria-label="Предыдущий месяц">‹</button>
      <h2>{monthTitle(month)}</h2>
      <button className="btn btn-sm icon-btn" onClick={() => move(1)} aria-label="Следующий месяц">›</button>
    </div>
  );
}

function Money({ value, type, signed }) {
  const cls = type === 'income' ? 'pos' : type === 'expense' ? 'neg' : '';
  const sign = signed ? (type === 'income' ? '+' : type === 'expense' ? '−' : '') : '';
  return <span className={`money ${cls}`}>{sign}{fmtMoney(value)}</span>;
}

function TxRow({ tx, ctx, showDate }) {
  const w = ctx.wallets.find((x) => x.id === tx.walletId);
  const to = ctx.wallets.find((x) => x.id === tx.toWalletId);
  const proj = ctx.projects.find((p) => p.id === tx.projectId);
  const d = toDate(tx.date);
  const author = ctx.userOf(tx.authorUid);
  return (
    <button type="button" className={`tx-row ${tx.planned ? 'planned' : ''}`} onClick={() => ctx.openTx(tx)}>
      <span className={`tx-ico ${tx.type}`}><i className={catIcon(tx.category, tx.type)} /></span>
      <span className="tx-main">
        <span className="tx-title">{tx.note || tx.category}{tx.receiptId && <i className="fa-solid fa-receipt tx-receipt" title="Есть чек" />}</span>
        <span className="tx-sub">
          {tx.type === 'transfer' ? `${w?.name || '—'} → ${to?.name || '—'}` : [tx.note ? tx.category : null, w?.name || 'вне кошельков'].filter(Boolean).join(' · ')}
          {proj && <> · <span className="chip project tiny">{proj.name}</span></>}
          {showDate && d && <> · {fmtDate(d)}</>}
          {tx.items?.length ? <> · {tx.items.length} поз.</> : null}
        </span>
      </span>
      <span className="tx-right">
        <Money value={tx.amount} type={tx.type} signed />
        {author && <Avatar email={author.email} avatar={author.avatar} />}
      </span>
    </button>
  );
}

function QuickActions({ ctx, extra = {} }) {
  const [busy, setBusy] = useState(false);
  return (
    <>
      <div className="budget-actions">
        <button className="btn" onClick={() => ctx.openTx(null, { type: 'expense', ...extra })}><i className="fa-solid fa-minus" /> Расход</button>
        <button className="btn" onClick={() => ctx.openTx(null, { type: 'income', ...extra })}><i className="fa-solid fa-plus" /> Доход</button>
        {!extra.projectId && <button className="btn" onClick={() => ctx.openTx(null, { type: 'transfer' })}><i className="fa-solid fa-right-left" /> Перевод</button>}
        <ReceiptCapture ctx={ctx} extra={extra} onBusy={setBusy} />
      </div>
      {busy && <div className="hint" style={{ textAlign: 'center' }}><i className="fa-solid fa-spinner fa-spin" /> Читаю чек…</div>}
    </>
  );
}

/* ---------- Фото чека ---------- */
function ReceiptCapture({ ctx, extra, onBusy, label = 'Чек' }) {
  const camRef = useRef(null);
  const galRef = useRef(null);
  const [ask, setAsk] = useState(false);
  const [done, setDone] = useState(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    setAsk(false);
    if (!file) return;
    onBusy?.(true);
    try {
      const r = await processReceiptPhoto(file);
      const id = await addReceipt({ ...r, authorUid: ctx.me.uid });
      setDone({ id, qr: r.qr });
    } catch (err) {
      alert(err.message);
    } finally {
      onBusy?.(false);
    }
  };

  return (
    <>
      <button className="btn" onClick={() => setAsk(true)}><i className="fa-solid fa-camera" /> {label}</button>
      <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
      <input ref={galRef} type="file" accept="image/*" hidden onChange={onFile} />
      {ask && (
        <Sheet title="Чек" onClose={() => setAsk(false)}>
          <p className="hint" style={{ marginTop: 0 }}>Если на чеке виден QR-код, сумма и дата подставятся сами.</p>
          <div className="stack">
            <button className="btn btn-accent btn-block" onClick={() => camRef.current?.click()}><i className="fa-solid fa-camera" /> Сфотографировать</button>
            <button className="btn btn-block" onClick={() => galRef.current?.click()}><i className="fa-regular fa-image" /> Выбрать из галереи</button>
          </div>
        </Sheet>
      )}
      {done && (
        <Sheet title="Чек сохранён" onClose={() => setDone(null)}
          footer={<>
            <button className="btn" onClick={() => setDone(null)}>Разберу потом</button>
            <button className="btn btn-accent" onClick={() => { ctx.openTx(null, receiptInitial(done, extra)); setDone(null); }}>Разобрать сейчас</button>
          </>}>
          {done.qr
            ? <p>Нашёл QR: <b>{fmtMoney(done.qr.sum)}</b>, {fmtDate(new Date(done.qr.date))}.</p>
            : <p className="hint">QR не распознался — сумму впишешь руками. Фото сохранено.</p>}
        </Sheet>
      )}
    </>
  );
}

function receiptInitial(r, extra = {}) {
  return {
    type: r.qr?.isReturn ? 'income' : 'expense',
    category: r.qr?.isReturn ? 'Возврат' : undefined,
    amount: r.qr?.sum,
    date: r.qr?.date ? new Date(r.qr.date) : undefined,
    receiptId: r.id,
    ...extra,
  };
}

/* ---------- Обзор ---------- */
function Overview({ ctx, newReceipts }) {
  const { activeWallets, balances, txs, month, setMonth } = ctx;
  const total = activeWallets.reduce((s, w) => s + (balances[w.id] || 0), 0);
  const monthTx = txs.filter((t) => inMonth(t, month));
  const { income, expense } = totals(monthTx);
  const plannedLeft = monthTx.filter((t) => t.planned);
  const planExp = plannedLeft.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const planInc = plannedLeft.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const cats = byCategory(monthTx);
  const maxCat = cats[0]?.sum || 1;

  return (
    <div>
      <div className="card budget-hero">
        <div className="l">Всего во всех кошельках</div>
        <div className="n">{fmtMoney(total)}</div>
        {(planExp > 0 || planInc > 0) && (
          <div className="hint" style={{ margin: '4px 0 0' }}>
            После плана на месяц: <b>{fmtMoney(total + planInc - planExp)}</b>
          </div>
        )}
      </div>

      <div className="wallet-grid">
        {activeWallets.map((w) => {
          const owner = w.ownerUid ? ctx.userOf(w.ownerUid) : null;
          return (
            <button key={w.id} type="button" className="wallet" style={{ '--wc': w.color || 'var(--accent)' }} onClick={() => ctx.openWallet(w)}>
              <span className="wallet-name"><i className={w.icon || 'fa-solid fa-wallet'} /> {w.name}</span>
              <span className={`wallet-bal ${(balances[w.id] || 0) < 0 ? 'neg' : ''}`}>{fmtMoney(balances[w.id] || 0)}</span>
              {owner && <span className="wallet-owner"><Avatar email={owner.email} avatar={owner.avatar} /></span>}
            </button>
          );
        })}
        <button type="button" className="wallet add" onClick={() => ctx.openWallet('new')}><i className="fa-solid fa-plus" /> Кошелёк</button>
      </div>

      <QuickActions ctx={ctx} />

      {newReceipts.length > 0 && (
        <button type="button" className="banner" onClick={ctx.openReceipts}>
          <i className="fa-solid fa-receipt" /> Неразобранных чеков: <b>{newReceipts.length}</b>
          <span className="spacer" /><i className="fa-solid fa-chevron-right" />
        </button>
      )}

      <MonthNav month={month} setMonth={setMonth} />
      <div className="stats money-stats">
        <div className="stat"><div className="n pos">{fmtMoney(income)}</div><div className="l">Пришло</div></div>
        <div className="stat"><div className="n neg">{fmtMoney(expense)}</div><div className="l">Ушло</div></div>
        <div className="stat"><div className="n">{fmtMoney(planExp)}</div><div className="l">Ещё в плане</div></div>
      </div>

      {cats.length > 0 ? (
        <>
          <div className="section-title">Куда ушло</div>
          {cats.map((c) => (
            <div key={c.cat} className="cat-bar">
              <span className="cat-name"><i className={catIcon(c.cat, 'expense')} /> {c.cat}</span>
              <span className="cat-track"><span style={{ width: `${(c.sum / maxCat) * 100}%` }} /></span>
              <span className="cat-sum">{fmtMoney(c.sum)}</span>
            </div>
          ))}
        </>
      ) : <p className="empty">В этом месяце расходов пока нет.</p>}
    </div>
  );
}

/* ---------- Операции ---------- */
function groupByDay(list) {
  const g = [];
  list.forEach((t) => {
    const d = toDate(t.date) || new Date();
    const k = dayKey(d);
    const last = g[g.length - 1];
    if (last && last.k === k) last.items.push(t); else g.push({ k, d, items: [t] });
  });
  return g;
}

function dayTitle(d) {
  const now = new Date();
  const y = new Date(); y.setDate(y.getDate() - 1);
  if (isSameDay(d, now)) return 'Сегодня';
  if (isSameDay(d, y)) return 'Вчера';
  return `${fmtDate(d)}, ${fmtWeekday(d)}`;
}

function Operations({ ctx }) {
  const [wallet, setWallet] = useState(null);
  const list = ctx.txs.filter((t) => !t.planned && inMonth(t, ctx.month) && (!wallet || t.walletId === wallet || t.toWalletId === wallet));
  const groups = groupByDay(list);
  const { income, expense } = totals(list);
  return (
    <div>
      <QuickActions ctx={ctx} />
      <MonthNav month={ctx.month} setMonth={ctx.setMonth} />
      <div className="filters">
        <button className={`pill ${!wallet ? 'on' : ''}`} onClick={() => setWallet(null)}>Все</button>
        {ctx.activeWallets.map((w) => (
          <button key={w.id} className={`pill ${wallet === w.id ? 'on' : ''}`} onClick={() => setWallet(w.id)}>{w.name}</button>
        ))}
      </div>
      <div className="row hint" style={{ margin: '0 0 8px' }}>
        <span>Пришло <Money value={income} type="income" /></span>
        <span style={{ textAlign: 'right' }}>Ушло <Money value={expense} type="expense" /></span>
      </div>
      {groups.length === 0 && <p className="empty">Операций нет.</p>}
      {groups.map((g) => (
        <div key={g.k}>
          <div className="section-title">{dayTitle(g.d)}</div>
          <div className="tx-list">{g.items.map((t) => <TxRow key={t.id} tx={t} ctx={ctx} />)}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------- План ---------- */
function Plan({ ctx }) {
  const now = new Date();
  const planned = ctx.txs.filter((t) => t.planned);
  const overdue = planned.filter((t) => toDate(t.date) < new Date(now.getFullYear(), now.getMonth(), now.getDate()));
  const inThisMonth = planned.filter((t) => inMonth(t, ctx.month) && !overdue.includes(t)).sort((a, b) => toDate(a.date) - toDate(b.date));
  const exp = inThisMonth.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const inc = inThisMonth.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);

  const row = (t) => (
    <div key={t.id} className="plan-row">
      <TxRow tx={t} ctx={ctx} showDate />
      <button className="btn btn-sm btn-accent" onClick={() => commitPlanned(t)} title="Провести сегодняшним числом">
        <i className="fa-solid fa-check" /> Провести
      </button>
    </div>
  );

  return (
    <div>
      <div className="budget-actions">
        <button className="btn btn-accent" onClick={() => ctx.openTx(null, { type: 'expense', planned: true })}><i className="fa-solid fa-calendar-plus" /> Запланировать расход</button>
        <button className="btn" onClick={() => ctx.openTx(null, { type: 'income', planned: true })}><i className="fa-solid fa-plus" /> Ожидаемый доход</button>
      </div>
      {overdue.length > 0 && <><div className="section-title bad">Срок прошёл · провести или перенести</div>{overdue.map(row)}</>}
      <MonthNav month={ctx.month} setMonth={ctx.setMonth} />
      <div className="row hint" style={{ margin: '0 0 8px' }}>
        <span>Ждём <Money value={inc} type="income" /></span>
        <span style={{ textAlign: 'right' }}>Потратим <Money value={exp} type="expense" /></span>
      </div>
      {inThisMonth.length === 0 ? <p className="empty">На этот месяц ничего не запланировано.</p> : inThisMonth.map(row)}
    </div>
  );
}

/* ---------- Проекты ---------- */
function projectTotals(txs, id) {
  return totals(txs.filter((t) => t.projectId === id));
}

function Projects({ ctx }) {
  const [archived, setArchived] = useState(false);
  const list = ctx.projects.filter((p) => !!p.archived === archived);
  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-accent" onClick={() => ctx.openProject('new')}><i className="fa-solid fa-plus" /> Новый проект</button>
        <button className="btn btn-ghost" style={{ flex: 'none' }} onClick={() => setArchived((v) => !v)}>{archived ? 'Активные' : 'Архив'}</button>
      </div>
      {list.length === 0 && <p className="empty">{archived ? 'Архив пуст.' : 'Заведи проект — ремонт, отпуск, подарок — и считай, сколько пришло и куда ушло.'}</p>}
      {list.map((p) => {
        const t = projectTotals(ctx.txs, p.id);
        const bal = t.income - t.expense;
        const pct = p.target ? Math.min(100, (t.expense / p.target) * 100) : null;
        return (
          <button key={p.id} type="button" className="task project-card" style={{ borderLeftColor: p.color || 'var(--accent)' }} onClick={() => ctx.openProject(p)}>
            <div className="task-top"><h3>{p.name}</h3><Money value={bal} type={bal < 0 ? 'expense' : 'income'} /></div>
            {p.note && <p className="desc">{p.note}</p>}
            <div className="task-meta">
              <span>Пришло <Money value={t.income} type="income" /></span>
              <span>Ушло <Money value={t.expense} type="expense" /></span>
              {p.target ? <span>Бюджет {fmtMoney(p.target)}</span> : null}
            </div>
            {pct != null && <div className="progress" style={{ marginTop: 10 }}><span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--bad)' : undefined }} /></div>}
          </button>
        );
      })}
    </div>
  );
}

function ProjectSheet({ ctx, project, onClose }) {
  const [edit, setEdit] = useState(!project);
  const [name, setName] = useState(project?.name || '');
  const [note, setNote] = useState(project?.note || '');
  const [target, setTarget] = useState(project?.target ? String(project.target) : '');
  const [color, setColor] = useState(project?.color || '#d99873');

  const save = () => {
    const t = parseMoney(target);
    saveProject(project?.id, { name: name.trim() || 'Проект', note: note.trim(), target: Number.isFinite(t) && t > 0 ? t : null, color })
      .catch((e) => alert(e.message));
    if (!project) onClose(); else setEdit(false);
  };

  if (edit) {
    return (
      <Sheet title={project ? 'Проект' : 'Новый проект'} onClose={onClose}
        footer={<><button className="btn" onClick={() => (project ? setEdit(false) : onClose())}>Отмена</button><button className="btn btn-accent" onClick={save}>Сохранить</button></>}>
        <div className="field"><label>Название</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Ремонт кухни" /></div>
        <div className="field"><label>Описание</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} /></div>
        <div className="field"><label>Бюджет проекта (необязательно)</label><input className="input" inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="0 ₽" /></div>
        <div className="field">
          <label>Цвет</label>
          <label className="swatch custom on" style={{ background: color }}><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        </div>
        {project && (
          <div className="row">
            <button className="btn" onClick={() => { saveProject(project.id, { archived: !project.archived }); onClose(); }}>{project.archived ? 'Вернуть из архива' : 'В архив'}</button>
            <button className="btn btn-ghost" style={{ color: 'var(--bad)' }} onClick={() => {
              const n = ctx.txs.filter((t) => t.projectId === project.id).length;
              if (confirm(n ? `Удалить проект? ${n} операций останутся, но без проекта.` : 'Удалить проект?')) { deleteProject(project.id); onClose(); }
            }}>Удалить</button>
          </div>
        )}
      </Sheet>
    );
  }

  const list = ctx.txs.filter((t) => t.projectId === project.id);
  const t = totals(list);
  const cats = byCategory(list);
  const planned = list.filter((x) => x.planned).reduce((s, x) => s + (x.type === 'expense' ? x.amount : 0), 0);

  return (
    <Sheet title={project.name} onClose={onClose}>
      {project.note && <p className="hint" style={{ marginTop: 0 }}>{project.note}</p>}
      <div className="stats money-stats">
        <div className="stat"><div className="n pos">{fmtMoney(t.income)}</div><div className="l">Пришло</div></div>
        <div className="stat"><div className="n neg">{fmtMoney(t.expense)}</div><div className="l">Ушло</div></div>
        <div className="stat"><div className="n">{fmtMoney(t.income - t.expense)}</div><div className="l">Остаток</div></div>
      </div>
      {project.target ? <p className="hint">Бюджет {fmtMoney(project.target)} · осталось {fmtMoney(project.target - t.expense)}{planned ? ` · ещё в плане ${fmtMoney(planned)}` : ''}</p> : null}
      <QuickActions ctx={ctx} extra={{ projectId: project.id }} />
      <button className="btn btn-sm btn-ghost" onClick={() => ctx.openTx(null, { type: 'expense', planned: true, projectId: project.id })}>
        <i className="fa-solid fa-calendar-plus" /> Запланировать расход
      </button>
      {cats.length > 0 && (
        <>
          <div className="section-title">На что</div>
          {cats.map((c) => (
            <div key={c.cat} className="cat-bar">
              <span className="cat-name"><i className={catIcon(c.cat, 'expense')} /> {c.cat}</span>
              <span className="cat-track"><span style={{ width: `${(c.sum / cats[0].sum) * 100}%` }} /></span>
              <span className="cat-sum">{fmtMoney(c.sum)}</span>
            </div>
          ))}
        </>
      )}
      <div className="section-title">Операции</div>
      {list.length === 0 ? <p className="hint">Пока нет.</p> : <div className="tx-list">{list.map((x) => <TxRow key={x.id} tx={x} ctx={ctx} showDate />)}</div>}
      <button className="btn btn-ghost btn-block" style={{ marginTop: 16 }} onClick={() => setEdit(true)}><i className="fa-solid fa-pen" /> Изменить проект</button>
    </Sheet>
  );
}

/* ---------- Кошелёк ---------- */
function WalletSheet({ ctx, wallet, onClose }) {
  const [name, setName] = useState(wallet?.name || '');
  const [icon, setIcon] = useState(wallet?.icon || WALLET_ICONS[0]);
  const [color, setColor] = useState(wallet?.color || '#6aa0d8');
  const current = wallet ? ctx.balances[wallet.id] || 0 : 0;
  const [bal, setBal] = useState(String(current));
  const ops = wallet ? ctx.txs.filter((t) => !t.planned && (t.walletId === wallet.id || t.toWalletId === wallet.id)).slice(0, 15) : [];

  const save = () => {
    const desired = parseMoney(bal);
    const data = { name: name.trim() || 'Кошелёк', icon, color };
    // «Остаток» правим через начальный баланс: initial = желаемое − движение
    if (Number.isFinite(desired)) data.initial = Math.round(((wallet?.initial || 0) + desired - current) * 100) / 100;
    if (!wallet) data.order = ctx.wallets.length;
    saveWallet(wallet?.id, data).catch((e) => alert(e.message));
    onClose();
  };

  return (
    <Sheet title={wallet ? wallet.name : 'Новый кошелёк'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-accent" onClick={save}>Сохранить</button></>}>
      <div className="field"><label>Название</label><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field">
        <label>Сейчас в кошельке</label>
        <input className="input money-input" inputMode="decimal" value={bal} onChange={(e) => setBal(e.target.value)} />
        <div className="hint">Если не сходится с реальностью — впиши фактический остаток.</div>
      </div>
      <div className="field">
        <label>Значок и цвет</label>
        <div className="swatches" style={{ marginTop: 0 }}>
          {WALLET_ICONS.map((ic) => (
            <button key={ic} type="button" className={`icon-pick ${icon === ic ? 'on' : ''}`} onClick={() => setIcon(ic)} aria-label={ic}><i className={ic} /></button>
          ))}
          <label className="swatch custom on" style={{ background: color }}><input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
        </div>
      </div>
      {wallet && (
        <>
          <div className="section-title">Последние операции</div>
          {ops.length ? <div className="tx-list">{ops.map((t) => <TxRow key={t.id} tx={t} ctx={ctx} showDate />)}</div> : <p className="hint">Пока нет.</p>}
          <button className="btn btn-ghost btn-block" style={{ marginTop: 14, color: 'var(--text-dim)' }}
            onClick={() => { if (confirm('Спрятать кошелёк? Операции сохранятся.')) { saveWallet(wallet.id, { archived: true }); onClose(); } }}>
            Спрятать кошелёк
          </button>
        </>
      )}
    </Sheet>
  );
}

/* ---------- Операция ---------- */
function TxSheet({ ctx, tx, initial = {}, onClose }) {
  const src = tx || initial;
  const [type, setType] = useState(src.type || 'expense');
  const [amount, setAmount] = useState(src.amount != null ? String(src.amount) : '');
  const [walletId, setWalletId] = useState(tx ? tx.walletId : (src.walletId !== undefined ? src.walletId : (ctx.activeWallets.find((w) => w.id === 'card') || ctx.activeWallets[0])?.id || null));
  const [toWalletId, setToWalletId] = useState(src.toWalletId || ctx.activeWallets.find((w) => w.id === 'savings')?.id || null);
  const [category, setCategory] = useState(src.category || '');
  const [note, setNote] = useState(src.note || '');
  const [date, setDate] = useState(dayKey(src.date ? (toDate(src.date) || new Date(src.date)) : new Date()));
  const [planned, setPlanned] = useState(!!src.planned);
  const [projectId, setProjectId] = useState(src.projectId || null);
  const [receiptId, setReceiptId] = useState(src.receiptId || null);
  const [items, setItems] = useState(() => (src.items || []).map((x) => ({ ...x, amountStr: String(x.amount) })));
  const [customCat, setCustomCat] = useState(false);
  const [viewer, setViewer] = useState(null);

  const cats = type === 'income' ? INCOME_CATS : EXPENSE_CATS;
  const usedCats = useMemo(() => {
    const s = new Set();
    ctx.txs.forEach((t) => { if (t.type === type) { s.add(t.category); (t.items || []).forEach((i) => s.add(i.category)); } });
    cats.forEach((c) => s.delete(c.id));
    s.delete('Перевод'); s.delete(undefined); s.delete('');
    return [...s];
  }, [ctx.txs, type, cats]);

  const sum = parseMoney(amount);
  const itemsSum = items.reduce((s, x) => s + (parseMoney(x.amountStr) || 0), 0);
  const receipt = ctx.receipts.find((r) => r.id === receiptId);
  const canSave = Number.isFinite(sum) && sum > 0 && (type !== 'transfer' || (walletId && toWalletId && walletId !== toWalletId));

  const save = () => {
    if (!canSave) return;
    const [y, m, d] = date.split('-').map(Number);
    const orig = tx && toDate(tx.date);
    const when = orig && dayKey(orig) === date ? orig : new Date(y, m - 1, d, 12, 0, 0);
    saveTx(tx?.id, {
      type, amount: sum, walletId, toWalletId, category: category || cats[cats.length - 1].id, note: note.trim(),
      date: when, planned, projectId, receiptId, prevReceiptId: tx?.receiptId,
      items: type === 'expense' ? items.map((x) => ({ id: x.id, title: x.title.trim(), amount: parseMoney(x.amountStr) || 0, category: x.category || category })) : [],
    }, ctx.me.uid).catch((e) => alert('Не сохранилось: ' + e.message));
    onClose();
  };

  const openReceipt = async (id) => {
    setViewer('loading');
    try { setViewer(await loadReceiptImage(id)); } catch (e) { alert(e.message); setViewer(null); }
  };

  const newReceipts = ctx.receipts.filter((r) => r.status !== 'parsed' && r.id !== receiptId);

  return (
    <Sheet title={tx ? TYPE_LABEL[type] : planned ? 'В план' : TYPE_LABEL[type]} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-accent" disabled={!canSave} onClick={save}>{tx ? 'Сохранить' : 'Добавить'}</button></>}>
      <Seg value={type} onChange={(t) => { setType(t); setCategory(''); }} className="mb"
        options={[['expense', 'Расход'], ['income', 'Доход'], ['transfer', 'Перевод']]} />

      <div className="field">
        <label>Сумма</label>
        <input className="input money-input" inputMode="decimal" value={amount} placeholder="0 ₽" autoFocus={!tx && amount === ''}
          onChange={(e) => setAmount(e.target.value)} />
      </div>

      <div className="field">
        <label>{type === 'transfer' ? 'Откуда' : type === 'income' ? 'Куда пришло' : 'Откуда'}</label>
        <div className="chips">
          {ctx.activeWallets.map((w) => (
            <button key={w.id} type="button" className={`chip pick ${walletId === w.id ? 'on' : ''}`} onClick={() => setWalletId(w.id)}>
              <i className={w.icon} /> {w.name}
            </button>
          ))}
          {type !== 'transfer' && (
            <button type="button" className={`chip pick ${!walletId ? 'on' : ''}`} onClick={() => setWalletId(null)} title="Не влияет на остатки кошельков">вне кошельков</button>
          )}
        </div>
      </div>

      {type === 'transfer' && (
        <div className="field">
          <label>Куда</label>
          <div className="chips">
            {ctx.activeWallets.filter((w) => w.id !== walletId).map((w) => (
              <button key={w.id} type="button" className={`chip pick ${toWalletId === w.id ? 'on' : ''}`} onClick={() => setToWalletId(w.id)}>
                <i className={w.icon} /> {w.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {type !== 'transfer' && (
        <div className="field">
          <label>Категория</label>
          <div className="chips">
            {cats.map((c) => (
              <button key={c.id} type="button" className={`chip pick ${category === c.id ? 'on' : ''}`} onClick={() => setCategory(c.id)}>
                <i className={c.icon} /> {c.id}
              </button>
            ))}
            {usedCats.map((c) => (
              <button key={c} type="button" className={`chip pick ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
            <button type="button" className="chip pick" onClick={() => setCustomCat(true)}>+ своя</button>
          </div>
          {customCat && (
            <input className="input" style={{ marginTop: 8 }} autoFocus placeholder="Название категории"
              onKeyDown={(e) => { if (e.key === 'Enter') { setCategory(e.target.value.trim()); setCustomCat(false); } }}
              onBlur={(e) => { if (e.target.value.trim()) setCategory(e.target.value.trim()); setCustomCat(false); }} />
          )}
        </div>
      )}

      <div className="field"><label>Комментарий</label><input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder={type === 'expense' ? 'Что купили' : ''} /></div>

      <div className="row">
        <div className="field">
          <label>{planned ? 'Когда' : 'Дата'}</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value || dayKey())} />
        </div>
        <div className="field">
          <label>Проект</label>
          <select className="input" value={projectId || ''} onChange={(e) => setProjectId(e.target.value || null)}>
            <option value="">—</option>
            {ctx.projects.filter((p) => !p.archived || p.id === projectId).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 14 }}>
        <Switch on={planned} onChange={setPlanned} label="Запланировано (ещё не потрачено)" />
      </div>

      {type === 'expense' && (
        <div className="field">
          <label>Чек</label>
          {receipt ? (
            <div className="receipt-attached">
              <button type="button" className="receipt-thumb" onClick={() => openReceipt(receipt.id)}>
                {receipt.thumb ? <img src={receipt.thumb} alt="Чек" /> : <i className="fa-solid fa-receipt" />}
              </button>
              <div style={{ flex: 1 }}>
                {receipt.qr ? <div>QR: {fmtMoney(receipt.qr.sum)}</div> : <div className="hint" style={{ margin: 0 }}>без QR</div>}
                <button type="button" className="link-btn" onClick={() => setReceiptId(null)}>Открепить</button>
              </div>
            </div>
          ) : newReceipts.length > 0 ? (
            <div className="chips">
              {newReceipts.slice(0, 6).map((r) => (
                <button key={r.id} type="button" className="receipt-thumb small" title="Прикрепить" onClick={() => {
                  setReceiptId(r.id);
                  if (r.qr && !amount) { setAmount(String(r.qr.sum)); setDate(dayKey(new Date(r.qr.date))); }
                }}>
                  {r.thumb ? <img src={r.thumb} alt="" /> : <i className="fa-solid fa-receipt" />}
                </button>
              ))}
              <span className="hint" style={{ margin: 0 }}>← прикрепить неразобранный</span>
            </div>
          ) : <div className="hint" style={{ margin: 0 }}>Сфотографировать чек можно кнопкой «Чек» в бюджете.</div>}
        </div>
      )}

      {type === 'expense' && (
        <div className="field">
          <label>Разбить по позициям</label>
          {items.map((it) => (
            <div key={it.id} className="split-row">
              <input className="input" value={it.title} placeholder="Позиция" onChange={(e) => setItems((p) => p.map((x) => (x.id === it.id ? { ...x, title: e.target.value } : x)))} />
              <input className="input" inputMode="decimal" value={it.amountStr} placeholder="₽" onChange={(e) => setItems((p) => p.map((x) => (x.id === it.id ? { ...x, amountStr: e.target.value } : x)))} />
              <select className="input" value={it.category || ''} onChange={(e) => setItems((p) => p.map((x) => (x.id === it.id ? { ...x, category: e.target.value } : x)))}>
                <option value="">{category || 'категория'}</option>
                {[...EXPENSE_CATS.map((c) => c.id), ...usedCats].map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <button type="button" className="btn btn-ghost icon-btn" aria-label="Убрать" onClick={() => setItems((p) => p.filter((x) => x.id !== it.id))}>×</button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => setItems((p) => [...p, { id: uid6(), title: '', amountStr: '', category: '' }])}>+ позиция</button>
          {items.length > 0 && Number.isFinite(sum) && (
            <div className={`hint ${itemsSum > sum + 0.004 ? 'bad' : ''}`}>
              Разнесено {fmtMoney(itemsSum)} из {fmtMoney(sum)}
              {sum - itemsSum > 0.004 ? ` · остаток ${fmtMoney(sum - itemsSum)} → «${category || 'Другое'}»` : ''}
            </div>
          )}
        </div>
      )}

      {tx && (
        <div className="row" style={{ marginTop: 6 }}>
          {tx.planned && <button className="btn" onClick={() => { commitPlanned(tx); onClose(); }}><i className="fa-solid fa-check" /> Провести сегодня</button>}
          <button className="btn btn-ghost" style={{ color: 'var(--bad)' }} onClick={() => { if (confirm('Удалить операцию?')) { deleteTx(tx); onClose(); } }}>Удалить</button>
        </div>
      )}
      {tx && <p className="hint">Добавил(а): {ctx.userOf(tx.authorUid)?.name}</p>}

      {viewer && <ReceiptViewer src={viewer} onClose={() => setViewer(null)} />}
    </Sheet>
  );
}

function ReceiptViewer({ src, onClose }) {
  return (
    <div className="viewer" onClick={onClose}>
      {src === 'loading' ? <i className="fa-solid fa-spinner fa-spin" /> : <img src={src} alt="Чек" />}
      <button className="close" aria-label="Закрыть">×</button>
    </div>
  );
}

/* ---------- Неразобранные чеки ---------- */
function ReceiptsSheet({ ctx, onClose }) {
  const [all, setAll] = useState(false);
  const [viewer, setViewer] = useState(null);
  const list = ctx.receipts.filter((r) => all || r.status !== 'parsed');
  const open = async (id) => {
    setViewer('loading');
    try { setViewer(await loadReceiptImage(id)); } catch (e) { alert(e.message); setViewer(null); }
  };
  return (
    <Sheet title="Чеки" onClose={onClose}>
      <div className="filters">
        <button className={`pill ${!all ? 'on' : ''}`} onClick={() => setAll(false)}>Неразобранные</button>
        <button className={`pill ${all ? 'on' : ''}`} onClick={() => setAll(true)}>Все</button>
      </div>
      {list.length === 0 && <p className="empty">Всё разобрано ✨</p>}
      {list.map((r) => {
        const who = ctx.userOf(r.authorUid);
        const d = toDate(r.createdAt);
        return (
          <div key={r.id} className="receipt-item">
            <button type="button" className="receipt-thumb" onClick={() => open(r.id)}>
              {r.thumb ? <img src={r.thumb} alt="Чек" /> : <i className="fa-solid fa-receipt" />}
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{r.qr ? <b>{fmtMoney(r.qr.sum)}</b> : <span className="hint" style={{ margin: 0 }}>сумма не распознана</span>}</div>
              <div className="hint" style={{ margin: 0 }}>
                {r.qr ? fmtDate(new Date(r.qr.date)) : d ? fmtDate(d) : 'сейчас'} · <Avatar email={who.email} avatar={who.avatar} /> {who.name}
              </div>
              <div className="row" style={{ marginTop: 6 }}>
                {r.status === 'parsed'
                  ? <button className="btn btn-sm" onClick={() => { const tx = ctx.txs.find((t) => t.id === r.txId); if (tx) { ctx.openTx(tx); onClose(); } }}>Операция</button>
                  : <button className="btn btn-sm btn-accent" onClick={() => { ctx.openTx(null, receiptInitial(r)); onClose(); }}>Разобрать</button>}
                <button className="btn btn-sm btn-ghost" style={{ flex: 'none', color: 'var(--bad)' }}
                  onClick={() => { if (confirm('Удалить фото чека?')) deleteReceipt(r); }}>Удалить</button>
              </div>
            </div>
          </div>
        );
      })}
      {viewer && <ReceiptViewer src={viewer} onClose={() => setViewer(null)} />}
    </Sheet>
  );
}

