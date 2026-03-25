import { useState, useEffect } from 'react';
import { socket } from '../socket';

export default function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(socket.connected);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  if (online && socketConnected) return null;

  return (
    <div className="connection-banner" role="alert" aria-live="assertive">
      {!online
        ? '📡 You are offline — some features may be unavailable'
        : '🔄 Reconnecting to server…'}
    </div>
  );
}
