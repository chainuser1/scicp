import React, { useState, useEffect} from 'react';
import { socket } from '../socket';

const API_URL = import.meta.env.MODE === 'production' ? '' : 'http://localhost:3000';

const themes = {
  light: {
    background_url: "url('https://www.churchofjesuschrist.org/imgs/ae2c3112eda211edae1aeeeeac1ef8149c058327/full/%21500%2C/0/default')",
    font_family: "'Cormorant Garamond', Georgia, serif",
    font_size: "4.1rem",
    layout: "centered",
    tone: "light"
  },
  dark: {
    background_url: "url('https://commons.wikimedia.org/wiki/Special:FilePath/Christus%20hand%20detail%20temple%20square.jpg')",
    font_family: "'Cormorant Garamond', Georgia, serif",
    font_size: "4.8rem",
    layout: "lower-third",
    tone: "dark"
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
const IconSession = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 7V5a4 4 0 0 1 8 0v2"/>
    <rect x="5" y="7" width="14" height="12" rx="2"/>
    <circle cx="12" cy="13" r="1.3"/>
  </svg>
);
const IconInfo = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
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
  const PRESENTER_TOUR_KEY = 'scicp.presenter_tour_seen_v1';
  const PRESENTER_LAST_SESSION_KEY = 'scicp.presenter_last_session_v1';
  const normalizeSessionId = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const presenterTourSteps = [
    {
      target: 'session',
      title: 'Session First',
      description: 'Create or join a session from this menu, then share the client link.',
    },
    {
      target: 'search',
      title: 'Search Scriptures',
      description: 'Use search to find references or keywords, then click a result to stage it.',
    },
    {
      target: 'golive',
      title: 'Go Live',
      description: 'Review the staged verse and send it to your connected clients.',
    },
    {
      target: 'nav',
      title: 'Navigate Fast',
      description: 'Use preview controls for previous/next verse and segment navigation while live.',
    },
  ];
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
  const [sessionPopover, setSessionPopover] = useState(false);
  const [sessionId, setSessionId]           = useState('');
  const [sessionInput, setSessionInput]     = useState('');
  const [sessionMessage, setSessionMessage] = useState('Creating session...');
  const [connectionState, setConnectionState] = useState('connecting');
  const [tourOpen, setTourOpen]             = useState(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const forceTour = urlParams.get('tour') === '1';
      const hasSeenTour = window.localStorage.getItem(PRESENTER_TOUR_KEY) === 'true';
      return forceTour || !hasSeenTour;
    } catch {
      return true;
    }
  });
  const [tourStep, setTourStep]             = useState(0);

  const PAGE_SIZE = 5;
  const emitWithSession = (event, payload = {}) => socket.emit(event, { ...payload, sessionId });
  const activeTourTarget = tourOpen ? presenterTourSteps[tourStep].target : '';

  useEffect(() => {
    document.title = 'Presenter | Scriptures in View';
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'noindex,nofollow');
  }, []);

  const requestCreateSession = () => {
    setSessionMessage('Creating session...');
    socket.emit('create-session', { role: 'presenter' }, (response) => {
      if (response?.ok && response.sessionId) {
        setSessionId(response.sessionId);
        setSessionInput(response.sessionId);
        setSessionMessage(`Session ${response.sessionId} ready`);
        try {
          window.localStorage.setItem(PRESENTER_LAST_SESSION_KEY, response.sessionId);
        } catch {
          // ignore storage errors
        }
      } else {
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
    socket.emit('join-session', { sessionId: normalized, role: 'presenter' }, (response) => {
      if (response?.ok && response.sessionId) {
        setSessionId(response.sessionId);
        setSessionInput(response.sessionId);
        setSessionMessage(`Session ${response.sessionId} ready`);
        setSessionPopover(false);
        try {
          window.localStorage.setItem(PRESENTER_LAST_SESSION_KEY, response.sessionId);
        } catch {
          // ignore storage errors
        }
      } else {
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

  const leaveSession = () => {
    socket.emit('leave-session', {}, (response) => {
      if (response?.ok) {
        setSessionId('');
        setSessionInput('');
        setSessionMessage('You left the session');
        try {
          window.localStorage.removeItem(PRESENTER_LAST_SESSION_KEY);
        } catch {
          // ignore storage errors
        }
      } else {
        setSessionMessage(response?.message || 'Unable to leave session');
      }
    });
  };

  const closeTour = () => {
    setTourOpen(false);
    try {
      window.localStorage.setItem(PRESENTER_TOUR_KEY, 'true');
    } catch {
      // ignore storage errors
    }
  };

  const openTour = () => {
    setTourStep(0);
    setTourOpen(true);
  };

  /* ── Socket & data ── */
  useEffect(() => {
    const handleSessionJoined = (data) => {
      if (!data?.sessionId) return;
      setSessionId(data.sessionId);
      setSessionInput(data.sessionId);
      setSessionMessage(`Session ${data.sessionId} ready`);
      setHighlightedText('');
      setSessionPopover(false);
    };
    const handleSessionError = (data) => {
      setSessionMessage(data?.message || 'Session error');
    };
    const handleSessionLeft = () => {
      setSessionId('');
      setSessionInput('');
      setSessionMessage('You left the session');
      try {
        window.localStorage.removeItem(PRESENTER_LAST_SESSION_KEY);
      } catch {
        // ignore storage errors
      }
    };
    const handleConnect = () => {
      setConnectionState('connected');
      const current = (() => {
        try {
          return window.localStorage.getItem(PRESENTER_LAST_SESSION_KEY) || '';
        } catch {
          return '';
        }
      })();
      if (current) {
        socket.emit('join-session', { sessionId: current, role: 'presenter' }, (response) => {
          if (response?.ok && response.sessionId) {
            setSessionId(response.sessionId);
            setSessionInput(response.sessionId);
            setSessionMessage(`Session ${response.sessionId} ready`);
          } else {
            if (response?.message === 'Session not found') {
              requestCreateSession();
              return;
            }
            setSessionMessage(response?.message || 'Unable to rejoin previous session');
          }
        });
      } else {
        requestCreateSession();
      }
    };
    const handleDisconnect = () => {
      setConnectionState('disconnected');
      setSessionMessage('Disconnected - attempting to reconnect...');
    };
    const handleReconnectAttempt = () => {
      setConnectionState('reconnecting');
    };
    const handleConnectError = () => {
      setConnectionState('error');
    };
    socket.on('search-results', data => { setResults(data); setCurrentPage(0); });
    socket.on('update-verse',   data => { setLiveVerse(data); setCurrentSegment(data.currentSegment || 0); });
    socket.on('session-created', handleSessionJoined);
    socket.on('session-joined', handleSessionJoined);
    socket.on('session-error', handleSessionError);
    socket.on('session-left', handleSessionLeft);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('connect_error', handleConnectError);
    if (socket.connected) {
      handleConnect();
    }
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
      socket.off('session-left', handleSessionLeft);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('connect_error', handleConnectError);
    };
  }, []);

  /* ── Close drawer, theme popover, and session popover on outside tap ── */
  useEffect(() => {
    if (!drawerOpen && !themePopover && !sessionPopover) return;
    const handler = e => {
      if (!e.target.closest('.search-drawer') && !e.target.closest('.hdr-btn') && !e.target.closest('.hdr-theme-wrap'))
        setDrawerOpen(false);
      if (!e.target.closest('.hdr-theme-wrap'))
        setThemePopover(false);
      if (!e.target.closest('.hdr-session-wrap'))
        setSessionPopover(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [drawerOpen, themePopover, sessionPopover]);

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
  const presenterThemeClass = currentTheme === themes.dark
    ? 'presenter-container--dark'
    : 'presenter-container--light';

  /* ── Render ── */
  return (
    <div className={`presenter-container ${presenterThemeClass}`}>

      {/* ════════════════════════════════════════
          COMMAND BAR HEADER
          ════════════════════════════════════════ */}
      <header className="presenter-header">

        {/* Brand */}
        <div className="hdr-brand">
          <EmblemSVG size={24} />
          <span className="hdr-title">Scripture</span>
        </div>

        {/* Live verse summary */}
        <div className="hdr-center">
          {liveVerse ? (
            <div className="hdr-verse-info">
              <span className="hdr-verse-ref">
                {liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}
              </span>
              {hasSegments && (
                <span className="hdr-seg-count">{currentSegment + 1}/{liveVerse.segments.length}</span>
              )}
            </div>
          ) : (
            <span className="hdr-no-verse">Tap 🔍 to find a verse</span>
          )}
        </div>

        {/* Right controls */}
        <div className="hdr-right">
          <HdrBtn onClick={openTour} label="Open walkthrough" title="Open walkthrough">
            <IconInfo />
          </HdrBtn>
          <div className={`hdr-session-wrap${activeTourTarget === 'session' ? ' tour-focus' : ''}`}>
            <HdrBtn
              onClick={() => setSessionPopover(o => !o)}
              active={sessionPopover}
              label="Session controls"
              title={`Session ${sessionId || '...'}`}
            >
              <IconSession />
            </HdrBtn>
            {sessionPopover && (
              <div className="hdr-session-popover">
                <div className="popover-label">Session</div>
                <div className="session-code-display">{sessionId || 'NOT READY'}</div>
                <div className="popover-row">
                  <input
                    type="text"
                    className="popover-input"
                    value={sessionInput}
                    onChange={e => setSessionInput(normalizeSessionId(e.target.value))}
                    placeholder="AB12CD"
                    aria-label="Session code"
                  />
                  <button className="popover-apply" onClick={joinSession}>Join</button>
                </div>
                <div className="popover-row">
                  <button className="theme-btn" onClick={requestCreateSession}>New Session</button>
                  <button className="theme-btn" onClick={copyClientLink}>Copy Link</button>
                </div>
                <div className="popover-row">
                  <button className="theme-btn" onClick={leaveSession} disabled={!sessionId}>Leave Session</button>
                </div>
                <div className="session-message">{sessionMessage}</div>
                <div className="session-message">Connection: {connectionState}</div>
              </div>
            )}
          </div>

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
          <div className={activeTourTarget === 'search' ? 'tour-focus' : ''}>
            <HdrBtn onClick={() => openDrawer('search')} active={drawerOpen && drawerTab === 'search'} label="Search scripture">
              <IconSearch />
            </HdrBtn>
          </div>

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

      {tourOpen && (
        <aside className="tour-card" role="dialog" aria-live="polite" aria-label="Presenter walkthrough">
          <div className="tour-chip">Quick Walkthrough</div>
          <div className="tour-title">{presenterTourSteps[tourStep].title}</div>
          <div className="tour-desc">{presenterTourSteps[tourStep].description}</div>
          <div className="tour-progress">{tourStep + 1}/{presenterTourSteps.length}</div>
          <div className="tour-actions">
            <button className="tour-btn" onClick={closeTour}>Skip</button>
            <button className="tour-btn" onClick={() => setTourStep(s => Math.max(0, s - 1))} disabled={tourStep === 0}>Back</button>
            {tourStep < presenterTourSteps.length - 1 ? (
              <button className="tour-btn tour-btn--primary" onClick={() => setTourStep(s => Math.min(presenterTourSteps.length - 1, s + 1))}>Next</button>
            ) : (
              <button className="tour-btn tour-btn--primary" onClick={closeTour}>Done</button>
            )}
          </div>
        </aside>
      )}

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
            <button className={`go-live-button${activeTourTarget === 'golive' ? ' tour-focus' : ''}`} onClick={goLive}>● Go Live</button>
          </section>
        )}

        {/* ── Live preview card ── */}
        {liveVerse && (
          <section className="card card--preview">
            <div className="card-header">
              <span className="card-label">👁 Preview</span>
              <span className="card-hint">select text to highlight</span>
            </div>
            <div className={`preview-nav${activeTourTarget === 'nav' ? ' tour-focus' : ''}`}>
              <button className="preview-nav-btn preview-nav-btn--verse" onClick={() => fetchAdjacent('prev')} aria-label="Previous verse" title="Previous verse">
                <IconChevronLeft /><IconChevronLeft />
              </button>
              <button className="preview-nav-btn" onClick={() => navigateSegment('prev')}
                disabled={!hasSegments || currentSegment === 0} aria-label="Previous segment" title="Previous segment">
                <IconChevronLeft />
              </button>
              <div className="preview-nav-meta">
                <span>{liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}</span>
                {hasSegments && <span>{currentSegment + 1}/{liveVerse.segments.length}</span>}
              </div>
              <button className="preview-nav-btn" onClick={() => navigateSegment('next')}
                disabled={!hasSegments || currentSegment === liveVerse.segments.length - 1}
                aria-label="Next segment" title="Next segment">
                <IconChevronRight />
              </button>
              <button className="preview-nav-btn preview-nav-btn--verse" onClick={() => fetchAdjacent('next')} aria-label="Next verse" title="Next verse">
                <IconChevronRight /><IconChevronRight />
              </button>
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
