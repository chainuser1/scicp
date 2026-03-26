/**
 * Preview.jsx — Dedicated staging & projection control screen.
 * Replaces the old Live.jsx. Matches the Preview mockup:
 * - Preview card (bordered box with verse + reference)
 * - Entity tags row
 * - Media controls: ⏮ ◀ ▶(go-live) ▶ ⏭
 * - Context toggle with adjacent verses
 * - Announcement section with "SEND TO SCREEN"
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { useSocketEvent } from '../hooks/useSocket';
import { addToast } from '../hooks/useToast';
import socket, { SERVER_URL } from '../socket';
import ChapterContextSheet from '../components/reader/ChapterContextSheet';
import './Preview.css';

export default function PreviewPage({ staged, setStaged, liveVerse, setLiveVerse, sessionId, addToHistory }) {
  const [currentSegment, setCurrentSegment] = useState(0);
  const [highlightText, setHighlightText] = useState('');
  const [nowReading, setNowReading] = useState(false);
  const [customText, setCustomText] = useState('');
  const [customSubtext, setCustomSubtext] = useState('');
  const [isCustomLive, setIsCustomLive] = useState(false);
  const [contextOn, setContextOn] = useState(false);
  const [adjacentVerses, setAdjacentVerses] = useState([]);
  const [tags, setTags] = useState(null);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [autoAdvanceMs, setAutoAdvanceMs] = useState(5000);
  const adjacentAbortRef = useRef(null);
  const autoTimerRef = useRef(null);
  const [chapterCtxId, setChapterCtxId] = useState(null);

  const displayVerse = liveVerse || staged;
  const segments = displayVerse?.segments || [];
  const hasSegments = segments.length > 1;
  const displayText = hasSegments ? segments[currentSegment] : (displayVerse?.scripture_text || '');

  useSocketEvent('update-verse', (data) => {
    if (data?.verse_title || data?.scripture_text) {
      setCurrentSegment(data.segment ?? 0);
      setIsCustomLive(false);
    }
  });

  // Fetch entity tags when verse changes
  useEffect(() => {
    if (!displayVerse?.verse_id) { setTags(null); return; }
    fetch(`${SERVER_URL}/verse/${displayVerse.verse_id}/tags`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setTags(d); })
      .catch(() => {});
  }, [displayVerse?.verse_id]);

  // Fetch adjacent verses for context panel
  useEffect(() => {
    if (!contextOn || !displayVerse?.verse_id) { setAdjacentVerses([]); return; }
    const fetchContext = async () => {
      const vId = displayVerse.verse_id;
      const params = {
        verse_id: vId,
        ...(displayVerse.book_id != null && { book_id: displayVerse.book_id }),
        ...(displayVerse.chapter_number != null && { chapter_number: displayVerse.chapter_number }),
        ...(displayVerse.verse_number != null && { verse_number: displayVerse.verse_number }),
      };
      try {
        const [prevRes, nextRes] = await Promise.all([
          fetch(`${SERVER_URL}/verse/adjacent?${new URLSearchParams({ ...params, direction: 'prev' })}`),
          fetch(`${SERVER_URL}/verse/adjacent?${new URLSearchParams({ ...params, direction: 'next' })}`),
        ]);
        const arr = [];
        if (prevRes.ok) { const p = await prevRes.json(); arr.push(p); }
        arr.push(displayVerse);
        if (nextRes.ok) { const n = await nextRes.json(); arr.push(n); }
        setAdjacentVerses(arr);
      } catch { /* offline */ }
    };
    fetchContext();
  }, [contextOn, displayVerse?.verse_id]);

  // Auto-advance segments
  useEffect(() => {
    if (autoTimerRef.current) clearInterval(autoTimerRef.current);
    if (autoAdvance && hasSegments && currentSegment < segments.length - 1) {
      autoTimerRef.current = setInterval(() => {
        setCurrentSegment(prev => {
          const next = prev + 1;
          if (next >= segments.length) { clearInterval(autoTimerRef.current); return prev; }
          socket.emit('update-verse', { sessionId, verse: liveVerse, segment: next });
          return next;
        });
      }, autoAdvanceMs);
    }
    return () => { if (autoTimerRef.current) clearInterval(autoTimerRef.current); };
  }, [autoAdvance, hasSegments, currentSegment, segments.length, autoAdvanceMs, sessionId, liveVerse]);

  const goLive = useCallback(() => {
    if (!staged && !displayVerse) return;
    if (!sessionId) { addToast('Join a session first', 'error'); return; }
    const v = staged || displayVerse;
    socket.emit('go-live', { sessionId, verseData: v, language: localStorage.getItem('scicp_language') || 'en', secondaryLanguage: localStorage.getItem('scicp_secondary_language') || null });
    setLiveVerse(v);
    setCurrentSegment(0);
    setIsCustomLive(false);
    addToHistory?.(v);
    addToast('Verse is live!', 'success');
  }, [staged, displayVerse, sessionId, addToHistory, setLiveVerse]);

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
    if (!displayVerse?.verse_id || !sessionId) return;
    if (adjacentAbortRef.current) adjacentAbortRef.current.abort();
    const controller = new AbortController();
    adjacentAbortRef.current = controller;
    const params = new URLSearchParams({
      verse_id: displayVerse.verse_id,
      direction,
      language: localStorage.getItem('scicp_language') || 'en',
      ...(displayVerse.book_id != null && { book_id: displayVerse.book_id }),
      ...(displayVerse.chapter_number != null && { chapter_number: displayVerse.chapter_number }),
      ...(displayVerse.verse_number != null && { verse_number: displayVerse.verse_number }),
    });
    try {
      const res = await fetch(`${SERVER_URL}/verse/adjacent?${params}`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      if (liveVerse) {
        socket.emit('go-live', { sessionId, verseData: data });
        setLiveVerse(data);
        addToHistory?.(data);
      } else {
        setStaged(data);
      }
      setCurrentSegment(0);
    } catch (err) {
      if (err.name !== 'AbortError') addToast('Failed to fetch', 'error');
    }
  }, [displayVerse, sessionId, liveVerse, addToHistory, setStaged, setLiveVerse]);

  const clearScreen = useCallback(() => {
    if (!sessionId) return;
    if (!window.confirm('Clear the screen?')) return;
    socket.emit('clear-screen', { sessionId });
    setLiveVerse(null);
    setIsCustomLive(false);
    addToast('Screen cleared', 'info');
  }, [sessionId, setLiveVerse]);

  const sendCustom = useCallback(() => {
    if (!sessionId || !customText.trim()) return;
    let theme;
    try { theme = JSON.parse(localStorage.getItem('scicp.display_prefs_v1'))?.theme; } catch { /* ignore */ }
    socket.emit('go-custom', { sessionId, text: customText.trim(), subtext: customSubtext.trim() || undefined, theme, secondaryLanguage: localStorage.getItem('scicp_secondary_language') || null });
    setIsCustomLive(true);
    addToast('Sent to screen!', 'success');
  }, [sessionId, customText, customSubtext]);

  const highlight = useCallback(() => {
    if (!sessionId || !highlightText.trim()) return;
    socket.emit('highlight-text', { sessionId, text: highlightText.trim() });
    addToast('Highlighted', 'success');
  }, [sessionId, highlightText]);

  const title = (v) => v?.verse_title || `${v?.book_title || ''} ${v?.chapter_number || ''}:${v?.verse_number || ''}`;
  const isLive = !!liveVerse;

  return (
    <div className="preview-page scroll-area safe-bottom">
      {/* Preview Card */}
      <section className="preview-card-section">
        <span className="preview-label">PREVIEW</span>
        {displayVerse ? (
          <div className={`preview-card ${isLive ? 'preview-card-live' : ''}`}>
            <p className="preview-verse-text">{displayText}</p>
            <p className="preview-verse-ref">{title(displayVerse)}</p>
            {/* Segment dots */}
            {hasSegments && (
              <div className="preview-segment-dots">
                {segments.map((_, idx) => (
                  <span key={idx} className={`seg-dot ${idx === currentSegment ? 'seg-dot-active' : ''}`} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="preview-card preview-card-empty">
            <p className="preview-empty-text">Search and tap a verse to preview</p>
          </div>
        )}
      </section>

      {/* Entity tags */}
      {tags && (tags.labels?.length > 0 || tags.speaker) && (
        <div className="entity-tags">
          {tags.speaker && <span className="entity-tag">{tags.speaker}</span>}
          {tags.labels?.map((l, i) => <span key={i} className="entity-tag">{l}</span>)}
          {tags.pov && <span className="entity-tag entity-tag-dim">{tags.pov}</span>}
        </div>
      )}

      {/* Media controls */}
      <div className="media-controls">
        <button className="media-btn media-btn-sm" onClick={() => fetchAdjacent('prev')} disabled={!displayVerse}>
          ⏮
        </button>
        <button className="media-btn media-btn-sm" onClick={() => navigateSegment('prev')} disabled={!hasSegments || currentSegment === 0}>
          ◀
        </button>
        <button className="media-btn media-btn-play" onClick={goLive} disabled={!displayVerse}>
          ▶
        </button>
        <button className="media-btn media-btn-sm" onClick={() => navigateSegment('next')} disabled={!hasSegments || currentSegment === segments.length - 1}>
          ▶
        </button>
        <button className="media-btn media-btn-sm" onClick={() => fetchAdjacent('next')} disabled={!displayVerse}>
          ⏭
        </button>
      </div>

      {/* Extra controls row */}
      {displayVerse && (
        <div className="preview-extras">
          <button className={`extra-btn ${nowReading ? 'extra-btn-active' : ''}`}
            onClick={() => {
              const next = !nowReading;
              setNowReading(next);
              if (sessionId) socket.emit('now-reading', { sessionId, on: next, verse_id: displayVerse?.verse_id });
            }}>
            📖 {nowReading ? 'Reading On' : 'Reading Off'}
          </button>
          <button className={`extra-btn ${autoAdvance ? 'extra-btn-active' : ''}`}
            onClick={() => setAutoAdvance(!autoAdvance)}>
            ⏩ Auto {autoAdvance ? 'On' : 'Off'}
          </button>
          {isLive && (
            <button className="extra-btn extra-btn-danger" onClick={clearScreen}>
              ◼ End
            </button>
          )}
        </div>
      )}

      {/* Context section */}
      <section className="context-section">
        <div className="context-header">
          <span className="context-label">CONTEXT</span>
          <button className={`context-toggle ${contextOn ? 'context-toggle-on' : ''}`} onClick={() => setContextOn(!contextOn)}>
            {contextOn ? 'ON' : 'OFF'}
          </button>
          {displayVerse?.chapter_id && (
            <button className="context-toggle" onClick={() => setChapterCtxId(displayVerse.chapter_id)} title="Chapter info">
              ℹ
            </button>
          )}
          <span className="context-lang">KJV</span>
        </div>
        {contextOn && adjacentVerses.length > 0 && (
          <div className="context-verses">
            {adjacentVerses.map((v, i) => {
              const isCurrent = v.verse_id === displayVerse?.verse_id;
              return (
                <div key={v.verse_id || i} className={`context-verse ${isCurrent ? 'context-verse-active' : ''}`}>
                  <span className="context-verse-num">{v.verse_number}</span>
                  <p className="context-verse-text">{(v.scripture_text || '').slice(0, 150)}{v.scripture_text?.length > 150 ? '…' : ''}</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Highlight */}
      {isLive && (
        <section className="highlight-section">
          <div className="highlight-row">
            <input
              className="highlight-input"
              placeholder="Highlight text…"
              value={highlightText}
              onChange={e => setHighlightText(e.target.value)}
            />
            <button className="highlight-send" onClick={highlight} disabled={!highlightText.trim()}>
              ✦
            </button>
            <button className="highlight-send" onClick={() => {
              if (sessionId) { socket.emit('highlight-text', { sessionId, text: '' }); setHighlightText(''); addToast('Highlight cleared', 'info'); }
            }} style={{ opacity: highlightText ? 1 : 0.3 }}>
              ✕
            </button>
          </div>
        </section>
      )}

      {/* Announcement */}
      <section className="announcement-section">
        <span className="announcement-label">ANNOUNCEMENT</span>
        <textarea
          className="announcement-input"
          placeholder="Custom text for screen…"
          value={customText}
          onChange={e => setCustomText(e.target.value)}
          rows={2}
        />
        <input
          className="announcement-sub"
          placeholder="Attribution (optional)"
          value={customSubtext}
          onChange={e => setCustomSubtext(e.target.value)}
        />
        <button
          className="announcement-send"
          onClick={sendCustom}
          disabled={!customText.trim() || !sessionId}
        >
          ▶ SEND TO SCREEN
        </button>
      </section>

      {chapterCtxId && (
        <ChapterContextSheet
          chapterId={chapterCtxId}
          bookTitle={displayVerse?.book_title || ''}
          chapterNumber={displayVerse?.chapter_number || ''}
          onClose={() => setChapterCtxId(null)}
        />
      )}
    </div>
  );
}
