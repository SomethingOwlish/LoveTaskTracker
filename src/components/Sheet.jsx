import { useEffect } from 'react';

// Блокируем прокрутку страницы под открытой шторкой (на iOS иначе
// фон «уезжает» вместе с пальцем). Счётчик — на случай вложенных шторок.
let locks = 0;
export function useBodyLock() {
  useEffect(() => {
    locks += 1;
    document.body.classList.add('no-scroll');
    return () => {
      locks -= 1;
      if (locks <= 0) { locks = 0; document.body.classList.remove('no-scroll'); }
    };
  }, []);
}

// Нижняя шторка: заголовок с крестиком сверху, липкая панель действий снизу.
export function Sheet({ title, onClose, children, footer, className = '' }) {
  useBodyLock();
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      <div className={`sheet ${className}`} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="close" onClick={onClose} aria-label="Закрыть">×</button>
        </div>
        {children}
        {footer && <div className="sheet-foot">{footer}</div>}
      </div>
    </div>
  );
}

export function Switch({ on, onChange, label }) {
  return (
    <button type="button" className={`switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="track"><span className="knob" /></span>
      <span>{label}</span>
    </button>
  );
}

// Сегмент-переключатель: [[key, label], ...]
export function Seg({ value, onChange, options, className = '' }) {
  return (
    <div className={`seg ${className}`}>
      {options.map(([k, l]) => (
        <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

// Состояние, которое переживает перезапуск приложения (выбранные вкладки и т.п.)
export function loadPref(key, def) {
  try { const v = localStorage.getItem('pref:' + key); return v == null ? def : JSON.parse(v); } catch { return def; }
}
export function savePref(key, v) {
  try { localStorage.setItem('pref:' + key, JSON.stringify(v)); } catch { /* приватный режим */ }
}
