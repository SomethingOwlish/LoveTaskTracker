// Монеты за шаги дня — общие для игры (src/game/engine.js), профиля и воркера
// (worker/steps.js): от 5 000 — 5 монет, после 10 000 — +1 за каждую полную тысячу.
export const STEPS_MIN = 5000;
export function stepCoins(n) {
  if (!(n >= STEPS_MIN)) return 0;
  return 5 + Math.max(0, Math.floor((n - 10000) / 1000));
}
