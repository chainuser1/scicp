import { useState, useEffect, useRef, useCallback } from 'react';
import { socket } from '../socket';

const POV_TINT = {
  'prayer or praise':      'rgba(120, 80, 200, 0.12)',
  'spoken by God':         'rgba(200, 140, 40, 0.10)',
  'spoken by a prophet':   'rgba(60, 100, 200, 0.10)',
  'poetic/wisdom':         'rgba(100, 160, 80, 0.10)',
  'epistle':               'rgba(80, 130, 180, 0.10)',
};

const waitForFonts = () => {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('italic 1em "Cormorant Garamond"'),
    document.fonts.load('1em "Cinzel"'),
  ]).catch(() => {});
};

// Falls back to a raw-URL text display if the package is not installed.
const generateQrDataUrl = async (text) => {
  try {
    const QRCode = await import('qrcode').catch(() => null);
    if (!QRCode) return null;
    return await QRCode.toDataURL(text, {
      width: 512,          // generous bitmap so clamp()-sized display stays sharp on 4K TVs
      margin: 2,
      color: { dark: '#0a0a0f', light: '#f0ece0' },
      errorCorrectionLevel: 'H',
    });
  } catch {
    return null;
  }
};

const TV_SESSION_KEY = 'siv.tv_session_id';

const DEFAULT_BG =
  "url('https://www.churchofjesuschrist.org/imgs/ae2c3112eda211edae1aeeeeac1ef8149c058327/full/%21500%2C/0/default')";

const DEFAULT_THEME = {
  background_url: DEFAULT_BG,
  font_family: "'Cormorant Garamond', Georgia, serif",
  font_size: '4.1rem',
  layout: 'centered',
  tone: 'dark',
};
const CJK_REGEX = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
const containsCjk = (text) => CJK_REGEX.test(String(text || ''));
const weightedLength = (text) => {
  const value = String(text || '');
  let total = 0;
  for (const ch of value) total += CJK_REGEX.test(ch) ? 1.8 : 1;
  return total;
};

// Reading pace: 160 wpm — floor 5 s, ceiling 15 s.
// VOTD gets 2× so it lingers as the featured verse before kiosk cycling begins.
const kioskDisplayMs = (text, multiplier = 1) => {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.min(15000, Math.max(5000, (words / 160) * 60 * 1000)) * multiplier;
};

function Client() {
  const isElectronApp = !!window.electronAPI?.isElectron;

  const extractImageUrl = (value) => {
    const match = String(value || '').match(/url\((['"]?)(.*?)\1\)/i);
    return match ? match[2] : '';
  };

  const estimateAverageLuminance = (imageUrl) => new Promise((resolve) => {
    if (!imageUrl) { resolve(null); return; }
    const img = new Image();
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
  const [isIdle, setIsIdle] = useState(true);
  const [versePov, setVersePov] = useState(null);
  const [nowReadingOn, setNowReadingOn] = useState(false); // presenter-controlled "Now Reading" label

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
  const bgUrlRef                  = useRef(DEFAULT_BG);

  // textVisible drives the only animation: a gentle opacity crossfade
  // on the text layer. The backdrop box never moves or disappears.
  const [textVisible, setTextVisible]         = useState(false);
  const [overlayActive, setOverlayActive]     = useState(false);
  const [displayVerse, setDisplayVerse]       = useState(null);
  const [highlightedText, setHighlightedText] = useState('');
  const [connectionState, setConnectionState] = useState('connecting');
  const [fontsReady, setFontsReady]           = useState(false);
  const [readabilityMode, setReadabilityMode] = useState('balanced');
  const [autoHighlight, setAutoHighlight] = useState(null);
  const [dyslexiaMode, setDyslexiaMode]       = useState(false);

  // The TV always creates its own session and shows QR.
  // presenterJoined flips to true when the server broadcasts presenter-joined.
  const [clientSessionId, setClientSessionId]   = useState('');
  const [presenterJoined, setPresenterJoined]         = useState(false);
  const [presenterSessionLocked, setPresenterSessionLocked] = useState(false); // presenter disconnected but slot still held
  const [qrDataUrl, setQrDataUrl]               = useState('');       // /presenter?session= — for operator
  const [clientQrDataUrl, setClientQrDataUrl]   = useState('');       // /client?session=    — for audience
  const [qrError, setQrError]                    = useState(false);
  const [presenterJoining, setPresenterJoining] = useState(false); // "✓ connected" overlay
  const [publicOrigin, setPublicOrigin]         = useState('');
  const [_sessionExpired, setSessionExpired]    = useState(false);
  const [presenterLeft, setPresenterLeft]       = useState(false); // shows subtle notice on idle screen
  const [votd, setVotd]                         = useState(null);  // verse of the day — shown while presenter is live but idle

  const [isKioskMode, setIsKioskMode] = useState(true); // true until first presenter join
  const [kioskRestart, setKioskRestart] = useState(0);  // incremented to retrigger kiosk after presenter leaves
  const [fontScale, setFontScale] = useState(() => parseFloat(localStorage.getItem('scicp.client_font_scale') || '1'));
  const kioskTimerRef       = useRef(null);
  const kioskCurVerseRef    = useRef(null); // verse_id of the verse currently on-screen in kiosk
  const nowReadingOnRef     = useRef(false); // mirrors nowReadingOn state — readable in callbacks
  const presenterLeftTimer  = useRef(null); // "Presenter left" notice auto-hide (8 s)
  const joiningOverlayTimer = useRef(null); // "✓ connected" flash auto-hide (1.8 s)
  const presenterGraceTimerRef = useRef(null); // grace period before kiosk starts (15 min)

  const clientSessionIdRef = useRef('');
  const presenterJoinedRef = useRef(false);
  const joinedSessionRef   = useRef('');

  useEffect(() => { clientSessionIdRef.current = clientSessionId; }, [clientSessionId]);
  useEffect(() => { presenterJoinedRef.current = presenterJoined; }, [presenterJoined]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [toggleFullscreen]);

  const getStoredTvSession = () => {
    try { return sessionStorage.getItem(TV_SESSION_KEY) || ''; } catch { return ''; }
  };
  const storeTvSession = (id) => {
    try { sessionStorage.setItem(TV_SESSION_KEY, id); } catch { /* storage unavailable */ }
  };
  const clearStoredTvSession = () => {
    try { sessionStorage.removeItem(TV_SESSION_KEY); } catch { /* storage unavailable */ }
  };

  useEffect(() => {
    fetch('/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.publicOrigin) setPublicOrigin(d.publicOrigin); })
      .catch(() => {});
  }, []);

  // Fetch Verse of the Day — displayed on TV while presenter is connected
  //     but hasn't sent a verse yet (the "connected-idle" state).
  useEffect(() => {
    fetch('/verse/of-the-day')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.verse_id) setVotd(d); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    const deadline = setTimeout(() => { if (!cancelled) setFontsReady(true); }, 2500);
    waitForFonts().then(() => {
      if (!cancelled) setFontsReady(true);
      clearTimeout(deadline);
    });
    return () => { cancelled = true; clearTimeout(deadline); };
  }, []);

  // Two codes share the same session ID but serve different audiences:
  //   presenterQR → /presenter?session= — shown while waiting, for the operator
  //   clientQR    → /client?session=    — shown while live, for audience devices
  useEffect(() => {
    if (!clientSessionId) return;
    let cancelled = false;
    setQrDataUrl('');
    setClientQrDataUrl('');
    setQrError(false);
    const origin = publicOrigin || window.location.origin;
    generateQrDataUrl(`${origin}/presenter?session=${clientSessionId}`).then((url) => {
      if (cancelled) return;
      if (url) setQrDataUrl(url);
      else setQrError(true);
    });
    generateQrDataUrl(`${origin}/client?session=${clientSessionId}`).then((url) => {
      if (cancelled) return;
      if (url) setClientQrDataUrl(url);
    });
    return () => { cancelled = true; };
  }, [clientSessionId, publicOrigin]);

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

  useEffect(() => {
    // Electron desktop mode: primary display — claim the fixed LOCAL session.
    // Set refs SYNCHRONOUSLY before the emit so that Effect B's handleConnect
    // (which runs in the same render cycle) won't fire a second
    // create-client-session with an empty preferredSessionId.
    if (window.electronAPI?.isElectron) {
      setClientSessionId('LOCAL');
      clientSessionIdRef.current = 'LOCAL';
      joinedSessionRef.current = 'LOCAL';
      storeTvSession('LOCAL');
      setSessionExpired(false);
      socket.emit('create-client-session', { preferredSessionId: 'LOCAL' }, (res) => {
        if (res?.ok && res.sessionId) {
          setClientSessionId(res.sessionId);
          clientSessionIdRef.current = res.sessionId;
          storeTvSession(res.sessionId);
        }
      });
      return;
    }

    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get('session');
    if (sessionParam) {
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

  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
  const [autoReducedMotion, setAutoReducedMotion] = useState(false);
  useEffect(() => { bgUrlRef.current = bgUrl; }, [bgUrl]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync  = () => setPrefersReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    document.title = 'Client Display | Scriptures in View';
    const m = document.querySelector('meta[name="robots"]');
    if (m) m.setAttribute('content', 'noindex,nofollow');
    // Remove any canonical — this is an app screen, not a crawlable content page.
    document.querySelector('link[rel="canonical"]')?.remove();
  }, []);

  // Caches the Client shell + static assets for offline display continuity.
  // The last received verse stays on screen via React state — no SW work needed.
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => { /* SW is optional */ });
    }
  }, []);

  const crossfadeBackground = useCallback((newUrl) => {
    const currentBg = bgUrlRef.current;
    if (!newUrl || newUrl === currentBg) return;
    clearTimeout(bgFadeTimer.current);
    setPrevBgUrl(currentBg);
    bgUrlRef.current = newUrl;
    setBgUrl(newUrl);
    setBgFading(true);
    bgFadeTimer.current = setTimeout(() => {
      setPrevBgUrl('');
      setBgFading(false);
    }, 1400);
  }, []);

  // F14 — Reset (or start) the screensaver countdown
  const resetScreensaver = useCallback(() => {
    setIsScreensaver(false);
    if (screensaverTimerRef.current) clearTimeout(screensaverTimerRef.current);
    screensaverTimerRef.current = setTimeout(() => setIsScreensaver(true), SCREENSAVER_DELAY);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show VOTD on the TV display while presenter is connected but idle —
  // This is called the moment the presenter joins, so the TV never shows a blank
  // background. The verse fades in with the same animation as a real live verse.
  // It will be overwritten seamlessly the moment the presenter hits Go Live.
  const setVotdAsDisplay = useCallback(() => {
    // votd is captured via closure — may be null if fetch hasn't resolved yet.
    // In that case we set up a one-shot effect to retry when votd arrives.
    setVotdPending(true);
  }, []);

  // When votd arrives (or when pending flag is set), push it to the display
  const [votdPending, setVotdPending] = useState(false);

  const [customData, setCustomData] = useState(null);

  const [isSecondaryScreen, setIsSecondaryScreen] = useState(false);

  // QR overlay — shown when the room is vacant so the next presenter can scan
  const [showQrOverlay, setShowQrOverlay] = useState(false);

  const screensaverTimerRef = useRef(null);
  const [isScreensaver, setIsScreensaver] = useState(false);
  const SCREENSAVER_DELAY = 10 * 60 * 1000; // 10 min

  useEffect(() => {
    if (!votdPending || !votd || !presenterJoinedRef.current) return;
    if (displayVerse) return; // a real verse is already showing — don't overwrite
    setVotdPending(false);
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

  // Reads from /verse/adjacent so the progression follows canonical book order.
  // Stable identity (empty deps) — all mutable values accessed via refs.
  const advanceKiosk = useCallback((fromVerseId) => {
    // Block cycling only when presenter is connected AND "Now Reading" is not active
    if (presenterJoinedRef.current && !nowReadingOnRef.current) return;
    fetch(`/verse/adjacent?verse_id=${encodeURIComponent(fromVerseId)}&direction=next`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.verse_id || (presenterJoinedRef.current && !nowReadingOnRef.current)) return;
        const nextVerse = {
          ...data,
          segments: [data.scripture_text],
          currentSegment: 0,
          totalSegments: 1,
          theme: DEFAULT_THEME,
        };
        kioskCurVerseRef.current = data.verse_id;
        setTextVisible(false);
        setTimeout(() => {
          if (presenterJoinedRef.current && !nowReadingOnRef.current) return;
          setVerse(nextVerse);
          setDisplayVerse(nextVerse);
          setIsIdle(false);
          requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
          kioskTimerRef.current = setTimeout(
            () => advanceKiosk(data.verse_id),
            kioskDisplayMs(data.scripture_text),
          );
        }, 400);
      })
      .catch(() => {
        // Network hiccup — retry the same verse after 8 s
        if (!presenterJoinedRef.current || nowReadingOnRef.current) {
          kioskTimerRef.current = setTimeout(() => advanceKiosk(fromVerseId), 8000);
        }
      });
  }, []);

  // Prefers the last verse shown on screen (kioskCurVerseRef) over VOTD.
  // Falls back to VOTD only if no verse has ever been shown.
  useEffect(() => {
    if (presenterJoinedRef.current) return;
    if (kioskTimerRef.current) clearTimeout(kioskTimerRef.current);

    const resumeId = kioskCurVerseRef.current;
    if (resumeId) {
      // A verse is already on screen — just schedule the next advance from it.
      kioskTimerRef.current = setTimeout(() => advanceKiosk(resumeId), 5000);
      return;
    }

    if (!votd) return;
    // Very first run — no verse shown yet, start from VOTD
    const votdVerse = {
      ...votd,
      segments: [votd.scripture_text],
      currentSegment: 0,
      totalSegments: 1,
      theme: DEFAULT_THEME,
    };
    kioskCurVerseRef.current = votd.verse_id;
    setTextVisible(false);
    const initTimer = setTimeout(() => {
      if (presenterJoinedRef.current) return;
      setVerse(votdVerse);
      setDisplayVerse(votdVerse);
      setIsIdle(false);
      requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
      // VOTD lingers at 2× reading time — it's the featured verse
      kioskTimerRef.current = setTimeout(
        () => advanceKiosk(votd.verse_id),
        kioskDisplayMs(votd.scripture_text, 2),
      );
    }, 400);
    return () => clearTimeout(initTimer);
  }, [votd, advanceKiosk, kioskRestart]); // kioskRestart reruns this when presenter leaves

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
      setShowQrOverlay(false);
      resetScreensaver();
      const newBg = data.theme?.background_url;
      if (newBg) crossfadeBackground(newBg);
      // Track for kiosk resume — if kiosk turns on later, it picks up from here
      if (data.verse_id) kioskCurVerseRef.current = data.verse_id;
      // Fetch POV tags for backdrop tint
      const verseId = data.verse?.verse_id;
      if (verseId) {
        fetch(`/verse/${verseId}/tags`)
          .then(r => r.ok ? r.json() : null)
          .then(t => { if (t?.pov) setVersePov(t.pov); else setVersePov(null); })
          .catch(() => setVersePov(null));
      } else {
        setVersePov(null);
      }
      const mode = data.theme?.transition_mode || 'crossfade';
      // Step 1 — fade out (+ raise overlay for fade-black)
      setTextVisible(false);
      if (mode === 'fade-black') setOverlayActive(true);
      setTimeout(() => {
        // Step 2 — swap content while invisible
        setVerse(data);
        setDisplayVerse(data);
        setIsIdle(false);
        // Step 3 — fade back in (+ lower overlay)
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            setTextVisible(true);
            if (mode === 'fade-black') setOverlayActive(false);
          })
        );
      }, mode === 'cut' ? 0 : TEXT_FADE_MS);
    };

    const handleTheme = (theme) => {
      resetScreensaver();
      if (theme.background_url) crossfadeBackground(theme.background_url);
      setVerse((v) => ({ ...v, theme }));
      // Presenter remote font scale — same fontScale state as local A-/A+ buttons
      if (theme.font_scale != null && !isNaN(theme.font_scale)) {
        const s = Math.min(2.0, Math.max(0.5, theme.font_scale));
        setFontScale(s);
        localStorage.setItem('scicp.client_font_scale', s);
      }
    };

    const handleHighlight = (payload) => {
      const text = (payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, 'text'))
        ? payload.text
        : payload;
      setHighlightedText(text ? String(text) : '');
    };

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
      // Presenter ended live — return to connected-idle, show VOTD, and reveal
      // the QR overlay so the next presenter can scan to rejoin the same session.
      setCustomData(null);
      setShowQrOverlay(true);
      resetScreensaver();
      setTextVisible(false);
      setTimeout(() => {
        setDisplayVerse(null);
        setHighlightedText('');
        // Re-show VOTD so the TV is never blank between verses
        setVotdPending(true);
      }, 400);
    };

    const handlePresenterLeft = (data = {}) => {
      if (data.locked) {
        // Presenter's device disconnected (WiFi blip, phone sleep, mid-sermon) but
        // their slot is still held — do NOT revert QR to "Scan to present".
        // The audience should see "Service in progress" rather than an invitation
        // for someone else to accidentally grab the presenter role.
        setPresenterJoined(false);
        presenterJoinedRef.current = false;
        setPresenterSessionLocked(true);
        setHighlightedText('');
        clearTimeout(presenterLeftTimer.current);
        presenterLeftTimer.current = setTimeout(() => setPresenterLeft(false), 8000);
        setPresenterLeft(true);
        clearTimeout(presenterGraceTimerRef.current);
        presenterGraceTimerRef.current = setTimeout(() => {
          setIsKioskMode(true);
          setKioskRestart(n => n + 1);
        }, 15 * 60 * 1000);
        return;
      }
      setPresenterSessionLocked(false);
      setPresenterJoined(false);
      presenterJoinedRef.current = false;
      setShowQrOverlay(true);
      setPresenterLeft(true);
      setHighlightedText('');
      clearTimeout(presenterLeftTimer.current);
      presenterLeftTimer.current = setTimeout(() => setPresenterLeft(false), 8000);
      // ── Grace period ──────────────────────────────────────────────────────────
      // Keep the last live verse on screen for 15 min before falling back to kiosk.
      // If the presenter reconnects within that window the timer is cancelled and
      // the live verse is restored transparently (no kiosk flash mid-service).
      clearTimeout(presenterGraceTimerRef.current);
      presenterGraceTimerRef.current = setTimeout(() => {
        setIsKioskMode(true);
        setKioskRestart(n => n + 1);
      }, 15 * 60 * 1000);
    };

    const handlePresenterJoined = ({ verse, theme } = {}) => {
      // Cancel any pending kiosk grace timer — presenter is back
      clearTimeout(presenterGraceTimerRef.current);
      // Presenter is reconnecting — clear the locked state
      setPresenterSessionLocked(false);
      // Stop kiosk cycling unconditionally — no leftover timer should fire after join
      setIsKioskMode(false);
      setNowReadingOn(false); // auto-disable Now Reading when presenter connects
      nowReadingOnRef.current = false;
      if (kioskTimerRef.current) clearTimeout(kioskTimerRef.current);
      setShowQrOverlay(false); // hide QR regardless — a presenter is in the room
      if (presenterJoinedRef.current) return; // rest only runs on first join
      setPresenterJoined(true);
      presenterJoinedRef.current = true;
      setPresenterJoining(true);
      clearTimeout(joiningOverlayTimer.current);
      joiningOverlayTimer.current = setTimeout(() => setPresenterJoining(false), 1800);
      if (verse) {
        // Restore the session's live verse immediately — skip VOTD entirely.
        // This handles both fresh joins where the presenter already went live
        // and reconnects after a WiFi hiccup mid-service.
        const verseData = theme ? { ...verse, theme } : verse;
        handleVerse(verseData);
      } else {
        // Fresh session — presenter hasn't gone live yet.
        // Keep the last kiosk/displayed verse if one exists; only fall back to VOTD when display is empty.
        setVotdAsDisplay(); // VOTD pending effect has a guard: skips if displayVerse already set
      }
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

    const handleCustomText = (data) => {
      if (data.theme) crossfadeBackground(data.theme.background_url || bgUrl);
      setShowQrOverlay(false);
      resetScreensaver();
      setTextVisible(false);
      setTimeout(() => {
        setCustomData(data);
        setDisplayVerse(null);
        setIsIdle(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
      }, TEXT_FADE_MS);
    };

    const handlePreloadBackground = ({ background_url }) => {
      if (!background_url) return;
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.src = background_url;
    };

    const handleNowReading = ({ on, verse_id }) => {
      nowReadingOnRef.current = !!on;
      setNowReadingOn(!!on);
      if (kioskTimerRef.current) clearTimeout(kioskTimerRef.current);
      if (on) {
        // Start kiosk from the provided liveVerse, or fall back to last shown verse
        const startFrom = verse_id || kioskCurVerseRef.current;
        if (startFrom) {
          kioskCurVerseRef.current = startFrom;
          // Schedule first advance after current verse has been read (~5s)
          kioskTimerRef.current = setTimeout(() => advanceKiosk(startFrom), 5000);
        }
      } else {
        // Stop kiosk cycling entirely
        setIsKioskMode(false);
      }
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
    socket.on('now-reading',          handleNowReading);

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
      socket.off('now-reading',          handleNowReading);
      if (screensaverTimerRef.current)   clearTimeout(screensaverTimerRef.current);
      if (kioskTimerRef.current)         clearTimeout(kioskTimerRef.current);
      if (bgFadeTimer.current)           clearTimeout(bgFadeTimer.current);
      if (presenterLeftTimer.current)    clearTimeout(presenterLeftTimer.current);
      if (joiningOverlayTimer.current)   clearTimeout(joiningOverlayTimer.current);
      if (presenterGraceTimerRef.current) clearTimeout(presenterGraceTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, crossfadeBackground, createClientSession, resetScreensaver]);

  // When announcement mode is active, calibrate against the announcement text
  // so it gets the same font-fitting treatment as scripture.
  const displayText = customData
    ? (customData.text || '')
    : verse.segments?.length > 0
      ? (verse.segments[verse.currentSegment] || verse.scripture_text)
      : (verse.scripture_text || '');

  // Secondary (dual-language) text — needed for height budget in font sizing
  const secondaryText = !customData
    ? (verse.secondary_segments?.[verse.currentSegment] || verse.secondary_text || '')
    : '';

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
      const weightedPrimaryLength = weightedLength(displayText);
      if (weightedPrimaryLength > 220) pressure += 1;
      if (weightedPrimaryLength > 420) pressure += 1;
      if (pressure > 0) mode = pushReadabilityMode(mode, pressure >= 2 ? 2 : 1);
      setReadabilityMode(mode);
      if (typeof lum === 'number' && !verse?.theme?.highlight_color) {
        if (lum >= 0.55) setAutoHighlight('rgba(120, 60, 10, 0.92)');
        else if (lum <= 0.30) setAutoHighlight('rgba(255, 232, 182, 0.97)');
        else setAutoHighlight('rgba(220, 168, 80, 0.95)');
      } else if (verse?.theme?.highlight_color) {
        setAutoHighlight(null);
      }
      const words   = displayText.trim().split(/\s+/).filter(Boolean);
      const avgWord = words.length ? words.join('').length / words.length : 0;
      setDyslexiaMode(viewport.w <= 1024 && (weightedPrimaryLength > 260 || avgWord >= 5.6));
      setAutoReducedMotion(prefersReducedMotion || viewport.w <= 640 || weightedPrimaryLength > 320);
    };
    tune();
    return () => { active = false; };
  }, [verse?.theme?.background_url, verse?.theme?.highlight_color, displayText, viewport.w, prefersReducedMotion]);

  // True when currently displaying the VOTD (no real verse has been sent yet)
  const isShowingVotd   = votd && displayVerse && displayVerse.verse_id === votd.verse_id && !votdPending;
  const hasMoreSegments = !customData && verse.segments && verse.currentSegment < verse.segments.length - 1;
  const layout          = verse.theme?.layout || 'centered';
  const tone            = verse.theme?.tone === 'light' ? 'client-theme-light' : 'client-theme-dark';
  const isDisconnected  = connectionState === 'disconnected' || connectionState === 'error';
  const isReconnecting  = connectionState === 'reconnecting';
  const forceAnimations = Boolean((customData?.theme || verse?.theme)?.force_animations);
  const noMotion        = autoReducedMotion && !forceAnimations;
  const joinedSession   = joinedSessionRef.current;

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

  const { w: vw, h: vh, rem: PX_PER_REM } = viewport;
  const hasCjkPrimary = containsCjk(displayText);
  const hasCjkSecondary = containsCjk(secondaryText);
  const hasCjk = hasCjkPrimary || hasCjkSecondary;
  const length = weightedLength(displayText);
  const secLength = weightedLength(secondaryText);

  const viewportMaxCap = vw >= 2400 ? 7.5 : vw >= 1920 ? 6.5 : vw >= 901 ? 5.4 : vw >= 641 ? 4.0 : 2.6;
  const backdropMaxH  = Math.min(vh * 0.82, 960);
  const backdropVPad  = 2 * Math.min(2.2 * PX_PER_REM, Math.max(PX_PER_REM, vh * 0.024));
  const lowerThirdPad = !customData && layout === 'lower-third'
    ? Math.min(6 * PX_PER_REM, Math.max(2.4 * PX_PER_REM, vh * 0.07)) : 0;
  // Caption budget: main citation line + volume subtitle + margin/border
  const hasCaption = !customData && verse.book_title && verse.chapter_number && verse.verse_number;
  const hasVolume  = hasCaption && (verse.version_citation || verse.volume_title);
  const captionH = hasCaption
    ? Math.min(1.3 * PX_PER_REM, Math.max(0.7 * PX_PER_REM, vh * 0.018))   // citation text
    + Math.min(0.6 * PX_PER_REM, Math.max(0.3 * PX_PER_REM, vh * 0.008))    // border + margin-top
    + (hasVolume ? Math.min(0.9 * PX_PER_REM, Math.max(0.45 * PX_PER_REM, vh * 0.01)) : 0)  // volume subtitle
    + PX_PER_REM : 0;  // bottom breathing room
  const contH    = hasMoreSegments ? 1.2 * PX_PER_REM : 0;
  const safetyPx = Math.max(14, PX_PER_REM * 0.9);
  const textAreaH = Math.max(60,
    backdropMaxH - backdropVPad - lowerThirdPad - captionH - contH - safetyPx
  );
  const backdropHPad = 2 * Math.min(3 * PX_PER_REM, Math.max(1.1 * PX_PER_REM, vw * 0.032));
  const backdropW    = (vw >= 901 ? Math.min(vw * 0.88, 1280) : Math.min(vw * 0.9, 1250)) - backdropHPad;
  const textAreaW    = Math.max(80, backdropW);
  const charW        = (dyslexiaMode ? 0.61 : 0.57) + (hasCjk ? 0.08 : 0);
  const lh           = (dyslexiaMode ? 1.58 : 1.52) + (hasCjk ? 0.08 : 0);
  const WRAP_FUDGE   = hasCjk ? 1.18 : 1.13;

  // Secondary text sizing constants (see .verse-secondary-text CSS)
  const SEC_FONT_RATIO = vw <= 640 ? 0.48 : 0.58;   // em relative to primary
  const SEC_LH         = 1.5;
  const SEC_MARGIN_EM  = 0.55; // margin-top in em of primary font

  const fontSizeThatFits = (() => {
    // Always search against viewport cap so result is a pure overflow guard
    let lo = 0.55, hi = viewportMaxCap;
    for (let i = 0; i < 36; i++) {
      const mid   = (lo + hi) / 2;
      const midPx = mid * PX_PER_REM;
      // Primary text height
      const cpl   = textAreaW / (midPx * charW);
      const lines = Math.ceil((length / cpl) * WRAP_FUDGE) + (hasMoreSegments ? 1 : 0);
      let totalH  = Math.max(1, lines) * lh * midPx;
      // Secondary (dual-language) text height
      if (secLength > 0) {
        const secPx   = midPx * SEC_FONT_RATIO;
        const secCpl  = textAreaW / (secPx * charW);
        const secLines = Math.ceil((secLength / secCpl) * WRAP_FUDGE);
        totalH += Math.max(1, secLines) * SEC_LH * secPx + SEC_MARGIN_EM * midPx;
      }
      if (totalH <= textAreaH) lo = mid; else hi = mid;
    }
    return lo;
  })();

  const fittingRem       = fontSizeThatFits * 0.95;  // largest size that fits without clipping
  const hour = new Date().getHours();
  const timeFloorAdj = (hour >= 20 || hour < 6) ? -0.08 : (hour >= 10 && hour < 18) ? 0.05 : 0;
  const rawFloorBase = (vw >= 2400 ? 2.0 : vw >= 1920 ? 1.75 : vw >= 901 ? 1.45 : vw >= 641 ? 1.05 : 0.82) + timeFloorAdj;
  const rawFloor         = Math.max(0.72, rawFloorBase - (hasCjk ? 0.12 : 0));
  // Auto-fit: largest size that fits, clamped to legibility floor and viewport cap.
  // fontScale (set by local A-/A+ OR by presenter remote) multiplies on top.
  // Sacred rules: scaledRem can never exceed fittingRem (no clipping) and never below rawFloor / viewportMaxCap bounds.
  const computedRem      = Math.min(viewportMaxCap, Math.max(rawFloor, fittingRem));
  const scaledRem        = Math.min(fittingRem, computedRem * fontScale);
  const computedFontSize = `${scaledRem.toFixed(5)}rem`;

  const VOLUME_CLASS_MAP = {
    'Old Testament':          'volume-ot',
    'New Testament':          'volume-nt',
    'Book of Mormon':         'volume-bom',
    'Doctrine and Covenants': 'volume-dc',
    'Pearl of Great Price':   'volume-pgp',
  };
  const volumeClass = VOLUME_CLASS_MAP[verse?.volume_title] || '';
  const transitionMode = verse?.theme?.transition_mode || 'crossfade';
  const transitionClass = transitionMode !== 'crossfade' ? ` verse-text-transition--${transitionMode}` : '';

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

  return (
    <div className={viewClass} style={{
      fontSize: computedFontSize,
      fontFamily: hasCjk
        ? (verse.theme?.font_family || "'Noto Serif CJK SC', 'Noto Serif', Georgia, serif")
        : (verse.theme?.font_family || undefined),
      ...((() => {
        const hc = verse.theme?.highlight_color || autoHighlight;
        return hc ? { '--client-highlight': hc, '--client-highlight-glow': hc + '88' } : {};
      })()),
    }}
      onClick={isScreensaver ? resetScreensaver : undefined}
      onKeyDown={isScreensaver ? resetScreensaver : undefined}
      tabIndex={isScreensaver ? 0 : undefined}
    >

      <div className="client-bg-current" style={{ backgroundImage: bgUrl }} aria-hidden="true" />
      {versePov && versePov !== 'historical narrative' && (
        <div
          className="client-pov-tint"
          style={{ '--pov-color': POV_TINT[versePov] || 'transparent' }}
          aria-hidden="true"
        />
      )}
      {bgFading && prevBgUrl && (
        <div className="client-bg-prev" style={{ backgroundImage: prevBgUrl }} aria-hidden="true" />
      )}

      {/* Fade-to-black overlay — only visible when transitionMode === 'fade-black' during swap */}
      <div className={`trans-overlay${overlayActive ? ' trans-overlay--active' : ''}`} aria-hidden="true" />

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
            <div className={`verse-text-body${transitionClass}${textVisible ? ' verse-text-visible' : ''}`}>
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
            <div className={`verse-text-body${transitionClass}${textVisible ? ' verse-text-visible' : ''}`}>
              <p>{renderHighlightedText()}</p>
              {/* F8 — secondary language text (paired segment when dual-seg active) */}
              {(verse.secondary_segments?.[verse.currentSegment] || verse.secondary_text) && (
                <p className="verse-secondary-text">
                  {verse.secondary_segments?.[verse.currentSegment] || verse.secondary_text}
                </p>
              )}
              {verse.book_title && verse.chapter_number && verse.verse_number && (
                <div className="verse-caption">
                  {verse.book_title}&ensp;{verse.chapter_number}:{verse.verse_number}
                  {(verse.version_citation || verse.volume_title) && (
                    <span className="verse-caption-volume">{verse.version_citation || verse.volume_title}</span>
                  )}
                  {isShowingVotd && (
                    <span className="client-votd-label">✦ Verse of the Day</span>
                  )}
                  {(isKioskMode && !presenterJoined && !isShowingVotd) || nowReadingOn ? (
                    <span className="client-votd-label">✦ Now Reading</span>
                  ) : null}
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
      {/* QR overlay — persistent bottom-right badge, always visible.
           Waiting mode  → /presenter URL so operator can scan to present.
           Live mode     → /client URL so audience can mirror on their own device.
           Hidden on secondary screens and in the Electron desktop app. */}
      {clientSessionId && !isSecondaryScreen && !isElectronApp && (() => {
        const isLive   = presenterJoined && !showQrOverlay;
        const isLocked = !isLive && presenterSessionLocked;
        const activeQr    = isLive ? clientQrDataUrl : (isLocked ? null : qrDataUrl);
        const activeLabel = isLive
          ? `Follow on your device · ${clientSessionId}`
          : isLocked
            ? `Service in progress · ${clientSessionId}`
            : `Scan to present · ${clientSessionId}`;
        const activeAlt   = isLive ? 'Open on your device' : isLocked ? 'Service in progress' : 'Scan to join as presenter';
        return (
          <div
            className={`client-votd-qr-overlay${isLive ? ' client-votd-qr-overlay--live' : ''}`}
            aria-label={activeLabel}
          >
            {activeQr && (
              <img src={activeQr} alt={activeAlt} className="client-votd-qr-img" />
            )}
            {qrError && !activeQr && (
              <p className="qr-error-msg">QR unavailable — share session code: <strong>{clientSessionId}</strong></p>
            )}
            <span className="client-votd-qr-label">{activeLabel}</span>
          </div>
        );
      })()}

      {/* "✓ Presenter connected" flash — shown briefly when a presenter scans in */}
      {presenterJoining && !isElectronApp && (
        <div className="client-qr-joining-overlay" aria-live="assertive">
          <div className="client-qr-joining-check">✓</div>
          <div className="client-qr-joining-text">Presenter connected</div>
        </div>
      )}

      <div className="client-font-controls" aria-label="Font size controls">
        <button onClick={() => { const s = Math.max(0.5, parseFloat((fontScale - 0.1).toFixed(1))); setFontScale(s); localStorage.setItem('scicp.client_font_scale', s); }} aria-label="Decrease font size">A−</button>
        <button onClick={() => { const s = Math.min(2.0, parseFloat((fontScale + 0.1).toFixed(1))); setFontScale(s); localStorage.setItem('scicp.client_font_scale', s); }} aria-label="Increase font size">A+</button>
        <button onClick={() => { setFontScale(1); localStorage.setItem('scicp.client_font_scale', '1'); }} aria-label="Reset font size">↺</button>
      </div>

      <button className="fullscreen-toggle" onClick={toggleFullscreen} aria-label="Toggle fullscreen" title="Toggle fullscreen (F11)">⛶</button>
    </div>
  );
}

export default Client;
