/**
 * Reader — Immersive scripture browser. Books → Chapters → Verses.
 * Features: reading themes, font controls, text highlighting, chapter nav,
 * progress bar, last-read tracking, copy, verse context sheet, bookmarks.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { SERVER_URL } from '../socket';
import { addToast } from '../hooks/useToast';
import './Reader.css';

const VOLUMES = {
  'Old Testament': '📜',
  'New Testament': '✝️',
  'Book of Mormon': '📘',
  'Doctrine and Covenants': '📗',
  'Pearl of Great Price': '📙',
};

const READING_THEMES = [
  { name: 'Night', bg: '#0a0a0f', text: '#c8c4bc', accent: '#c9a84c' },
  { name: 'Dim', bg: '#1a1a24', text: '#d4d0c8', accent: '#c9a84c' },
  { name: 'Sepia', bg: '#f4ecd8', text: '#3c3226', accent: '#8a6914' },
  { name: 'Day', bg: '#ffffff', text: '#1a1a1a', accent: '#b8860b' },
  { name: 'AMOLED', bg: '#000000', text: '#e0dcd4', accent: '#c9a84c' },
];

const READER_FONTS = [
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Garamond', value: "'EB Garamond', Georgia, serif" },
  { label: 'Sans', value: "Inter, -apple-system, sans-serif" },
  { label: 'Dyslexic', value: 'OpenDyslexic, Arial, sans-serif' },
];

const HIGHLIGHT_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#A78BFA'];

function getLastRead() {
  try { return JSON.parse(localStorage.getItem('scicp_last_read') || 'null'); }
  catch { return null; }
}
function saveLastRead(data) {
  localStorage.setItem('scicp_last_read', JSON.stringify(data));
}
function getHighlights() {
  try { return JSON.parse(localStorage.getItem('scicp_highlights') || '{}'); }
  catch { return {}; }
}
function saveHighlights(h) {
  localStorage.setItem('scicp_highlights', JSON.stringify(h));
}
function getReaderPrefs() {
  try { return JSON.parse(localStorage.getItem('scicp_reader_prefs') || '{}'); }
  catch { return {}; }
}
function saveReaderPrefs(p) {
  localStorage.setItem('scicp_reader_prefs', JSON.stringify(p));
}

export default function ReaderPage({ onStage, bookmarks, toggleBookmark, isBookmarked }) {
  const [view, setView] = useState('books');
  const [books, setBooks] = useState([]);
  const [chapters, setChapters] = useState([]);
  const [verses, setVerses] = useState([]);
  const [selectedBook, setSelectedBook] = useState(null);
  const [selectedChapter, setSelectedChapter] = useState(null);
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState('en');

  // Reading preferences
  const prefs = getReaderPrefs();
  const [readingTheme, setReadingTheme] = useState(prefs.theme || 0);
  const [fontSize, setFontSize] = useState(prefs.fontSize || 16);
  const [fontFamily, setFontFamily] = useState(prefs.fontFamily || READER_FONTS[0].value);
  const [lineHeight, setLineHeight] = useState(prefs.lineHeight || 1.7);
  const [showControls, setShowControls] = useState(false);

  // Highlighting
  const [highlights, setHighlights] = useState(getHighlights);
  const [activeHighlight, setActiveHighlight] = useState(HIGHLIGHT_COLORS[0]);

  // Context sheet
  const [contextVerse, setContextVerse] = useState(null);
  const [contextData, setContextData] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Progress
  const versesRef = useRef(null);
  const [scrollProgress, setScrollProgress] = useState(0);

  // Last read
  const lastRead = getLastRead();

  // Persist prefs
  useEffect(() => {
    saveReaderPrefs({ theme: readingTheme, fontSize, fontFamily, lineHeight });
  }, [readingTheme, fontSize, fontFamily, lineHeight]);

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
    setScrollProgress(0);
    try {
      const res = await fetch(`${SERVER_URL}/browse/verses?chapter_id=${chapter.id}&language=${language}`);
      if (res.ok) {
        const data = await res.json();
        setVerses(data);
        saveLastRead({
          book: selectedBook, chapter, ts: Date.now(),
        });
      }
    } catch { /* offline */ }
    setLoading(false);
  };

  const goBack = () => {
    if (view === 'verses') { setView('chapters'); setVerses([]); setContextVerse(null); }
    else if (view === 'chapters') { setView('books'); setChapters([]); setSelectedBook(null); }
  };

  // Chapter prev/next navigation
  const navigateChapter = async (dir) => {
    if (!chapters.length || !selectedChapter) return;
    const idx = chapters.findIndex(c => c.id === selectedChapter.id);
    const next = idx + (dir === 'next' ? 1 : -1);
    if (next < 0 || next >= chapters.length) return;
    await openChapter(chapters[next]);
  };

  // Track scroll progress
  const handleVerseScroll = (e) => {
    const el = e.target;
    const progress = el.scrollTop / (el.scrollHeight - el.clientHeight);
    setScrollProgress(Math.min(1, Math.max(0, progress || 0)));
  };

  // Copy verse
  const copyVerse = (v) => {
    const ref = v.verse_title || `${selectedBook?.book_title} ${selectedChapter?.chapter_number}:${v.verse_number}`;
    navigator.clipboard.writeText(`${ref}\n"${v.scripture_text}"`).then(
      () => addToast('Copied', 'success'),
      () => addToast('Copy failed', 'error')
    );
  };

  // Toggle highlight on verse
  const toggleHighlight = (verseId, color) => {
    setHighlights(prev => {
      const next = { ...prev };
      if (next[verseId] === color) { delete next[verseId]; }
      else { next[verseId] = color; }
      saveHighlights(next);
      return next;
    });
  };

  // Open context sheet for a verse
  const openContext = async (verse) => {
    if (contextVerse?.verse_id === verse.verse_id || contextVerse?.id === verse.id) {
      setContextVerse(null); return;
    }
    setContextVerse(verse);
    setContextData(null);
    setContextLoading(true);
    const vid = verse.verse_id || verse.id;
    try {
      const [relRes, sumRes] = await Promise.all([
        fetch(`${SERVER_URL}/verse/${vid}/related?language=${language}`).catch(() => null),
        fetch(`${SERVER_URL}/verse/${vid}/summary`).catch(() => null),
      ]);
      const related = relRes?.ok ? await relRes.json() : [];
      const summary = sumRes?.ok ? await sumRes.json() : null;
      setContextData({ related, summary });
    } catch { /* offline */ }
    setContextLoading(false);
  };

  // Group books by volume
  const grouped = books.reduce((acc, b) => {
    const vol = b.volume_title || 'Other';
    if (!acc[vol]) acc[vol] = [];
    acc[vol].push(b);
    return acc;
  }, {});

  const theme = READING_THEMES[readingTheme] || READING_THEMES[0];
  const verseStyles = view === 'verses' ? {
    background: theme.bg,
    color: theme.text,
    fontSize: `${fontSize}px`,
    fontFamily: fontFamily,
    lineHeight: lineHeight,
  } : {};

  return (
    <div className="reader-page safe-bottom" style={view === 'verses' ? { background: theme.bg } : {}}>
      {/* Progress bar (verses view only) */}
      {view === 'verses' && (
        <div className="reader-progress-bar">
          <div className="reader-progress-fill" style={{ width: `${scrollProgress * 100}%` }} />
        </div>
      )}

      {/* Breadcrumb navigation */}
      {view !== 'books' && (
        <div className="reader-breadcrumb" style={view === 'verses' ? { background: theme.bg, color: theme.text } : {}}>
          <button className="btn btn-ghost btn-sm" onClick={goBack} style={view === 'verses' ? { color: theme.accent } : {}}>
            ‹ Back
          </button>
          <span className="text-sm" style={view === 'verses' ? { color: theme.text, opacity: 0.7 } : { color: 'var(--text-secondary)' }}>
            {selectedBook?.book_title}
            {selectedChapter ? ` ${selectedChapter.chapter_number}` : ''}
          </span>
          {view === 'verses' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowControls(!showControls)} style={{ color: theme.accent }}>
              ⚙
            </button>
          )}
        </div>
      )}

      {/* Reading controls panel */}
      {view === 'verses' && showControls && (
        <div className="reader-controls" style={{ background: theme.bg, borderColor: `${theme.text}20` }}>
          {/* Reading themes */}
          <div className="rc-row">
            <span className="rc-label" style={{ color: theme.text }}>Theme</span>
            <div className="rc-chips">
              {READING_THEMES.map((t, i) => (
                <button
                  key={i}
                  className={`rc-theme-btn ${readingTheme === i ? 'rc-active' : ''}`}
                  style={{ background: t.bg, color: t.text, borderColor: readingTheme === i ? t.accent : `${t.text}30` }}
                  onClick={() => setReadingTheme(i)}
                >
                  {t.name[0]}
                </button>
              ))}
            </div>
          </div>
          {/* Font size */}
          <div className="rc-row">
            <span className="rc-label" style={{ color: theme.text }}>Size {fontSize}px</span>
            <input type="range" min="12" max="28" value={fontSize} onChange={e => setFontSize(Number(e.target.value))}
              className="rc-slider" style={{ accentColor: theme.accent }} />
          </div>
          {/* Font family */}
          <div className="rc-row">
            <span className="rc-label" style={{ color: theme.text }}>Font</span>
            <div className="rc-chips">
              {READER_FONTS.map((f, i) => (
                <button
                  key={i}
                  className={`btn btn-sm ${fontFamily === f.value ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontFamily: f.value, fontSize: '0.7rem' }}
                  onClick={() => setFontFamily(f.value)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {/* Line height */}
          <div className="rc-row">
            <span className="rc-label" style={{ color: theme.text }}>Line {lineHeight.toFixed(1)}</span>
            <input type="range" min="1.2" max="2.4" step="0.1" value={lineHeight}
              onChange={e => setLineHeight(Number(e.target.value))}
              className="rc-slider" style={{ accentColor: theme.accent }} />
          </div>
          {/* Highlight color */}
          <div className="rc-row">
            <span className="rc-label" style={{ color: theme.text }}>Highlight</span>
            <div className="rc-chips">
              {HIGHLIGHT_COLORS.map(c => (
                <button
                  key={c}
                  className={`highlight-color-swatch ${activeHighlight === c ? 'hc-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setActiveHighlight(c)}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Continue reading banner */}
      {view === 'books' && lastRead && (
        <div className="reader-continue card" onClick={() => {
          if (lastRead.book && lastRead.chapter) {
            setSelectedBook(lastRead.book);
            openBook(lastRead.book).then(() => openChapter(lastRead.chapter));
          }
        }}>
          <p className="text-xs text-dim font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            📖 Continue Reading
          </p>
          <p className="text-sm text-gold font-medium">
            {lastRead.book?.book_title} {lastRead.chapter?.chapter_number}
          </p>
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
        <div className="reader-books scroll-area" style={{ flex: 1 }}>
          {Object.entries(grouped).map(([volume, volumeBooks]) => (
            <section key={volume} className="reader-section">
              <h3 className="reader-section-label text-xs text-dim font-semibold">
                {VOLUMES[volume] || '📖'} {volume.toUpperCase()}
              </h3>
              <div className="reader-book-grid">
                {volumeBooks.map(book => (
                  <button key={book.id} className="reader-book-btn card" onClick={() => openBook(book)}>
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
        <div className="reader-chapters scroll-area" style={{ flex: 1 }}>
          <h3 className="reader-section-label text-xs text-dim font-semibold">
            {selectedBook?.book_title} — CHAPTERS
          </h3>
          <div className="reader-chapter-grid">
            {chapters.map(ch => (
              <button key={ch.id} className="reader-chapter-btn" onClick={() => openChapter(ch)}>
                {ch.chapter_number}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Verse list */}
      {view === 'verses' && !loading && (
        <div className="reader-verses scroll-area" ref={versesRef} onScroll={handleVerseScroll}
          style={{ ...verseStyles, flex: 1 }}>
          {verses.map((v, i) => {
            const vid = v.verse_id || v.id;
            const title = v.verse_title || `${selectedBook?.book_title} ${selectedChapter?.chapter_number}:${v.verse_number}`;
            const marked = isBookmarked?.(vid);
            const hlColor = highlights[vid];
            return (
              <div key={vid || i}
                className={`reader-verse ${contextVerse && (contextVerse.verse_id || contextVerse.id) === vid ? 'rv-context-open' : ''}`}
                style={hlColor ? { borderLeft: `3px solid ${hlColor}`, paddingLeft: 10, background: `${hlColor}10` } : {}}
              >
                <div className="reader-verse-header">
                  <span className="reader-verse-num" style={{ color: theme.accent }}>{v.verse_number}</span>
                  <div className="reader-verse-actions">
                    <button className="rv-action" onClick={() => toggleHighlight(vid, activeHighlight)}
                      style={{ background: activeHighlight, opacity: hlColor ? 1 : 0.4 }} title="Highlight">
                    </button>
                    <button className="rv-action-text" onClick={() => copyVerse(v)}
                      style={{ color: `${theme.text}80` }}>📋</button>
                    <button
                      className={`rv-action-text ${marked ? 'bookmark-active' : ''}`}
                      onClick={() => toggleBookmark?.({ ...v, verse_id: vid, verse_title: title, book_title: selectedBook?.book_title, chapter_number: selectedChapter?.chapter_number })}
                      style={{ color: marked ? theme.accent : `${theme.text}60` }}
                    >
                      {marked ? '🔖' : '🏷️'}
                    </button>
                    <button className="rv-action-text" onClick={() => openContext(v)}
                      style={{ color: contextVerse && (contextVerse.verse_id || contextVerse.id) === vid ? theme.accent : `${theme.text}60` }}>
                      ℹ️
                    </button>
                    <button className="btn btn-sm btn-primary" style={{ fontSize: '0.7rem', minHeight: 28, padding: '4px 10px' }}
                      onClick={() => onStage({ ...v, verse_id: vid, verse_title: title, book_title: selectedBook?.book_title, chapter_number: selectedChapter?.chapter_number })}>
                      Stage
                    </button>
                  </div>
                </div>
                <p className="reader-verse-text" style={{ color: theme.text }}>{v.scripture_text}</p>

                {/* Context sheet inline */}
                {contextVerse && (contextVerse.verse_id || contextVerse.id) === vid && (
                  <div className="verse-context-sheet" style={{ background: `${theme.text}08`, borderColor: `${theme.text}15` }}>
                    {contextLoading && <div className="spinner" style={{ margin: '12px auto' }} />}
                    {contextData?.summary && (
                      <div className="vc-section">
                        <p className="vc-label" style={{ color: theme.accent }}>About</p>
                        <p className="text-sm" style={{ color: theme.text, opacity: 0.85 }}>
                          {typeof contextData.summary === 'string' ? contextData.summary : contextData.summary?.summary || contextData.summary?.text || 'No summary available'}
                        </p>
                      </div>
                    )}
                    {contextData?.related?.length > 0 && (
                      <div className="vc-section">
                        <p className="vc-label" style={{ color: theme.accent }}>Related Verses</p>
                        {contextData.related.slice(0, 5).map((r, ri) => (
                          <button key={ri} className="vc-related-item" style={{ color: theme.text }}
                            onClick={() => onStage(r)}>
                            <span className="font-medium" style={{ color: theme.accent }}>
                              {r.verse_title || `${r.book_title} ${r.chapter_number}:${r.verse_number}`}
                            </span>
                            <span className="text-xs" style={{ opacity: 0.6 }}>
                              {(r.scripture_text || '').slice(0, 100)}…
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {/* Chapter navigation footer */}
          <div className="chapter-nav-footer">
            <button className="btn btn-secondary btn-sm"
              onClick={() => navigateChapter('prev')}
              disabled={!chapters.length || chapters[0]?.id === selectedChapter?.id}
              style={{ color: theme.text }}>
              ‹ Prev Chapter
            </button>
            <span className="text-sm" style={{ color: theme.accent }}>
              Ch. {selectedChapter?.chapter_number}
            </span>
            <button className="btn btn-secondary btn-sm"
              onClick={() => navigateChapter('next')}
              disabled={!chapters.length || chapters[chapters.length - 1]?.id === selectedChapter?.id}
              style={{ color: theme.text }}>
              Next Chapter ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
