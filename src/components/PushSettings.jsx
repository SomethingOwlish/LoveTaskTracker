import { useEffect, useState } from 'react';
import { Switch } from './Sheet';
import { pushSupport, currentSubscription, enablePush, disablePush } from '../lib/push';
import { saveUserState } from '../lib/db';
import { reportError, toast } from '../lib/toast';

const DEFAULTS = { events: true, digest: true, deadlines: true, mood: true, digestTime: '09:00', moodTime: '21:00' };

export function PushSettings({ me, prefs: saved }) {
  const support = pushSupport();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const prefs = { ...DEFAULTS, ...(saved || {}) };

  useEffect(() => { currentSubscription().then((s) => setOn(!!s)).catch(() => {}); }, []);

  const set = (patch) => saveUserState(me.uid, {
    push: { ...prefs, ...patch, tz: Intl.DateTimeFormat().resolvedOptions().timeZone },
  }).catch((e) => reportError(e));

  const toggle = async () => {
    setBusy(true);
    try {
      if (on) { await disablePush(); setOn(false); toast('Уведомления на этом устройстве выключены'); }
      else {
        await enablePush(me.uid);
        await set({});
        setOn(true);
        toast('Готово! Уведомления будут приходить на это устройство');
      }
    } catch (e) { reportError(e); }
    setBusy(false);
  };

  return (
    <div className="card push-card">
      {!support.ok ? <p className="hint" style={{ margin: 0 }}>{support.reason}</p> : (
        <>
          <button type="button" className={`btn btn-block ${on ? '' : 'btn-accent'}`} disabled={busy} onClick={toggle}>
            {on ? <><i className="fa-solid fa-bell-slash" /> Выключить на этом устройстве</> : <><i className="fa-solid fa-bell" /> Включить на этом устройстве</>}
          </button>
          {on && (
            <div className="push-prefs">
              <Switch on={prefs.events} onChange={(v) => set({ events: v })} label="Задачи, комментарии и сердечки от партнёра" />
              <div className="push-time">
                <Switch on={prefs.digest} onChange={(v) => set({ digest: v })} label="Утренняя сводка" />
                <input className="input" type="time" value={prefs.digestTime} onChange={(e) => set({ digestTime: e.target.value || '09:00' })} />
              </div>
              <Switch on={prefs.deadlines} onChange={(v) => set({ deadlines: v })} label="За час до дедлайна" />
              <div className="push-time">
                <Switch on={prefs.mood} onChange={(v) => set({ mood: v })} label="Вечером — «как прошёл день?»" />
                <input className="input" type="time" value={prefs.moodTime} onChange={(e) => set({ moodTime: e.target.value || '21:00' })} />
              </div>
              <p className="hint" style={{ margin: 0 }}>Напоминания проверяются каждые 15 минут, поэтому могут приходить с небольшой задержкой.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
