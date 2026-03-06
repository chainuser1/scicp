import { useState, useEffect, useRef } from 'react';
import { socket } from '../socket';

// ─── Font loading sentinel ────────────────────────────────────────────────────
// Resolves once Cormorant Garamond + Cinzel are both ready.
// Falls back to a 2.5s deadline so the display never hangs.
const waitForFonts = () => {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('italic 1em "Cormorant Garamond"'),
    document.fonts.load('1em "Cinzel"'),
  ]).catch(() => {});
};

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

  const normalizeSessionId = (v) =>
    String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);

  // ─── State ───────────────────────────────────────────────────────────────────
  const [urlSession] = useState(
    () => new URLSearchParams(window.location.search).get('session') || ''
  );

  // isIdle: true until the first real verse arrives
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

  // Background crossfade: bgUrl = incoming, prevBgUrl = outgoing
  const [bgUrl, setBgUrl]         = useState(DEFAULT_BG);
  const [prevBgUrl, setPrevBgUrl] = useState('');
  const [bgFading, setBgFading]   = useState(false);
  const bgFadeTimer               = useRef(null);

  const [animating, setAnimating]   = useState(false);
  const [entering, setEntering]     = useState(false);
  const [highlightedText, setHighlightedText] = useState('');
  const [sessionInput, setSessionInput]       = useState(normalizeSessionId(urlSession));
  const [joinedSession, setJoinedSession]     = useState('');
  const [sessionMessage, setSessionMessage]   = useState(
    urlSession ? 'Joining session...' : 'Enter session code'
  );
  const [connectionState, setConnectionState] = useState('connecting');
  const [fontsReady, setFontsReady]           = useState(false);
  const [labelKey, setLabelKey]               = useState(0);
  const [readabilityMode, setReadabilityMode] = useState('balanced');
  const [dyslexiaMode, setDyslexiaMode]       = useState(false);

  const joinedSessionRef = useRef('');
  const sessionInputRef  = useRef(normalizeSessionId(urlSession));

  // ─── Refs sync ───────────────────────────────────────────────────────────────
  useEffect(() => { joinedSessionRef.current = joinedSession; }, [joinedSession]);
  useEffect(() => { sessionInputRef.current = sessionInput; },  [sessionInput]);

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
  // The outgoing image is preserved as prevBgUrl and fades out over 1.4s
  // while the new image fades in underneath. Runs independently of text timing.
  const crossfadeBackground = (newUrl) => {
    if (!newUrl || newUrl === bgUrl) return;
    clearTimeout(bgFadeTimer.current);
    setPrevBgUrl(bgUrl);
    setBgUrl(newUrl);
    setBgFading(true);
    bgFadeTimer.current = setTimeout(() => {
      setPrevBgUrl('');
      setBgFading(false);
    }, 1400);
  };

  // ─── Session join ─────────────────────────────────────────────────────────
  const attemptJoin = (candidate) => {
    const norm = normalizeSessionId(candidate);
    if (!norm) { setSessionMessage('Enter a valid session code'); return; }
    setSessionMessage('Joining session...');
    socket.emit('join-session', { sessionId: norm, role: 'viewer' }, (res) => {
      if (!res?.ok) setSessionMessage(res?.message || 'Unable to join session');
    });
  };

  // ─── Socket handlers ──────────────────────────────────────────────────────
  useEffect(() => {
    const handleVerse = (data) => {
      // [FIX #7] Clear highlight at the very start of exit — before new verse
      // mounts — so the old word's glow never bleeds into the exit animation.
      setHighlightedText('');
      setAnimating(true);
      setEntering(false);

      // Background crossfades on its own 1.4s timeline
      const newBg = data.theme?.background_url;
      if (newBg) crossfadeBackground(newBg);

      setTimeout(() => {
        setVerse(data);
        setIsIdle(false);
        setLabelKey((k) => k + 1);
        setAnimating(false);
        const doEnter = () =>
          requestAnimationFrame(() => requestAnimationFrame(() => setEntering(true)));
        // On the very first verse, wait for fonts before animating in
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
      requestAnimationFrame(() => requestAnimationFrame(() => setEntering(true)));
    };

    const handleSessionError  = ({ message }) =>
      setSessionMessage(message || 'Session error');
    const handleConnect       = () => setConnectionState('connected');
    const handleDisconnect    = () => setConnectionState('disconnected');
    const handleReconnect     = () => setConnectionState('reconnecting');
    const handleConnectError  = () => setConnectionState('error');

    socket.on('update-verse',      handleVerse);
    socket.on('update-theme',      handleTheme);
    socket.on('highlight-text',    handleHighlight);
    socket.on('session-joined',    handleSessionJoined);
    socket.on('session-error',     handleSessionError);
    socket.on('connect',           handleConnect);
    socket.on('disconnect',        handleDisconnect);
    socket.on('reconnect_attempt', handleReconnect);
    socket.on('connect_error',     handleConnectError);

    if (urlSession) {
      socket.emit(
        'join-session',
        { sessionId: normalizeSessionId(urlSession), role: 'viewer' },
        (res) => { if (!res?.ok) setSessionMessage(res?.message || 'Unable to join session'); }
      );
    }
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
  }, [urlSession, fontsReady]);

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

  // ─── Join screen ──────────────────────────────────────────────────────────
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
                <button className="control-button" onClick={() => attemptJoin(sessionInput)}>
                  Join
                </button>
              </div>
            </div>
            <div style={{ color: '#a09880', fontSize: '0.85rem' }}>{sessionMessage}</div>
            <div style={{ color: '#7f745f', fontSize: '0.75rem' }}>Connection: {connectionState}</div>
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

  const maxCap       = vw >= 2400 ? 7.5 : vw >= 1920 ? 6.5 : vw >= 901 ? 5.4 : vw >= 641 ? 4.0 : 2.6;
  const backdropMaxH = Math.min(vh * 0.82, 960);
  const backdropVPad = 2 * Math.min(2.2 * PX_PER_REM, Math.max(PX_PER_REM, vh * 0.024));
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

  const fittingRem  = fontSizeThatFits * 0.95;
  const rawFloor    = vw >= 2400 ? 2.0 : vw >= 1920 ? 1.75 : vw >= 901 ? 1.45 : vw >= 641 ? 1.05 : 0.82;
  const computedRem = Math.min(maxCap, Math.max(Math.min(rawFloor, fittingRem), fittingRem));
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

      {/* ── Background layers for crossfade ──────────────────────────────────
          .client-bg-prev fades out, .client-bg-current fades in.
          Both sit at z-index 0 behind vignette overlays (::before/::after).  */}
      <div
        className="client-bg-current"
        style={{ backgroundImage: bgUrl }}
        aria-hidden="true"
      />
      {bgFading && prevBgUrl && (
        <div
          className="client-bg-prev"
          style={{ backgroundImage: prevBgUrl }}
          aria-hidden="true"
        />
      )}

      {/* ── Idle state ───────────────────────────────────────────────────────
          Shown before any verse arrives from the presenter.
          Minimal and reverent: a thin cross + breathing accent line.        */}
      {isIdle && (
        <div className="client-idle-state" aria-live="polite" aria-label="Waiting for scripture">
          <div className="idle-cross" aria-hidden="true">
            <div className="idle-cross-v" />
            <div className="idle-cross-h" />
          </div>
          <div className="idle-line" aria-hidden="true" />
        </div>
      )}

      {/* ── Live verse ───────────────────────────────────────────────────────
          .verse-backdrop uses clip-path to match border-radius — prevents
          text rendering outside rounded corners at any zoom level.          */}
      {!isIdle && (
        <div className="verse-content">
          <div className="verse-backdrop">
            <p>{renderHighlightedText()}</p>
            {verse.book_title && verse.chapter_number && verse.verse_number && (
              <div key={labelKey} className="verse-caption">
                {verse.book_title}&ensp;{verse.chapter_number}:{verse.verse_number}
              </div>
            )}
            {hasMoreSegments && (
              <div className="cont-indicator">›</div>
            )}
          </div>
        </div>
      )}

      {/* ── Session watermark + connection indicator ──────────────────────────
          Normally: session code, 40% opacity, bottom-right corner.
          On disconnect/reconnect: amber dot pulses beside the code —
          visible to the operator without alarming the congregation.         */}
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