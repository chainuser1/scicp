/**
 * ReaderBookmarks.jsx — Bookmarks screen with search, Latest/Categories tabs.
 * Matches mockup screen 4.
 */
import { useState, useCallback, useMemo } from 'react';

export default function ReaderBookmarks({ bookmarks, onOpenChapter }) {
  const [segment, setSegment] = useState('latest');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => bookmarks.search(search), [bookmarks, search]);

  const handleOpen = useCallback((bm) => {
    onOpenChapter(null, null, bm.verse_id);
  }, [onOpenChapter]);

  return (
    <div className="rd-scroll">
      <div className="rd-header">
        <span className="rd-header-title">Bookmarks</span>
        <span className="rd-header-action" style={{ fontSize: '0.8125rem', color: 'var(--rd-dim)' }}>
          {bookmarks.count} saved
        </span>
      </div>

      {/* Search */}
      <div className="rd-search-bar">
        <span className="rd-search-icon">🔍</span>
        <input
          className="rd-search-input"
          type="text"
          placeholder="Search bookmarks"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* Segment */}
      <div className="rd-segment">
        <button
          className={`rd-segment-btn${segment === 'latest' ? ' rd-segment-btn-active' : ''}`}
          onClick={() => setSegment('latest')}
        >Latest</button>
        <button
          className={`rd-segment-btn${segment === 'categories' ? ' rd-segment-btn-active' : ''}`}
          onClick={() => setSegment('categories')}
        >Categories</button>
      </div>

      {/* Latest */}
      {segment === 'latest' && (
        <>
          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--rd-dim)' }}>
              <div style={{ fontSize: '2rem', marginBottom: 12 }}>🔖</div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 600 }}>No bookmarks yet</div>
              <div style={{ fontSize: '0.8125rem', marginTop: 4 }}>Long-press a verse to bookmark it</div>
            </div>
          )}
          {filtered.map(bm => (
            <div key={bm.verse_id} className="rd-bm-card" onClick={() => handleOpen(bm)}>
              <div className="rd-bm-ref">
                {bm.book_title} {bm.chapter_number}:{bm.verse_number}
              </div>
              <div className="rd-bm-text">{bm.scripture_text}</div>
            </div>
          ))}
        </>
      )}

      {/* Categories — group by book */}
      {segment === 'categories' && (
        <>
          {Object.keys(bookmarks.byBook).length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--rd-dim)' }}>No bookmarks</div>
          )}
          {Object.entries(bookmarks.byBook).map(([bookTitle, items]) => (
            <div key={bookTitle}>
              <div className="rd-section-label">{bookTitle}</div>
              {items.map(bm => (
                <div key={bm.verse_id} className="rd-bm-card" onClick={() => handleOpen(bm)}>
                  <div className="rd-bm-ref">
                    {bm.chapter_number}:{bm.verse_number}
                  </div>
                  <div className="rd-bm-text">{bm.scripture_text}</div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}

      <div style={{ height: 80 }} />
    </div>
  );
}
