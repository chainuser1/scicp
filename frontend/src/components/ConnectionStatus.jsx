import { useState, useEffect } from 'react';
import { socket } from '../socket';

export default function ConnectionStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [socketConnected, setSocketConnected] = useState(socket.connected);
  const [queueLength, setQueueLength] = useState(socket.queueLength || 0);

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    const unsubQueue = socket.onQueueChange(setQueueLength);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      unsubQueue();
    };
  }, []);

  if (online && socketConnected && queueLength === 0) return null;

  let message;
  if (!online) message = '📡 You are offline — some features may be unavailable';
  else if (!socketConnected && queueLength > 0) message = `🔄 Reconnecting… (${queueLength} pending action${queueLength > 1 ? 's' : ''})`;
  else if (!socketConnected) message = '🔄 Reconnecting to server…';
  else if (queueLength > 0) message = `⏳ Syncing ${queueLength} pending action${queueLength > 1 ? 's' : ''}…`;

  return (
    <div className="connection-banner" role="alert" aria-live="assertive">
      {message}
    </div>
  );
}
