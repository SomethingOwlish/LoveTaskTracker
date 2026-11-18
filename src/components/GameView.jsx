import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeUserState, saveGame, saveUserState } from '../lib/db';
import { toast, reportError } from '../lib/toast';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import {
  SPECIES, BY_ID, GIANTS, ELEMENTS, CLASSES, RARITY, FRONT_SIZE, BACK_SIZE, BENCH_SIZE, REROLL_COST, XP_BUY,
  GIANT_HP, LEVEL_XP, EL_STEPS, CL_STEPS, DAILY_XP,
  newRun, economy, rewardsFor, ensureShop, buy, sell, move, reroll, buyXp, teamOf, bonds, tick, interestFor,
  simulateRaid, giantOf, weekKey, weekStart, dayStr, dayIndex, unitCost, oddsFor, battleHp, ENGINE_V,
  fightCost, fightsOn, giantPower,
} from '../game/engine';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const STARS = (n) => '★'.repeat(n);
const pct = (d) => Math.min(100, Math.round((d / GIANT_HP) * 1000) / 10);

/* ---------- Мелкие куски ---------- */

function Portrait({ id, st = 1, size = 56 }) {
  const sp = BY_ID[id];
  const [broken, setBroken] = useState(false);
  const el = ELEMENTS[sp.el];
  return (
    <div className="pm-portrait" style={{ width: size, height: size, '--el': el.color }}>
      {broken
        ? <i className={`fa-solid ${el.icon}`} />
        : <img src={sp.img[st - 1]} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />}
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

function UnitTile({ unit, selected, target, dim, onClick, kid }) {
  if (!unit) {
    return <button type="button" className={`pm-slot empty ${target ? 'target' : ''} ${dim ? 'dim' : ''}`} onClick={onClick} aria-label="Пустое место" />;
  }
  const sp = BY_ID[unit.s];
  return (
    <button type="button" className={`pm-slot ${selected ? 'sel' : ''} rar-${sp.rar}`} onClick={onClick}>
      {kid && <em className="pm-badge kid" title="Дитя гиганта: он его не бьёт, но гнев растёт быстрее">дитя</em>}
      <Portrait id={unit.s} st={unit.st} size={44} />
      <span className="pm-stars">{STARS(unit.st)}</span>
      <span className="pm-name">{sp.name}</span>
      <span className="pm-tags">
        <i className={`fa-solid ${ELEMENTS[sp.el].icon}`} style={{ color: ELEMENTS[sp.el].color }} />
        <i className={`fa-solid ${CLASSES[sp.cls].icon}`} />
      </span>
    </button>
  );
}

function Bonds({ units, giant }) {
  const { el, cl, elTier, clTier } = bonds(units);
  const items = [
    ...Object.entries(el).map(([k, n]) => ({
      k, n, tier: elTier[k], steps: EL_STEPS, icon: ELEMENTS[k].icon, color: ELEMENTS[k].color, name: ELEMENTS[k].name,
      text: elTier[k] ? ELEMENTS[k].tiers[elTier[k] - 1] : `с ${EL_STEPS[0]}: ${ELEMENTS[k].tiers[0]}`, weak: k === giant.weak,
    })),
    ...Object.entries(cl).map(([k, n]) => ({
      k, n, tier: clTier[k], steps: CL_STEPS, icon: CLASSES[k].icon, name: CLASSES[k].name,
      text: clTier[k] ? CLASSES[k].tiers[clTier[k] - 1] : `с ${CL_STEPS[0]}: ${CLASSES[k].tiers[0]}`,
    })),
  ].sort((a, b) => b.tier - a.tier || b.n - a.n);
  if (!items.length) return <p className="hint">Связи появятся, когда в команде будет по две особи одной стихии или класса.</p>;
  const on = items.filter((x) => x.tier);
  const off = items.filter((x) => !x.tier);
  return (
    <div className="pm-bonds">
      {on.map((x) => (
        <div key={x.k} className="pm-bond on">
          <i className={`fa-solid ${x.icon}`} style={x.color ? { color: x.color } : undefined} />
          <b>{x.name}</b>
          <span className="pm-steps">{x.steps.map((s) => <i key={s} className={x.n >= s ? 'on' : ''}>{s}</i>)}</span>
          {x.weak && <em className="pm-weak">слабость гиганта</em>}
          <span className="pm-bond-text">{x.text}</span>
        </div>
      ))}
      {off.length > 0 && (
        <div className="pm-bond-off">
          {off.map((x) => (
            <span key={x.k} className={x.weak ? 'weak' : ''} title={x.text}>
              <i className={`fa-solid ${x.icon}`} style={x.color ? { color: x.color } : undefined} /> {x.n}/{x.steps[0]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function StatRow({ sp, st }) {
  const [atk, def, , spd] = sp.s[st - 1];
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
  return (
    <Sheet title={sp.name} onClose={onClose}>
      <div className="pm-detail">
        <div className="pm-hero"><Portrait id={id} st={view} size={140} /></div>
        <div className="seg" style={{ margin: '12px 0' }}>
          {[1, 2, 3].map((n) => (
            <button key={n} className={view === n ? 'on' : ''} onClick={() => setView(n)}>{STARS(n)}</button>
          ))}
        </div>
        <div className="pm-form-name">{sp.forms[view - 1]}</div>
        <StatRow sp={sp} st={view} />
        <p className="pm-move"><i className="fa-solid fa-burst" /> {sp.moves[view - 1]}</p>
        <div className="pm-facts">
          <span><i className={`fa-solid ${el.icon}`} style={{ color: el.color }} /> {el.name}</span>
          <span><i className={`fa-solid ${cl.icon}`} /> {cl.name}: в строю {cl.front}, в тылу {cl.back}</span>
          <span><i className="fa-regular fa-gem" /> {RARITY[sp.rar].name}, {RARITY[sp.rar].cost} мон.</span>
          {sp.weak && <span><i className="fa-solid fa-heart-crack" /> слабость: {ELEMENTS[sp.weak].name.toLowerCase()}</span>}
          {sp.home && <span><i className="fa-solid fa-location-dot" /> {sp.home}</span>}
          <span className="dim">{sp.form}</span>
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
        <p className="hint">Удары гиганта крепнут к концу недели: сегодня {giantPower(dayIndex())}, в воскресенье {giantPower(6)}. С четверга он бьёт трижды за раунд.</p>
      </div>
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
    const t = setTimeout(() => setK((x) => x + 1), res.frames[k].kind === 'round' ? 300 : 520);
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
          <div key={u.u || i} className={`pm-fighter ${hp <= 0 ? 'down' : ''} ${isActor ? 'act' : ''} ${isTarget ? 'hit ' + (fr.kind || '') : ''} ${wrathHit ? 'hit hurt' : ''}`}>
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
        <div className={`pm-arena-giant ${fr.kind === 'hit' ? 'hit' : ''} ${fr.kind === 'wrath' ? 'wrath' : ''}`}>
          <GiantEmblem giant={giant} size={60} />
          <div className="pm-arena-giant-info">
            <b>{giant.name}</b>
            <span className="pm-dmg">−{fr.dmg}</span>
            <div className="pm-wrath" title="Гнев"><i style={{ width: `${Math.min(100, (fr.wrath / 8) * 100)}%` }} /></div>
          </div>
        </div>
        <div className="pm-side-name">Строй</div>
        {row(fight.front, 'front', 46)}
        {fight.back.length > 0 && <><div className="pm-side-name">Тыл</div>{row(fight.back, 'back', 34)}</>}
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
  const [replay, setReplay] = useState(null);
  const [tab, setTab] = useState('team');
  const [showIncome, setShowIncome] = useState(false);
  const [dexFilter, setDexFilter] = useState('all');

  useEffect(() => subscribeUserState(me.uid, (st) => setState(st)), [me.uid]);
  useEffect(() => (partner ? subscribeUserState(partner.uid, (st) => setPState(st)) : undefined), [partner?.uid]);

  const rewards = useMemo(() => rewardsFor(tasks, me.uid, weekStart()), [tasks, me.uid]);

  const stored = state?.game;
  const current = stored?.week === week && Array.isArray(stored.front); // старый формат (дуэли) не подхватываем
  const run = useMemo(() => {
    if (!state) return null;
    const base = current ? stored : newRun(week, today);
    return ensureShop(base, me.uid, today, economy(base, rewards).level);
  }, [state, stored, current, week, today, rewards, me.uid]);

  // Неделя кончилась — итог в историю, ран с нуля.
  useEffect(() => {
    if (!state || !stored || current) return;
    if (Array.isArray(stored.front)) {
      const pRun = pState?.game?.week === stored.week ? pState.game : null;
      const entry = { week: stored.week, giant: giantOf(stored.week).id, damage: stored.damage || 0, fights: (stored.fights || []).length, partnerDamage: pRun ? pRun.damage || 0 : null };
      const history = [entry, ...(state.gameHistory || []).filter((h) => h.week !== stored.week && h.giant)].slice(0, 30);
      saveUserState(me.uid, { gameHistory: history }).catch(reportError);
    }
    saveGame(me.uid, newRun(week, today)).catch(reportError);
  }, [state, stored, current, week]);

  // Новый день — проценты с накоплений и опыт.
  useEffect(() => {
    if (!run || !current || (run.lastTick || today) >= today) return;
    const next = tick(run, rewards, today);
    saveGame(me.uid, next).catch(reportError);
    toast(`Новый день: +${next.interest - (run.interest || 0)} мон. процентов и +${next.xpDaily - (run.xpDaily || 0)} опыта`);
  }, [run, current, today]);

  if (!run) return <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>;

  const eco = economy(run, rewards);
  const team = teamOf(run);
  const dex = state?.gameDex || {};
  const kids = new Set(giant.kids);
  const pRun = pState?.game?.week === week && Array.isArray(pState.game.front) ? pState.game : null;
  const todayFights = fightsOn(run, today);
  const nextCost = fightCost(todayFights);

  const commit = (res, msg) => {
    if (res.error) { toast(res.error); return null; }
    const seen = {};
    [...res.run.front, ...res.run.back, ...res.run.bench].forEach((u) => { if (u && (dex[u.s] || 0) < u.st) seen[u.s] = Math.max(seen[u.s] || 0, u.st); });
    if (Object.keys(seen).length) {
      saveUserState(me.uid, { gameDex: seen }).catch(reportError);
      Object.entries(seen).forEach(([id, st]) => { if (st > 1) toast(`${BY_ID[id].name} ${STARS(st)} — новая форма: ${BY_ID[id].forms[st - 1]}!`); });
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
      commit(move(run, eco, sel, { where, i }));
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

  const zone = (where, size, cols) => (
    <div className={`pm-grid c${cols}`}>
      {Array.from({ length: size }, (_, i) => (
        <UnitTile key={i} unit={run[where][i]} kid={!!run[where][i] && where !== 'bench' && kids.has(run[where][i].s)}
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
          <div className="section-title pm-row-title"><span>Тыл · поддержка</span></div>
          {zone('back', BACK_SIZE, 6)}

          <div className="section-title">Связи</div>
          <Bonds units={team} giant={giant} />

          <div className="section-title">Скамейка</div>
          {zone('bench', BENCH_SIZE, 4)}

          {selUnit && (
            <div className="pm-actions">
              <span className="pm-actions-name">{BY_ID[selUnit.s].name} {STARS(selUnit.st)}</span>
              <button className="btn btn-sm" onClick={() => setDetail({ id: selUnit.s, st: selUnit.st })}>Подробнее</button>
              <button className="btn btn-sm" onClick={() => { commit(sell(run, sel.where, sel.i), `Продано: +${unitCost(selUnit)}`); setSel(null); }}>
                Продать +{unitCost(selUnit)}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>Отмена</button>
              <span className="hint">нажми на другое место, чтобы переставить</span>
            </div>
          )}

          <div className="section-title pm-row-title">
            <span>Лавка</span>
            <span className="dim">шансы {odds[0]} · {odds[1]} · {odds[2]}%</span>
          </div>
          <div className="pm-shop">
            {run.shop.ids.map((id, i) => {
              if (!id) return <div key={i} className="pm-card sold">куплено</div>;
              const sp = BY_ID[id];
              const cost = RARITY[sp.rar].cost;
              const owned = [...run.front, ...run.back, ...run.bench].filter((u) => u && u.s === id && u.st === 1).length;
              return (
                <div key={i} className={`pm-card rar-${sp.rar}`}>
                  <button type="button" className="pm-card-body" onClick={() => setDetail({ id, st: 1 })}>
                    <Portrait id={id} size={52} />
                    <span className="pm-name">{sp.name}</span>
                    <span className="pm-tags">
                      <i className={`fa-solid ${ELEMENTS[sp.el].icon}`} style={{ color: ELEMENTS[sp.el].color }} />
                      <i className={`fa-solid ${CLASSES[sp.cls].icon}`} />
                    </span>
                    {!dex[id] && <em className="pm-badge new" title="Ещё нет в бестиарии">new</em>}
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
            Три одинаковых одной звезды сливаются в одну на звезду выше. Лавка бесплатно обновляется каждый день.
            Отложенные монеты приносят проценты: +1 за каждые 10, до +5 в день.
          </p>
        </>
      )}

      {tab === 'raid' && (
        <>
          <div className="section-title">Вылазка · {DAYS[dIdx]}</div>
          <div className="card">
            <p style={{ marginTop: 0 }}>
              Строй бьёт гиганта до 10 раундов или пока не падёт, тыл поддерживает. Урон копится за неделю.
              {down && <b> Гигант повержен — можно бить дальше ради рекорда.</b>}
            </p>
            <div className="pm-mini">
              {run.front.filter(Boolean).map((u) => <button key={u.u} type="button" onClick={() => setDetail({ id: u.s, st: u.st })}><Portrait id={u.s} st={u.st} size={42} /><span>{STARS(u.st)}</span></button>)}
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
                    <b>{h.damage >= GIANT_HP ? 'повержен' : `${pct(h.damage)}%`}</b>
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
                  <span className="pm-stars">{STARS(st)}</span>
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
      {replay && <RaidReplay fight={replay} giant={giant} onClose={() => setReplay(null)} />}

      {showIncome && (
        <Sheet title="Монеты недели" onClose={() => setShowIncome(false)}>
          <div className="stats" style={{ marginTop: 0 }}>
            <div className="stat"><div className="n">{rewards.coins}</div><div className="l">за задачи</div></div>
            <div className="stat"><div className="n">{run.interest || 0}</div><div className="l">проценты</div></div>
            <div className="stat"><div className="n">{run.spent || 0}</div><div className="l">потрачено</div></div>
          </div>
          <p className="hint">
            Задача — 2 монеты; важная ещё +1…+3 (половина важности), срочная +1, за каждые два пункта чеклиста +1 (до +3).
            На старте недели — 8 монет. Каждый новый день: проценты с отложенного (+1 за 10, до +5) и +{DAILY_XP} опыта.
            Всё остальное — особи, опыт, перебросы и лишние вылазки — покупается за монеты.
          </p>
          {rewards.list.length === 0 && <div className="empty">На этой неделе задач пока не закрыто.</div>}
          {rewards.list.map((r) => (
            <div key={r.id} className="pm-income">
              <span>{r.title}</span>
              <b><i className="fa-solid fa-coins" /> {r.coins}</b>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}
