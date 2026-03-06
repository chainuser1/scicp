import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

function Client() {
  const extractImageUrl = (value) => {
    const match = String(value || '').match(/url\((['"]?)(.*?)\1\)/i);
    return match ? match[2] : '';
  };

  const estimateAverageLuminance = (imageUrl) => new Promise((resolve) => {
    if (!imageUrl) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24;
        canvas.height = 24;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) {
          resolve(null);
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
        let total = 0;
        const pixels = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i] / 255;
          const g = data[i + 1] / 255;
          const b = data[i + 2] / 255;
          total += 0.2126 * r + 0.7152 * g + 0.0722 * b;
        }
        resolve(total / pixels);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });

  const pushReadabilityMode = (mode, steps = 1) => {
    const order = ['soft', 'balanced', 'strong'];
    const start = order.indexOf(mode);
    const index = start === -1 ? 1 : start;
    return order[Math.min(order.length - 1, index + steps)];
  };

  const normalizeSessionId = (value) => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  const [urlSession] = useState(() => new URLSearchParams(window.location.search).get('session') || '');
  const [verse, setVerse] = useState({
    scripture_text: 'Waiting for a scripture...',
    segments: [],
    currentSegment: 0,
    totalSegments: 0,
    theme: {
      background_url: "url('https://www.churchofjesuschrist.org/imgs/0ec17f8ba62b51ed5cfbc746cb506d40c8e7392f/full/!640%2C/0/default')",
      font_family: "'Cormorant Garamond', Georgia, serif",
      font_size: "4.1rem",
      layout: "centered",
      tone: "light"
    }
  });
  const [animating, setAnimating] = useState(false);
  const [highlightedText, setHighlightedText] = useState('');
  const [sessionInput, setSessionInput] = useState(normalizeSessionId(urlSession));
  const [joinedSession, setJoinedSession] = useState('');
  const [sessionMessage, setSessionMessage] = useState(urlSession ? 'Joining session...' : 'Enter session code');
  const [connectionState, setConnectionState] = useState('connecting');
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [readabilityMode, setReadabilityMode] = useState('balanced');
  const [dyslexiaMode, setDyslexiaMode] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [autoReducedMotion, setAutoReducedMotion] = useState(false);
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
    const handleResize = () => {
      setViewport({ w: window.innerWidth, h: window.innerHeight });
    };
    window.addEventListener('resize', handleResize, { passive: true });
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

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

  // Determine display text (segment or full)
  const displayText = verse.segments && verse.segments.length > 0
    ? verse.segments[verse.currentSegment] || verse.scripture_text
    : verse.scripture_text;

  useEffect(() => {
    let active = true;
    const tuneReadability = async () => {
      const bgUrl = extractImageUrl(verse?.theme?.background_url);
      const luminance = await estimateAverageLuminance(bgUrl);
      if (!active) return;

      let mode = 'balanced';
      if (typeof luminance === 'number') {
        if (luminance >= 0.62) mode = 'strong';
        else if (luminance <= 0.22) mode = 'soft';
      }

      let pressure = 0;
      if (viewport.w <= 900) pressure += 1;
      if (displayText.length > 220) pressure += 1;
      if (displayText.length > 420) pressure += 1;

      if (pressure > 0) mode = pushReadabilityMode(mode, pressure >= 2 ? 2 : 1);
      setReadabilityMode(mode);

      const words = displayText.trim().split(/\s+/).filter(Boolean);
      const avgWordLength = words.length ? words.join('').length / words.length : 0;
      const difficultText = displayText.length > 260 || avgWordLength >= 5.6;
      setDyslexiaMode(viewport.w <= 1024 && difficultText);
      setAutoReducedMotion(prefersReducedMotion || viewport.w <= 640 || displayText.length > 320);
    };

    tuneReadability();
    return () => {
      active = false;
    };
  }, [verse?.theme?.background_url, displayText, viewport.w, prefersReducedMotion]);

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
  const minFloor = viewport.w >= 1920 ? 2.8 : viewport.w >= 901 ? 2.3 : viewport.w >= 641 ? 1.95 : 1.28;
  if (calculated < minFloor) calculated = minFloor;
  const modeScale = readabilityMode === 'strong' ? 1.18 : readabilityMode === 'soft' ? 1.0 : 1.1;
  const maxCap = viewport.w >= 2400 ? 8.5 : viewport.w >= 1920 ? 7.6 : viewport.w >= 901 ? 6.2 : viewport.w >= 641 ? 4.8 : 3.1;
  const computedFontSize = `${Math.min(maxCap, calculated * modeScale)}rem`;

  const themeStyles = {
    backgroundImage: verse.theme?.background_url,
    fontFamily: "'Cormorant Garamond', Georgia, serif",
    fontSize: computedFontSize,
  };

  return (
    <div
      className={`client-view ${verse.theme?.tone === 'light' ? 'client-theme-light' : 'client-theme-dark'} readability-${readabilityMode}${dyslexiaMode ? ' readability-dyslexia' : ''}${autoReducedMotion ? ' reduce-motion-auto' : ''} ${verse.theme?.layout || 'centered'} ${animating && !autoReducedMotion ? 'fade' : ''}`}
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
