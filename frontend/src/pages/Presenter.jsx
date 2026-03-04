import React, { useState, useEffect } from 'react';
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

/* ─── Emblem SVG (small, for header) ─── */
const EmblemSVG = ({ size = 32 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Cornerstone base */}
    <rect x="4" y="20" width="24" height="8" rx="1.5" fill="#c9a84c" opacity="0.9"/>
    
    {/* Arch (symbolizing tomb/resurrection) */}
    <path d="M6 20 Q16 4 26 20" stroke="#c9a84c" strokeWidth="1.8" strokeLinecap="round"/>
    
    {/* Stylized Christus – head, shoulders, extended arms */}
    <circle cx="16" cy="13" r="3.5" fill="#e8c97a"/> {/* head */}
    <rect x="12" y="16" width="8" height="6" rx="2" fill="#e8c97a"/> {/* shoulders/torso */}
    <line x1="9" y1="18" x2="4" y2="14" stroke="#e8c97a" strokeWidth="2.2" strokeLinecap="round"/> {/* left arm */}
    <line x1="23" y1="18" x2="28" y2="14" stroke="#e8c97a" strokeWidth="2.2" strokeLinecap="round"/> {/* right arm */}
    
    {/* Subtle center glow / divine light dot */}
    <circle cx="16" cy="13" r="1.2" fill="#0a0a0f"/>
  </svg>
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
  const [isBibleVerse, setIsBibleVerse] = useState(true);

  useEffect(() => {
    socket.on('search-results', (data) => setResults(data));
    socket.on('update-verse', (data) => {
      setLiveVerse(data);
      setCurrentSegment(data.currentSegment || 0);
    });
    fetch(`${API_URL}/themes`)
      .then((res) => res.json())
      .then((list) => setSavedThemes(list))
      .catch((err) => console.error('failed to load themes', err));

    return () => {
      socket.off('search-results');
      socket.off('update-verse');
    };
  }, []);

  const handleThemeChange = (theme) => {
    setCurrentTheme(theme);
    if (staged) setStaged((prev) => ({ ...prev, theme }));
    socket.emit('update-theme', theme);
  };

  const handleSearch = (e) => {
    setQuery(e.target.value);
    socket.emit('search', e.target.value);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && results.length > 0) goLiveDirectly(results[0]);
  };

  const handleSelectVerse = (verse) => {
    const verseWithTheme = { ...verse, theme: currentTheme };
    setStaged(verseWithTheme);
    const verseId = Number(verse.verse_id);
    setIsBibleVerse(verseId >= 1 && verseId <= 31102);
  };

  const goLiveDirectly = (verse) => {
    const verseWithTheme = { ...verse, theme: currentTheme };
    socket.emit('go-live', { 
      verse: verseWithTheme, 
      theme: verseWithTheme.theme,
      language: currentLanguage 
    });
    setLiveVerse(verseWithTheme);
    setCurrentSegment(0);
    setHistory([verseWithTheme, ...history.slice(0, 4)]);
    const verseId = Number(verse.verse_id);
    setIsBibleVerse(verseId >= 1 && verseId <= 31102);
  };

  const goLive = () => {
    if (!staged) return;
    socket.emit('go-live', { 
      verse: staged, 
      theme: staged.theme,
      language: currentLanguage 
    });
    setLiveVerse(staged);
    setCurrentSegment(0);
    setHistory([staged, ...history.slice(0, 4)]);
    setStaged(null);
  };

  const handleSegmentNavigation = (direction) => {
    if (!liveVerse || !liveVerse.segments) return;
    const limit = liveVerse.segments.length - 1;
    const newSeg = direction === 'next'
      ? Math.min(currentSegment + 1, limit)
      : Math.max(currentSegment - 1, 0);
    if (newSeg !== currentSegment) {
      setCurrentSegment(newSeg);
      socket.emit('update-verse', { ...liveVerse, currentSegment: newSeg });
    }
  };

  const fetchAdjacent = async (direction) => {
    const source = staged || liveVerse;
    if (!source || !source.verse_id) return;

    const params = new URLSearchParams({
      verse_id: source.verse_id,
      direction,
      ...(currentLanguage && ['ceb', 'tl'].includes(currentLanguage) && { language: currentLanguage })
    });

    try {
      const res = await fetch(`${API_URL}/verse/adjacent?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      const verseWithTheme = { ...data, theme: currentTheme };
      if (staged) {
        setStaged(verseWithTheme);
      } else {
        socket.emit('go-live', { verse: verseWithTheme, theme: verseWithTheme.theme });
        setLiveVerse(verseWithTheme);
        setCurrentSegment(0);
        setHistory([verseWithTheme, ...history.slice(0, 4)]);
      }
    } catch (err) {
      console.error('adjacent fetch failed', err);
    }
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
    
    // Automatically refresh live verse with new language
    if (liveVerse) {
      socket.emit('go-live', { 
        verse: liveVerse, 
        theme: currentTheme,
        language: lang 
      });
    }
  };

  const renderPreviewText = () => {
    if (!liveVerse) return '';
    const text = liveVerse.segments && liveVerse.segments.length > 0
      ? liveVerse.segments[currentSegment]
      : liveVerse.scripture_text;
    if (!highlightedText) return text;
    const parts = text.split(new RegExp(`(${highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, idx) =>
      part.toLowerCase() === highlightedText.toLowerCase()
        ? <span key={idx} className="highlight-yellow">{part}</span>
        : part
    );
  };

  return (
    <div className="presenter-container">
      {/* ── Header ── */}
      <header className="presenter-header">
        <div className="presenter-header-left">
          <EmblemSVG size={30} />
          <div>
            <h1>Scripture Presenter</h1>
            <p>Projection control console</p>
          </div>
        </div>
        {liveVerse && (
          <div className="live-badge">
            <span className="live-badge-dot" />
            Live
          </div>
        )}
      </header>

      <div className="presenter-layout">
        {/* ── Left: Search ── */}
        <div className="presenter-panel search-panel">
          <h2 className="panel-heading">
            <span className="panel-heading-icon">🔍</span>
            Search Scripture
          </h2>
          <input
            type="text"
            className="search-input"
            placeholder="e.g., John 3:16 or 'faith' …"
            value={query}
            onChange={handleSearch}
            onKeyDown={handleSearchKeyDown}
          />
          <div className="results-list">
            {results.length > 0 ? (
              <ul>
                {results.map((verse) => (
                  <li
                    key={verse.verse_title}
                    className="result-item"
                    onClick={() => handleSelectVerse(verse)}
                  >
                    <div className="result-title">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</div>
                    <div className="result-text">{verse.scripture_text}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">
                Search for a verse<br />to begin…
              </div>
            )}
          </div>
        </div>

        {/* ── Center: Controls ── */}
        <div className="main-panel">
          {/* Now Playing */}
          {liveVerse && (
            <div className="navigation-section">
              <p className="nav-label">
                <span>Now Live</span>
                <span className="nav-label-verse">{liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}</span>
                {liveVerse.segments && liveVerse.segments.length > 1 && (
                  <span className="segmented-badge">Segmented</span>
                )}
                <select value={currentLanguage} onChange={handleLanguageChange}>
                  <option value="en">English</option>
                  <option value="tl">Tagalog</option>
                  <option value="ceb">Cebuano</option>
                </select>
              </p>
              <div className="nav-controls">
                <button className="persistent-nav-button" onClick={() => fetchAdjacent('prev')}>
                  ← Prev
                </button>
                <button
                  className="segment-nav-button"
                  onClick={() => handleSegmentNavigation('prev')}
                  disabled={!liveVerse.segments || liveVerse.segments.length === 1 || currentSegment === 0}
                >
                  ◀
                </button>
                <span className="segment-counter">
                  {liveVerse.segments ? `${currentSegment + 1}/${liveVerse.segments.length}` : '1/1'}
                </span>
                <button
                  className="segment-nav-button"
                  onClick={() => handleSegmentNavigation('next')}
                  disabled={!liveVerse.segments || liveVerse.segments.length === 1 || currentSegment === liveVerse.segments.length - 1}
                >
                  ▶
                </button>
                <button className="persistent-nav-button" onClick={() => fetchAdjacent('next')}>
                  Next →
                </button>
              </div>
            </div>
          )}

          {/* Staging */}
          {staged ? (
            <div className="staged-section">
              <h2 className="panel-heading">
                <span className="panel-heading-icon">⏳</span>
                Staged
              </h2>
              <div className="staged-verse-display">
                <h3 className="staged-title">{staged.book_title} {staged.chapter_number}:{staged.verse_number}</h3>
                <p className="staged-text">{staged.scripture_text}</p>
              </div>
              <div className="staging-controls">
                <button className="nav-button" onClick={() => fetchAdjacent('prev')}>← Previous</button>
                <button className="nav-button" onClick={() => fetchAdjacent('next')}>Next →</button>
              </div>
              <button className="go-live-button" onClick={goLive}>
                ● Go Live
              </button>
            </div>
          ) : !liveVerse ? (
            <div className="staged-section empty">
              <p className="empty-state">Select a verse from the search panel to stage it here</p>
            </div>
          ) : null}

          {/* Client Preview */}
          {liveVerse && (
            <div className="preview-section">
              <h2>Client Preview — select text to highlight</h2>
              <div className="preview-box" onMouseUp={handlePreviewTextSelection}>
                <div className="preview-title">{liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}</div>
                <div className="preview-text">{renderPreviewText()}</div>
                {liveVerse.segments && currentSegment < liveVerse.segments.length - 1 && (
                  <div className="preview-cont">cont…</div>
                )}
              </div>
            </div>
          )}

          {/* Theme Controls */}
          <div className="theme-section">
            <h2>Theme &amp; Display</h2>
            <div className="theme-buttons">
              <button
                className={`theme-btn ${currentTheme === themes.light ? 'active' : ''}`}
                onClick={() => handleThemeChange(themes.light)}
              >
                Light
              </button>
              <button
                className={`theme-btn ${currentTheme === themes.dark ? 'active' : ''}`}
                onClick={() => handleThemeChange(themes.dark)}
              >
                Dark
              </button>
              {savedThemes.map((t) => (
                <button
                  key={t.id}
                  className="theme-btn saved"
                  onClick={() => handleThemeChange(t.data)}
                  title={`Theme: ${t.name}`}
                >
                  {t.name}
                </button>
              ))}
            </div>

            <div className="theme-control-group">
              <label htmlFor="bg-url">Custom Background URL</label>
              <div className="input-group">
                <input
                  id="bg-url"
                  type="text"
                  placeholder="https://example.com/image.jpg"
                  value={bgUrlInput}
                  onChange={(e) => setBgUrlInput(e.target.value)}
                />
                <button
                  className="control-button"
                  onClick={() => {
                    if (!bgUrlInput) return;
                    const updated = { ...currentTheme, background_url: `url('${bgUrlInput}')` };
                    handleThemeChange(updated);
                    setBgUrlInput('');
                  }}
                >
                  Apply
                </button>
              </div>
            </div>

            <div className="theme-control-group">
              <label htmlFor="theme-name">Save Current Theme</label>
              <div className="input-group">
                <input
                  id="theme-name"
                  type="text"
                  placeholder="e.g., Christmas 2025"
                  value={newThemeName}
                  onChange={(e) => setNewThemeName(e.target.value)}
                />
                <button
                  className="control-button"
                  onClick={() => {
                    if (!newThemeName) return;
                    fetch(`${API_URL}/themes`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ name: newThemeName, data: currentTheme }),
                    })
                      .then((r) => r.json())
                      .then((t) => {
                        setSavedThemes([...savedThemes, t]);
                        setNewThemeName('');
                      })
                      .catch((err) => console.error('save theme failed', err));
                  }}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: History ── */}
        <div className="presenter-panel history-panel">
          <h2 className="panel-heading">
            <span className="panel-heading-icon">📜</span>
            Recent
          </h2>
          {history.length > 0 ? (
            <ul className="history-list">
              {history.map((verse, index) => (
                <li
                  key={index}
                  className="history-item"
                  onClick={() => setStaged(verse)}
                  title="Click to re-stage"
                >
                  <span className="history-ref">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">Verses you display<br />will appear here</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Presenter;