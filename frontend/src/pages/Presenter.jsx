import React, { useState, useEffect} from 'react';
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

/* ─── Emblem ─── */
const EmblemSVG = ({ size = 26 }) => (
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

/* ─── Icons ─── */
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IconClose = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconPalette = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
    <path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
  </svg>
);
const IconChevronLeft = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);
const IconChevronRight = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);

/* ─── Reusable components ─── */

const HdrBtn = ({ onClick, active, children, label, title }) => (
  <button
    className={`hdr-btn${active ? ' hdr-btn--active' : ''}`}
    onClick={onClick}
    aria-label={label}
    title={title || label}
  >
    {children}
  </button>
);

const SearchResults = ({ results, currentPage, totalPages, onSelect, onGoLive, onPageChange, PAGE_SIZE }) => {
  if (results.length === 0) return null;
  const pageSlice = results.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  return (
    <>
      <ul className="results-ul">
        {pageSlice.map(verse => (
          <li
            key={verse.verse_title}
            className="result-item"
            onClick={() => onSelect(verse)}
            onDoubleClick={() => onGoLive(verse)}
          >
            <div className="result-item-top">
              <span className="result-title">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</span>
              <button
                className="result-live-icon"
                onClick={e => { e.stopPropagation(); onGoLive(verse); }}
                aria-label="Go live"
              >●</button>
            </div>
            <div className="result-text">{verse.scripture_text}</div>
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="results-pagination">
          <button className="pagination-arrow" onClick={() => onPageChange(p => Math.max(0, p - 1))} disabled={currentPage === 0}>‹</button>
          <div className="pagination-track">
            {Array.from({ length: totalPages }).map((_, i) => (
              <button key={i} className={`pagination-pip${i === currentPage ? ' active' : ''}`} onClick={() => onPageChange(i)} aria-label={`Page ${i + 1}`} />
            ))}
          </div>
          <span className="pagination-label">{currentPage + 1}<span className="pagination-sep">/</span>{totalPages}</span>
          <button className="pagination-arrow" onClick={() => onPageChange(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage === totalPages - 1}>›</button>
        </div>
      )}
    </>
  );
};

/* ─── Main component ─── */
const Presenter = () => {
  const normalizeSessionId = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const [query, setQuery]                   = useState('');
  const [results, setResults]               = useState([]);
  const [currentTheme, setCurrentTheme]     = useState(themes.light);
  const [history, setHistory]               = useState([]);
  const [staged, setStaged]                 = useState(null);
  const [liveVerse, setLiveVerse]           = useState(null);
  const [bgUrlInput, setBgUrlInput]         = useState('');
  const [currentSegment, setCurrentSegment] = useState(0);
  const [highlightedText, setHighlightedText] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [currentPage, setCurrentPage]       = useState(0);
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [drawerTab, setDrawerTab]           = useState('search');
  const [themePopover, setThemePopover]     = useState(false);
  const [sessionId, setSessionId]           = useState('');
  const [sessionInput, setSessionInput]     = useState('');
  const [sessionMessage, setSessionMessage] = useState('Creating session...');

  const PAGE_SIZE = 5;
  const emitWithSession = (event, payload = {}) => socket.emit(event, { ...payload, sessionId });

  const requestCreateSession = () => {
    setSessionMessage('Creating session...');
    socket.emit('create-session', {}, (response) => {
      if (!response?.ok) {
        setSessionMessage('Failed to create session');
      }
    });
  };

  const joinSession = () => {
    const normalized = normalizeSessionId(sessionInput);
    if (!normalized) {
      setSessionMessage('Enter a valid session code');
      return;
    }
    setSessionMessage('Joining session...');
    socket.emit('join-session', { sessionId: normalized }, (response) => {
      if (!response?.ok) {
        setSessionMessage(response?.message || 'Unable to join session');
      }
    });
  };

  const copyClientLink = async () => {
    if (!sessionId) return;
    const clientLink = `${window.location.origin}/client?session=${sessionId}`;
    try {
      await navigator.clipboard.writeText(clientLink);
      setSessionMessage(`Copied client link for ${sessionId}`);
    } catch {
      setSessionMessage('Clipboard unavailable - copy URL from address bar');
    }
  };

  /* ── Socket & data ── */
  useEffect(() => {
    const handleSessionJoined = (data) => {
      if (!data?.sessionId) return;
      setSessionId(data.sessionId);
      setSessionInput(data.sessionId);
      setSessionMessage(`Session ${data.sessionId} ready`);
      setHighlightedText('');
    };
    const handleSessionError = (data) => {
      setSessionMessage(data?.message || 'Session error');
    };
    socket.on('search-results', data => { setResults(data); setCurrentPage(0); });
    socket.on('update-verse',   data => { setLiveVerse(data); setCurrentSegment(data.currentSegment || 0); });
    socket.on('session-created', handleSessionJoined);
    socket.on('session-joined', handleSessionJoined);
    socket.on('session-error', handleSessionError);
    socket.emit('create-session', {}, (response) => {
      if (!response?.ok) {
        setSessionMessage('Failed to create session');
      }
    });
    // fetch(`${API_URL}/themes`)
    //   .then(r => r.json())
    //   .then(setSavedThemes)
    //   .catch(err => console.error('themes load failed', err));
    return () => {
      socket.off('search-results');
      socket.off('update-verse');
      socket.off('session-created', handleSessionJoined);
      socket.off('session-joined', handleSessionJoined);
      socket.off('session-error', handleSessionError);
    };
  }, []);

  /* ── Close drawer & theme popover on outside tap ── */
  useEffect(() => {
    if (!drawerOpen && !themePopover) return;
    const handler = e => {
      if (!e.target.closest('.search-drawer') && !e.target.closest('.hdr-btn') && !e.target.closest('.hdr-theme-wrap'))
        setDrawerOpen(false);
      if (!e.target.closest('.hdr-theme-wrap'))
        setThemePopover(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [drawerOpen, themePopover]);

  /* ── Handlers ── */
  const handleThemeChange = theme => {
    setCurrentTheme(theme);
    if (staged) setStaged(prev => ({ ...prev, theme }));
    emitWithSession('update-theme', { theme });
  };

  const handleSearch = e => {
    setQuery(e.target.value);
    setCurrentPage(0);
    emitWithSession('search', { query: e.target.value });
  };

  const handleSearchKeyDown = e => {
    if (e.key === 'Enter' && results.length > 0) goLiveDirectly(results[0]);
  };

  const selectVerse = verse => {
    setStaged({ ...verse, theme: currentTheme });
    setDrawerOpen(false);
  };

  const goLiveDirectly = verse => {
    const v = { ...verse, theme: currentTheme };
    emitWithSession('go-live', { verse: v, theme: v.theme, language: currentLanguage });
    setLiveVerse(v);
    setCurrentSegment(0);
    setHistory(h => [v, ...h.slice(0, 9)]);
    setDrawerOpen(false);
  };

  const goLive = () => {
    if (!staged) return;
    emitWithSession('go-live', { verse: staged, theme: staged.theme, language: currentLanguage });
    setLiveVerse(staged);
    setCurrentSegment(0);
    setHistory(h => [staged, ...h.slice(0, 9)]);
    setStaged(null);
  };

  const navigateSegment = direction => {
    if (!liveVerse?.segments) return;
    const limit = liveVerse.segments.length - 1;
    const next = direction === 'next' ? Math.min(currentSegment + 1, limit) : Math.max(currentSegment - 1, 0);
    if (next !== currentSegment) {
      setCurrentSegment(next);
      emitWithSession('update-verse', { verse: { ...liveVerse, currentSegment: next } });
    }
  };

  const fetchAdjacent = async (direction, preferStaged = false) => {
    const source = preferStaged ? (staged || liveVerse) : liveVerse;
    if (!source?.verse_id) return;
    const params = new URLSearchParams({
      verse_id: source.verse_id, direction,
      ...((['ceb', 'tl'].includes(currentLanguage)) && { language: currentLanguage })
    });
    try {
      const res = await fetch(`${API_URL}/verse/adjacent?${params}`);
      if (!res.ok) return;
      const data = await res.json();
      const v = { ...data, theme: currentTheme };
      if (preferStaged && staged) {
        setStaged(v);
      } else {
        emitWithSession('go-live', { verse: v, theme: v.theme, language: currentLanguage });
        setLiveVerse(v);
        setCurrentSegment(0);
        setHistory(h => [v, ...h.slice(0, 9)]);
      }
    } catch (err) { console.error('adjacent fetch failed', err); }
  };

  const handlePreviewTextSelection = () => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    setHighlightedText(sel);
    emitWithSession('highlight-text', { text: sel });
  };

  const handleLanguageChange = e => {
    const lang = e.target.value;
    setCurrentLanguage(lang);
    emitWithSession('update-language', { language: lang });
    if (liveVerse) emitWithSession('go-live', { verse: liveVerse, theme: currentTheme, language: lang });
  };

  const renderPreviewText = () => {
    if (!liveVerse) return '';
    const text = liveVerse.segments?.length > 0
      ? liveVerse.segments[currentSegment]
      : liveVerse.scripture_text;
    if (!highlightedText) return text;
    const parts = text.split(new RegExp(`(${highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === highlightedText.toLowerCase()
        ? <span key={i} className="highlight-yellow">{part}</span>
        : part
    );
  };

  const openDrawer = tab => {
    setDrawerTab(tab);
    setDrawerOpen(open => drawerTab === tab ? !open : true);
  };

  const hasSegments = liveVerse?.segments?.length > 1;
  const totalPages  = Math.ceil(results.length / PAGE_SIZE);

  /* ── Render ── */
  return (
    <div className="presenter-container">

      {/* ════════════════════════════════════════
          COMMAND BAR HEADER
          ════════════════════════════════════════ */}
      <header className="presenter-header">

        {/* Brand */}
        <div className="hdr-brand">
          <EmblemSVG size={24} />
          <span className="hdr-title">Scripture</span>
        </div>

        {/* Live verse ref + inline nav */}
        <div className="hdr-center">
          {liveVerse ? (
            <>
              <div className="hdr-nav">
                {/* ←← prev verse */}
                <button className="hdr-nav-btn hdr-nav-btn--verse" onClick={() => fetchAdjacent('prev')} aria-label="Previous verse" title="Previous verse">
                  <IconChevronLeft /><IconChevronLeft />
                </button>
                {/* ◀ prev segment */}
                <button className="hdr-nav-btn hdr-nav-btn--seg" onClick={() => navigateSegment('prev')}
                  disabled={!hasSegments || currentSegment === 0} aria-label="Previous segment" title="Previous segment">
                  <IconChevronLeft />
                </button>

                <div className="hdr-verse-info">
                  <span className="hdr-verse-ref">
                    {liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}
                  </span>
                  {hasSegments && (
                    <span className="hdr-seg-count">{currentSegment + 1}/{liveVerse.segments.length}</span>
                  )}
                </div>

                {/* ▶ next segment */}
                <button className="hdr-nav-btn hdr-nav-btn--seg" onClick={() => navigateSegment('next')}
                  disabled={!hasSegments || currentSegment === liveVerse.segments.length - 1}
                  aria-label="Next segment" title="Next segment">
                  <IconChevronRight />
                </button>
                {/* →→ next verse */}
                <button className="hdr-nav-btn hdr-nav-btn--verse" onClick={() => fetchAdjacent('next')} aria-label="Next verse" title="Next verse">
                  <IconChevronRight /><IconChevronRight />
                </button>
              </div>
            </>
          ) : (
            <span className="hdr-no-verse">Tap 🔍 to find a verse</span>
          )}
        </div>

        {/* Right controls */}
        <div className="hdr-right">
          <div className="live-badge" title="Session code">
            <span>Session {sessionId || '...'}</span>
          </div>
          <input
            className="hdr-lang-select"
            value={sessionInput}
            onChange={e => setSessionInput(normalizeSessionId(e.target.value))}
            placeholder="Session"
            aria-label="Session code"
          />
          <HdrBtn onClick={joinSession} label="Join session" title="Join session">Join</HdrBtn>
          <HdrBtn onClick={requestCreateSession} label="Create new session" title="Create new session">New</HdrBtn>
          <HdrBtn onClick={copyClientLink} label="Copy client link" title="Copy client link">Copy</HdrBtn>

          {/* Language */}
          <select className="hdr-lang-select" value={currentLanguage} onChange={handleLanguageChange} aria-label="Language">
            <option value="en">EN</option>
            <option value="tl">TL</option>
            <option value="ceb">CEB</option>
          </select>

          {/* Theme popover */}
          <div className="hdr-theme-wrap">
            <HdrBtn onClick={() => setThemePopover(o => !o)} active={themePopover} label="Theme" title="Change theme">
              <IconPalette />
            </HdrBtn>
            {themePopover && (
              <div className="hdr-theme-popover">
                <div className="popover-label">Theme</div>
                {[
                  { label: '☀ Light', theme: themes.light },
                  { label: '☽ Dark',  theme: themes.dark  },
                  // ...savedThemes.map(t => ({ label: t.name, theme: t.data }))
                ].map(({ label, theme }) => (
                  <button
                    key={label}
                    className={`theme-btn${currentTheme === theme ? ' active' : ''}`}
                    onClick={() => { handleThemeChange(theme); setThemePopover(false); }}
                  >{label}</button>
                ))}
                <div className="popover-divider" />
                <div className="popover-label">Custom background</div>
                <div className="popover-row">
                  <input
                    type="text"
                    className="popover-input"
                    placeholder="https://…"
                    value={bgUrlInput}
                    onChange={e => setBgUrlInput(e.target.value)}
                  />
                  <button className="popover-apply" onClick={() => {
                    if (!bgUrlInput) return;
                    handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` });
                    setBgUrlInput('');
                    setThemePopover(false);
                  }}>Apply</button>
                </div>
                {/*
                <div className="popover-label" style={{ marginTop: '0.4rem' }}>Save theme</div>
                <div className="popover-row">
                  <input
                    type="text"
                    className="popover-input"
                    placeholder="Name…"
                    value={newThemeName}
                    onChange={e => setNewThemeName(e.target.value)}
                  />
                  <button className="popover-apply" onClick={() => {
                    if (!newThemeName) return;
                    fetch(`${API_URL}/themes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: newThemeName, data: currentTheme }),
                    })
                      .then(r => r.json())
                      .then(t => { setSavedThemes(s => [...s, t]); setNewThemeName(''); })
                      .catch(err => console.error('save theme failed', err));
                  }}>Save</button>
                </div>
                */}
              </div>
            )}
          </div>

          {/* Search toggle */}
          <HdrBtn onClick={() => openDrawer('search')} active={drawerOpen && drawerTab === 'search'} label="Search scripture">
            <IconSearch />
          </HdrBtn>

          {/* Recent toggle */}
          <HdrBtn onClick={() => openDrawer('history')} active={drawerOpen && drawerTab === 'history'} label="Recent verses">
            <IconClock />
          </HdrBtn>

          {/* Live badge */}
          {liveVerse && (
            <div className="live-badge">
              <span className="live-badge-dot" />
              <span>Live</span>
            </div>
          )}
        </div>
      </header>
      <div style={{ color: '#a09880', fontSize: '0.8rem', padding: '0 1.1rem 0.5rem 1.1rem' }}>{sessionMessage}</div>

      {/* ════════════════════════════════════════
          SLIDE-IN DRAWER  (search + history)
          ════════════════════════════════════════ */}
      <div className={`search-drawer${drawerOpen ? ' search-drawer--open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-tabs">
            <button className={`drawer-tab${drawerTab === 'search' ? ' active' : ''}`} onClick={() => setDrawerTab('search')}>
              <IconSearch /> Search
            </button>
            <button className={`drawer-tab${drawerTab === 'history' ? ' active' : ''}`} onClick={() => setDrawerTab('history')}>
              <IconClock /> Recent
            </button>
          </div>
          <button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close drawer">
            <IconClose />
          </button>
        </div>

        <div className="drawer-body">
          {drawerTab === 'search' ? (
            <div className="drawer-search">
              {query.length > 0 && (
                <div className="search-results-count">
                  {results.length === 0 ? 'No verses found' : `${results.length} verse${results.length === 1 ? '' : 's'} found`}
                </div>
              )}
              <input
                type="search"
                className="search-input"
                placeholder="John 3:16 or 'faith'…"
                value={query}
                onChange={handleSearch}
                onKeyDown={handleSearchKeyDown}
                autoFocus={drawerOpen && drawerTab === 'search'}
              />
              <div className="results-list">
                {results.length > 0
                  ? <SearchResults
                      results={results}
                      currentPage={currentPage}
                      totalPages={totalPages}
                      onSelect={selectVerse}
                      onGoLive={goLiveDirectly}
                      onPageChange={setCurrentPage}
                      PAGE_SIZE={PAGE_SIZE}
                    />
                  : <div className="empty-state">
                      {query.length > 0 ? 'No verses found' : <>Search for a verse<br />to begin…</>}
                    </div>
                }
              </div>
            </div>
          ) : (
            <div className="drawer-history">
              {history.length > 0 ? (
                <ul className="history-list">
                  {history.map((verse, i) => (
                    <li key={i} className="history-item" onClick={() => { setStaged(verse); setDrawerOpen(false); }}>
                      <span className="history-ref">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</span>
                      <span className="history-hint">tap to stage</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-state">Verses you display<br />will appear here</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      {/* ════════════════════════════════════════
          MAIN CONTENT AREA
          ════════════════════════════════════════ */}
      <main className="main-panel">

        {/* ── Staged verse card ── */}
        {staged && (
          <section className="card card--staged">
            <div className="card-header">
              <span className="card-label">⏳ Staged</span>
              <div className="staging-nav">
                <button className="nav-button" onClick={() => fetchAdjacent('prev', true)}>← Prev</button>
                <button className="nav-button" onClick={() => fetchAdjacent('next', true)}>Next →</button>
              </div>
            </div>
            <div className="staged-verse-display">
              <h3 className="staged-title">{staged.book_title} {staged.chapter_number}:{staged.verse_number}</h3>
              <p className="staged-text">{staged.scripture_text}</p>
            </div>
            <button className="go-live-button" onClick={goLive}>● Go Live</button>
          </section>
        )}

        {/* ── Live preview card ── */}
        {liveVerse && (
          <section className="card card--preview">
            <div className="card-header">
              <span className="card-label">👁 Preview</span>
              <span className="card-hint">select text to highlight</span>
            </div>
            <div className="preview-box" onMouseUp={handlePreviewTextSelection}>
              <div className="preview-title">
                {liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}
              </div>
              <div className="preview-text">{renderPreviewText()}</div>
              {hasSegments && currentSegment < liveVerse.segments.length - 1 && (
                <div className="preview-cont">cont…</div>
              )}
            </div>
          </section>
        )}

        {/* ── Theme card ── */}
        <section className="card card--theme">
          <div className="card-header">
            <span className="card-label">🎨 Theme &amp; Display</span>
          </div>
          <div className="theme-buttons">
            <button className={`theme-btn${currentTheme === themes.light ? ' active' : ''}`} onClick={() => handleThemeChange(themes.light)}>☀ Light</button>
            <button className={`theme-btn${currentTheme === themes.dark ? ' active' : ''}`} onClick={() => handleThemeChange(themes.dark)}>☽ Dark</button>
            {/*
            {savedThemes.map(t => (
              <button key={t.id} className={`theme-btn saved${currentTheme === t.data ? ' active' : ''}`} onClick={() => handleThemeChange(t.data)}>{t.name}</button>
            ))}
            */}
          </div>
          <div className="theme-inputs">
            <div className="theme-control-group">
              <label htmlFor="bg-url">Background URL</label>
              <div className="input-group">
                <input id="bg-url" type="text" placeholder="https://example.com/image.jpg" value={bgUrlInput} onChange={e => setBgUrlInput(e.target.value)} />
                <button className="control-button" onClick={() => {
                  if (!bgUrlInput) return;
                  handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` });
                  setBgUrlInput('');
                }}>Apply</button>
              </div>
            </div>
            {/*
            <div className="theme-control-group">
              <label htmlFor="theme-name">Save Current Theme</label>
              <div className="input-group">
                <input id="theme-name" type="text" placeholder="e.g., Christmas 2025" value={newThemeName} onChange={e => setNewThemeName(e.target.value)} />
                <button className="control-button" onClick={() => {
                  if (!newThemeName) return;
                  fetch(`${API_URL}/themes`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: newThemeName, data: currentTheme }),
                  })
                    .then(r => r.json())
                    .then(t => { setSavedThemes(s => [...s, t]); setNewThemeName(''); })
                    .catch(err => console.error('save theme failed', err));
                }}>Save</button>
              </div>
            </div>
            */}
          </div>
        </section>

      </main>
    </div>
  );
};

export default Presenter;
