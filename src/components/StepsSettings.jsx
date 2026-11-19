import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';
import { subscribeStepKeys, subscribeSteps, newStepKey } from '../lib/db';
import { stepCoins } from '../lib/steps';
import { toDate, dayKey as dayStr } from '../lib/util';
import { reportError, toast } from '../lib/toast';

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
// i-й день текущей недели (0 = понедельник) — через setDate, без сбоев на переводе часов
function weekDay(i) {
  const x = new Date();
  x.setHours(12, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7) + i);
  return dayStr(x);
}

async function copy(text, what) {
  try { await navigator.clipboard.writeText(text); toast(`${what} скопирован`); }
  catch { prompt(`Скопируй ${what.toLowerCase()}:`, text); }
}

/* Шаги с iPhone: личный ключ для Быстрых команд, шаги этой недели и инструкция. */
export function StepsSettings({ me }) {
  const [keys, setKeys] = useState(null);
  const [steps, setSteps] = useState([]);
  const [guide, setGuide] = useState(false);
  const [busy, setBusy] = useState(false);
  const week = weekDay(0);
  useEffect(() => subscribeStepKeys(me.uid, setKeys), [me.uid]);
  useEffect(() => subscribeSteps(me.uid, week, weekDay(6), setSteps), [me.uid, week]);

  const key = keys?.[0]?.key || null;
  const url = `${location.origin}/api/steps`;
  const make = async () => {
    if (key && !confirm('Создать новый ключ? Старый перестанет работать — его придётся заменить в команде.')) return;
    setBusy(true);
    try { await newStepKey(me.uid, (keys || []).map((k) => k.key)); } catch (e) { reportError(e); }
    setBusy(false);
  };

  const byDay = Object.fromEntries(steps.map((d) => [d.day, d]));
  const days = WEEKDAYS.map((w, i) => {
    const day = weekDay(i);
    return { w, day, steps: byDay[day]?.steps ?? null };
  });
  const coins = days.reduce((n, d) => n + stepCoins(d.steps || 0), 0);
  const last = steps.map((d) => toDate(d.updatedAt)).filter(Boolean).sort((a, b) => b - a)[0];

  return (
    <div className="card steps-card">
      <div className="steps-week">
        {days.map((d) => (
          <div key={d.day} className={`steps-day ${d.steps >= 5000 ? 'ok' : ''}`}>
            <span className="dim">{d.w}</span>
            <b>{d.steps == null ? '—' : d.steps >= 1000 ? `${Math.round(d.steps / 100) / 10}к` : d.steps}</b>
            {d.steps >= 5000 && <span className="steps-coins">+{stepCoins(d.steps)}</span>}
          </div>
        ))}
      </div>
      <p className="hint" style={{ margin: '8px 0 12px' }}>
        От 5 000 шагов — 5 монет, после 10 000 — +1 за каждую тысячу.
        {coins ? ` На этой неделе: +${coins}.` : ''}
        {last ? ` Последняя отправка: ${last.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}.` : ''}
      </p>
      {keys === null ? null : key ? (
        <div className="row">
          <button type="button" className="btn btn-accent" onClick={() => setGuide(true)}><i className="fa-solid fa-book" /> Инструкция</button>
          <button type="button" className="btn" style={{ flex: 'none' }} onClick={() => copy(key, 'Ключ')}><i className="fa-solid fa-key" /> Ключ</button>
        </div>
      ) : (
        <button type="button" className="btn btn-accent btn-block" disabled={busy} onClick={async () => { await make(); setGuide(true); }}>
          <i className="fa-solid fa-shoe-prints" /> Подключить шаги
        </button>
      )}
      {guide && key && <StepsGuide stepKey={key} url={url} onNewKey={make} busy={busy} onClose={() => setGuide(false)} />}
    </div>
  );
}

function Copy({ value, label }) {
  return (
    <div className="steps-copy">
      <code>{value}</code>
      <button type="button" className="btn btn-sm" onClick={() => copy(value, label)}><i className="fa-regular fa-copy" /></button>
    </div>
  );
}

function StepsGuide({ stepKey, url, onNewKey, busy, onClose }) {
  return (
    <Sheet title="Шаги с iPhone" onClose={onClose}>
      <p className="hint" style={{ marginTop: 0 }}>
        Один раз на телефоне: команда берёт шаги из «Здоровья» и отправляет сюда. Минут 10.
        Названия действий — как в русском iOS, в скобках — английские.
      </p>

      <ol className="steps-guide">
        <li>
          <b>Новая команда.</b> «Команды» → вкладка «Команды» → <b>+</b>. Назови её «Шаги в трекер».
        </li>
        <li>
          <b>«Найти образцы здоровья»</b> (Find Health Samples). Тип — <b>Шаги</b>.
          «Добавить фильтр» → <b>Дата начала</b> — <b>сегодня</b>. «Группировать по» — <b>День</b>
          (так iPhone и часы не посчитаются дважды).
        </li>
        <li>
          <b>«Подсчитать статистику»</b> (Calculate Statistics) → <b>Сумма</b> из «Образцы здоровья».
        </li>
        <li>
          <b>«Получить содержимое URL»</b> (Get Contents of URL). Адрес:
          <Copy value={url} label="Адрес" />
          Разверни «Показать больше»: Метод — <b>POST</b>, Текст запроса — <b>JSON</b>. Добавь два поля:
          <ul>
            <li><b>Текст</b>: ключ <code>key</code>, значение — твой ключ:
              <Copy value={stepKey} label="Ключ" />
            </li>
            <li><b>Число</b>: ключ <code>steps</code>, значение — переменная <b>«Статистика»</b> (из шага 3).</li>
          </ul>
        </li>
        <li>
          <i>Необязательно:</i> <b>«Получить значение словаря»</b> (Get Dictionary Value) — ключ <code>message</code> из
          «Содержимое URL», затем <b>«Показать уведомление»</b> с этим значением. Будет видно «8 532 шагов — +5 мон.».
        </li>
        <li>
          <b>Проверь:</b> нажми ▶. В первый раз iPhone спросит доступ к «Здоровью» — разреши. Шаги появятся в Профиле
          и в доходах игры. Сверь число с приложением «Здоровье».
        </li>
        <li>
          <b>Автозапуск.</b> Вкладка «Автоматизация» → <b>+</b> → <b>«Приложение»</b> → выбери то, что открываешь каждый
          вечер (Telegram, YouTube…) → «Открыто» → <b>«Запускать сразу»</b> → команда «Шаги в трекер».
          <br />Можно добавить ещё <b>«Время суток»</b> → 23:30 → ежедневно → «Запускать сразу».
        </li>
      </ol>

      <div className="card steps-note">
        <p><b>Почему «при открытии приложения», а не только по времени.</b> Пока телефон заблокирован, iOS не даёт
          читать «Здоровье», и ночная команда может отработать вхолостую. Открытие приложения — значит телефон
          разблокирован, и шаги точно прочитаются.</p>
        <p>Запускать можно сколько угодно раз: за день сохраняется наибольшее число, монеты не задвоятся.
          Шаги после последнего запуска до полуночи не попадут — поэтому лучше приложение, которое открываешь поздно.</p>
        <p>Ключ — как пароль от твоих шагов: команду с ним никому не пересылай. Если утёк — сделай новый и вставь в команду.</p>
      </div>

      <button type="button" className="btn btn-ghost btn-block" disabled={busy} onClick={onNewKey} style={{ marginTop: 12 }}>
        <i className="fa-solid fa-rotate" /> Новый ключ
      </button>
    </Sheet>
  );
}
