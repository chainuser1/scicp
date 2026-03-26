import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnectionState, useSocketEvent } from '../hooks/useSocket';
import socket, { SERVER_URL } from '../socket';
import './TVClient.css';

export default function TVClient() {
  const conn = useConnectionState();
  const [sessionId, setSessionId] = useState(() => localStorage.getItem('scicp_tv_session') || '');
  const [joinInput, setJoinInput] = useState('');
  const [verse, setVerse] = useState(null);
  const [theme, setTheme] = useState({ backgroundColor: '#0a0a0f', textColor: '#f0ece4' });
  const [highlightedText, setHighlightedText] = useState('');
  const [presenterJoined, setPresenterJoined] = useState(false);
  const [votd, setVotd] = useState(null);
  const [bgUrl, setBgUrl] = useState('');
  const [prevBg, setPrevBg] = useState('');
  const [bgFading, setBgFading] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontScale, setFontScale] = useState(() => parseFloat(localStorage.getItem('scicp_tv_fontscale') || '1'));

  // Create client session on mount
  useEffect(() => {
    if (conn !== 'connected') return;
    if (sessionId) {
      socket.emit('join-session', { sessionId, role: 'client' });
    } else {
      socket.emit('create-client-session');
    }
  }, [conn]);

  useSocketEvent('client-session-created', (data) => {
    setSessionId(data.sessionId);
    localStorage.setItem('scicp_tv_session', data.sessionId);
  });

  useSocketEvent('session-joined', (data) => {
    setSessionId(data.sessionId);
    localStorage.setItem('scicp_tv_session', data.sessionId);
  });

  useSocketEvent('update-verse', (data) => {
    setVerse(data);
    setHighlightedText('');
  });

  useSocketEvent('update-theme', (data) => {
    if (data.theme) setTheme(data.theme);
  });

  useSocketEvent('highlight-text', (data) => {
    setHighlightedText(data.text || '');
  });

  useSocketEvent('clear-screen', () => {
    setVerse(null);
    setHighlightedText('');
  });

  useSocketEvent('preload-background', (data) => {
    if (data.url) {
      setPrevBg(bgUrl);
      setBgFading(true);
      const img = new Image();
      img.onload = () => { setBgUrl(data.url); setTimeout(() => setBgFading(false), 600); };
      img.src = data.url;
    }
  });

  useSocketEvent('presenter-joined', () => setPresenterJoined(true));

  // Fetch VOTD
  useEffect(() => {
    fetch(`${SERVER_URL}/health`).then(r => r.json()).catch(() => null);
  }, []);

  const joinManual = () => {
    if (!joinInput.trim()) return;
    socket.emit('join-session', { sessionId: joinInput.trim(), role: 'client' });
    setJoinInput('');
  };

  // D-pad handler
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Enter' || e.key === ' ') setSettingsOpen(v => !v);
      if (e.key === 'ArrowUp') setFontScale(v => { const n = Math.min(v + 0.1, 2); localStorage.setItem('scicp_tv_fontscale', n); return n; });
      if (e.key === 'ArrowDown') setFontScale(v => { const n = Math.max(v - 0.1, 0.5); localStorage.setItem('scicp_tv_fontscale', n); return n; });
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Render highlighted text
  const renderText = (text) => {
    if (!highlightedText || !text) return text;
    const idx = text.toLowerCase().indexOf(highlightedText.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="tv-highlight">{text.slice(idx, idx + highlightedText.length)}</mark>
        {text.slice(idx + highlightedText.length)}
      </>
    );
  };

  const title = verse?.verse_title || (verse ? `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}` : '');

  return (
    <div
      className="tv-root"
      style={{
        backgroundColor: theme.backgroundColor,
        color: theme.textColor,
        fontSize: `${fontScale}em`,
      }}
    >
      {/* Background layers */}
      {prevBg && bgFading && (
        <div className="tv-bg tv-bg-prev" style={{ backgroundImage: `url(${prevBg})` }} />
      )}
      {bgUrl && (
        <div className={`tv-bg ${bgFading ? 'tv-bg-enter' : ''}`} style={{ backgroundImage: `url(${bgUrl})` }} />
      )}

      {/* Idle / Waiting */}
      {!verse && (
        <div className="tv-idle">
          <div className="tv-idle-content">
            <h1 className="tv-app-title">Scriptures in View</h1>
            <p className="tv-idle-status">
              {conn !== 'connected'
                ? 'Connecting to server…'
                : presenterJoined
                  ? 'Presenter connected — waiting for verse…'
                  : 'Waiting for presenter…'}
            </p>
            {sessionId && (
              <div className="tv-session-badge">
                <span className="tv-session-label">Session</span>
                <span className="tv-session-id">{sessionId}</span>
              </div>
            )}
            {!sessionId && conn === 'connected' && (
              <div className="tv-join-form">
                <input
                  className="tv-join-input"
                  placeholder="Enter session ID"
                  value={joinInput}
                  onChange={e => setJoinInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && joinManual()}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Verse Display */}
      {verse && (
        <div className="tv-verse-container">
          <p className="tv-verse-text">{renderText(verse.scripture_text)}</p>
          <p className="tv-verse-ref">{title}</p>
        </div>
      )}

      {/* Settings overlay (D-pad accessible) */}
      {settingsOpen && (
        <div className="tv-settings-overlay">
          <div className="tv-settings-panel">
            <h2>Display Settings</h2>
            <p>Font Scale: {fontScale.toFixed(1)}x</p>
            <p className="text-dim">↑↓ to adjust • Enter to close</p>
          </div>
        </div>
      )}

      {/* Connection indicator */}
      <div className="tv-conn-dot">
        <span className={`status-dot ${conn}`} />
      </div>
    </div>
  );
}
