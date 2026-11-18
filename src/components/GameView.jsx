import { useEffect, useMemo, useRef, useState } from 'react';
import { subscribeUserState, saveGame, saveUserState } from '../lib/db';
import { toast, reportError } from '../lib/toast';
import { Sheet } from './Sheet';
import { Avatar } from './Avatar';
import {
  SPECIES, BY_ID, ELEMENTS, CLASSES, RARITY, BENCH_SIZE, MAX_SQUAD, REROLL_COST, XP_BUY, WIN_COINS, LOSS_COINS,
  LEVEL_XP, newRun, economy, rewardsFor, ensureShop, buy, sell, move, reroll, buyXp, squadOf, synergies,
  simulate, wildSquad, runScore, battleHp, ENGINE_V, weekKey, weekStart, dayStr, dayIndex, unitCost, oddsFor,
} from '../game/engine';

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const STARS = (n) => '★'.repeat(n);

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

function UnitTile({ unit, locked, selected, onClick, label }) {
  if (locked) {
    return (
      <button type="button" className="pm-slot locked" onClick={onClick}>
        <i className="fa-solid fa-lock" />
        <span className="pm-lbl">{label}</span>
      </button>
    );
  }
  if (!unit) {
    return <button type="button" className={`pm-slot empty ${selected ? 'target' : ''}`} onClick={onClick} aria-label="Пустое место" />;
  }
  const sp = BY_ID[unit.s];
  return (
    <button type="button" className={`pm-slot ${selected ? 'sel' : ''} rar-${sp.rar}`} onClick={onClick}>
      <Portrait id={unit.s} st={unit.st} size={52} />
      <span className="pm-stars">{STARS(unit.st)}</span>
      <span className="pm-name">{sp.name}</span>
      <span className="pm-tags">
        <i className={`fa-solid ${ELEMENTS[sp.el].icon}`} style={{ color: ELEMENTS[sp.el].color }} />
        <i className={`fa-solid ${CLASSES[sp.cls].icon}`} />
      </span>
    </button>
  );
}

function Synergies({ units }) {
  const { el, cl } = synergies(units);
  const items = [
    ...Object.entries(el).map(([k, n]) => ({ k, n, on: n >= 2, icon: ELEMENTS[k].icon, color: ELEMENTS[k].color, name: ELEMENTS[k].name, tip: n >= 4 ? ELEMENTS[k].b4 : ELEMENTS[k].b2, max: 4 })),
    ...Object.entries(cl).map(([k, n]) => ({ k, n, on: n >= 2, icon: CLASSES[k].icon, name: CLASSES[k].name, tip: CLASSES[k].syn, max: 2 })),
  ].sort((a, b) => b.on - a.on || b.n - a.n);
  if (!items.length) return null;
  return (
    <div className="pm-syn">
      {items.map((x) => (
        <span key={x.k} className={`pm-chip ${x.on ? 'on' : ''}`} title={x.tip}>
          <i className={`fa-solid ${x.icon}`} style={x.color ? { color: x.color } : undefined} /> {x.name} {x.n}
          {x.on && <em>{x.tip}</em>}
        </span>
      ))}
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

function SpeciesSheet({ id, st = 1, onClose, footer }) {
  const sp = BY_ID[id];
  const [view, setView] = useState(st);
  const el = ELEMENTS[sp.el];
  const cl = CLASSES[sp.cls];
  return (
    <Sheet title={sp.name} onClose={onClose} footer={footer}>
      <div className="pm-detail">
        <div className="pm-hero" style={{ '--el': el.color }}>
          <Portrait id={id} st={view} size={140} />
        </div>
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
          <span><i className={`fa-solid ${cl.icon}`} /> {cl.name} — {cl.role.toLowerCase()}</span>
          <span><i className="fa-regular fa-gem" /> {RARITY[sp.rar].name}, {RARITY[sp.rar].cost} мон.</span>
          {sp.weak && <span><i className="fa-solid fa-heart-crack" /> слабость: {ELEMENTS[sp.weak].name.toLowerCase()}</span>}
          {sp.home && <span><i className="fa-solid fa-location-dot" /> {sp.home}</span>}
          <span className="dim">{sp.form}</span>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- Повтор боя ---------- */

function BattleReplay({ record, meName, oppName, onClose }) {
  const res = useMemo(() => simulate(record.a, record.b, record.seed), [record]);
  const [k, setK] = useState(0);
  const last = res.frames.length - 1;
  useEffect(() => {
    if (k >= last) return;
    const t = setTimeout(() => setK((x) => x + 1), res.frames[k].kind === 'round' ? 350 : 650);
    return () => clearTimeout(t);
  }, [k, last, res]);
  const fr = res.frames[k];
  const logRef = useRef(null);
  useEffect(() => { logRef.current?.scrollTo({ top: 1e6 }); }, [k]);

  const row = (squad, side) => (
    <div className="pm-arena-row">
      {squad.map((u, i) => {
        const sp = BY_ID[u.s];
        const [hp, shield, stun] = fr.hp[side][i];
        const max = res.frames[0].hp[side][i][0];
        const isActor = fr.actor?.[0] === side && fr.actor?.[1] === i;
        const isTarget = fr.target?.[0] === side && fr.target?.[1] === i;
        return (
          <div key={u.u || i} className={`pm-fighter ${hp <= 0 ? 'down' : ''} ${isActor ? 'act' : ''} ${isTarget ? 'hit ' + (fr.kind || '') : ''}`}>
            <Portrait id={u.s} st={u.st} size={48} />
            <div className="pm-hp"><i style={{ width: `${Math.max(0, (hp / max) * 100)}%` }} />{shield > 0 && <s style={{ width: `${Math.min(100, (shield / max) * 100)}%` }} />}</div>
            <span className="pm-fname">{sp.name}{stun ? ' 💫' : ''}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <Sheet
      title={record.final ? 'Финал недели' : `Бой · ${DAYS[record.dayIdx]}`}
      onClose={onClose}
      footer={k < last
        ? <button className="btn btn-block" onClick={() => setK(last)}>Пропустить</button>
        : <button className="btn btn-accent btn-block" onClick={onClose}>{res.winner === 0 ? 'Победа!' : res.winner === 1 ? 'Поражение' : 'Ничья'} — закрыть</button>}
    >
      <div className="pm-arena">
        <div className="pm-side-name">{oppName}</div>
        {row(record.b, 1)}
        <div className="pm-vs">VS</div>
        {row(record.a, 0)}
        <div className="pm-side-name">{meName}</div>
      </div>
      {(record.v || 0) !== ENGINE_V && <p className="hint">Правила боя с тех пор поменялись — повтор может отличаться от записанного итога.</p>}
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

  const [state, setState] = useState(null);       // мой userState
  const [pState, setPState] = useState(null);     // партнёра
  const [sel, setSel] = useState(null);           // {where, i}
  const [detail, setDetail] = useState(null);     // {id, st, from?}
  const [replay, setReplay] = useState(null);
  const [tab, setTab] = useState('squad');
  const [showIncome, setShowIncome] = useState(false);
  const [dexFilter, setDexFilter] = useState('all');

  useEffect(() => subscribeUserState(me.uid, (st) => setState(st)), [me.uid]);
  useEffect(() => (partner ? subscribeUserState(partner.uid, (st) => setPState(st)) : undefined), [partner?.uid]);

  const rewards = useMemo(() => rewardsFor(tasks, me.uid, weekStart()), [tasks, me.uid]);
  const pRewards = useMemo(() => (partner ? rewardsFor(tasks, partner.uid, weekStart()) : { coins: 0, xp: 0 }), [tasks, partner?.uid]);

  // Ран текущей недели. Прошлая неделя уходит в историю при первом заходе.
  const stored = state?.game;
  const run = useMemo(() => {
    if (!state) return null;
    const base = stored?.week === week ? stored : newRun(week);
    const eco = economy(base, rewards);
    return ensureShop(base, me.uid, today, eco.level);
  }, [state, stored, week, today, rewards, me.uid]);

  useEffect(() => {
    if (!state || !stored || stored.week === week) return;
    const s = runScore(stored);
    const pRun = pState?.game?.week === stored.week ? pState.game : null;
    const entry = { week: stored.week, ...s, partnerPoints: pRun ? runScore(pRun).points : null };
    const history = [entry, ...(state.gameHistory || []).filter((h) => h.week !== stored.week)].slice(0, 30);
    saveUserState(me.uid, { gameHistory: history }).catch(reportError);
    saveGame(me.uid, newRun(week)).catch(reportError);
  }, [state, stored, week]);

  if (!run) return <div className="empty"><i className="fa-solid fa-spinner fa-spin" /></div>;

  const eco = economy(run, rewards);
  const squad = squadOf(run, eco.slots);
  const dex = state?.gameDex || {};

  const pRunRaw = pState?.game?.week === week ? pState.game : null;
  const pEco = pRunRaw ? economy(pRunRaw, pRewards) : null;
  const pSquad = pRunRaw ? squadOf(pRunRaw, pEco.slots) : [];

  const commit = (res, msg) => {
    if (res.error) { toast(res.error); return null; }
    // свежие виды и звёзды — в бестиарий навсегда
    const seen = {};
    [...res.run.squad, ...res.run.bench].forEach((u) => { if (u && (dex[u.s] || 0) < u.st) seen[u.s] = Math.max(seen[u.s] || 0, u.st); });
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
    // закрытое место: занятое (уровень упал) можно только освободить
    const locked = where === 'squad' && i >= eco.slots;
    if (locked && (!u || sel)) { toast(`Место откроется на уровне ${i}`); return; }
    if (sel) {
      if (sel.where === where && sel.i === i) { setSel(null); return; }
      commit(move(run, eco, sel, { where, i }));
      setSel(null);
      return;
    }
    if (u) setSel({ where, i });
  };

  const selUnit = sel ? run[sel.where][sel.i] : null;

  const fight = () => {
    if (run.battles?.[today]) return;
    const vsPartner = pSquad.length > 0;
    const b = vsPartner ? pSquad : wildSquad(`${week}|${today}|wild`, dIdx);
    const seed = `${me.uid}|${today}`;
    const res = simulate(squad, b, seed);
    const result = res.winner === 0 ? 'win' : res.winner === 1 ? 'loss' : 'draw';
    const record = { v: ENGINE_V, day: today, dayIdx: dIdx, final: dIdx === 6, opp: vsPartner ? 'partner' : 'wild', a: squad, b, seed, result };
    const next = { ...run, battles: { ...run.battles, [today]: record }, bonus: (run.bonus || 0) + (result === 'win' ? WIN_COINS : LOSS_COINS) };
    commit({ run: next });
    setReplay(record);
  };

  const score = runScore(run);
  const pScore = pRunRaw ? runScore(pRunRaw) : null;
  const xpFrom = LEVEL_XP[eco.level - 1];
  const odds = oddsFor(eco.level);

  return (
    <div className="pm">
      {/* шапка рана */}
      <div className="card pm-head">
        <div className="pm-week">
          {DAYS.map((d, i) => {
            const b = run.battles?.[dayStr(new Date(weekStart().getTime() + i * 864e5 + 3 * 36e5))];
            return (
              <span key={d} className={`pm-day ${i === dIdx ? 'now' : ''} ${b ? b.result : ''} ${i === 6 ? 'final' : ''}`} title={i === 6 ? 'Финал: победа = 2 очка' : ''}>
                {i === 6 ? <i className="fa-solid fa-crown" /> : d}
              </span>
            );
          })}
        </div>
        <div className="pm-eco">
          <button type="button" className="pm-coins" onClick={() => setShowIncome(true)}>
            <i className="fa-solid fa-coins" /> {eco.coins}
          </button>
          <div className="pm-level">
            <div className="pm-level-top"><b>Ур. {eco.level}</b><span>{eco.next ? `${eco.xp} / ${eco.next} опыта` : 'максимум'}</span></div>
            <div className="pm-bar"><i style={{ width: eco.next ? `${((eco.xp - xpFrom) / (eco.next - xpFrom)) * 100}%` : '100%' }} /></div>
          </div>
        </div>
        <div className="pm-score">
          <span><Avatar email={me.email} avatar={me.avatar} /> {score.points} очк.</span>
          <span className="dim">неделя {score.wins}–{score.losses}</span>
          {partner && <span><Avatar email={partner.email} avatar={partner.avatar} /> {pScore ? pScore.points : 0} очк.</span>}
        </div>
      </div>

      <div className="seg" style={{ margin: '14px 0 4px' }}>
        <button className={tab === 'squad' ? 'on' : ''} onClick={() => setTab('squad')}>Отряд</button>
        <button className={tab === 'fight' ? 'on' : ''} onClick={() => setTab('fight')}>Бой{!run.battles?.[today] ? ' •' : ''}</button>
        <button className={tab === 'dex' ? 'on' : ''} onClick={() => setTab('dex')}>Бестиарий</button>
      </div>

      {tab === 'squad' && (
        <>
          <div className="section-title">Отряд · {squad.length}/{eco.slots}</div>
          <div className="pm-grid four">
            {Array.from({ length: MAX_SQUAD }, (_, i) => (
              <UnitTile key={i} unit={run.squad[i]} locked={i >= eco.slots && !run.squad[i]} label={`ур. ${i}`}
                selected={sel && (sel.where === 'squad' && sel.i === i ? true : !run.squad[i] && i < eco.slots)}
                onClick={() => tapSlot('squad', i)} />
            ))}
          </div>
          <Synergies units={squad} />

          <div className="section-title">Скамейка</div>
          <div className="pm-grid six">
            {Array.from({ length: BENCH_SIZE }, (_, i) => (
              <UnitTile key={i} unit={run.bench[i]}
                selected={sel && (sel.where === 'bench' && sel.i === i ? true : !run.bench[i])}
                onClick={() => tapSlot('bench', i)} />
            ))}
          </div>

          {selUnit && (
            <div className="pm-actions">
              <span className="pm-actions-name">{BY_ID[selUnit.s].name} {STARS(selUnit.st)}</span>
              <button className="btn btn-sm" onClick={() => setDetail({ id: selUnit.s, st: selUnit.st })}>Подробнее</button>
              <button className="btn btn-sm" onClick={() => { commit(sell(run, sel.where, sel.i), `Продано: +${unitCost(selUnit)}`); setSel(null); }}>
                Продать +{unitCost(selUnit)}
              </button>
              <span className="hint">или нажми на другое место, чтобы переставить</span>
            </div>
          )}

          <div className="section-title pm-shop-title">
            <span>Лавка</span>
            <span className="dim">шансы: {odds[0]}% · {odds[1]}% · {odds[2]}%</span>
          </div>
          <div className="pm-shop">
            {run.shop.ids.map((id, i) => {
              if (!id) return <div key={i} className="pm-card sold">куплено</div>;
              const sp = BY_ID[id];
              const cost = RARITY[sp.rar].cost;
              const owned = [...run.squad, ...run.bench].filter((u) => u && u.s === id && u.st === 1).length;
              return (
                <div key={i} className={`pm-card rar-${sp.rar}`}>
                  <button type="button" className="pm-card-body" onClick={() => setDetail({ id, st: 1 })}>
                    <Portrait id={id} size={58} />
                    <span className="pm-name">{sp.name}</span>
                    <span className="pm-tags">
                      <i className={`fa-solid ${ELEMENTS[sp.el].icon}`} style={{ color: ELEMENTS[sp.el].color }} />
                      <i className={`fa-solid ${CLASSES[sp.cls].icon}`} />
                    </span>
                    {!dex[id] && <em className="pm-badge new" title="Ещё нет в бестиарии">new</em>}
                    {owned > 0 && <em className="pm-badge" title="Есть у тебя — три сольются">{owned}/3</em>}
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
          </p>
        </>
      )}

      {tab === 'fight' && (
        <>
          <div className="section-title">{dIdx === 6 ? 'Финал недели · победа = 2 очка' : `Бой дня · ${DAYS[dIdx]}`}</div>
          <div className="card">
            {run.battles?.[today] ? (
              <>
                <p style={{ marginTop: 0 }}>Сегодня бой уже был: <b>{{ win: 'победа', loss: 'поражение', draw: 'ничья' }[run.battles[today].result]}</b>. Следующий — завтра.</p>
                <button className="btn btn-block" onClick={() => setReplay(run.battles[today])}><i className="fa-solid fa-play" /> Смотреть повтор</button>
              </>
            ) : (
              <>
                <p style={{ marginTop: 0 }}>
                  {pSquad.length
                    ? <>Соперник — {partner.name}: его отряд таким, каким он стоит прямо сейчас.</>
                    : <>{partner?.name || 'Партнёр'} ещё не собрал(а) отряд — выйдет дикая стая.</>}
                </p>
                <div className="pm-mini">
                  {(pSquad.length ? pSquad : wildSquad(`${week}|${today}|wild`, dIdx)).map((u, i) => (
                    <button key={i} type="button" onClick={() => setDetail({ id: u.s, st: u.st })}><Portrait id={u.s} st={u.st} size={44} /><span>{STARS(u.st)}</span></button>
                  ))}
                </div>
                <button className="btn btn-accent btn-block" disabled={!squad.length} onClick={fight} style={{ marginTop: 12 }}>
                  <i className="fa-solid fa-khanda" /> {squad.length ? 'В бой' : 'Сначала собери отряд'}
                </button>
                <p className="hint">Победа: +{WIN_COINS} монеты, поражение: +{LOSS_COINS}. Один бой в день.</p>
              </>
            )}
          </div>

          {Object.values(run.battles || {}).length > 0 && (
            <>
              <div className="section-title">Бои этой недели</div>
              {Object.values(run.battles).sort((a, b) => b.day.localeCompare(a.day)).map((b) => (
                <button key={b.day} type="button" className={`pm-battle ${b.result}`} onClick={() => setReplay(b)}>
                  <span>{DAYS[b.dayIdx]}{b.final ? ' · финал' : ''}</span>
                  <span className="dim">{b.opp === 'partner' ? `против ${partner?.name}` : 'дикая стая'}</span>
                  <b>{{ win: 'победа', loss: 'поражение', draw: 'ничья' }[b.result]}</b>
                  <i className="fa-solid fa-play" />
                </button>
              ))}
            </>
          )}

          {(state.gameHistory || []).length > 0 && (
            <>
              <div className="section-title">Прошлые раны</div>
              {state.gameHistory.map((h) => (
                <div key={h.week} className="pm-battle static">
                  <span>с {h.week.slice(8)}.{h.week.slice(5, 7)}</span>
                  <span className="dim">{h.wins}–{h.losses}</span>
                  <b>{h.points} очк.{h.partnerPoints != null ? ` : ${h.partnerPoints}` : ''}</b>
                  {h.partnerPoints != null && <i className={`fa-solid ${h.points > h.partnerPoints ? 'fa-crown' : h.points === h.partnerPoints ? 'fa-handshake' : 'fa-feather'}`} />}
                </div>
              ))}
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

      {detail && (
        <SpeciesSheet id={detail.id} st={detail.st} onClose={() => setDetail(null)} />
      )}

      {replay && (
        <BattleReplay record={replay} meName={me.name} oppName={replay.opp === 'partner' ? partner?.name : 'Дикая стая'} onClose={() => setReplay(null)} />
      )}

      {showIncome && (
        <Sheet title="Доход недели" onClose={() => setShowIncome(false)}>
          <div className="stats" style={{ marginTop: 0 }}>
            <div className="stat"><div className="n">{rewards.coins}</div><div className="l">монет за задачи</div></div>
            <div className="stat"><div className="n">{run.bonus || 0}</div><div className="l">за бои</div></div>
            <div className="stat"><div className="n">{rewards.xp}</div><div className="l">опыта</div></div>
          </div>
          <p className="hint">
            Каждая закрытая задача — 2 монеты, срочная +1, за каждые два пункта чеклиста +1 (до +3).
            Важная задача ещё и даёт опыт, равный её важности. В начале рана — 6 монет. Ран длится неделю, с понедельника.
          </p>
          {rewards.list.length === 0 && <div className="empty">На этой неделе задач пока не закрыто.</div>}
          {rewards.list.map((r) => (
            <div key={r.id} className="pm-income">
              <span>{r.title}</span>
              <b><i className="fa-solid fa-coins" /> {r.coins}{r.xp ? <> · <i className="fa-solid fa-arrow-up" /> {r.xp}</> : null}</b>
            </div>
          ))}
        </Sheet>
      )}
    </div>
  );
}
