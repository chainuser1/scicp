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
  // Use visualViewport when available — it tracks the *actual* visible area
  // after browser chrome (address bar, keyboard, system UI) is accounted for.
  // Falls back to window.inner* on browsers that don't support it.
  const getVp = () => {
    const vv = window.visualViewport;
    return {
      w: vv ? vv.width  : window.innerWidth,
      h: vv ? vv.height : window.innerHeight,
    };
  };
  const [viewport, setViewport] = useState(getVp);
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
    // Listen on both window resize AND visualViewport resize/scroll.
    // visualViewport fires when: browser address bar shows/hides, soft keyboard
    // appears/disappears, browser zoom changes, or the window is resized.
    // All of these change the actual available rendering area.
    const update = () => setViewport(getVp());
    window.addEventListener('resize', update, { passive: true });
    window.addEventListener('orientationchange', update, { passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', update);
      window.visualViewport.addEventListener('scroll', update);
    }
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      if (window.visualViewport) {
        window.visualViewport.removeEventListener('resize', update);
        window.visualViewport.removeEventListener('scroll', update);
      }
    };
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

  // ─── Responsive font sizing — "never clip" approach v2 ──────────────────────
  //
  // Design contract:
  //   • ALL text is always fully visible — no overflow, no clipping, ever.
  //   • Recalibrates on every viewport change including browser chrome
  //     appearing/disappearing (handled by visualViewport listener above).
  //   • Font changes are subtle and continuous — no jarring jumps.
  //   • The aesthetic floor is strictly bounded: it can NEVER produce a size
  //     larger than fittingRem. If the text is long, the fit wins.
  //
  // Geometry we must respect (all values must match App.css exactly):
  //   verse-backdrop max-height : min(82dvh, 960px)   ← CSS value
  //   verse-backdrop padding    : clamp(1rem, 2.4vh, 2.2rem) top + bottom
  //   verse-backdrop max-width  : min(90vw, 1250px)
  //   verse-backdrop horiz pad  : clamp(1.1rem, 3.2vw, 3rem) left + right
  //   lower-third bottom offset : clamp(2.4rem, 7vh, 6rem)
  //   cont-indicator height     : ~28px when visible
  // ────────────────────────────────────────────────────────────────────────────

  const length = displayText.length;
  const vw = viewport.w;
  const vh = viewport.h;

  // Hard upper cap — prevents absurdly large text on a single short word
  const maxCap = vw >= 2400 ? 7.5 : vw >= 1920 ? 6.5 : vw >= 901 ? 5.4 : vw >= 641 ? 4.0 : 2.6;

  // ── Step 1: Compute available TEXT area height in px ──────────────────────
  // Start from the backdrop's CSS max-height constraint
  const backdropMaxH = Math.min(vh * 0.82, 960);

  // Subtract backdrop vertical padding: 2 × clamp(1rem, 2.4vh, 2.2rem)
  const backdropVPad = 2 * Math.min(35.2, Math.max(16, vh * 0.024));

  // lower-third layout reserves extra space at the bottom
  const lowerThirdPad = verse.theme?.layout === 'lower-third'
    ? Math.min(96, Math.max(38.4, vh * 0.07))
    : 0;

  // cont-indicator row height when visible
  const contH = hasMoreSegments ? 30 : 0;

  // Extra safety buffer — absorbs rounding errors, sub-pixel borders, and the
  // gold accent line (1px). We use 18px instead of 12px for a more resilient margin.
  const safetyBuffer = 18;

  const textAreaH = Math.max(60, backdropMaxH - backdropVPad - lowerThirdPad - contH - safetyBuffer);

  // ── Step 2: Compute available TEXT area width in px ───────────────────────
  const backdropW = Math.min(vw * 0.9, vw >= 901 ? 1280 : 1250);
  const backdropHPad = 2 * Math.min(48, Math.max(17.6, vw * 0.032));
  const textAreaW = Math.max(120, backdropW - backdropHPad);

  // ── Step 3: Binary-search for the largest font size that fits ─────────────
  // Character width ratio for Cormorant Garamond (proportional serif).
  // We use 0.56 (slightly more conservative than the 0.54 used previously)
  // to account for wider characters like W, M, and punctuation clusters.
  const charW = dyslexiaMode ? 0.60 : 0.56;
  const lh    = dyslexiaMode ? 1.58 : 1.5;

  // Wrap fudge: real browsers wrap ~12% earlier than ideal due to word boundaries,
  // kerning, and sub-pixel rounding. 1.12 is more conservative than the old 1.08.
  const WRAP_FUDGE = 1.12;

  const fontSizeThatFits = (() => {
    let lo = 0.6, hi = maxCap;
    for (let i = 0; i < 32; i++) {        // 32 iterations → precision < 0.0001rem
      const mid   = (lo + hi) / 2;
      const midPx = mid * 16;
      const charsPerLine = textAreaW / (midPx * charW);
      const lines = Math.ceil((length / charsPerLine) * WRAP_FUDGE) + (hasMoreSegments ? 1 : 0);
      const heightNeeded = Math.max(1, lines) * lh * midPx;
      if (heightNeeded <= textAreaH) lo = mid; else hi = mid;
    }
    return lo;
  })();

  // ── Step 4: Apply safety margin then bounded aesthetic floor ──────────────
  // 4% safety margin (up from 3%) — extra protection at boundary conditions
  // like orientation change mid-render or browser chrome animating in.
  const fittingRem = fontSizeThatFits * 0.96;

  // The floor is capped at fittingRem so long text can NEVER be pushed up.
  // Short text gets a gentle boost toward comfortable reading sizes.
  const rawFloor = vw >= 2400 ? 2.0 : vw >= 1920 ? 1.75 : vw >= 901 ? 1.45 : vw >= 641 ? 1.05 : 0.85;
  const aestheticFloor = Math.min(rawFloor, fittingRem);

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