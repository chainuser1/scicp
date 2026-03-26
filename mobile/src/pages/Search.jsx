import { useState, useRef, useEffect } from 'react';
import { useSearch } from '../hooks/useSearch';
import './Search.css';

export default function SearchPage({ onStage }) {
  const { query, setQuery, results, meta, loading, search, loadMore, clear } = useSearch();
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const handleSubmit = (e) => {
    e.preventDefault();
    search(query);
    inputRef.current?.blur();
  };

  // Infinite scroll
  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMore();
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
        {results.length === 0 && !loading && query && (
          <div className="empty-state">
            <span className="empty-state-icon">📖</span>
            <p className="text-secondary">No results found</p>
          </div>
        )}

        {results.length === 0 && !loading && !query && (
          <div className="empty-state">
            <span className="empty-state-icon">🔍</span>
            <p className="text-secondary">Search for a verse, topic, or phrase</p>
            <p className="text-xs text-dim">Try "faith", "John 3:16", or "anger issues"</p>
          </div>
        )}

        {results.map((v, i) => (
          <VerseCard key={v.verse_id || i} verse={v} onTap={() => onStage(v)} />
        ))}

        {loading && (
          <div className="search-loading">
            <div className="spinner" />
          </div>
        )}
      </div>
    </div>
  );
}

function VerseCard({ verse, onTap }) {
  const title = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
  const text = verse.scripture_text || '';
  const preview = text.length > 180 ? text.slice(0, 180) + '…' : text;
  const source = verse._source;

  return (
    <button className="verse-card card" onClick={onTap}>
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
  );
}
