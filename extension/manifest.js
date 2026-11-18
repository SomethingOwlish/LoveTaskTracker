import { EXTENSION_KEY } from './config.js';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

// manifest.json собирается отсюда при сборке (см. vite.config.js).
export default {
  manifest_version: 3,
  name: 'Совушка & Гусик',
  short_name: 'Совушка & Гусик',
  description: 'Быстрые задачи для таск-трекера на двоих — прямо из браузера.',
  version: pkg.version,
  key: EXTENSION_KEY,
  icons: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  action: {
    default_title: 'Новая задача',
    default_popup: 'popup.html',
    default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
  },
  background: { service_worker: 'background.js', type: 'module' },
  permissions: ['identity', 'storage', 'contextMenus', 'notifications', 'activeTab', 'scripting'],
  commands: {
    _execute_action: {
      suggested_key: { default: 'Ctrl+Shift+Y', mac: 'Command+Shift+Y' },
      description: 'Открыть форму новой задачи',
    },
  },
};
