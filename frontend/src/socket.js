import { io } from 'socket.io-client';

// Support Electron online mode: ?server=https://cap-teyyko.live overrides the target
const _params = new URLSearchParams(window.location.search);
const _remoteServer = _params.get('server');

// "undefined" means the URL will be computed from the `window.location` object
const URL = _remoteServer || (import.meta.env.MODE === 'production' ? undefined : 'http://localhost:3000');

/** True when connected to a remote server (Electron online mode) */
export const isRemoteMode = Boolean(_remoteServer);

// Events that should be queued when disconnected and replayed after rejoin
const QUEUEABLE_EVENTS = new Set([
  'go-live', 'update-verse', 'update-theme',
  'highlight-text', 'clear-screen', 'update-language', 'search',
  'go-custom', 'now-reading', 'preload-background',
]);
let _queue = [];
let _queueChangeListeners = [];

function _notifyQueueChange() {
  _queueChangeListeners.forEach(fn => fn(_queue.length));
}

const raw = io(URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
});

export const socket = Object.assign(raw, {
  get queueLength() { return _queue.length; },

  /** Subscribe to queue size changes; returns unsubscribe fn */
  onQueueChange(fn) {
    _queueChangeListeners.push(fn);
    return () => { _queueChangeListeners = _queueChangeListeners.filter(f => f !== fn); };
  },

  /** Replay all queued events (call after successful session rejoin) */
  flushQueue() {
    const items = _queue.splice(0);
    items.forEach(({ event, payload }) => {
      if (raw.connected) raw.emit(event, payload);
    });
    _notifyQueueChange();
    return items.length;
  },

  /** Clear queue without sending */
  clearQueue() { _queue = []; _notifyQueueChange(); },
});

// Intercept emit to queue critical events when disconnected
const _origEmit = raw.emit.bind(raw);
raw.emit = function (event, ...args) {
  if (!raw.connected && QUEUEABLE_EVENTS.has(event)) {
    const payload = args[0];
    _queue.push({ event, payload: payload && typeof payload === 'object' ? { ...payload } : payload });
    _notifyQueueChange();
    return raw;
  }
  return _origEmit(event, ...args);
};
