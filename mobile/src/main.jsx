import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './App.css';

const root = document.getElementById('root');

try {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
} catch (err) {
  root.innerHTML = `<div style="padding:24px;color:#c9a84c;font-family:sans-serif">
    <h2>⚠️ Startup Error</h2>
    <pre style="white-space:pre-wrap;color:#f0ece0;font-size:13px">${String(err?.stack || err)}</pre>
  </div>`;
}

// Catch unhandled errors that crash after mount
window.addEventListener('error', (e) => {
  if (root && !root.children.length) {
    root.innerHTML = `<div style="padding:24px;color:#c9a84c;font-family:sans-serif">
      <h2>⚠️ Runtime Error</h2>
      <pre style="white-space:pre-wrap;color:#f0ece0;font-size:13px">${String(e.error?.stack || e.message)}</pre>
    </div>`;
  }
});
