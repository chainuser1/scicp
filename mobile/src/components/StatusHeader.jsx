import { useConnectionState } from '../hooks/useSocket';
import './StatusHeader.css';

export default function StatusHeader({
  sessionId,
  viewerCount,
  liveVerse,
  isLive,
  title = 'Scripture',
  onMenuOpen,
}) {
  const conn = useConnectionState();

  const verseRef = liveVerse
    ? liveVerse.verse_title || `${liveVerse.book_title || ''} ${liveVerse.chapter_number || ''}:${liveVerse.verse_number || ''}`
    : null;

  return (
    <header className="status-header safe-top">
      <div className="status-left">
        <span className="header-title">{title}</span>
        {verseRef && <span className="header-verse-ref">{verseRef} · KJV</span>}
        {!verseRef && <span className="header-hint">tap ◆ to find a verse</span>}
      </div>
      <div className="status-right">
        {conn !== 'connected' && (
          <span className={`status-dot ${conn}`} />
        )}
        <span className={`live-badge ${isLive ? 'live-badge-on' : 'live-badge-off'}`}>
          {isLive ? '● live' : 'not live'}
        </span>
        {viewerCount > 0 && (
          <span className="viewer-badge">👁 {viewerCount}</span>
        )}
        <button className="header-menu-btn" onClick={onMenuOpen} aria-label="Settings">
          ⋯
        </button>
      </div>
    </header>
  );
}
