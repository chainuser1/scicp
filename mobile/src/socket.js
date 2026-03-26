/**
 * socket.js — Socket.IO singleton for mobile/TV app.
 * Connects to the backend server. All search, live, and session
 * events flow through this single connection.
 */
import { io } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://cap-teyyko.live';

const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 20000,
  autoConnect: true,
});

// ── Event queue for offline resilience ──
const QUEUEABLE = new Set([
  'go-live', 'update-verse', 'update-theme', 'highlight-text',
  'clear-screen', 'update-language', 'search', 'go-custom',
  'now-reading', 'preload-background',
]);
const queue = [];
let queueListeners = [];

const originalEmit = socket.emit.bind(socket);
socket.emit = (event, ...args) => {
  if (!socket.connected && QUEUEABLE.has(event)) {
    queue.push({ event, args });
    notifyQueueChange();
    return socket;
  }
  return originalEmit(event, ...args);
};

function flushQueue() {
  while (queue.length > 0) {
    const { event, args } = queue.shift();
    originalEmit(event, ...args);
  }
  notifyQueueChange();
}

function notifyQueueChange() {
  queueListeners.forEach(fn => fn(queue.length));
}

socket.on('connect', () => {
  if (queue.length > 0) setTimeout(flushQueue, 300);
});

// Public API
socket.getServerUrl = () => SERVER_URL;
socket.getQueueLength = () => queue.length;
socket.onQueueChange = (fn) => {
  queueListeners.push(fn);
  return () => { queueListeners = queueListeners.filter(f => f !== fn); };
};

export default socket;
export { SERVER_URL };
