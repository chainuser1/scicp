import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearch } from '../hooks/useSearch';
import { addToast } from '../hooks/useToast';
import { SERVER_URL } from '../socket';
import './Search.css';

const QUICK_TOPICS = [
  'faith', 'prayer', 'hope', 'charity', 'repentance', 'forgiveness',
  'baptism', 'obedience', 'patience', 'humility', 'love', 'gratitude',
  'tithing', 'service', 'family',
];

export default function SearchPage({ onStage, history, clearHistory, bookmarks, sessionId, onAddToSetlist }) {
  const { query, setQuery, results, meta, loading, search, loadMore, clear } = useSearch();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [votd, setVotd] = useState(null);
  const suggestRef = useRef(null);
  const [intExpanded, setIntExpanded] = useState(false);

  // Fetch Verse of the Day
  useEffect(() => {
    fetch(`${SERVER_URL}/verse/of-the-day`).then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setVotd(d); }).catch(() => {});
  }, []);

  // Auto-complete suggestions
  useEffect(() => {
    if (suggestRef.current) clearTimeout(suggestRef.current);
    if (!query || query.length < 2) { setSuggestions([]); return; }
    suggestRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/suggest?q=${encodeURIComponent(query)}&limit=6`);
        if (res.ok) { const data = await res.json(); setSuggestions(data); setShowSuggestions(true); }
      } catch { /* offline */ }
    }, 300);
    return () => clearTimeout(suggestRef.current);
  }, [query]);

  const handleSubmit = (e) => {
    e.preventDefault();
    search(query);
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  const handleSuggestionTap = (s) => {
    const q = typeof s === 'string' ? s : s.text || s.query || s;
    setQuery(q);
    search(q);
    setShowSuggestions(false);
  };

  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMore();
  };

  const copyVerse = useCallback((verse) => {
    const ref = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
    const text = `${ref}\n"${verse.scripture_text}"`;
    navigator.clipboard.writeText(text).then(
      () => addToast('Copied to clipboard', 'success'),
      () => addToast('Copy failed', 'error')
    );
  }, []);

  const logFeedback = useCallback((verse, rank) => {
    fetch(`${SERVER_URL}/search-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verse_id: verse.verse_id, query, rank, source: verse._source }),
    }).catch(() => {});
  }, [query]);

  const timeAgo = (ts) => {
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  return (
    <div className="search-page">
      <div className="search-bar-wrap">
        <form className="search-bar" onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            className="input search-input"
            type="search"
            placeholder="Search scriptures…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            enterKeyHint="search"
            autoComplete="off"
          />
          {query && (
            <button type="button" className="search-clear" onClick={clear}>✕</button>
          )}
        </form>

        {/* Auto-complete dropdown */}
        {showSuggestions && suggestions.length > 0 && (
          <div className="suggestions-dropdown">
            {suggestions.map((s, i) => (
              <button key={i} className="suggestion-item" onMouseDown={() => handleSuggestionTap(s)}>
                <span className="text-sm">{typeof s === 'string' ? s : s.text || s.query}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Intelligence bar */}
      {meta && results.length > 0 && (
        <div className="intelligence-bar">
          <div className="intel-row">
            {meta.intelligenceHints?.map((h, i) => (
              <span key={i} className="badge badge-gold">{h}</span>
            ))}
            {meta.intent && (
              <span className="badge badge-blue">{meta.intent}</span>
            )}
            {meta.entityMatch && (
              <span className="badge badge-green">
                {meta.entityMatch.type === 'person' ? '👤' : '📍'} {meta.entityMatch.name}
              </span>
            )}
            {meta.qpprActive && <span className="badge badge-blue">📊 Graph</span>}
            {meta.sessionDrift && <span className="badge badge-gold">🎯 Contextual</span>}
            {meta.expansions?.length > 0 && (
              <button className="btn btn-ghost btn-sm text-xs" onClick={() => setIntExpanded(!intExpanded)}>
                {intExpanded ? '▲' : '▼'} {meta.expansions.length} terms
              </button>
            )}
          </div>
          {intExpanded && meta.expansions?.length > 0 && (
            <div className="intel-expansions">
              {meta.expansions.map((t, i) => (
                <span key={i} className="badge badge-blue" style={{ fontSize: '0.625rem' }}>{t}</span>
              ))}
            </div>
          )}
          {meta.facets?.length > 0 && (
            <div className="intel-facets">
              {meta.facets.slice(0, 4).map((f, i) => (
                <button key={i} className="badge badge-gold" onClick={() => { setQuery(f); search(f); }}>
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="search-results scroll-area safe-bottom" ref={listRef} onScroll={handleScroll}>
        {/* Search results */}
        {results.length > 0 && results.map((v, i) => (
          <VerseCard
            key={v.verse_id || i}
            verse={v}
            onTap={() => { onStage(v); logFeedback(v, i); }}
            isBookmarked={bookmarks?.isBookmarked?.(v.verse_id)}
            onToggleBookmark={() => bookmarks?.toggle?.(v)}
            onCopy={() => copyVerse(v)}
            onAddToSetlist={onAddToSetlist ? () => onAddToSetlist(v) : undefined}
          />
        ))}

        {/* No results */}
        {results.length === 0 && !loading && query && (
          <div className="empty-state">
            <span className="empty-state-icon">📖</span>
            <p className="text-secondary">No results found</p>
          </div>
        )}

        {/* Idle state: VOTD + quick topics + history */}
        {results.length === 0 && !loading && !query && (
          <>
            {/* Verse of the Day */}
            {votd && (
              <div className="votd-card card">
                <p className="text-xs text-dim font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                  📅 Verse of the Day
                </p>
                <p className="text-gold font-semibold text-sm">
                  {votd.verse_title || `${votd.book_title} ${votd.chapter_number}:${votd.verse_number}`}
                </p>
                <p className="text-sm text-secondary" style={{ margin: '6px 0', lineHeight: 1.55 }}>
                  {(votd.scripture_text || '').slice(0, 200)}{votd.scripture_text?.length > 200 ? '…' : ''}
                </p>
                <div className="votd-actions">
                  <button className="btn btn-primary btn-sm" onClick={() => onStage(votd)}>
                    Stage
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => copyVerse(votd)}>
                    📋 Copy
                  </button>
                </div>
              </div>
            )}

            {/* Quick topics */}
            <div className="quick-topics">
              <p className="text-xs text-dim font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Quick Topics
              </p>
              <div className="topic-chips">
                {QUICK_TOPICS.map(t => (
                  <button key={t} className="badge badge-gold topic-chip" onClick={() => { setQuery(t); search(t); }}>
                    {t}
                  </button>
                ))}
              </div>
            </div>

            {/* History */}
            {history && history.length > 0 && (
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
            )}

            {/* Empty prompt only if no VOTD, no history */}
            {!votd && (!history || history.length === 0) && (
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

function VerseCard({ verse, onTap, isBookmarked, onToggleBookmark, onCopy, onAddToSetlist }) {
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
      <div className="verse-card-actions">
        {onAddToSetlist && (
          <button
            className="verse-action-btn"
            onClick={(e) => { e.stopPropagation(); onAddToSetlist(); }}
            title="Add to setlist"
          >
            ＋
          </button>
        )}
        <button
          className="verse-action-btn"
          onClick={(e) => { e.stopPropagation(); onCopy?.(); }}
          title="Copy"
        >
          📋
        </button>
        <button
          className={`verse-action-btn ${isBookmarked ? 'bookmark-active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleBookmark?.(); }}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark'}
        >
          {isBookmarked ? '🔖' : '🏷️'}
        </button>
      </div>
    </div>
  );
}
