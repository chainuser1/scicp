import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

function Client() {
  const normalizeSessionId = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const [urlSession] = useState(() => new URLSearchParams(window.location.search).get('session') || '');
  const [verse, setVerse] = useState({
    scripture_text: 'Waiting for a scripture...',
    segments: [],
    currentSegment: 0,
    totalSegments: 0,
    theme: {
      background_url: "url('https://commons.wikimedia.org/wiki/Special:FilePath/Salt%20Lake%20Temple%20UT2.jpg')",
      font_family: "'Cormorant Garamond', Georgia, serif",
      font_size: "4.1rem",
      layout: "centered"
    }
  });
  const [animating, setAnimating] = useState(false);
  const [highlightedText, setHighlightedText] = useState('');
  const [sessionInput, setSessionInput] = useState(normalizeSessionId(urlSession));
  const [joinedSession, setJoinedSession] = useState('');
  const [sessionMessage, setSessionMessage] = useState(urlSession ? 'Joining session...' : 'Enter session code');
  const [connectionState, setConnectionState] = useState('connecting');
  const joinedSessionRef = useRef('');
  const sessionInputRef = useRef(normalizeSessionId(urlSession));
  // Key forces re-mount of label element → re-triggers arrival animation on verse change
  const [labelKey, setLabelKey] = useState(0);

  useEffect(() => {
    joinedSessionRef.current = joinedSession;
  }, [joinedSession]);

  useEffect(() => {
    sessionInputRef.current = sessionInput;
  }, [sessionInput]);

  useEffect(() => {
    document.title = 'Client Display | Scriptures in View';
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'noindex,nofollow');
  }, []);

  const attemptJoin = (candidate) => {
    const normalized = normalizeSessionId(candidate);
    if (!normalized) {
      setSessionMessage('Enter a valid session code');
      return;
    }
    setSessionMessage('Joining session...');
    socket.emit('join-session', { sessionId: normalized, role: 'viewer' }, (response) => {
      if (!response?.ok) {
        setSessionMessage(response?.message || 'Unable to join session');
      }
    });
  };

  useEffect(() => {
    const handleVerse = (data) => {
      setAnimating(true);
      setTimeout(() => {
        setVerse(data);
        setLabelKey((k) => k + 1);
        setAnimating(false);
      }, 600);
    };

    const handleTheme = (theme) => {
      setAnimating(true);
      setTimeout(() => {
        setVerse((v) => ({ ...v, theme }));
        setAnimating(false);
      }, 600);
    };

    const handleHighlight = (text) => {
      setHighlightedText(text ? text.trim() : '');
    };
    const handleSessionJoined = (data) => {
      if (!data?.sessionId) return;
      setJoinedSession(data.sessionId);
      setSessionInput(data.sessionId);
      setSessionMessage(`Connected to ${data.sessionId}`);
      setHighlightedText('');
    };
    const handleSessionError = (data) => {
      setSessionMessage(data?.message || 'Session error');
    };
    const handleConnect = () => {
      setConnectionState('connected');
      const target = normalizeSessionId(joinedSessionRef.current || urlSession || sessionInputRef.current);
      if (!target) return;
      socket.emit('join-session', { sessionId: target, role: 'viewer' }, (response) => {
        if (!response?.ok) {
          setSessionMessage(response?.message || 'Unable to join session');
        }
      });
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

    socket.on('update-verse', handleVerse);
    socket.on('update-theme', handleTheme);
    socket.on('highlight-text', handleHighlight);
    socket.on('session-joined', handleSessionJoined);
    socket.on('session-error', handleSessionError);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('connect_error', handleConnectError);

    if (urlSession) {
      socket.emit('join-session', { sessionId: normalizeSessionId(urlSession), role: 'viewer' }, (response) => {
        if (!response?.ok) {
          setSessionMessage(response?.message || 'Unable to join session');
        }
      });
    }
    if (socket.connected) {
      handleConnect();
    }

    return () => {
      socket.off('update-verse', handleVerse);
      socket.off('update-theme', handleTheme);
      socket.off('highlight-text', handleHighlight);
      socket.off('session-joined', handleSessionJoined);
      socket.off('session-error', handleSessionError);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('connect_error', handleConnectError);
    };
  }, [urlSession]);

  if (!joinedSession) {
    return (
      <div className="home-page" style={{ alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
        <div className="card card--theme" style={{ width: '100%', maxWidth: '540px' }}>
          <div className="card-header">
            <span className="card-label">Join Display Session</span>
          </div>
          <div className="theme-inputs">
            <div className="theme-control-group">
              <label htmlFor="client-session-code">Session Code</label>
              <div className="input-group">
                <input
                  id="client-session-code"
                  type="text"
                  placeholder="AB12CD"
                  value={sessionInput}
                  onChange={(e) => setSessionInput(normalizeSessionId(e.target.value))}
                />
                <button className="control-button" onClick={() => attemptJoin(sessionInput)}>Join</button>
              </div>
            </div>
            <div style={{ color: '#a09880', fontSize: '0.85rem' }}>{sessionMessage}</div>
            <div style={{ color: '#7f745f', fontSize: '0.75rem' }}>Connection: {connectionState}</div>
          </div>
        </div>
      </div>
    );
  }

  // Determine display text (segment or full)
  const displayText = verse.segments && verse.segments.length > 0
    ? verse.segments[verse.currentSegment] || verse.scripture_text
    : verse.scripture_text;

  const hasMoreSegments = verse.segments && verse.currentSegment < verse.segments.length - 1;

  // Render text with highlight spans (each highlighted word re-mounts → re-triggers animation)
  const renderHighlightedText = () => {
    if (!highlightedText) return displayText;
    const escaped = highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = displayText.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, idx) =>
      part.toLowerCase() === highlightedText.toLowerCase()
        ? <span key={`hl-${idx}-${highlightedText}`} className="highlight-yellow">{part}</span>
        : part
    );
  };

  // Responsive font sizing
  const base = parseFloat(verse.theme?.font_size) || 4;
  const length = displayText.length;
  let calculated = base - length / 100;
  if (calculated < 1.5) calculated = 1.5;
  const computedFontSize = `${calculated}rem`;

  const themeStyles = {
    backgroundImage: verse.theme?.background_url,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: computedFontSize,
  };

  return (
    <div
      className={`client-view ${verse.theme?.layout || 'centered'} ${animating ? 'fade' : ''}`}
      style={themeStyles}
    >
      {/* Verse reference — Cinzel label, re-animates on each verse change */}
      {verse.book_title && verse.chapter_number && verse.verse_number && (
        <span key={labelKey} className="verse-title-top-left">
          {verse.book_title} {verse.chapter_number}:{verse.verse_number}
        </span>
      )}
      {joinedSession && (
        <span className="session-id-top-right">
          Session {joinedSession}
        </span>
      )}

      <div className="verse-content">
        {/* Frosted backdrop wraps the scripture text */}
        <div className="verse-backdrop">
          <p>{renderHighlightedText()}</p>
          {hasMoreSegments && (
            <div className="cont-indicator">continues ›</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Client;
