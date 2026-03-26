/**
 * useSocket.js — React hooks for Socket.IO connection state and events.
 *
 * Session model:
 * - Only the Client (TV app) creates sessions via create-client-session
 * - Presenters (mobile) join sessions by scanning QR or entering session ID
 * - On leave: session code wiped from localStorage, reconnection impossible
 * - On session-error (expired/not-found): auto-wipe stored session, prompt re-scan
 * - On reconnect after network drop: attempt rejoin; if server expired it, auto-wipe
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import socket from '../socket';

/** Connection state: 'connected' | 'disconnected' | 'connecting' */
export function useConnectionState() {
  const [state, setState] = useState(
    socket.connected ? 'connected' : 'disconnected'
  );

  useEffect(() => {
    const onConnect = () => setState('connected');
    const onDisconnect = () => setState('disconnected');
    const onReconnecting = () => setState('connecting');
    const onError = () => setState('disconnected');
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onError);
    socket.io.on('reconnect_attempt', onReconnecting);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onError);
      socket.io.off('reconnect_attempt', onReconnecting);
    };
  }, []);

  return state;
}

/** Listen to a specific Socket.IO event */
export function useSocketEvent(event, handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const fn = (...args) => handlerRef.current(...args);
    socket.on(event, fn);
    return () => socket.off(event, fn);
  }, [event]);
}

/**
 * Session management hook for the Presenter (mobile) app.
 * Presenters can only JOIN sessions — never create them.
 * The Client (TV) creates sessions via create-client-session.
 */
export function useSession() {
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem('scicp_session_id') || ''
  );
  const [sessionLabel, setSessionLabel] = useState('');
  const [presenterToken, setPresenterToken] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [error, setError] = useState('');
  const conn = useConnectionState();

  const clearSession = useCallback(() => {
    setSessionId('');
    setSessionLabel('');
    setPresenterToken('');
    setViewerCount(0);
    localStorage.removeItem('scicp_session_id');
  }, []);

  useSocketEvent('session-joined', (data) => {
    setSessionId(data.sessionId);
    setSessionLabel(data.label || '');
    setPresenterToken(data.presenterToken || '');
    setError('');
    localStorage.setItem('scicp_session_id', data.sessionId);
  });

  // Session error: wipe stored session if not found / expired / locked out
  useSocketEvent('session-error', (data) => {
    const msg = data.message || 'Session error';
    setError(msg);
    if (msg.includes('not found') || msg.includes('locked-out') || msg.includes('expired')) {
      clearSession();
    }
  });

  // Voluntary leave: wipe everything
  useSocketEvent('session-left', () => {
    clearSession();
  });

  // Presenter evicted by server/client
  useSocketEvent('presenter-evicted', (data) => {
    clearSession();
  });

  // Presenter was removed by client/server (grace period expired)
  useSocketEvent('presenter-left', () => {
    clearSession();
  });

  useSocketEvent('viewer-count', (data) => {
    setViewerCount(data.count ?? data);
  });

  const joinSession = useCallback((id, opts = {}) => {
    socket.emit('join-session', { sessionId: id, role: 'presenter', ...opts });
  }, []);

  const leaveSession = useCallback(() => {
    if (sessionId) {
      socket.emit('leave-session', { sessionId });
      // Immediately clear — don't wait for server ack
      clearSession();
    }
  }, [sessionId, clearSession]);

  // Auto-rejoin on reconnect (network recovery)
  // If the session was terminated during the outage, server will respond
  // with session-error "Session not found" which triggers auto-wipe above
  useEffect(() => {
    if (conn === 'connected' && sessionId) {
      socket.emit('join-session', {
        sessionId,
        role: 'presenter',
        presenterToken: presenterToken || undefined,
      });
    }
  }, [conn]);

  return {
    sessionId, sessionLabel, presenterToken, viewerCount, error,
    joinSession, leaveSession, clearSession,
    isConnected: conn === 'connected',
    connectionState: conn,
  };
}

/** Queue length for offline indicator */
export function useQueueLength() {
  const [len, setLen] = useState(socket.getQueueLength());
  useEffect(() => socket.onQueueChange(setLen), []);
  return len;
}
