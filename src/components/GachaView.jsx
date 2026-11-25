import { useEffect, useMemo, useState } from 'react';
import { Sheet, Seg, loadPref, savePref } from './Sheet';
import { Avatar } from './Avatar';
import { toast, toastError, reportError } from '../lib/toast';
import {
  GAMES, GAME_KEYS, parseImportLink, classifyTops, avgPity, pityTone, manualTop, manualFiller, fmtTime, cmpPull, poolOf,
  sessionRecords, sessionPreview,
} from '../lib/gacha';
import { applyDrops } from '../lib/gachaCatalog';
import { CharsSection, useCatalog, NameInput } from './GachaChars';
import { STATS, GEAR_LEVELS, emptyChar, charReadiness, teamReport, matsLeft, grade } from '../lib/gachaPlan';
import {
  subscribeGachaSummary, importGacha, ExpiredLinkError, setGachaOverride, saveGachaMeta, addManualPull, removePull,
  loadGachaLog, editTopPull, subscribeRoster, saveRoster, addSession, removeSession,
} from '../lib/gachaDb';

const SECTIONS = [['chars', 'Герои'], ['pulls', 'Крутки'], ['plan', 'Развитие'], ['teams', 'Отряды']];
const CONS_ONE = { genshin: 'созвездие', hsr: 'эйдолон', endfield: 'потенциал' };
const RES = { won: ['выиграли 50/50', 'good'], lost: ['проиграли', 'bad'], guar: ['гарант', 'ok'] };

// Ссылку храним только на этом устройстве: она даёт доступ к истории круток.
const linkKey = (uid, game) => `gachaLink:${uid}:${game}`;
function loadLink(uid, game) {
  try { return JSON.parse(localStorage.getItem(linkKey(uid, game))); } catch { return null; }
}
function saveLink(uid, game, params) {
  try {
    if (params) localStorage.setItem(linkKey(uid, game), JSON.stringify({ params, at: Date.now() }));
    else localStorage.removeItem(linkKey(uid, game));
  } catch { /* приватный режим */ }
}

export function GachaView({ me, users }) {
  const [game, setGameState] = useState(() => loadPref('gachaGame', 'genshin'));
  const setGame = (g) => { setGameState(g); savePref('gachaGame', g); };
  const [section, setSectionState] = useState(() => loadPref('gachaSection', 'chars'));
  const setSection = (s) => { setSectionState(s); savePref('gachaSection', s); };
  const [whoUid, setWho] = useState(me.uid);
  const mine = whoUid === me.uid;

  return (
    <div>
      <Seg className="mb" value={game} onChange={setGame}
        options={GAME_KEYS.map((k) => [k, <><i className={GAMES[k].icon} /> {GAMES[k].short}</>])} />
      <div className="row mb" style={{ alignItems: 'center' }}>
        <Seg className="seg-sm" value={section} onChange={setSection} options={SECTIONS} />
        <div className="seg seg-sm" style={{ flex: 'none' }}>
          {users.map((u) => (
            <button key={u.uid} className={whoUid === u.uid ? 'on' : ''} onClick={() => setWho(u.uid)} aria-label={u.name} title={u.name}>
              <Avatar email={u.email} avatar={u.avatar} />
            </button>
          ))}
        </div>
      </div>
      {!mine && <p className="hint"><i className="fa-regular fa-eye" /> Смотришь данные: {users.find((u) => u.uid === whoUid)?.name}. Менять может только хозяин.</p>}

      <GameBody key={whoUid + game} uid={whoUid} game={game} mine={mine} section={section} />
    </div>
  );
}

// Ростер (кто есть, план, отряды) нужен почти всем разделам — подписываемся один раз.
function GameBody({ uid, game, mine, section }) {
  const [roster, setRoster] = useState(null);
  useEffect(() => subscribeRoster(uid, game, setRoster), [uid, game]);
  if (!roster) return <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>;
  const save = (patch) => saveRoster(uid, game, { ...roster, ...patch });
  if (section === 'chars') return <CharsSection uid={uid} game={game} mine={mine} roster={roster} save={save} />;
  if (section === 'pulls') return <PullsSection uid={uid} game={game} mine={mine} roster={roster} save={save} />;
  return <RosterSection uid={uid} game={game} mine={mine} section={section} roster={roster} save={save} />;
}

/* =================== Крутки =================== */

function PullsSection({ uid, game, mine, roster, save }) {
  const G = GAMES[game];
  const [sum, setSum] = useState(null);
  useEffect(() => subscribeGachaSummary(uid, game, setSum), [uid, game]);
  const catalog = useCatalog(game, roster);
  const [sheet, setSheet] = useState(null); // 'import' | 'manual' | 'std' | {top} | {history}
  const [busy, setBusy] = useState(null); // текст прогресса импорта
  const saved = mine ? loadLink(uid, game) : null;

  const runImport = async (params) => {
    setBusy('Начинаю…');
    try {
      const r = await importGacha(uid, game, params, ({ label, found }) => setBusy(`${label}: новых ${found}`));
      saveLink(uid, game, params);
      toast(r.added ? `Загружено новых: ${r.added}` : 'Новых круток нет — всё уже здесь');
      if (r.skipped.length) toast(`Пропущено (API не ответил): ${r.skipped.join(', ')}`);
      setSheet(null);
    } catch (e) {
      if (e instanceof ExpiredLinkError) { saveLink(uid, game, null); setSheet('import'); }
      toastError(e.message || String(e));
    } finally {
      setBusy(null);
    }
  };

  if (sum === null) return <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>;

  const pools = Object.keys(G.pools).filter((k) => sum.pools?.[k]?.total);
  const overrides = sum.overrides || {};
  // стандартные — по-английски; добавляем русские имена из каталога, чтобы
  // ручные записи «Химеко» тоже считались проигрышем 50/50
  const stdOf = (kind) => {
    const names = sum.std?.[kind] ?? G.std[kind];
    if (kind !== 'char' || !catalog) return names;
    const en = new Set(names.map((n) => n.toLowerCase()));
    return [...names, ...catalog.filter((c) => en.has(String(c.en).toLowerCase())).map((c) => c.name)];
  };

  return (
    <div>
      {mine && (
        <button className="btn btn-accent btn-block mb" onClick={() => setSheet('session')}>
          <i className="fa-solid fa-dice" /> Записать крутки
        </button>
      )}

      <RecentCard uid={uid} game={game} mine={mine} sum={sum} />

      {mine && (
        <div className="card gc-actions">
          {busy ? (
            <div className="hint"><i className="fa-solid fa-spinner fa-spin" /> Загружаю историю… {busy}</div>
          ) : (
            <div className="chips">
              {G.query.length > 0 && saved && <button className="btn btn-sm btn-accent" onClick={() => runImport(saved.params)}><i className="fa-solid fa-rotate" /> Обновить</button>}
              <button className={`btn btn-sm ${saved ? '' : 'btn-accent'}`} onClick={() => setSheet('import')}><i className="fa-solid fa-link" /> {game === 'endfield' ? (saved ? 'Новый токен' : 'Импорт по токену') : (saved ? 'Новая ссылка' : 'Импорт по ссылке')}</button>
              <button className="btn btn-sm" onClick={() => setSheet('manual')} title="Топ-дроп на крутке №N или пачка круток без него"><i className="fa-solid fa-pen" /> Точная запись</button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSheet('std')} title="Стандартные персонажи для 50/50"><i className="fa-solid fa-sliders" /></button>
            </div>
          )}
          {!busy && (
            <p className="hint" style={{ marginBottom: 0 }}>
              {sum.lastImport ? `Последний импорт: ${fmtTime(new Date(sum.lastImport)).slice(0, 16)}. ` : ''}
              {saved ? `Ссылка сохранена на этом устройстве ${ageText(saved.at)} — живёт около суток.` : ''}
            </p>
          )}
        </div>
      )}

      {game === 'endfield' && !stdOf('char').length && pools.includes('char') && (
        <p className="hint"><i className="fa-solid fa-circle-info" /> Чтобы считать 50/50, впиши стандартных 6★ (кнопка <i className="fa-solid fa-sliders" />): без списка все 6★ считаются выигрышем.</p>
      )}

      {!pools.length && (
        <div className="empty">
          <p>Пока пусто.</p>
          {mine ? <p>Загрузи историю по ссылке из игры или вноси крутки вручную.</p> : <p>Здесь ещё ничего не загружали.</p>}
          <SourceNote game={game} />
        </div>
      )}

      {pools.map((k) => {
        const P = G.pools[k];
        const s = sum.pools[k];
        const fifty = P.fifty ? classifyTops(s.tops || [], { stdNames: stdOf(P.fifty), guarantee: P.guarantee, overrides }) : null;
        const list = fifty ? fifty.list : (s.tops || []);
        const avg = avgPity(s.tops || []);
        return (
          <div className="card gc-pool" key={k}>
            <div className="gc-pool-head">
              <h3>{P.label}</h3>
              <span className="hint">{s.total} {G.roll === 'молитва' ? 'молитв' : 'круток'}</span>
            </div>
            <PityBar pity={s.pity} pool={P} top={G.top} />
            <div className="gc-facts">
              <span>{G.top - 1}★ через: <b>{Math.max(1, 10 - s.pity4)}</b></span>
              {avg != null && <span>Средний pity: <b>{avg.toFixed(1)}</b></span>}
              {fifty && fifty.rate != null && <span>50/50: <b>{fifty.won} из {fifty.won + fifty.lost}</b> ({Math.round(fifty.rate * 100)}%)</span>}
              {fifty && P.guarantee && <span className={fifty.guaranteed ? 'gc-guar' : ''}>{fifty.guaranteed ? 'Следующий — гарант' : 'Следующий — 50/50'}</span>}
              {s.banner && P.spark && <span>«{s.banner.name}»: <b>{Math.min(s.banner.pulls, P.spark)}/{P.spark}</b> до разового гаранта</span>}
            </div>
            {list.length > 0 && (
              <div className="gc-tops">
                {[...list].reverse().map((t) => (
                  <button key={t.i} className="gc-top" onClick={() => setSheet({ top: t, pool: k })}>
                    <span className={`gc-pity ${pityTone(t.p, P)}`}>{t.p}</span>
                    <span className="gc-top-name">{t.n}{t.k === 'w' ? <i className="fa-solid fa-khanda gc-w" /> : null}</span>
                    {t.res && <span className={`gc-res ${RES[t.res][1]}`}>{RES[t.res][0]}{overrides[t.i] ? '*' : ''}</span>}
                    <span className="gc-date">{(t.t || '').slice(2, 10)}</span>
                  </button>
                ))}
              </div>
            )}
            <button className="link-btn" onClick={() => setSheet({ history: k })}><i className="fa-solid fa-clock-rotate-left" /> История целиком</button>
          </div>
        );
      })}

      {pools.length > 0 && <SourceNote game={game} compact />}

      {sheet === 'import' && <ImportSheet game={game} onClose={() => setSheet(null)} onImport={runImport} busy={busy} />}
      {sheet === 'session' && <SessionSheet uid={uid} game={game} sum={sum} roster={roster} save={save} onClose={() => setSheet(null)} />}
      {sheet === 'manual' && <ManualSheet uid={uid} game={game} sum={sum} catalog={catalog} onClose={() => setSheet(null)} />}
      {sheet === 'std' && <StdSheet uid={uid} game={game} sum={sum} onClose={() => setSheet(null)} />}
      {sheet?.top && (
        <TopSheet uid={uid} game={game} mine={mine} top={sheet.top} pool={sheet.pool} override={overrides[sheet.top.i]}
          recent={sum.recent || []} catalog={catalog} onClose={() => setSheet(null)} />
      )}
      {sheet?.history && <HistorySheet uid={uid} game={game} pool={sheet.history} onClose={() => setSheet(null)} />}
    </div>
  );
}

function ageText(at) {
  const h = (Date.now() - at) / 3600000;
  if (h < 1) return 'только что';
  if (h < 24) return `${Math.floor(h)} ч назад`;
  return `${Math.floor(h / 24)} дн. назад (скорее всего, уже протухла)`;
}

function PityBar({ pity, pool, top }) {
  const pct = Math.min(100, (pity / pool.hard) * 100);
  const soft = (pool.soft / pool.hard) * 100;
  return (
    <div className="gc-pitybar">
      <div className="gc-bar">
        <span className={pityTone(pity, pool)} style={{ width: `${pct}%` }} />
        {pool.soft < pool.hard && <i style={{ left: `${soft}%` }} title="Мягкий гарант" />}
      </div>
      <div className="gc-bar-label"><b>{pity}</b> / {pool.hard} до {top}★{pool.soft < pool.hard && pity >= pool.soft ? ' · шанс уже растёт' : ''}</div>
    </div>
  );
}

// Что подтягивается само, а что руками — честно по каждой игре.
function SourceNote({ game, compact }) {
  const text = {
    genshin: 'Автоматически: все баннеры молитв (персонажи, оружие, хроники, стандарт, новичок) — по ссылке из кэша игры. API отдаёт примерно последний год, поэтому импортируй хотя бы раз в полгода — старое сохранится здесь. План развития и статы — вручную: открытого API у HoYoLAB нет.',
    hsr: 'Автоматически: прыжки на персонажей, конусы, стандарт, новичка и коллаб-прыжки — по ссылке из кэша игры. Хранит API примерно полгода–год, всё загруженное копится здесь. План развития и статы — вручную.',
    endfield: 'Неофициально и экспериментально: поиск персонажей (особый, базовый, новичок) по токену с сайта SKPORT. Этот API никто не документировал, он может сломаться. Арсенал (оружие) автоматически не загружается — только вручную. План развития и статы — вручную.',
  }[game];
  return <p className={`hint ${compact ? '' : 'gc-note'}`}><i className="fa-solid fa-circle-info" /> {text}</p>;
}

function ImportSheet({ game, onClose, onImport, busy }) {
  const [text, setText] = useState('');
  const [server, setServer] = useState('3');
  const parsed = text.trim() ? parseImportLink(text, game) : null;
  const go = () => {
    if (!parsed || parsed.error) return;
    const params = { ...parsed.params };
    if (game === 'endfield' && !params.server_id) params.server_id = server;
    onImport(params);
  };
  return (
    <Sheet title={`Импорт: ${GAMES[game].short}`} onClose={onClose}
      footer={<button className="btn btn-accent btn-block" disabled={!parsed || parsed.error || busy} onClick={go}>
        {busy ? <><i className="fa-solid fa-spinner fa-spin" /> {busy}</> : 'Загрузить'}</button>}>
      <HowTo game={game} />
      <div className="field">
        <label>{game === 'endfield' ? 'Токен или ссылка' : 'Ссылка на историю'}</label>
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={game === 'endfield' ? 'Вставь токен…' : 'https://…authkey=…'} />
        {parsed?.error && <p className="hint bad">{parsed.error}</p>}
        {parsed && !parsed.error && <p className="hint"><i className="fa-solid fa-check" /> Ссылка {GAMES[parsed.game].short} распознана</p>}
      </div>
      {game === 'endfield' && (
        <div className="field">
          <label>Сервер</label>
          <Seg value={server} onChange={setServer} options={[['3', 'Америка / Европа'], ['2', 'Азия']]} />
        </div>
      )}
      <p className="hint">Ссылка/токен хранится только на этом устройстве, чтобы потом нажимать «Обновить». В базу она не попадает.</p>
    </Sheet>
  );
}

const ENDFIELD_BOOKMARKLET = "javascript:(()=>{const k=Object.keys(sessionStorage).find(k=>k.startsWith('APP_ROLE_U8_TOKEN'));if(!k){alert('Токен не найден: открой книгу записей и войди');return}const v=sessionStorage.getItem(k);navigator.clipboard.writeText(v).then(()=>alert('Токен скопирован'),()=>prompt('Скопируй токен',v))})()";

function HowTo({ game }) {
  const copy = (s) => navigator.clipboard?.writeText(s).then(() => toast('Скопировано'), () => toastError('Не удалось скопировать'));
  if (game === 'endfield') {
    return (
      <div className="gc-howto">
        <ol>
          <li>Открой <a href="https://act.skport.com/endfield/recordBook" target="_blank" rel="noreferrer">книгу записей Endfield на SKPORT</a> и войди в свой аккаунт.</li>
          <li>Добавь в закладки этот код и нажми закладку на той странице — токен скопируется. <button className="link-btn" onClick={() => copy(ENDFIELD_BOOKMARKLET)}>Скопировать код закладки</button></li>
          <li>Или на компьютере: F12 → Application → Session Storage → ключ <code>APP_ROLE_U8_TOKEN…</code> → скопируй значение.</li>
          <li>Вставь сюда и выбери сервер.</li>
        </ol>
        <p className="hint">Это неофициальный способ: так делают goyfield.moe и другие трекеры. Токен даёт доступ только к истории поиска; не отправляй его посторонним.</p>
      </div>
    );
  }
  const site = game === 'genshin'
    ? ['https://paimon.moe/wish/import', 'paimon.moe']
    : ['https://starrailstation.com/en/warp#import', 'starrailstation.com'];
  return (
    <div className="gc-howto">
      <ol>
        <li>На ПК запусти игру и открой {game === 'genshin' ? 'Молитвы → История' : 'Прыжки → Записи'}.</li>
        <li>Возьми ссылку из кэша игры: скрипт для PowerShell и подробная инструкция — на <a href={site[0]} target="_blank" rel="noreferrer">{site[1]}</a>. Скрипт копирует ссылку в буфер.</li>
        <li>Вставь её сюда. Ссылка живёт около суток: потом снова открой историю в игре и возьми новую.</li>
      </ol>
      <p className="hint">На телефоне ссылку достать сложно (нужен перехват трафика), проще с ПК. Из ссылки берётся только ключ authkey — ни пароль, ни аккаунт не нужны.</p>
    </div>
  );
}

function ManualSheet({ uid, game, sum, catalog, onClose }) {
  const G = GAMES[game];
  const [pool, setPool] = useState(Object.keys(G.pools)[0]);
  const [mode, setMode] = useState('top');
  const [name, setName] = useState('');
  const [at, setAt] = useState('');
  const [count, setCount] = useState('10');
  const [date, setDate] = useState('');
  const [saving, setSaving] = useState(false);
  const P = G.pools[pool];
  const current = sum.pools?.[pool]?.pity || 0;
  const time = date ? `${date} 12:00:00` : undefined;
  const rec = mode === 'top'
    ? manualTop({ game, pool, name, at, currentPity: current, time, kind: /weapon/i.test(pool) ? 'w' : 'c' })
    : manualFiller({ game, pool, count, time });
  const save = async () => {
    if (rec.error) return;
    setSaving(true);
    try { await addManualPull(uid, game, rec); toast('Записала'); onClose(); } catch (e) { reportError(e); } finally { setSaving(false); }
  };
  return (
    <Sheet title="Внести вручную" onClose={onClose}
      footer={<button className="btn btn-accent btn-block" disabled={!!rec.error || saving || (mode === 'top' && !name.trim())} onClick={save}>Сохранить</button>}>
      <div className="field">
        <label>Баннер</label>
        <div className="chips">
          {Object.entries(G.pools).map(([k, p]) => (
            <button key={k} className={`chip pick ${pool === k ? 'on' : ''}`} onClick={() => setPool(k)}>{p.label}</button>
          ))}
        </div>
        <p className="hint">Сейчас учтено круток без {G.top}★: {current}</p>
      </div>
      <Seg className="mb" value={mode} onChange={setMode} options={[['top', `Выпал ${G.top}★`], ['filler', `Крутки без ${G.top}★`]]} />
      {mode === 'top' ? (
        <>
          <div className="field"><label>Кто / что выпало</label>
            {/weapon/i.test(pool) ? (
              <>
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Название (как в игре, по-английски — для 50/50)" list="gc-std" />
                <datalist id="gc-std">{(G.std.weapon || []).map((n) => <option key={n} value={n} />)}</datalist>
              </>
            ) : <NameInput game={game} catalog={catalog} r={G.top} value={name} onChange={setName} placeholder="Имя персонажа" />}
          </div>
          <div className="field"><label>На какой крутке (pity)</label>
            <input className="input" inputMode="numeric" value={at} onChange={(e) => setAt(e.target.value)} placeholder={`1–${P.hard}`} />
          </div>
        </>
      ) : (
        <div className="field"><label>Сколько круток</label>
          <input className="input" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
        </div>
      )}
      <div className="field"><label>Дата (необязательно)</label>
        <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      {rec.error && (at || mode === 'filler') && <p className="hint bad">{rec.error}</p>}
    </Sheet>
  );
}

function StdSheet({ uid, game, sum, onClose }) {
  const G = GAMES[game];
  const [char, setChar] = useState((sum.std?.char ?? G.std.char).join('\n'));
  const [weapon, setWeapon] = useState((sum.std?.weapon ?? G.std.weapon).join('\n'));
  const lines = (s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  const save = () => saveGachaMeta(uid, game, { std: { char: lines(char), weapon: lines(weapon) } }).then(onClose, reportError);
  const reset = () => { setChar(G.std.char.join('\n')); setWeapon(G.std.weapon.join('\n')); };
  return (
    <Sheet title="Стандартные для 50/50" onClose={onClose}
      footer={<><button className="btn" onClick={reset}>По умолчанию</button><button className="btn btn-accent" onClick={save}>Сохранить</button></>}>
      <p className="hint">Если на ивентовом баннере выпал кто-то из этого списка — это проигрыш 50/50{game === 'endfield' ? '' : ', и следующий топ-дроп будет гарантом'}. Имена — по-английски, как в истории. Добавили нового стандартного в игре — допиши сюда.</p>
      {game === 'endfield' && <p className="hint bad">Для Endfield список по умолчанию пуст: проверь в игре состав «Базового поиска» и впиши 6★.</p>}
      <div className="field"><label>Персонажи</label><textarea className="input" rows={6} value={char} onChange={(e) => setChar(e.target.value)} /></div>
      {game !== 'endfield' && <div className="field"><label>{game === 'hsr' ? 'Световые конусы' : 'Оружие'}</label><textarea className="input" rows={6} value={weapon} onChange={(e) => setWeapon(e.target.value)} /></div>}
    </Sheet>
  );
}

function TopSheet({ uid, game, mine, top, pool, override, recent, catalog, onClose }) {
  const G = GAMES[game];
  const P = G.pools[pool];
  const manual = top.i.startsWith('m');
  const [name, setName] = useState(top.n);
  const [pity, setPity] = useState(String(top.p));
  const [saving, setSaving] = useState(false);
  const set = (v) => setGachaOverride(uid, game, top.i, v).then(onClose, reportError);
  const del = () => removePull(uid, game, top.i).then(() => { toast('Удалила'); onClose(); }, reportError);
  const nameChanged = name.trim() && name.trim() !== top.n;
  const pityChanged = manual && pity.trim() !== String(top.p);
  const saveEdit = async () => {
    setSaving(true);
    try {
      await editTopPull(uid, game, top.i, { n: nameChanged ? name : null, pity: pityChanged ? pity.trim() : null, oldName: top.n }, recent);
      toast('Поправила');
      onClose();
    } catch (e) { toastError(e.message || String(e)); } finally { setSaving(false); }
  };
  // старая поправка 'won' («лимитный») подсвечивает то, что вышло по истории
  const pick = override === 'won' ? (top.res === 'guar' ? 'guar' : 'fifty') : override || null;
  const chips = [[null, 'Автоматически'], ['fifty', 'Выиграла 50/50'], ...(P.guarantee ? [['guar', 'Гарант']] : []), ['lost', 'Проиграла (стандартный)']];
  return (
    <Sheet title={top.n} onClose={onClose}
      footer={mine && (nameChanged || pityChanged)
        ? <button className="btn btn-accent btn-block" disabled={saving} onClick={saveEdit}>{saving ? <i className="fa-solid fa-spinner fa-spin" /> : 'Сохранить'}</button>
        : null}>
      <p>Выпал на <b>{top.p}</b>-й крутке{top.t ? `, ${top.t.slice(0, 16)}` : ''}{top.b ? ` · баннер «${top.b}»` : ''}.</p>
      {top.res && <p>Итог: <span className={`gc-res ${RES[top.res][1]}`}>{RES[top.res][0]}</span>{override ? ' (поправлено вручную)' : ''}</p>}
      {mine && P.fifty && (
        <>
          <div className="section-title">Как выпал</div>
          <div className="chips">
            {chips.map(([v, label]) => (
              <button key={label} className={`chip pick ${pick === v ? 'on' : ''}`} onClick={() => set(v)}>{label}</button>
            ))}
          </div>
          <p className="hint">«Автоматически» — по списку стандартных и предыдущим дропам. Поправка влияет и на следующие: после проигрыша следующий считается гарантом.</p>
        </>
      )}
      {mine && (
        <>
          <div className="section-title">Поправить запись</div>
          <div className="field"><label>Кто выпал</label>
            {top.k === 'w'
              ? <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
              : <NameInput game={game} catalog={catalog} r={G.top} value={name} onChange={setName} />}
          </div>
          <div className="field"><label>На какой крутке (pity)</label>
            <input className="input" inputMode="numeric" value={pity} disabled={!manual} onChange={(e) => setPity(e.target.value)} placeholder={`1–${P.hard}`} />
            <p className="hint">{manual
              ? 'Меняется только этот дроп: остальные и текущий счётчик останутся как были.'
              : 'Загружено из игры — номер точный, его не меняем.'}</p>
          </div>
        </>
      )}
      {mine && manual && <button className="btn btn-sm btn-ghost" style={{ marginTop: 16 }} onClick={del}><i className="fa-solid fa-trash" /> Удалить ручную запись</button>}
    </Sheet>
  );
}

// Вся история копилки — читаем куски только сейчас.
function HistorySheet({ uid, game, pool, onClose }) {
  const G = GAMES[game];
  const [pulls, setPulls] = useState(null);
  const [onlyRare, setOnlyRare] = useState(true);
  const [limit, setLimit] = useState(150);
  useEffect(() => {
    loadGachaLog(uid, game).then(({ pulls: all }) => setPulls(all.filter((p) => poolOf(game, p.g) === pool).sort(cmpPull).reverse()), (e) => { reportError(e); setPulls([]); });
  }, [uid, game, pool]);
  const shown = (pulls || []).filter((p) => !onlyRare || p.r >= G.top - 1);
  return (
    <Sheet title={`История: ${G.pools[pool].label}`} onClose={onClose}>
      <Seg className="mb seg-sm" value={onlyRare ? 'rare' : 'all'} onChange={(v) => setOnlyRare(v === 'rare')}
        options={[['rare', `Только ${G.top - 1}★ и ${G.top}★`], ['all', 'Все']]} />
      {pulls === null && <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>}
      {pulls && !shown.length && <div className="empty">Пусто</div>}
      <div className="gc-log">
        {shown.slice(0, limit).map((p) => (
          <div key={p.i} className={`gc-log-row r${p.r >= G.top ? 'top' : p.r === G.top - 1 ? 'mid' : ''}`}>
            <span className="gc-date">{(p.t || '').slice(0, 16)}</span>
            <span className="gc-top-name">{p.n || `${p.c} круток`}{p.c > 1 && p.n ? ` (+${p.c - 1})` : ''}</span>
            <span>{p.r}★</span>
          </div>
        ))}
      </div>
      {shown.length > limit && <button className="btn btn-block btn-sm" onClick={() => setLimit(limit + 300)}>Показать ещё</button>}
    </Sheet>
  );
}

/* =================== Развитие и отряды =================== */

function RosterSection({ game, mine, section, roster, save: saveAll }) {
  const [edit, setEdit] = useState(null); // персонаж
  const [team, setTeam] = useState(null);
  const [name, setName] = useState('');
  const save = (next) => saveAll(next).catch(reportError);

  const addChar = () => {
    const n = name.trim();
    if (!n) return;
    const c = emptyChar(game, n);
    save({ chars: [...roster.chars, c] });
    setName('');
    setEdit(c);
  };
  const putChar = (c) => save({ chars: roster.chars.some((x) => x.id === c.id) ? roster.chars.map((x) => (x.id === c.id ? c : x)) : [...roster.chars, c] });
  const delChar = (id) => save({
    chars: roster.chars.filter((x) => x.id !== id),
    teams: roster.teams.map((t) => ({ ...t, members: t.members.filter((m) => m !== id) })),
  });
  const putTeam = (t) => save({ teams: roster.teams.some((x) => x.id === t.id) ? roster.teams.map((x) => (x.id === t.id ? t : x)) : [...roster.teams, t] });
  const delTeam = (id) => save({ teams: roster.teams.filter((x) => x.id !== id) });

  if (section === 'plan') {
    return (
      <div>
        {mine && (
          <div className="quick-add">
            <span className="qa-who static"><i className="fa-solid fa-user-plus" /></span>
            <input className="qa-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Добавить персонажа…"
              onKeyDown={(e) => { if (e.key === 'Enter') addChar(); }} />
            <button className="qa-send" onClick={addChar} disabled={!name.trim()} aria-label="Добавить"><i className="fa-solid fa-plus" /></button>
          </div>
        )}
        {!roster.chars.length && <div className="empty">Добавь персонажей, которых качаешь: уровень, таланты, {GAMES[game].cons.toLowerCase()}, {GAMES[game].gear.toLowerCase()}, материалы и статы — всё вручную.</div>}
        {roster.chars.map((c) => <CharCard key={c.id} game={game} c={c} onOpen={() => setEdit(c)} />)}
        {edit && <CharSheet game={game} char={edit} mine={mine} onClose={() => setEdit(null)} onSave={(c) => { putChar(c); setEdit(null); }}
          onDelete={() => { delChar(edit.id); setEdit(null); }} />}
      </div>
    );
  }

  return (
    <div>
      {mine && (
        <button className="btn btn-block mb" disabled={!roster.chars.length} onClick={() => setTeam({ id: 't' + Date.now().toString(36), name: '', members: [], note: '' })}>
          <i className="fa-solid fa-plus" /> Новый отряд
        </button>
      )}
      {!roster.chars.length && <div className="empty">Сначала добавь персонажей в «Развитии», потом собери из них отряд.</div>}
      {roster.chars.length > 0 && !roster.teams.length && <div className="empty">Отрядов пока нет. Собери отряд — покажу, насколько он готов и что подтянуть до целей из гайда.</div>}
      {roster.teams.map((t) => <TeamCard key={t.id} game={game} team={t} roster={roster.chars} onOpen={() => mine && setTeam(t)} />)}
      {team && <TeamSheet game={game} team={team} roster={roster.chars} onClose={() => setTeam(null)}
        onSave={(t) => { putTeam(t); setTeam(null); }} onDelete={() => { delTeam(team.id); setTeam(null); }} />}
    </div>
  );
}

function Readiness({ score }) {
  const [label, tone] = grade(score);
  return (
    <div className="gc-ready">
      <div className="gc-bar"><span className={tone} style={{ width: `${Math.round(score * 100)}%` }} /></div>
      <span className={`gc-res ${tone}`}>{Math.round(score * 100)}% · {label}</span>
    </div>
  );
}

function CharCard({ game, c, onOpen }) {
  const G = GAMES[game];
  const r = useMemo(() => charReadiness(game, c), [game, c]);
  const left = matsLeft(c);
  const gaps = r.gaps.filter((g) => !g.key.startsWith('mat:')); // материалы — отдельной строкой
  return (
    <div className="card gc-char" onClick={onOpen}>
      <div className="gc-pool-head">
        <h3>{c.name}</h3>
        <span className="hint">ур. {c.level || 1}/{c.levelTarget || G.levelMax} · {G.cons[0]}{c.cons || 0}</span>
      </div>
      <div className="hint">Таланты: {(c.talents || []).join('/')}{c.weapon ? ` · ${c.weapon}` : ''} · {G.gear}: {GEAR_LEVELS[c.gear || 0]}</div>
      <Readiness score={r.score} />
      {gaps.length > 0 && <div className="hint">Подтянуть: {gaps.slice(0, 3).map((g) => g.label).join(', ')}</div>}
      {left.length > 0 && <div className="hint">Собрать: {left.slice(0, 4).map((m) => `${m.name} ×${m.left}`).join(', ')}{left.length > 4 ? '…' : ''}</div>}
    </div>
  );
}

const numIn = (v) => (v === '' ? '' : Number.isNaN(Number(v)) ? v : Number(v));

function CharSheet({ game, char, mine, onClose, onSave, onDelete }) {
  const G = GAMES[game];
  const [c, setC] = useState(char);
  const upd = (patch) => setC((p) => ({ ...p, ...patch }));
  const setArr = (field, i, v) => setC((p) => { const a = [...(p[field] || [])]; a[i] = numIn(v); return { ...p, [field]: a }; });
  const setMap = (field, k, v) => setC((p) => ({ ...p, [field]: { ...(p[field] || {}), [k]: numIn(v) } }));
  const setMat = (i, patch) => setC((p) => ({ ...p, mats: p.mats.map((m, j) => (j === i ? { ...m, ...patch } : m)) }));
  const r = charReadiness(game, c);
  const ro = !mine;
  return (
    <Sheet title={c.name || 'Персонаж'} onClose={onClose}
      footer={mine ? <><button className="btn btn-ghost" onClick={() => { if (confirm(`Удалить ${c.name}?`)) onDelete(); }}><i className="fa-solid fa-trash" /></button>
        <button className="btn btn-accent" onClick={() => onSave(c)}>Сохранить</button></> : null}>
      <fieldset disabled={ro} className="gc-fieldset">
        <Readiness score={r.score} />
        <div className="field"><label>Имя</label><input className="input" value={c.name} onChange={(e) => upd({ name: e.target.value })} /></div>
        <div className="gc-grid3">
          <span /><span className="hint">сейчас</span><span className="hint">цель</span>
          <span>Уровень</span>
          <input className="input" inputMode="numeric" value={c.level ?? ''} onChange={(e) => upd({ level: numIn(e.target.value) })} />
          <input className="input" inputMode="numeric" value={c.levelTarget ?? ''} onChange={(e) => upd({ levelTarget: numIn(e.target.value) })} />
          {G.talents.map((t, i) => (
            <TalentRow key={t} label={t} cur={c.talents?.[i]} target={c.talentTargets?.[i]}
              onCur={(v) => setArr('talents', i, v)} onTarget={(v) => setArr('talentTargets', i, v)} />
          ))}
          <span>{G.gear}</span>
          <select className="input" value={c.gear || 0} onChange={(e) => upd({ gear: Number(e.target.value) })}>
            {GEAR_LEVELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
          </select>
          <select className="input" value={c.gearTarget ?? 3} onChange={(e) => upd({ gearTarget: Number(e.target.value) })}>
            {GEAR_LEVELS.map((l, i) => <option key={l} value={i}>{l}</option>)}
          </select>
        </div>
        <div className="field" style={{ marginTop: 14 }}><label>{G.cons}</label>
          <Seg className="seg-sm" value={c.cons || 0} onChange={(v) => upd({ cons: v })}
            options={Array.from({ length: G.consMax + 1 }, (_, i) => [i, `${G.cons[0]}${i}`])} />
        </div>
        <div className="field"><label>{game === 'hsr' ? 'Световой конус' : 'Оружие'}</label><input className="input" value={c.weapon || ''} onChange={(e) => upd({ weapon: e.target.value })} /></div>

        <div className="section-title">Статы: сейчас и цель из гайда</div>
        <p className="hint">Вписывай только то, что важно этому персонажу: пустая цель не учитывается.</p>
        <div className="gc-grid3">
          {STATS[game].map(([k, label, pct]) => (
            <StatRow key={k} label={label + (pct ? ', %' : '')} cur={c.stats?.[k]} target={c.targets?.[k]}
              onCur={(v) => setMap('stats', k, v)} onTarget={(v) => setMap('targets', k, v)} />
          ))}
        </div>

        <div className="section-title">Материалы</div>
        {(c.mats || []).length > 0 && <div className="gc-mat hint"><span>что</span><span>есть</span><span>надо</span>{mine && <span style={{ width: 40 }} />}</div>}
        {(c.mats || []).map((m, i) => (
          <div className="gc-mat" key={i}>
            <input className="input" value={m.name} placeholder="Что" onChange={(e) => setMat(i, { name: e.target.value })} />
            <input className="input" inputMode="numeric" value={m.have ?? ''} placeholder="есть" onChange={(e) => setMat(i, { have: numIn(e.target.value) })} />
            <input className="input" inputMode="numeric" value={m.need ?? ''} placeholder="надо" onChange={(e) => setMat(i, { need: numIn(e.target.value) })} />
            {mine && <button className="icon-btn btn-ghost btn" onClick={() => upd({ mats: c.mats.filter((_, j) => j !== i) })} aria-label="Убрать"><i className="fa-solid fa-xmark" /></button>}
          </div>
        ))}
        {mine && <button className="link-btn" onClick={() => upd({ mats: [...(c.mats || []), { name: '', have: 0, need: 1 }] })}><i className="fa-solid fa-plus" /> Материал</button>}

        <div className="field" style={{ marginTop: 14 }}><label>Заметки / ссылка на гайд</label>
          <textarea className="input" rows={3} value={c.note || ''} onChange={(e) => upd({ note: e.target.value })} />
        </div>
      </fieldset>
    </Sheet>
  );
}

function TalentRow({ label, cur, target, onCur, onTarget }) {
  return (
    <>
      <span>{label}</span>
      <input className="input" inputMode="numeric" value={cur ?? ''} onChange={(e) => onCur(e.target.value)} />
      <input className="input" inputMode="numeric" value={target ?? ''} onChange={(e) => onTarget(e.target.value)} />
    </>
  );
}
const StatRow = TalentRow;

function TeamCard({ game, team, roster, onOpen }) {
  const r = useMemo(() => teamReport(game, team, roster), [game, team, roster]);
  return (
    <div className="card gc-team" onClick={onOpen}>
      <div className="gc-pool-head"><h3>{team.name || 'Отряд'}</h3><span className="hint">{r.size}/4</span></div>
      <Readiness score={r.score} />
      <div className="gc-members">
        {r.members.map((m) => (
          <span key={m.c.id} className={`chip gc-member ${grade(m.score)[1]}`}>{m.c.name} · {Math.round(m.score * 100)}%</span>
        ))}
      </div>
      {r.todo.length > 0 ? (
        <>
          <div className="section-title" style={{ margin: '12px 0 6px' }}>Что улучшить</div>
          <ul className="gc-todo">
            {r.todo.map((t) => <li key={t.who + t.key}><b>{t.who}</b>: {t.label} {t.key === 'gear' ? `${GEAR_LEVELS[t.cur] ?? t.cur} → ${GEAR_LEVELS[t.target] ?? t.target}` : `${fmtNum(t.cur)} → ${fmtNum(t.target)}`}</li>)}
          </ul>
        </>
      ) : r.size > 0 && <p className="hint">Все цели из гайда достигнуты.</p>}
      {team.note && <p className="hint">{team.note}</p>}
    </div>
  );
}
const fmtNum = (n) => (typeof n === 'number' ? (Number.isInteger(n) ? n : n.toFixed(1)) : n);

function TeamSheet({ game, team, roster, onClose, onSave, onDelete }) {
  const [t, setT] = useState(team);
  const toggle = (id) => setT((p) => ({
    ...p,
    members: p.members.includes(id) ? p.members.filter((m) => m !== id) : p.members.length < 4 ? [...p.members, id] : p.members,
  }));
  const r = teamReport(game, t, roster);
  return (
    <Sheet title={team.name || 'Новый отряд'} onClose={onClose}
      footer={<><button className="btn btn-ghost" onClick={onDelete}><i className="fa-solid fa-trash" /></button>
        <button className="btn btn-accent" disabled={!t.members.length} onClick={() => onSave({ ...t, name: t.name.trim() || 'Отряд' })}>Сохранить</button></>}>
      <div className="field"><label>Название</label><input className="input" value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} placeholder="Например, Мавуика-нацлан" /></div>
      <div className="field"><label>Состав (до 4) · готовность {Math.round(r.score * 100)}%</label>
        <div className="chips">
          {roster.map((c) => (
            <button key={c.id} className={`chip pick ${t.members.includes(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>{c.name}</button>
          ))}
        </div>
      </div>
      <p className="hint">Готовность считается по целям, которые ты вписала персонажам в «Развитии»: уровень, таланты, {GAMES[game].gear.toLowerCase()} и статы из гайда.</p>
      <div className="field"><label>Заметки / ротация / ссылка на гайд</label>
        <textarea className="input" rows={3} value={t.note || ''} onChange={(e) => setT({ ...t, note: e.target.value })} />
      </div>
    </Sheet>
  );
}

/* =================== Записать крутки (быстрый ручной ввод) =================== */

// «Открутила 10, выпал конус 4★ и Кафка» — без точных номеров круток.
function SessionSheet({ uid, game, sum, roster, save, onClose }) {
  const G = GAMES[game];
  const catalog = useCatalog(game, roster) || [];
  const pools = Object.entries(G.pools);
  const [pool, setPool] = useState(() => loadPref(`gachaPool:${game}`, Object.keys(G.pools)[0]));
  const [mode, setMode] = useState('session');
  const [count, setCount] = useState('10');
  const [drops, setDrops] = useState([]);
  const [pityNow, setPityNow] = useState('');
  const [mark, setMark] = useState(true);
  const [saving, setSaving] = useState(false);
  const [order, setOrderState] = useState(() => loadPref('gachaOrder', 'first'));
  const setOrder = (v) => { setOrderState(v); savePref('gachaOrder', v); };
  const P = G.pools[pool] || G.pools[Object.keys(G.pools)[0]];
  const weaponPool = /weapon/i.test(pool);
  const current = sum.pools?.[pool]?.pity || 0;
  const pickPool = (k) => { setPool(k); savePref(`gachaPool:${game}`, k); };
  const wName = game === 'hsr' ? 'конус' : 'оружие';

  const addDrop = (r) => setDrops((d) => [...d, { n: '', r, k: weaponPool ? 'w' : 'c', at: '' }]);
  const setDrop = (i, patch) => setDrops((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  let res;
  if (mode === 'session') res = sessionRecords({ game, pool, count, drops, order });
  else {
    const n = Number(pityNow);
    if (!Number.isInteger(n) || n < 0 || n >= P.hard) res = { error: `pity — от 0 до ${P.hard - 1}` };
    else if (n < current) res = { error: `Учтено уже ${current}. Если в истории лишнее — удали ручные записи (тап по сессии в «Последних»).` };
    else if (n === current) res = { error: 'Совпадает с тем, что уже учтено' };
    else res = sessionRecords({ game, pool, count: n - current });
  }
  const preview = res.records ? sessionPreview(res.records, current, G.top) : null;
  const filled = drops.filter((d) => d.n.trim());

  const doSave = async () => {
    if (!res.records) return;
    setSaving(true);
    try {
      const session = {
        id: res.records[0].i, t: fmtTime(), pool, count: res.records.reduce((s, r) => s + (r.c || 1), 0),
        drops: mode === 'session' ? filled.map((d) => ({ n: d.n.trim(), r: d.r, k: d.k })) : [],
        ids: res.records.map((r) => r.i), ...(mode === 'pity' ? { fix: true } : {}),
      };
      await addSession(uid, game, res.records, session, sum.recent || []);
      if (mark && session.drops.length) {
        const r = applyDrops(game, roster.owned || {}, catalog, session.drops);
        if (r.changed.length) {
          await save({ owned: r.owned });
          toast(r.changed.map((c) => (c.isNew ? `${c.name} — новый!` : `${c.name} → ${G.cons[0]}${c.cons}`)).join(', '));
        }
      }
      toast('Записала');
      onClose();
    } catch (e) { reportError(e); } finally { setSaving(false); }
  };

  return (
    <Sheet title="Записать крутки" onClose={onClose}
      footer={<button className="btn btn-accent btn-block" disabled={!res.records || saving} onClick={doSave}>{saving ? <i className="fa-solid fa-spinner fa-spin" /> : 'Сохранить'}</button>}>
      <div className="field">
        <label>Баннер</label>
        <div className="chips">
          {pools.map(([k, p]) => <button key={k} className={`chip pick ${pool === k ? 'on' : ''}`} onClick={() => pickPool(k)}>{p.label}</button>)}
        </div>
        <p className="hint">Сейчас учтено: <b>{current}</b> / {P.hard} без {G.top}★</p>
      </div>
      <Seg className="mb seg-sm" value={mode} onChange={setMode} options={[['session', 'Открутила'], ['pity', 'Указать pity из игры']]} />

      {mode === 'pity' ? (
        <div className="field"><label>Сколько круток без {G.top}★ сейчас в игре</label>
          <input className="input" inputMode="numeric" value={pityNow} onChange={(e) => setPityNow(e.target.value)} placeholder={String(current)} />
          <p className="hint">Добавлю недостающие крутки без топ-дропа, чтобы счётчик совпал с игрой.</p>
        </div>
      ) : (
        <>
          <div className="field"><label>Сколько круток</label>
            <div className="row" style={{ alignItems: 'center' }}>
              <Seg className="seg-sm" value={['1', '10'].includes(count) ? count : 'x'} onChange={(v) => v !== 'x' && setCount(v)} options={[['1', '×1'], ['10', '×10'], ['x', 'другое']]} />
              <input className="input" style={{ width: 80 }} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />
            </div>
          </div>
          <div className="field"><label>Что выпало ({G.top - 1}★ и {G.top}★, остальное не важно)</label>
            <Seg className="mb seg-sm" value={order} onChange={setOrder}
              options={[['first', '№1 — первая крутка'], ['last', '№1 — последняя']]} />
            {drops.map((d, i) => (
              <div key={i} className="gc-drop">
                <span className={`gc-drop-r r${d.r >= G.top ? 'top' : 'mid'}`}>{d.r}★</span>
                {d.k === 'c'
                  ? <NameInput game={game} catalog={catalog} r={d.r} value={d.n} onChange={(v) => setDrop(i, { n: v })} placeholder="Кто" />
                  : <input className="input" value={d.n} onChange={(e) => setDrop(i, { n: e.target.value })} placeholder={`Какое ${wName}`} />}
                <button className={`btn btn-sm ${d.k === 'w' ? 'btn-accent' : ''}`} onClick={() => setDrop(i, { k: d.k === 'w' ? 'c' : 'w' })} title={d.k === 'w' ? wName : 'персонаж'}>
                  <i className={d.k === 'w' ? 'fa-solid fa-khanda' : 'fa-solid fa-user'} />
                </button>
                <input className="input gc-drop-at" inputMode="numeric" value={d.at} onChange={(e) => setDrop(i, { at: e.target.value })} placeholder="№" title="На какой крутке этой сессии (необязательно)" />
                <button className="icon-btn btn-ghost btn" onClick={() => setDrops(drops.filter((_, j) => j !== i))} aria-label="Убрать"><i className="fa-solid fa-xmark" /></button>
              </div>
            ))}
            <div className="chips">
              <button className="btn btn-sm" onClick={() => addDrop(G.top)}><i className="fa-solid fa-plus" /> {G.top}★</button>
              <button className="btn btn-sm" onClick={() => addDrop(G.top - 1)}><i className="fa-solid fa-plus" /> {G.top - 1}★</button>
            </div>
            <p className="hint">{order === 'first'
              ? 'Пиши по порядку, как выпадало: сверху — самое раннее. «№» — номер крутки, считая с первой.'
              : 'Пиши как в истории игры: сверху — самое свежее. «№» — номер, считая с последней крутки назад.'}
              {' '}Без номера — поставлю в конец сессии в том же порядке.</p>
          </div>
          {filled.some((d) => d.k === 'c') && (
            <label className="gc-check"><input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} /> Отметить выпавших персонажей как «есть» (повтор → +1 {CONS_ONE[game]})</label>
          )}
        </>
      )}

      {res.error && (mode === 'pity' ? pityNow : true) && <p className="hint bad">{res.error}</p>}
      {preview && (
        <div className="hint">
          {preview.seq.length > 1 && (
            <p style={{ margin: '0 0 4px' }}>Выпадало так: {preview.seq.map((d, i) => (
              <span key={i}>{i ? ' → ' : ''}<b className={`gc-drop-n r${d.r >= G.top ? 'top' : 'mid'}`} style={{ margin: 0 }}>{d.n}</b> (№{order === 'last' ? Number(count) + 1 - d.at : d.at})</span>
            ))}</p>
          )}
          <p style={{ margin: 0 }}>
            После записи: <b>{preview.pityAfter}</b> / {P.hard}
            {preview.tops.map((t) => <span key={t.n + t.p}> · {t.n} на {t.p}-й</span>)}
          </p>
        </div>
      )}
    </Sheet>
  );
}

function RecentCard({ uid, game, mine, sum }) {
  const G = GAMES[game];
  const [open, setOpen] = useState(null);
  const recent = sum.recent || [];
  if (!recent.length) return null;
  const del = (s) => {
    if (!confirm('Удалить эту запись и её крутки из истории?')) return;
    removeSession(uid, game, s, recent).then(() => { toast('Удалила'); setOpen(null); }, reportError);
  };
  return (
    <div className="card gc-pool">
      <div className="gc-pool-head"><h3>Последние крутки</h3></div>
      <div className="gc-tops">
        {recent.slice(0, 8).map((s) => (
          <button key={s.id} className="gc-top" onClick={() => mine && setOpen(open === s.id ? null : s.id)}>
            <span className="gc-pity ok">{s.count}</span>
            <span className="gc-top-name">
              {s.fix ? 'Поправка счётчика' : s.drops.length ? s.drops.map((d) => (
                <span key={d.n + d.r} className={`gc-drop-n r${d.r >= G.top ? 'top' : 'mid'}`}>{d.n}{d.k === 'w' ? <i className="fa-solid fa-khanda gc-w" /> : null}</span>
              )) : <span className="hint">ничего ценного</span>}
            </span>
            <span className="gc-date">{G.pools[s.pool]?.label} · {(s.t || '').slice(5, 10)}</span>
            {open === s.id && <span className="link-btn" onClick={(e) => { e.stopPropagation(); del(s); }}><i className="fa-solid fa-trash" /></span>}
          </button>
        ))}
      </div>
    </div>
  );
}
