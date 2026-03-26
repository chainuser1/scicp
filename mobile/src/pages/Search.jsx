import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearch } from '../hooks/useSearch';
import { addToast } from '../hooks/useToast';
import { SERVER_URL } from '../socket';
import QrScanner from '../components/QrScanner';
import './Search.css';

const QUICK_TOPICS = [
  'Faith', 'Atonement', 'Prayer', 'Hope',
  'Charity', 'Repentance', 'Grace', 'Covenant',
];

export default function SearchPage({
  onStage, onGoLive, history, clearHistory, bookmarks,
  sessionId, session, onAddToSetlist,
}) {
  const { query, setQuery, results, meta, loading, search, loadMore, clear } = useSearch();
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [votd, setVotd] = useState(null);
  const suggestRef = useRef(null);
  const [intExpanded, setIntExpanded] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  useEffect(() => {
    fetch(`${SERVER_URL}/verse/of-the-day`).then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setVotd(d); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (suggestRef.current) clearTimeout(suggestRef.current);
    if (!query || query.length < 2) { setSuggestions([]); return; }
    suggestRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`${SERVER_URL}/suggest?q=${encodeURIComponent(query)}&limit=6`);
        if (res.ok) { const data = await res.json(); setSuggestions(data); setShowSuggestions(true); }
      } catch { /* offline */ }
    }, 300);
    return () => clearTimeout(suggestRef.current);
  }, [query]);

  const handleSubmit = (e) => {
    e.preventDefault();
    search(query);
    setShowSuggestions(false);
    inputRef.current?.blur();
  };

  const handleSuggestionTap = (s) => {
    const q = typeof s === 'string' ? s : s.text || s.query || s;
    setQuery(q);
    search(q);
    setShowSuggestions(false);
  };

  const handleScroll = (e) => {
    const el = e.target;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) loadMore();
  };

  const copyVerse = useCallback((verse) => {
    const ref = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
    const text = `${ref}\n"${verse.scripture_text}"`;
    navigator.clipboard.writeText(text).then(
      () => addToast('Copied to clipboard', 'success'),
      () => addToast('Copy failed', 'error')
    );
  }, []);

  const logFeedback = useCallback((verse, rank) => {
    fetch(`${SERVER_URL}/search-feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ verse_id: verse.verse_id, query, rank, source: verse._source }),
    }).catch(() => {});
  }, [query]);

  const handleScannedCode = (code) => {
    setScannerOpen(false);
    if (session?.joinSession) {
      session.joinSession(code);
      addToast(`Joining session: ${code}`, 'info');
    }
  };

  const handleManualJoin = () => {
    const code = joinCode.trim();
    if (!code) return;
    if (session?.joinSession) {
      session.joinSession(code);
      setJoinCode('');
      addToast(`Joining session: ${code}`, 'info');
    }
  };

  const hasResults = results.length > 0;
  const isIdle = !hasResults && !loading && !query;
  const isConnected = session?.isConnected;
  const hasSession = !!sessionId;

  return (
    <div className="search-page">
      {/* ═══ CONNECT TO PROJECTOR — dominant gate when no session ═══ */}
      {!hasSession && isIdle && (
        <div className="connect-gate">
          <div className="connect-gate-icon">📡</div>
          <h2 className="connect-gate-title">Connect to Projector</h2>
          <p className="connect-gate-desc">
            Scan the QR code displayed on your TV screen, or enter the session code manually.
          </p>

          <button className="connect-gate-scan-btn" onClick={() => setScannerOpen(true)}>
            ⊞ Scan QR Code
          </button>

          <div className="connect-gate-divider">
            <span className="connect-gate-or">or</span>
          </div>

          <div className="connect-gate-manual">
            <input
              className="connect-gate-input"
              placeholder="Enter session code"
              value={joinCode}
              onChange={e => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleManualJoin()}
              maxLength={24}
              autoComplete="off"
            />
            <button className="connect-gate-join-btn" onClick={handleManualJoin}>Join</button>
          </div>

          {session?.error && <p className="connect-gate-error">{session.error}</p>}

          <div className="connect-gate-status">
            <span className={`status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
            <span className="connect-gate-status-text">
              {isConnected ? 'Server connected — waiting for session' : 'Connecting to server…'}
            </span>
          </div>
        </div>
      )}

      {/* ═══ Normal presenter UI (has session OR actively searching) ═══ */}
      {(hasSession || !isIdle) && (
        <>
          {/* Search bar */}
          <div className="search-bar-wrap">
            <form className="search-bar" onSubmit={handleSubmit}>
              <span className="search-icon">🔍</span>
              <input
                ref={inputRef}
                className="search-input-new"
                type="search"
                placeholder="Search scriptures…"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
                enterKeyHint="search"
                autoComplete="off"
              />
              {meta?.total != null && hasResults && (
                <span className="result-count-badge">{meta.total}</span>
              )}
              {query && (
                <button type="button" className="search-clear" onClick={clear}>✕</button>
              )}
            </form>
            {showSuggestions && suggestions.length > 0 && (
              <div className="suggestions-dropdown">
                {suggestions.map((s, i) => (
                  <button key={i} className="suggestion-item" onMouseDown={() => handleSuggestionTap(s)}>
                    <span className="text-sm">{typeof s === 'string' ? s : s.text || s.query}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Intelligence bar */}
          {meta && hasResults && (
            <div className="intelligence-bar">
              <div className="intel-row">
                {meta.intelligenceHints?.map((h, i) => (
                  <span key={i} className="intel-pill">{h}</span>
                ))}
                {meta.intent && <span className="intel-pill">{meta.intent}</span>}
                {meta.qpprActive && <span className="intel-pill">graph</span>}
                {meta.expansions?.length > 0 && (
                  <button className="intel-expand-btn" onClick={() => setIntExpanded(!intExpanded)}>
                    {intExpanded ? '▲' : '▼'} {meta.expansions.length}
                  </button>
                )}
                <span className="intel-lang">EN ∨</span>
              </div>
              {intExpanded && meta.expansions?.length > 0 && (
                <div className="intel-expansions">
                  {meta.expansions.map((t, i) => (
                    <span key={i} className="intel-pill intel-pill-sm">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="search-results scroll-area safe-bottom" ref={listRef} onScroll={handleScroll}>
            {/* Active search results */}
            {hasResults && results.map((v, i) => (
              <SearchResultRow
                key={v.verse_id || i}
                verse={v}
                onStage={() => { onStage(v); logFeedback(v, i); }}
                onGoLive={() => { onGoLive(v); logFeedback(v, i); }}
              />
            ))}

            {/* No results */}
            {results.length === 0 && !loading && query && (
              <div className="empty-state">
                <span className="empty-state-icon">📖</span>
                <p className="text-secondary">No results found</p>
              </div>
            )}

            {/* ── Idle State (connected) ── */}
            {isIdle && hasSession && (
              <>
                {/* VOTD Card */}
                {votd && (
                  <div className="votd-card">
                    <div className="votd-header">
                      <span className="votd-marker">◆ VERSE OF THE DAY</span>
                      <span className="votd-date">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
                    </div>
                    <p className="votd-text">
                      "{(votd.scripture_text || '').slice(0, 200)}{votd.scripture_text?.length > 200 ? '…' : ''}"
                    </p>
                    <p className="votd-ref">
                      — {votd.verse_title || `${votd.book_title} ${votd.chapter_number}:${votd.verse_number}`} (KJV)
                    </p>
                    <div className="votd-actions">
                      <button className="votd-btn votd-btn-secondary" onClick={() => copyVerse(votd)}>Copy</button>
                      <button className="votd-btn votd-btn-secondary" onClick={() => onStage(votd)}>Stage</button>
                      <button className="votd-btn votd-btn-live" onClick={() => onGoLive(votd)}>▶ Go Live</button>
                    </div>
                  </div>
                )}

                {/* Session active + Ready Check row */}
                <div className="idle-cards-row">
                  <div className="idle-card session-card">
                    <span className="idle-card-marker">◇ Session</span>
                    <span className="session-code-display">{sessionId}</span>
                  </div>
                  <div className="idle-card ready-card">
                    <span className="idle-card-marker">◇ Ready Check</span>
                    <div className="ready-checklist">
                      <span className={`ready-item ${isConnected ? 'ready-ok' : 'ready-no'}`}>
                        {isConnected ? '●' : '○'} Server connected
                      </span>
                      <span className="ready-item ready-ok">● Session active</span>
                      <span className="ready-item ready-no">○ Stage a verse</span>
                      <span className="ready-item ready-no">○ Go Live to project</span>
                    </div>
                  </div>
                </div>

                {/* Quick Topics */}
                <div className="quick-topics">
                  <span className="quick-topics-label">◆ Quick Topics</span>
                  <span className="quick-topics-hint">tap to search</span>
                  <div className="topic-chips">
                    {QUICK_TOPICS.map(t => (
                      <button key={t} className="topic-chip" onClick={() => { setQuery(t.toLowerCase()); search(t.toLowerCase()); }}>
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {loading && (
              <div className="search-loading"><div className="spinner" /></div>
            )}
          </div>
        </>
      )}

      {/* QR Scanner overlay */}
      {scannerOpen && (
        <QrScanner onScan={handleScannedCode} onClose={() => setScannerOpen(false)} />
      )}
    </div>
  );
}

/* Compact search result row matching mockup */
function SearchResultRow({ verse, onStage, onGoLive }) {
  const title = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
  const text = verse.scripture_text || '';
  const preview = text.length > 120 ? text.slice(0, 120) + '…' : text;
  const source = verse._source;

  return (
    <div className="result-row" onClick={onStage}>
      <div className="result-top">
        <span className="result-ref">{title}</span>
        {source && <span className="result-badge">{source.toUpperCase()}</span>}
        {verse._tier && verse._tier <= 2 && <span className="result-badge">TL</span>}
      </div>
      <p className="result-text">{preview}</p>
      <button
        className="result-live-dot"
        onClick={(e) => { e.stopPropagation(); onGoLive(); }}
        aria-label="Go live immediately"
      >
        <span className="dot-red" />
      </button>
    </div>
  );
}
