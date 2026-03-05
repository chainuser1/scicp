import React, { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket';

const API_URL = import.meta.env.MODE === 'production' ? '' : 'http://localhost:3000';

const themes = {
  light: {
    background_url: "url('https://images.unsplash.com/photo-1513151233558-d860c5398176?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D')",
    font_family: "serif",
    font_size: "4rem",
    layout: "centered"
  },
  dark: {
    background_url: "url('https://images.unsplash.com/photo-1488866022504-f2584929ca5f?q=80&w=2062&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D')",
    font_family: "sans-serif",
    font_size: "5rem",
    layout: "lower-third"
  }
};

/* ─── Layout breakpoints (px) ─────────────────────────────── */
const BP_FULL = 1100;   // 3-column desktop
const BP_MID  = 600;    // header-bar + slide drawer

/* ─── Emblem SVG ─── */
const EmblemSVG = ({ size = 28 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="20" width="24" height="8" rx="1.5" fill="#c9a84c" opacity="0.9"/>
    <path d="M6 20 Q16 4 26 20" stroke="#c9a84c" strokeWidth="1.8" strokeLinecap="round"/>
    <circle cx="16" cy="13" r="3.5" fill="#e8c97a"/>
    <rect x="12" y="16" width="8" height="6" rx="2" fill="#e8c97a"/>
    <line x1="9" y1="18" x2="4" y2="14" stroke="#e8c97a" strokeWidth="2.2" strokeLinecap="round"/>
    <line x1="23" y1="18" x2="28" y2="14" stroke="#e8c97a" strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="16" cy="13" r="1.2" fill="#0a0a0f"/>
  </svg>
);

/* ─── Icon components ─── */
const IconSearch = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconTheme = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="5"/>
    <line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/>
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
    <line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/>
  </svg>
);
const IconChevronLeft = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="15 18 9 12 15 6"/></svg>
);
const IconChevronRight = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="9 18 15 12 9 6"/></svg>
);

const Presenter = () => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [currentTheme, setCurrentTheme] = useState(themes.light);
  const [history, setHistory] = useState([]);
  const [staged, setStaged] = useState(null);
  const [liveVerse, setLiveVerse] = useState(null);
  const [savedThemes, setSavedThemes] = useState([]);
  const [newThemeName, setNewThemeName] = useState('');
  const [bgUrlInput, setBgUrlInput] = useState('');
  const [currentSegment, setCurrentSegment] = useState(0);
  const [highlightedText, setHighlightedText] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [currentPage, setCurrentPage] = useState(0);

  /* ── Layout mode ── */
  const [layoutMode, setLayoutMode] = useState('full'); // 'full' | 'mid' | 'compact'
  const containerRef = useRef(null);

  /* ── Drawer state (mid/compact only) ── */
  const [drawerOpen, setDrawerOpen] = useState(false);   // search drawer
  const [drawerTab, setDrawerTab] = useState('search');  // 'search' | 'history'
  const [themePopover, setThemePopover] = useState(false);

  const PAGE_SIZE = 5;
  const navSource = liveVerse;

  /* ── ResizeObserver: drive layout mode from actual container width ── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w >= BP_FULL) setLayoutMode('full');
      else if (w >= BP_MID) setLayoutMode('mid');
      else setLayoutMode('compact');
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* ── Close drawer when switching back to full layout ── */
  useEffect(() => {
    if (layoutMode === 'full') setDrawerOpen(false);
  }, [layoutMode]);

  /* ── Socket listeners ── */
  useEffect(() => {
    socket.on('search-results', (data) => { setResults(data); setCurrentPage(0); });
    socket.on('update-verse', (data) => { setLiveVerse(data); setCurrentSegment(data.currentSegment || 0); });
    fetch(`${API_URL}/themes`)
      .then(r => r.json())
      .then(list => setSavedThemes(list))
      .catch(err => console.error('failed to load themes', err));
    return () => { socket.off('search-results'); socket.off('update-verse'); };
  }, []);

  /* ── Close drawer on outside click (mid/compact) ── */
  useEffect(() => {
    if (!drawerOpen) return;
    const handler = (e) => {
      if (!e.target.closest('.search-drawer') && !e.target.closest('.hdr-btn')) {
        setDrawerOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [drawerOpen]);

  const handleThemeChange = (theme) => {
    setCurrentTheme(theme);
    if (staged) setStaged(prev => ({ ...prev, theme }));
    socket.emit('update-theme', theme);
  };

  const handleSearch = (e) => {
    setQuery(e.target.value);
    setCurrentPage(0);
    socket.emit('search', e.target.value);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && results.length > 0) goLiveDirectly(results[0]);
  };

  const handleSelectVerse = (verse) => {
    const verseWithTheme = { ...verse, theme: currentTheme };
    setStaged(verseWithTheme);
    // In mid/compact: close drawer after staging so user sees the main panel update
    if (layoutMode !== 'full') setDrawerOpen(false);
  };

  const goLiveDirectly = (verse) => {
    const verseWithTheme = { ...verse, theme: currentTheme };
    socket.emit('go-live', { verse: verseWithTheme, theme: verseWithTheme.theme, language: currentLanguage });
    setLiveVerse(verseWithTheme);
    setCurrentSegment(0);
    setHistory([verseWithTheme, ...history.slice(0, 9)]);
    if (layoutMode !== 'full') setDrawerOpen(false);
  };

  const goLive = () => {
    if (!staged) return;
    socket.emit('go-live', { verse: staged, theme: staged.theme, language: currentLanguage });
    setLiveVerse(staged);
    setCurrentSegment(0);
    setHistory([staged, ...history.slice(0, 9)]);
    setStaged(null);
  };

  const handleSegmentNavigation = (direction) => {
    if (!liveVerse || !liveVerse.segments) return;
    const limit = liveVerse.segments.length - 1;
    const newSeg = direction === 'next' ? Math.min(currentSegment + 1, limit) : Math.max(currentSegment - 1, 0);
    if (newSeg !== currentSegment) {
      setCurrentSegment(newSeg);
      socket.emit('update-verse', { ...liveVerse, currentSegment: newSeg });
    }
  };

  const fetchAdjacent = async (direction, preferStaged = false) => {
    const source = preferStaged ? (staged || liveVerse) : liveVerse;
    if (!source || !source.verse_id) return;
    const params = new URLSearchParams({
      verse_id: source.verse_id, direction,
      ...(currentLanguage && ['ceb', 'tl'].includes(currentLanguage) && { language: currentLanguage })
    });
    try {
      const res = await fetch(`${API_URL}/verse/adjacent?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const verseWithTheme = { ...data, theme: currentTheme };
      if (preferStaged && staged) {
        setStaged(verseWithTheme);
      } else {
        socket.emit('go-live', { verse: verseWithTheme, theme: verseWithTheme.theme });
        setLiveVerse(verseWithTheme);
        setCurrentSegment(0);
        setHistory([verseWithTheme, ...history.slice(0, 9)]);
      }
    } catch (err) { console.error('adjacent fetch failed', err); }
  };

  const handlePreviewTextSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    const selectedText = selection.toString().trim();
    if (!selectedText) return;
    setHighlightedText(selectedText);
    socket.emit('highlight-text', selectedText);
  };

  const handleLanguageChange = (e) => {
    const lang = e.target.value;
    setCurrentLanguage(lang);
    socket.emit('update-language', lang);
    if (liveVerse) socket.emit('go-live', { verse: liveVerse, theme: currentTheme, language: lang });
  };

  const renderPreviewText = () => {
    if (!liveVerse) return '';
    const text = liveVerse.segments?.length > 0 ? liveVerse.segments[currentSegment] : liveVerse.scripture_text;
    if (!highlightedText) return text;
    const parts = text.split(new RegExp(`(${highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, idx) =>
      part.toLowerCase() === highlightedText.toLowerCase()
        ? <span key={idx} className="highlight-yellow">{part}</span>
        : part
    );
  };

  /* ─────────────────────────────────────────────────────────────────────
     SHARED BLOCKS (rendered inside different containers per layout mode)
     ───────────────────────────────────────────────────────────────────── */

  const SearchPanel = ({ compact = false }) => (
    <div className={`search-panel-inner${compact ? ' search-panel-compact' : ''}`}>
      <div className="search-panel-head">
        <span className="panel-label"><IconSearch /> Search Scripture</span>
        {query.length > 0 && (
          <span className="search-results-count">
            {results.length === 0 ? 'No results' : `${results.length} found`}
          </span>
        )}
      </div>
      <input
        type="text"
        className="search-input"
        placeholder="John 3:16 or 'faith'…"
        value={query}
        onChange={handleSearch}
        onKeyDown={handleSearchKeyDown}
        autoFocus={drawerOpen}
      />
      <div className="results-list">
        {results.length > 0 ? (() => {
          const totalPages = Math.ceil(results.length / PAGE_SIZE);
          const pageSlice = results.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
          return (
            <>
              <ul>
                {pageSlice.map(verse => (
                  <li
                    key={verse.verse_title}
                    className="result-item"
                    onClick={() => handleSelectVerse(verse)}
                    onDoubleClick={() => goLiveDirectly(verse)}
                  >
                    <div className="result-item-top">
                      <div className="result-title">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</div>
                      <button
                        className="result-live-icon"
                        onClick={e => { e.stopPropagation(); goLiveDirectly(verse); }}
                        aria-label="Go live now"
                      >●</button>
                    </div>
                    <div className="result-text">{verse.scripture_text}</div>
                  </li>
                ))}
              </ul>
              {totalPages > 1 && (
                <div className="results-pagination">
                  <button className="pagination-arrow" onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>‹</button>
                  <div className="pagination-track">
                    {Array.from({ length: totalPages }).map((_, i) => (
                      <button key={i} className={`pagination-pip ${i === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(i)} aria-label={`Page ${i + 1}`} />
                    ))}
                  </div>
                  <span className="pagination-label">{currentPage + 1}<span className="pagination-sep">/</span>{totalPages}</span>
                  <button className="pagination-arrow" onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage === totalPages - 1}>›</button>
                </div>
              )}
            </>
          );
        })() : (
          <div className="empty-state">{query.length > 0 ? 'No verses found' : 'Search for a verse to begin…'}</div>
        )}
      </div>
    </div>
  );

  const HistoryPanel = () => (
    <div className="history-panel-inner">
      <span className="panel-label"><IconClock /> Recent</span>
      {history.length > 0 ? (
        <ul className="history-list">
          {history.map((verse, i) => (
            <li key={i} className="history-item" onClick={() => { setStaged(verse); if (layoutMode !== 'full') setDrawerOpen(false); }}>
              <span className="history-ref">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="empty-state">No recent verses</div>
      )}
    </div>
  );

  /* Nav buttons — used in both header bar and main panel card */
  const NavControls = ({ size = 'normal' }) => (
    <div className={`nav-controls nav-controls--${size}`}>
      <button className="nav-btn nav-btn--verse" onClick={() => fetchAdjacent('prev')} disabled={!navSource} aria-label="Previous verse">
        <IconChevronLeft />{size === 'normal' && <span>Prev</span>}
      </button>
      <button className="nav-btn nav-btn--seg" onClick={() => handleSegmentNavigation('prev')}
        disabled={!liveVerse?.segments || liveVerse.segments.length <= 1 || currentSegment === 0} aria-label="Previous segment">
        <span className="seg-arrow">◀</span>
      </button>
      <span className="segment-counter">
        {liveVerse?.segments ? `${currentSegment + 1}/${liveVerse.segments.length}` : '—'}
      </span>
      <button className="nav-btn nav-btn--seg" onClick={() => handleSegmentNavigation('next')}
        disabled={!liveVerse?.segments || liveVerse.segments.length <= 1 || currentSegment === liveVerse.segments.length - 1} aria-label="Next segment">
        <span className="seg-arrow">▶</span>
      </button>
      <button className="nav-btn nav-btn--verse" onClick={() => fetchAdjacent('next')} disabled={!navSource} aria-label="Next verse">
        {size === 'normal' && <span>Next</span>}<IconChevronRight />
      </button>
    </div>
  );

  const ThemeButtons = ({ onClose }) => (
    <div className="theme-btn-group">
      {[
        { key: 'light', label: '☀ Light', theme: themes.light },
        { key: 'dark', label: '☽ Dark', theme: themes.dark },
        ...savedThemes.map(t => ({ key: t.id, label: t.name, theme: t.data }))
      ].map(({ key, label, theme }) => (
        <button
          key={key}
          className={`theme-btn ${currentTheme === theme ? 'active' : ''}`}
          onClick={() => { handleThemeChange(theme); onClose?.(); }}
        >{label}</button>
      ))}
    </div>
  );

  /* ─────────────────────────────────────────────────────────────────────
     LAYOUT: FULL (≥ 1100px) — classic 3-column
     ───────────────────────────────────────────────────────────────────── */
  const LayoutFull = () => (
    <>
      <header className="presenter-header presenter-header--full">
        <div className="presenter-header-left">
          <EmblemSVG size={28} />
          <div>
            <h1>Scripture Presenter</h1>
            <p>Projection control console</p>
          </div>
        </div>
        {liveVerse && (
          <div className="live-badge"><span className="live-badge-dot" />Live</div>
        )}
      </header>

      <div className="presenter-layout presenter-layout--full">
        {/* Left: Search */}
        <div className="presenter-panel search-panel">
          <h2 className="panel-heading"><span className="panel-heading-icon">🔍</span>Search Scripture</h2>
          {query.length > 0 && (
            <div className="search-results-count">
              {results.length === 0 ? 'No verses found' : results.length === 1 ? '1 verse found' : `${results.length} verses found`}
            </div>
          )}
          <input type="text" className="search-input" placeholder="e.g., John 3:16 or 'faith'…" value={query} onChange={handleSearch} onKeyDown={handleSearchKeyDown} />
          <div className="results-list">
            {results.length > 0 ? (() => {
              const totalPages = Math.ceil(results.length / PAGE_SIZE);
              const pageSlice = results.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
              return (
                <>
                  <ul>
                    {pageSlice.map(verse => (
                      <li key={verse.verse_title} className="result-item" onClick={() => handleSelectVerse(verse)} onDoubleClick={() => goLiveDirectly(verse)} title="Double-click to go live">
                        <div className="result-item-top">
                          <div className="result-title">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</div>
                          <button className="result-live-icon" onClick={e => { e.stopPropagation(); goLiveDirectly(verse); }} aria-label="Go live now">●</button>
                        </div>
                        <div className="result-text">{verse.scripture_text}</div>
                      </li>
                    ))}
                  </ul>
                  {totalPages > 1 && (
                    <div className="results-pagination">
                      <button className="pagination-arrow" onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>‹</button>
                      <div className="pagination-track">{Array.from({ length: totalPages }).map((_, i) => (<button key={i} className={`pagination-pip ${i === currentPage ? 'active' : ''}`} onClick={() => setCurrentPage(i)} aria-label={`Page ${i + 1}`} />))}</div>
                      <span className="pagination-label">{currentPage + 1}<span className="pagination-sep">/</span>{totalPages}</span>
                      <button className="pagination-arrow" onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage === totalPages - 1}>›</button>
                    </div>
                  )}
                </>
              );
            })() : <div className="empty-state">Search for a verse<br />to begin…</div>}
          </div>
        </div>

        {/* Center: Main */}
        <div className="main-panel">
          <div className="navigation-section">
            <p className="nav-label">
              <span>{liveVerse ? 'Now Live' : 'Navigation'}</span>
              <span className="nav-label-verse">{navSource ? `${navSource.book_title} ${navSource.chapter_number}:${navSource.verse_number}` : 'No verse selected'}</span>
              {liveVerse?.segments?.length > 1 && <span className="segmented-badge">Segmented</span>}
              <select className="language-select" value={currentLanguage} onChange={handleLanguageChange}>
                <option value="en">English</option>
                <option value="tl">Tagalog</option>
                <option value="ceb">Cebuano</option>
              </select>
            </p>
            <div className="nav-controls">
              <button className="persistent-nav-button" onClick={() => fetchAdjacent('prev')} disabled={!navSource}>
                <span className="nav-btn-main">← Prev</span><span className="nav-btn-icon">←</span><span className="nav-btn-label">Verse</span>
              </button>
              <button className="segment-nav-button" onClick={() => handleSegmentNavigation('prev')} disabled={!liveVerse?.segments || liveVerse.segments.length <= 1 || currentSegment === 0}>
                <span className="nav-btn-main">◀</span><span className="nav-btn-icon">◀</span><span className="nav-btn-label">Seg</span>
              </button>
              <span className="segment-counter">{liveVerse?.segments ? `${currentSegment + 1}/${liveVerse.segments.length}` : '1/1'}</span>
              <button className="segment-nav-button" onClick={() => handleSegmentNavigation('next')} disabled={!liveVerse?.segments || liveVerse.segments.length <= 1 || currentSegment === liveVerse.segments.length - 1}>
                <span className="nav-btn-main">▶</span><span className="nav-btn-icon">▶</span><span className="nav-btn-label">Seg</span>
              </button>
              <button className="persistent-nav-button" onClick={() => fetchAdjacent('next')} disabled={!navSource}>
                <span className="nav-btn-main">Next →</span><span className="nav-btn-icon">→</span><span className="nav-btn-label">Verse</span>
              </button>
            </div>
          </div>

          {staged ? (
            <div className="staged-section">
              <h2 className="panel-heading"><span className="panel-heading-icon">⏳</span>Staged</h2>
              <div className="staged-verse-display">
                <h3 className="staged-title">{staged.book_title} {staged.chapter_number}:{staged.verse_number}</h3>
                <p className="staged-text">{staged.scripture_text}</p>
              </div>
              <div className="staging-controls">
                <button className="nav-button" onClick={() => fetchAdjacent('prev', true)}>← Previous</button>
                <button className="nav-button" onClick={() => fetchAdjacent('next', true)}>Next →</button>
              </div>
              <button className="go-live-button" onClick={goLive}>● Go Live</button>
            </div>
          ) : !liveVerse ? (
            <div className="staged-section empty">
              <p className="empty-state">Select a verse from the search panel to stage it here</p>
            </div>
          ) : null}

          {liveVerse && (
            <div className="preview-section">
              <h2>Client Preview — select text to highlight</h2>
              <div className="preview-box" onMouseUp={handlePreviewTextSelection}>
                <div className="preview-title">{liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}</div>
                <div className="preview-text">{renderPreviewText()}</div>
                {liveVerse.segments && currentSegment < liveVerse.segments.length - 1 && <div className="preview-cont">cont…</div>}
              </div>
            </div>
          )}

          <div className="theme-section">
            <h2>Theme &amp; Display</h2>
            <div className="theme-buttons">
              <button className={`theme-btn ${currentTheme === themes.light ? 'active' : ''}`} onClick={() => handleThemeChange(themes.light)}>Light</button>
              <button className={`theme-btn ${currentTheme === themes.dark ? 'active' : ''}`} onClick={() => handleThemeChange(themes.dark)}>Dark</button>
              {savedThemes.map(t => <button key={t.id} className="theme-btn saved" onClick={() => handleThemeChange(t.data)}>{t.name}</button>)}
            </div>
            <div className="theme-control-group">
              <label htmlFor="bg-url">Custom Background URL</label>
              <div className="input-group">
                <input id="bg-url" type="text" placeholder="https://example.com/image.jpg" value={bgUrlInput} onChange={e => setBgUrlInput(e.target.value)} />
                <button className="control-button" onClick={() => { if (!bgUrlInput) return; handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` }); setBgUrlInput(''); }}>Apply</button>
              </div>
            </div>
            <div className="theme-control-group">
              <label htmlFor="theme-name">Save Current Theme</label>
              <div className="input-group">
                <input id="theme-name" type="text" placeholder="e.g., Christmas 2025" value={newThemeName} onChange={e => setNewThemeName(e.target.value)} />
                <button className="control-button" onClick={() => {
                  if (!newThemeName) return;
                  fetch(`${API_URL}/themes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newThemeName, data: currentTheme }) })
                    .then(r => r.json()).then(t => { setSavedThemes([...savedThemes, t]); setNewThemeName(''); })
                    .catch(err => console.error('save theme failed', err));
                }}>Save</button>
              </div>
            </div>
          </div>
        </div>

        {/* Right: History */}
        <div className="presenter-panel history-panel">
          <h2 className="panel-heading"><span className="panel-heading-icon">📜</span>Recent</h2>
          {history.length > 0 ? (
            <ul className="history-list">
              {history.map((verse, i) => (
                <li key={i} className="history-item" onClick={() => setStaged(verse)} title="Click to re-stage">
                  <span className="history-ref">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</span>
                </li>
              ))}
            </ul>
          ) : <div className="empty-state">Verses you display<br />will appear here</div>}
        </div>
      </div>
    </>
  );

  /* ─────────────────────────────────────────────────────────────────────
     LAYOUT: MID + COMPACT (< 1100px)
     Header command bar + full-width main + slide-in drawer
     ───────────────────────────────────────────────────────────────────── */
  const LayoutCondensed = () => (
    <>
      {/* ── Command Bar Header ── */}
      <header className="presenter-header presenter-header--bar">
        {/* Left: brand */}
        <div className="hdr-brand">
          <EmblemSVG size={22} />
          <span className="hdr-title">Scripture</span>
        </div>

        {/* Center: live verse + nav controls inline */}
        <div className="hdr-center">
          {liveVerse ? (
            <>
              <span className="hdr-verse-ref">
                {liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}
                {liveVerse?.segments?.length > 1 && <span className="hdr-seg-badge">seg</span>}
              </span>
              <div className="hdr-nav">
                <button className="hdr-nav-btn" onClick={() => fetchAdjacent('prev')} aria-label="Prev verse" title="Previous verse"><IconChevronLeft /><IconChevronLeft /></button>
                <button className="hdr-nav-btn" onClick={() => handleSegmentNavigation('prev')} disabled={!liveVerse?.segments || currentSegment === 0} aria-label="Prev segment" title="Previous segment"><IconChevronLeft /></button>
                <span className="hdr-seg-count">{liveVerse?.segments ? `${currentSegment + 1}/${liveVerse.segments.length}` : '—'}</span>
                <button className="hdr-nav-btn" onClick={() => handleSegmentNavigation('next')} disabled={!liveVerse?.segments || currentSegment === liveVerse.segments.length - 1} aria-label="Next segment" title="Next segment"><IconChevronRight /></button>
                <button className="hdr-nav-btn" onClick={() => fetchAdjacent('next')} aria-label="Next verse" title="Next verse"><IconChevronRight /><IconChevronRight /></button>
              </div>
            </>
          ) : (
            <span className="hdr-no-verse">No verse selected</span>
          )}
        </div>

        {/* Right: language + theme + search + live badge */}
        <div className="hdr-right">
          <select className="hdr-lang-select" value={currentLanguage} onChange={handleLanguageChange} aria-label="Language">
            <option value="en">EN</option>
            <option value="tl">TL</option>
            <option value="ceb">CEB</option>
          </select>

          {/* Theme popover */}
          <div className="hdr-theme-wrap">
            <button className="hdr-btn hdr-btn--theme" onClick={() => setThemePopover(o => !o)} aria-label="Theme" title="Change theme">
              <IconTheme />
            </button>
            {themePopover && (
              <div className="hdr-theme-popover">
                <button className={`theme-btn ${currentTheme === themes.light ? 'active' : ''}`} onClick={() => { handleThemeChange(themes.light); setThemePopover(false); }}>☀ Light</button>
                <button className={`theme-btn ${currentTheme === themes.dark ? 'active' : ''}`} onClick={() => { handleThemeChange(themes.dark); setThemePopover(false); }}>☽ Dark</button>
                {savedThemes.map(t => (
                  <button key={t.id} className="theme-btn saved" onClick={() => { handleThemeChange(t.data); setThemePopover(false); }}>{t.name}</button>
                ))}
              </div>
            )}
          </div>

          {/* Search / Recent drawer toggle */}
          <button
            className={`hdr-btn hdr-btn--search ${drawerOpen && drawerTab === 'search' ? 'hdr-btn--active' : ''}`}
            onClick={() => { setDrawerTab('search'); setDrawerOpen(o => drawerTab === 'search' ? !o : true); }}
            aria-label="Toggle search"
          ><IconSearch /></button>

          <button
            className={`hdr-btn hdr-btn--recent ${drawerOpen && drawerTab === 'history' ? 'hdr-btn--active' : ''}`}
            onClick={() => { setDrawerTab('history'); setDrawerOpen(o => drawerTab === 'history' ? !o : true); }}
            aria-label="Toggle recent"
          ><IconClock /></button>

          {liveVerse && <div className="live-badge live-badge--mini"><span className="live-badge-dot" />Live</div>}
        </div>
      </header>

      {/* ── Slide-in Drawer (search / history) ── */}
      <div className={`search-drawer search-drawer--${layoutMode} ${drawerOpen ? 'search-drawer--open' : ''}`}>
        <div className="drawer-tabs">
          <button className={`drawer-tab ${drawerTab === 'search' ? 'active' : ''}`} onClick={() => setDrawerTab('search')}><IconSearch /> Search</button>
          <button className={`drawer-tab ${drawerTab === 'history' ? 'active' : ''}`} onClick={() => setDrawerTab('history')}><IconClock /> Recent</button>
          <button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close"><IconClose /></button>
        </div>
        <div className="drawer-body">
          {drawerTab === 'search' ? <SearchPanel compact={layoutMode === 'compact'} /> : <HistoryPanel />}
        </div>
      </div>

      {/* ── Drawer backdrop ── */}
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      {/* ── Full-width main content ── */}
      <div className="main-panel main-panel--condensed">

        {/* Staged or empty state */}
        {staged ? (
          <div className="staged-section">
            <h2 className="panel-heading"><span className="panel-heading-icon">⏳</span>Staged</h2>
            <div className="staged-verse-display">
              <h3 className="staged-title">{staged.book_title} {staged.chapter_number}:{staged.verse_number}</h3>
              <p className="staged-text">{staged.scripture_text}</p>
            </div>
            <div className="staging-controls">
              <button className="nav-button" onClick={() => fetchAdjacent('prev', true)}>← Prev</button>
              <button className="nav-button" onClick={() => fetchAdjacent('next', true)}>Next →</button>
            </div>
            <button className="go-live-button" onClick={goLive}>● Go Live</button>
          </div>
        ) : (
          <div className="staged-section empty">
            <p className="empty-state">
              {liveVerse
                ? <>Now live: <strong>{liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}</strong> — tap <IconSearch /> to search next</>
                : 'Tap the 🔍 button above to search and select a verse'}
            </p>
          </div>
        )}

        {/* Live preview */}
        {liveVerse && (
          <div className="preview-section">
            <h2>Client Preview <span className="preview-hint">— select text to highlight</span></h2>
            <div className="preview-box" onMouseUp={handlePreviewTextSelection}>
              <div className="preview-title">{liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}</div>
              <div className="preview-text">{renderPreviewText()}</div>
              {liveVerse.segments && currentSegment < liveVerse.segments.length - 1 && <div className="preview-cont">cont…</div>}
            </div>
          </div>
        )}

        {/* Theme section — compact version */}
        <div className="theme-section theme-section--condensed">
          <h2>Theme &amp; Display</h2>
          <div className="theme-buttons">
            <button className={`theme-btn ${currentTheme === themes.light ? 'active' : ''}`} onClick={() => handleThemeChange(themes.light)}>☀ Light</button>
            <button className={`theme-btn ${currentTheme === themes.dark ? 'active' : ''}`} onClick={() => handleThemeChange(themes.dark)}>☽ Dark</button>
            {savedThemes.map(t => <button key={t.id} className="theme-btn saved" onClick={() => handleThemeChange(t.data)}>{t.name}</button>)}
          </div>
          <div className="theme-control-group">
            <label htmlFor="bg-url-c">Background URL</label>
            <div className="input-group">
              <input id="bg-url-c" type="text" placeholder="https://…" value={bgUrlInput} onChange={e => setBgUrlInput(e.target.value)} />
              <button className="control-button" onClick={() => { if (!bgUrlInput) return; handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` }); setBgUrlInput(''); }}>Apply</button>
            </div>
          </div>
          <div className="theme-control-group">
            <label htmlFor="theme-name-c">Save Theme</label>
            <div className="input-group">
              <input id="theme-name-c" type="text" placeholder="e.g., Christmas 2025" value={newThemeName} onChange={e => setNewThemeName(e.target.value)} />
              <button className="control-button" onClick={() => {
                if (!newThemeName) return;
                fetch(`${API_URL}/themes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: newThemeName, data: currentTheme }) })
                  .then(r => r.json()).then(t => { setSavedThemes([...savedThemes, t]); setNewThemeName(''); })
                  .catch(err => console.error('save theme failed', err));
              }}>Save</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );

  /* ─────────────────────────────────────────────────────────────────────
     ROOT RENDER
     ───────────────────────────────────────────────────────────────────── */
  return (
    <div
      ref={containerRef}
      className={`presenter-container presenter-container--${layoutMode}`}
    >
      {layoutMode === 'full' ? <LayoutFull /> : <LayoutCondensed />}
    </div>
  );
};

export default Presenter;