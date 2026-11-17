// Обработка фото чека: читаем QR (у российских чеков в нём сумма и время
// покупки), ужимаем картинку, чтобы она поместилась в документ Firestore (<1 МБ).

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Не удалось открыть фото')); };
    img.src = url;
  });
}

function draw(img, maxSide) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  return { c, ctx, w, h };
}

function compress(img, maxSide, maxBytes) {
  const { c } = draw(img, maxSide);
  let q = 0.72;
  let data = c.toDataURL('image/jpeg', q);
  while (data.length * 0.75 > maxBytes && q > 0.3) {
    q -= 0.1;
    data = c.toDataURL('image/jpeg', q);
  }
  if (data.length * 0.75 > maxBytes && maxSide > 800) return compress(img, Math.round(maxSide * 0.75), maxBytes);
  return data;
}

// t=20241117T1530&s=1234.50&fn=...&i=...&fp=...&n=1
export function parseFiscalQr(raw) {
  if (!raw || !/(^|&)t=/.test(raw) || !/(^|&)s=/.test(raw)) return null;
  const p = Object.fromEntries(raw.split('&').map((kv) => { const i = kv.indexOf('='); return [kv.slice(0, i), kv.slice(i + 1)]; }));
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(p.t || '');
  const sum = Number(String(p.s || '').replace(',', '.'));
  if (!m || !Number.isFinite(sum)) return null;
  const date = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return { sum, date: date.toISOString(), isReturn: p.n === '2', raw };
}

async function findQr(img) {
  const { default: jsQR } = await import('jsqr');
  // QR на чеке маленький — пробуем несколько масштабов
  for (const side of [1400, 2000, 1000, 700]) {
    const { ctx, w, h } = draw(img, side);
    const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (code?.data) return code.data;
  }
  return null;
}

export async function processReceiptPhoto(file) {
  const img = await loadImage(file);
  let qr = null;
  try {
    qr = parseFiscalQr(await findQr(img));
  } catch { /* нет QR — не страшно, разберём руками */ }
  const image = compress(img, 1400, 700 * 1024);
  const thumb = compress(img, 220, 20 * 1024);
  return { image, thumb, qr };
}
