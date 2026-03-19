/**
 * ScriptureReader — personal scripture reading mode.
 * No sockets, no casting, no presenting. Just read.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as svc from '../scripture-service';

const LANGUAGES = [
  { value: 'en',  label: 'English' },
  { value: 'tl',  label: 'Tagalog' },
  { value: 'ceb', label: 'Cebuano' },
];

export default function ScriptureReader({ onExit }) {
  const [lang, setLang]             = useState('en');
  const [tab, setTab]               = useState('search'); // 'search' | 'browse'
  const [query, setQuery]           = useState('');
  const [results, setResults]       = useState([]);
  const [searching, setSearching]   = useState(false);
  const [page, setPage]             = useState(0);
  const [hasMore, setHasMore]       = useState(false);
  // Browse state
  const [books, setBooks]           = useState([]);
  const [selBook, setSelBook]       = useState(null);
  const [chapters, setChapters]     = useState([]);
  const [selChapter, setSelChapter] = useState(null);
  const [verses, setVerses]         = useState([]);
  // Reading pane
  const [readVerse, setReadVerse]   = useState(null); // full verse detail
  const [fontSize, setFontSize]     = useState(() => {
    try { return parseFloat(localStorage.getItem('scicp.reader_font') || '1.1'); } catch { return 1.1; }
  });

  const debounce  = useRef(null);
  const PAGE_SIZE = 20;

  // ── Search ────────────────────────────────────────────────────────────────
  const doSearch = useCallback((q, p = 0, append = false) => {
    if (!q.trim()) { setResults([]); setHasMore(false); return; }
    setSearching(true);
    // svc.search is async
    svc.search(q, p, PAGE_SIZE, lang).then(data => {
      const list = data?.results ?? data ?? [];
      setResults(prev => append ? [...prev, ...list] : list);
      setHasMore(list.length === PAGE_SIZE);
      setSearching(false);
    }).catch(() => setSearching(false));
  }, [lang]);

  const handleQueryChange = e => {
    const q = e.target.value;
    setQuery(q);
    setPage(0);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => doSearch(q, 0, false), 300);
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    doSearch(query, next, true);
  };

  // Re-search when language changes
  useEffect(() => {
    if (query.trim()) doSearch(query, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // ── Browse — books ────────────────────────────────────────────────────────
  useEffect(() => {
    if (tab !== 'browse') return;
    try {
      const b = svc.browse('books', {}, lang);
      setBooks(b || []);
    } catch { setBooks([]); }
  }, [tab, lang]);

  const selectBook = book => {
    setSelBook(book);
    setSelChapter(null);
    setVerses([]);
    try {
      const ch = svc.browse('chapters', { bookId: book.book_id }, lang);
      setChapters(ch || []);
    } catch { setChapters([]); }
  };

  const selectChapter = chapter => {
    setSelChapter(chapter);
    try {
      const vs = svc.browse('verses', { chapterId: chapter.chapter_id }, lang);
      setVerses(vs || []);
    } catch { setVerses([]); }
  };

  // ── Open reading pane ─────────────────────────────────────────────────────
  const openVerse = verse => {
    try {
      const detail = svc.getVerse(verse, lang) || verse;
      setReadVerse({ ...verse, ...detail });
    } catch {
      setReadVerse(verse);
    }
  };

  const adjVerse = dir => {
    if (!readVerse) return;
    try {
      const v = svc.getAdjacent(readVerse, dir, lang);
      if (v) setReadVerse(v);
    } catch {}
  };

  const saveFontSize = size => {
    setFontSize(size);
    try { localStorage.setItem('scicp.reader_font', size); } catch {}
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="reader-root">

      {/* ── Top bar ── */}
      <div className="reader-topbar">
        <button className="reader-back" onClick={onExit} aria-label="Exit reader">‹</button>
        <span className="reader-title">Read Scriptures</span>
        <select
          className="reader-lang"
          value={lang}
          onChange={e => setLang(e.target.value)}
          aria-label="Language"
        >
          {LANGUAGES.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </div>

      {/* ── Tabs ── */}
      <div className="reader-tabs">
        <button
          className={`reader-tab${tab === 'search' ? ' reader-tab--active' : ''}`}
          onClick={() => setTab('search')}
        >🔍 Search</button>
        <button
          className={`reader-tab${tab === 'browse' ? ' reader-tab--active' : ''}`}
          onClick={() => setTab('browse')}
        >📚 Browse</button>
      </div>

      {/* ── Main content ── */}
      <div className="reader-body">

        {/* SEARCH TAB */}
        {tab === 'search' && (
          <div className="reader-search-pane">
            <input
              className="reader-search"
              type="search"
              value={query}
              onChange={handleQueryChange}
              placeholder="Search by topic, name, or reference…"
              autoComplete="off"
              autoCorrect="off"
              spellCheck="false"
            />
            {searching && <div className="reader-spinner">Searching…</div>}
            {!searching && query && results.length === 0 && (
              <div className="reader-empty">No results for "{query}"</div>
            )}
            {results.map(v => (
              <button key={v.verse_id} className="reader-verse-row" onClick={() => openVerse(v)}>
                <span className="reader-verse-ref">
                  {v.book_title} {v.chapter_number}:{v.verse_number}
                </span>
                <p className="reader-verse-preview">{v.scripture_text}</p>
              </button>
            ))}
            {hasMore && (
              <button className="reader-load-more" onClick={loadMore} disabled={searching}>
                {searching ? 'Loading…' : 'Load more'}
              </button>
            )}
          </div>
        )}

        {/* BROWSE TAB */}
        {tab === 'browse' && (
          <div className="reader-browse-pane">
            {!selBook && (
              <>
                <p className="reader-browse-hint">Choose a book</p>
                <div className="reader-book-list">
                  {books.map(b => (
                    <button key={b.book_id} className="reader-book-btn" onClick={() => selectBook(b)}>
                      {b.book_title}
                    </button>
                  ))}
                </div>
              </>
            )}
            {selBook && !selChapter && (
              <>
                <div className="reader-browse-breadcrumb">
                  <button className="reader-breadcrumb-btn" onClick={() => { setSelBook(null); setChapters([]); }}>
                    ‹ Books
                  </button>
                  <span className="reader-breadcrumb-sep">›</span>
                  <span>{selBook.book_title}</span>
                </div>
                <div className="reader-chapter-grid">
                  {chapters.map(c => (
                    <button key={c.chapter_id} className="reader-chapter-btn" onClick={() => selectChapter(c)}>
                      {c.chapter_number}
                    </button>
                  ))}
                </div>
              </>
            )}
            {selBook && selChapter && (
              <>
                <div className="reader-browse-breadcrumb">
                  <button className="reader-breadcrumb-btn" onClick={() => { setSelChapter(null); setVerses([]); }}>
                    ‹ {selBook.book_title}
                  </button>
                  <span className="reader-breadcrumb-sep">›</span>
                  <span>Chapter {selChapter.chapter_number}</span>
                </div>
                <div className="reader-verse-list">
                  {verses.map(v => (
                    <button key={v.verse_id} className="reader-verse-row" onClick={() => openVerse(v)}>
                      <span className="reader-verse-num">{v.verse_number}</span>
                      <p className="reader-verse-preview">{v.scripture_text}</p>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Reading pane (sheet) ── */}
      {readVerse && (
        <div className="reader-sheet-backdrop" onClick={() => setReadVerse(null)}>
          <div className="reader-sheet" onClick={e => e.stopPropagation()}>
            <div className="reader-sheet-topbar">
              <button className="reader-sheet-close" onClick={() => setReadVerse(null)}>✕</button>
              <span className="reader-sheet-ref">
                {readVerse.book_title} {readVerse.chapter_number}:{readVerse.verse_number}
              </span>
              <div className="reader-font-controls">
                <button className="reader-font-btn" onClick={() => saveFontSize(Math.max(0.8, +(fontSize - 0.1).toFixed(1)))}>A−</button>
                <button className="reader-font-btn" onClick={() => saveFontSize(Math.min(2.0, +(fontSize + 0.1).toFixed(1)))}>A+</button>
              </div>
            </div>

            <div className="reader-sheet-body" style={{ fontSize: `${fontSize}rem` }}>
              <p className="reader-sheet-text">{readVerse.scripture_text}</p>
            </div>

            <div className="reader-sheet-nav">
              <button className="reader-nav-btn" onClick={() => adjVerse('prev')}>‹ Prev</button>
              <button className="reader-nav-btn" onClick={() => adjVerse('next')}>Next ›</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
