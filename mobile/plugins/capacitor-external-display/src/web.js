/**
 * Web fallback — used in dev mode (browser) and platforms without native support.
 * Opens MobileClient in a popup window for testing.
 */
import { WebPlugin } from '@capacitor/core';

export class ExternalDisplayWeb extends WebPlugin {
  constructor() {
    super();
    this._popup = null;
  }

  async isAvailable() {
    // In a browser we check the Web Presentation API; if not supported, allow popup fallback
    if (typeof window !== 'undefined' && typeof window.PresentationRequest === 'function') {
      try {
        const request = new window.PresentationRequest(['about:blank']);
        const avail = await request.getAvailability();
        return { available: !!avail?.value };
      } catch { /* fallback below */ }
    }
    // Popup-based fallback always available in browsers (dev mode)
    return { available: typeof window !== 'undefined' && typeof window.open === 'function' };
  }

  async startPresentation({ url }) {
    if (this._popup && !this._popup.closed) {
      this._popup.focus();
      return;
    }
    this._popup = window.open(
      url,
      'ExternalDisplay',
      'width=1280,height=720,menubar=no,toolbar=no,location=no,status=no'
    );
  }

  async stopPresentation() {
    if (this._popup && !this._popup.closed) {
      this._popup.close();
    }
    this._popup = null;
  }

  async sendToDisplay({ message }) {
    if (this._popup && !this._popup.closed) {
      try {
        this._popup.dispatchEvent(
          new CustomEvent('bridge-message', { detail: message })
        );
      } catch {
        // Cross-origin — use postMessage instead
        this._popup.postMessage({ type: 'bridge-message', payload: message }, '*');
      }
    }
  }

  async openCastSettings() {
    // Browser/dev fallback has no system cast settings; keep API parity.
    return { opened: false };
  }

  async openAppSettings() {
    // No-op in browser; native-only
    return { opened: false };
  }

  async checkCameraPermission() {
    // In browser, check via Permissions API or assume prompt
    if (navigator.permissions) {
      try {
        const result = await navigator.permissions.query({ name: 'camera' });
        return { status: result.state };
      } catch { /* fallback */ }
    }
    return { status: 'prompt' };
  }

  async requestCameraPermission() {
    // In browser, trigger getUserMedia to prompt for permission
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      return { status: 'granted' };
    } catch {
      return { status: 'denied' };
    }
  }

  async acquireWakeLock() {
    // Use Screen Wake Lock API in browser if available
    if ('wakeLock' in navigator) {
      try {
        this._wakeLock = await navigator.wakeLock.request('screen');
      } catch { /* non-fatal */ }
    }
  }

  async releaseWakeLock() {
    if (this._wakeLock) {
      try { await this._wakeLock.release(); } catch { /* ignore */ }
      this._wakeLock = null;
    }
  }
}
