import { useState, useCallback } from 'react';
import { useSocketEvent } from '../hooks/useSocket';
import { addToast } from '../hooks/useToast';
import socket from '../socket';
import './Live.css';

export default function LivePage({ staged, setStaged, sessionId }) {
  const [liveVerse, setLiveVerse] = useState(null);
  const [segments, setSegments] = useState([]);
  const [segIdx, setSegIdx] = useState(0);
  const [highlightText, setHighlightText] = useState('');
  const [language, setLanguage] = useState('en');

  useSocketEvent('update-verse', (data) => {
    if (data.verse_title) setLiveVerse(data);
  });

  const goLive = useCallback(() => {
    if (!staged) return;
    if (!sessionId) { addToast('Create or join a session first', 'error'); return; }
    socket.emit('go-live', {
      sessionId,
      verseData: staged,
    });
    setLiveVerse(staged);
    addToast('Verse is live!', 'success');
  }, [staged, sessionId]);

  const clearScreen = useCallback(() => {
    if (!sessionId) return;
    socket.emit('clear-screen', { sessionId });
    setLiveVerse(null);
    addToast('Screen cleared', 'info');
  }, [sessionId]);

  const highlight = useCallback(() => {
    if (!sessionId || !highlightText.trim()) return;
    socket.emit('highlight-text', { sessionId, text: highlightText.trim() });
  }, [sessionId, highlightText]);

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

      {/* Live verse */}
      <section className="live-section">
        <h3 className="live-section-label text-xs text-dim font-semibold">NOW LIVE</h3>
        {liveVerse ? (
          <div className="live-current card">
            <p className="live-verse-ref font-semibold text-gold">{title(liveVerse)}</p>
            <p className="live-verse-text text-sm">{liveVerse.scripture_text}</p>
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
