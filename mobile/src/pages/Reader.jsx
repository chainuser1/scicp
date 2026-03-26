/**
 * Reader — Scripture browser. Books → Chapters → Verses.
 * All data fetched from backend REST API.
 */
import { useState, useEffect, useCallback } from 'react';
import { SERVER_URL } from '../socket';
import './Reader.css';

const VOLUMES = {
  'Old Testament': '📜',
  'New Testament': '✝️',
  'Book of Mormon': '📘',
  'Doctrine and Covenants': '📗',
  'Pearl of Great Price': '📙',
};

export default function ReaderPage({ onStage, bookmarks, toggleBookmark, isBookmarked }) {
  const [view, setView] = useState('books');
  const [books, setBooks] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [verses, setVerses] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('en');

  const fetchBooks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/browse/books?language=${language}`);
      if (res.ok) setBooks(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  }, [language]);

  useEffect(() => { fetchBooks(); }, [fetchBooks]);

  const openBook = async (book) => {
    setSelectedBook(book);
    setView('chapters');
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/browse/chapters?book_id=${book.id}&language=${language}`);
      if (res.ok) setChapters(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  };

  const openChapter = async (chapter) => {
    setSelectedChapter(chapter);
    setView('verses');
    setLoading(true);
    try {
      const res = await fetch(`${SERVER_URL}/browse/verses?chapter_id=${chapter.id}&language=${language}`);
      if (res.ok) setVerses(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  };

  const goBack = () => {
    if (view === 'verses') { setView('chapters'); setVerses([]); }
    else if (view === 'chapters') { setView('books'); setChapters([]); setSelectedBook(null); }
  };

  // Group books by volume
  const grouped = books.reduce((acc, b) => {
    const vol = b.volume_title || 'Other';
    if (!acc[vol]) acc[vol] = [];
    acc[vol].push(b);
    return acc;
  }, {});

  return (
    <div className="reader-page scroll-area safe-bottom">
      {/* Breadcrumb navigation */}
      {view !== 'books' && (
        <div className="reader-breadcrumb">
          <button className="btn btn-ghost btn-sm" onClick={goBack}>
            ‹ Back
          </button>
          <span className="text-sm text-secondary">
            {selectedBook?.book_title}
            {selectedChapter ? ` ${selectedChapter.chapter_number}` : ''}
          </span>
        </div>
      )}

      {/* Bookmarks section at top of book list */}
      {view === 'books' && bookmarks?.length > 0 && (
        <section className="reader-section">
          <h3 className="reader-section-label text-xs text-dim font-semibold">
            🔖 BOOKMARKS ({bookmarks.length})
          </h3>
          <div className="reader-bookmark-list">
            {bookmarks.slice(0, 10).map((v, i) => (
              <button key={v.verse_id || i} className="reader-bm-item card" onClick={() => onStage(v)}>
                <span className="text-sm text-gold font-medium">
                  {v.verse_title || `${v.book_title} ${v.chapter_number}:${v.verse_number}`}
                </span>
                <span className="text-xs text-dim">
                  {(v.scripture_text || '').slice(0, 80)}…
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {loading && (
        <div className="search-loading"><div className="spinner" /></div>
      )}

      {/* Book list */}
      {view === 'books' && !loading && (
        <div className="reader-books">
          {Object.entries(grouped).map(([volume, volumeBooks]) => (
            <section key={volume} className="reader-section">
              <h3 className="reader-section-label text-xs text-dim font-semibold">
                {VOLUMES[volume] || '📖'} {volume.toUpperCase()}
              </h3>
              <div className="reader-book-grid">
                {volumeBooks.map(book => (
                  <button
                    key={book.id}
                    className="reader-book-btn card"
                    onClick={() => openBook(book)}
                  >
                    <span className="text-sm font-medium">{book.book_title}</span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* Chapter grid */}
      {view === 'chapters' && !loading && (
        <div className="reader-chapters">
          <h3 className="reader-section-label text-xs text-dim font-semibold">
            {selectedBook?.book_title} — CHAPTERS
          </h3>
          <div className="reader-chapter-grid">
            {chapters.map(ch => (
              <button
                key={ch.id}
                className="reader-chapter-btn"
                onClick={() => openChapter(ch)}
              >
                {ch.chapter_number}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Verse list */}
      {view === 'verses' && !loading && (
        <div className="reader-verses">
          {verses.map((v, i) => {
            const title = v.verse_title || `${selectedBook?.book_title} ${selectedChapter?.chapter_number}:${v.verse_number}`;
            const marked = isBookmarked?.(v.verse_id);
            return (
              <div key={v.id || i} className="reader-verse">
                <div className="reader-verse-header">
                  <span className="reader-verse-num">{v.verse_number}</span>
                  <div className="reader-verse-actions">
                    <button
                      className={`btn-icon btn-sm ${marked ? 'bookmark-active' : ''}`}
                      onClick={() => toggleBookmark?.({ ...v, verse_title: title, book_title: selectedBook?.book_title, chapter_number: selectedChapter?.chapter_number })}
                      title={marked ? 'Remove bookmark' : 'Bookmark'}
                    >
                      {marked ? '🔖' : '🏷️'}
                    </button>
                    <button
                      className="btn btn-sm btn-primary"
                      onClick={() => onStage({ ...v, verse_title: title, book_title: selectedBook?.book_title, chapter_number: selectedChapter?.chapter_number })}
                    >
                      Stage
                    </button>
                  </div>
                </div>
                <p className="reader-verse-text text-sm">{v.scripture_text}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
