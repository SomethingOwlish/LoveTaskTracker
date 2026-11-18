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

describe('сербский QR (suf.purs.gov.rs)', () => {
  // Собираем vl по описанной структуре: сумма 1543,20 дин., время 2026-11-15 18:32 UTC
  const make = (amount, ts, tsLittle = false) => {
    const b = new Uint8Array(60);
    const v = new DataView(b.buffer);
    v.setUint8(0, 3);
    b.set(new TextEncoder().encode('ABCD1234'), 1);
    b.set(new TextEncoder().encode('ABCD1234'), 9);
    v.setUint32(17, 100, true); v.setUint32(21, 90, true);
    v.setBigUint64(25, BigInt(Math.round(amount * 10000)), true);
    v.setBigUint64(33, BigInt(ts), tsLittle);
    const vl = btoa(String.fromCharCode(...b));
    return `https://suf.purs.gov.rs/v/?vl=${encodeURIComponent(vl)}`;
  };
  const ts = Date.UTC(2026, 10, 15, 18, 32);
  it('читает сумму в динарах и время', () => {
    const r = parseFiscalQr(make(1543.2, ts));
    expect(r.sum).toBe(1543.2);
    expect(r.currency).toBe('RSD');
    expect(new Date(r.date).getTime()).toBe(ts);
  });
  it('время в обратном порядке байт тоже понимает', () => {
    expect(new Date(parseFiscalQr(make(99, ts, true)).date).getTime()).toBe(ts);
  });
  it('мусор вместо vl → null', () => {
    expect(parseFiscalQr('https://suf.purs.gov.rs/v/?vl=abc')).toBeNull();
  });
});
