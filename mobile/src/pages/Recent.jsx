/**
 * Recent.jsx — Recently staged/searched verses.
 */
import './Recent.css';

export default function RecentPage({ history, clearHistory, onStage, onGoLive }) {
  const timeAgo = (ts) => {
    if (!ts) return '';
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  const title = (v) => v.verse_title || `${v.book_title || ''} ${v.chapter_number || ''}:${v.verse_number || ''}`;

  if (!history || history.length === 0) {
    return (
      <div className="recent-page">
        <div className="empty-state">
          <span className="empty-state-icon">🕘</span>
          <p className="text-secondary">No recent verses</p>
          <p className="text-xs text-dim">Verses you stage or go live with will appear here</p>
        </div>
      </div>
    );
  }

  return (
    <div className="recent-page scroll-area safe-bottom">
      <div className="recent-header">
        <span className="recent-count">{history.length} recent</span>
        <button className="recent-clear" onClick={clearHistory}>Clear All</button>
      </div>
      <div className="recent-list">
        {history.map((v, i) => (
          <div key={v.verse_id || i} className="recent-row" onClick={() => onStage(v)}>
            <div className="recent-info">
              <span className="recent-ref">{title(v)}</span>
              <span className="recent-time">{timeAgo(v._ts)}</span>
            </div>
            <p className="recent-text">{(v.scripture_text || '').slice(0, 100)}{v.scripture_text?.length > 100 ? '…' : ''}</p>
            <button
              className="recent-live-dot"
              onClick={(e) => { e.stopPropagation(); onGoLive(v); }}
              aria-label="Go live"
            >
              <span className="dot-red" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
