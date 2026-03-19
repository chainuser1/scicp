/**
 * SimplePresenter — a clean, guided UI for non-technical users.
 *
 * Design principles:
 * - The screen always tells you what to do next
 * - One action per step — no staging, no drawers, no junk menus
 * - Plain English labels, large tap targets
 * - A gear icon for those who want more
 */
import React, { useState, useRef, useEffect } from 'react';

const TIPS = [
  'Type a topic, a name, or a reference like "John 3:16"',
  'Try typing "faith", "hope", or "love"',
  'You can search "Alma 32" or "D&C 76"',
  'Search "resurrection" or "atonement"',
];

export default function SimplePresenter({
  // search
  query, setQuery, results, handleSearch,
  // go live
  goLiveDirectly, liveVerse,
  // clear
  onClear,
  // connection
  isOnline, connectionState, sessionJoined,
  // casting (offline)
  isCastingActive, lanServerUrl,
  // settings toggle
  onOpenAdvanced,
  // current language
  currentLanguage,
}) {
  const inputRef  = useRef(null);
  const [tip]     = useState(() => TIPS[Math.floor(Math.random() * TIPS.length)]);
  const [pressed, setPressed] = useState(null); // verse_id of tapped card (visual feedback)

  // Focus search on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 300);
  }, []);

  // Derive screen status message
  const screenStatus = (() => {
    if (isOnline) {
      if (!sessionJoined)        return { icon: '📡', text: 'Not connected to TV', ok: false };
      if (connectionState === 'connecting') return { icon: '🔄', text: 'Connecting…', ok: false };
      return { icon: '📺', text: 'TV connected', ok: true };
    }
    if (isCastingActive)         return { icon: '📺', text: 'Showing on screen', ok: true };
    if (lanServerUrl)            return { icon: '📡', text: 'TV URL ready', ok: true };
    return { icon: '📱', text: 'No screen connected', ok: false };
  })();

  const handleTap = (verse) => {
    setPressed(verse.verse_id);
    goLiveDirectly(verse);
    setTimeout(() => setPressed(null), 600);
  };

  return (
    <div className="simple-presenter">

      {/* ── Header ───────────────────────────────── */}
      <div className="sp-header">
        <div className="sp-logo">
          <span className="sp-logo-text">Scriptures in View</span>
        </div>
        <button
          className="sp-gear"
          onClick={onOpenAdvanced}
          aria-label="Open advanced settings"
          title="Switch to advanced mode"
        >
          ⚙
        </button>
      </div>

      {/* ── Screen status banner ──────────────────── */}
      <div className={`sp-status${screenStatus.ok ? ' sp-status--ok' : ' sp-status--off'}`}>
        <span className="sp-status-icon">{screenStatus.icon}</span>
        <span className="sp-status-text">{screenStatus.text}</span>
        {isOnline && !sessionJoined && (
          <span className="sp-status-hint">Ask the TV operator to start a session, then tap ⚙ to connect</span>
        )}
        {!isOnline && !isCastingActive && lanServerUrl && (
          <span className="sp-status-hint">{lanServerUrl}</span>
        )}
      </div>

      {/* ── Search bar ───────────────────────────── */}
      <div className="sp-search-wrap">
        <span className="sp-search-icon">🔍</span>
        <input
          ref={inputRef}
          className="sp-search"
          type="search"
          value={query}
          onChange={handleSearch}
          placeholder={tip}
          autoComplete="off"
          autoCorrect="off"
          spellCheck="false"
          enterKeyHint="search"
          aria-label="Search scriptures"
        />
        {query.length > 0 && (
          <button className="sp-search-clear" onClick={() => handleSearch({ target: { value: '' } })} aria-label="Clear">✕</button>
        )}
      </div>

      {/* ── Results ──────────────────────────────── */}
      <div className="sp-results">
        {results.length === 0 && query.length === 0 && (
          <div className="sp-empty">
            <p className="sp-empty-title">What will you share today?</p>
            <p className="sp-empty-sub">{tip}</p>
          </div>
        )}

        {results.length === 0 && query.length > 0 && (
          <div className="sp-empty">
            <p className="sp-empty-title">No results for "{query}"</p>
            <p className="sp-empty-sub">Try different words or a reference like "Matthew 5:3"</p>
          </div>
        )}

        {results.map(verse => {
          const isLive = liveVerse?.verse_id === verse.verse_id;
          const isTapped = pressed === verse.verse_id;
          return (
            <button
              key={verse.verse_id}
              className={`sp-verse-card${isLive ? ' sp-verse-card--live' : ''}${isTapped ? ' sp-verse-card--tapped' : ''}`}
              onClick={() => handleTap(verse)}
              aria-label={`Show on screen: ${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`}
            >
              <div className="sp-verse-ref">
                {verse.book_title} {verse.chapter_number}:{verse.verse_number}
                {isLive && <span className="sp-live-badge">● On Screen</span>}
              </div>
              <p className="sp-verse-text">{verse.scripture_text}</p>
              <div className="sp-verse-action">
                {isLive ? 'Showing now' : 'Tap to show on screen'}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Live verse + Clear ────────────────────── */}
      {liveVerse && (
        <div className="sp-now-live">
          <div className="sp-now-live-label">● Now on screen</div>
          <div className="sp-now-live-ref">
            {liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}
          </div>
          <button className="sp-clear-btn" onClick={onClear}>
            Clear Screen
          </button>
        </div>
      )}
    </div>
  );
}
