import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Register service worker for PWA installability + asset caching
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (newWorker) {
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              const banner = document.createElement('div');
              banner.id = 'sw-update-banner';
              banner.innerHTML = 'New version available. <button onclick="window.location.reload()">Refresh</button>';
              banner.style.cssText = 'position:fixed;bottom:0;left:0;right:0;background:#2a6e4a;color:#f0ece0;padding:10px 16px;text-align:center;z-index:9999;font-size:14px;';
              banner.querySelector('button').style.cssText = 'margin-left:12px;background:#c9a84c;color:#1a1a1a;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:700;';
              document.body.appendChild(banner);
            }
          });
        }
      });
    }).catch(() => { /* SW is optional */ });
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
