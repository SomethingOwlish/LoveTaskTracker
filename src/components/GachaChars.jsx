// Гача: каталог персонажей — у кого кто есть, звёздность, описание, советы по отрядам.
import { useEffect, useMemo, useState } from 'react';
import { Sheet, Seg, loadPref, savePref } from './Sheet';
import { toast, reportError } from '../lib/toast';
import { GAMES } from '../lib/gacha';
import { emptyChar } from '../lib/gachaPlan';
import {
  loadCatalog, mergeCatalog, filterCatalog, ELEMENTS, WEAPONS, elementOf, guideLink, customChar, nameHints,
} from '../lib/gachaCatalog';

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export function useCatalog(game, roster) {
  const [base, setBase] = useState(null);
  useEffect(() => {
    let live = true;
    setBase(null);
    loadCatalog(game).then((l) => { if (live) setBase(l); }, (e) => { reportError(e); if (live) setBase([]); });
    return () => { live = false; };
  }, [game]);
  return useMemo(() => (base ? mergeCatalog(game, base, roster?.custom, roster?.owned) : null), [game, base, roster]);
}

export function Stars({ n, top }) {
  return <span className={`gc-stars r${n >= top ? 'top' : n === top - 1 ? 'mid' : ''}`}>{'★'.repeat(n)}</span>;
}

export function CharImg({ c, game, size = 64 }) {
  const [bad, setBad] = useState(false);
  const color = elementOf(game, c.el)?.[1] || 'var(--accent)';
  if (!c.img || bad) {
    return (
      <span className="gc-img gc-img-ph" style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 30%, var(--bg-2))` }}>
        {c.name.slice(0, 2)}
      </span>
    );
  }
  return <img className="gc-img" src={c.img} alt="" loading="lazy" width={size} height={size} onError={() => setBad(true)} referrerPolicy="no-referrer" />;
}

// Поле имени с подсказками из каталога. <datalist> на телефонах почти не
// показывается, поэтому свой список под полем.
export function NameInput({ game, catalog, value, onChange, r, placeholder, className = 'input' }) {
  const G = GAMES[game];
  const [focus, setFocus] = useState(false);
  const [hi, setHi] = useState(0);
  const hints = focus ? nameHints(catalog, value, { r, top: G.top }) : [];
  const pick = (c) => { onChange(c.name); setFocus(false); };
  const onKey = (e) => {
    if (!hints.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((hi + 1) % hints.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((hi - 1 + hints.length) % hints.length); }
    else if (e.key === 'Enter') { e.preventDefault(); pick(hints[Math.min(hi, hints.length - 1)]); }
    else if (e.key === 'Escape') setFocus(false);
  };
  return (
    <div className="gc-name-in">
      <input className={className} value={value} placeholder={placeholder} autoComplete="off"
        onChange={(e) => { onChange(e.target.value); setHi(0); setFocus(true); }}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onKeyDown={onKey} />
      {hints.length > 0 && (
        <div className="gc-hints" role="listbox">
          {hints.map((c, i) => (
            <button key={c.id} type="button" role="option" aria-selected={i === hi} className={i === hi ? 'on' : ''}
              onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
              <CharImg c={c} game={game} size={28} />
              <span className="gc-hint-name">{c.name}{c.en && c.en !== c.name ? <span className="hint"> · {c.en}</span> : null}</span>
              {c.soon && <span className="gc-soon">анонс</span>}
              <Stars n={c.r} top={G.top} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CharsSection({ uid, game, mine, roster, save }) {
  const G = GAMES[game];
  const list = useCatalog(game, roster);
  const [q, setQ] = useState('');
  const [show, setShowState] = useState(() => loadPref('gachaShow', 'all'));
  const setShow = (v) => { setShowState(v); savePref('gachaShow', v); };
  const [rarity, setRarity] = useState('all');
  const [el, setEl] = useState('all');
  const [quick, setQuick] = useState(false);
  const [open, setOpen] = useState(null); // id
  const [adding, setAdding] = useState(false);

  if (!list) return <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>;

  const shown = filterCatalog(list, { q, rarity, el, show });
  const ownCount = list.filter((c) => c.own).length;
  const ownTop = list.filter((c) => c.own && c.r >= G.top).length;
  const rarities = [...new Set(list.map((c) => c.r))].sort((a, b) => b - a);

  const setOwned = (id, value) => {
    const owned = { ...(roster.owned || {}) };
    if (value == null) delete owned[id]; else owned[id] = value;
    return save({ owned });
  };
  const toggle = (c) => setOwned(c.id, c.own ? null : { cons: 0 });
  const current = open ? list.find((c) => c.id === open) : null;

  return (
    <div>
      <div className="gc-own-sum">
        <span>Есть <b>{ownCount}</b> из {list.length}</span>
        <span>{G.top}★: <b>{ownTop}</b></span>
        {mine && (
          <span className="gc-own-btns">
            <button className={`btn btn-sm ${quick ? 'btn-accent' : ''}`} onClick={() => setQuick(!quick)} title="Нажатие по карточке сразу отмечает «есть / нет»">
              <i className="fa-solid fa-check-double" /> {quick ? 'Готово' : 'Отметить'}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => setAdding(true)} aria-label="Свой персонаж" title="Добавить персонажа, которого нет в списке"><i className="fa-solid fa-plus" /></button>
          </span>
        )}
      </div>
      {quick && <p className="hint"><i className="fa-solid fa-hand-pointer" /> Нажимай на персонажей, которые у тебя есть. {G.cons} — в карточке персонажа.</p>}

      <input className="input mb" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по имени (рус. или англ.)" />
      <Seg className="seg-sm mb" value={show} onChange={setShow} options={[['all', 'Все'], ['own', 'Есть'], ['missing', 'Нет']]} />
      <div className="chips mb gc-filters">
        <button className={`chip pick ${rarity === 'all' ? 'on' : ''}`} onClick={() => setRarity('all')}>Все ★</button>
        {rarities.map((r) => <button key={r} className={`chip pick ${rarity === r ? 'on' : ''}`} onClick={() => setRarity(rarity === r ? 'all' : r)}>{r}★</button>)}
        {Object.entries(ELEMENTS[game]).filter(([k]) => list.some((c) => c.el === k)).map(([k, [label, color]]) => (
          <button key={k} className={`chip pick ${el === k ? 'on' : ''}`} onClick={() => setEl(el === k ? 'all' : k)}>
            <span className="gc-dot" style={{ background: color }} />{label}
          </button>
        ))}
      </div>

      {game === 'endfield' && (
        <p className="hint"><i className="fa-solid fa-circle-info" /> Для Endfield открытой базы нет: список сверен с вики вручную, картинки — с Prydwen. Нет кого-то — добавь кнопкой <i className="fa-solid fa-plus" />.</p>
      )}
      {!shown.length && <div className="empty">Никого не нашла</div>}

      <div className="gc-grid">
        {shown.map((c) => (
          <button key={c.id} className={`gc-cell r${c.r >= G.top ? 'top' : 'mid'} ${c.own ? 'own' : 'missing'}`}
            onClick={() => (quick && mine ? toggle(c).catch(reportError) : setOpen(c.id))}>
            <CharImg c={c} game={game} />
            {c.own && <span className="gc-cons">{G.cons[0]}{c.own.cons || 0}</span>}
            {quick && <span className={`gc-tick ${c.own ? 'on' : ''}`}><i className="fa-solid fa-check" /></span>}
            {c.soon && <span className="gc-soon gc-soon-cell">анонс</span>}
            <span className="gc-cell-name">{c.name}</span>
            <span className="gc-cell-meta">
              <Stars n={c.r} top={G.top} />
              {c.el && <span className="gc-dot" style={{ background: elementOf(game, c.el)[1] }} title={elementOf(game, c.el)[0]} />}
            </span>
          </button>
        ))}
      </div>

      {current && (
        <CharInfoSheet game={game} c={current} mine={mine} roster={roster} save={save} setOwned={setOwned} onClose={() => setOpen(null)} />
      )}
      {adding && (
        <CustomCharSheet game={game} onClose={() => setAdding(false)}
          onSave={(c) => save({ custom: [...(roster.custom || []), c] }).then(() => { setAdding(false); setOpen(c.id); }, reportError)} />
      )}
    </div>
  );
}

function CharInfoSheet({ game, c, mine, roster, save, setOwned, onClose }) {
  const G = GAMES[game];
  const [note, setNote] = useState(c.own?.note || '');
  const [editing, setEditing] = useState(false);
  const elem = elementOf(game, c.el);
  const inPlan = (roster.chars || []).some((x) => x.catalogId === c.id || x.name.toLowerCase() === c.name.toLowerCase());
  const setCons = (v) => setOwned(c.id, v === 'none' ? null : { ...(c.own || {}), cons: v }).catch(reportError);
  const saveNote = () => {
    if ((c.own?.note || '') === note) return;
    if (!c.own) return;
    setOwned(c.id, { ...c.own, note }).catch(reportError);
  };
  const toPlan = () => {
    const pc = { ...emptyChar(game, c.name), catalogId: c.id };
    save({ chars: [...(roster.chars || []), pc] }).then(() => toast(`${c.name} — в «Развитии»`), reportError);
  };
  const delCustom = () => {
    if (!confirm(`Удалить ${c.name} из списка?`)) return;
    const owned = { ...(roster.owned || {}) };
    delete owned[c.id];
    save({ custom: roster.custom.filter((x) => x.id !== c.id), owned }).then(onClose, reportError);
  };

  if (editing) {
    return (
      <CustomCharSheet game={game} initial={c} onClose={() => setEditing(false)}
        onSave={(next) => save({ custom: roster.custom.map((x) => (x.id === c.id ? { ...next, id: c.id } : x)) }).then(() => setEditing(false), reportError)} />
    );
  }

  return (
    <Sheet title={c.name} onClose={() => { saveNote(); onClose(); }}>
      <div className="gc-info-head">
        <CharImg c={c} game={game} size={96} />
        <div>
          <Stars n={c.r} top={G.top} />
          {c.en && c.en !== c.name && <div className="hint" style={{ margin: '2px 0' }}>{c.en}</div>}
          <div className="gc-tags">
            {elem && <span className="chip"><span className="gc-dot" style={{ background: elem[1] }} />{elem[0]}</span>}
            {c.w && <span className="chip">{WEAPONS[c.w] || c.w}</span>}
            {c.custom && <span className="chip">добавлен вручную</span>}
            {c.soon && <span className="chip gc-soon">анонс · версия {c.soon}</span>}
          </div>
        </div>
      </div>
      {c.d && <p className="gc-desc">{c.d}</p>}

      <div className="section-title">Как собирать</div>
      {c.guide ? (
        <div className="gc-guide">
          {c.guide.role && <p><b>Роль:</b> {c.guide.role}</p>}
          {c.guide.team && <p><b>Отряд:</b> {c.guide.team}</p>}
          {c.guide.tip && <p><b>Важно:</b> {c.guide.tip}</p>}
          {c.guide.src && <p className="hint" style={{ margin: 0 }}>Источник: <a href={c.guide.src} target="_blank" rel="noreferrer">{hostOf(c.guide.src)}</a></p>}
        </div>
      ) : <p className="hint">Подсказки пока нет — новый или редкий персонаж. Свою сборку можно записать в заметку ниже.</p>}
      <a className="link-btn" href={guideLink(game, c)} target="_blank" rel="noreferrer"><i className="fa-solid fa-magnifying-glass" /> {game === 'endfield' && !c.custom ? 'Полный гайд на Prydwen' : 'Найти свежий гайд'}</a>

      <div className="section-title">У меня</div>
      <div className="gc-cons-pick">
        <Seg className="seg-sm" value={c.own ? c.own.cons || 0 : 'none'} onChange={mine ? setCons : () => {}}
          options={[['none', 'Нет'], ...Array.from({ length: G.consMax + 1 }, (_, i) => [i, `${G.cons[0]}${i}`])]} />
      </div>
      {c.own && (
        <div className="field" style={{ marginTop: 10 }}>
          <label>Мои заметки: сборка, отряд, что прокачать</label>
          <textarea className="input" rows={3} value={note} disabled={!mine} onChange={(e) => setNote(e.target.value)} onBlur={saveNote} />
        </div>
      )}
      {mine && (
        <div className="chips" style={{ marginTop: 12 }}>
          {c.own && !inPlan && <button className="btn btn-sm" onClick={toPlan}><i className="fa-solid fa-arrow-trend-up" /> В «Развитие»</button>}
          {c.own && inPlan && <span className="hint"><i className="fa-solid fa-check" /> Уже в «Развитии»</span>}
          {c.custom && <button className="btn btn-sm" onClick={() => setEditing(true)}><i className="fa-solid fa-pen" /> Изменить</button>}
          {c.custom && <button className="btn btn-sm btn-ghost" onClick={delCustom}><i className="fa-solid fa-trash" /></button>}
        </div>
      )}
    </Sheet>
  );
}

function CustomCharSheet({ game, initial, onClose, onSave }) {
  const G = GAMES[game];
  const [f, setF] = useState(() => ({ name: initial?.name || '', r: initial?.r || G.top, el: initial?.el || '', img: initial?.img || '', d: initial?.d || '' }));
  const upd = (p) => setF((x) => ({ ...x, ...p }));
  const rarities = game === 'endfield' ? [6, 5, 4] : [5, 4];
  return (
    <Sheet title={initial ? 'Изменить персонажа' : 'Свой персонаж'} onClose={onClose}
      footer={<button className="btn btn-accent btn-block" disabled={!f.name.trim()} onClick={() => onSave(customChar(f))}>Сохранить</button>}>
      <p className="hint">Для новых персонажей, которых ещё нет в списке. Каталог обновляется вручную, так что свежие герои могут появиться с задержкой.</p>
      <div className="field"><label>Имя</label><input className="input" value={f.name} onChange={(e) => upd({ name: e.target.value })} /></div>
      <div className="field"><label>Звёздность</label>
        <Seg className="seg-sm" value={f.r} onChange={(r) => upd({ r })} options={rarities.map((r) => [r, `${r}★`])} />
      </div>
      <div className="field"><label>Стихия</label>
        <div className="chips">
          {Object.entries(ELEMENTS[game]).map(([k, [label, color]]) => (
            <button key={k} className={`chip pick ${f.el === k ? 'on' : ''}`} onClick={() => upd({ el: f.el === k ? '' : k })}>
              <span className="gc-dot" style={{ background: color }} />{label}
            </button>
          ))}
        </div>
      </div>
      <div className="field"><label>Ссылка на картинку (необязательно)</label><input className="input" value={f.img} onChange={(e) => upd({ img: e.target.value })} placeholder="https://…png" /></div>
      <div className="field"><label>Коротко о персонаже</label><textarea className="input" rows={3} value={f.d} onChange={(e) => upd({ d: e.target.value })} /></div>
    </Sheet>
  );
}
