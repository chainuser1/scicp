/**
 * socket-remote.js — Real Socket.IO client for online mode.
 *
 * Exports the same interface as socket-local.js so MobilePresenter.jsx
 * can use either interchangeably:
 *   { socket: { emit, on, off, connected, id, init, destroy } }
 *
 * In online mode, all events go over the network to the real backend.
 */
import { io } from 'socket.io-client';

let _socket = null;
let _serverUrl = '';

// Events that should be queued when disconnected and replayed after rejoin
const QUEUEABLE_EVENTS = new Set([
  'go-live', 'update-verse', 'update-theme',
  'highlight-text', 'clear-screen', 'update-language', 'search',
]);
let _queue = [];
let _queueChangeListeners = [];

function _notifyQueueChange() {
  _queueChangeListeners.forEach(fn => fn(_queue.length));
}

function createSocket(serverUrl) {
  _serverUrl = serverUrl.replace(/\/+$/, '');
  _socket = io(_serverUrl, {
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling'],
  });
  return _socket;
}

export const socket = {
  get connected() { return _socket?.connected ?? false; },
  get id()        { return _socket?.id ?? null; },
  get serverUrl() { return _serverUrl; },
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
      if (_socket?.connected) _socket.emit(event, payload);
    });
    _notifyQueueChange();
    return items.length;
  },

  /** Clear queue without sending */
  clearQueue() { _queue = []; _notifyQueueChange(); },

  emit(event, payload, ack) {
    if (!_socket) { console.warn('socket-remote: not initialized'); return; }
    // Buffer critical events when disconnected
    if (!_socket.connected && QUEUEABLE_EVENTS.has(event)) {
      _queue.push({ event, payload: payload && typeof payload === 'object' ? { ...payload } : payload });
      _notifyQueueChange();
      return;
    }
    if (typeof payload === 'function') {
      _socket.emit(event, payload);
    } else if (ack) {
      _socket.emit(event, payload, ack);
    } else {
      _socket.emit(event, payload);
    }
  },

  on(event, fn) {
    if (!_socket) return;
    _socket.on(event, fn);
  },

  off(event, fn) {
    if (!_socket) return;
    if (fn) _socket.off(event, fn);
    else _socket.removeAllListeners(event);
  },

  async init(serverUrl) {
    if (_socket) {
      _socket.disconnect();
      _socket.removeAllListeners();
    }
    createSocket(serverUrl);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Connection timed out'));
      }, 10000);

      _socket.once('connect', () => {
        clearTimeout(timeout);
        resolve();
      });
      _socket.once('connect_error', (err) => {
        clearTimeout(timeout);
        reject(new Error(err.message || 'Failed to connect'));
      });

      _socket.connect();
    });
  },

  destroy() {
    if (_socket) {
      _socket.disconnect();
      _socket.removeAllListeners();
      _socket = null;
    }
    _serverUrl = '';
  },

  /** Get the raw socket.io instance (for advanced use). */
  get raw() { return _socket; },
};
