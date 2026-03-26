import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App, { AppErrorBoundary } from './App.jsx';
import './App.css';

// ── Sentry crash reporting ──────────────────────────────────────────────────
const SENTRY_DSN = import.meta.env.VITE_SENTRY_DSN;
if (SENTRY_DSN) {
  const isNative = window.Capacitor?.isNativePlatform?.();
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: `scicp-mobile@${import.meta.env.VITE_APP_VERSION || 'dev'}`,
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.05,
    replaysOnErrorSampleRate: 0.5,
    initialScope: {
      tags: {
        platform: isNative ? (window.Capacitor?.getPlatform?.() || 'native') : 'web',
      },
    },
  });
}

const root = document.getElementById('root');

try {
  createRoot(root).render(
    <StrictMode>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </StrictMode>,
  );
} catch (err) {
  Sentry.captureException(err);
  root.innerHTML = `<div style="padding:24px;color:#c9a84c;font-family:sans-serif">
    <h2>⚠️ Startup Error</h2>
    <pre style="white-space:pre-wrap;color:#f0ece0;font-size:13px">${String(err?.stack || err)}</pre>
  </div>`;
}

// Catch unhandled promise rejections
window.addEventListener('unhandledrejection', (e) => {
  console.error('[scicp] Unhandled rejection:', e.reason);
});

// Catch unhandled errors that crash after mount
window.addEventListener('error', (e) => {
  if (root && !root.children.length) {
    root.innerHTML = `<div style="padding:24px;color:#c9a84c;font-family:sans-serif">
      <h2>⚠️ Runtime Error</h2>
      <pre style="white-space:pre-wrap;color:#f0ece0;font-size:13px">${String(e.error?.stack || e.message)}</pre>
    </div>`;
  }
});
