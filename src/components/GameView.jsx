import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeUserState, saveGame, saveUserState, subscribeMoods, subscribeMurmur } from '../lib/db';
import { subscribeTxCreatedSince } from '../lib/budget';
import { toast, reportError } from '../lib/toast';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import {
  SPECIES, BY_ID, GIANTS, ELEMENTS, CLASSES, FAMILIES, REGIONS, SKILLS, RARITY, PLACE,
  FRONT_SIZE, BACK_SIZE, BENCH_SIZE, REROLL_COST, XP_BUY, GIANT_HP, LEVEL_XP, DAILY_XP, MAX_STARS, MISPLACED,
  newRun, normalizeRun, startCoinsOf, makePack, repack, isFresh, economy, rewardsFor, ensureShop, buy, sell, move, reroll, buyXp,
  teamOf, bonds, tick, interestFor, simulateRaid, giantOf, weekKey, weekStart, dayStr, dayIndex,
  unitCost, offerCost, oddsFor, battleHp, statsOf, imgOf, formOf, placeOf, fits, isWeekend, ENGINE_V,
  fightCost, fightsOn, giantPower,
} from '../game/engine';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const pct = (d) => Math.min(100, Math.round((d / GIANT_HP) * 1000) / 10);
const KIND_DEFS = { el: ELEMENTS, cl: CLASSES, fam: FAMILIES, reg: REGIONS };
const KIND_NAMES = { el: 'стихия', cl: 'класс', fam: 'семейство', reg: 'регион' };
const PLACE_ICON = { front: 'fa-person-rifle', back: 'fa-hand-holding-heart', both: 'fa-arrows-up-down' };

function Stars({ n }) {
  if (n <= 3) return <span className="pm-stars">{'★'.repeat(n)}</span>;
  return <span className="pm-stars awake">★{n}</span>;
}

// Приводит сохранённый ран к текущей версии: старые размеры, лавка, набор.
function upgradeRun(stored, uid) {
  if (stored.v === 3) return normalizeRun(stored);
  return normalizeRun({
    ...stored,
    v: 3,
    pack: stored.pack || makePack(`${uid}|${stored.week}|pack0`, giantOf(stored.week)),
    packRolls: stored.packRolls || 0,
    shop: null,
  });
}

/* ---------- Мелкие куски ---------- */

function Portrait({ id, st = 1, size = 56 }) {
  const sp = BY_ID[id];
  const [broken, setBroken] = useState(false);
  const el = ELEMENTS[sp.el];
  return (
    <div className={`pm-portrait ${st > 3 ? 'awake' : ''}`} style={{ width: size, height: size, '--el': el.color }}>
      {broken
        ? <i className={`fa-solid ${el.icon}`} />
        : <img src={imgOf(sp, st)} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
    </div>
  );
}

function GiantEmblem({ giant, size = 72 }) {
  const el = ELEMENTS[giant.el];
  const [broken, setBroken] = useState(false);
  return (
    <div className="pm-giant-emblem" style={{ width: size, height: size, '--el': el.color }}>
      {giant.img && !broken
        ? <img src={giant.img} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
        : <i className={`fa-solid ${el.icon}`} />}
    </div>
  );
}

function UnitTile({ unit, row, selected, target, dim, onClick, kid, compact }) {
  if (!unit) {
    return <button type="button" className={`pm-slot empty ${target ? 'target' : ''} ${dim ? 'dim' : ''}`} onClick={onClick} aria-label="Пустое место" />;
  }
  const sp = BY_ID[unit.s];
  const wrong = row && !fits(sp, row);
  return (
    <button type="button" className={`pm-slot ${selected ? 'sel' : ''} rar-${sp.rar} ${wrong ? 'wrong' : ''}`} onClick={onClick}
      title={wrong ? `${sp.name}: место — ${PLACE[placeOf(sp)]}, здесь работает на ${MISPLACED * 100}%` : sp.name}>
      {kid && <em className="pm-badge kid" title="Дитя гиганта: он его не бьёт, но гнев растёт быстрее">дитя</em>}
      {wrong && <em className="pm-badge wrongb" title="Не на своём месте"><i className="fa-solid fa-triangle-exclamation" /></em>}
      <Portrait id={unit.s} st={unit.st} size={compact ? 34 : 44} />
      <Stars n={unit.st} />
      {!compact && <span className="pm-name">{sp.name}</span>}
      {!compact && (
        <span className="pm-tags">
          <i className={`fa-solid ${ELEMENTS[sp.el].icon}`} style={{ color: ELEMENTS[sp.el].color }} />
          <i className={`fa-solid ${CLASSES[sp.cls].icon}`} />
          <i className={`fa-solid ${PLACE_ICON[placeOf(sp)]}`} title={PLACE[placeOf(sp)]} />
        </span>
      )}
    </button>
  );
}

function Bonds({ units, giant }) {
  const list = bonds(units);
  const [allOff, setAllOff] = useState(false);
  const on = list.filter((b) => b.tier).sort((a, b) => b.tier - a.tier || b.n - a.n);
  const off = list.filter((b) => !b.tier).sort((a, b) => (b.n / b.def.steps[0]) - (a.n / a.def.steps[0]));
  if (!list.length) return <p className="hint">Связи появятся, когда в команде соберутся особи с общей стихией, классом, семейством или регионом.</p>;
  return (
    <div className="pm-bonds">
      {on.map((x) => (
        <div key={x.kind + x.key} className="pm-bond on">
          <i className={`fa-solid ${x.def.icon}`} style={x.def.color ? { color: x.def.color } : undefined} />
          <b>{x.def.name}</b>
          <span className="pm-steps">{x.def.steps.map((s) => <i key={s} className={x.n >= s ? 'on' : ''}>{s}</i>)}</span>
          {x.kind === 'el' && x.key === giant.weak && <em className="pm-weak">слабость гиганта</em>}
          <span className="pm-bond-text"><span className="dim">{KIND_NAMES[x.kind]}:</span> {x.def.text(x.value)}</span>
        </div>
      ))}
      {off.length > 0 && (
        <div className="pm-bond-off">
          {/* ближние к включению — первыми */}
          {(allOff ? off : off.slice(0, 6)).map((x) => (
            <span key={x.kind + x.key} className={x.kind === 'el' && x.key === giant.weak ? 'weak' : ''} title={`${x.def.name} — с ${x.def.steps[0]}: ${x.def.text(x.def.v[0])}`}>
              <i className={`fa-solid ${x.def.icon}`} style={x.def.color ? { color: x.def.color } : undefined} /> {x.n}/{x.def.steps[0]}
            </span>
          ))}
          {off.length > 6 && (
            <button type="button" className="pm-link" onClick={() => setAllOff((v) => !v)}>
              {allOff ? 'свернуть' : `ещё ${off.length - 6}`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function StatRow({ sp, st }) {
  const [atk, def, , spd] = statsOf(sp, st);
  return (
    <div className="pm-stats">
      <span><b>{atk}</b>атака</span>
      <span><b>{def}</b>защита</span>
      <span><b>{battleHp(sp, st)}</b>хиты</span>
      <span><b>{spd}</b>скорость</span>
    </div>
  );
}

function SpeciesSheet({ id, st = 1, onClose }) {
  const sp = BY_ID[id];
  const [view, setView] = useState(st);
  const el = ELEMENTS[sp.el];
  const cl = CLASSES[sp.cls];
  const fam = FAMILIES[sp.fam];
  const reg = REGIONS[sp.reg];
  const rar = RARITY[sp.rar];
  return (
    <Sheet title={sp.name} onClose={onClose}>
      <div className="pm-detail">
        <div className="pm-hero"><Portrait id={id} st={view} size={140} /></div>
        <div className="seg pm-star-seg" style={{ margin: '12px 0' }}>
          {Array.from({ length: MAX_STARS }, (_, i) => i + 1).map((n) => (
            <button key={n} className={view === n ? 'on' : ''} onClick={() => setView(n)}>★{n}</button>
          ))}
        </div>
        <div className="pm-form-name">{formOf(sp, view)}</div>
        <StatRow sp={sp} st={view} />
        <p className="pm-move"><i className="fa-solid fa-burst" /> {sp.moves[Math.min(view, 3) - 1]}</p>
        <div className="pm-facts">
          <span className={`pm-rar rar-${sp.rar}`}><i className="fa-regular fa-gem" /> {rar.label}, {rar.name}: {rar.cost} мон., сила ×{rar.mult}</span>
          <span><i className={`fa-solid ${PLACE_ICON[placeOf(sp)]}`} /> Место: {PLACE[placeOf(sp)]}. Не на своём — {MISPLACED * 100}% силы.</span>
          <span><i className={`fa-solid ${cl.icon}`} /> {cl.name}: в строю {cl.front}, в тылу {cl.back}</span>
          <span><i className="fa-solid fa-wand-sparkles" /> Навык «{SKILLS[sp.skill].name}» на 3-м, 6-м и 9-м раундах: {SKILLS[sp.skill].text}</span>
          <span><i className={`fa-solid ${el.icon}`} style={{ color: el.color }} /> {el.name}</span>
          {fam && <span><i className={`fa-solid ${fam.icon}`} /> {fam.name}</span>}
          {reg && <span><i className={`fa-solid ${reg.icon}`} /> {reg.name}{sp.home ? ` · ${sp.home}` : ''}</span>}
          {sp.weak && <span><i className="fa-solid fa-heart-crack" /> слабость: {ELEMENTS[sp.weak].name.toLowerCase()}</span>}
        </div>
      </div>
    </Sheet>
  );
}

function GiantSheet({ giant, onClose }) {
  return (
    <Sheet title={giant.name} onClose={onClose}>
      <div className="pm-detail">
        <div className="pm-hero"><GiantEmblem giant={giant} size={120} /></div>
        <p className="pm-epithet">{giant.epithet}</p>
        <div className="pm-facts">
          <span><i className={`fa-solid ${ELEMENTS[giant.el].icon}`} style={{ color: ELEMENTS[giant.el].color }} /> {ELEMENTS[giant.el].name} · {giant.kind}</span>
          <span><i className="fa-solid fa-wind" /> {giant.auraText}</span>
          <span><i className="fa-solid fa-heart-crack" /> Уязвим к стихии «{ELEMENTS[giant.weak].name}»: такие особи бьют ×1,3.</span>
          <span><i className="fa-solid fa-fire-flame-curved" /> Копит гнев и, когда тот полон, бьёт всю команду. Гнев: {giant.wrath}</span>
          <span><i className="fa-solid fa-paw" /> Его дети — их он не бьёт, но злится быстрее: {giant.kids.map((k) => BY_ID[k]?.name).filter(Boolean).join(', ')}</span>
          <span><i className="fa-solid fa-location-dot" /> {giant.where}</span>
        </div>
        <p className="hint">Хитов у гиганта {GIANT_HP.toLocaleString('ru')}. Удары крепнут к концу недели: сегодня {giantPower(dayIndex())}, в воскресенье {giantPower(6)}. С четверга он бьёт трижды за раунд.</p>
      </div>
    </Sheet>
  );
}

function PackSheet({ run, giant, dex, canRepack, onRepack, onClose, onOpen }) {
  const groups = ['very_rare', 'rare', 'common'];
  return (
    <Sheet title="Набор недели" onClose={onClose}
      footer={canRepack ? <button className="btn btn-block" onClick={onRepack}><i className="fa-solid fa-shuffle" /> Перебросить набор</button> : null}>
      <p className="hint" style={{ marginTop: 0 }}>
        Лавка всю неделю даёт только эти 30 видов — так проще собирать тройки. Набор выпадает в понедельник;
        {canRepack ? ' пока ничего не куплено, его можно перебросить.' : ' после первой покупки он закреплён.'}
      </p>
      {groups.map((rar) => (
        <div key={rar}>
          <div className={`section-title pm-rar-title rar-${rar}`}>{RARITY[rar].label} · {RARITY[rar].name}</div>
          <div className="pm-pack">
            {run.pack.filter((id) => BY_ID[id].rar === rar).map((id) => (
              <button key={id} type="button" className={`pm-pack-item rar-${rar}`} onClick={() => onOpen(id)}>
                <Portrait id={id} size={40} />
                <span className="pm-name">{BY_ID[id].name}</span>
                {BY_ID[id].el === giant.weak && <em className="pm-badge weak"><i className="fa-solid fa-heart-crack" /></em>}
                {!dex[id] && <em className="pm-badge new">new</em>}
              </button>
            ))}
          </div>
        </div>
      ))}
    </Sheet>
  );
}

/* ---------- Повтор вылазки ---------- */

function RaidReplay({ fight, giant, onClose }) {
  const res = useMemo(() => simulateRaid({ front: fight.front, back: fight.back }, giant, fight.dayIdx, fight.seed), [fight, giant]);
  const [k, setK] = useState(0);
  const last = res.frames.length - 1;
  useEffect(() => {
    if (k >= last) return;
    const t = setTimeout(() => setK((x) => x + 1), res.frames[k].kind === 'round' ? 280 : 480);
    return () => clearTimeout(t);
  }, [k, last, res]);
  const fr = res.frames[k];
  const logRef = useRef(null);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [k]);

  const row = (units, rowKey, size) => (
    <div className={`pm-arena-row ${rowKey}`}>
      {units.map((u, i) => {
        const [hp, shield, skip] = fr.hp[rowKey][i];
        const max = res.frames[0].hp[rowKey][i][0];
        const isActor = fr.actor?.[0] === rowKey && fr.actor?.[1] === i;
        const isTarget = fr.target?.[0] === rowKey && fr.target?.[1] === i;
        const wrathHit = fr.kind === 'wrath' && hp > 0;
        return (
          <div key={u.u || i} className={`pm-fighter ${hp <= 0 ? 'down' : ''} ${isActor ? 'act ' + (fr.kind || '') : ''} ${isTarget ? 'hit ' + (fr.kind || '') : ''} ${wrathHit ? 'hit hurt' : ''}`}>
            <Portrait id={u.s} st={u.st} size={size} />
            <div className="pm-hp"><i style={{ width: `${Math.max(0, (hp / max) * 100)}%` }} />{shield > 0 && <s style={{ width: `${Math.min(100, (shield / max) * 100)}%` }} />}</div>
            <span className="pm-fname">{BY_ID[u.s].name}{skip ? ' 💤' : ''}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <Sheet
      title={`Вылазка · ${DAYS[fight.dayIdx]}`}
      onClose={onClose}
      footer={k < last
        ? <button className="btn btn-block" onClick={() => setK(last)}>Пропустить</button>
        : <button className="btn btn-accent btn-block" onClick={onClose}>Снято {res.dmg} — закрыть</button>}
    >
      <div className="pm-arena">
        <div className={`pm-arena-giant ${fr.kind === 'hit' || fr.kind === 'skill' ? 'hit' : ''} ${fr.kind === 'wrath' ? 'wrath' : ''}`}>
          <GiantEmblem giant={giant} size={60} />
          <div className="pm-arena-giant-info">
            <b>{giant.name}</b>
            <span className="pm-dmg">−{fr.dmg}</span>
            <div className="pm-wrath" title="Гнев"><i style={{ width: `${Math.min(100, (fr.wrath / 8) * 100)}%` }} /></div>
          </div>
        </div>
        <div className="pm-side-name">Строй</div>
        {row(fight.front, 'front', 46)}
        {fight.back.length > 0 && <><div className="pm-side-name">Тыл</div>{row(fight.back, 'back', 32)}</>}
      </div>
      {(fight.v || 0) !== ENGINE_V && <p className="hint">Правила боя с тех пор поменялись — повтор может отличаться от записанного урона.</p>}
      <div className="pm-log" ref={logRef}>
        {res.frames.slice(0, k + 1).map((f, i) => (
          <div key={i} className={`pm-log-line ${f.kind || ''}`}>{f.text}</div>
        ))}
      </div>
    </Sheet>
  );
}

/* ---------- Команда партнёра (для профиля) ---------- */

export function GameTeamCard({ uid, name }) {
  const [st, setSt] = useState(null);
  const [detail, setDetail] = useState(null);
  useEffect(() => subscribeUserState(uid, setSt), [uid]);
  const week = weekKey();
  const giant = giantOf(week);
  const g = st?.game?.week === week && Array.isArray(st.game.front) ? normalizeRun(st.game) : null;
  if (!st) return null;
  if (!g) return <p className="hint">{name} на этой неделе ещё не начинал(а) рейд на «{giant.name}».</p>;
  const front = g.front.filter(Boolean);
  const back = g.back.filter(Boolean);
  return (
    <div className="card pm-peek">
      <div className="pm-peek-head">
        <GiantEmblem giant={giant} size={40} />
        <div>
          <b>{giant.name}</b>
          <div className="dim">снято {pct(g.damage || 0)}% · вылазок {(g.fights || []).length}</div>
        </div>
      </div>
      <div className="section-title" style={{ marginTop: 12 }}>Строй</div>
      <div className="pm-mini">
        {front.length ? front.map((u) => <button key={u.u} type="button" onClick={() => setDetail(u)}><Portrait id={u.s} st={u.st} size={44} /><Stars n={u.st} /></button>) : <span className="dim">пусто</span>}
      </div>
      {back.length > 0 && (
        <>
          <div className="section-title">Тыл</div>
          <div className="pm-mini">
            {back.map((u) => <button key={u.u} type="button" onClick={() => setDetail(u)}><Portrait id={u.s} st={u.st} size={36} /><Stars n={u.st} /></button>)}
          </div>
        </>
      )}
      {(front.length + back.length) > 0 && <><div className="section-title">Связи</div><Bonds units={[...front, ...back]} giant={giant} /></>}
      {detail && <SpeciesSheet id={detail.s} st={detail.st} onClose={() => setDetail(null)} />}
    </div>
  );
}

/* ---------- Экран ---------- */

export function GameView({ tasks, me, users }) {
  const partner = users.find((u) => u.uid !== me.uid);
  const today = dayStr(new Date());
  const week = weekKey();
  const dIdx = dayIndex();
  const giant = useMemo(() => giantOf(week), [week]);

  const [state, setState] = useState(null);
  const [pState, setPState] = useState(null);
  const [sel, setSel] = useState(null);           // {where, i}
  const [detail, setDetail] = useState(null);     // {id, st}
  const [showGiant, setShowGiant] = useState(false);
  const [showPack, setShowPack] = useState(false);
  const [replay, setReplay] = useState(null);
  const [tab, setTab] = useState('team');
  const [showIncome, setShowIncome] = useState(false);
  const [dexFilter, setDexFilter] = useState('all');

  useEffect(() => subscribeUserState(me.uid, (st) => setState(st)), [me.uid]);
  useEffect(() => (partner ? subscribeUserState(partner.uid, (st) => setPState(st)) : undefined), [partner?.uid]);

  // Источники монет кроме задач. null — ещё не загрузилось: до этого не
  // начисляем проценты нового дня, иначе они посчитаются с неполной суммы.
  const [moods, setMoods] = useState(null);
  const [media, setMedia] = useState(null);
  const [tx, setTx] = useState(null);
  useEffect(() => subscribeMoods(week, dayStr(new Date(weekStart().getTime() + 6 * 864e5)), setMoods), [week]);
  useEffect(() => subscribeMurmur(setMedia), []);
  useEffect(() => subscribeTxCreatedSince(weekStart(), setTx), [week]);
  const sourcesReady = moods !== null && media !== null && tx !== null;

  const rewards = useMemo(
    () => rewardsFor({ tasks, moods: moods || [], media: media || [], tx: tx || [] }, me.uid, weekStart()),
    [tasks, moods, media, tx, me.uid],
  );

  const stored = state?.game;
  const current = stored?.week === week && Array.isArray(stored.front);
  const run = useMemo(() => {
    if (!state) return null;
    const base = current ? upgradeRun(stored, me.uid) : newRun(week, today, me.uid);
    return ensureShop(base, me.uid, today, economy(base, rewards).level);
  }, [state, stored, current, week, today, rewards, me.uid]);

  // Неделя кончилась — итог в историю, ран с нуля (и новый набор).
  useEffect(() => {
    if (!state || current) return;
    if (stored && Array.isArray(stored.front)) {
      const pRun = pState?.game?.week === stored.week ? pState.game : null;
      const entry = { week: stored.week, giant: giantOf(stored.week).id, damage: stored.damage || 0, fights: (stored.fights || []).length, partnerDamage: pRun ? pRun.damage || 0 : null };
      const history = [entry, ...(state.gameHistory || []).filter((h) => h.week !== stored.week && h.giant)].slice(0, 30);
      saveUserState(me.uid, { gameHistory: history }).catch(reportError);
    }
    saveGame(me.uid, newRun(week, today, me.uid)).catch(reportError);
  }, [state, stored, current, week]);

  // Старый формат текущей недели — один раз перезаписать в новом.
  useEffect(() => {
    if (current && stored.v !== 3) saveGame(me.uid, upgradeRun(stored, me.uid)).catch(reportError);
  }, [current, stored?.v]);

  // Новый день — проценты с накоплений и опыт.
  useEffect(() => {
    if (!run || !current || !sourcesReady || (run.lastTick || today) >= today) return;
    const next = tick(run, rewards, today);
    saveGame(me.uid, next).catch(reportError);
    toast(`Новый день: +${next.interest - (run.interest || 0)} мон. процентов и +${next.xpDaily - (run.xpDaily || 0)} опыта`);
  }, [run, current, today, sourcesReady]);

  if (!run) return <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>;

  const eco = economy(run, rewards);
  const team = teamOf(run);
  const dex = state?.gameDex || {};
  const kids = new Set(giant.kids);
  const pRun = pState?.game?.week === week && Array.isArray(pState.game.front) ? pState.game : null;
  const todayFights = fightsOn(run, today);
  const nextCost = fightCost(todayFights);
  const weekend = isWeekend(today);

  const commit = (res, msg) => {
    if (res.error) { toast(res.error); return null; }
    const seen = {};
    [...res.run.front, ...res.run.back, ...res.run.bench].forEach((u) => { if (u && (dex[u.s] || 0) < u.st) seen[u.s] = Math.max(seen[u.s] || 0, u.st); });
    if (Object.keys(seen).length) {
      saveUserState(me.uid, { gameDex: seen }).catch(reportError);
      Object.entries(seen).forEach(([id, st]) => { if (st > 1) toast(`${BY_ID[id].name} ★${st} — ${formOf(BY_ID[id], st)}!`); });
    }
    setState((s) => ({ ...s, game: res.run, gameDex: { ...(s?.gameDex || {}), ...seen } }));
    saveGame(me.uid, res.run).catch(reportError);
    if (msg) toast(msg);
    return res.run;
  };

  const tapSlot = (where, i) => {
    const u = run[where][i];
    if (sel) {
      if (sel.where === where && sel.i === i) { setSel(null); return; }
      const moving = run[sel.where][sel.i];
      const out = commit(move(run, eco, sel, { where, i }));
      if (out && moving && where !== 'bench' && !fits(BY_ID[moving.s], where)) {
        toast(`${BY_ID[moving.s].name}: место — ${PLACE[placeOf(BY_ID[moving.s])]}. Здесь будет работать на ${MISPLACED * 100}%.`);
      }
      setSel(null);
      return;
    }
    if (u) setSel({ where, i });
  };
  const selUnit = sel ? run[sel.where][sel.i] : null;
  const full = team.length >= eco.slots;
  const canTarget = (where) => sel && (where === 'bench' || sel.where !== 'bench' || !full);

  const raid = () => {
    const front = run.front.filter(Boolean);
    if (!front.length) { toast('Поставь кого-нибудь в строй'); return; }
    if (eco.coins < nextCost) { toast('Не хватает монет на вылазку'); return; }
    const back = run.back.filter(Boolean);
    const seed = `${me.uid}|${today}|${todayFights}`;
    const res = simulateRaid({ front, back }, giant, dIdx, seed);
    const fight = { v: ENGINE_V, day: today, dayIdx: dIdx, n: todayFights, seed, front, back, dmg: res.dmg };
    const next = { ...run, fights: [...(run.fights || []), fight], damage: (run.damage || 0) + res.dmg, spent: run.spent + nextCost };
    commit({ run: next });
    setReplay(fight);
  };

  const xpFrom = LEVEL_XP[eco.level - 1];
  const odds = oddsFor(eco.level);
  const left = Math.max(0, GIANT_HP - (run.damage || 0));
  const down = left === 0;
  const frontN = run.front.filter(Boolean).length;
  const backN = run.back.filter(Boolean).length;
  const fresh = isFresh(run);

  const zone = (where, size, cols, compact) => (
    <div className={`pm-grid c${cols}`}>
      {Array.from({ length: size }, (_, i) => (
        <UnitTile key={i} unit={run[where][i]} row={where === 'bench' ? null : where} compact={compact}
          kid={!!run[where][i] && where !== 'bench' && kids.has(run[where][i].s)}
          selected={sel?.where === where && sel?.i === i}
          target={!run[where][i] && canTarget(where)}
          dim={where !== 'bench' && !run[where][i] && full && !sel}
          onClick={() => tapSlot(where, i)} />
      ))}
    </div>
  );

  return (
    <div className="pm">
      {/* гигант недели */}
      <div className="card pm-giant" style={{ '--el': ELEMENTS[giant.el].color }}>
        <button type="button" className="pm-giant-top" onClick={() => setShowGiant(true)}>
          <GiantEmblem giant={giant} size={60} />
          <div className="pm-giant-name">
            <span className="dim">Гигант недели · {giant.kind}</span>
            <b>{giant.name}</b>
            <span className="pm-giant-weak">
              уязвим: <i className={`fa-solid ${ELEMENTS[giant.weak].icon}`} style={{ color: ELEMENTS[giant.weak].color }} /> {ELEMENTS[giant.weak].name.toLowerCase()}
            </span>
          </div>
          <i className="fa-solid fa-circle-info dim" />
        </button>
        <div className="pm-giant-hp">
          <i style={{ width: `${(left / GIANT_HP) * 100}%` }} />
          {pRun && <s style={{ left: `${Math.max(0, 100 - pct(pRun.damage || 0))}%` }} title={`${partner.name}: ${pct(pRun.damage || 0)}%`} />}
          <span>{down ? 'Повержен!' : `${left.toLocaleString('ru')} / ${GIANT_HP.toLocaleString('ru')}`}</span>
        </div>
        <div className="pm-score">
          <span><Avatar email={me.email} avatar={me.avatar} /> снято {pct(run.damage || 0)}%</span>
          <span className="dim">{DAYS[dIdx]} · день {dIdx + 1}/7</span>
          {partner && <span><Avatar email={partner.email} avatar={partner.avatar} /> {pRun ? `${pct(pRun.damage || 0)}%` : '—'}</span>}
        </div>
      </div>

      <div className="card pm-eco">
        <button type="button" className="pm-coins" onClick={() => setShowIncome(true)}>
          <i className="fa-solid fa-coins" /> {eco.coins}
        </button>
        <div className="pm-level">
          <div className="pm-level-top"><b>Ур. {eco.level} · команда {eco.slots}</b><span>{eco.next ? `${eco.xp}/${eco.next} опыта` : 'макс.'}</span></div>
          <div className="pm-bar"><i style={{ width: eco.next ? `${((eco.xp - xpFrom) / (eco.next - xpFrom)) * 100}%` : '100%' }} /></div>
          <div className="pm-interest">завтра +{interestFor(eco.coins)} мон. процентов</div>
        </div>
      </div>

      <div className="seg" style={{ margin: '14px 0 4px' }}>
        <button className={tab === 'team' ? 'on' : ''} onClick={() => setTab('team')}>Команда</button>
        <button className={tab === 'raid' ? 'on' : ''} onClick={() => setTab('raid')}>Вылазка{todayFights === 0 ? ' •' : ''}</button>
        <button className={tab === 'dex' ? 'on' : ''} onClick={() => setTab('dex')}>Бестиарий</button>
      </div>

      {tab === 'team' && (
        <>
          <div className="section-title pm-row-title"><span>Строй · бьёт гиганта</span><span className="dim">в команде {team.length}/{eco.slots}</span></div>
          {zone('front', FRONT_SIZE, 4)}
          <div className="section-title pm-row-title"><span>Тыл · поддержка</span><span className="dim">{backN}/{BACK_SIZE}</span></div>
          {zone('back', BACK_SIZE, 7, true)}

          <div className="section-title">Связи</div>
          <Bonds units={team} giant={giant} />

          <div className="section-title">Скамейка</div>
          {zone('bench', BENCH_SIZE, 5, true)}

          {selUnit && (
            <div className="pm-actions">
              <span className="pm-actions-name">
                {BY_ID[selUnit.s].name} <Stars n={selUnit.st} />
                <span className="dim"> · место: {PLACE[placeOf(BY_ID[selUnit.s])]}</span>
              </span>
              <button className="btn btn-sm" onClick={() => setDetail({ id: selUnit.s, st: selUnit.st })}>Подробнее</button>
              <button className="btn btn-sm" onClick={() => { commit(sell(run, sel.where, sel.i), `Продано: +${unitCost(selUnit)}`); setSel(null); }}>
                Продать +{unitCost(selUnit)}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>Отмена</button>
            </div>
          )}

          <div className="section-title pm-row-title">
            <span>Лавка{weekend ? ' · выходные' : ''}</span>
            <button type="button" className="pm-link" onClick={() => setShowPack(true)}><i className="fa-solid fa-layer-group" /> набор недели</button>
          </div>
          <div className="pm-odds">
            {['common', 'rare', 'very_rare'].map((rar, i) => <span key={rar} className={`rar-${rar} ${odds[i] ? '' : 'off'}`}>{RARITY[rar].label} {odds[i]}%</span>)}
          </div>
          <div className="pm-shop">
            {run.shop.offers.map((o, i) => {
              if (!o) return <div key={i} className="pm-card sold">куплено</div>;
              const sp = BY_ID[o.s];
              const cost = offerCost(o);
              const owned = [...run.front, ...run.back, ...run.bench].filter((u) => u && u.s === o.s && u.st === o.st).length;
              return (
                <div key={i} className={`pm-card rar-${sp.rar} ${o.st > 1 ? 'star3' : ''}`}>
                  <button type="button" className="pm-card-body" onClick={() => setDetail({ id: o.s, st: o.st })}>
                    <Portrait id={o.s} st={o.st} size={48} />
                    {o.st > 1 && <Stars n={o.st} />}
                    <span className="pm-name">{sp.name}</span>
                    <span className="pm-tags">
                      <i className={`fa-solid ${ELEMENTS[sp.el].icon}`} style={{ color: ELEMENTS[sp.el].color }} />
                      <i className={`fa-solid ${CLASSES[sp.cls].icon}`} />
                      <i className={`fa-solid ${PLACE_ICON[placeOf(sp)]}`} />
                    </span>
                    {!dex[o.s] && <em className="pm-badge new" title="Ещё нет в бестиарии">new</em>}
                    {owned > 0 && <em className="pm-badge" title="Три одинаковых сольются">{owned}/3</em>}
                    {sp.el === giant.weak && !owned && <em className="pm-badge weak" title="Слабость гиганта недели"><i className="fa-solid fa-heart-crack" /></em>}
                  </button>
                  <button className="btn btn-accent btn-sm pm-buy" disabled={eco.coins < cost} onClick={() => commit(buy(run, eco, i))}>
                    <i className="fa-solid fa-coins" /> {cost}
                  </button>
                </div>
              );
            })}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" disabled={eco.coins < REROLL_COST} onClick={() => commit(reroll(run, eco))}>
              <i className="fa-solid fa-rotate" /> Обновить · {REROLL_COST}
            </button>
            <button className="btn" disabled={eco.coins < XP_BUY.cost || !eco.next} onClick={() => commit(buyXp(run, eco), `+${XP_BUY.xp} опыта`)}>
              <i className="fa-solid fa-arrow-up" /> +{XP_BUY.xp} опыта · {XP_BUY.cost}
            </button>
          </div>
          <p className="hint" style={{ marginTop: 10 }}>
            Три одинаковых одной звезды сливаются в одну на звезду выше — до ★6. Зелёные, синие и фиолетовые различаются не только ценой:
            синие на 15%, фиолетовые на 30% сильнее. Какие цвета приходят, зависит от уровня. В субботу и воскресенье лавка может
            сразу предложить ★3 тех видов, что у тебя уже есть на ★3.
          </p>
        </>
      )}

      {tab === 'raid' && (
        <>
          <div className="section-title">Вылазка · {DAYS[dIdx]}</div>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              Строй бьёт гиганта 10 раундов или пока не падёт, тыл поддерживает. На 3-м, 6-м и 9-м раундах каждая особь применяет свой навык.
              Урон копится за неделю.
              {down && <b> Гигант повержен — можно бить дальше ради рекорда.</b>}
            </p>
            <div className="pm-mini">
              {run.front.filter(Boolean).map((u) => <button key={u.u} type="button" onClick={() => setDetail({ id: u.s, st: u.st })}><Portrait id={u.s} st={u.st} size={42} /><Stars n={u.st} /></button>)}
              {backN > 0 && <span className="pm-mini-sep">+ тыл {backN}</span>}
            </div>
            <button className="btn btn-accent btn-block" disabled={!frontN || eco.coins < nextCost} onClick={raid} style={{ marginTop: 12 }}>
              <i className="fa-solid fa-khanda" /> {!frontN ? 'Сначала поставь кого-нибудь в строй' : nextCost ? `Ещё вылазка · ${nextCost} мон.` : 'В вылазку'}
            </button>
            <p className="hint">Первая вылазка дня бесплатная, каждая следующая дороже. Сегодня было: {todayFights}.</p>
          </div>

          {(run.fights || []).length > 0 && (
            <>
              <div className="section-title">Вылазки этой недели</div>
              {[...run.fights].reverse().map((f) => (
                <button key={f.seed} type="button" className="pm-battle" onClick={() => setReplay(f)}>
                  <span>{DAYS[f.dayIdx]}{f.n ? ` · ${f.n + 1}-я` : ''}</span>
                  <span className="dim">{f.front.length + f.back.length} в команде</span>
                  <b>−{f.dmg}</b>
                  <i className="fa-solid fa-play" />
                </button>
              ))}
            </>
          )}

          {(state.gameHistory || []).filter((h) => h.giant).length > 0 && (
            <>
              <div className="section-title">Прошлые гиганты</div>
              {state.gameHistory.filter((h) => h.giant).map((h) => {
                const g = GIANTS.find((x) => x.id === h.giant);
                return (
                  <div key={h.week} className={`pm-battle static ${h.damage >= GIANT_HP ? 'win' : ''}`}>
                    <span>{h.week.slice(8)}.{h.week.slice(5, 7)}</span>
                    <span className="dim">{g?.name}</span>
                    <b>{pct(h.damage)}%</b>
                    <span className="dim">{h.partnerDamage != null ? `${partner?.name}: ${pct(h.partnerDamage)}%` : ''}</span>
                  </div>
                );
              })}
            </>
          )}
        </>
      )}

      {tab === 'dex' && (
        <>
          <div className="section-title">Встречено {Object.keys(dex).length} из {SPECIES.length}</div>
          <div className="seg" style={{ marginBottom: 12, overflowX: 'auto' }}>
            <button className={dexFilter === 'all' ? 'on' : ''} onClick={() => setDexFilter('all')}>Все</button>
            {Object.entries(ELEMENTS).map(([k, e]) => (
              <button key={k} className={dexFilter === k ? 'on' : ''} onClick={() => setDexFilter(k)} aria-label={e.name} title={e.name}>
                <i className={`fa-solid ${e.icon}`} style={{ color: e.color }} />
              </button>
            ))}
          </div>
          <div className="pm-dex">
            {SPECIES.filter((s) => dexFilter === 'all' || s.el === dexFilter).map((s) => {
              const st = dex[s.id];
              return st ? (
                <button key={s.id} type="button" className={`pm-dex-item rar-${s.rar}`} onClick={() => setDetail({ id: s.id, st })}>
                  <Portrait id={s.id} st={st} size={54} />
                  <span className="pm-name">{s.name}</span>
                  <Stars n={st} />
                </button>
              ) : (
                <div key={s.id} className="pm-dex-item unknown"><div className="pm-portrait" style={{ width: 54, height: 54 }}>?</div><span className="pm-name">???</span></div>
              );
            })}
          </div>
        </>
      )}

      {detail && <SpeciesSheet id={detail.id} st={detail.st} onClose={() => setDetail(null)} />}
      {showGiant && <GiantSheet giant={giant} onClose={() => setShowGiant(false)} />}
      {showPack && (
        <PackSheet run={run} giant={giant} dex={dex} canRepack={fresh}
          onRepack={() => { if (commit(repack(run, me.uid), 'Набор переброшен')) setShowPack(false); }}
          onOpen={(id) => setDetail({ id, st: 1 })}
          onClose={() => setShowPack(false)} />
      )}
      {replay && <RaidReplay fight={replay} giant={giant} onClose={() => setReplay(null)} />}

      {showIncome && (
        <Sheet title="Монеты недели" onClose={() => setShowIncome(false)}>
          <div className="stats" style={{ marginTop: 0 }}>
            <div className="stat"><div className="n">{rewards.coins}</div><div className="l">заработано</div></div>
            <div className="stat"><div className="n">{run.interest || 0}</div><div className="l">проценты</div></div>
            <div className="stat"><div className="n">{run.spent || 0}</div><div className="l">потрачено</div></div>
          </div>
          <div className="pm-income"><span><i className="fa-solid fa-list-check" /> Задачи <span className="dim">· {rewards.list.length}</span></span><b><i className="fa-solid fa-coins" /> {rewards.tasks}</b></div>
          <div className="pm-income"><span><i className="fa-solid fa-face-smile" /> Настроение <span className="dim">· {rewards.mood.days} из 7 дней{rewards.mood.pairDays ? `, вместе ${rewards.mood.pairDays}` : ''}</span></span><b><i className="fa-solid fa-coins" /> {rewards.mood.coins}</b></div>
          <div className="pm-income"><span><i className="fa-solid fa-film" /> Мурмур <span className="dim">· {rewards.media.list.length}{rewards.media.episodes ? `, серий ${rewards.media.episodes}` : ''}</span></span><b><i className="fa-solid fa-coins" /> {rewards.media.coins}</b></div>
          <div className="pm-income"><span><i className="fa-solid fa-wallet" /> Бюджет <span className="dim">· {rewards.budget.days} дн.{rewards.budget.receipts ? `, чеков ${rewards.budget.receipts}` : ''}</span></span><b><i className="fa-solid fa-coins" /> {rewards.budget.coins}</b></div>
          <p className="hint">
            Задача — 1 монета, с подзадачами — монета за каждую подзадачу; важная или срочная — ещё +2; закрыта в срок — ещё +1.
            Настроение — 1 за каждый отмеченный день, +1, если отмечена вся неделя, и +2 за день, когда отметились оба.
            Мурмур: фильм или досмотренный сериал — 1, пройденная игра — 10, серия — ½ (за неделю вниз), свой отзыв — ещё +1.
            День, когда что-то внесено в бюджет, — 1; разобранный чек — ещё +1.
            На старте недели — {startCoinsOf(run)} монет. Каждый новый день: проценты с отложенного (+1 за 10, до +5) и +{DAILY_XP} опыта.
            Всё остальное — особи, опыт, перебросы и лишние вылазки — покупается за монеты.
          </p>
          {rewards.list.length === 0 && <div className="empty">На этой неделе задач пока не закрыто.</div>}
          {rewards.list.map((r) => (
            <div key={r.id} className="pm-income">
              <span>{r.title}{r.items ? <span className="dim"> · {r.items} подзадач</span> : null}{r.onTime ? <span className="dim"> · в срок</span> : null}</span>
              <b><i className="fa-solid fa-coins" /> {r.coins}</b>
            </div>
          ))}
          {rewards.media.list.map((r) => (
            <div key={r.id} className="pm-income">
              <span>{r.title}<span className="dim"> · {r.kind === 'game' ? 'пройдено' : 'просмотрено'}{r.review ? ', отзыв' : ''}</span></span>
              <b><i className="fa-solid fa-coins" /> {r.coins}</b>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}
