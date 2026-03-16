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
}
