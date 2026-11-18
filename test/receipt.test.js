import { describe, it, expect } from 'vitest';
import { parseFiscalQr } from '../src/lib/receipt';

describe('parseFiscalQr', () => {
  it('читает сумму и время из QR чека', () => {
    const r = parseFiscalQr('t=20261115T1832&s=1543.20&fn=7380440700076549&i=41450&fp=2457662398&n=1');
    expect(r.sum).toBe(1543.2);
    const dt = new Date(r.date);
    expect([dt.getFullYear(), dt.getMonth() + 1, dt.getDate(), dt.getHours(), dt.getMinutes()]).toEqual([2026, 11, 15, 18, 32]);
    expect(r.isReturn).toBe(false);
  });
  it('n=2 — возврат', () => {
    expect(parseFiscalQr('t=20261115T1832&s=10.00&fn=1&i=1&fp=1&n=2').isReturn).toBe(true);
  });
  it('секунды в t и запятая в сумме', () => {
    expect(parseFiscalQr('t=20261115T183245&s=99,90&fn=1&i=1&fp=1&n=1').sum).toBe(99.9);
  });
  it('не чек → null', () => {
    expect(parseFiscalQr('https://example.com')).toBeNull();
    expect(parseFiscalQr('')).toBeNull();
    expect(parseFiscalQr(null)).toBeNull();
  });
});
