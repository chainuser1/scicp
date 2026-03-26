import { useState, useRef } from 'react';
import { useSearch } from '../hooks/useSearch';
import './Search.css';

export default function SearchPage({ onStage, history, clearHistory, bookmarks }) {
  const { query, setQuery, results, meta, loading, search, loadMore, clear } = useSearch();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    search(query);
    inputRef.current?.blur();
  };

  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMore();
  };

  const timeAgo = (ts) => {
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  return (
    <div className="search-page">
      <form className="search-bar" onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          className="input search-input"
          type="search"
          placeholder="Search scriptures…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          enterKeyHint="search"
          autoComplete="off"
        />
        {query && (
          <button type="button" className="search-clear" onClick={clear}>✕</button>
        )}
      </form>

      {meta?.intelligenceHints?.length > 0 && (
        <div className="search-hints">
          {meta.intelligenceHints.map((h, i) => (
            <span key={i} className="badge badge-gold">{h}</span>
          ))}
        </div>
      )}

      <div className="search-results scroll-area safe-bottom" ref={listRef} onScroll={handleScroll}>
        {/* Search results */}
        {results.length > 0 && results.map((v, i) => (
          <VerseCard
            key={v.verse_id || i}
            verse={v}
            onTap={() => onStage(v)}
            isBookmarked={bookmarks?.isBookmarked?.(v.verse_id)}
            onToggleBookmark={() => bookmarks?.toggle?.(v)}
          />
        ))}

        {/* No results */}
        {results.length === 0 && !loading && query && (
          <div className="empty-state">
            <span className="empty-state-icon">📖</span>
            <p className="text-secondary">No results found</p>
          </div>
        )}

        {/* History when empty */}
        {results.length === 0 && !loading && !query && (
          <>
            {history && history.length > 0 ? (
              <div className="search-history">
                <div className="history-header">
                  <h3 className="text-xs text-dim font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Recent
                  </h3>
                  <button className="btn btn-ghost btn-sm text-xs" onClick={clearHistory}>
                    Clear
                  </button>
                </div>
                {history.slice(0, 15).map((v, i) => (
                  <button key={v.verse_id || i} className="history-item" onClick={() => onStage(v)}>
                    <span className="text-sm text-gold font-medium">
                      {v.verse_title || `${v.book_title} ${v.chapter_number}:${v.verse_number}`}
                    </span>
                    <span className="text-xs text-dim">{timeAgo(v._ts)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <span className="empty-state-icon">🔍</span>
                <p className="text-secondary">Search for a verse, topic, or phrase</p>
                <p className="text-xs text-dim">Try "faith", "John 3:16", or "anger issues"</p>
              </div>
            )}
          </>
        )}

        {loading && (
          <div className="search-loading">
            <div className="spinner" />
          </div>
        )}
      </div>
    </div>
  );
}

function VerseCard({ verse, onTap, isBookmarked, onToggleBookmark }) {
  const title = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
  const text = verse.scripture_text || '';
  const preview = text.length > 180 ? text.slice(0, 180) + '…' : text;
  const source = verse._source;

  return (
    <div className="verse-card card">
      <button className="verse-card-body" onClick={onTap}>
        <div className="verse-card-header">
          <span className="verse-card-title font-semibold">{title}</span>
          {source && <span className="badge badge-blue">{source}</span>}
        </div>
        <p className="verse-card-text text-sm text-secondary">{preview}</p>
        {verse.similarity_score > 0 && (
          <div className="verse-card-score">
            <div className="score-bar" style={{ width: `${Math.round(verse.similarity_score * 100)}%` }} />
          </div>
        )}
      </button>
      <button
        className={`verse-bookmark-btn ${isBookmarked ? 'bookmark-active' : ''}`}
        onClick={(e) => { e.stopPropagation(); onToggleBookmark?.(); }}
        title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
      >
        {isBookmarked ? '🔖' : '🏷️'}
      </button>
    </div>
  );
}
