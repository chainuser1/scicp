import { useState, useEffect, useRef, useCallback } from 'react';

// ─── Font loading sentinel ────────────────────────────────────────────────────
const waitForFonts = () => {
  if (!document.fonts || !document.fonts.load) return Promise.resolve();
  return Promise.all([
    document.fonts.load('italic 1em "Cormorant Garamond"'),
    document.fonts.load('1em "Cinzel"'),
  ]).catch(() => {});
};

// ─── Module-level display constants ───────────────────────────────────────────
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

export default function MobileClient() {
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
  const [fontsReady, setFontsReady]           = useState(false);
  const [readabilityMode, setReadabilityMode] = useState('balanced');
  const [dyslexiaMode, setDyslexiaMode]       = useState(false);

  // F2 — Custom text / announcement mode
  const [customData, setCustomData] = useState(null);

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

  // ─── Bridge message handlers ──────────────────────────────────────────────
  // Instead of Socket.IO, listen for CustomEvents dispatched by the native bridge.
  // Event shape: { detail: { type: string, data: any } }
  useEffect(() => {
    const TEXT_FADE_MS = 400;

    const handleVerse = (data) => {
      setHighlightedText('');
      setCustomData(null);
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
      if (theme.background_url) crossfadeBackground(theme.background_url);
      // Theme change: just crossfade the background, keep text visible
      setVerse((v) => ({ ...v, theme }));
    };

    const handleHighlight = (text) => setHighlightedText(text || '');

    const handleClearScreen = () => {
      setCustomData(null);
      setTextVisible(false);
      setTimeout(() => {
        setDisplayVerse(null);
        setHighlightedText('');
        setIsIdle(true);
      }, TEXT_FADE_MS);
    };

    const handleCustomText = (data) => {
      if (data.theme) crossfadeBackground(data.theme.background_url || bgUrl);
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

    const onBridgeMessage = (event) => {
      const { type, data } = event.detail || {};
      switch (type) {
        case 'update-verse':
          handleVerse(data);
          break;
        case 'update-theme':
          handleTheme(data);
          break;
        case 'highlight-text':
          handleHighlight(data);
          break;
        case 'clear-screen':
          handleClearScreen();
          break;
        case 'custom-text':
          handleCustomText(data);
          break;
        case 'preload-background':
          handlePreloadBackground(data);
          break;
        default:
          break;
      }
    };

    window.addEventListener('bridge-message', onBridgeMessage);

    return () => {
      window.removeEventListener('bridge-message', onBridgeMessage);
      if (bgFadeTimer.current) clearTimeout(bgFadeTimer.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontsReady, crossfadeBackground]);

  // ─── Auto readability ─────────────────────────────────────────────────────
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
      const words   = displayText.trim().split(/\s+/).filter(Boolean);
      const avgWord = words.length ? words.join('').length / words.length : 0;
      setDyslexiaMode(viewport.w <= 1024 && (weightedPrimaryLength > 260 || avgWord >= 5.6));
      setAutoReducedMotion(prefersReducedMotion || viewport.w <= 640 || weightedPrimaryLength > 320);
    };
    tune();
    return () => { active = false; };
  }, [verse?.theme?.background_url, displayText, viewport.w, prefersReducedMotion]);

  // ─── Derived display props ────────────────────────────────────────────────
  const hasMoreSegments = !customData && verse.segments && verse.currentSegment < verse.segments.length - 1;
  const layout          = verse.theme?.layout || 'centered';
  const tone            = verse.theme?.tone === 'light' ? 'client-theme-light' : 'client-theme-dark';
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
  const hasCjkPrimary = containsCjk(displayText);
  const hasCjkSecondary = containsCjk(secondaryText);
  const hasCjk = hasCjkPrimary || hasCjkSecondary;
  const length = weightedLength(displayText);
  const secLength = weightedLength(secondaryText);

  const maxCap        = vw >= 2400 ? 7.5 : vw >= 1920 ? 6.5 : vw >= 901 ? 5.4 : vw >= 641 ? 4.0 : 2.6;
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
    let lo = 0.55, hi = maxCap;
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

  const fittingRem       = fontSizeThatFits * 0.95;
  const rawFloorBase     = vw >= 2400 ? 2.0 : vw >= 1920 ? 1.75 : vw >= 901 ? 1.45 : vw >= 641 ? 1.05 : 0.82;
  const rawFloor         = Math.max(0.72, rawFloorBase - (hasCjk ? 0.12 : 0));
  const computedRem      = Math.min(maxCap, Math.max(rawFloor, fittingRem));
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
          <p className="idle-waiting-text">Waiting for presenter...</p>
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
                </div>
              )}
              {/* F7 — segment dots replacing single indicator */}
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
    </div>
  );
}
