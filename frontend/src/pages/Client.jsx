import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket';

// ─── Shared util (Phase 3) ────────────────────────────────────────────────────
// TODO: extract to src/utils/session.js and import from there everywhere.
const normalizeSessionId = (v) =>
  String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

// ─── Font loading sentinel ────────────────────────────────────────────────────
const waitForFonts = () => {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('italic 1em "Cormorant Garamond"'),
    document.fonts.load('1em "Cinzel"'),
  ]).catch(() => {});
};

// ─── QR generation (Phase 2) — uses npm `qrcode`, zero CDN dependency ────────
// Falls back gracefully to a raw-URL display if the package is not installed.
const generateQrDataUrl = async (text) => {
  try {
    const QRCode = await import('qrcode').catch(() => null);
    if (!QRCode) return null;
    return await QRCode.toDataURL(text, {
      width: 280,
      margin: 2,
      color: { dark: '#0a0a0f', light: '#f0ece0' },
      errorCorrectionLevel: 'H',
    });
  } catch {
    return null;
  }
};

// ─── sessionStorage key for TV session persistence (Phase 2) ─────────────────
// Survives a browser crash / power-save disconnect so the QR code stays stable.
const TV_SESSION_KEY = 'siv.tv_session_id';

function Client() {
  // ─── Utilities ──────────────────────────────────────────────────────────────
  const extractImageUrl = (value) => {
    const match = String(value || '').match(/url\((['"]?)(.*?)\1\)/i);
    return match ? match[2] : '';
  };

  const estimateAverageLuminance = (imageUrl) => new Promise((resolve) => {
    if (!imageUrl) { resolve(null); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24; canvas.height = 24;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0, 24, 24);
        const { data } = ctx.getImageData(0, 0, 24, 24);
        let total = 0;
        const pixels = data.length / 4;
        for (let i = 0; i < data.length; i += 4) {
          total += 0.2126 * (data[i] / 255)
                 + 0.7152 * (data[i + 1] / 255)
                 + 0.0722 * (data[i + 2] / 255);
        }
        resolve(total / pixels);
      } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = imageUrl;
  });

  const pushReadabilityMode = (mode, steps = 1) => {
    const order = ['soft', 'balanced', 'strong'];
    const idx = order.indexOf(mode);
    return order[Math.min(order.length - 1, (idx === -1 ? 1 : idx) + steps)];
  };

  // ─── One-time URL param read — useRef not useState (Phase 3 fix) ──────────
  // useRef means reconnection events can never accidentally clobber the value.
  const urlSessionRef = useRef(
    normalizeSessionId(new URLSearchParams(window.location.search).get('session') || '')
  );
  const urlSession = urlSessionRef.current;

  // ─── Core state ───────────────────────────────────────────────────────────
  const [isIdle, setIsIdle] = useState(true);

  const DEFAULT_BG = "url('https://www.churchofjesuschrist.org/imgs/ae2c3112eda211edae1aeeeeac1ef8149c058327/full/%21500%2C/0/default')";

  const [verse, setVerse] = useState({
    scripture_text: '',
    segments: [],
    currentSegment: 0,
    totalSegments: 0,
    theme: {
      background_url: DEFAULT_BG,
      font_family: "'Cormorant Garamond', Georgia, serif",
      font_size: '4.1rem',
      layout: 'centered',
      tone: 'dark',
    },
  });

  const [bgUrl, setBgUrl]         = useState(DEFAULT_BG);
  const [prevBgUrl, setPrevBgUrl] = useState('');
  const [bgFading, setBgFading]   = useState(false);
  const bgFadeTimer               = useRef(null);

  const [animating, setAnimating]         = useState(false);
  const [entering, setEntering]           = useState(false);
  const [highlightedText, setHighlightedText] = useState('');
  const [sessionInput, setSessionInput]   = useState(urlSession);
  const [joinedSession, setJoinedSession] = useState('');
  const [sessionMessage, setSessionMessage] = useState(
    urlSession ? 'Joining session…' : 'Enter session code'
  );
  const [connectionState, setConnectionState] = useState('connecting');
  const [fontsReady, setFontsReady]           = useState(false);
  const [labelKey, setLabelKey]               = useState(0);
  const [readabilityMode, setReadabilityMode] = useState('balanced');
  const [dyslexiaMode, setDyslexiaMode]       = useState(false);

  // ─── TV / QR mode state ───────────────────────────────────────────────────
  const [clientSessionId, setClientSessionId]   = useState('');
  const [showQrMode, setShowQrMode]             = useState(!urlSession);
  const [qrDataUrl, setQrDataUrl]               = useState('');
  const [qrError, setQrError]                   = useState(false);     // npm pkg unavailable
  const [presenterJoining, setPresenterJoining] = useState(false);     // transition overlay
  const [publicOrigin, setPublicOrigin]         = useState('');        // from /config endpoint
  const [sessionExpired, setSessionExpired]     = useState(false);     // auto-regeneration flag

  const joinedSessionRef = useRef('');
  const sessionInputRef  = useRef(urlSession);

  useEffect(() => { joinedSessionRef.current = joinedSession; }, [joinedSession]);
  useEffect(() => { sessionInputRef.current = sessionInput; },  [sessionInput]);

  // ─── sessionStorage helpers ───────────────────────────────────────────────
  const getStoredTvSession = () => {
    try { return sessionStorage.getItem(TV_SESSION_KEY) || ''; } catch { return ''; }
  };
  const storeTvSession = (id) => {
    try { sessionStorage.setItem(TV_SESSION_KEY, id); } catch (_e) { 
      console.warn('Unable to store TV session ID persistently:', _e.message);
    }
  };
  const clearStoredTvSession = () => {
    try { sessionStorage.removeItem(TV_SESSION_KEY); } catch (_e) { 
      console.warn('Unable to clear stored TV session ID:', _e.message);
    }
  };

  // ─── Phase 2: Fetch canonical public origin from /config ─────────────────
  // Resolves correctly even behind a reverse proxy or Cloudflare Tunnel.
  useEffect(() => {
    if (!showQrMode) return;
    fetch('/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.publicOrigin) setPublicOrigin(d.publicOrigin); })
      .catch(() => {}); // non-fatal — falls back to window.location.origin
  }, [showQrMode]);

  // ─── Font loading ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const deadline = setTimeout(() => { if (!cancelled) setFontsReady(true); }, 2500);
    waitForFonts().then(() => {
      if (!cancelled) setFontsReady(true);
      clearTimeout(deadline);
    });
    return () => { cancelled = true; clearTimeout(deadline); };
  }, []);

  // ─── Phase 2: QR code generation — npm qrcode, no CDN ────────────────────
  useEffect(() => {
    if (!clientSessionId) return;
    setQrDataUrl('');
    setQrError(false);
    const origin = publicOrigin || window.location.origin;
    generateQrDataUrl(`${origin}/presenter?session=${clientSessionId}`).then((url) => {
      if (url) setQrDataUrl(url);
      else setQrError(true);
    });
  }, [clientSessionId, publicOrigin]);

  // ─── Issue create-client-session (stable ref — safe to call on reconnect) ─
  const createClientSession = useCallback(() => {
    const preferred = getStoredTvSession();
    socket.emit('create-client-session', { preferredSessionId: preferred }, (res) => {
      if (res?.ok && res.sessionId) {
        setClientSessionId(res.sessionId);
        storeTvSession(res.sessionId);
        setSessionExpired(false);
      }
    });
  }, []);

  // ─── Viewport listeners ───────────────────────────────────────────────────
  const getVp = () => {
    const vv = window.visualViewport;
    return {
      w:   vv ? vv.width  : window.innerWidth,
      h:   vv ? vv.height : window.innerHeight,
      rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
    };
  };
  const [viewport, setViewport] = useState(getVp);

  useEffect(() => {
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

  // ─── Reduced-motion ───────────────────────────────────────────────────────
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [autoReducedMotion, setAutoReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync  = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // ─── Document meta ────────────────────────────────────────────────────────
  useEffect(() => {
    document.title = 'Client Display | Scriptures in View';
    const m = document.querySelector('meta[name="robots"]');
    if (m) m.setAttribute('content', 'noindex,nofollow');
  }, []);

  // ─── Background crossfade ─────────────────────────────────────────────────
  const crossfadeBackground = useCallback((newUrl) => {
    if (!newUrl || newUrl === bgUrl) return;
    clearTimeout(bgFadeTimer.current);
    setPrevBgUrl(bgUrl);
    setBgUrl(newUrl);
    setBgFading(true);
    bgFadeTimer.current = setTimeout(() => {
      setPrevBgUrl('');
      setBgFading(false);
    }, 1400);
  }, [bgUrl]);

  // ─── Session join (manual / URL mode) ────────────────────────────────────
  const attemptJoin = (candidate) => {
    const norm = normalizeSessionId(candidate);
    if (!norm) { setSessionMessage('Enter a valid session code'); return; }
    setSessionMessage('Joining session…');
    socket.emit('join-session', { sessionId: norm, role: 'viewer' }, (res) => {
      if (!res?.ok) setSessionMessage(res?.message || 'Unable to join session');
    });
  };

  // ─── Socket handlers ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleVerse = (data) => {
      setHighlightedText('');
      setAnimating(true);
      setEntering(false);
      const newBg = data.theme?.background_url;
      if (newBg) crossfadeBackground(newBg);
      setTimeout(() => {
        setVerse(data);
        setIsIdle(false);
        setLabelKey((k) => k + 1);
        setAnimating(false);
        const doEnter = () =>
          requestAnimationFrame(() => requestAnimationFrame(() => setEntering(true)));
        if (fontsReady) doEnter();
        else waitForFonts().then(doEnter);
      }, 520);
    };

    const handleTheme = (theme) => {
      setAnimating(true);
      setEntering(false);
      if (theme.background_url) crossfadeBackground(theme.background_url);
      setTimeout(() => {
        setVerse((v) => ({ ...v, theme }));
        setAnimating(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setEntering(true)));
      }, 520);
    };

    const handleHighlight = ({ text }) => setHighlightedText(text || '');

    const handleSessionJoined = ({ sessionId, verse: v, theme: t }) => {
      setJoinedSession(sessionId);
      joinedSessionRef.current = sessionId;
      if (v) {
        setVerse(v);
        setIsIdle(false);
        if (v.theme?.background_url) setBgUrl(v.theme.background_url);
      }
      if (t) {
        setVerse((prev) => ({ ...prev, theme: t }));
        if (t.background_url) setBgUrl(t.background_url);
      }
      // Phase 2: "Presenter connected" graceful transition before QR exits
      if (showQrMode) {
        setPresenterJoining(true);
        setTimeout(() => {
          setPresenterJoining(false);
          setShowQrMode(false);
        }, 1800);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => setEntering(true)));
    };

    // Phase 2: session expired server-side — auto-regenerate QR silently
    const handleSessionError = ({ message }) => {
      if (showQrMode && message && message.toLowerCase().includes('not found')) {
        setSessionExpired(true);
        clearStoredTvSession();
        createClientSession();
      } else {
        setSessionMessage(message || 'Session error');
      }
    };

    // Phase 1: reconnect handler — always re-join the active session
    const handleConnect = () => {
      setConnectionState('connected');
      const current = joinedSessionRef.current;
      if (current) {
        // Already in a live session — silently rejoin so display resumes
        socket.emit('join-session', { sessionId: current, role: 'viewer' }, () => {});
      } else if (urlSession) {
        socket.emit('join-session', { sessionId: urlSession, role: 'viewer' }, (res) => {
          if (!res?.ok) setSessionMessage(res?.message || 'Unable to join session');
        });
      } else if (showQrMode) {
        // TV mode — request preferred session back so QR code doesn't change
        createClientSession();
      }
    };

    const handleDisconnect   = () => setConnectionState('disconnected');
    const handleReconnect    = () => setConnectionState('reconnecting');
    const handleConnectError = () => setConnectionState('error');

    socket.on('update-verse',      handleVerse);
    socket.on('update-theme',      handleTheme);
    socket.on('highlight-text',    handleHighlight);
    socket.on('session-joined',    handleSessionJoined);
    socket.on('session-error',     handleSessionError);
    socket.on('connect',           handleConnect);
    socket.on('disconnect',        handleDisconnect);
    socket.on('reconnect_attempt', handleReconnect);
    socket.on('connect_error',     handleConnectError);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('update-verse',      handleVerse);
      socket.off('update-theme',      handleTheme);
      socket.off('highlight-text',    handleHighlight);
      socket.off('session-joined',    handleSessionJoined);
      socket.off('session-error',     handleSessionError);
      socket.off('connect',           handleConnect);
      socket.off('disconnect',        handleDisconnect);
      socket.off('reconnect_attempt', handleReconnect);
      socket.off('connect_error',     handleConnectError);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, showQrMode, crossfadeBackground, createClientSession]);

  // ─── Auto readability ─────────────────────────────────────────────────────
  const displayText = verse.segments?.length > 0
    ? (verse.segments[verse.currentSegment] || verse.scripture_text)
    : (verse.scripture_text || '');

  useEffect(() => {
    let active = true;
    const tune = async () => {
      const lum = await estimateAverageLuminance(
        extractImageUrl(verse?.theme?.background_url)
      );
      if (!active) return;
      let mode = 'balanced';
      if (typeof lum === 'number') {
        if (lum >= 0.62) mode = 'strong';
        else if (lum <= 0.22) mode = 'soft';
      }
      let pressure = 0;
      if (viewport.w <= 900)        pressure += 1;
      if (displayText.length > 220) pressure += 1;
      if (displayText.length > 420) pressure += 1;
      if (pressure > 0) mode = pushReadabilityMode(mode, pressure >= 2 ? 2 : 1);
      setReadabilityMode(mode);
      const words   = displayText.trim().split(/\s+/).filter(Boolean);
      const avgWord = words.length ? words.join('').length / words.length : 0;
      setDyslexiaMode(viewport.w <= 1024 && (displayText.length > 260 || avgWord >= 5.6));
      setAutoReducedMotion(prefersReducedMotion || viewport.w <= 640 || displayText.length > 320);
    };
    tune();
    return () => { active = false; };
  }, [verse?.theme?.background_url, displayText, viewport.w, prefersReducedMotion]);

  // ─── QR / TV Mode screen ──────────────────────────────────────────────────
  if (!joinedSession && showQrMode) {
    const origin = publicOrigin || window.location.origin;
    const presenterUrl = clientSessionId ? `${origin}/presenter?session=${clientSessionId}` : '';

    return (
      <div className="home-page client-qr-screen">

        {/* Phase 2: "Presenter connected" graceful transition overlay */}
        {presenterJoining && (
          <div className="client-qr-joining-overlay" aria-live="assertive">
            <div className="client-qr-joining-check">✓</div>
            <div className="client-qr-joining-text">Presenter connected</div>
          </div>
        )}

        <div className="client-qr-card">
          <div className="client-qr-header">
            <div className="client-qr-cross" aria-hidden="true">
              <div className="idle-cross-v" />
              <div className="idle-cross-h" />
            </div>
            <h1 className="client-qr-title">Scriptures in View</h1>
            <p className="client-qr-subtitle">
              {sessionExpired ? 'Session refreshed — new code ready' : 'Ready for Presenter'}
            </p>
          </div>

          <div className="client-qr-body">

            {/* QR code — or raw URL fallback if npm package not installed */}
            <div className="client-qr-box">
              {qrDataUrl ? (
                <img
                  src={qrDataUrl}
                  alt={`QR code for session ${clientSessionId}`}
                  className="client-qr-image"
                  draggable={false}
                />
              ) : qrError && presenterUrl ? (
                <div className="client-qr-url-fallback">
                  <span className="client-qr-url-label">Open on Presenter device:</span>
                  <span className="client-qr-url-text" role="textbox" aria-readonly="true">
                    {presenterUrl}
                  </span>
                </div>
              ) : (
                <div className="client-qr-placeholder" aria-label="Generating QR code">
                  <div className="client-qr-spinner" />
                </div>
              )}
            </div>

            {/* Large session code — readable from across a room */}
            {clientSessionId && (
              <div className="client-qr-code-row">
                <span className="client-qr-code-label">Session Code</span>
                <span
                  className="client-qr-code-value"
                  aria-label={`Session code: ${clientSessionId.split('').join(' ')}`}
                >
                  {clientSessionId}
                </span>
              </div>
            )}

            <p className="client-qr-instruction">
              Scan the QR code or enter the code above in the Presenter app to connect.
            </p>

            <div className="client-qr-divider">
              <span>or join a presenter's session manually</span>
            </div>

            {/* Original manual-entry mechanism — fully preserved */}
            <div className="client-qr-manual">
              <input
                type="text"
                className="client-qr-input"
                placeholder="Presenter code…"
                value={sessionInput}
                onChange={(e) => setSessionInput(normalizeSessionId(e.target.value))}
                onKeyDown={(e) => e.key === 'Enter' && attemptJoin(sessionInput)}
              />
              <button className="client-qr-join-btn" onClick={() => attemptJoin(sessionInput)}>
                Join
              </button>
            </div>
            {sessionMessage && sessionMessage !== 'Enter session code' && (
              <div className="client-qr-status">{sessionMessage}</div>
            )}
          </div>

          <div className="client-qr-footer">
            <span className={`client-qr-conn client-qr-conn--${connectionState}`}>
              {connectionState === 'connected'
                ? '● Connected'
                : connectionState === 'connecting'
                  ? '○ Connecting…'
                  : '⚠ Reconnecting…'}
            </span>
          </div>
        </div>
      </div>
    );
  }

  // ─── Classic join screen (URL param provided or user switched manually) ───
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
                  onKeyDown={(e) => e.key === 'Enter' && attemptJoin(sessionInput)}
                />
                <button className="control-button" onClick={() => attemptJoin(sessionInput)}>
                  Join
                </button>
              </div>
            </div>
            <div style={{ color: '#a09880', fontSize: '0.85rem' }}>{sessionMessage}</div>
            <div style={{ color: '#7f745f', fontSize: '0.75rem' }}>Connection: {connectionState}</div>
            <button
              style={{ marginTop: '0.75rem', background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontSize: '0.8rem', textDecoration: 'underline' }}
              onClick={() => setShowQrMode(true)}
            >
              Show QR code instead (TV mode)
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Derived display props ────────────────────────────────────────────────
  const hasMoreSegments = verse.segments && verse.currentSegment < verse.segments.length - 1;
  const layout          = verse.theme?.layout || 'centered';
  const tone            = verse.theme?.tone === 'light' ? 'client-theme-light' : 'client-theme-dark';
  const isDisconnected  = connectionState === 'disconnected' || connectionState === 'error';
  const isReconnecting  = connectionState === 'reconnecting';
  const noMotion        = autoReducedMotion;

  // ─── Highlight render ─────────────────────────────────────────────────────
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

  // ─── Zoom-correct font sizing ─────────────────────────────────────────────
  const { w: vw, h: vh, rem: PX_PER_REM } = viewport;
  const length = displayText.length;

  const maxCap        = vw >= 2400 ? 7.5 : vw >= 1920 ? 6.5 : vw >= 901 ? 5.4 : vw >= 641 ? 4.0 : 2.6;
  const backdropMaxH  = Math.min(vh * 0.82, 960);
  const backdropVPad  = 2 * Math.min(2.2 * PX_PER_REM, Math.max(PX_PER_REM, vh * 0.024));
  const lowerThirdPad = layout === 'lower-third'
    ? Math.min(6 * PX_PER_REM, Math.max(2.4 * PX_PER_REM, vh * 0.07)) : 0;
  const captionH = (verse.book_title && verse.chapter_number && verse.verse_number)
    ? Math.min(1.1 * PX_PER_REM, Math.max(0.55 * PX_PER_REM, vh * 0.014))
    + Math.min(0.52 * PX_PER_REM, Math.max(0.28 * PX_PER_REM, vh * 0.006))
    + PX_PER_REM : 0;
  const contH    = hasMoreSegments ? 1.2 * PX_PER_REM : 0;
  const safetyPx = Math.max(14, PX_PER_REM * 0.9);
  const textAreaH = Math.max(60,
    backdropMaxH - backdropVPad - lowerThirdPad - captionH - contH - safetyPx
  );
  const backdropHPad = 2 * Math.min(3 * PX_PER_REM, Math.max(1.1 * PX_PER_REM, vw * 0.032));
  const backdropW    = (vw >= 901 ? Math.min(vw * 0.88, 1280) : Math.min(vw * 0.9, 1250)) - backdropHPad;
  const textAreaW    = Math.max(80, backdropW);
  const charW        = dyslexiaMode ? 0.61 : 0.57;
  const lh           = dyslexiaMode ? 1.58 : 1.52;
  const WRAP_FUDGE   = 1.13;

  const fontSizeThatFits = (() => {
    let lo = 0.55, hi = maxCap;
    for (let i = 0; i < 36; i++) {
      const mid   = (lo + hi) / 2;
      const midPx = mid * PX_PER_REM;
      const cpl   = textAreaW / (midPx * charW);
      const lines = Math.ceil((length / cpl) * WRAP_FUDGE) + (hasMoreSegments ? 1 : 0);
      if (Math.max(1, lines) * lh * midPx <= textAreaH) lo = mid; else hi = mid;
    }
    return lo;
  })();

  const fittingRem       = fontSizeThatFits * 0.95;
  const rawFloor         = vw >= 2400 ? 2.0 : vw >= 1920 ? 1.75 : vw >= 901 ? 1.45 : vw >= 641 ? 1.05 : 0.82;
  const computedRem      = Math.min(maxCap, Math.max(Math.min(rawFloor, fittingRem), fittingRem));
  const computedFontSize = `${computedRem.toFixed(5)}rem`;

  // ─── CSS class composition ────────────────────────────────────────────────
  const viewClass = [
    'client-view',
    tone,
    `readability-${readabilityMode}`,
    dyslexiaMode   ? 'readability-dyslexia' : '',
    noMotion       ? 'reduce-motion-auto'   : '',
    layout,
    animating && !noMotion ? 'verse-exit'  : '',
    entering  && !noMotion ? 'verse-enter' : '',
    isIdle         ? 'client-idle'          : '',
    isDisconnected ? 'client-disconnected'  : '',
    isReconnecting ? 'client-reconnecting'  : '',
  ].filter(Boolean).join(' ');

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={viewClass} style={{ fontSize: computedFontSize }}>

      <div className="client-bg-current" style={{ backgroundImage: bgUrl }} aria-hidden="true" />
      {bgFading && prevBgUrl && (
        <div className="client-bg-prev" style={{ backgroundImage: prevBgUrl }} aria-hidden="true" />
      )}

      {isIdle && (
        <div className="client-idle-state" aria-live="polite" aria-label="Waiting for scripture">
          <div className="idle-cross" aria-hidden="true">
            <div className="idle-cross-v" />
            <div className="idle-cross-h" />
          </div>
          <div className="idle-line" aria-hidden="true" />
        </div>
      )}

      {!isIdle && (
        <div className="verse-content">
          <div className="verse-backdrop">
            <p>{renderHighlightedText()}</p>
            {verse.book_title && verse.chapter_number && verse.verse_number && (
              <div key={labelKey} className="verse-caption">
                {verse.book_title}&ensp;{verse.chapter_number}:{verse.verse_number}
              </div>
            )}
            {hasMoreSegments && <div className="cont-indicator">›</div>}
          </div>
        </div>
      )}

      {/* Phase 1: Prominent reconnecting banner for the AV operator
          Appears above the content but below the verse — visible from the
          back of the room without alarming the congregation.               */}
      {(isDisconnected || isReconnecting) && joinedSession && (
        <div className="client-reconnect-banner" role="alert" aria-live="assertive">
          <span className="client-reconnect-dot" />
          {isReconnecting ? 'Reconnecting…' : 'Connection lost — retrying'}
        </div>
      )}

      {joinedSession && (
        <span className={[
          'session-watermark',
          isDisconnected ? 'session-watermark--lost' : '',
          isReconnecting ? 'session-watermark--reconnecting' : '',
        ].filter(Boolean).join(' ')}>
          {joinedSession}
          {(isDisconnected || isReconnecting) && (
            <span className="connection-dot" aria-label={connectionState} />
          )}
        </span>
      )}
    </div>
  );
}

export default Client;