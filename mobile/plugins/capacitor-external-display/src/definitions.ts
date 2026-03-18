/**
 * capacitor-external-display — Capacitor plugin definition
 *
 * Detects external displays (HDMI, Miracast, Chromecast, AirPlay) and
 * renders a WebView on them, pushing data via evaluateJavascript().
 */

export interface ExternalDisplayPlugin {
  /**
   * Check if an external display is currently connected.
   */
  isAvailable(): Promise<{ available: boolean }>;

  /**
   * Open a WebView on the external display showing the given URL.
   */
  startPresentation(options: { url: string }): Promise<void>;

  /**
   * Close the external display WebView.
   */
  stopPresentation(): Promise<void>;

  /**
   * Push a JSON message to the external display WebView.
   * The native side calls evaluateJavascript() to dispatch a
   * 'bridge-message' CustomEvent on the WebView's window.
   */
  sendToDisplay(options: { message: object }): Promise<void>;

  /**
   * Register a listener for display connect/disconnect events.
   * Callback receives { type: 'displayConnected' | 'displayDisconnected' }.
   */
  addListener(
    eventName: 'displayConnected' | 'displayDisconnected',
    listenerFunc: () => void,
  ): Promise<{ remove: () => Promise<void> }>;

  /**
   * Open Android's system cast picker/settings so users can discover devices.
   * Returns opened=false on platforms that don't support it.
   */
  openCastSettings(): Promise<{ opened: boolean }>;

  /**
   * Check current camera permission status natively.
   * Returns 'granted', 'denied', or 'prompt'.
   */
  checkCameraPermission(): Promise<{ status: string }>;

  /**
   * Request camera permission using the native Android/iOS dialog.
   * Returns 'granted' or 'denied'.
   */
  requestCameraPermission(): Promise<{ status: string }>;
}
