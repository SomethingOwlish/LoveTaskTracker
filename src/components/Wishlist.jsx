import { useEffect, useMemo, useState } from 'react';
import { reportError, toast } from '../lib/toast';
import { Sheet, Seg, loadPref, savePref } from './Sheet';
import { Avatar } from './Avatar';
import { ALLOWED_EMAILS, USERS } from '../config';
import { subscribeWishes, subscribeGotWishes, saveWish, markWishGot, unmarkWishGot, deleteWish } from '../lib/wishlist';
import { WISH_TYPES, WISH_TYPE, filterWishes, wishTotal, urlLabel } from '../lib/wishMath';
import { CURRENCIES, fmtCur } from '../lib/currency';
import { parseMoney, toDate, fmtDate } from '../lib/util';

const PRICE_CURS = ['RSD', 'EUR', 'USD', 'RUB'];

/* ---------- Вишлист (вкладка бюджета) ---------- */

export function Wishlist({ me, base, fx }) {
  const [wishes, setWishes] = useState(null);
  const [got, setGot] = useState(null);
  const [archived, setArchived] = useState(false);
  const [owner, setOwnerState] = useState(() => loadPref('wishOwner', 'all'));
  const [type, setTypeState] = useState(() => loadPref('wishType', 'all'));
  const setOwner = (v) => { setOwnerState(v); savePref('wishOwner', v); };
  const setType = (v) => { setTypeState(v); savePref('wishType', v); };
  const [sheet, setSheet] = useState(null); // 'new' | wish

  useEffect(() => subscribeWishes(setWishes), []);
  // архив добытого читаем, только когда его открыли
  useEffect(() => (archived ? subscribeGotWishes(setGot) : undefined), [archived]);

  const source = (archived ? got : wishes) || [];
  const byOwner = useMemo(() => filterWishes(source, { owner }), [source, owner]);
  const list = useMemo(() => filterWishes(byOwner, { type }), [byOwner, type]);
  const total = useMemo(() => wishTotal(list, base, fx), [list, base, fx]);
  const loading = (archived ? got : wishes) === null;

  const countOf = (t) => byOwner.filter((w) => w.type === t).length;

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <button className="btn btn-accent" onClick={() => setSheet('new')}><i className="fa-solid fa-plus" /> Хотелка</button>
        <button className="btn btn-ghost" style={{ flex: 'none' }} onClick={() => setArchived((v) => !v)}>
          {archived ? 'Хотелки' : <><i className="fa-solid fa-box-archive" /> Добытое</>}
        </button>
      </div>

      <Seg value={owner} onChange={setOwner} className="seg-sm mb"
        options={[['all', 'Общий'], ...ALLOWED_EMAILS.map((e) => [e, e === me.uid ? `${USERS[e].name} (я)` : USERS[e].name])]} />

      <div className="chips wish-types">
        <button type="button" className={`chip pick ${type === 'all' ? 'on' : ''}`} onClick={() => setType('all')}>
          Все <span className="seg-count">{byOwner.length}</span>
        </button>
        {WISH_TYPES.map((t) => (
          <button key={t.id} type="button" className={`chip pick ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)}>
            <i className={t.icon} style={type === t.id ? undefined : { color: t.color }} /> {t.label} <span className="seg-count">{countOf(t.id)}</span>
          </button>
        ))}
      </div>

      {!archived && list.length > 0 && (
        <p className="hint wish-total">
          {list.length} {plural(list.length, 'хотелка', 'хотелки', 'хотелок')}
          {total.priced > 0 && <> · ≈ <b>{fmtCur(total.sum, base)}</b></>}
          {total.unpriced > 0 && total.priced > 0 && <> · ещё {total.unpriced} без цены</>}
        </p>
      )}

      {loading && <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>}
      {!loading && list.length === 0 && (
        <p className="empty">{archived ? 'Пока ничего не добыто.' : 'Пусто. Добавь, чего хочется — со ссылкой и ценой или просто так.'}</p>
      )}

      {list.map((w) => <WishCard key={w.id} w={w} me={me} archived={archived} onOpen={() => setSheet(w)} />)}

      {sheet && <WishSheet me={me} base={base} wish={sheet === 'new' ? null : sheet}
        defaults={{ ownerUid: owner === 'all' ? me.uid : owner, type: type === 'all' ? 'need' : type }}
        onClose={() => setSheet(null)} />}
    </div>
  );
}

function WishCard({ w, me, archived, onOpen }) {
  const t = WISH_TYPE[w.type] || WISH_TYPES[0];
  const gotAt = toDate(w.gotAt);
  const got = (e) => {
    e.stopPropagation();
    markWishGot(w.id, me.uid).then(() => toast(`«${w.title}» — добыто!`)).catch(reportError);
  };
  const back = (e) => {
    e.stopPropagation();
    unmarkWishGot(w.id).catch(reportError);
  };
  return (
    <div className={`task wish-card ${archived ? 'got' : ''}`} style={{ borderLeftColor: t.color }} onClick={onOpen} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(); }}>
      <div className="wish-head">
        {w.image && <img className="wish-img" src={w.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
        <div className="wish-body">
          <div className="task-top">
            <h3>{w.title}</h3>
            {w.price ? <span className="money">{fmtCur(w.price, w.currency)}</span> : null}
          </div>
          {w.note && <p className="desc">{w.note}</p>}
        </div>
      </div>
      <div className="wish-foot">
        <Avatar email={w.ownerUid} />
        <span className="chip" style={{ borderColor: t.color, color: t.color }}><i className={t.icon} /> {t.label}</span>
        {w.url && (
          <a className="chip as-btn" href={w.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
            <i className="fa-solid fa-arrow-up-right-from-square" /> {urlLabel(w.url)}
          </a>
        )}
        <span style={{ flex: 1 }} />
        {archived
          ? <>{gotAt && <span className="dim wish-date">{fmtDate(gotAt)}</span>}<button className="btn btn-sm btn-ghost" onClick={back}>Вернуть</button></>
          : <button className="btn btn-sm btn-accent" onClick={got}><i className="fa-solid fa-check" /> Добыто</button>}
      </div>
    </div>
  );
}

function WishSheet({ me, base, wish, defaults, onClose }) {
  const [title, setTitle] = useState(wish?.title || '');
  const [url, setUrl] = useState(wish?.url || '');
  const [price, setPrice] = useState(wish?.price ? String(wish.price) : '');
  const [currency, setCurrency] = useState(wish?.currency || base);
  const [type, setType] = useState(wish?.type || defaults.type);
  const [ownerUid, setOwnerUid] = useState(wish?.ownerUid || defaults.ownerUid);
  const [note, setNote] = useState(wish?.note || '');
  const curs = PRICE_CURS.includes(currency) ? PRICE_CURS : [...PRICE_CURS, currency];

  const save = () => {
    if (!title.trim()) return;
    const p = parseMoney(price);
    saveWish(wish?.id, { title, url, price: Number.isFinite(p) ? p : null, currency, type, ownerUid, note, image: wish?.image, source: wish?.source }, me.uid).catch(reportError);
    onClose();
  };
  const remove = () => {
    if (!confirm('Удалить хотелку насовсем?')) return;
    deleteWish(wish.id).catch(reportError);
    onClose();
  };

  return (
    <Sheet title={wish ? 'Хотелка' : 'Новая хотелка'} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-accent" disabled={!title.trim()} onClick={save}>Сохранить</button></>}>
      <div className="field"><label>Что хочется</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Плед с совами" autoFocus={!wish} /></div>
      <div className="field">
        <label>Чьё</label>
        <div className="chips">
          {ALLOWED_EMAILS.map((e) => (
            <button key={e} type="button" className={`chip pick ${ownerUid === e ? 'on' : ''}`} onClick={() => setOwnerUid(e)}>
              <Avatar email={e} /> {USERS[e].name}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Тип</label>
        <div className="chips">
          {WISH_TYPES.map((t) => (
            <button key={t.id} type="button" className={`chip pick ${type === t.id ? 'on' : ''}`} onClick={() => setType(t.id)}>
              <i className={t.icon} /> {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="field"><label>Ссылка (необязательно)</label><input className="input" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
      <div className="field">
        <label>Цена (необязательно)</label>
        <input className="input" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder={`0 ${CURRENCIES[currency]?.symbol || currency}`} />
        <div className="chips" style={{ marginTop: 6 }}>
          {curs.map((c) => (
            <button key={c} type="button" className={`chip pick ${currency === c ? 'on' : ''}`} onClick={() => setCurrency(c)}>{CURRENCIES[c]?.symbol || c} {c}</button>
          ))}
        </div>
      </div>
      <div className="field"><label>Заметка</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="размер, цвет, где видели…" /></div>
      {wish && (
        <div className="row">
          {wish.status === 'got'
            ? <button className="btn" onClick={() => { unmarkWishGot(wish.id).catch(reportError); onClose(); }}>Вернуть в хотелки</button>
            : <button className="btn" onClick={() => { markWishGot(wish.id, me.uid).catch(reportError); onClose(); }}><i className="fa-solid fa-check" /> Добыто</button>}
          <button className="btn btn-ghost" style={{ color: 'var(--bad)' }} onClick={remove}>Удалить</button>
        </div>
      )}
    </Sheet>
  );
}

function plural(n, one, few, many) {
  const m10 = n % 10; const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
