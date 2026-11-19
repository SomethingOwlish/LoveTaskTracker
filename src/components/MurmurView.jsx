import { useEffect, useMemo, useState } from 'react';
import { reportError } from '../lib/toast';
import { searchMedia, mediaFields, fetchSeasons, isTmdbTv } from '../lib/media';
import {
  hasSeasons, seriesProgress, progressLabel, watchedIn, toggleEpisode, toggleSeason, watchedUpTo, fmtEp,
} from '../lib/seasons';
import { Avatar } from './Avatar';
import { Sheet, Seg, loadPref, savePref } from './Sheet';
import { tsMs, fmtDate, toDate } from '../lib/util';
import {
  addMurmur, updateMurmur, subscribeMurmurDone, deleteMurmur, toggleMurmurWant, rateMurmur, unwatchMurmur,
  setMurmurSeasonWatched, setMurmurWatched, againMurmur, startMurmur,
} from '../lib/db';
import { murmurTitle, wantOrder } from '../lib/murmurUtil';
import { toast } from '../lib/toast';

// Подтянуть сезоны сериала из TMDB и сохранить в запись
async function pullSeasons(id, extId) {
  const data = await fetchSeasons(extId);
  if (data.seasons.length) await updateMurmur(id, data);
  return data;
}

export const MURMUR_KINDS = {
  movie: { label: 'Фильмы', one: 'фильм', icon: 'fa-solid fa-film', done: 'Посмотрели', doneVerb: 'Посмотрели' },
  series: { label: 'Сериалы', one: 'сериал', icon: 'fa-solid fa-tv', done: 'Посмотрели', doneVerb: 'Посмотрели' },
  game: { label: 'Игры', one: 'игру', icon: 'fa-solid fa-gamepad', done: 'Прошли', doneVerb: 'Прошли' },
};

export { murmurAwaitingMe } from '../lib/murmurUtil';

export function MurmurView({ items: liveItems, me, users, userOf }) {
  const [kind, setKindState] = useState(() => loadPref('murmurKind', 'movie'));
  const setKind = (k) => { setKindState(k); savePref('murmurKind', k); };
  const [filter, setFilter] = useState('want');
  const [text, setText] = useState('');
  const [rate, setRate] = useState(null);
  const [edit, setEdit] = useState(null);
  const [pick, setPick] = useState(null);
  const [epsId, setEpsId] = useState(null); // открытая сетка серий (id — чтобы видеть живые отметки)
  const partner = users.find((u) => u.uid !== me.uid);
  const K = MURMUR_KINDS[kind];

  // Живой список — «хотим» + недавно просмотренное. Весь архив просмотренного
  // читаем только когда открыли «Посмотрели» или «Весь список».
  const [archive, setArchive] = useState(null);
  const needArchive = filter === 'done' || filter === 'all' || filter === 'archive';
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
      // сначала начатые игры, потом то, что хотят оба
      r = [...r].sort((a, b) => wantOrder(a, b, tsMs));
    } else if (filter === 'done' || filter === 'archive') {
      r = r.filter((x) => x.status === 'done');
      r = [...r].sort((a, b) => tsMs(b.doneAt) - tsMs(a.doneAt));
    }
    return r;
  }, [ofKind, filter]);

  const awaiting = ofKind.filter((x) => x.status === 'done' && x.ratings?.[me.uid] == null).length;

  const add = () => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    lines.forEach((title) => addMurmur({ kind, title, uid: me.uid }).catch((e) => reportError(e)));
    setText('');
    setFound(null);
    if (filter === 'done') setFilter('want');
  };

  // Поиск по базе фильмов/игр: пока пишешь название, ниже появляются варианты
  // с постерами. Выбрала — запись сохраняется с постером, годом и описанием.
  const [found, setFound] = useState(null); // null | 'loading' | [] | Error
  useEffect(() => {
    const q = text.trim();
    if (q.length < 2 || q.includes('\n')) { setFound(null); return; }
    setFound('loading');
    let alive = true;
    const t = setTimeout(() => {
      searchMedia(kind, q).then((r) => alive && setFound(r)).catch((e) => alive && setFound(e));
    }, 450);
    return () => { alive = false; clearTimeout(t); };
  }, [text, kind]);
  const addFound = (m) => {
    addMurmur({ kind, title: m.title, uid: me.uid, media: mediaFields(m) })
      .then((ref) => { if (ref && kind === 'series' && isTmdbTv(m.id)) return pullSeasons(ref.id, m.id).catch(() => {}); }) // не вышло — подтянем из карточки
      .catch((e) => reportError(e));
    setText(''); setFound(null);
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
        <button className="qa-send" onClick={add} disabled={!text.trim()} aria-label="Добавить как есть"><i className="fa-solid fa-plus" /></button>
      </div>
      {found && <MediaResults found={found} onPick={addFound} hint="Выбери вариант или жми «+», чтобы добавить просто названием" />}

      <div className="filters">
        <button className={`pill ${filter === 'want' ? 'on' : ''}`} onClick={() => setFilter('want')}>Хотим</button>
        <button className={`pill ${filter === 'done' ? 'on' : ''}`} onClick={() => setFilter('done')}>
          {K.done}{awaiting ? ` · ждут оценки ${awaiting}` : ''}
        </button>
        <button className={`pill ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>Весь список · {ofKind.length}</button>
        <button className={`pill ${filter === 'archive' ? 'on' : ''}`} onClick={() => setFilter('archive')}><i className="fa-solid fa-box-archive" /> Архив</button>
        <span style={{ flex: 1 }} />
        <button className="pill" onClick={random} title="Случайный выбор"><i className="fa-solid fa-dice" /> Что выбрать?</button>
      </div>

      {list.length === 0 && <div className="empty">{filter === 'archive' ? 'Архив пуст.' : 'Пусто. Впиши название в строку сверху.'}</div>}

      {filter === 'archive' && list.length > 0 && <ArchiveList list={list} me={me} onOpen={setEdit} />}

      {filter !== 'archive' && list.map((x) => (
        <MurmurCard key={x.id} item={x} me={me} partner={partner} userOf={userOf} K={K}
          onRate={() => setRate(x)} onEdit={() => setEdit(x)} onEpisodes={() => setEpsId(x.id)} />
      ))}

      {rate && <RateSheet item={rate} me={me} K={K} onClose={() => setRate(null)} />}
      {edit && <EditSheet item={edit} me={me} onClose={() => setEdit(null)} />}
      {epsId && items.find((x) => x.id === epsId) && (
        <EpisodesSheet item={items.find((x) => x.id === epsId)} K={K} onClose={() => setEpsId(null)}
          onRate={() => { setRate(items.find((x) => x.id === epsId)); setEpsId(null); }} />
      )}
      {pick && (
        <Sheet title="Выпало" onClose={() => setPick(null)}
          footer={<><button className="btn" onClick={random}><i className="fa-solid fa-dice" /> Ещё раз</button><button className="btn btn-accent" onClick={() => setPick(null)}>Берём!</button></>}>
          <div className="pick-result"><i className={K.icon} /><div>{murmurTitle(pick)}</div>{pick.note && <p className="hint">{pick.note}</p>}</div>
        </Sheet>
      )}
    </div>
  );
}

function Score({ value }) {
  if (value == null) return <span className="score none">—</span>;
  return <span className="score">{value}</span>;
}

function MurmurCard({ item, me, partner, userOf, K, onRate, onEdit, onEpisodes }) {
  const isSeries = item.kind === 'series';
  const prog = isSeries ? seriesProgress(item) : null;
  const done = item.status === 'done';
  const wanted = item.wantedBy || [];
  const iWant = wanted.includes(me.uid);
  const myScore = item.ratings?.[me.uid];
  const theirScore = partner ? item.ratings?.[partner.uid] : null;
  const scores = Object.values(item.ratings || {}).filter((v) => v != null);
  const avg = scores.length ? (scores.reduce((a, b) => a + b, 0) / scores.length) : null;
  const doneAt = toDate(item.doneAt);
  const isGame = item.kind === 'game';
  const startedAt = toDate(item.startedAt);

  return (
    <div className={`task murmur ${done ? 'is-done' : ''}`} onClick={onEdit}>
      <div className="murmur-head">
        {item.poster && <img className="murmur-poster" src={item.poster} alt="" loading="lazy" />}
        <div className="murmur-info">
          <div className="task-top">
            <h3>{item.again && <span className="murmur-again">Заново: </span>}{item.title}{item.year ? <span className="murmur-year"> · {item.year}</span> : null}</h3>
            {done && avg != null && <span className="score big">{avg.toFixed(avg % 1 ? 1 : 0)}</span>}
          </div>
          {item.overview && <p className="desc murmur-overview">{item.overview}</p>}
          {item.note && <p className="desc">{item.note}</p>}
          {prog && <SeriesProgress prog={prog} />}
          {isGame && !done && item.startedAt && (
            <span className="chip murmur-started"><i className="fa-solid fa-play" /> в процессе{startedAt ? ` · с ${fmtDate(startedAt)}` : ''}</span>
          )}
        </div>
      </div>

      {!done ? (
        <div className="task-foot">
          <span className="who" style={{ gap: 4 }}>
            {wanted.map((u) => { const x = userOf(u); return <Avatar key={u} email={x.email} avatar={x.avatar} />; })}
            <span className="hint" style={{ margin: 0 }}>{wanted.length > 1 ? 'хотят оба' : 'хочет'}</span>
          </span>
          <span className="spacer" />
          {isSeries && <EpisodesButton onClick={onEpisodes} />}
          {isGame && !item.startedAt && (
            <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); startMurmur(item.id, me.uid).catch(reportError); }}>
              <i className="fa-solid fa-play" /> Начали
            </button>
          )}
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
          {isSeries && <EpisodesButton onClick={onEpisodes} />}
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
    rateMurmur(item, me.uid, score, review.trim()).catch((e) => reportError(e));
    onClose();
  };
  return (
    <Sheet title={murmurTitle(item)} onClose={onClose}
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

// Список найденного (общий для добавления и для «найти постер»)
function MediaResults({ found, onPick, hint }) {
  if (found === 'loading') return <p className="hint"><i className="fa-solid fa-spinner fa-spin" /> Ищу…</p>;
  if (found instanceof Error) return <p className="hint">{found.message}</p>;
  if (!found.length) return <p className="hint">Ничего не нашлось.</p>;
  return (
    <div className="media-results">
      {hint && <p className="hint" style={{ margin: '0 0 6px' }}>{hint}</p>}
      {found.map((m) => (
        <button key={m.id} type="button" className="media-item" onClick={() => onPick(m)}>
          {m.poster ? <img src={m.poster} alt="" loading="lazy" /> : <span className="media-noposter"><i className="fa-solid fa-image" /></span>}
          <span className="media-text">
            <b>{m.title}</b>{m.year ? ` · ${m.year}` : ''}
            {m.original && m.original !== m.title && <small> ({m.original})</small>}
            {m.overview && <span className="media-ov">{m.overview}</span>}
          </span>
        </button>
      ))}
    </div>
  );
}

function EditSheet({ item, me, onClose }) {
  const [found, setFound] = useState(null);
  const findPoster = () => {
    setFound('loading');
    searchMedia(item.kind, item.title).then(setFound).catch(setFound);
  };
  const pick = (m) => {
    updateMurmur(item.id, mediaFields({ ...m, title: item.title })).catch((e) => reportError(e));
    if (item.kind === 'series' && isTmdbTv(m.id) && m.id !== item.extId) pullSeasons(item.id, m.id).catch(() => {});
    onClose();
  };
  const [title, setTitle] = useState(item.title);
  const [note, setNote] = useState(item.note || '');
  const [link, setLink] = useState(item.link || '');
  const [kind, setKind] = useState(item.kind);
  const save = () => {
    updateMurmur(item.id, { title: title.trim() || item.title, note: note.trim(), link: link.trim() || null, kind }).catch((e) => reportError(e));
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
      <button type="button" className="btn btn-sm" onClick={findPoster}><i className="fa-solid fa-image" /> {item.poster ? 'Сменить постер' : 'Найти постер и описание'}</button>
      {found && <MediaResults found={found} onPick={pick} />}
      {item.kind === 'game' && item.status !== 'done' && (
        <button type="button" className="btn btn-sm" style={{ marginLeft: 6 }}
          onClick={() => { startMurmur(item.id, item.startedAt ? null : me.uid).catch(reportError); onClose(); }}>
          <i className={`fa-solid ${item.startedAt ? 'fa-pause' : 'fa-play'}`} /> {item.startedAt ? 'Ещё не начали' : 'Начали'}
        </button>
      )}
      {item.status === 'done' && (
        <button type="button" className="btn btn-accent btn-block" style={{ marginTop: 10 }} onClick={() => { repeat(item, me); onClose(); }}>
          <i className="fa-solid fa-rotate-right" /> Повторить
        </button>
      )}
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

// «Повторить» — новая карточка «Заново …» в «Хотим»; эта остаётся в архиве с оценками.
function repeat(item, me) {
  againMurmur(item, me.uid).then(() => toast(`«${item.title}» — заново в «Хотим»`)).catch(reportError);
}

// Архив: компактный список всего просмотренного/пройденного, с поиском.
function ArchiveList({ list, me, onOpen }) {
  const [q, setQ] = useState('');
  const shown = q.trim() ? list.filter((x) => x.title.toLowerCase().includes(q.trim().toLowerCase())) : list;
  let lastMonth = '';
  return (
    <div className="murmur-archive">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Поиск по архиву · ${list.length}`} />
      {shown.map((x) => {
        const d = toDate(x.doneAt);
        const month = d ? `${d.toLocaleDateString('ru-RU', { month: 'long' })} ${d.getFullYear()}` : 'без даты';
        const head = month !== lastMonth ? month : null;
        lastMonth = month;
        const scores = Object.values(x.ratings || {}).filter((v) => v != null);
        const avg = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
        return (
          <div key={x.id}>
            {head && <div className="section-title">{head}</div>}
            <div className="archive-row" role="button" tabIndex={0} onClick={() => onOpen(x)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(x); }}>
              <span className="archive-title">{murmurTitle(x)}{x.year ? <span className="murmur-year"> · {x.year}</span> : null}</span>
              {d && <span className="hint archive-date">{fmtDate(d)}</span>}
              {avg != null ? <span className="score">{avg.toFixed(avg % 1 ? 1 : 0)}</span> : <span className="score none">—</span>}
              <button type="button" className="btn btn-sm btn-ghost" title="Повторить" aria-label="Повторить"
                onClick={(e) => { e.stopPropagation(); repeat(x, me); }}><i className="fa-solid fa-rotate-right" /></button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Полоска прогресса сериала на карточке: «S2E5 · 37%»
function SeriesProgress({ prog }) {
  const label = progressLabel(prog);
  return (
    <div className="series-progress" title={`Посмотрели ${prog.seen} из ${prog.total}`}>
      <div className="series-bar"><span style={{ width: `${prog.pct}%` }} /></div>
      <span className="series-label">{label || `${prog.total} серий`}</span>
    </div>
  );
}

function EpisodesButton({ onClick }) {
  return (
    <button className="btn btn-sm btn-ghost" onClick={(e) => { e.stopPropagation(); onClick(); }}>
      <i className="fa-solid fa-list-ol" /> Серии
    </button>
  );
}

// Сетка сезонов → серий. Отметки общие на двоих; оценка и отзыв — на весь сериал.
function EpisodesSheet({ item, K, onClose, onRate }) {
  const prog = seriesProgress(item);
  const [upTo, setUpTo] = useState(false); // режим «отметить всё до этой серии»
  const [busy, setBusy] = useState(false);
  const [found, setFound] = useState(null);
  const [err, setErr] = useState(null);
  const canPull = isTmdbTv(item.extId);

  const pull = (extId = item.extId) => {
    setBusy(true); setErr(null);
    pullSeasons(item.id, extId)
      .then((d) => { if (!d.seasons.length) setErr('В базе нет сезонов для этого сериала.'); })
      .catch((e) => setErr(e.message))
      .finally(() => setBusy(false));
  };
  // у старой записи нет id в TMDB — сначала найдём сериал по названию
  const search = () => {
    setFound('loading');
    searchMedia('series', item.title).then(setFound).catch(setFound);
  };
  const pickFound = (m) => {
    setFound(null);
    updateMurmur(item.id, mediaFields({ ...m, title: item.title, link: m.link || item.link })).catch((e) => reportError(e));
    pull(m.id);
  };

  const tap = (n, e) => {
    const p = upTo ? setMurmurWatched(item, watchedUpTo(item, n, e)) : setMurmurSeasonWatched(item, n, toggleEpisode(watchedIn(item, n), e));
    p.catch((x) => reportError(x));
  };
  const markNext = () => {
    const { s, e } = prog.next;
    setMurmurSeasonWatched(item, s, toggleEpisode(watchedIn(item, s), e)).catch((x) => reportError(x));
  };

  const footer = prog?.complete && item.status !== 'done'
    ? <><button className="btn" onClick={onClose}>Закрыть</button><button className="btn btn-accent" onClick={onRate}><i className="fa-solid fa-star" /> Оценить</button></>
    : prog?.next
      ? <><button className="btn" onClick={onClose}>Закрыть</button><button className="btn btn-accent" onClick={markNext}><i className="fa-solid fa-check" /> {fmtEp(prog.next.s, prog.next.e)}</button></>
      : null;

  return (
    <Sheet title={item.title} onClose={onClose} footer={footer}>
      {!hasSeasons(item) ? (
        <div>
          <p className="hint">У этой записи ещё нет сезонов и серий.</p>
          {canPull
            ? <button className="btn btn-accent" disabled={busy} onClick={() => pull()}><i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-download'}`} /> Подтянуть сезоны</button>
            : <button className="btn btn-accent" onClick={search}><i className="fa-solid fa-magnifying-glass" /> Подтянуть сезоны</button>}
          {found && <div style={{ marginTop: 12 }}><MediaResults found={found} onPick={pickFound} hint="Какой это сериал?" /></div>}
          {err && <p className="hint">{err}</p>}
        </div>
      ) : (
        <>
          <div className="eps-summary">
            <div className="series-bar big"><span style={{ width: `${prog.pct}%` }} /></div>
            <span>Посмотрели {prog.seen} из {prog.total} · {prog.pct}%{item.tvStatus === 'ongoing' ? ' · сериал выходит' : ''}</span>
          </div>
          <div className="filters" style={{ marginBottom: 6 }}>
            <button type="button" className={`pill ${upTo ? '' : 'on'}`} onClick={() => setUpTo(false)}>По одной</button>
            <button type="button" className={`pill ${upTo ? 'on' : ''}`} onClick={() => setUpTo(true)}>Всё до серии</button>
          </div>
          {item.seasons.map((s) => {
            const w = new Set(watchedIn(item, s.n));
            const aired = Number.isInteger(s.aired) ? s.aired : s.eps;
            const seen = [...w].filter((e) => e <= aired).length;
            return (
              <div key={s.n} className="eps-season">
                <div className="eps-season-head">
                  <b>Сезон {s.n}</b>
                  <span className="hint" style={{ margin: 0 }}>{seen}/{aired}{aired < s.eps ? ` · выйдет ещё ${s.eps - aired}` : ''}</span>
                  <span className="spacer" />
                  {aired > 0 && (
                    <button type="button" className="btn btn-sm btn-ghost"
                      onClick={() => setMurmurSeasonWatched(item, s.n, toggleSeason(item, s.n)).catch((x) => reportError(x))}>
                      {seen >= aired ? 'Снять' : 'Весь сезон'}
                    </button>
                  )}
                </div>
                <div className="eps-grid">
                  {Array.from({ length: s.eps }, (_, i) => i + 1).map((e) => (
                    <button key={e} type="button" disabled={e > aired}
                      className={`eps-btn ${w.has(e) ? 'on' : ''} ${prog.next?.s === s.n && prog.next?.e === e ? 'next' : ''}`}
                      title={fmtEp(s.n, e)} onClick={() => tap(s.n, e)}>{e}</button>
                  ))}
                </div>
              </div>
            );
          })}
          {canPull && (
            <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => pull()} style={{ marginTop: 6 }}>
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-rotate'}`} /> Обновить сезоны
            </button>
          )}
          {err && <p className="hint">{err}</p>}
        </>
      )}
    </Sheet>
  );
}
