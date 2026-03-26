/**
 * ReaderHome.jsx — Home screen: search, topics, book grid, continue reading.
 * Matches mockup screen 1.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { SERVER_URL } from '../../socket';

const TOPIC_CHIPS = [
  'Faith', 'Prayer', 'Hope', 'Charity', 'Repentance', 'Grace',
  'Atonement', 'Suffering', 'Covenant', 'Eternal Life', 'Holy Ghost',
  'Resurrection', 'Obedience', 'Trials', 'Forgiveness', 'Patience',
];

export default function ReaderHome({ prefs, onSearch, onOpenChapter, onTopicSearch }) {
  const [books, setBooks] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [coverage, setCoverage] = useState(null);
  const [reviewItems, setReviewItems] = useState([]);
  const inputRef = useRef(null);

  // Fetch books
  useEffect(() => {
    fetch(`${SERVER_URL}/browse/books?language=${prefs.lang}`)
      .then(r => r.ok ? r.json() : [])
      .then(setBooks)
      .catch(() => {});
  }, [prefs.lang]);

  // Fetch coverage + spaced review
  useEffect(() => {
    fetch(`${SERVER_URL}/reading-coverage`).then(r => r.ok ? r.json() : null).then(setCoverage).catch(() => {});
    fetch(`${SERVER_URL}/spaced-review?limit=3`).then(r => r.ok ? r.json() : []).then(setReviewItems).catch(() => {});
  }, []);

  const handleSearchSubmit = useCallback((e) => {
    e.preventDefault();
    if (searchQuery.trim()) onSearch(searchQuery.trim());
  }, [searchQuery, onSearch]);

  const { lastRead } = prefs;

  return (
    <div className="rd-scroll">
      {/* Header */}
      <div className="rd-header">
        <span className="rd-header-title">Read Scriptures</span>
        <button className="rd-header-action" onClick={() => inputRef.current?.focus()}>🔍</button>
      </div>

      {/* Search Bar */}
      <form className="rd-search-bar" onSubmit={handleSearchSubmit}>
        <span className="rd-search-icon">🔍</span>
        <input
          ref={inputRef}
          className="rd-search-input"
          type="text"
          placeholder="Search topics, names, or references (John 3:16)..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
      </form>

      {/* Topic Chips */}
      <div className="rd-topic-chips">
        {TOPIC_CHIPS.map(t => (
          <button key={t} className="rd-topic-chip" onClick={() => onTopicSearch(t)}>
            {t}
          </button>
        ))}
      </div>

      {/* Continue Reading */}
      {lastRead && (
        <div className="rd-continue" onClick={() => onOpenChapter(lastRead.bookId, lastRead.chapterId, lastRead.verseAnchor)}>
          <div className="rd-continue-info">
            <span className="rd-continue-label">Continue Reading</span>
            <span className="rd-continue-ref">{lastRead.label || 'Last position'}</span>
          </div>
          <button className="rd-continue-btn">Resume</button>
        </div>
      )}

      {/* Spaced Review */}
      {reviewItems.length > 0 && (
        <>
          <div className="rd-section-label">📖 For Review</div>
          {reviewItems.map((item, i) => (
            <div key={i} className="rd-result-card" onClick={() => onOpenChapter(item.book_id, item.chapter_id, item.verse_id)}>
              <div className="rd-result-ref">{item.book_title} {item.chapter_number}:{item.verse_number}</div>
              <div className="rd-result-text">{item.scripture_text}</div>
            </div>
          ))}
        </>
      )}

      {/* Reading Progress */}
      {coverage && coverage.total > 0 && (
        <div className="rd-continue" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
          <span className="rd-continue-label">Your Reading</span>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--rd-border)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (coverage.read / coverage.total) * 100)}%`, height: '100%', background: 'var(--rd-accent)', borderRadius: 3 }} />
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--rd-dim)' }}>{coverage.read} of {coverage.total} chapters</span>
        </div>
      )}

      {/* Books Grid */}
      <div className="rd-section-label">Books of Scripture</div>
      <div className="rd-book-grid">
        {books.map(b => (
          <button key={b.id} className="rd-book-item" onClick={() => onOpenChapter(b.id, null)}>
            {b.book_title}
          </button>
        ))}
      </div>

      {/* Bottom padding for tab bar */}
      <div style={{ height: 80 }} />
    </div>
  );
}
