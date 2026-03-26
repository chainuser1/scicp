/**
 * ReaderBrowse.jsx — Search results + hierarchical browse.
 * Matches mockup screen 2.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { SERVER_URL } from '../../socket';

const VOLUMES = [
  { label: 'Old Testament', filter: 'Old Testament' },
  { label: 'New Testament', filter: 'New Testament' },
  { label: 'Book of Mormon', filter: 'Book of Mormon' },
  { label: 'D&C', filter: 'Doctrine and Covenants' },
  { label: 'Pearl of Great Price', filter: 'Pearl of Great Price' },
];

export default function ReaderBrowse({ prefs, onOpenChapter }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  // Browse state
  const [books, setBooks] = useState([]);
  const [volumeFilter, setVolumeFilter] = useState(null);
  const [selectedBook, setSelectedBook] = useState(null);
  const [chapters, setChapters] = useState([]);

  const searchTimer = useRef(null);

  // Load books on mount
  useEffect(() => {
    fetch(`${SERVER_URL}/browse/books?language=${prefs.lang}`)
      .then(r => r.ok ? r.json() : [])
      .then(setBooks)
      .catch(() => {});
  }, [prefs.lang]);

  // Load chapters when book selected
  useEffect(() => {
    if (!selectedBook) return;
    fetch(`${SERVER_URL}/browse/chapters?bookId=${selectedBook.id}`)
      .then(r => r.ok ? r.json() : [])
      .then(setChapters)
      .catch(() => {});
  }, [selectedBook]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLoading(true);
      setPage(1);
      fetch(`${SERVER_URL}/search?q=${encodeURIComponent(query)}&page=1&pageSize=20&language=${prefs.lang}`)
        .then(r => r.ok ? r.json() : { results: [] })
        .then(data => {
          setResults(data.results || []);
          setHasMore((data.results || []).length >= 20);
          setLoading(false);
        })
        .catch(() => setLoading(false));
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query, prefs.lang]);

  const loadMore = useCallback(() => {
    const nextPage = page + 1;
    setLoading(true);
    fetch(`${SERVER_URL}/search?q=${encodeURIComponent(query)}&page=${nextPage}&pageSize=20&language=${prefs.lang}`)
      .then(r => r.ok ? r.json() : { results: [] })
      .then(data => {
        setResults(prev => [...prev, ...(data.results || [])]);
        setHasMore((data.results || []).length >= 20);
        setPage(nextPage);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [page, query, prefs.lang]);

  const isSearching = query.trim().length > 0;
  const filteredBooks = volumeFilter
    ? books.filter(b => (b.volume_title || '').includes(volumeFilter))
    : books;

  return (
    <div className="rd-scroll">
      {/* Header */}
      <div className="rd-header">
        {(selectedBook || volumeFilter) ? (
          <button className="rd-header-back" onClick={() => {
            if (selectedBook) { setSelectedBook(null); setChapters([]); }
            else setVolumeFilter(null);
          }}>
            ← Back
          </button>
        ) : (
          <span className="rd-header-title">Browse</span>
        )}
      </div>

      {/* Search Bar */}
      <div className="rd-search-bar">
        <span className="rd-search-icon">🔍</span>
        <input
          className="rd-search-input"
          type="text"
          placeholder="Search scriptures..."
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* Search Results */}
      {isSearching && (
        <div>
          {loading && results.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--rd-dim)' }}>Searching...</div>
          )}
          {results.map((v, i) => (
            <div key={v.verse_id || i} className="rd-result-card"
              onClick={() => onOpenChapter(v.book_id, v.chapter_id, v.verse_id)}>
              <div className="rd-result-ref">
                {v.book_title} {v.chapter_number}:{v.verse_number}
              </div>
              <div className="rd-result-text">{v.scripture_text}</div>
              <button className="rd-result-open">Open chapter ›</button>
            </div>
          ))}
          {hasMore && !loading && (
            <button className="rd-result-open" style={{ display: 'block', padding: '16px', width: '100%', textAlign: 'center' }}
              onClick={loadMore}>Load more</button>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--rd-dim)' }}>No results found</div>
          )}
        </div>
      )}

      {/* Browse: Volume Pills */}
      {!isSearching && !selectedBook && !volumeFilter && (
        <>
          <div className="rd-section-label">Volumes</div>
          <div className="rd-topic-chips" style={{ paddingBottom: 16 }}>
            {VOLUMES.map(v => (
              <button key={v.filter} className="rd-topic-chip" onClick={() => setVolumeFilter(v.filter)}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="rd-section-label">All Books</div>
          <div className="rd-book-grid">
            {books.map(b => (
              <button key={b.id} className="rd-book-item" onClick={() => setSelectedBook(b)}>
                {b.book_title}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Browse: Filtered Books */}
      {!isSearching && !selectedBook && volumeFilter && (
        <>
          <div className="rd-section-label">{volumeFilter}</div>
          <div className="rd-book-grid">
            {filteredBooks.map(b => (
              <button key={b.id} className="rd-book-item" onClick={() => setSelectedBook(b)}>
                {b.book_title}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Browse: Chapters */}
      {!isSearching && selectedBook && (
        <>
          <div className="rd-section-label">{selectedBook.book_title}</div>
          <div className="rd-book-grid">
            {chapters.map(c => (
              <button key={c.id} className="rd-book-item" onClick={() => onOpenChapter(selectedBook.id, c.id)}>
                Chapter {c.chapter_number}
              </button>
            ))}
          </div>
        </>
      )}

      <div style={{ height: 80 }} />
    </div>
  );
}
