import { useState, useEffect, useCallback, useRef } from 'react';
import socket, { SERVER_URL } from '../socket';
import './TVClient.css';

// ── Helpers ──

const CJK_RE = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uff66-\uff9f]/;
const containsCjk = (t) => CJK_RE.test(String(t || ''));
const weightedLen = (t) => { let n = 0; for (const c of String(t || '')) n += CJK_RE.test(c) ? 1.8 : 1; return n; };

const kioskDisplayMs = (text, mult = 1) => {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  return Math.min(15000, Math.max(5000, (words / 160) * 60_000)) * mult;
};

const generateQrDataUrl = async (text) => {
  try {
    const QRCode = await import('qrcode').catch(() => null);
    if (!QRCode) return null;
    const mod = QRCode.default || QRCode;
    return await mod.toDataURL(text, {
      width: 512, margin: 2,
      color: { dark: '#0a0a0f', light: '#f0ece0' },
      errorCorrectionLevel: 'H',
    });
  } catch { return null; }
};

const TV_SESSION_KEY = 'scicp_tv_session';
const TV_TOKEN_KEY   = 'scicp_tv_token';
const API = SERVER_URL;

const DEFAULT_THEME = {
  backgroundColor: '#0a0a0f', textColor: '#f0ece4',
  font_family: "'Cormorant Garamond', Georgia, serif",
  layout: 'centered', tone: 'dark',
};

const TEXT_FADE_MS = 400;
const SCREENSAVER_DELAY = 10 * 60_000;

export default function TVClient() {
  // ── Connection state ──
  const [conn, setConn] = useState(socket.connected ? 'connected' : 'disconnected');

  // ── Session ──
  const [sessionId, setSessionId] = useState(() => localStorage.getItem(TV_SESSION_KEY) || '');
  const [mainClientToken, setMainClientToken] = useState(() => localStorage.getItem(TV_TOKEN_KEY) || '');
  const sessionIdRef = useRef(sessionId);

  // ── QR codes: dual system ──
  const [presenterQr, setPresenterQr] = useState('');  // for operator to scan
  const [audienceQr, setAudienceQr]   = useState('');  // for viewers to scan
  const [qrError, setQrError]         = useState(false);

  // ── Presenter lifecycle ──
  const [presenterJoined, setPresenterJoined]   = useState(false);
  const [presenterLocked, setPresenterLocked]   = useState(false);
  const [presenterLeft, setPresenterLeftNotice]  = useState(false);
  const [presenterJoining, setPresenterJoining] = useState(false);
  const [showQrOverlay, setShowQrOverlay]       = useState(false);
  const presenterJoinedRef = useRef(false);

  // ── Display state ──
  const [verse, setVerse]               = useState(null);
  const [displayVerse, setDisplayVerse] = useState(null);
  const [customData, setCustomData]     = useState(null);
  const [highlightedText, setHighlightedText] = useState('');
  const [isIdle, setIsIdle]             = useState(true);
  const [textVisible, setTextVisible]   = useState(false);

  // ── Theme & background ──
  const [theme, setTheme]       = useState(DEFAULT_THEME);
  const [bgUrl, setBgUrl]       = useState('');
  const [prevBgUrl, setPrevBgUrl] = useState('');
  const [bgFading, setBgFading] = useState(false);
  const bgUrlRef   = useRef('');
  const bgFadeTimer = useRef(null);

  // ── Kiosk / VOTD / Now Reading ──
  const [votd, setVotd]             = useState(null);
  const [isKioskMode, setIsKioskMode] = useState(true);
  const [kioskRestart, setKioskRestart] = useState(0);
  const [nowReadingOn, setNowReadingOn] = useState(false);
  const [isShowingVotd, setIsShowingVotd] = useState(false);
  const kioskTimerRef    = useRef(null);
  const kioskCurVerseRef = useRef(null);
  const nowReadingOnRef  = useRef(false);

  // ── Screensaver ──
  const [isScreensaver, setIsScreensaver] = useState(false);
  const screensaverTimerRef = useRef(null);

  // ── Font / settings ──
  const [fontScale, setFontScale] = useState(() => parseFloat(localStorage.getItem('scicp_tv_fontscale') || '1'));
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Timers ──
  const presenterLeftTimer   = useRef(null);
  const joiningOverlayTimer  = useRef(null);
  const presenterGraceTimer  = useRef(null);

  // ── Viewport for auto-fit ──
  const getVp = () => ({
    w: window.innerWidth, h: window.innerHeight,
    rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16,
  });
  const [viewport, setViewport] = useState(getVp);
  useEffect(() => {
    const u = () => setViewport(getVp());
    window.addEventListener('resize', u, { passive: true });
    return () => window.removeEventListener('resize', u);
  }, []);

  // ── Refs sync ──
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { presenterJoinedRef.current = presenterJoined; }, [presenterJoined]);
  useEffect(() => { bgUrlRef.current = bgUrl; }, [bgUrl]);

  // ── Crossfade background ──
  const crossfadeBackground = useCallback((newUrl) => {
    const cur = bgUrlRef.current;
    if (!newUrl || newUrl === cur) return;
    clearTimeout(bgFadeTimer.current);
    setPrevBgUrl(cur);
    bgUrlRef.current = newUrl;
    setBgUrl(newUrl);
    setBgFading(true);
    bgFadeTimer.current = setTimeout(() => { setPrevBgUrl(''); setBgFading(false); }, 1400);
  }, []);

  // ── Screensaver reset ──
  const resetScreensaver = useCallback(() => {
    setIsScreensaver(false);
    clearTimeout(screensaverTimerRef.current);
    screensaverTimerRef.current = setTimeout(() => setIsScreensaver(true), SCREENSAVER_DELAY);
  }, []);

  // ── Fetch VOTD ──
  useEffect(() => {
    fetch(`${API}/verse/of-the-day`).then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.verse_id) setVotd(d); }).catch(() => {});
  }, []);

  // ── Generate dual QR codes ──
  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setPresenterQr(''); setAudienceQr(''); setQrError(false);
    // Presenter QR → deep link to mobile app settings page (or just session ID)
    generateQrDataUrl(sessionId).then(url => {
      if (!cancelled) { if (url) setPresenterQr(url); else setQrError(true); }
    });
    // Audience QR → web client URL for secondary viewers
    generateQrDataUrl(`${API}/client?session=${sessionId}`).then(url => {
      if (!cancelled && url) setAudienceQr(url);
    });
    return () => { cancelled = true; };
  }, [sessionId]);

  // ── Create client session on connect ──
  const createClientSession = useCallback(() => {
    const preferred = localStorage.getItem(TV_SESSION_KEY) || '';
    const token = localStorage.getItem(TV_TOKEN_KEY) || '';
    socket.emit('create-client-session', {
      preferredSessionId: preferred || undefined,
      mainClientToken: token || undefined,
    });
  }, []);

  // ── Socket event handlers ──
  useEffect(() => {
    const handleConnect = () => {
      setConn('connected');
      if (sessionIdRef.current) {
        // Try to rejoin existing session
        socket.emit('create-client-session', {
          preferredSessionId: sessionIdRef.current,
          mainClientToken: localStorage.getItem(TV_TOKEN_KEY) || undefined,
        });
      } else {
        createClientSession();
      }
    };
    const handleDisconnect = () => setConn('disconnected');
    const handleReconnecting = () => setConn('connecting');

    const handleSessionCreated = (data) => {
      setSessionId(data.sessionId);
      if (data.mainClientToken) setMainClientToken(data.mainClientToken);
      localStorage.setItem(TV_SESSION_KEY, data.sessionId);
      if (data.mainClientToken) localStorage.setItem(TV_TOKEN_KEY, data.mainClientToken);
      setPresenterJoined(false);
      presenterJoinedRef.current = false;
      setVerse(null);
      setDisplayVerse(null);
      setCustomData(null);
      setIsIdle(true);
    };

    const handleSessionJoined = (data) => {
      setSessionId(data.sessionId);
      localStorage.setItem(TV_SESSION_KEY, data.sessionId);
    };

    const handleSessionError = (data) => {
      const msg = data.message || '';
      if (msg.includes('not found') || msg.includes('expired')) {
        localStorage.removeItem(TV_SESSION_KEY);
        localStorage.removeItem(TV_TOKEN_KEY);
        setSessionId(''); setMainClientToken('');
        setPresenterJoined(false); presenterJoinedRef.current = false;
        setPresenterLocked(false);
        setVerse(null); setDisplayVerse(null); setCustomData(null);
        setIsIdle(true);
        socket.emit('create-client-session', {});
      }
    };

    // ── Presenter joined ──
    const handlePresenterJoined = ({ verse: v, theme: t } = {}) => {
      clearTimeout(presenterGraceTimer.current);
      setPresenterLocked(false);
      setIsKioskMode(false);
      setNowReadingOn(false); nowReadingOnRef.current = false;
      if (kioskTimerRef.current) clearTimeout(kioskTimerRef.current);
      setShowQrOverlay(false);

      if (!presenterJoinedRef.current) {
        setPresenterJoined(true);
        presenterJoinedRef.current = true;
        setPresenterJoining(true);
        clearTimeout(joiningOverlayTimer.current);
        joiningOverlayTimer.current = setTimeout(() => setPresenterJoining(false), 1800);
      }

      if (v) {
        // Restore live verse
        const verseData = t ? { ...v, theme: t } : v;
        if (t?.background_url) crossfadeBackground(t.background_url);
        setTextVisible(false);
        setTimeout(() => {
          setVerse(verseData); setDisplayVerse(verseData);
          setCustomData(null); setIsIdle(false);
          requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
        }, TEXT_FADE_MS);
      } else {
        // No verse — show VOTD
        if (votd) {
          const vd = { ...votd, segments: [votd.scripture_text], currentSegment: 0, totalSegments: 1, theme: DEFAULT_THEME };
          setTextVisible(false);
          setTimeout(() => {
            setVerse(vd); setDisplayVerse(vd); setIsIdle(false);
            setIsShowingVotd(true);
            requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
          }, TEXT_FADE_MS);
        }
      }
      resetScreensaver();
    };

    // ── Presenter left ──
    const handlePresenterLeft = (data = {}) => {
      clearTimeout(presenterLeftTimer.current);
      setPresenterLeftNotice(true);
      presenterLeftTimer.current = setTimeout(() => setPresenterLeftNotice(false), 8000);

      if (data.locked) {
        // WiFi blip — slot still held
        setPresenterJoined(false); presenterJoinedRef.current = false;
        setPresenterLocked(true);
        setHighlightedText('');
        clearTimeout(presenterGraceTimer.current);
        presenterGraceTimer.current = setTimeout(() => {
          setIsKioskMode(true); setKioskRestart(n => n + 1);
        }, 15 * 60_000);
        return;
      }
      // Clean disconnect
      setPresenterLocked(false);
      setPresenterJoined(false); presenterJoinedRef.current = false;
      setShowQrOverlay(true);
      setHighlightedText('');
      clearTimeout(presenterGraceTimer.current);
      presenterGraceTimer.current = setTimeout(() => {
        setIsKioskMode(true); setKioskRestart(n => n + 1);
      }, 15 * 60_000);
    };

    // ── Verse / theme / highlight / clear ──
    const handleVerse = (data) => {
      setHighlightedText(''); setCustomData(null); setShowQrOverlay(false);
      setIsShowingVotd(false);
      resetScreensaver();
      if (data.theme?.background_url) crossfadeBackground(data.theme.background_url);
      if (data.theme) setTheme(prev => ({ ...prev, ...data.theme }));
      if (data.verse_id) kioskCurVerseRef.current = data.verse_id;
      setTextVisible(false);
      setTimeout(() => {
        setVerse(data); setDisplayVerse(data);
        setIsIdle(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
      }, TEXT_FADE_MS);
    };

    const handleTheme = (data) => {
      const t = data.theme || data;
      if (t.background_url) crossfadeBackground(t.background_url);
      setTheme(prev => ({ ...prev, ...t }));
      if (verse) setVerse(prev => prev ? { ...prev, theme: { ...(prev.theme || {}), ...t } } : prev);
      resetScreensaver();
    };

    const handleHighlight = (data) => {
      const text = typeof data === 'string' ? data : (data?.text || '');
      setHighlightedText(text);
    };

    const handleClear = () => {
      setCustomData(null); setShowQrOverlay(true);
      setIsShowingVotd(false);
      resetScreensaver();
      setTextVisible(false);
      setTimeout(() => {
        setDisplayVerse(null); setHighlightedText('');
        setIsIdle(true);
      }, TEXT_FADE_MS);
    };

    const handleCustomText = (data) => {
      if (data.theme?.background_url) crossfadeBackground(data.theme.background_url);
      setShowQrOverlay(false); resetScreensaver();
      setTextVisible(false);
      setTimeout(() => {
        setCustomData(data); setDisplayVerse(null); setIsIdle(false);
        requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
      }, TEXT_FADE_MS);
    };

    const handlePreload = ({ background_url, url }) => {
      const u = background_url || url;
      if (u) { const img = new Image(); img.src = u; }
    };

    const handleNowReading = ({ on, verse_id }) => {
      nowReadingOnRef.current = !!on;
      setNowReadingOn(!!on);
      if (kioskTimerRef.current) clearTimeout(kioskTimerRef.current);
      if (on) {
        const startFrom = verse_id || kioskCurVerseRef.current;
        if (startFrom) {
          kioskCurVerseRef.current = startFrom;
          kioskTimerRef.current = setTimeout(() => advanceKiosk(startFrom), 5000);
        }
      } else {
        setIsKioskMode(false);
      }
    };

    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.io.on('reconnect_attempt', handleReconnecting);
    socket.on('client-session-created', handleSessionCreated);
    socket.on('session-joined', handleSessionJoined);
    socket.on('session-error', handleSessionError);
    socket.on('presenter-joined', handlePresenterJoined);
    socket.on('presenter-left', handlePresenterLeft);
    socket.on('update-verse', handleVerse);
    socket.on('update-theme', handleTheme);
    socket.on('highlight-text', handleHighlight);
    socket.on('clear-screen', handleClear);
    socket.on('custom-text', handleCustomText);
    socket.on('preload-background', handlePreload);
    socket.on('now-reading', handleNowReading);

    if (socket.connected) handleConnect();

    return () => {
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.io.off('reconnect_attempt', handleReconnecting);
      socket.off('client-session-created', handleSessionCreated);
      socket.off('session-joined', handleSessionJoined);
      socket.off('session-error', handleSessionError);
      socket.off('presenter-joined', handlePresenterJoined);
      socket.off('presenter-left', handlePresenterLeft);
      socket.off('update-verse', handleVerse);
      socket.off('update-theme', handleTheme);
      socket.off('highlight-text', handleHighlight);
      socket.off('clear-screen', handleClear);
      socket.off('custom-text', handleCustomText);
      socket.off('preload-background', handlePreload);
      socket.off('now-reading', handleNowReading);
      clearTimeout(screensaverTimerRef.current);
      clearTimeout(kioskTimerRef.current);
      clearTimeout(bgFadeTimer.current);
      clearTimeout(presenterLeftTimer.current);
      clearTimeout(joiningOverlayTimer.current);
      clearTimeout(presenterGraceTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crossfadeBackground, resetScreensaver, createClientSession, votd]);

  // ── Kiosk: auto-advance through verses ──
  const advanceKiosk = useCallback((fromVerseId) => {
    if (presenterJoinedRef.current && !nowReadingOnRef.current) return;
    fetch(`${API}/verse/adjacent?verse_id=${encodeURIComponent(fromVerseId)}&direction=next`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.verse_id || (presenterJoinedRef.current && !nowReadingOnRef.current)) return;
        const next = {
          ...data, segments: [data.scripture_text],
          currentSegment: 0, totalSegments: 1, theme: DEFAULT_THEME,
        };
        kioskCurVerseRef.current = data.verse_id;
        setTextVisible(false);
        setTimeout(() => {
          if (presenterJoinedRef.current && !nowReadingOnRef.current) return;
          setVerse(next); setDisplayVerse(next); setIsIdle(false); setIsShowingVotd(false);
          requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
          kioskTimerRef.current = setTimeout(() => advanceKiosk(data.verse_id), kioskDisplayMs(data.scripture_text));
        }, TEXT_FADE_MS);
      })
      .catch(() => {
        if (!presenterJoinedRef.current || nowReadingOnRef.current) {
          kioskTimerRef.current = setTimeout(() => advanceKiosk(fromVerseId), 8000);
        }
      });
  }, []);

  // ── Kiosk init: start from last verse or VOTD ──
  useEffect(() => {
    if (!isKioskMode || presenterJoinedRef.current) return;
    if (kioskTimerRef.current) clearTimeout(kioskTimerRef.current);

    const resumeId = kioskCurVerseRef.current;
    if (resumeId) {
      kioskTimerRef.current = setTimeout(() => advanceKiosk(resumeId), 5000);
      return;
    }
    if (!votd) return;
    const vd = {
      ...votd, segments: [votd.scripture_text],
      currentSegment: 0, totalSegments: 1, theme: DEFAULT_THEME,
    };
    kioskCurVerseRef.current = votd.verse_id;
    setTextVisible(false);
    const t = setTimeout(() => {
      if (presenterJoinedRef.current) return;
      setVerse(vd); setDisplayVerse(vd); setIsIdle(false); setIsShowingVotd(true);
      requestAnimationFrame(() => requestAnimationFrame(() => setTextVisible(true)));
      kioskTimerRef.current = setTimeout(() => advanceKiosk(votd.verse_id), kioskDisplayMs(votd.scripture_text, 2));
    }, TEXT_FADE_MS);
    return () => clearTimeout(t);
  }, [votd, advanceKiosk, isKioskMode, kioskRestart]);

  // ── D-pad handler ──
  useEffect(() => {
    const handler = (e) => {
      if (isScreensaver) { resetScreensaver(); return; }
      if (e.key === 'Enter' || e.key === ' ') setSettingsOpen(v => !v);
      if (e.key === 'ArrowUp') setFontScale(v => { const n = Math.min(v + 0.1, 2); localStorage.setItem('scicp_tv_fontscale', n); return n; });
      if (e.key === 'ArrowDown') setFontScale(v => { const n = Math.max(v - 0.1, 0.5); localStorage.setItem('scicp_tv_fontscale', n); return n; });
      if (e.key === 'F11') { e.preventDefault(); toggleFullscreen(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isScreensaver, resetScreensaver]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen().catch(() => {});
  }, []);

  // ── Display text computation ──
  const displayText = customData
    ? (customData.text || '')
    : verse?.segments?.length > 0
      ? (verse.segments[verse.currentSegment] || verse.scripture_text)
      : (verse?.scripture_text || '');

  const secondaryText = !customData
    ? (verse?.secondary_segments?.[verse?.currentSegment] || verse?.secondary_text || '')
    : '';

  // ── Highlight renderer ──
  const renderHighlightedText = () => {
    if (!highlightedText || !displayText) return displayText;
    const escaped = highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = displayText.split(new RegExp(`(${escaped})`, 'gi'));
    return parts.map((part, idx) =>
      part.toLowerCase() === highlightedText.toLowerCase()
        ? <mark key={idx} className="tv-highlight">{part}</mark>
        : part
    );
  };

  // ── Auto-fit font sizing (mirrors web Client algorithm) ──
  const { w: vw, h: vh, rem: PX } = viewport;
  const hasCjk    = containsCjk(displayText) || containsCjk(secondaryText);
  const length    = weightedLen(displayText);
  const secLength = weightedLen(secondaryText);

  const viewportMaxCap = vw >= 2400 ? 7.5 : vw >= 1920 ? 6.5 : vw >= 901 ? 5.4 : 4.0;
  const textAreaH = Math.max(60, vh * 0.75);
  const textAreaW = Math.max(80, vw * 0.85);
  const charW     = 0.57 + (hasCjk ? 0.08 : 0);
  const lh        = 1.52 + (hasCjk ? 0.08 : 0);
  const WRAP_FUDGE = hasCjk ? 1.18 : 1.13;

  const computedFontSize = (() => {
    let lo = 0.55, hi = viewportMaxCap;
    for (let i = 0; i < 36; i++) {
      const mid = (lo + hi) / 2;
      const midPx = mid * PX;
      const cpl = textAreaW / (midPx * charW);
      const lines = Math.ceil((length / cpl) * WRAP_FUDGE);
      let totalH = Math.max(1, lines) * lh * midPx;
      if (secLength > 0) {
        const secPx = midPx * 0.55;
        const secCpl = textAreaW / (secPx * charW);
        totalH += Math.ceil((secLength / secCpl) * WRAP_FUDGE) * 1.5 * secPx + 0.55 * midPx;
      }
      if (totalH <= textAreaH) lo = mid; else hi = mid;
    }
    const fitted = lo * 0.95;
    const floor = vw >= 2400 ? 2.0 : vw >= 1920 ? 1.75 : 1.45;
    const clamped = Math.min(viewportMaxCap, Math.max(floor, fitted));
    return Math.min(fitted, clamped * fontScale);
  })();

  // ── Derived state ──
  const hasCaption = !customData && verse?.book_title && verse?.chapter_number && verse?.verse_number;
  const caption = hasCaption ? `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}` : '';
  const hasSegments = !customData && verse?.segments?.length > 1;

  // ── QR state logic (3 states: waiting / locked / live) ──
  const isLive   = presenterJoined && !showQrOverlay;
  const isLocked = !isLive && presenterLocked;
  const activeQr = isLive ? audienceQr : (isLocked ? null : presenterQr);
  const activeLabel = isLive
    ? `Follow on your device · ${sessionId}`
    : isLocked
      ? `Service in progress · ${sessionId}`
      : `Scan to present · ${sessionId}`;

  const isDisconnected = conn === 'disconnected' || conn === 'error';

  return (
    <div
      className={[
        'tv-root',
        isIdle ? 'tv-idle-state' : '',
        isScreensaver ? 'tv-screensaver' : '',
        isDisconnected ? 'tv-disconnected' : '',
      ].filter(Boolean).join(' ')}
      style={{
        backgroundColor: theme.backgroundColor || '#0a0a0f',
        color: theme.textColor || '#f0ece4',
        fontSize: `${computedFontSize.toFixed(4)}rem`,
        fontFamily: hasCjk
          ? "'Noto Serif CJK SC', 'Noto Serif', Georgia, serif"
          : (theme.font_family || "'Cormorant Garamond', Georgia, serif"),
      }}
      onClick={isScreensaver ? resetScreensaver : undefined}
    >
      {/* ── Background layers ── */}
      <div className="tv-bg tv-bg-current" style={bgUrl ? { backgroundImage: `url(${bgUrl})` } : undefined} />
      {bgFading && prevBgUrl && (
        <div className="tv-bg tv-bg-prev" style={{ backgroundImage: `url(${prevBgUrl})` }} />
      )}

      {/* ── Idle screen ── */}
      {isIdle && !isScreensaver && (
        <div className="tv-idle">
          <div className="tv-idle-content">
            {presenterLeft && (
              <div className="tv-presenter-left-notice">
                Presenter disconnected — waiting for reconnection
              </div>
            )}
            {!displayVerse && !customData && (
              <>
                <div className="tv-idle-cross">
                  <div className="tv-idle-cross-v" />
                  <div className="tv-idle-cross-h" />
                </div>
                <div className="tv-idle-line" />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Custom text / announcement ── */}
      {!isIdle && customData && (
        <div className="tv-verse-container">
          <div className={`tv-verse-body${textVisible ? ' tv-text-visible' : ''}`}>
            <p className="tv-verse-text">{customData.text}</p>
            {customData.subtext && <p className="tv-verse-sub">{customData.subtext}</p>}
          </div>
        </div>
      )}

      {/* ── Verse display ── */}
      {!isIdle && !customData && displayVerse && (
        <div className="tv-verse-container">
          <div className={`tv-verse-body${textVisible ? ' tv-text-visible' : ''}`}>
            <p className="tv-verse-text">{renderHighlightedText()}</p>

            {/* Secondary language */}
            {secondaryText && (
              <p className="tv-verse-secondary">{secondaryText}</p>
            )}

            {/* Caption */}
            {hasCaption && (
              <div className="tv-verse-caption">
                {caption}
                {(verse.version_citation || verse.volume_title) && (
                  <span className="tv-caption-volume">{verse.version_citation || verse.volume_title}</span>
                )}
                {isShowingVotd && <span className="tv-votd-label">✦ Verse of the Day</span>}
                {((isKioskMode && !presenterJoined && !isShowingVotd) || nowReadingOn) && (
                  <span className="tv-votd-label">✦ Now Reading</span>
                )}
              </div>
            )}

            {/* Segment dots */}
            {hasSegments && (
              <div className="tv-segment-dots">
                {verse.segments.map((_, i) => (
                  <span key={i} className={`tv-seg-dot${i === verse.currentSegment ? ' tv-seg-dot--active' : ''}`} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Screensaver ── */}
      {isScreensaver && (
        <div className="tv-screensaver-overlay">
          <div className="tv-idle-cross">
            <div className="tv-idle-cross-v" />
            <div className="tv-idle-cross-h" />
          </div>
        </div>
      )}

      {/* ── Reconnecting banner ── */}
      {isDisconnected && sessionId && (
        <div className="tv-reconnect-banner">
          <span className="tv-reconnect-dot" />
          {conn === 'connecting' ? 'Reconnecting…' : 'Connection lost — retrying'}
        </div>
      )}

      {/* ── Session watermark ── */}
      {sessionId && (
        <span className={`tv-session-watermark${isDisconnected ? ' tv-session-watermark--lost' : ''}`}>
          {sessionId}
        </span>
      )}

      {/* ── QR overlay — 3 states ── */}
      {sessionId && (
        <div className={`tv-qr-overlay${isLive ? ' tv-qr-overlay--live' : ''}${isLocked ? ' tv-qr-overlay--locked' : ''}`}>
          {activeQr && (
            <img src={activeQr} alt={activeLabel} className="tv-qr-img" />
          )}
          {qrError && !activeQr && (
            <p className="tv-qr-error">QR unavailable — session: <strong>{sessionId}</strong></p>
          )}
          <span className="tv-qr-label">{activeLabel}</span>
        </div>
      )}

      {/* ── "✓ Presenter connected" flash ── */}
      {presenterJoining && (
        <div className="tv-joining-overlay">
          <div className="tv-joining-check">✓</div>
          <div className="tv-joining-text">Presenter connected</div>
        </div>
      )}

      {/* ── Font controls (on-screen for touch / remote) ── */}
      <div className="tv-font-controls">
        <button onClick={() => { const s = Math.max(0.5, +(fontScale - 0.1).toFixed(1)); setFontScale(s); localStorage.setItem('scicp_tv_fontscale', s); }}>A−</button>
        <button onClick={() => { const s = Math.min(2.0, +(fontScale + 0.1).toFixed(1)); setFontScale(s); localStorage.setItem('scicp_tv_fontscale', s); }}>A+</button>
        <button onClick={() => { setFontScale(1); localStorage.setItem('scicp_tv_fontscale', '1'); }}>↺</button>
      </div>

      {/* ── Fullscreen toggle ── */}
      <button className="tv-fullscreen-btn" onClick={toggleFullscreen} title="Toggle fullscreen (F11)">⛶</button>

      {/* ── Settings overlay (D-pad) ── */}
      {settingsOpen && (
        <div className="tv-settings-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="tv-settings-panel" onClick={e => e.stopPropagation()}>
            <h2>Display Settings</h2>
            <p>Font Scale: {fontScale.toFixed(1)}x</p>
            <p>Session: {sessionId || '—'}</p>
            <p>Presenter: {presenterJoined ? 'Connected' : presenterLocked ? 'Reconnecting…' : 'Waiting'}</p>
            <p className="tv-settings-hint">↑↓ to adjust font • Enter to close</p>
          </div>
        </div>
      )}

      {/* ── Connection dot ── */}
      <div className="tv-conn-dot">
        <span className={`tv-status-dot tv-status-${conn}`} />
      </div>
    </div>
  );
}
