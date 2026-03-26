/**
 * socket-local.js — Drop-in replacement for Socket.IO on mobile.
 *
 * Mimics the socket.io-client API (emit, on, off, connected) so
 * MobilePresenter.jsx can import { socket } from './socket-local' with
 * minimal changes from the original Presenter.jsx.
 *
 * Instead of network calls, emit() routes everything through the local
 * scripture-service.js (offline sql.js queries) and the native
 * ExternalDisplay plugin (when casting to a TV).
 */
import * as svc from './scripture-service';
import * as remote from './scripture-service-remote';
import { ExternalDisplay } from 'capacitor-external-display';

const listeners = new Map();

function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
}

function off(event, fn) {
  if (!fn) { listeners.delete(event); return; }
  const set = listeners.get(event);
  if (set) { set.delete(fn); if (set.size === 0) listeners.delete(event); }
}

function fire(event, data) {
  const set = listeners.get(event);
  if (set) set.forEach(fn => { try { fn(data); } catch (e) { console.error(`socket-local [${event}]:`, e); } });
}

// Uses the capacitor-external-display plugin when available, falling back
// to a local CustomEvent (for dev/browser testing).
let _presentationActive = false;
let _castMode = null; // 'native' | 'web' | null
let _webConnection = null;
let _displayName = '';
let _reconnectAttempts = 0;
let _reconnectTimer = null;
let _lastClientUrl = null;
const MAX_RECONNECT = 3;
const RECONNECT_DELAY_MS = 2000;

// Track the current verse/theme for re-send after displayReady
let _lastVerse = null;
let _lastTheme = null;

// Called by CastingControl after startCasting to subscribe events
export function onDisplayReady(callback) {
  if (typeof ExternalDisplay.addListener !== 'function') return;
  ExternalDisplay.addListener('displayReady', callback);
}

// M38: Reset casting state if the external display disconnects unexpectedly.
if (typeof ExternalDisplay.addListener === 'function') {
  ExternalDisplay.addListener('displayDisconnected', () => {
    _presentationActive = false;
    console.warn('[scicp] External display disconnected — attempting reconnect');
    _scheduleReconnect();
  });
}

function supportsWebPresentation() {
  return typeof window !== 'undefined' && typeof window.PresentationRequest === 'function';
}

function candidateClientUrls(clientUrl) {
  const urls = new Set();
  // On Capacitor/Android, use http://localhost/ which is intercepted by
  // WebViewAssetLoader — this correctly resolves absolute-path script/css
  // references (e.g. /assets/client-display-xxx.js).  The old file:///
  // android_asset/ path caused blank pages because absolute /assets/ URLs
  // resolved to file:///assets/ which doesn't exist.
  if (window.Capacitor?.isNativePlatform?.()) {
    urls.add('http://localhost/client-display.html');
  }
  if (clientUrl) urls.add(clientUrl);
  try {
    urls.add(new URL('client-display.html', window.location.href.replace(/^capacitor:\/\//, 'http://')).toString());
  } catch { /* ignore */ }
  return [...urls].filter(Boolean);
}

async function sendToDisplay(message) {
  if (_presentationActive) {
    if (_castMode === 'native') {
      try {
        await ExternalDisplay.sendToDisplay({ message });
      } catch {
        // Fallback: dispatch locally (browser dev mode / popup)
        window.dispatchEvent(new CustomEvent('bridge-message', { detail: message }));
      }
    } else if (_castMode === 'web' && _webConnection) {
      try {
        _webConnection.postMessage(message);
      } catch {
        window.dispatchEvent(new CustomEvent('bridge-message', { detail: message }));
      }
    }
  }
  // Always fire locally too (for in-app preview if needed)
  window.dispatchEvent(new CustomEvent('bridge-message', { detail: message }));
}

/** Start presenting on an external display. Called by CastingControl. */
export async function startCasting(clientUrl) {
  _lastClientUrl = clientUrl;
  _reconnectAttempts = 0;
  clearTimeout(_reconnectTimer);
  return _attemptStartCasting(clientUrl);
}

async function _attemptStartCasting(clientUrl) {
  const nativeUrls = candidateClientUrls(clientUrl);
  for (const url of nativeUrls) {
    try {
      await ExternalDisplay.startPresentation({ url });
      _presentationActive = true;
      _castMode = 'native';
      try { await ExternalDisplay.acquireWakeLock(); } catch { /* non-critical */ }
      return true;
    } catch (err) {
      console.warn(`startCasting failed for ${url}:`, err);
    }
  }

  if (!supportsWebPresentation()) return false;

  try {
    const request = new window.PresentationRequest([clientUrl]);
    const connection = await request.start();
    connection.onclose = () => {
      _presentationActive = false;
      _castMode = null;
      _webConnection = null;
      _scheduleReconnect();
    };
    connection.onterminate = () => {
      _presentationActive = false;
      _castMode = null;
      _webConnection = null;
    };
    _webConnection = connection;
    _presentationActive = true;
    _castMode = 'web';
    return true;
  } catch (err) {
    console.warn('web startCasting failed:', err);
    return false;
  }
}

function _scheduleReconnect() {
  if (!_lastClientUrl || _reconnectAttempts >= MAX_RECONNECT) return;
  _reconnectAttempts++;
  _reconnectTimer = setTimeout(async () => {
    console.log(`[scicp] Reconnect attempt ${_reconnectAttempts}/${MAX_RECONNECT}`);
    const ok = await _attemptStartCasting(_lastClientUrl);
    if (ok && _lastVerse) sendToDisplay({ type: 'verse', ..._lastVerse });
    if (ok && _lastTheme) sendToDisplay({ type: 'theme', ..._lastTheme });
    if (!ok) _scheduleReconnect();
  }, RECONNECT_DELAY_MS * _reconnectAttempts);
}

/** Stop the external display presentation. */
export async function stopCasting() {
  clearTimeout(_reconnectTimer);
  _reconnectAttempts = MAX_RECONNECT; // prevent auto-reconnect after manual stop
  if (_castMode === 'native') {
    try {
      await ExternalDisplay.stopPresentation();
    } catch { /* ignore */ }
    try { await ExternalDisplay.releaseWakeLock(); } catch { /* non-critical */ }
  } else if (_castMode === 'web' && _webConnection) {
    try {
      await _webConnection.terminate();
    } catch {
      try { await _webConnection.close(); } catch { /* ignore */ }
    }
    _webConnection = null;
  }
  _presentationActive = false;
  _castMode = null;
}

/** Check if an external display is connected. Returns { available, displayName }. */
export async function isDisplayAvailable(clientUrl = null) {
  try {
    const result = await ExternalDisplay.isAvailable();
    if (result.available) {
      _displayName = result.displayName || '';
      return true;
    }
  } catch {
    // ignore and try web fallback
  }

  if (!supportsWebPresentation() || !clientUrl) return false;
  try {
    const request = new window.PresentationRequest([clientUrl]);
    const availability = await request.getAvailability();
    return !!availability?.value;
  } catch {
    return false;
  }
}

/** Returns the display name from the last isAvailable / startCasting call. */
export function getDisplayName() {
  return _displayName;
}

/** Cache last verse/theme so reconnect can restore display state. */
export function setLastCastState(verse, theme) {
  if (verse !== undefined) _lastVerse = verse;
  if (theme !== undefined) _lastTheme = theme;
}

/** Check if we're actively presenting. */
export function isCasting() {
  return _presentationActive;
}

/** Start local HTTP server for LAN casting (last-resort offline fallback). */
export async function startLocalServer(port = 8080) {
  try {
    return await ExternalDisplay.startLocalServer({ port });
  } catch (e) {
    console.warn('startLocalServer failed:', e);
    return null;
  }
}

/** Stop local HTTP server. */
export async function stopLocalServer() {
  try {
    await ExternalDisplay.stopLocalServer();
  } catch { /* ignore */ }
}

/** Get current local server URL or null if not running. */
export async function getLocalServerUrl() {
  try {
    const result = await ExternalDisplay.getLocalServerUrl();
    return result.running ? result.url : null;
  } catch {
    return null;
  }
}

async function emit(event, payload, ackCallback) {
  // Handle ack-style calls where the last arg is a callback
  if (typeof payload === 'function') {
    ackCallback = payload;
    payload = {};
  }

  switch (event) {
    case 'search': {
      const { query, page = 0, pageSize = 10, language = 'en' } = payload || {};
      if (!query || !String(query).trim()) {
        fire('search-results', { results: [], total: 0, page: 0, pageSize });
        return;
      }
      // Try web API first when a server URL is configured and network is available
      const remoteBase = remote.getServerUrl();
      if (remoteBase && navigator.onLine) {
        try {
          const result = await remote.search(query, page, pageSize, language);
          if (result && Array.isArray(result.results)) {
            fire('search-results', { ...result, query, language });
            break;
          }
        } catch { /* fall through to local */ }
      }
      try {
        const result = await svc.search(query, page, pageSize, language);
        fire('search-results', { ...result, query, language });
      } catch (err) {
        console.error('socket-local search error:', err);
        fire('search-results', { results: [], total: 0, page, pageSize, query, language });
      }
      break;
    }

    case 'go-live': {
      const { verse, theme, language, secondaryLanguage } = payload || {};
      let scriptureText = verse.scripture_text;
      let verseTitle = verse.book_title + ' ' + verse.chapter_number + ':' + verse.verse_number;
      let bookTitle = verse.book_title;

      const targetLang = language || 'en';
      const row = svc.getVerse(verse, targetLang);
      if (row) {
        if (targetLang !== 'en') {
          if (row.scripture_text) scriptureText = row.scripture_text;
          if (row.verse_title) verseTitle = row.verse_title;
          if (row.book_title) bookTitle = row.book_title;
        } else {
          scriptureText = row.scripture_text;
          verseTitle = row.verse_title;
          bookTitle = row.book_title;
        }
      }

      const segments = svc.segmentVerseText(scriptureText);
      const verseWithSegments = {
        ...verse,
        scripture_text: scriptureText,
        verse_title: verseTitle,
        book_title: bookTitle,
        segments,
        totalSegments: segments.length,
        currentSegment: 0,
        secondary_text: null,
        secondary_book_title: null,
        secondary_segments: null,
        secondaryLanguage: null,
        language: targetLang,
        version_citation: svc.getVersionCitation(targetLang, verse.volume_id),
        volume_title: row?.volume_title || verse.volume_title || '',
        volume_short_title: row?.volume_short_title || verse.volume_short_title || '',
      };

      if (secondaryLanguage && secondaryLanguage !== targetLang) {
        const secRow = svc.getVerse(verse, secondaryLanguage);
        if (secRow) {
          verseWithSegments.secondary_text = secRow.scripture_text;
          verseWithSegments.secondary_book_title = secRow.book_title;
          verseWithSegments.secondaryLanguage = secondaryLanguage;
        }
      }

      fire('update-verse', verseWithSegments);
      sendToDisplay({ type: 'update-verse', data: verseWithSegments });
      break;
    }

    case 'update-verse': {
      const verse = payload?.verse || payload;
      fire('update-verse', verse);
      sendToDisplay({ type: 'update-verse', data: verse });
      break;
    }

    case 'update-theme': {
      const theme = payload?.theme || payload;
      fire('update-theme', theme);
      sendToDisplay({ type: 'update-theme', data: theme });
      break;
    }

    case 'highlight-text': {
      const text = payload?.text ?? payload;
      fire('highlight-text', text);
      sendToDisplay({ type: 'highlight-text', data: text });
      break;
    }

    case 'clear-screen': {
      fire('clear-screen', {});
      sendToDisplay({ type: 'clear-screen' });
      if (typeof ackCallback === 'function') ackCallback({ ok: true });
      break;
    }

    case 'go-custom': {
      const { text, subtext, theme } = payload || {};
      fire('custom-text', { text, subtext, theme });
      sendToDisplay({ type: 'custom-text', data: { text, subtext, theme } });
      break;
    }

    case 'update-language': {
      // No-op locally — language switching is handled in go-live
      break;
    }

    case 'preload-background': {
      sendToDisplay({ type: 'preload-background', data: { background_url: payload?.background_url } });
      break;
    }

    case 'now-reading': {
      const { on, verse_id } = payload || {};
      fire('now-reading', { on: !!on, verse_id: verse_id || null });
      sendToDisplay({ type: 'now-reading', data: { on: !!on, verse_id: verse_id || null } });
      break;
    }

    case 'join-session': {
      if (typeof ackCallback === 'function') {
        ackCallback({ ok: true, sessionId: 'LOCAL', presenterToken: 'mobile-local' });
      }
      fire('session-joined', { sessionId: 'LOCAL' });
      break;
    }

    case 'leave-session': {
      if (typeof ackCallback === 'function') ackCallback({ ok: true });
      fire('session-left');
      break;
    }

    case 'set-session-pin':
    case 'clear-session-pin': {
      if (typeof ackCallback === 'function') ackCallback({ ok: true });
      break;
    }

    default:
      console.warn(`socket-local: unhandled emit "${event}"`, payload);
  }
}

export const socket = {
  connected: true,
  id: 'mobile-local',
  emit,
  on,
  off,
  async init() {
    await svc.init();
    fire('connect');
    fire('session-joined', { sessionId: 'LOCAL' });
  },
};
