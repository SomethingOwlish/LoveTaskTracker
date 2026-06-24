import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme.css';
import './styles.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);

// PWA service worker (только в проде, чтобы не мешал dev-серверу).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}
