import { useState, useEffect, useRef } from 'react';
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
      background_url: "url('https://www.churchofjesuschrist.org/imgs/ae2c3112eda211edae1aeeeeac1ef8149c058327/full/%21500%2C/0/default')",
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

  // ─── Responsive font sizing — "never clip" approach ───────────────────────
  //
  // Core principle: the font size must be derived from what fits inside the
  // verse-backdrop, not from an aspirational base size that is then capped.
  // Clipping happened because calibratedFloor could force the size back UP
  // past what actually fits, and modeScale (up to 1.18×) pushed it higher still.
  //
  // New approach:
  //   1. Measure how much vertical space the backdrop actually has.
  //   2. Estimate how many lines the text needs at a given font size.
  //   3. Solve for the largest font size where all lines fit — then apply a
  //      small safety margin so real browser wrapping never exceeds the estimate.
  //   4. Apply a hard ceiling (maxCap) and a soft aesthetic floor that is only
  //      used when the text is genuinely short enough to afford it.
  // ────────────────────────────────────────────────────────────────────────────

  const length = displayText.length;

  // Hard upper cap per screen size — prevents comically large text on short verses
  const maxCap = viewport.w >= 2400 ? 8.0 : viewport.w >= 1920 ? 7.0 : viewport.w >= 901 ? 5.8 : viewport.w >= 641 ? 4.4 : 2.9;

  // Usable backdrop height in px.
  //   verse-backdrop: max-height: min(78dvh, 900px)
  //   We subtract the backdrop's vertical padding (≈ 2 × clamp(1rem,2.4vh,2.2rem))
  //   and a small fudge for the gold accent line + box-shadow rendering.
  //   lower-third layout has extra bottom padding (clamp(2.4rem,7vh,6rem)) so we
  //   also knock that off the viewport before computing backdrop height.
  const backdropPaddingPx = 2 * Math.min(35.2, Math.max(16, viewport.h * 0.024)); // 2×clamp(1rem,2.4vh,2.2rem)
  const lowerThirdBottomPx = verse.theme?.layout === 'lower-third'
    ? Math.min(96, Math.max(38.4, viewport.h * 0.07)) // clamp(2.4rem,7vh,6rem)
    : 0;
  const backdropMaxHeightPx = Math.min(viewport.h * 0.78, 900) - lowerThirdBottomPx;
  // Reserve space for: cont-indicator (≈24px when visible), backdrop padding, safety
  const contIndicatorPx = hasMoreSegments ? 28 : 0;
  const safetyPx = 12; // breathing room so layout engine never needs to wrap one extra line
  const textAreaHeightPx = Math.max(80, backdropMaxHeightPx - backdropPaddingPx - contIndicatorPx - safetyPx);

  // Estimate lines at a *reference* 1rem font size, then scale.
  // Cormorant Garamond is a wide serif — empirically ~0.52 × fontSize average char width.
  // Backdrop max-width: min(90vw, 1250px), inner padding: 2 × clamp(1.1rem,3.2vw,3rem)
  const backdropHorizPaddingPx = 2 * Math.min(48, Math.max(17.6, viewport.w * 0.032));
  const backdropMaxWidthPx = Math.min(viewport.w * 0.9, 1250) - backdropHorizPaddingPx;
  const charWidthRatio = dyslexiaMode ? 0.58 : 0.54; // Atkinson Hyperlegible is slightly wider
  const lineHeight = dyslexiaMode ? 1.58 : 1.5;

  // linesAtOnePx = how many lines the text needs if 1px font size (i.e. line-width = backdropMaxWidthPx / charWidthRatio px per char)
  // At fontSize F (rem → px = F×16): charsPerLine = backdropMaxWidthPx / (F * 16 * charWidthRatio)
  // estimatedLines(F) = ceil(length / charsPerLine) = ceil(length * F * 16 * charWidthRatio / backdropMaxWidthPx)
  // Total height needed(F) = estimatedLines(F) × lineHeight × F × 16
  // We want: estimatedLines(F) × lineHeight × F × 16 ≤ textAreaHeightPx
  //
  // Substituting: ceil(length × F × 16 × charWidthRatio / backdropMaxWidthPx) × lineHeight × F × 16 ≤ textAreaHeightPx
  // This is non-trivial to solve analytically because of ceil(), so we binary-search.

  const fontSizeThatFits = (() => {
    let lo = 0.7, hi = maxCap;
    for (let i = 0; i < 28; i++) {
      const mid = (lo + hi) / 2;
      const midPx = mid * 16;
      const charsPerLine = backdropMaxWidthPx / (midPx * charWidthRatio);
      // Add a 1.08 wrap fudge factor: real browsers can wrap slightly earlier than the ideal
      const lines = Math.ceil((length / charsPerLine) * 1.08) + (hasMoreSegments ? 1 : 0);
      const heightNeeded = Math.max(1, lines) * lineHeight * midPx;
      if (heightNeeded <= textAreaHeightPx) lo = mid; else hi = mid;
    }
    return lo;
  })();

  // Apply a safety margin (3%) so the browser never clips due to rounding
  const fittingRem = fontSizeThatFits * 0.97;

  // Aesthetic floor — only applied when the text is short enough that fittingRem
  // already exceeds it, meaning it won't cause clipping. If fittingRem is already
  // below the floor (long text), we trust the fit result instead.
  const aestheticFloor = viewport.w >= 2400 ? 2.2 : viewport.w >= 1920 ? 1.9 : viewport.w >= 901 ? 1.55 : viewport.w >= 641 ? 1.15 : 0.9;
  const computedRem = Math.min(maxCap, Math.max(aestheticFloor, fittingRem));
  const computedFontSize = `${computedRem.toFixed(4)}rem`;

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