import React, { useState, useEffect } from 'react';
import { socket } from '../socket';

// API URL for backend endpoints (mirrors socket URL logic)
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

function Presenter() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [currentTheme, setCurrentTheme] = useState(themes.light);
  const [history, setHistory] = useState([]);
  const [staged, setStaged] = useState(null);            // verse waiting to go live
  const [liveVerse, setLiveVerse] = useState(null);      // currently live verse
  const [savedThemes, setSavedThemes] = useState([]);    // themes loaded from server
  const [newThemeName, setNewThemeName] = useState('');  // input for saving themes
  const [bgUrlInput, setBgUrlInput] = useState('');      // custom background URL
  const [currentSegment, setCurrentSegment] = useState(0); // track segment for current verse

  const [highlightedText, setHighlightedText] = useState('');

  useEffect(() => {
    socket.on('search-results', (data) => {
      setResults(data);
    });

    // Listen for verse updates (which include segments from backend)
    socket.on('update-verse', (data) => {
      setLiveVerse(data);
      setCurrentSegment(data.currentSegment || 0);
    });

    // load persisted themes from backend
    fetch(`${API_URL}/themes`)
      .then((res) => res.json())
      .then((list) => setSavedThemes(list))
      .catch((err) => console.error('failed to load themes', err));

    return () => {
      socket.off('search-results');
      socket.off('update-verse');
    };
  }, []);

  // keep staged verse theme in sync when the presenter changes themes
  const handleThemeChange = (theme) => {
    setCurrentTheme(theme);
    if (staged) {
      setStaged((prev) => ({ ...prev, theme }));
    }
    socket.emit('update-theme', theme);
  };

  const handleSearch = (e) => {
    setQuery(e.target.value);
    socket.emit('search', e.target.value);
  };

  const handleSearchKeyDown = (e) => {
    if (e.key === 'Enter' && results.length > 0) {
      // Go directly live with first result (skip staging)
      goLiveDirectly(results[0]);
    }
  };

  const handleSelectVerse = (verse) => {
    const verseWithTheme = { ...verse, theme: currentTheme };
    setStaged(verseWithTheme);
  };

  const goLiveDirectly = (verse) => {
    // Skip staging and go directly live
    const verseWithTheme = { ...verse, theme: currentTheme };
    socket.emit('go-live', { verse: verseWithTheme, theme: verseWithTheme.theme });
    setLiveVerse(verseWithTheme);
    setCurrentSegment(0);
    setHistory([verseWithTheme, ...history.slice(0, 4)]);
  };

  const goLive = () => {
    if (!staged) return;
    socket.emit('go-live', { verse: staged, theme: staged.theme });
    setLiveVerse(staged);
    setCurrentSegment(0); // reset to first segment
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
    if (!source) return;
    const { book_title, chapter_number, verse_number } = source;
    try {
      const res = await fetch(
        `${API_URL}/verse/adjacent?book_title=${encodeURIComponent(book_title)}&chapter_number=${chapter_number}&verse_number=${verse_number}&direction=${direction}`
      );
      if (!res.ok) return;
      const data = await res.json();
      const verseWithTheme = { ...data, theme: currentTheme };
      if (staged) {
        // if staging, update staged verse
        setStaged(verseWithTheme);
      } else {
        // if no staging, go live immediately with the adjacent verse
        socket.emit('go-live', { verse: verseWithTheme, theme: verseWithTheme.theme });
        setLiveVerse(verseWithTheme);
        setCurrentSegment(0); // reset to first segment
        setHistory([verseWithTheme, ...history.slice(0, 4)]);
      }
    } catch (err) {
      console.error('adjacent fetch failed', err);
    }
  };

  const handlePreviewTextSelection = () => {
    const selection = window.getSelection();
    if (!selection) return;
    const selectedText = selection.toString();
    console.log('Emitting highlighted text:', selectedText); // Log emitted text
    setHighlightedText(selectedText);
    socket.emit('highlight-text', selectedText); // Emit highlighted text to the client
  };

  // similar to client rendering: wrap any highlighted substring in a span
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
      <header className="presenter-header">
        <h1>Scripture Presenter</h1>
        <p>Control what appears on the screen</p>
      </header>

      <div className="presenter-layout">
        {/* Left sidebar: search and results */}
        <div className="presenter-panel search-panel">
          <h2>Search Scripture</h2>
          <input
            type="text"
            className="search-input"
            placeholder="e.g., John 3:16 or 'love' (press Enter for first result)"
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
                    <div className="result-title">{verse.verse_title}</div>
                    <div className="result-text">{verse.scripture_text}</div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="empty-state">Search for a verse to get started...</div>
            )}
          </div>
        </div>

        {/* Middle/main area: staging and theme controls */}
        <div className="presenter-panel main-panel">
          {/* Always-visible navigation controls */}
          {liveVerse && (
            <div className="navigation-section">
              <h3 className="nav-label">
                Now Playing: {liveVerse.verse_title}
                {liveVerse.segments && liveVerse.segments.length > 1 && (
                  <span className="segmented-badge">SEGMENTED</span>
                )}
              </h3>
              
              <div className="nav-controls">
                <button
                  className="persistent-nav-button"
                  onClick={() => fetchAdjacent('prev')}
                  title="Go to previous verse"
                >
                  ← Prev Verse
                </button>
                <button
                  className="segment-nav-button"
                  onClick={() => handleSegmentNavigation('prev')}
                  disabled={!liveVerse.segments || liveVerse.segments.length === 1 || currentSegment === 0}
                  title={liveVerse.segments && liveVerse.segments.length > 1 ? "Previous segment" : "No segments"}
                >
                  ◀
                </button>
                <span className="segment-counter">
                  {liveVerse.segments ? `${currentSegment + 1}/${liveVerse.segments.length}` : "1/1"}
                </span>
                <button
                  className="segment-nav-button"
                  onClick={() => handleSegmentNavigation('next')}
                  disabled={!liveVerse.segments || liveVerse.segments.length === 1 || currentSegment === liveVerse.segments.length - 1}
                  title={liveVerse.segments && liveVerse.segments.length > 1 ? "Next segment" : "No segments"}
                >
                  ▶
                </button>
                <button
                  className="persistent-nav-button"
                  onClick={() => fetchAdjacent('next')}
                  title="Go to next verse"
                >
                  Next Verse →
                </button>
              </div>
            </div>
          )}

          {/* Staging area */}
          {staged ? (
            <div className="staged-section">
              <h2>Now Staging</h2>
              <div className="staged-verse-display">
                <h3 className="staged-title">{staged.verse_title}</h3>
                <p className="staged-text">{staged.scripture_text}</p>
              </div>
              <div className="staging-controls">
                <button
                  className="nav-button"
                  onClick={() => fetchAdjacent('prev')}
                  title="Previous verse in chapter"
                >
                  ← Previous
                </button>
                <button
                  className="nav-button"
                  onClick={() => fetchAdjacent('next')}
                  title="Next verse in chapter"
                >
                  Next →
                </button>
              </div>
              <button className="go-live-button" onClick={goLive}>
                🔴 Go Live
              </button>
            </div>
          ) : !liveVerse ? (
            <div className="staged-section empty">
              <p className="empty-state">Select a verse to stage it here</p>
            </div>
          ) : null}

          {/* Preview/Monitor section - shows what client sees */}
          {liveVerse && (
            <div className="preview-section">
              <h2>Client Preview</h2>
              <div className="preview-box" onMouseUp={handlePreviewTextSelection}>
                <div className="preview-title">{liveVerse.verse_title}</div>
                <div className="preview-text">
                  {renderPreviewText()}
                </div>
                {liveVerse.segments && currentSegment < liveVerse.segments.length - 1 && (
                  <div className="preview-cont">cont...</div>
                )}
              </div>
            </div>
          )}

          {/* Theme controls */}
          <div className="theme-section">
            <h2>Theme & Display</h2>
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

            {/* Background image input */}
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

            {/* Save theme */}
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

        {/* Right sidebar: history */}
        <div className="presenter-panel history-panel">
          <h2>Recent</h2>
          {history.length > 0 ? (
            <ul className="history-list">
              {history.map((verse, index) => (
                <li
                  key={index}
                  className="history-item"
                  onClick={() => {
                    setStaged(verse);
                  }}
                  title="Click to re-stage"
                >
                  <span className="history-ref">{verse.verse_title}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="empty-state">Verses you display will appear here</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Presenter;

