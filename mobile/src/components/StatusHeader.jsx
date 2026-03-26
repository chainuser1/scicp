import { useConnectionState, useQueueLength } from '../hooks/useSocket';
import './StatusHeader.css';

export default function StatusHeader({ sessionId, viewerCount }) {
  const conn = useConnectionState();
  const queueLen = useQueueLength();

  return (
    <header className="status-header safe-top">
      <div className="status-left">
        <span className={`status-dot ${conn}`} />
        <span className="text-xs font-medium">
          {conn === 'connected' ? 'Online' : conn === 'connecting' ? 'Reconnecting…' : 'Offline'}
        </span>
        {queueLen > 0 && (
          <span className="badge badge-gold text-xs">{queueLen} queued</span>
        )}
      </div>
      <div className="status-right">
        {sessionId && (
          <>
            <span className="badge badge-blue">{sessionId}</span>
            {viewerCount > 0 && (
              <span className="badge badge-green">👁 {viewerCount}</span>
            )}
          </>
        )}
      </div>
    </header>
  );
}
