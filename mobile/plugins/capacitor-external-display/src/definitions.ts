/**
 * capacitor-external-display — Capacitor plugin definition
 *
 * Detects external displays (HDMI, Miracast, Chromecast, AirPlay) and
 * renders a WebView on them, pushing data via evaluateJavascript().
 */

export interface ExternalDisplayPlugin {
  /**
   * Check if an external display is currently connected.
   * Returns displayName (e.g. "SAMSUNG TV") on Android when available.
   */
  isAvailable(): Promise<{ available: boolean; displayName?: string }>;

  /**
   * Open a WebView on the external display showing the given URL.
   * Fires 'displayReady' event when the WebView page finishes loading.
   */
  startPresentation(options: { url: string }): Promise<void>;

  /** Close the external display WebView. */
  stopPresentation(): Promise<void>;

  /**
   * Push a JSON message to the external display WebView.
   * The native side calls evaluateJavascript() to dispatch a
   * 'bridge-message' CustomEvent on the WebView's window.
   */
  sendToDisplay(options: { message: object }): Promise<void>;

  /**
   * Register a listener for display events.
   *   displayConnected    — OS-level display appeared
   *   displayDisconnected — display removed
   *   displayReady        — external WebView finished loading; safe to push verse state
   */
  addListener(
    eventName: 'displayConnected' | 'displayDisconnected' | 'displayReady',
    listenerFunc: () => void,
  ): Promise<{ remove: () => Promise<void> }>;

  /**
   * Open Android's cast picker / iOS AirPlay route picker (AVRoutePickerView).
   * Returns opened=false on platforms that don't support it.
   */
  openCastSettings(): Promise<{ opened: boolean }>;

  /**
   * Acquire a screen-bright wake lock on the presenter phone.
   * Prevents screen sleep during a live service. Non-fatal if denied.
   */
  acquireWakeLock(): Promise<void>;

  /** Release the presenter wake lock. */
  releaseWakeLock(): Promise<void>;

  /** Check camera permission: 'granted' | 'denied' | 'prompt'. */
  checkCameraPermission(): Promise<{ status: string }>;

  /** Request camera permission dialog. Returns 'granted' or 'denied'. */
  requestCameraPermission(): Promise<{ status: string }>;

  /**
   * Start a local HTTP server serving client-display.html from APK assets.
   * Last-resort for TV browsers (Roku, Fire TV, webOS, Tizen, Bravia) that
   * navigate to a URL instead of using the Presentation API.
   */
  startLocalServer(options?: { port?: number }): Promise<{ url: string; ip: string; port: number }>;

  /** Stop the local HTTP server. */
  stopLocalServer(): Promise<void>;

  /** Get the current local server URL, or running=false if not started. */
  getLocalServerUrl(): Promise<{ running: boolean; url?: string; ip?: string; port?: number }>;
}
