import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket';

// ─── Font loading sentinel ────────────────────────────────────────────────────
const waitForFonts = () => {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('italic 1em "Cormorant Garamond"'),
    document.fonts.load('1em "Cinzel"'),
  ]).catch(() => {});
};

// ─── QR generation — uses npm `qrcode`, zero CDN dependency ──────────────────
// Falls back to a raw-URL text display if the package is not installed.
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

// ─── sessionStorage key — keeps QR code stable across browser restarts ───────
const TV_SESSION_KEY = 'siv.tv_session_id';

function Client() {
  // ─── Utilities ───────────────────────────────────────────────────────────────
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

  // textVisible drives the only animation: a gentle opacity crossfade
  // on the text layer. The backdrop box never moves or disappears.
  const [textVisible, setTextVisible]         = useState(false);
  const [displayVerse, setDisplayVerse]       = useState(null);
  const [highlightedText, setHighlightedText] = useState('');
  const [connectionState, setConnectionState] = useState('connecting');
  const [fontsReady, setFontsReady]           = useState(false);
  const [readabilityMode, setReadabilityMode] = useState('balanced');
  const [dyslexiaMode, setDyslexiaMode]       = useState(false);

  // ─── QR / TV session state ────────────────────────────────────────────────
  // The TV always creates its own session and shows QR.
  // presenterJoined flips to true when the server broadcasts presenter-joined.
  const [clientSessionId, setClientSessionId]   = useState('');
  const [presenterJoined, setPresenterJoined]   = useState(false);
  const [qrDataUrl, setQrDataUrl]               = useState('');
  const [qrError, setQrError]                   = useState(false);
  const [presenterJoining, setPresenterJoining] = useState(false); // "✓ connected" overlay
  const [publicOrigin, setPublicOrigin]         = useState('');
  const [sessionExpired, setSessionExpired]     = useState(false);
  const [presenterLeft, setPresenterLeft]       = useState(false); // shows subtle notice on idle screen
  const [votd, setVotd]                         = useState(null);  // verse of the day — shown while presenter is live but idle

  // Refs — keep values accessible inside socket handler closures
  const clientSessionIdRef = useRef('');
  const presenterJoinedRef = useRef(false);
  const joinedSessionRef   = useRef('');

  useEffect(() => { clientSessionIdRef.current = clientSessionId; }, [clientSessionId]);
  useEffect(() => { presenterJoinedRef.current = presenterJoined; }, [presenterJoined]);

  // ─── sessionStorage helpers ───────────────────────────────────────────────
  const getStoredTvSession = () => {
    try { return sessionStorage.getItem(TV_SESSION_KEY) || ''; } catch { return ''; }
  };
  const storeTvSession = (id) => {
    try { sessionStorage.setItem(TV_SESSION_KEY, id); } catch { /* storage unavailable */ }
  };
  const clearStoredTvSession = () => {
    try { sessionStorage.removeItem(TV_SESSION_KEY); } catch { /* storage unavailable */ }
  };

  // ─── Fetch canonical public origin from /config ───────────────────────────
  useEffect(() => {
    fetch('/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.publicOrigin) setPublicOrigin(d.publicOrigin); })
      .catch(() => {});
  }, []);

  // ─── Fetch Verse of the Day — displayed on TV while presenter is connected
  //     but hasn't sent a verse yet (the "connected-idle" state).
  useEffect(() => {
    fetch('/verse/of-the-day')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.verse_id) setVotd(d); })
      .catch(() => {});
  }, []);

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

  // ─── QR code generation ───────────────────────────────────────────────────
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

  // ─── Create / rejoin TV session ───────────────────────────────────────────
  // Called on mount and on every reconnect.
  // Sends the stored session ID so the QR code stays stable across reloads.
  const createClientSession = useCallback(() => {
    const preferred = getStoredTvSession();
    socket.emit('create-client-session', { preferredSessionId: preferred }, (res) => {
      if (res?.ok && res.sessionId) {
        setClientSessionId(res.sessionId);
        clientSessionIdRef.current = res.sessionId;
        storeTvSession(res.sessionId);
        setSessionExpired(false);
      }
    });
  }, []);

  // Eager call on mount so QR appears immediately
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');
    if (sessionParam) {
      // F13 — Secondary screen: join an existing session directly
      const sid = sessionParam.toUpperCase();
      setClientSessionId(sid);
      clientSessionIdRef.current = sid;
      joinedSessionRef.current = sid;
      setPresenterJoined(true);
      presenterJoinedRef.current = true;
      setIsSecondaryScreen(true);
      socket.emit('join-session', { sessionId: sid, role: 'viewer' }, () => {});
    } else {
      createClientSession();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // ─── PWA service worker registration ─────────────────────────────────────
  // Caches the Client shell + static assets for offline display continuity.
  // The last received verse stays on screen via React state — no SW work needed.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* SW is optional */ });
    }
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

  // F14 — Reset (or start) the screensaver countdown
  const resetScreensaver = useCallback(() => {
    setIsScreensaver(false);
    if (screensaverTimerRef.current) clearTimeout(screensaverTimerRef.current);
    screensaverTimerRef.current = setTimeout(() => setIsScreensaver(true), SCREENSAVER_DELAY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Show VOTD on the TV display while presenter is connected but idle ──────
  // This is called the moment the presenter joins, so the TV never shows a blank
  // background. The verse fades in with the same animation as a real live verse.
  // It will be overwritten seamlessly the moment the presenter hits Go Live.
  const setVotdAsDisplay = useCallback(() => {
    // votd is captured via closure — may be null if fetch hasn't resolved yet.
    // In that case we set up a one-shot effect to retry when votd arrives.
    setVotdPending(true);
  }, []);

  // ─── When votd arrives (or when pending flag is set), push it to the display ─
  const [votdPending, setVotdPending] = useState(false);

  // F2 — Custom text / announcement mode
  const [customData, setCustomData] = useState(null);

  // F13 — Secondary screen (URL ?session= param)
  const [isSecondaryScreen, setIsSecondaryScreen] = useState(false);

  // F14 — Idle screensaver
  const screensaverTimerRef = useRef(null);
  const [isScreensaver, setIsScreensaver] = useState(false);
  const SCREENSAVER_DELAY = 10 * 60 * 1000; // 10 min

  useEffect(() => {
    if (!votdPending || !votd || !presenterJoinedRef.current) return;
    if (displayVerse) return; // a real verse is already showing — don't overwrite
    setVotdPending(false);
    const DEFAULT_THEME = {
      background_url: DEFAULT_BG,
      font_family: "'Cormorant Garamond', Georgia, serif",
      font_size: '4.1rem',
      layout: 'centered',
      tone: 'dark',
    };
    const votdData = {
      ...votd,
      segments: [votd.scripture_text],
      currentSegment: 0,
      totalSegments: 1,
      theme: DEFAULT_THEME,
    };
    setTextVisible(false);
    setTimeout(() => {
      setVerse(votdData);
      setDisplayVerse(votdData);
      setIsIdle(false);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setTextVisible(true))
      );
    }, 400);
  }, [votd, votdPending, displayVerse]);

  // ─── Socket handlers ──────────────────────────────────────────────────────
  useEffect(() => {
    // TRANSITION STRATEGY:
    // The backdrop box never disappears. Only the text layer inside it
    // crossfades. On verse change:
    //   1. Fade text out over TEXT_FADE_MS
    //   2. Swap the verse data (instant, invisible — text is opacity:0)
    //   3. Fade text back in
    // This is imperceptible to readers as movement — they just see the
    // words gently dissolve from one verse to the next.
    const TEXT_FADE_MS = 400;

    const handleVerse = (data) => {
      setHighlightedText('');
      setCustomData(null);
      resetScreensaver();
      const newBg = data.theme?.background_url;
      if (newBg) crossfadeBackground(newBg);
      // Step 1 — fade text out
      setTextVisible(false);
      setTimeout(() => {
        // Step 2 — swap content while invisible
        setVerse(data);
        setDisplayVerse(data);
        setIsIdle(false);
        // Step 3 — fade text back in after DOM commit
        requestAnimationFrame(() =>
          requestAnimationFrame(() => setTextVisible(true))
        );
      }, TEXT_FADE_MS);
    };

    const handleTheme = (theme) => {
      resetScreensaver();
      if (theme.background_url) crossfadeBackground(theme.background_url);
      // Theme change: just crossfade the background, keep text visible
      setVerse((v) => ({ ...v, theme }));
    };

    const handleHighlight = ({ text }) => setHighlightedText(text || '');

    // Fires when we join our own session room — just record the ID.
    const handleSessionJoined = ({ sessionId, verse: v, theme: t }) => {
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
      if (v) setDisplayVerse(v);
      requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
    };

    // Server broadcasts this ONLY when a Presenter joins the room.
    // This is the definitive signal: close QR, enter display mode.
    const handleClearScreen = () => {
      // Presenter ended live — return to connected-idle and show VOTD again.
      // Do NOT go back to the QR screen — presenter is still connected.
      setCustomData(null);
      resetScreensaver();
      setTextVisible(false);
      setTimeout(() => {
        setDisplayVerse(null);
        setHighlightedText('');
        // Re-show VOTD so the TV is never blank between verses
        setVotdPending(true);
      }, 400);
    };

    const handlePresenterLeft = () => {
      setPresenterLeft(true);
      // After 8 s, fade the notice — it already told the operator what happened
      setTimeout(() => setPresenterLeft(false), 8000);
    };

    const handlePresenterJoined = () => {
      if (presenterJoinedRef.current) return; // already handled
      setPresenterJoined(true);
      presenterJoinedRef.current = true;
      setPresenterJoining(true);
      setTimeout(() => setPresenterJoining(false), 1800);
      // Show VOTD immediately so TV is never blank while presenter finds first verse.
      // If server sends a real verse shortly after, handleVerse overwrites this gracefully.
      setVotdAsDisplay();
    };

    const handleSessionError = ({ message }) => {
      // Session expired on server — regenerate silently
      if (message && message.toLowerCase().includes('not found')) {
        setSessionExpired(true);
        clearStoredTvSession();
        createClientSession();
      }
    };

    const handleConnect = () => {
      setConnectionState('connected');
      const current = joinedSessionRef.current;
      if (current) {
        // Reconnect — rejoin existing session silently
        socket.emit('join-session', { sessionId: current, role: 'viewer' }, () => {});
      } else {
        // Fresh connect — create/resume TV session
        // Guard: only call if socket is actually ready (avoid double-fire with mount effect)
        if (clientSessionIdRef.current) {
          socket.emit('create-client-session', { preferredSessionId: clientSessionIdRef.current }, () => {});
        } else {
          createClientSession();
        }
      }
    };

    const handleDisconnect   = () => setConnectionState('disconnected');
    const handleReconnect    = () => setConnectionState('reconnecting');
    const handleConnectError = () => setConnectionState('error');

    // F2 — custom-text: announcement / free-text mode
    const handleCustomText = (data) => {
      if (data.theme) crossfadeBackground(data.theme.background_url || bgUrl);
      resetScreensaver();
      setTextVisible(false);
      setTimeout(() => {
        setCustomData(data);
        setDisplayVerse(null);
        setIsIdle(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
      }, TEXT_FADE_MS);
    };

    // F11 — preload-background: warm up the image cache before go-live
    const handlePreloadBackground = ({ background_url }) => {
      if (!background_url) return;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = background_url;
    };

    socket.on('update-verse',         handleVerse);
    socket.on('update-theme',         handleTheme);
    socket.on('highlight-text',       handleHighlight);
    socket.on('session-joined',       handleSessionJoined);
    socket.on('clear-screen',         handleClearScreen);
    socket.on('presenter-left',       handlePresenterLeft);
    socket.on('presenter-joined',     handlePresenterJoined);
    socket.on('session-error',        handleSessionError);
    socket.on('connect',              handleConnect);
    socket.on('disconnect',           handleDisconnect);
    socket.on('reconnect_attempt',    handleReconnect);
    socket.on('connect_error',        handleConnectError);
    socket.on('custom-text',          handleCustomText);
    socket.on('preload-background',   handlePreloadBackground);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('update-verse',         handleVerse);
      socket.off('update-theme',         handleTheme);
      socket.off('highlight-text',       handleHighlight);
      socket.off('session-joined',       handleSessionJoined);
      socket.off('clear-screen',         handleClearScreen);
      socket.off('presenter-left',       handlePresenterLeft);
      socket.off('presenter-joined',     handlePresenterJoined);
      socket.off('session-error',        handleSessionError);
      socket.off('connect',              handleConnect);
      socket.off('disconnect',           handleDisconnect);
      socket.off('reconnect_attempt',    handleReconnect);
      socket.off('connect_error',        handleConnectError);
      socket.off('custom-text',          handleCustomText);
      socket.off('preload-background',   handlePreloadBackground);
      if (screensaverTimerRef.current) clearTimeout(screensaverTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, crossfadeBackground, createClientSession, resetScreensaver]);

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

  // ─── QR waiting screen ────────────────────────────────────────────────────
  // Shown until the Presenter joins. No interaction needed from the TV side.
  if (!presenterJoined) {
    const origin = publicOrigin || window.location.origin;
    const presenterUrl = clientSessionId ? `${origin}/presenter?session=${clientSessionId}` : '';

    return (
      <div className="home-page client-qr-screen">

        {/* "Presenter connected" transition overlay */}
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
              {sessionExpired
                ? 'Session refreshed — new code ready'
                : connectionState === 'connecting' || connectionState === 'reconnecting'
                  ? 'Connecting…'
                  : 'Waiting for Presenter'}
            </p>
          </div>

          <div className="client-qr-body">

            {/* QR code — or raw-URL fallback */}
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

            {/* Large session code — readable from across the room */}
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
              Scan the QR code or enter the session code in the Presenter app to connect.
            </p>

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

  // ─── Derived display props ────────────────────────────────────────────────
  // True when currently displaying the VOTD (no real verse has been sent yet)
  const isShowingVotd   = votd && displayVerse && displayVerse.verse_id === votd.verse_id && !votdPending;
  const hasMoreSegments = verse.segments && verse.currentSegment < verse.segments.length - 1;
  const layout          = verse.theme?.layout || 'centered';
  const tone            = verse.theme?.tone === 'light' ? 'client-theme-light' : 'client-theme-dark';
  const isDisconnected  = connectionState === 'disconnected' || connectionState === 'error';
  const isReconnecting  = connectionState === 'reconnecting';
  const noMotion        = autoReducedMotion;
  const joinedSession   = joinedSessionRef.current;

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

  // F9 — Canon volume accent classes
  const VOLUME_CLASS_MAP = {
    'Old Testament':          'volume-ot',
    'New Testament':          'volume-nt',
    'Book of Mormon':         'volume-bom',
    'Doctrine and Covenants': 'volume-dc',
    'Pearl of Great Price':   'volume-pgp',
  };
  const volumeClass = VOLUME_CLASS_MAP[verse?.volume_title] || '';

  // ─── CSS class composition ────────────────────────────────────────────────
  const viewClass = [
    'client-view',
    tone,
    `readability-${readabilityMode}`,
    dyslexiaMode   ? 'readability-dyslexia' : '',
    noMotion       ? 'reduce-motion-auto'   : '',
    layout,
    volumeClass,

    isIdle         ? 'client-idle'          : '',
    isDisconnected ? 'client-disconnected'  : '',
    isReconnecting ? 'client-reconnecting'  : '',
    isScreensaver  ? 'client-screensaver'   : '',
  ].filter(Boolean).join(' ');

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={viewClass} style={{ fontSize: computedFontSize }}
      onClick={isScreensaver ? resetScreensaver : undefined}
      onKeyDown={isScreensaver ? resetScreensaver : undefined}
      tabIndex={isScreensaver ? 0 : undefined}
    >

      <div className="client-bg-current" style={{ backgroundImage: bgUrl }} aria-hidden="true" />
      {bgFading && prevBgUrl && (
        <div className="client-bg-prev" style={{ backgroundImage: prevBgUrl }} aria-hidden="true" />
      )}

      {isIdle && (
        <div className="client-idle-state" aria-live="polite" aria-label="Waiting for scripture">
          {presenterLeft && (
            <div className="client-presenter-left-notice" role="status">
              Presenter disconnected — waiting for reconnection
            </div>
          )}
          <div className="idle-cross" aria-hidden="true">
            <div className="idle-cross-v" />
            <div className="idle-cross-h" />
          </div>
          <div className="idle-line" aria-hidden="true" />
        </div>
      )}

      {/* F2 — custom text / announcement mode */}
      {!isIdle && customData && (
        <div className="verse-content">
          <div className="verse-backdrop custom-text-backdrop">
            <div className={`verse-text-body${textVisible ? ' verse-text-visible' : ''}`}>
              <p className="custom-text-main">{customData.text}</p>
              {customData.subtext && <p className="custom-text-sub">{customData.subtext}</p>}
            </div>
          </div>
        </div>
      )}

      {!isIdle && !customData && (
        <div className="verse-content">
          <div className="verse-backdrop">
            {/* verse-text-body is the ONLY thing that fades.
                The backdrop box itself never animates. */}
            <div className={`verse-text-body${textVisible ? ' verse-text-visible' : ''}`}>
              <p>{renderHighlightedText()}</p>
              {/* F8 — secondary language text */}
              {verse.secondary_text && (
                <p className="verse-secondary-text">{verse.secondary_text}</p>
              )}
              {verse.book_title && verse.chapter_number && verse.verse_number && (
                <div className="verse-caption">
                  {verse.book_title}&ensp;{verse.chapter_number}:{verse.verse_number}
                  {/* F10 — full volume name as subtitle line, replaces short abbrev */}
                  {verse.volume_title && (
                    <span className="verse-caption-volume">{verse.volume_title}</span>
                  )}
                  {isShowingVotd && (
                    <span className="client-votd-label">✦ Verse of the Day</span>
                  )}
                </div>
              )}
              {/* F7 — segment dots replacing single › indicator */}
              {verse.segments?.length > 1 && (
                <div className="segment-dots-client" aria-hidden="true">
                  {verse.segments.map((_, i) => (
                    <span key={i} className={`seg-dot-tv${i === verse.currentSegment ? ' seg-dot-tv--active' : ''}`} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Reconnecting banner — visible to AV operator, unobtrusive to congregation */}
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
      {/* F13 — secondary screen badge */}
      {isSecondaryScreen && clientSessionId && (
        <span className="secondary-screen-badge">Mirroring {clientSessionId}</span>
      )}
      {/* QR overlay — shown over the VOTD so the next presenter can scan to join */}
      {isShowingVotd && clientSessionId && !isSecondaryScreen && (
        <div className="client-votd-qr-overlay" aria-label={`Scan to present · session ${clientSessionId}`}>
          {qrDataUrl && (
            <img src={qrDataUrl} alt="Scan to join as presenter" className="client-votd-qr-img" />
          )}
          <span className="client-votd-qr-label">Scan to present · {clientSessionId}</span>
        </div>
      )}
    </div>
  );
}

export default Client;