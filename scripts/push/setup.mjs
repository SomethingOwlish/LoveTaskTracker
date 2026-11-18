// Однократная настройка push-уведомлений. Запуск из корня репозитория:
//
//   cd scripts/push && npm install && node setup.mjs ~/Downloads/<сервисный-ключ>.json
//
// Что делает:
//  1. создаёт пару VAPID-ключей (ими подписываются уведомления);
//  2. кладёт публичный ключ в Firestore pushConfig/vapid — его берёт приложение;
//  3. записывает секреты репозитория для GitHub Actions через gh CLI:
//     FIREBASE_SERVICE_ACCOUNT, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY.
// Сам ключ никуда, кроме секретов GitHub, не уходит. Файл ключа после этого
// лучше удалить из «Загрузок».
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import admin from 'firebase-admin';
import webpush from 'web-push';

const file = process.argv[2];
if (!file) { console.error('Укажи путь к JSON сервисного ключа: node setup.mjs ~/Downloads/key.json'); process.exit(1); }
const saText = readFileSync(file, 'utf8');
const sa = JSON.parse(saText);
if (sa.project_id !== 'tasktrackergando') { console.error(`Это ключ проекта ${sa.project_id}, а нужен tasktrackergando`); process.exit(1); }

const repo = 'SomethingOwlish/LoveTaskTracker';
const setSecret = (name, value) => execFileSync('gh', ['secret', 'set', name, '--repo', repo], { input: value, stdio: ['pipe', 'inherit', 'inherit'] });

const keys = webpush.generateVAPIDKeys();
admin.initializeApp({ credential: admin.credential.cert(sa) });
await admin.firestore().doc('pushConfig/vapid').set({ publicKey: keys.publicKey, updatedAt: Date.now() });
console.log('✓ публичный ключ записан в Firestore');

setSecret('FIREBASE_SERVICE_ACCOUNT', saText);
setSecret('VAPID_PRIVATE_KEY', keys.privateKey);
setSecret('VAPID_PUBLIC_KEY', keys.publicKey);
console.log('✓ секреты записаны в GitHub. Теперь в приложении: Профиль → «Уведомления на телефон» → Включить.');
console.log('  (если включали раньше — выключи и включи заново: ключи сменились)');
process.exit(0);
