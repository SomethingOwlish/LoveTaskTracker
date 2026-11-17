import { useEffect, useState } from 'react';
import { onToast } from '../lib/toast';

export function Toasts() {
  const [list, setList] = useState([]);
  useEffect(() => onToast((t) => {
    setList((p) => [...p.slice(-2), t]);
    setTimeout(() => setList((p) => p.filter((x) => x.id !== t.id)), t.ms);
  }), []);
  const close = (id) => setList((p) => p.filter((x) => x.id !== id));
  if (!list.length) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button type="button" className="toast-btn" onClick={() => { t.action.fn(); close(t.id); }}>{t.action.label}</button>
          )}
          <button type="button" className="toast-x" onClick={() => close(t.id)} aria-label="Скрыть">×</button>
        </div>
      ))}
    </div>
  );
}

// Полоска «нет сети»: изменения всё равно сохраняются локально и уедут позже.
export function OfflineBar() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (online) return null;
  return <div className="offline-bar"><i className="fa-solid fa-cloud-arrow-up" /> Нет сети — изменения сохранятся и отправятся, когда связь появится.</div>;
}
