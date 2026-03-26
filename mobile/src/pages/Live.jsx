import { useState, useCallback, useRef } from 'react';
import { useSocketEvent } from '../hooks/useSocket';
import { addToast } from '../hooks/useToast';
import socket, { SERVER_URL } from '../socket';
import './Live.css';

export default function LivePage({ staged, setStaged, sessionId, addToHistory }) {
  const [liveVerse, setLiveVerse] = useState(null);
  const [currentSegment, setCurrentSegment] = useState(0);
  const [highlightText, setHighlightText] = useState('');
  const [nowReading, setNowReading] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customSubtext, setCustomSubtext] = useState('');
  const [isCustomLive, setIsCustomLive] = useState(false);
  const adjacentAbortRef = useRef(null);

  useSocketEvent('update-verse', (data) => {
    if (data.verse_title || data.scripture_text) {
      setLiveVerse(data);
      setCurrentSegment(data.segment ?? 0);
      setIsCustomLive(false);
    }
  });

  const segments = liveVerse?.segments || [];
  const hasSegments = segments.length > 1;
  const displayText = hasSegments ? segments[currentSegment] : (liveVerse?.scripture_text || '');

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
    socket.emit('clear-screen', { sessionId });
    setLiveVerse(null);
    setIsCustomLive(false);
    addToast('Screen cleared', 'info');
  }, [sessionId]);

  const highlight = useCallback(() => {
    if (!sessionId || !highlightText.trim()) return;
    socket.emit('highlight-text', { sessionId, text: highlightText.trim() });
  }, [sessionId, highlightText]);

  const navigateSegment = useCallback((dir) => {
    if (!hasSegments || !sessionId) return;
    const next = dir === 'next'
      ? Math.min(currentSegment + 1, segments.length - 1)
      : Math.max(currentSegment - 1, 0);
    if (next === currentSegment) return;
    setCurrentSegment(next);
    socket.emit('update-verse', {
      sessionId,
      verse: liveVerse,
      segment: next,
    });
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

            {/* Adjacent verse navigation */}
            <div className="verse-nav">
              <button className="btn btn-secondary btn-sm" onClick={() => fetchAdjacent('prev')}>
                ‹‹ Prev Verse
              </button>
              <button
                className={`now-reading-btn btn btn-sm ${nowReading ? 'btn-primary' : 'btn-ghost'}`}
                onClick={toggleNowReading}
              >
                📖 {nowReading ? 'On' : 'Off'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={() => fetchAdjacent('next')}>
                Next Verse ››
              </button>
            </div>
          </div>
        ) : (
          <div className="empty-state" style={{ padding: '24px' }}>
            <span className="text-dim text-sm">Nothing live yet</span>
          </div>
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
          <div className="live-btn-row">
            <button className="btn btn-danger" onClick={clearScreen}>
              Clear Screen
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
