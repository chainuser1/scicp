/**
 * Browse.jsx — 3-level hierarchical scripture browser.
 * Level 1: Volume pills → book list
 * Level 2: Chapter grid (5 columns)
 * Level 3: Verse list with 🔴 go-live dots
 */
import { useState, useEffect } from 'react';
import { SERVER_URL } from '../socket';
import './Browse.css';

const VOLUMES = [
  { id: 1, label: 'OT', name: 'Old Testament' },
  { id: 2, label: 'NT', name: 'New Testament' },
  { id: 3, label: 'BoM', name: 'Book of Mormon' },
  { id: 4, label: 'D&C', name: 'Doctrine and Covenants' },
  { id: 5, label: 'PGP', name: 'Pearl of Great Price' },
];

export default function Browse({ onStage, onGoLive }) {
  const [level, setLevel] = useState('books'); // books | chapters | verses
  const [activeVolume, setActiveVolume] = useState(1);
  const [books, setBooks] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [verses, setVerses] = useState([]);
  const [loading, setLoading] = useState(false);

  // Fetch books on mount or volume change
  useEffect(() => {
    setLoading(true);
    fetch(`${SERVER_URL}/browse/books?language=${localStorage.getItem('scicp_language') || 'en'}`)
      .then(r => r.json())
      .then(data => {
        setBooks(data.books || data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredBooks = books.filter(b => {
    const vid = b.volume_id || b.volumeId;
    return vid === activeVolume;
  });

  const handleBookSelect = (book) => {
    setSelectedBook(book);
    setLevel('chapters');
    setLoading(true);
    fetch(`${SERVER_URL}/browse/chapters?book_id=${book.id}&language=${localStorage.getItem('scicp_language') || 'en'}`)
      .then(r => r.json())
      .then(data => {
        setChapters(data.chapters || data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const handleChapterSelect = (chapter) => {
    setSelectedChapter(chapter);
    setLevel('verses');
    setLoading(true);
    const chId = chapter.id || chapter.chapter_id;
    fetch(`${SERVER_URL}/browse/verses?chapter_id=${chId}&language=${localStorage.getItem('scicp_language') || 'en'}`)
      .then(r => r.json())
      .then(data => {
        setVerses(data.verses || data || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  const handleBack = () => {
    if (level === 'verses') {
      setLevel('chapters');
      setVerses([]);
      setSelectedChapter(null);
    } else if (level === 'chapters') {
      setLevel('books');
      setChapters([]);
      setSelectedBook(null);
    }
  };

  const getVerseRef = (v) =>
    v.verse_title || `${selectedBook?.book_title || ''} ${selectedChapter?.chapter_number || ''}:${v.verse_number}`;

  return (
    <div className="browse-page scroll-area">
      {/* Breadcrumb */}
      {level !== 'books' && (
        <div className="browse-breadcrumb">
          <button className="browse-back" onClick={handleBack}>‹</button>
          {level === 'chapters' && (
            <span className="browse-crumb">
              {VOLUMES.find(v => v.id === activeVolume)?.label} › {selectedBook?.book_title}
            </span>
          )}
          {level === 'verses' && (
            <span className="browse-crumb">
              {selectedBook?.book_title} › Chapter {selectedChapter?.chapter_number}
            </span>
          )}
        </div>
      )}

      {/* Level 1: Volume pills + Book list */}
      {level === 'books' && (
        <>
          <div className="volume-pills">
            {VOLUMES.map(v => (
              <button
                key={v.id}
                className={`volume-pill ${activeVolume === v.id ? 'volume-pill-active' : ''}`}
                onClick={() => setActiveVolume(v.id)}
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="volume-label">{VOLUMES.find(v => v.id === activeVolume)?.name.toLowerCase()}</div>
          {loading ? (
            <div className="browse-loading"><div className="spinner" /></div>
          ) : (
            <div className="book-list">
              {filteredBooks.map(book => (
                <button
                  key={book.id}
                  className="book-item"
                  onClick={() => handleBookSelect(book)}
                >
                  <div className="book-info">
                    <span className="book-name">{book.book_title}</span>
                    <span className="book-meta">
                      {book.chapter_count || book.chapters || '?'} chapters
                    </span>
                  </div>
                  <span className="book-chevron">›</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Level 2: Chapter grid */}
      {level === 'chapters' && (
        <>
          <div className="chapter-count">
            {chapters.length} chapters
          </div>
          {loading ? (
            <div className="browse-loading"><div className="spinner" /></div>
          ) : (
            <div className="chapter-grid">
              {chapters.map(ch => (
                <button
                  key={ch.id || ch.chapter_id}
                  className="chapter-cell"
                  onClick={() => handleChapterSelect(ch)}
                >
                  {ch.chapter_number}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* Level 3: Verse list */}
      {level === 'verses' && (
        <>
          {loading ? (
            <div className="browse-loading"><div className="spinner" /></div>
          ) : (
            <div className="verse-list">
              {verses.map(v => (
                <div key={v.verse_id || v.id} className="verse-row" onClick={() => onStage(v)}>
                  <span className="verse-num">{v.verse_number}</span>
                  <p className="verse-text-browse">{v.scripture_text}</p>
                  <button
                    className="go-live-dot"
                    onClick={(e) => { e.stopPropagation(); onGoLive(v); }}
                    aria-label="Go live"
                  >
                    <span className="dot-red" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
