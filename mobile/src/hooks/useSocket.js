/**
 * useSocket.js — React hooks for Socket.IO connection state and events.
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
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.io.on('reconnect_attempt', onReconnecting);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
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

/** Session management hook */
export function useSession() {
  const [sessionId, setSessionId] = useState(
    () => localStorage.getItem('scicp_session_id') || ''
  );
  const [sessionLabel, setSessionLabel] = useState('');
  const [presenterToken, setPresenterToken] = useState('');
  const [viewerCount, setViewerCount] = useState(0);
  const [error, setError] = useState('');
  const conn = useConnectionState();

  useSocketEvent('session-created', (data) => {
    setSessionId(data.sessionId);
    setSessionLabel(data.label || '');
    setPresenterToken(data.presenterToken || '');
    setError('');
    localStorage.setItem('scicp_session_id', data.sessionId);
  });

  useSocketEvent('session-joined', (data) => {
    setSessionId(data.sessionId);
    setSessionLabel(data.label || '');
    setPresenterToken(data.presenterToken || '');
    setError('');
    localStorage.setItem('scicp_session_id', data.sessionId);
  });

  useSocketEvent('session-error', (data) => {
    setError(data.message || 'Session error');
  });

  useSocketEvent('session-left', () => {
    setSessionId('');
    setSessionLabel('');
    setPresenterToken('');
    localStorage.removeItem('scicp_session_id');
  });

  useSocketEvent('viewer-count', (data) => {
    setViewerCount(data.count ?? data);
  });

  const createSession = useCallback((label) => {
    socket.emit('create-session', { label: label || undefined });
  }, []);

  const joinSession = useCallback((id, opts = {}) => {
    socket.emit('join-session', { sessionId: id, role: 'presenter', ...opts });
  }, []);

  const leaveSession = useCallback(() => {
    if (sessionId) socket.emit('leave-session', { sessionId });
  }, [sessionId]);

  // Auto-rejoin on reconnect
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
    createSession, joinSession, leaveSession,
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
