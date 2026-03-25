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

// M38: Reset casting state if the external display disconnects unexpectedly.
if (typeof ExternalDisplay.addListener === 'function') {
  ExternalDisplay.addListener('displayDisconnected', () => {
    _presentationActive = false;
    console.warn('[scicp] External display disconnected');
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
  const nativeUrls = candidateClientUrls(clientUrl);
  for (const url of nativeUrls) {
    try {
      await ExternalDisplay.startPresentation({ url });
      _presentationActive = true;
      _castMode = 'native';
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

/** Stop the external display presentation. */
export async function stopCasting() {
  if (_castMode === 'native') {
    try {
      await ExternalDisplay.stopPresentation();
    } catch { /* ignore */ }
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

/** Check if an external display is connected. */
export async function isDisplayAvailable(clientUrl = null) {
  try {
    const { available } = await ExternalDisplay.isAvailable();
    if (available) return true;
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
