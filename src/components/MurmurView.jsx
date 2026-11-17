import { useEffect, useMemo, useState } from 'react';
import { Avatar } from './Avatar';
import { Sheet, Seg, loadPref, savePref } from './Sheet';
import { tsMs, fmtDate, toDate } from '../lib/util';
import {
  addMurmur, updateMurmur, subscribeMurmurDone, deleteMurmur, toggleMurmurWant, rateMurmur, unwatchMurmur,
} from '../lib/db';

export const MURMUR_KINDS = {
  movie: { label: 'Фильмы', one: 'фильм', icon: 'fa-solid fa-film', done: 'Посмотрели', doneVerb: 'Посмотрели' },
  series: { label: 'Сериалы', one: 'сериал', icon: 'fa-solid fa-tv', done: 'Посмотрели', doneVerb: 'Посмотрели' },
  game: { label: 'Игры', one: 'игру', icon: 'fa-solid fa-gamepad', done: 'Прошли', doneVerb: 'Прошли' },
};

// Сколько записей ждут моей оценки (партнёр отметил просмотренным, я ещё нет).
export function murmurAwaitingMe(items, uid) {
  return items.filter((x) => x.status === 'done' && x.ratings?.[uid] == null).length;
}

export function MurmurView({ items: liveItems, me, users, userOf }) {
  const [kind, setKindState] = useState(() => loadPref('murmurKind', 'movie'));
  const setKind = (k) => { setKindState(k); savePref('murmurKind', k); };
  const [filter, setFilter] = useState('want');
  const [text, setText] = useState('');
  const [rate, setRate] = useState(null);
  const [edit, setEdit] = useState(null);
  const [pick, setPick] = useState(null);
  const partner = users.find((u) => u.uid !== me.uid);
  const K = MURMUR_KINDS[kind];

  // Живой список — «хотим» + недавно просмотренное. Весь архив просмотренного
  // читаем только когда открыли «Посмотрели» или «Весь список».
  const [archive, setArchive] = useState(null);
  const needArchive = filter === 'done' || filter === 'all';
  useEffect(() => {
    if (!needArchive) return;
    return subscribeMurmurDone(setArchive);
  }, [needArchive]);
  const items = useMemo(() => {
    if (!needArchive || !archive) return liveItems;
    const m = new Map(liveItems.map((x) => [x.id, x]));
    archive.forEach((x) => m.set(x.id, x));
    return [...m.values()];
  }, [liveItems, archive, needArchive]);

  const ofKind = useMemo(() => items.filter((x) => x.kind === kind), [items, kind]);
  const counts = useMemo(() => {
    const c = {};
    items.forEach((x) => { if (x.status !== 'done') c[x.kind] = (c[x.kind] || 0) + 1; });
    return c;
  }, [items]);

  const list = useMemo(() => {
    let r = ofKind;
    if (filter === 'want') {
      r = r.filter((x) => x.status !== 'done');
      // сначала то, что хотят оба
      r = [...r].sort((a, b) => (b.wantedBy?.length || 0) - (a.wantedBy?.length || 0) || tsMs(b.createdAt) - tsMs(a.createdAt));
    } else if (filter === 'done') {
      r = r.filter((x) => x.status === 'done');
      r = [...r].sort((a, b) => tsMs(b.doneAt) - tsMs(a.doneAt));
    }
    return r;
  }, [ofKind, filter]);

  const awaiting = ofKind.filter((x) => x.status === 'done' && x.ratings?.[me.uid] == null).length;

  const add = () => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    lines.forEach((title) => addMurmur({ kind, title, uid: me.uid }).catch((e) => alert(e.message)));
    setText('');
    if (filter === 'done') setFilter('want');
  };

  const random = () => {
    const pool = ofKind.filter((x) => x.status !== 'done');
    if (!pool.length) return;
    const both = pool.filter((x) => (x.wantedBy || []).length > 1);
    const src = both.length ? both : pool;
    setPick(src[Math.floor(Math.random() * src.length)]);
  };

  return (
    <div>
      <div className="seg mb">
        {Object.entries(MURMUR_KINDS).map(([k, v]) => (
          <button key={k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            <i className={v.icon} /> {v.label}{counts[k] ? <span className="seg-count">{counts[k]}</span> : null}
          </button>
        ))}
      </div>

      <div className="quick-add">
        <span className="qa-who static"><i className={K.icon} /></span>
        <textarea className="qa-input" rows={1} value={text} enterKeyHint="done"
          placeholder={`Хочу ${K.one}…`}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } }} />
        <button className="qa-send" onClick={add} disabled={!text.trim()} aria-label="Добавить"><i className="fa-solid fa-plus" /></button>
      </div>

      <div className="filters">
        <button className={`pill ${filter === 'want' ? 'on' : ''}`} onClick={() => setFilter('want')}>Хотим</button>
        <button className={`pill ${filter === 'done' ? 'on' : ''}`} onClick={() => setFilter('done')}>
          {K.done}{awaiting ? ` · ждут оценки ${awaiting}` : ''}
        </button>
        <button className={`pill ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Весь список · {ofKind.length}</button>
        <span style={{ flex: 1 }} />
        <button className="pill" onClick={random} title="Случайный выбор"><i className="fa-solid fa-dice" /> Что выбрать?</button>
      </div>

      {list.length === 0 && <div className="empty">Пусто. Впиши название в строку сверху.</div>}

      {list.map((x) => (
        <MurmurCard key={x.id} item={x} me={me} partner={partner} userOf={userOf} K={K}
          onRate={() => setRate(x)} onEdit={() => setEdit(x)} />
      ))}

      {rate && <RateSheet item={rate} me={me} K={K} onClose={() => setRate(null)} />}
      {edit && <EditSheet item={edit} onClose={() => setEdit(null)} />}
      {pick && (
        <Sheet title="Выпало" onClose={() => setPick(null)}
          footer={<><button className="btn" onClick={random}><i className="fa-solid fa-dice" /> Ещё раз</button><button className="btn btn-accent" onClick={() => setPick(null)}>Берём!</button></>}>
          <div className="pick-result"><i className={K.icon} /><div>{pick.title}</div>{pick.note && <p className="hint">{pick.note}</p>}</div>
        </Sheet>
      )}
    </div>
  );
}

function Score({ value }) {
  if (value == null) return <span className="score none">—</span>;
  return <span className="score">{value}</span>;
}

function MurmurCard({ item, me, partner, userOf, K, onRate, onEdit }) {
  const done = item.status === 'done';
  const wanted = item.wantedBy || [];
  const iWant = wanted.includes(me.uid);
  const myScore = item.ratings?.[me.uid];
  const theirScore = partner ? item.ratings?.[partner.uid] : null;
  const scores = Object.values(item.ratings || {}).filter((v) => v != null);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const doneAt = toDate(item.doneAt);

  return (
    <div className={`task murmur ${done ? 'is-done' : ''}`} onClick={onEdit}>
      <div className="task-top">
        <h3>{item.title}</h3>
        {done && avg != null && <span className="score big">{avg.toFixed(avg % 1 ? 1 : 0)}</span>}
      </div>
      {item.note && <p className="desc">{item.note}</p>}

      {!done ? (
        <div className="task-foot">
          <span className="who" style={{ gap: 4 }}>
            {wanted.map((u) => { const x = userOf(u); return <Avatar key={u} email={x.email} avatar={x.avatar} />; })}
            <span className="hint" style={{ margin: 0 }}>{wanted.length > 1 ? 'хотят оба' : 'хочет'}</span>
          </span>
          <span className="spacer" />
          <button className={`btn btn-sm ${iWant ? '' : 'btn-ghost'}`} onClick={(e) => { e.stopPropagation(); toggleMurmurWant(item, me.uid); }}>
            {iWant ? <><i className="fa-solid fa-heart" /> Хочу</> : <><i className="fa-regular fa-heart" /> Я тоже</>}
          </button>
          <button className="btn btn-sm btn-accent" onClick={(e) => { e.stopPropagation(); onRate(); }}>
            <i className="fa-solid fa-check" /> {K.doneVerb}
          </button>
        </div>
      ) : (
        <div className="task-foot">
          <span className="who"><Avatar email={me.email} avatar={me.avatar} /> <Score value={myScore} /></span>
          {partner && <span className="who"><Avatar email={partner.email} avatar={partner.avatar} /> <Score value={theirScore} /></span>}
          {doneAt && <span className="hint" style={{ margin: 0 }}>{fmtDate(doneAt)}</span>}
          <span className="spacer" />
          {myScore == null
            ? <button className="btn btn-sm btn-accent" onClick={(e) => { e.stopPropagation(); onRate(); }}>Оценить</button>
            : <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onRate(); }}>Изменить</button>}
        </div>
      )}
      {done && Object.entries(item.reviews || {}).filter(([, v]) => v).map(([u, v]) => {
        const x = userOf(u);
        return <div key={u} className="murmur-review"><Avatar email={x.email} avatar={x.avatar} /> «{v}»</div>;
      })}
    </div>
  );
}

function RateSheet({ item, me, K, onClose }) {
  const [score, setScore] = useState(item.ratings?.[me.uid] ?? null);
  const [review, setReview] = useState(item.reviews?.[me.uid] || '');
  const first = item.status !== 'done';
  const save = () => {
    if (score == null) return;
    rateMurmur(item, me.uid, score, review.trim()).catch((e) => alert(e.message));
    onClose();
  };
  return (
    <Sheet title={item.title} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button>
        <button className="btn btn-accent" disabled={score == null} onClick={save}>{first ? `${K.doneVerb} ✓` : 'Сохранить'}</button></>}>
      <div className="section-title" style={{ marginTop: 0 }}>Моя оценка</div>
      <div className="score-grid">
        {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
          <button key={n} type="button" className={`score-btn ${score === n ? 'on' : ''}`} onClick={() => setScore(n)}>{n}</button>
        ))}
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label>Пара слов (необязательно)</label>
        <input className="input" value={review} onChange={(e) => setReview(e.target.value)} placeholder="Как тебе?" />
      </div>
      {first && <p className="hint">Партнёру останется поставить свою оценку.</p>}
    </Sheet>
  );
}

function EditSheet({ item, onClose }) {
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note || '');
  const [link, setLink] = useState(item.link || '');
  const [kind, setKind] = useState(item.kind);
  const save = () => {
    updateMurmur(item.id, { title: title.trim() || item.title, note: note.trim(), link: link.trim() || null, kind }).catch((e) => alert(e.message));
    onClose();
  };
  return (
    <Sheet title="Запись" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-accent" onClick={save}>Сохранить</button></>}>
      <div className="field"><label>Название</label><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
      <div className="field">
        <label>Раздел</label>
        <Seg value={kind} onChange={setKind} options={Object.entries(MURMUR_KINDS).map(([k, v]) => [k, v.label])} />
      </div>
      <div className="field"><label>Заметка</label><textarea className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Кто посоветовал, где смотреть…" /></div>
      <div className="field"><label>Ссылка</label><input className="input" value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" inputMode="url" /></div>
      {item.link && <p><a href={item.link} target="_blank" rel="noreferrer">Открыть ссылку <i className="fa-solid fa-arrow-up-right-from-square" /></a></p>}
      <div className="row" style={{ marginTop: 10 }}>
        {item.status === 'done' && (
          <button className="btn" onClick={() => { if (confirm('Вернуть в «Хотим»? Оценки сбросятся.')) { unwatchMurmur(item); onClose(); } }}>Вернуть в «Хотим»</button>
        )}
        <button className="btn btn-ghost" style={{ color: 'var(--bad)' }}
          onClick={() => { if (confirm('Удалить из списка?')) { deleteMurmur(item.id); onClose(); } }}>Удалить</button>
      </div>
    </Sheet>
  );
}
