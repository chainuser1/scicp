import { useState, useCallback, useRef, useEffect } from 'react';
import { useSocketEvent } from '../hooks/useSocket';
import { addToast } from '../hooks/useToast';
import socket, { SERVER_URL } from '../socket';
import './Live.css';

const HIGHLIGHT_COLORS = ['#FFD700', '#FF6B6B', '#4ECDC4', '#A78BFA', '#F97316'];

export default function LivePage({ staged, setStaged, sessionId, addToHistory }) {
  const [liveVerse, setLiveVerse] = useState(null);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [highlightText, setHighlightText] = useState('');
  const [highlightColor, setHighlightColor] = useState(HIGHLIGHT_COLORS[0]);
  const [nowReading, setNowReading] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customSubtext, setCustomSubtext] = useState('');
  const [isCustomLive, setIsCustomLive] = useState(false);
  const [clearConfirm, setClearConfirm] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [autoAdvanceMs, setAutoAdvanceMs] = useState(5000);
  const [votd, setVotd] = useState(null);
  const adjacentAbortRef = useRef(null);
  const autoTimerRef = useRef(null);
  const clearTimerRef = useRef(null);

  useSocketEvent('update-verse', (data) => {
    if (data.verse_title || data.scripture_text) {
      setLiveVerse(data);
      setCurrentSegment(data.segment ?? 0);
      setIsCustomLive(false);
    }
  });

  // Fetch Verse of the Day for idle state
  useEffect(() => {
    fetch(`${SERVER_URL}/verse/of-the-day`).then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setVotd(d); }).catch(() => {});
  }, []);

  const segments = liveVerse?.segments || [];
  const hasSegments = segments.length > 1;
  const displayText = hasSegments ? segments[currentSegment] : (liveVerse?.scripture_text || '');

  // Auto-advance segments
  useEffect(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    if (autoAdvance && hasSegments && currentSegment < segments.length - 1) {
      autoTimerRef.current = setInterval(() => {
        setCurrentSegment(prev => {
          const next = prev + 1;
          if (next >= segments.length) {
            clearInterval(autoTimerRef.current);
            setAutoAdvance(false);
            return prev;
          }
          socket.emit('update-verse', { sessionId, verse: liveVerse, segment: next });
          return next;
        });
      }, autoAdvanceMs);
    }
    return () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); };
  }, [autoAdvance, hasSegments, currentSegment, segments.length, autoAdvanceMs, sessionId, liveVerse]);

  const goLive = useCallback(() => {
    if (!staged) return;
    if (!sessionId) { addToast('Create or join a session first', 'error'); return; }
    socket.emit('go-live', { sessionId, verseData: staged });
    setLiveVerse(staged);
    setCurrentSegment(0);
    setIsCustomLive(false);
    addToHistory?.(staged);
    addToast('Verse is live!', 'success');
  }, [staged, sessionId, addToHistory]);

  const clearScreen = useCallback(() => {
    if (!sessionId) return;
    if (!clearConfirm) {
      setClearConfirm(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setClearConfirm(false), 2000);
      return;
    }
    setClearConfirm(false);
    socket.emit('clear-screen', { sessionId });
    setLiveVerse(null);
    setIsCustomLive(false);
    addToast('Screen cleared', 'info');
  }, [sessionId, clearConfirm]);

  const highlight = useCallback(() => {
    if (!sessionId || !highlightText.trim()) return;
    socket.emit('highlight-text', { sessionId, text: highlightText.trim(), color: highlightColor });
  }, [sessionId, highlightText, highlightColor]);

  const navigateSegment = useCallback((dir) => {
    if (!hasSegments || !sessionId) return;
    const next = dir === 'next'
      ? Math.min(currentSegment + 1, segments.length - 1)
      : Math.max(currentSegment - 1, 0);
    if (next === currentSegment) return;
    setCurrentSegment(next);
    socket.emit('update-verse', { sessionId, verse: liveVerse, segment: next });
  }, [hasSegments, currentSegment, segments, sessionId, liveVerse]);

  const fetchAdjacent = useCallback(async (direction) => {
    if (!liveVerse?.verse_id || !sessionId) return;
    if (adjacentAbortRef.current) adjacentAbortRef.current.abort();
    const controller = new AbortController();
    adjacentAbortRef.current = controller;
    const params = new URLSearchParams({
      verse_id: liveVerse.verse_id,
      direction,
      ...(liveVerse.book_id != null && { book_id: liveVerse.book_id }),
      ...(liveVerse.chapter_number != null && { chapter_number: liveVerse.chapter_number }),
      ...(liveVerse.verse_number != null && { verse_number: liveVerse.verse_number }),
    });
    try {
      const res = await fetch(`${SERVER_URL}/verse/adjacent?${params}`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      socket.emit('go-live', { sessionId, verseData: data });
      setLiveVerse(data);
      setCurrentSegment(0);
      addToHistory?.(data);
    } catch (err) {
      if (err.name !== 'AbortError') addToast('Failed to fetch adjacent verse', 'error');
    }
  }, [liveVerse, sessionId, addToHistory]);

  const toggleNowReading = useCallback(() => {
    if (!sessionId) return;
    const next = !nowReading;
    setNowReading(next);
    socket.emit('now-reading', { sessionId, on: next, verse_id: liveVerse?.verse_id || null });
  }, [sessionId, nowReading, liveVerse]);

  const sendCustom = useCallback(() => {
    if (!sessionId || !customText.trim()) return;
    socket.emit('go-custom', { sessionId, text: customText.trim(), subtext: customSubtext.trim() || undefined });
    setIsCustomLive(true);
    addToast('Custom text sent!', 'success');
  }, [sessionId, customText, customSubtext]);

  const copyVerse = useCallback(() => {
    if (!liveVerse) return;
    const ref = liveVerse.verse_title || `${liveVerse.book_title} ${liveVerse.chapter_number}:${liveVerse.verse_number}`;
    navigator.clipboard.writeText(`${ref}\n"${liveVerse.scripture_text}"`).then(
      () => addToast('Copied to clipboard', 'success'),
      () => addToast('Copy failed', 'error')
    );
  }, [liveVerse]);

  const title = (v) => v?.verse_title || `${v?.book_title} ${v?.chapter_number}:${v?.verse_number}`;

  return (
    <div className="live-page scroll-area safe-bottom">
      {/* Staged verse */}
      <section className="live-section">
        <h3 className="live-section-label text-xs text-dim font-semibold">STAGED</h3>
        {staged ? (
          <div className="live-staged card">
            <p className="live-verse-ref font-semibold text-gold">{title(staged)}</p>
            <p className="live-verse-text text-sm">{staged.scripture_text}</p>
            <button className="btn btn-live live-go-btn" onClick={goLive}>
              GO LIVE
            </button>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '24px' }}>
            <span className="text-dim text-sm">Search and tap a verse to stage it</span>
          </div>
        )}
      </section>

      {/* Now Live verse with segments */}
      <section className="live-section">
        <h3 className="live-section-label text-xs text-dim font-semibold">
          {isCustomLive ? 'CUSTOM TEXT LIVE' : 'NOW LIVE'}
        </h3>
        {liveVerse ? (
          <div className="live-current card">
            <p className="live-verse-ref font-semibold text-gold">{title(liveVerse)}</p>
            <p className="live-verse-text text-sm">{displayText}</p>

            {/* Segment dots and navigation */}
            {hasSegments && (
              <div className="segment-nav">
                <button
                  className="btn btn-icon btn-sm"
                  onClick={() => navigateSegment('prev')}
                  disabled={currentSegment === 0}
                >
                  ‹
                </button>
                <div className="segment-dots">
                  {segments.map((_, idx) => (
                    <span
                      key={idx}
                      className={`seg-dot ${idx === currentSegment ? 'seg-dot-active' : idx < currentSegment ? 'seg-dot-past' : ''}`}
                    />
                  ))}
                </div>
                <button
                  className="btn btn-icon btn-sm"
                  onClick={() => navigateSegment('next')}
                  disabled={currentSegment === segments.length - 1}
                >
                  ›
                </button>
              </div>
            )}

            {/* Auto-advance toggle for segments */}
            {hasSegments && (
              <div className="auto-advance-row">
                <button
                  className={`btn btn-sm ${autoAdvance ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setAutoAdvance(!autoAdvance)}
                >
                  ⏩ Auto {autoAdvance ? 'ON' : 'OFF'}
                </button>
                {autoAdvance && (
                  <select
                    className="input auto-advance-select"
                    value={autoAdvanceMs}
                    onChange={e => setAutoAdvanceMs(Number(e.target.value))}
                  >
                    <option value={3000}>3s</option>
                    <option value={5000}>5s</option>
                    <option value={8000}>8s</option>
                    <option value={12000}>12s</option>
                  </select>
                )}
              </div>
            )}

            {/* Adjacent verse navigation */}
            <div className="verse-nav">
              <button className="btn btn-secondary btn-sm" onClick={() => fetchAdjacent('prev')}>
                ‹‹ Prev
              </button>
              <button
                className={`now-reading-btn btn btn-sm ${nowReading ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleNowReading}
              >
                📖 {nowReading ? 'On' : 'Off'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={copyVerse}>
                📋
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchAdjacent('next')}>
                Next ››
              </button>
            </div>
          </div>
        ) : (
          /* Idle state: VOTD */
          votd ? (
            <div className="votd-idle card">
              <p className="text-xs text-dim font-semibold" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                📅 Verse of the Day
              </p>
              <p className="text-gold font-semibold text-sm">{title(votd)}</p>
              <p className="text-sm text-secondary" style={{ margin: '6px 0', lineHeight: 1.55 }}>
                {(votd.scripture_text || '').slice(0, 200)}{votd.scripture_text?.length > 200 ? '…' : ''}
              </p>
              <button className="btn btn-primary btn-sm" onClick={() => { setStaged(votd); goLive(); }}>
                Go Live
              </button>
            </div>
          ) : (
            <div className="empty-state" style={{ padding: '24px' }}>
              <span className="text-dim text-sm">Nothing live yet</span>
            </div>
          )
        )}
      </section>

      {/* Controls */}
      <section className="live-section">
        <h3 className="live-section-label text-xs text-dim font-semibold">CONTROLS</h3>
        <div className="live-controls">
          <div className="live-highlight-row">
            <input
              className="input"
              placeholder="Text to highlight…"
              value={highlightText}
              onChange={e => setHighlightText(e.target.value)}
            />
            <button className="btn btn-secondary btn-sm" onClick={highlight}>
              Highlight
            </button>
          </div>
          {/* Highlight color picker */}
          <div className="highlight-colors">
            {HIGHLIGHT_COLORS.map(c => (
              <button
                key={c}
                className={`highlight-color-swatch ${highlightColor === c ? 'hc-active' : ''}`}
                style={{ background: c }}
                onClick={() => setHighlightColor(c)}
              />
            ))}
          </div>
          <div className="live-btn-row">
            <button
              className={`btn ${clearConfirm ? 'btn-danger' : 'btn-secondary'}`}
              onClick={clearScreen}
            >
              {clearConfirm ? 'Tap Again to Clear' : 'Clear Screen'}
            </button>
          </div>
        </div>
      </section>

      {/* Custom text / announcements */}
      <section className="live-section">
        <h3 className="live-section-label text-xs text-dim font-semibold">📢 ANNOUNCEMENT</h3>
        <div className="card">
          <textarea
            className="input custom-textarea"
            placeholder="Text shown large on screen…"
            value={customText}
            onChange={e => setCustomText(e.target.value)}
            rows={3}
          />
          <input
            className="input"
            placeholder="Subtext / attribution (optional)"
            value={customSubtext}
            onChange={e => setCustomSubtext(e.target.value)}
            style={{ marginTop: 8 }}
          />
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 10 }}
            onClick={sendCustom}
            disabled={!customText.trim()}
          >
            Send to Screen
          </button>
        </div>
      </section>

      {!sessionId && (
        <div className="live-no-session">
          <p className="text-sm text-secondary text-center">
            Go to <strong>Settings</strong> to create or join a session
          </p>
        </div>
      )}
    </div>
  );
}
