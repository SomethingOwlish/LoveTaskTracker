// Горизонтальный свайп по карточке. Включается только когда палец явно идёт
// вбок (|dx| > |dy|), иначе отдаёт жест прокрутке страницы.
import { useRef, useState } from 'react';

const START = 12;      // с какого сдвига считаем, что это свайп
export const TRIGGER = 90; // с какого сдвига срабатывает действие

export function useSwipe({ onLeft, onRight, enabled = true }) {
  const [dx, setDx] = useState(0);
  const st = useRef(null);
  const swiped = useRef(false);

  const onPointerDown = (e) => {
    if (!enabled || e.pointerType === 'mouse' || e.target.closest('button, a, input')) return;
    st.current = { x: e.clientX, y: e.clientY, active: false, id: e.pointerId };
    swiped.current = false;
  };
  const onPointerMove = (e) => {
    const s = st.current;
    if (!s || s.id !== e.pointerId) return;
    const mx = e.clientX - s.x; const my = e.clientY - s.y;
    if (!s.active) {
      if (Math.abs(my) > START && Math.abs(my) > Math.abs(mx)) { st.current = null; return; } // это прокрутка
      if (Math.abs(mx) < START) return;
      s.active = true;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* палец уже отпущен */ }
    }
    const lim = (v, fn) => (fn ? v : Math.sign(v) * Math.min(Math.abs(v), 24)); // без действия — лёгкое сопротивление
    setDx(mx > 0 ? lim(mx, onRight) : lim(mx, onLeft));
  };
  const finish = () => {
    const s = st.current;
    st.current = null;
    if (!s?.active) { setDx(0); return; }
    swiped.current = true;
    if (dx >= TRIGGER && onRight) onRight();
    else if (dx <= -TRIGGER && onLeft) onLeft();
    setDx(0);
  };
  // клик сразу после свайпа не должен открывать карточку
  const onClickCapture = (e) => { if (swiped.current) { e.stopPropagation(); e.preventDefault(); swiped.current = false; } };

  return { dx, handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onClickCapture } };
}
