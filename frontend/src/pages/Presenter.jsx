import React, { useState, useEffect, useRef } from 'react';
import { socket, isRemoteMode } from '../socket';

const API_URL = import.meta.env.MODE === 'production' ? '' : 'http://localhost:3000';

const themes = {
  light: {
    background_url: "url('https://www.churchofjesuschrist.org/imgs/5a979a326ee432c192220903e9c48b5332409a34/full/1080%2C/0/default')",
    font_family: "'Cormorant Garamond', Georgia, serif",
    font_size: "4.1rem",
    layout: "centered",
    tone: "light"
  },
  dark: {
    background_url: "url('https://www.churchofjesuschrist.org/imgs/b1a19c15b0a1fd4b274d6e3decde033329db53f2/full/1080%2C/0/default')",
    font_family: "'Cormorant Garamond', Georgia, serif",
    font_size: "4.8rem",
    layout: "centered",
    tone: "dark"
  }
};

const BG_PRESETS = [
  { label: 'Auto',     url: null },
  { label: 'NT Dark',  url: 'https://www.churchofjesuschrist.org/imgs/b1a19c15b0a1fd4b274d6e3decde033329db53f2/full/1080%2C/0/default' },
  { label: 'NT Light', url: 'https://www.churchofjesuschrist.org/imgs/5a979a326ee432c192220903e9c48b5332409a34/full/1080%2C/0/default' },
  { label: 'OT Dark',  url: 'https://www.churchofjesuschrist.org/imgs/850c3faf9ed39b2193c9280a929f73469094982c/full/1080%2C/0/default' },
  { label: 'OT Light', url: 'https://www.churchofjesuschrist.org/imgs/91a96141d4471eac93f6d58e7d6db42cd6fd4192/full/1080%2C/0/default' },
  { label: 'BoM Dark', url: 'https://www.churchofjesuschrist.org/imgs/bc303ddc99f44c59f8c3b0743367f2180c9e91ef/full/1080%2C/0/default' },
  { label: 'D&C Dark', url: 'https://www.churchofjesuschrist.org/imgs/d424eaa659d3102b717c1825b0e48388d689a966/full/1080%2C/0/default' },
];

const FONT_FAMILIES = [
  { label: 'Cormorant Garamond (Sacred)',  value: "'Cormorant Garamond', Georgia, serif" },
  { label: 'Cinzel (Classic Roman)',        value: "'Cinzel', serif" },
  { label: 'EB Garamond (Traditional)',     value: "'EB Garamond', Georgia, serif" },
  { label: 'Palatino (Elegant)',            value: "Palatino Linotype, Palatino, Book Antiqua, serif" },
  { label: 'Georgia (Readable)',            value: "Georgia, serif" },
  { label: 'Times New Roman (Classic)',     value: "'Times New Roman', Times, serif" },
  { label: 'Arial (Clean Sans)',            value: "Arial, Helvetica, sans-serif" },
  { label: 'OpenDyslexic (Accessible)',     value: "OpenDyslexic, Arial, sans-serif" },
];

const VOLUME_THEME_BACKGROUNDS = {
  ot: {
    light: 'https://www.churchofjesuschrist.org/imgs/91a96141d4471eac93f6d58e7d6db42cd6fd4192/full/1080%2C/0/default',
    dark: 'https://www.churchofjesuschrist.org/imgs/850c3faf9ed39b2193c9280a929f73469094982c/full/1080%2C/0/default',
  },
  nt: {
    light: 'https://www.churchofjesuschrist.org/imgs/5a979a326ee432c192220903e9c48b5332409a34/full/1080%2C/0/default',
    dark: 'https://www.churchofjesuschrist.org/imgs/b1a19c15b0a1fd4b274d6e3decde033329db53f2/full/1080%2C/0/default',
  },
  bom: {
    light: 'https://www.churchofjesuschrist.org/imgs/c827eb43191d54ef97f880db05170ad2a31ad643/full/1080%2C/0/default',
    dark: 'https://www.churchofjesuschrist.org/imgs/bc303ddc99f44c59f8c3b0743367f2180c9e91ef/full/1080%2C/0/default',
  },
  dc: {
    light: 'https://www.churchofjesuschrist.org/imgs/d51970e2a6003156c90973409c0c94f44c0d9b64/full/1080%2C/0/default',
    dark: 'https://www.churchofjesuschrist.org/imgs/d424eaa659d3102b717c1825b0e48388d689a966/full/1080%2C/0/default',
  },
  pgp: {
    light: 'https://www.churchofjesuschrist.org/imgs/4b344419a83be3d625e222be5c77c4453b0e0184/full/1080%2C/0/default',
    dark: 'https://www.churchofjesuschrist.org/imgs/b4c6ca482db211efb2a5eeeeac1ea3e2eeb3cea8/full/1080%2C/0/default',
  },
};

// Per-volume visual tokens: highlight colour + font pairing
const VOLUME_THEME_TOKENS = {
  ot:  { dark: { highlight: '#e8c97a', font: "'EB Garamond', Georgia, serif" },
         light: { highlight: '#7a3a10', font: "'EB Garamond', Georgia, serif" } },
  nt:  { dark: { highlight: '#d4c5f9', font: "'Cormorant Garamond', Georgia, serif" },
         light: { highlight: '#4a3080', font: "'Cormorant Garamond', Georgia, serif" } },
  bom: { dark: { highlight: '#f0d080', font: "'Cinzel', serif" },
         light: { highlight: '#6b3a00', font: "'Cinzel', serif" } },
  dc:  { dark: { highlight: '#b8e0ff', font: "Georgia, serif" },
         light: { highlight: '#1a3a6b', font: "Georgia, serif" } },
  pgp: { dark: { highlight: '#c8f0c8', font: "'Cormorant Garamond', Georgia, serif" },
         light: { highlight: '#1a5a1a', font: "'Cormorant Garamond', Georgia, serif" } },
};

function resolveVolumeKey(verse) {
  const rawVolume = `${verse?.volume_short_title || ''} ${verse?.volume_title || ''}`.toLowerCase();
  if (/(^|\W)ot(\W|$)|old testament/.test(rawVolume)) return 'ot';
  if (/(^|\W)nt(\W|$)|new testament/.test(rawVolume)) return 'nt';
  if (/book of mormon|(^|\W)bom(\W|$)/.test(rawVolume)) return 'bom';
  if (/doctrine and covenants|church history|d&c|(^|\W)dc(\W|$)/.test(rawVolume)) return 'dc';
  if (/pearl of great price|(^|\W)pgp(\W|$)/.test(rawVolume)) return 'pgp';

  const book = String(verse?.book_title || '').toLowerCase();
  if (/(^|\W)[1-4]\s*nephi|jacob|enos|jarom|omni|words of mormon|mosiah|alma|helaman|mormon|ether|moroni/.test(book)) return 'bom';
  if (/doctrine and covenants|official declaration/.test(book)) return 'dc';
  if (/moses|abraham|joseph smith|articles of faith/.test(book)) return 'pgp';
  if (/matthew|mark|luke|john|acts|romans|corinthians|galatians|ephesians|philippians|colossians|thessalonians|timothy|titus|philemon|hebrews|james|peter|jude|revelation/.test(book)) return 'nt';
  if (/genesis|exodus|leviticus|numbers|deuteronomy|joshua|judges|ruth|samuel|kings|chronicles|ezra|nehemiah|esther|job|psalm|proverbs|ecclesiastes|song of solomon|isaiah|jeremiah|lamentations|ezekiel|daniel|hosea|joel|amos|obadiah|jonah|micah|nahum|habakkuk|zephaniah|haggai|zechariah|malachi/.test(book)) return 'ot';
  return null;
}

function themeForVerse(baseTheme, verse) {
  const volumeKey = resolveVolumeKey(verse);
  const tone = baseTheme?.tone === 'dark' ? 'dark' : 'light';
  const imageUrl = volumeKey ? VOLUME_THEME_BACKGROUNDS[volumeKey]?.[tone] : null;
  const tokens = volumeKey ? VOLUME_THEME_TOKENS[volumeKey]?.[tone] : null;

  // Only apply volume tokens if user hasn't overridden them from defaults
  const defaultFont = themes[tone]?.font_family;
  const shouldApplyFont = tokens && (!baseTheme?.font_family || baseTheme.font_family === defaultFont);
  const shouldApplyHighlight = tokens && !baseTheme?.highlight_color;

  return {
    ...baseTheme,
    ...(imageUrl ? { background_url: `url('${imageUrl}')` } : {}),
    ...(shouldApplyFont ? { font_family: tokens.font } : {}),
    ...(shouldApplyHighlight ? { highlight_color: tokens.highlight } : {}),
  };
}

/* ─── Emblem ─── */
const EmblemSVG = ({ size = 26 }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="4" y="20" width="24" height="8" rx="1.5" fill="#c9a84c" opacity="0.9"/>
    <path d="M6 20 Q16 4 26 20" stroke="#c9a84c" strokeWidth="1.8" strokeLinecap="round"/>
    <circle cx="16" cy="13" r="3.5" fill="#e8c97a"/>
    <rect x="12" y="16" width="8" height="6" rx="2" fill="#e8c97a"/>
    <line x1="9" y1="18" x2="4" y2="14" stroke="#e8c97a" strokeWidth="2.2" strokeLinecap="round"/>
    <line x1="23" y1="18" x2="28" y2="14" stroke="#e8c97a" strokeWidth="2.2" strokeLinecap="round"/>
    <circle cx="16" cy="13" r="1.2" fill="#0a0a0f"/>
  </svg>
);

/* ─── Icons ─── */
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);
const IconClock = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
  </svg>
);
const IconList = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
    <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
  </svg>
);
const IconBook = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
  </svg>
);
const IconClose = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconPalette = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/>
    <circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/>
    <circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>
    <circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/>
    <path d="M12 2C6.5 2 2 6.5 2 12a10 10 0 0 0 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z"/>
  </svg>
);
const IconChevronLeft = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);
const IconChevronRight = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6"/>
  </svg>
);
const IconSession = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 7V5a4 4 0 0 1 8 0v2"/>
    <rect x="5" y="7" width="14" height="12" rx="2"/>
    <circle cx="12" cy="13" r="1.3"/>
  </svg>
);
const IconInfo = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>
);

const IconBolt = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
  </svg>
);
const IconLink = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
  </svg>
);
const IconCheck = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"/>
  </svg>
);

const IconGlobe = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <line x1="2" y1="12" x2="22" y2="12"/>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
  </svg>
);

const IconMenu = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);

/* ─── Reusable components ─── */

const HdrBtn = ({ onClick, active, children, label, title }) => (
  <button
    className={`hdr-btn${active ? ' hdr-btn--active' : ''}`}
    onClick={onClick}
    aria-label={label}
    title={title || label}
  >
    {children}
  </button>
);

// SearchResults — results are already the correct page from the server.
// No client-side slicing. onPageChange(newPage) triggers a fresh socket request.
const SearchResults = ({ results, currentPage: _currentPage, totalPages: _totalPages, onSelect, onGoLive, onPageChange: _onPageChange, onAddToSetlist, stagedVerseId, onToggleTranslation, expandedTranslations, translationCache, currentLanguage: srLang, sentinelRef }) => {
  if (results.length === 0) return null;

  return (
    <>
      <ul className="results-ul">
        {results.map(verse => (
          <li
            key={verse.verse_id}
            className={`result-item${Number(verse.verse_id) === Number(stagedVerseId) ? ' result-item--staged' : ''}`}
            onClick={() => onSelect(verse)}
            onDoubleClick={() => onGoLive(verse)}
          >
            <div className="result-item-top">
              <span className="result-title">{verse.book_title} {verse.chapter_number}:{verse.verse_number}</span>
              <div className="result-item-btns">
                {onToggleTranslation && (
                  <button className="result-translation-toggle"
                    onClick={e => { e.stopPropagation(); onToggleTranslation(verse.verse_id); }}
                    title="Preview in another language">
                    {srLang === 'en' ? 'TL' : srLang === 'tl' ? 'CEB' : 'EN'}
                  </button>
                )}
                <button className="result-add-icon" onClick={e => { e.stopPropagation(); onAddToSetlist(verse); }} aria-label="Add to setlist" title="Add to setlist">+</button>
                <button className="result-live-icon" onClick={e => { e.stopPropagation(); onGoLive(verse); }} aria-label="Go live" title="Go live">●</button>
              </div>
            </div>
            <div className="result-text">{verse.scripture_text}</div>
            {expandedTranslations?.has(verse.verse_id) && (
              <div className="result-translation-snippet">
                {(() => {
                  const tl = srLang === 'en' ? 'tl' : srLang === 'tl' ? 'ceb' : 'en';
                  return translationCache?.[`${verse.verse_id}_${tl}`] || 'Loading…';
                })()}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div ref={sentinelRef} data-sentinel="search" style={{ height: 1 }} />
    </>
  );
};

/* ─── Quick-topic chips shown in the idle state ─── */
const QUICK_TOPICS = [
  'faith', 'atonement', 'prayer', 'hope', 'charity',
  'repentance', 'grace', 'service', 'covenant', 'eternal life',
  'holy ghost', 'resurrection', 'obedience', 'trials', 'gratitude',
];

const BIBLE_CITATIONS = { en: 'KJV', nrsvue: 'NRSVUE', tl: 'Ang Biblia', ceb: 'Ang Biblia', ilo: 'RIPV', es: 'RVR', el: 'Greek Bible', ja: '口語訳', war: 'Samarenyo Bible' };
const TRIPLE_CITATIONS = { 3: 'Book of Mormon', 4: 'D&C', 5: 'Pearl of Great Price' };
const LANGUAGE_NAMES   = { en: 'English', nrsvue: 'English', tl: 'Tagalog', ceb: 'Cebuano', ilo: 'Ilocano', es: 'Spanish', el: 'Greek', ja: 'Japanese', war: 'Waray' };
function getCitation(language, volumeId, secondaryLanguage) {
  const vid = Number(volumeId);
  if (secondaryLanguage) {
    if (vid >= 3) {
      const p = LANGUAGE_NAMES[language] || 'English';
      const s = LANGUAGE_NAMES[secondaryLanguage] || secondaryLanguage;
      return `${p} vs ${s}`;
    }
    const p = BIBLE_CITATIONS[language] || (language ? language.toUpperCase() : '');
    const s = BIBLE_CITATIONS[secondaryLanguage] || secondaryLanguage.toUpperCase();
    return `${p} vs ${s}`;
  }
  if (vid >= 3) {
    const book = TRIPLE_CITATIONS[vid] || '';
    const lang = LANGUAGE_NAMES[language] || 'English';
    return book ? `${book}, ${lang}` : '';
  }
  return BIBLE_CITATIONS[language] || (language ? language.toUpperCase() : '');
}

const IconQr = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
    <rect x="3" y="14" width="7" height="7" rx="1"/>
    <path d="M14 14h2v2h-2z"/><path d="M18 14h3"/><path d="M14 18h2"/><path d="M18 18h3"/><path d="M20 20v1"/>
  </svg>
);

// Uses the device camera + jsQR (npm) to decode a QR code from the TV screen.
// Falls back gracefully if camera permission is denied or jsQR is not installed.
const QrScannerModal = ({ onCode, onClose }) => {
  const videoRef   = React.useRef(null);
  const canvasRef  = React.useRef(null);
  const rafRef     = React.useRef(null);
  const streamRef  = React.useRef(null);
  const [error, setError]   = React.useState('');
  const [status, setStatus] = React.useState('Starting camera…');

  React.useEffect(() => {
    let active = true;

    const stop = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };

    const scan = async () => {
      // Dynamically import jsQR — add "jsqr": "^1.4.0" to frontend/package.json
      let jsQR;
      try {
        const mod = await import('jsqr');
        jsQR = mod.default || mod;
      } catch {
        if (active) setError('QR scanner not available. Install jsqr: npm install jsqr');
        return;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch {
        if (active) setError('Camera access denied. Please allow camera permission and try again.');
        return;
      }

      if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        setStatus('Point at the QR code on the TV…');
      }

      const tick = () => {
        if (!active) return;
        const video  = videoRef.current;
        const canvas = canvasRef.current;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0);
          const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            // Extract session code from full URL or accept bare code
            const match = code.data.match(/[?&]session=([A-Z0-9]{4,24})/i);
            const extracted = match ? match[1].toUpperCase() : code.data.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
            if (extracted.length >= 4) {
              stop();
              if (active) onCode(extracted);
              return;
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    scan();
    return () => { active = false; stop(); };
  }, [onCode]);

  return (
    <div className="qr-scanner-backdrop" onClick={onClose}>
      <div className="qr-scanner-modal" onClick={e => e.stopPropagation()}>
        <div className="qr-scanner-header">
          <span className="qr-scanner-title">Scan TV QR Code</span>
          <button className="qr-scanner-close" onClick={onClose} aria-label="Close scanner">✕</button>
        </div>

        <div className="qr-scanner-viewport">
          {error ? (
            <div className="qr-scanner-error">{error}</div>
          ) : (
            <>
              <video ref={videoRef} className="qr-scanner-video" playsInline muted />
              <canvas ref={canvasRef} className="qr-scanner-canvas" />
              {/* Targeting reticle */}
              <div className="qr-scanner-reticle" aria-hidden="true">
                <span /><span /><span /><span />
              </div>
            </>
          )}
        </div>

        <div className="qr-scanner-status">{error || status}</div>
      </div>
    </div>
  );
};

/* ─── Main component ─── */
const Presenter = () => {
  // True when running inside the Electron desktop app; false in the web app.
  const isElectronApp = !!window.electronAPI?.isElectron;

  const PRESENTER_TOUR_KEY = 'scicp.presenter_tour_seen_v2';
  const PRESENTER_LAST_SESSION_KEY = 'scicp.presenter_last_session_v1';
  const PRESENTER_TOKEN_KEY        = 'scicp.presenter_token_v1';
  const normalizeSessionId = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
  // Support scanning the Client's QR code: ?session=XXXX in the Presenter URL
  const urlSessionParam = (() => {
    try { return new URLSearchParams(window.location.search).get('session') || ''; } catch { return ''; }
  })();
  const presenterTourSteps = [
    ...(!isElectronApp ? [{
      target: 'session',
      title: 'Connect to TV',
      description: 'Scan the QR code on the TV screen, or type the session code shown below it. Multiple devices can join the same session.',
    }] : []),
    {
      target: 'search',
      title: 'Search Scriptures',
      description: 'Search by reference (e.g. "John 3:16"), keyword, phrase, or topic. Results cover all five volumes — Old Testament, New Testament, Book of Mormon, D&C, and Pearl of Great Price.',
    },
    {
      target: 'golive',
      title: 'Stage & Go Live',
      description: 'Click a result to stage it for review, then press ● Go Live to send it to the display. Double-click any result to go live instantly.',
    },
    {
      target: 'nav',
      title: 'Navigate While Live',
      description: 'Use ‹ › for previous/next verse and ‹‹ ›› to step through long-verse segments — without leaving the live view.',
    },
    {
      target: 'search',
      title: 'Setlists',
      description: 'Open the Browse tab and tap + to add verses to your setlist. Save it by name and reload it any Sunday. Reorder or remove entries anytime.',
    },
    {
      target: 'search',
      title: 'Dual Language',
      description: 'Tap the language button (🌐) to pick a secondary language. Both texts appear side-by-side on the display — great for multilingual congregations.',
    },
    {
      target: 'search',
      title: 'Chapter Context  ✨ New',
      description: 'While a verse is live, tap 📖 Chapter to open context — chapter summary, people & places mentioned, related verses by topic, and speaker attribution.',
    },
    {
      target: 'search',
      title: 'Chapter Summaries  ✨ New',
      description: '882 chapters now have rich summaries from GospelDoctrine.com with doctrinal insights and quotes from Church leaders — covering all five volumes of scripture.',
    },
  ];
  const [query, setQuery]                   = useState('');
  const [results, setResults]               = useState([]);
  const [totalResults, setTotalResults]     = useState(0);
  const [currentTheme, setCurrentTheme]     = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('scicp.display_prefs_v1'));
      if (saved?.theme) return saved.theme;
    } catch { /* ignore */ }
    try { if (window.matchMedia('(prefers-color-scheme: light)').matches) return themes.light; } catch { /* ignore */ }
    return themes.dark;
  });
  const [presenterUiMode, setPresenterUiMode] = useState(() => {
    try { return localStorage.getItem('scicp.presenter_ui_mode') || 'dark'; } catch { return 'dark'; }
  });
  const PRESENTER_HISTORY_KEY = 'scicp.presenter_history_v1';
  const [history, setHistory] = useState(() => {
    try {
      const raw = window.localStorage.getItem('scicp.presenter_history_v1');
      if (raw) return JSON.parse(raw).slice(0, 20);
    } catch { /* ignore */ }
    return [];
  });
  const [staged, setStaged]                 = useState(null);
  const [liveVerse, setLiveVerse]           = useState(null);
  const [bgUrlInput, setBgUrlInput]         = useState('');
  const [currentSegment, setCurrentSegment] = useState(0);
  const [highlightedText, setHighlightedText] = useState('');
  const [currentLanguage, setCurrentLanguage] = useState('en');
  const [currentPage, setCurrentPage]       = useState(0);
  const searchAppendRef = useRef(false);
  const searchSentinelRef = useRef(null);
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [drawerTab, setDrawerTab]           = useState('search');

  const [themePopover, setThemePopover]     = useState(false);
  const [langPopover,  setLangPopover]      = useState(false);
  const [kbdHelpOpen,  setKbdHelpOpen]      = useState(false);
  const [sessionPopover, setSessionPopover] = useState(false);
  const [sessionId, setSessionId]           = useState('');
  const [sessionLabel, setSessionLabel]     = useState('');
  const [sessionLabelInput, setSessionLabelInput] = useState('');
  const [tvSessionInput, setTvSessionInput] = useState('');
  const [scannerOpen, setScannerOpen]       = useState(false);
  const [sessionMessage, setSessionMessage] = useState('Creating session...');
  const [connectionState, setConnectionState] = useState('connecting');
  const [queuedCount, setQueuedCount]       = useState(0);
  const [viewerCount, setViewerCount]       = useState(0);
  const [takeoverAlert, setTakeoverAlert]   = useState(false);
  // show persistent banner when this device was evicted by a new presenter
  const [evictedAlert, setEvictedAlert]     = useState(false);
  // confirmation dialog before leaving — prevents accidental mid-sermon tap
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);

  const [sessionPinActive, setSessionPinActive]     = useState(false);
  // PIN entry modal — shown when joining a PIN-protected session
  const [pinEntryOpen, setPinEntryOpen]             = useState(false);
  const [pinInput, setPinInput]                     = useState('');
  const [pinError, setPinError]                     = useState('');
  const [pendingPinSession, setPendingPinSession]   = useState('');
  // PIN management modal — accessible from the session popover
  const [pinManageOpen, setPinManageOpen]           = useState(false);
  const [pinManageInput, setPinManageInput]         = useState('');
  const [pinManageConfirm, setPinManageConfirm]     = useState('');
  const [pinManageError, setPinManageError]         = useState('');
  const [contextOpen,    setContextOpen]    = useState(false);
  const [contextTab,     setContextTab]     = useState('chapter');
  const [chapterVerses,  setChapterVerses]  = useState([]);
  const [relatedVerses,  setRelatedVerses]  = useState([]);
  const [relatedConcept, setRelatedConcept] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [relatedTotal,   setRelatedTotal]   = useState(0);    // server-reported total count
  const [relatedBatchPage, setRelatedBatchPage] = useState(0); // server page (0-based)
  // Topic navigation history inside the Related tab: [{label, verses, concept, total, page, pageSize, type, payload}]
  const [ctxTopicHistory,    setCtxTopicHistory]    = useState([]);
  const [ctxTopicHistoryIdx, setCtxTopicHistoryIdx] = useState(-1);
  const ctxTopicHistoryIdxRef = useRef(-1);
  useEffect(() => { ctxTopicHistoryIdxRef.current = ctxTopicHistoryIdx; }, [ctxTopicHistoryIdx]);
  // Floating word-explore chip: { word, x, y } | null
  const [ctxWordChip, setCtxWordChip] = useState(null);
  const [verseTags,       setVerseTags]       = useState({ pov: null, speaker: null, labels: [] });
  const [entitySearch,    setEntitySearch]    = useState(null);
  const [topicResults,    setTopicResults]    = useState(null);
  const topicResultsRef = useRef(null);
  const [summaryTopicResults, setSummaryTopicResults] = useState(null);
  const summaryTopicResultsRef = useRef(null);
  const [summaryTopicPage, setSummaryTopicPage] = useState(0);
  const [scholarExpanded, setScholarExpanded] = useState({ nabre: false, net: false });
  const [chapterEntities, setChapterEntities] = useState({ people: [], places: [], ready: false });
  const [chapterSummary,  setChapterSummary]  = useState({ summary_text: null, summary_method: null, key_verses: [], top_topics: [], nabre_footnotes: null, net_footnotes: null, ready: false });
  const [verseSummary,    setVerseSummary]    = useState({ summary: null, cross_references: [], ready: false });
  const [bookChapters,   setBookChapters]   = useState([]);
  const [ctxChapterIdx,  setCtxChapterIdx]  = useState(0);
  const [ctxScrolled,    setCtxScrolled]    = useState(false);
  const [ctxAtBottom,    setCtxAtBottom]    = useState(false);
  const [nowReading,     setNowReading]     = useState(false); // "Now Reading" TV label toggle
  const ctxBodyRef     = useRef(null);
  const ctxUserScrolled = useRef(false);   // true when user manually scrolls in chapter tab
  const ctxLastScrolledVerse = useRef(null); // last verse_id we auto-scrolled to
  const ctxTabScrollPos = useRef({});      // saved scrollTop per tab name
  const ctxTouchStartX = useRef(null);
  const ctxTouchStartY = useRef(null);
  const chapterNeedsRefetchRef = useRef(false); // set true when chapter changes so openContextModal force-refetches
  const [ctxSlideDir,  setCtxSlideDir]  = useState(null); // 'prev' | 'next' | null
  const RELATED_PAGE_SIZE = 8; // server page size
  const [verseOfDay, setVerseOfDay]         = useState(null);
  const [votdError, setVotdError]           = useState(false);
  const [votdCopied, setVotdCopied]         = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen]   = useState(false);
  const [tourOpen, setTourOpen]             = useState(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const forceTour = urlParams.get('tour') === '1';
      const hasSeenTour = window.localStorage.getItem(PRESENTER_TOUR_KEY) === 'true';
      return forceTour || !hasSeenTour;
    } catch {
      return true;
    }
  });
  const [tourStep, setTourStep]             = useState(0);

  const [setlist, setSetlist]                   = useState(() => {
    try {
      const raw = window.localStorage.getItem('scicp.presenter_setlist_v1');
      if (raw) return JSON.parse(raw);
    } catch { /* ignore */ }
    return [];
  });

  const [browseLevel, setBrowseLevel]                     = useState('books');
  const [browseBooks, setBrowseBooks]                     = useState([]);
  const [browseChapters, setBrowseChapters]               = useState([]);
  const [browseVerses, setBrowseVerses]                   = useState([]);
  const [browseSelectedBook, setBrowseSelectedBook]       = useState(null);
  const [browseSelectedChapter, setBrowseSelectedChapter] = useState(null);
  const [browseBooksLoaded, setBrowseBooksLoaded]         = useState(false);

  const [customText, setCustomText]       = useState('');
  const [customSubtext, setCustomSubtext] = useState('');
  const [isCustomLive, setIsCustomLive]   = useState(false);

  const [savedSetlists, setSavedSetlists]     = useState([]);
  const [setlistSaveOpen, setSetlistSaveOpen] = useState(false);
  const [setlistSaveName, setSetlistSaveName] = useState('');
  const [setlistLoadOpen, setSetlistLoadOpen] = useState(false);
  const [setlistsLoading, setSetlistsLoading] = useState(false);

  const [expandedTranslations, setExpandedTranslations] = useState(() => new Set());
  const [translationCache, setTranslationCache]         = useState({});

  const [verseNotes, setVerseNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('scicp.verse_notes_v1')) || {}; } catch { return {}; }
  });
  const [notesExpandedFor, setNotesExpandedFor] = useState(() => new Set());

  const [secondaryLanguage, setSecondaryLanguage] = useState(() => {
    try { return localStorage.getItem('scicp.secondary_language_v1') || ''; } catch { return ''; }
  });

  const [runsheetAddingText, setRunsheetAddingText]     = useState(false);
  const [runsheetTextDraft, setRunsheetTextDraft]       = useState('');
  const [runsheetSubtextDraft, setRunsheetSubtextDraft] = useState('');

  useEffect(() => {
    try { window.localStorage.setItem('scicp.presenter_setlist_v1', JSON.stringify(setlist)); }
    catch { /* ignore */ }
  }, [setlist]);

  useEffect(() => {
    try { localStorage.setItem('scicp.verse_notes_v1', JSON.stringify(verseNotes)); } catch { /* ignore */ }
  }, [verseNotes]);

  useEffect(() => {
    try { localStorage.setItem('scicp.secondary_language_v1', secondaryLanguage); } catch { /* ignore */ }
  }, [secondaryLanguage]);

  // Restore state after Electron mode-switch reload
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get('restored') !== '1') return;
      const raw = sessionStorage.getItem('scicp.mode_switch_state');
      if (!raw) return;
      sessionStorage.removeItem('scicp.mode_switch_state');
      const s = JSON.parse(raw);
      if (s.liveVerse)     setLiveVerse(s.liveVerse);
      if (s.staged)        setStaged(s.staged);
      if (s.currentTheme)  setCurrentTheme(s.currentTheme);
      if (s.currentLanguage) setCurrentLanguage(s.currentLanguage);
      if (s.secondaryLanguage) setSecondaryLanguage(s.secondaryLanguage);
      if (Array.isArray(s.history) && s.history.length) setHistory(s.history);
      if (Array.isArray(s.setlist) && s.setlist.length) setSetlist(s.setlist);
    } catch { /* ignore parse errors */ }
  }, []);

  // Watch OS theme changes at runtime and sync if user hasn't customized the theme
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onOsThemeChange = (e) => {
      setCurrentTheme(prev => {
        // Only auto-switch if current theme is still a default (not user-customized)
        const isDefaultDark = prev === themes.dark || (prev?.tone === 'dark' && !prev?.highlight_color && !prev?.font_family?.includes('Cinzel'));
        const isDefaultLight = prev === themes.light || (prev?.tone === 'light' && !prev?.highlight_color);
        if (e.matches && isDefaultDark) return themes.light;
        if (!e.matches && isDefaultLight) return themes.dark;
        return prev;
      });
    };
    media.addEventListener('change', onOsThemeChange);
    return () => media.removeEventListener('change', onOsThemeChange);
  }, []);

  // Fetch doctrine tags and verse summary for the live verse
  useEffect(() => {
    if (!liveVerse?.verse_id) {
      setVerseTags({ pov: null, speaker: null, labels: [] });
      return;
    }
    let cancelled = false;
    Promise.all([
      fetch(`${API_URL}/verse/${liveVerse.verse_id}/tags`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${API_URL}/verse/${liveVerse.verse_id}/summary`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([tags, vsum]) => {
      if (cancelled) return;
      if (tags) setVerseTags({ pov: tags.pov || null, speaker: tags.speaker || null, labels: tags.labels || [] });
      if (vsum) setVerseSummary(vsum); else setVerseSummary({ summary: null, cross_references: [], ready: false });
    });
    return () => { cancelled = true; };
  }, [liveVerse?.verse_id]);

  // Reset chapter-level modal data only when the CHAPTER changes (not on every verse)
  useEffect(() => {
    setChapterEntities({ people: [], places: [], ready: false });
    setChapterSummary({ summary_text: null, summary_method: null, key_verses: [], top_topics: [], nabre_footnotes: null, net_footnotes: null, ready: false });
    setVerseSummary({ summary: null, cross_references: [], ready: false });
    setChapterVerses([]);
    setScholarExpanded({ nabre: false, net: false });
    chapterNeedsRefetchRef.current = true; // signal openContextModal to force-refetch
    // Eagerly fetch chapter entities for the preview card
    if (liveVerse?.chapter_id) {
      fetch(`${API_URL}/chapter/${liveVerse.chapter_id}/entities`)
        .then(r => r.ok ? r.json() : null)
        .then(d => d && setChapterEntities(d))
        .catch(() => {});
    }
  }, [liveVerse?.chapter_id]);

  // Re-fetch chapter modal data when chapter changes and modal is already open
  useEffect(() => {
    if (!liveVerse?.chapter_id || !contextOpen) return;
    if (contextTab === 'chapter' || contextTab === 'summary' || contextTab === 'entities') {
      openContextModal('chapter');
    }
  }, [liveVerse?.chapter_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setBrowseBooksLoaded(false); setBrowseLevel('books'); }, [currentLanguage]);

  useEffect(() => {
    if (drawerTab === 'browse' && !browseBooksLoaded) {
      fetch(`${API_URL}/browse/books?language=${currentLanguage}`)
        .then(r => r.ok ? r.json() : [])
        .then(data => { setBrowseBooks(data); setBrowseBooksLoaded(true); })
        .catch(() => {});
    }
  }, [drawerTab, browseBooksLoaded, currentLanguage]);

  const addToSetlist = (verse) => {
    setSetlist(prev => {
      if (prev.some(v => v.verse_id != null && v.verse_id === verse.verse_id)) return prev; // no duplicates
      const updated = [...prev, { ...verse, theme: themeForVerse(currentTheme, verse) }];
      showToast(`Added to setlist`);
      return updated;
    });
  };

  const removeFromSetlist = (itemKey) => {
    setSetlist(prev => prev.filter(v => (v.verse_id ?? v.id) !== itemKey));
  };

  const moveSetlistItem = (fromIdx, toIdx) => {
    if (toIdx < 0 || toIdx >= setlist.length) return;
    setSetlist(prev => {
      const arr = [...prev];
      const [item] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, item);
      return arr;
    });
  };

  const goLiveFromSetlist = (item) => {
    if (item.type === 'text') {
      emitWithSession('go-custom', { text: item.customText, subtext: item.customSubtext, theme: currentTheme });
      setIsCustomLive(true);
      showToast('Announcement sent to screen');
    } else {
      goLiveDirectly(item);
    }
  };

  // Persist presenter history to localStorage so it survives page refresh
  useEffect(() => {
    try { window.localStorage.setItem(PRESENTER_HISTORY_KEY, JSON.stringify(history)); }
    catch { /* storage full or unavailable */ }
  }, [history]);
  const [toastMsg, setToastMsg]               = useState('');
  const toastTimer                             = React.useRef(null);
  const clearArmTimer                          = React.useRef(null);
  const [clearArmed, setClearArmed]           = useState(false);
  const [themeCardOpen, setThemeCardOpen]     = useState(() => window.innerWidth > 768);
  const [fontSizeRem, setFontSizeRem]         = useState(() => { try { const s = JSON.parse(localStorage.getItem('scicp.display_prefs_v1')); return s?.fontSizeRem ?? 4.1; } catch { return 4.1; } });
  const [uiFontSize, setUiFontSize]           = useState(() => { try { const s = JSON.parse(localStorage.getItem('scicp.display_prefs_v1')); return s?.uiFontSize ?? 1.0; } catch { return 1.0; } });
  const [autoAdvance, setAutoAdvance]         = useState(false);
  const [autoAdvanceSec, setAutoAdvanceSec]   = useState(5);
  const autoAdvanceTimer                       = useRef(null);
  const [electronDisplayCount, setElectronDisplayCount] = useState(0);
  const [updateProgress, setUpdateProgress]   = useState(null);  // null | { percent, status }
  const mainPanelRef    = useRef(null);
  const searchDebounce  = useRef(null); // debounce timer for search socket emits
  const adjacentAbortRef = useRef(null); // cancels in-flight fetchAdjacent when a newer one fires
  const resultsListRef  = useRef(null);
  const [resultsScrolled, setResultsScrolled] = useState(false);

  // Persist display preferences — must be after fontSizeRem/uiFontSize declarations
  useEffect(() => {
    try {
      localStorage.setItem('scicp.display_prefs_v1', JSON.stringify({ theme: currentTheme, fontSizeRem, uiFontSize }));
    } catch { /* ignore */ }
  }, [currentTheme, fontSizeRem, uiFontSize]);

  // Show the sticky Go Live bar whenever a verse is staged and we're on mobile
  // No scroll logic needed — the bar simply mirrors the `staged` state on small screens
  const PAGE_SIZE = 8; // 8 results/batch on desktop — glide navigation
  const emitWithSession = (event, payload = {}) => socket.emit(event, { ...payload, sessionId });

  const showToast = (msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  };

  const endLive = () => {
    if (!clearArmed) {
      setClearArmed(true);
      showToast('Press again to clear screen');
      clearTimeout(clearArmTimer.current);
      clearArmTimer.current = setTimeout(() => setClearArmed(false), 2500);
      return;
    }
    clearTimeout(clearArmTimer.current);
    setClearArmed(false);
    emitWithSession('clear-screen');
    setLiveVerse(null);
    setHighlightedText('');
    setCurrentSegment(0);
    setIsCustomLive(false);
    showToast('Screen cleared — TV showing QR code');
  };

  const clearHighlight = () => {
    setHighlightedText('');
    emitWithSession('highlight-text', { text: '' });
  };

  const adjustFontSize = (delta) => {
    setFontSizeRem(prev => {
      const next = Math.min(7, Math.max(2, parseFloat((prev + delta).toFixed(1))));
      const updatedTheme = { ...currentTheme, font_size: next + 'rem' };
      handleThemeChange(updatedTheme);
      return next;
    });
  };

  const adjustUiFontSize = (delta) => {
    setUiFontSize(prev => Math.min(2.2, Math.max(0.75, parseFloat((prev + delta).toFixed(2)))));
  };

  const copyVerseText = (verseObj, label = '') => {
    if (!verseObj) return;
    const text = `${verseObj.book_title} ${verseObj.chapter_number}:${verseObj.verse_number}\n"${verseObj.scripture_text}"`;
    navigator.clipboard.writeText(text).then(() => {
      showToast(`✓ Copied${label ? ' ' + label : ''}`);
    }).catch(() => showToast('Copy failed — clipboard not available'));
  };
  const activeTourTarget = tourOpen ? presenterTourSteps[tourStep].target : '';

  useEffect(() => {
    document.title = 'Presenter | Scriptures in View';
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'noindex,nofollow');
    // Remove any canonical — this is an app screen, not a crawlable content page.
    document.querySelector('link[rel="canonical"]')?.remove();
  }, []);

  useEffect(() => {
    if (window.electronAPI?.getDisplays) {
      window.electronAPI.getDisplays().then(d => setElectronDisplayCount(d.length));
    }
    if (window.electronAPI?.onUpdateStatus) {
      window.electronAPI.onUpdateStatus((data) => {
        if (data.status === 'available') setUpdateProgress({ percent: 0, status: 'available', version: data.version });
        if (data.status === 'downloaded') setUpdateProgress(prev => ({ ...prev, percent: 100, status: 'downloaded' }));
      });
    }
    if (window.electronAPI?.onUpdateDownloadProgress) {
      window.electronAPI.onUpdateDownloadProgress((data) => {
        setUpdateProgress(prev => ({ ...prev, percent: data.percent, status: 'downloading' }));
      });
    }
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/verse/of-the-day`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        if (data && data.verse_id) setVerseOfDay(data);
        else setVotdError(true);
      })
      .catch(err => {
        console.error('[Presenter] verse-of-the-day fetch failed:', err);
        setVotdError(true);
      });
  }, []);

  // Presenter types or scans the code shown on the TV/projector screen.
  const joinTvSession = (codeOverride, pin) => {
    const normalized = normalizeSessionId(codeOverride || tvSessionInput);
    if (!normalized) {
      setSessionMessage('Enter the code shown on the TV screen');
      return;
    }
    setSessionMessage('Connecting…');
    const savedToken = (() => { try { return window.sessionStorage.getItem(PRESENTER_TOKEN_KEY) || ''; } catch { return ''; } })();
    const payload = { sessionId: normalized, role: 'presenter', presenterToken: savedToken };
    if (pin) payload.pin = pin;
    if (sessionLabelInput.trim()) payload.label = sessionLabelInput.trim();
    socket.emit('join-session', payload, (response) => {
      if (response?.requiresPin) {
        setPendingPinSession(normalized);
        setPinInput('');
        setPinError('');
        setPinEntryOpen(true);
        setSessionMessage('PIN required');
        return;
      }
      if (response?.pinIncorrect) {
        setPinError('Incorrect PIN — try again');
        return;
      }
      if (response?.ok && response.sessionId) {
        setPinEntryOpen(false);
        setPinInput('');
        setPendingPinSession('');
        setSessionPinActive(!!response.pinSet);
        setSessionId(response.sessionId);
        if (response.label !== undefined) setSessionLabel(response.label || '');
        setSessionLabelInput('');
        setTvSessionInput('');
        setSessionMessage(`Connected — session ${response.sessionId}`);
        setSessionPopover(false);
        setMobileMenuOpen(false);
        try {
          window.sessionStorage.setItem(PRESENTER_LAST_SESSION_KEY, response.sessionId);
          if (response.presenterToken) window.sessionStorage.setItem(PRESENTER_TOKEN_KEY, response.presenterToken);
        } catch { /* storage unavailable */ }
      } else if (response?.error === 'presenter-locked-out') {
        setSessionMessage('This session has an active presenter. You can join once they end the service.');
      } else {
        setSessionMessage(response?.message || 'TV session not found — check the code');
      }
    });
  };

  // Called by QrScannerModal when a valid code is decoded from the camera feed
  const handleScannedCode = (code) => {
    setScannerOpen(false);
    joinTvSession(normalizeSessionId(code));
  };

  const leaveSession = () => {
    socket.emit('leave-session', {}, (response) => {
      if (response?.ok) {
        setSessionId('');
        setTvSessionInput('');
        setSessionMessage('You left the session');
        try {
          window.sessionStorage.removeItem(PRESENTER_LAST_SESSION_KEY);
          window.sessionStorage.removeItem(PRESENTER_TOKEN_KEY);
        } catch { /* ignore */ }
      } else {
        setSessionMessage(response?.message || 'Unable to leave session');
      }
    });
  };

  const handleSetPin = () => {
    if (!/^\d{4,8}$/.test(pinManageInput)) { setPinManageError('PIN must be 4–8 digits'); return; }
    if (pinManageInput !== pinManageConfirm) { setPinManageError('PINs do not match'); return; }
    socket.emit('set-session-pin', { sessionId, pin: pinManageInput }, (res) => {
      if (res?.ok) {
        setSessionPinActive(true);
        setPinManageOpen(false);
        setPinManageInput('');
        setPinManageConfirm('');
        setPinManageError('');
      } else {
        setPinManageError(res?.message || 'Failed to set PIN');
      }
    });
  };

  const handleClearPin = () => {
    socket.emit('clear-session-pin', { sessionId }, (res) => {
      if (res?.ok) {
        setSessionPinActive(false);
        setPinManageOpen(false);
        setPinManageError('');
      } else {
        setPinManageError(res?.message || 'Failed to remove PIN');
      }
    });
  };

  const closeTour = () => {
    setTourOpen(false);
    try {
      window.localStorage.setItem(PRESENTER_TOUR_KEY, 'true');
    } catch { /* ignore */ }
  };

  const openTour = () => {
    setTourStep(0);
    setTourOpen(true);
  };

  /* ── Socket & data ── */
  useEffect(() => {
    const handleSessionJoined = (data) => {
      if (!data?.sessionId) return;
      setSessionId(data.sessionId);
      setTvSessionInput(data.sessionId);
      setSessionMessage(`Session ${data.sessionId} ready`);
      if (data.label !== undefined) setSessionLabel(data.label || '');
      if (data.pinSet !== undefined) setSessionPinActive(!!data.pinSet);
      setHighlightedText('');
      setSessionPopover(false);
    };
    const handleSessionError = (data) => {
      setSessionMessage(data?.message || 'Session error');
    };
    const handleSessionLeft = () => {
      setSessionId('');
      setTvSessionInput('');
      setSessionLabel('');
      setSessionLabelInput('');
      setSessionMessage('You left the session');
      try {
        window.sessionStorage.removeItem(PRESENTER_LAST_SESSION_KEY);
        window.sessionStorage.removeItem(PRESENTER_TOKEN_KEY);
      } catch { /* ignore */ }
    };
    const handleConnect = () => {
      setConnectionState('connected');
      // Priority 1: URL session param — phone scanned the TV QR, auto-join
      const urlParam = normalizeSessionId(urlSessionParam);
      if (urlParam) {
        joinTvSession(urlParam);
        return;
      }
      // Priority 2: rejoin last known session (e.g. after page refresh mid-service)
      const lastSession = (() => {
        try { return window.sessionStorage.getItem(PRESENTER_LAST_SESSION_KEY) || ''; } catch { return ''; }
      })();
      if (lastSession) {
        const savedToken = (() => { try { return window.sessionStorage.getItem(PRESENTER_TOKEN_KEY) || ''; } catch { return ''; } })();
        socket.emit('join-session', { sessionId: lastSession, role: 'presenter', presenterToken: savedToken }, (response) => {
          if (response?.ok && response.sessionId) {
            setSessionId(response.sessionId);
            if (response.presenterToken) {
              try { window.sessionStorage.setItem(PRESENTER_TOKEN_KEY, response.presenterToken); } catch { /* ignore */ }
            }
            // Flush queued events now that we've rejoined
            const flushed = socket.flushQueue?.() || 0;
            if (flushed > 0) {
              setSessionMessage(`Reconnected — ${flushed} action${flushed > 1 ? 's' : ''} delivered`);
            } else {
              setSessionMessage(`Reconnected — session ${response.sessionId}`);
            }
          } else {
            // Last session is gone — clear it and wait for the presenter to scan/type
            try {
              window.sessionStorage.removeItem(PRESENTER_LAST_SESSION_KEY);
              window.sessionStorage.removeItem(PRESENTER_TOKEN_KEY);
            } catch { /* ignore */ }
            setSessionMessage('Scan the QR code on the TV screen, or type the session code');
          }
        });
        return;
      }
      // No prior session — just wait for the presenter to scan or type
      setSessionMessage('Scan the QR code on the TV screen, or type the session code');
    };
    const handleDisconnect = () => {
      setConnectionState('disconnected');
      setSessionMessage('Disconnected — attempting to reconnect…');
    };
    const handleReconnectAttempt = () => {
      setConnectionState('reconnecting');
      setSessionMessage('Reconnecting…');
    };
    const handleConnectError = () => {
      setConnectionState('error');
    };
    const handleSearchResults = ({ results, total }) => {
      if (searchAppendRef.current) {
        setResults(prev => {
          const seen = new Set(prev.map(v => v.verse_id));
          return [...prev, ...(results ?? []).filter(v => !seen.has(v.verse_id))];
        });
      } else {
        setResults(results ?? []);
      }
      setTotalResults(total ?? 0);
      searchAppendRef.current = false;
    };
    const handleUpdateVerse = data => { setLiveVerse(data); setCurrentSegment(data.currentSegment || 0); };
    const handleThemeReceived = theme => {
      setCurrentTheme(theme);
      setStaged(prev => prev ? { ...prev, theme: themeForVerse(theme, prev) } : prev);
      if (theme?.font_size) {
        const parsed = parseFloat(theme.font_size);
        if (!isNaN(parsed)) setFontSizeRem(parsed);
      }
    };
    socket.on('search-results', handleSearchResults);
    socket.on('update-verse',   handleUpdateVerse);
    socket.on('update-theme',   handleThemeReceived);
    socket.on('session-created', handleSessionJoined);
    socket.on('session-joined', handleSessionJoined);
    socket.on('session-error', handleSessionError);
    socket.on('session-left', handleSessionLeft);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('reconnect_attempt', handleReconnectAttempt);
    socket.on('connect_error', handleConnectError);
    // Phase 1: viewer count — shows "N displays connected" in session health panel
    socket.on('viewer-count', ({ count }) => setViewerCount(count));
    // Phase 1: another device tried to steal the presenter role — alert without interrupting
    socket.on('presenter-takeover-attempt', () => {
      setTakeoverAlert(true);
      setTimeout(() => setTakeoverAlert(false), 6000);
    });
    // Eviction: a new presenter took over this idle slot — disable this device's controls
    socket.on('presenter-evicted', () => {
      setEvictedAlert(true);
      setSessionId('');
      try {
        window.sessionStorage.removeItem(PRESENTER_TOKEN_KEY);
        window.sessionStorage.removeItem(PRESENTER_LAST_SESSION_KEY);
      } catch { /* ignore */ }
    });
    if (socket.connected) {
      handleConnect();
    }
    // Subscribe to emit queue size changes
    const unsubQueue = socket.onQueueChange?.(count => setQueuedCount(count));
    return () => {
      socket.off('search-results', handleSearchResults);
      socket.off('update-verse',   handleUpdateVerse);
      socket.off('update-theme',   handleThemeReceived);
      socket.off('session-created', handleSessionJoined);
      socket.off('session-joined', handleSessionJoined);
      socket.off('session-error', handleSessionError);
      socket.off('session-left', handleSessionLeft);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('reconnect_attempt', handleReconnectAttempt);
      socket.off('connect_error', handleConnectError);
      socket.off('viewer-count');
      socket.off('presenter-takeover-attempt');
      socket.off('presenter-evicted');
      if (unsubQueue) unsubQueue();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSessionParam]);

  /* ── Close drawer, theme popover, session popover, and mobile menu on outside tap ── */
  useEffect(() => {
    if (!drawerOpen && !themePopover && !langPopover && !sessionPopover && !mobileMenuOpen) return;
    const handler = e => {
      if (!e.target.closest('.search-drawer') && !e.target.closest('.hdr-btn') && !e.target.closest('.hdr-theme-wrap'))
        setDrawerOpen(false);
      if (!e.target.closest('.hdr-theme-wrap'))
        setThemePopover(false);
      if (!e.target.closest('.hdr-lang-wrap'))
        setLangPopover(false);
      if (!e.target.closest('.hdr-session-wrap'))
        setSessionPopover(false);
      if (!e.target.closest('.hdr-mobile-menu') && !e.target.closest('.hdr-hamburger'))
        setMobileMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [drawerOpen, themePopover, langPopover, sessionPopover, mobileMenuOpen]);

  /* ── Handlers ── */
  const handleThemeChange = theme => {
    const nextTheme = {
      ...theme,
      force_animations: theme.force_animations ?? currentTheme.force_animations ?? false,
    };
    setCurrentTheme(nextTheme);
    if (staged) setStaged(prev => ({ ...prev, theme: themeForVerse(nextTheme, prev) }));
    emitWithSession('update-theme', { theme: nextTheme });
    // Keep fontSizeRem slider in sync when theme is changed externally
    if (nextTheme.font_size) {
      const parsed = parseFloat(nextTheme.font_size);
      if (!isNaN(parsed)) setFontSizeRem(parsed);
    }
  };

  const handleSearch = e => {
    const q = e.target.value;
    setQuery(q);
    setCurrentPage(0);
    setTotalResults(0);
    setResults([]);
    searchAppendRef.current = false;
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      emitWithSession('search', { query: q, page: 0, pageSize: PAGE_SIZE, language: currentLanguage });
    }, 250);
  };

  const handleSearchKeyDown = e => {
    if (e.key === 'Enter' && results.length > 0) goLiveDirectly(results[0]);
  };

  const selectVerse = verse => {
    const verseTheme = themeForVerse(currentTheme, verse);
    setStaged({ ...verse, theme: verseTheme });
    if (verseTheme?.background_url) {
      const match = String(verseTheme.background_url).match(/url\((['"]?)(.*?)\1\)/i);
      if (match?.[2]) emitWithSession('preload-background', { background_url: match[2] });
    }
    // Drawer stays open so presenter can keep browsing.
    // Go Live button / double-click / ● icon still sends live immediately.
  };

  const goLiveDirectly = verse => {
    const v = { ...verse, theme: themeForVerse(currentTheme, verse) };
    emitWithSession('go-live', { verse: v, theme: v.theme, language: currentLanguage, secondaryLanguage: secondaryLanguage || null });
    setLiveVerse(v);
    setCurrentSegment(0);
    setHistory(h => [{ ...v, _ts: Date.now() }, ...h.filter(e => e.verse_id !== v.verse_id).slice(0, 19)]);
    setDrawerOpen(false);
  };

  const goLive = () => {
    if (!staged) return;
    emitWithSession('go-live', { verse: staged, theme: staged.theme, language: currentLanguage, secondaryLanguage: secondaryLanguage || null });
    setLiveVerse(staged);
    setCurrentSegment(0);
    setNowReading(false); // reset Now Reading on new go-live
    setHistory(h => [{ ...staged, _ts: Date.now() }, ...h.filter(v => v.verse_id !== staged.verse_id).slice(0, 19)]);
    setStaged(null);
  };

  const toggleNowReading = () => {
    const next = !nowReading;
    setNowReading(next);
    emitWithSession('now-reading', { on: next, verse_id: liveVerse?.verse_id || null });
  };

  const navigateSegment = direction => {
    if (!liveVerse?.segments) return;
    const limit = liveVerse.segments.length - 1;
    const next = direction === 'next' ? Math.min(currentSegment + 1, limit) : Math.max(currentSegment - 1, 0);
    if (next !== currentSegment) {
      setCurrentSegment(next);
      emitWithSession('update-verse', { verse: { ...liveVerse, currentSegment: next } });
    }
  };

  const fetchAdjacent = async (direction, preferStaged = false) => {
    const source = preferStaged ? (staged || liveVerse) : liveVerse;
    if (!source?.verse_id) return;
    // Cancel any in-flight request so rapid navigation can't emit out-of-order go-live events
    if (adjacentAbortRef.current) adjacentAbortRef.current.abort();
    const controller = new AbortController();
    adjacentAbortRef.current = controller;
    const params = new URLSearchParams({
      verse_id: source.verse_id, direction,
      ...((['ceb', 'tl', 'es', 'el', 'ilo', 'ja', 'nrsvue', 'war'].includes(currentLanguage)) && { language: currentLanguage }),
      ...(source.book_id        != null && { book_id:        source.book_id }),
      ...(source.chapter_number != null && { chapter_number: source.chapter_number }),
      ...(source.verse_number   != null && { verse_number:   source.verse_number }),
    });
    try {
      const res = await fetch(`${API_URL}/verse/adjacent?${params}`, { signal: controller.signal });
      if (!res.ok) return;
      const data = await res.json();
      const v = { ...data, theme: themeForVerse(currentTheme, data) };
      if (preferStaged && staged) {
        setStaged(v);
      } else {
        emitWithSession('go-live', { verse: v, theme: v.theme, language: currentLanguage, secondaryLanguage: secondaryLanguage || null });
        setLiveVerse(v);
        setCurrentSegment(0);
        setHistory(h => [{ ...v, _ts: Date.now() }, ...h.filter(e => e.verse_id !== v.verse_id).slice(0, 19)]);
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error('adjacent fetch failed', err);
    }
  };

  // Reset context cache when the live verse changes
  useEffect(() => {
    setChapterVerses([]);
    setRelatedVerses([]);
    setRelatedConcept(null);
    setRelatedBatchPage(0);
    setRelatedTotal(0);
    setCtxTopicHistory([]);
    setCtxTopicHistoryIdx(-1);
    setBookChapters([]);
    setCtxChapterIdx(0);
    setCtxScrolled(false);
    setCtxAtBottom(false);
    ctxUserScrolled.current = false;
    ctxLastScrolledVerse.current = null;
    ctxTabScrollPos.current = {};
  }, [liveVerse?.verse_id]);

  const openContextModal = async (tab = 'chapter') => {
    if (!liveVerse) return;
    setContextOpen(true);
    setContextLoading(true);
    setCtxScrolled(false);
    setCtxAtBottom(false);
    try {
      if (tab === 'chapter') {
        // Resolve chapter_id — may be missing on verses from VOTD/history/setlist
        let chapterId = liveVerse.chapter_id;
        let chapters  = bookChapters;
        if (!chapters.length && liveVerse.book_id) {
          const cr = await fetch(`${API_URL}/browse/chapters?book_id=${liveVerse.book_id}&language=${currentLanguage}`).catch(() => null);
          if (cr?.ok) {
            chapters = await cr.json();
            if (Array.isArray(chapters)) setBookChapters(chapters);
          }
        }
        if (!chapterId && Array.isArray(chapters) && liveVerse.chapter_number) {
          const matched = chapters.find(c => Number(c.chapter_number) === Number(liveVerse.chapter_number));
          chapterId = matched?.chapter_id ?? null;
        }
        if (Array.isArray(chapters)) {
          const idx = chapters.findIndex(c => c.chapter_id === chapterId);
          if (idx >= 0) setCtxChapterIdx(idx);
        }
        if (!chapterId) { setContextLoading(false); return; }
        // force=true when chapter changed (ref was set by the chapter-change useEffect)
        const force = chapterNeedsRefetchRef.current;
        if (force) chapterNeedsRefetchRef.current = false;
        // Fetch each piece independently so Summary/Entities tabs work even when chapter verses are already cached
        const fetches = [];
        if (force || !chapterVerses.length)    fetches.push(fetch(`${API_URL}/browse/verses?chapter_id=${chapterId}&language=${currentLanguage}`).then(r => r.ok ? r.json() : null).then(d => d && setChapterVerses(Array.isArray(d) ? d : (d.verses ?? []))));
        if (force || !chapterSummary.ready)    fetches.push(fetch(`${API_URL}/chapter/${chapterId}/summary`).then(r => r.ok ? r.json() : null).then(d => d && setChapterSummary(d)));
        if (force || !chapterEntities.ready)   fetches.push(fetch(`${API_URL}/chapter/${chapterId}/entities`).then(r => r.ok ? r.json() : null).then(d => d && setChapterEntities(d)));
        if (fetches.length) await Promise.all(fetches);
      } else if (tab === 'related' && !relatedVerses.length) {
        const res = await fetch(`${API_URL}/verse/${liveVerse.verse_id}/related?page=0&pageSize=${RELATED_PAGE_SIZE}&language=${currentLanguage}`);
        if (res.ok) {
          const d = await res.json();
          const verses  = d.results ?? [];
          const total   = d.total ?? verses.length;
          const concept = d.matchedConcept ?? null;
          const label   = `${liveVerse.book_title} ${liveVerse.chapter_number}:${liveVerse.verse_number}`;
          const entry   = { label, concept: concept ?? label, type: 'verse', payload: liveVerse.verse_id, verses, total, page: 0, pageSize: RELATED_PAGE_SIZE };
          setCtxTopicHistory([entry]);
          setCtxTopicHistoryIdx(0);
          setRelatedVerses(verses);
          setRelatedConcept(concept);
          setRelatedBatchPage(0);
          setRelatedTotal(total);
        }
      }
    } finally {
      setContextLoading(false);
    }
  };

  const loadTopicInModal = async (topicLabel, page = 0) => {
    if (!topicLabel) return;
    setContextLoading(true);
    try {
      const res = await fetch(`${API_URL}/topic-search?q=${encodeURIComponent(topicLabel)}&page=${page}&pageSize=${RELATED_PAGE_SIZE}&language=${currentLanguage}`);
      if (!res.ok) return;
      const d = await res.json();
      const verses = d.results ?? [];
      const total  = d.total ?? verses.length;

      // Fallback: if Related returns 0 results, search chapter summaries instead
      if (verses.length === 0 && total === 0 && page === 0) {
        try {
          const sRes = await fetch(`${API_URL}/sermon-search?q=${encodeURIComponent(topicLabel)}&limit=20`);
          if (sRes.ok) {
            const sData = await sRes.json();
            if ((sData.results || []).length > 0) {
              setSummaryTopicResults({ label: topicLabel, results: sData.results });
              setSummaryTopicPage(0);
              setContextTab('summary');
              setTimeout(() => summaryTopicResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
              return;
            }
          }
        } catch { /* ignore sermon-search failure */ }
      }

      const newEntry = { label: topicLabel, concept: d.matchedTopic ?? topicLabel, type: 'topic', payload: topicLabel, verses, total, page, pageSize: RELATED_PAGE_SIZE };
      setCtxTopicHistory(prev => {
        const base = ctxTopicHistoryIdx >= 0 ? prev.slice(0, ctxTopicHistoryIdx + 1) : [];
        const next = [...base, newEntry];
        setCtxTopicHistoryIdx(next.length - 1);
        return next;
      });
      setRelatedVerses(verses);
      setRelatedConcept(d.matchedTopic ?? topicLabel);
      setRelatedBatchPage(page);
      setRelatedTotal(total);
      if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
    } finally {
      setContextLoading(false);
    }
  };

  // Navigate to a different server page within the current history entry
  const loadHistoryPage = async (page) => {
    const idx = ctxTopicHistoryIdxRef.current;
    const entry = ctxTopicHistory[idx];
    if (!entry) return;
    setContextLoading(true);
    try {
      let res;
      if (entry.type === 'topic') {
        res = await fetch(`${API_URL}/topic-search?q=${encodeURIComponent(entry.payload)}&page=${page}&pageSize=${RELATED_PAGE_SIZE}&language=${currentLanguage}`);
      } else {
        res = await fetch(`${API_URL}/verse/${entry.payload}/related?page=${page}&pageSize=${RELATED_PAGE_SIZE}&language=${currentLanguage}`);
      }
      if (!res.ok) return;
      const d = await res.json();
      const verses = d.results ?? [];
      const total  = d.total ?? verses.length;
      setRelatedVerses(verses);
      setCtxTopicHistory(prev => prev.map((e, i) => i === idx ? { ...e, total, page } : e));
      setRelatedBatchPage(page);
      setRelatedTotal(total);
    } finally {
      setContextLoading(false);
    }
  };
  const loadHistoryPageRef = useRef(null);
  loadHistoryPageRef.current = loadHistoryPage;

  const loadEntityPage = async (page) => {
    const es = entitySearch;
    if (!es) return;
    setEntitySearch(s => ({ ...s, loading: true }));
    try {
      const res = await fetch(`${API_URL}/entity/search?name=${encodeURIComponent(es.name)}&type=${es.type}&language=${currentLanguage}&page=${page}&pageSize=${es.pageSize}${es.entity_id ? `&entity_id=${encodeURIComponent(es.entity_id)}` : ''}`);
      if (!res.ok) return;
      const d = await res.json();
      const results = d.results || [];
      const vMap = new Map();
      for (const r of results) { const vid = r.volume_id || 0; if (!vMap.has(vid)) vMap.set(vid, { volume_id: vid, volume_title: r.volume_title || r.book_title, results: [] }); vMap.get(vid).results.push(r); }
      setEntitySearch(s => ({ ...s, loading: false, results, groups: [...vMap.values()], page }));
    } catch {
      setEntitySearch(s => ({ ...s, loading: false }));
    }
  };

  const loadTopicPage = (page) => {
    const tr = topicResults;
    if (!tr) return;
    setTopicResults(s => ({ ...s, loading: true }));
    fetch(`${API_URL}/topic-search?q=${encodeURIComponent(tr.topic)}&language=${currentLanguage}&page=${page}&pageSize=${tr.pageSize}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const results = d.results || [];
        const vMap = new Map();
        for (const r of results) {
          const vid = r.volume_id || 0;
          if (!vMap.has(vid)) vMap.set(vid, { volume_id: vid, volume_title: r.volume_title || r.book_title, results: [] });
          vMap.get(vid).results.push(r);
        }
        setTopicResults(s => ({ ...s, loading: false, results, total: d.total || 0, page, groups: [...vMap.values()] }));
      })
      .catch(() => setTopicResults(s => ({ ...s, loading: false })));
  };

  const ctxTopicBack = () => {
    const newIdx = ctxTopicHistoryIdx - 1;
    if (newIdx < 0) return;
    const entry = ctxTopicHistory[newIdx];
    setCtxTopicHistoryIdx(newIdx);
    setRelatedVerses(entry.verses);
    setRelatedConcept(entry.concept);
    setRelatedBatchPage(entry.page ?? 0);
    setRelatedTotal(entry.total ?? entry.verses.length);
    if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
  };

  const ctxTopicForward = () => {
    const newIdx = ctxTopicHistoryIdx + 1;
    if (newIdx >= ctxTopicHistory.length) return;
    const entry = ctxTopicHistory[newIdx];
    setCtxTopicHistoryIdx(newIdx);
    setRelatedVerses(entry.verses);
    setRelatedConcept(entry.concept);
    setRelatedBatchPage(entry.page ?? 0);
    setRelatedTotal(entry.total ?? entry.verses.length);
    if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
  };

  const openEntitySearchInModal = (name, type) => {
    setContextTab('entities');
    setContextOpen(true);
    setEntitySearch({ name, type, loading: true, results: [], total: 0, page: 0, pageSize: 10, groups: [], qualifier: null, siblings: [] });
    const vid = liveVerse?.verse_id ? `&verse_id=${liveVerse.verse_id}` : '';
    fetch(`${API_URL}/entity/search?name=${encodeURIComponent(name)}&type=${type}&language=${currentLanguage}&page=0&pageSize=10${vid}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => d && setEntitySearch({ name, type, loading: false, results: d.results, total: d.total, page: 0, pageSize: 10, groups: d.groups || [], entity_id: d.entity_id || null, qualifier: d.qualifier || null, siblings: d.siblings || [] }))
      .catch(() => setEntitySearch(s => s ? ({ ...s, loading: false }) : s));
  };

  const drillIntoVerse = async (verse, page = 0) => {
    setContextLoading(true);
    setCtxWordChip(null);
    try {
      const res = await fetch(`${API_URL}/verse/${verse.verse_id}/related?page=${page}&pageSize=${RELATED_PAGE_SIZE}&language=${currentLanguage}`);
      if (!res.ok) return;
      const d = await res.json();
      const verses = d.results ?? [];
      const total  = d.total ?? verses.length;
      const label = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
      const newEntry = { label, concept: d.matchedConcept ?? label, type: 'verse', payload: verse.verse_id, verses, total, page, pageSize: RELATED_PAGE_SIZE };
      setCtxTopicHistory(prev => {
        const base = ctxTopicHistoryIdx >= 0 ? prev.slice(0, ctxTopicHistoryIdx + 1) : [];
        const next = [...base, newEntry];
        setCtxTopicHistoryIdx(next.length - 1);
        return next;
      });
      setRelatedVerses(verses);
      setRelatedConcept(d.matchedConcept ?? label);
      setRelatedBatchPage(page);
      setRelatedTotal(total);
      if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
    } finally {
      setContextLoading(false);
    }
  };

  const handleCtxTextMouseUp = (e) => {
    const sel = window.getSelection();
    const word = sel?.toString().trim().replace(/[^\w\s'-]/g, '').trim();
    if (!word || word.split(/\s+/).length > 4 || word.length < 2) {
      setCtxWordChip(null);
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = e.currentTarget.getBoundingClientRect();
    setCtxWordChip({
      word,
      // position relative to the ctx-body container
      top: rect.bottom - containerRect.top + 6,
      left: Math.max(4, Math.min(rect.left - containerRect.left, containerRect.width - 180)),
    });
  };

  const loadCtxChapterByIdx = async (idx) => {
    const ch = bookChapters[idx];
    if (!ch) return;
    const dir = idx > ctxChapterIdx ? 'next' : 'prev';
    setCtxSlideDir(dir);               // trigger exit animation
    await new Promise(r => setTimeout(r, 210)); // match CSS duration
    setCtxSlideDir(null);
    setCtxScrolled(false);
    setCtxAtBottom(false);
    setContextLoading(true);
    try {
      const [versesRes, summaryRes, entitiesRes] = await Promise.all([
        fetch(`${API_URL}/browse/verses?chapter_id=${ch.chapter_id}&language=${currentLanguage}`),
        fetch(`${API_URL}/chapter/${ch.chapter_id}/summary`),
        fetch(`${API_URL}/chapter/${ch.chapter_id}/entities`),
      ]);
      if (versesRes.ok) {
        const d = await versesRes.json();
        setChapterVerses(Array.isArray(d) ? d : (d.verses ?? []));
      }
      if (summaryRes.ok) setChapterSummary(await summaryRes.json());
      if (entitiesRes.ok) setChapterEntities(await entitiesRes.json());
      setCtxChapterIdx(idx);
      if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
    } catch { /* ignore */ } finally {
      setContextLoading(false);
    }
  };

  const ctxProgrammaticScroll = useRef(false); // true during auto-scroll to suppress user detection
  const handleCtxBodyScroll = (e) => {
    const el = e.currentTarget;
    setCtxScrolled(el.scrollTop > 80);
    setCtxAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 16);
    if (!ctxProgrammaticScroll.current && contextTab === 'chapter') {
      ctxUserScrolled.current = true;
    }
  };

  // Save current tab scroll position and restore target tab's position
  const switchCtxTab = (fromTab, toTab, afterSwitch) => {
    if (ctxBodyRef.current) ctxTabScrollPos.current[fromTab] = ctxBodyRef.current.scrollTop;
    afterSwitch();
    requestAnimationFrame(() => {
      if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = ctxTabScrollPos.current[toTab] || 0;
    });
  };

  // Search panel infinite scroll
  const searchLoadingRef = useRef(false);
  useEffect(() => {
    const root = resultsListRef.current;
    if (!root || !searchSentinelRef.current) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting || searchLoadingRef.current) continue;
        const tp = Math.ceil(totalResults / PAGE_SIZE);
        if (currentPage < tp - 1 && query) {
          searchLoadingRef.current = true;
          const nextPage = currentPage + 1;
          searchAppendRef.current = true;
          setCurrentPage(nextPage);
          emitWithSession('search', { query, page: nextPage, pageSize: PAGE_SIZE, language: currentLanguage });
          setTimeout(() => { searchLoadingRef.current = false; }, 500);
        }
      }
    }, { root, threshold: 0.1 });
    observer.observe(searchSentinelRef.current);
    return () => observer.disconnect();
  });

  const handleCtxTouchStart = (e) => {
    if (contextTab !== 'chapter') return;
    ctxTouchStartX.current = e.touches[0].clientX;
    ctxTouchStartY.current = e.touches[0].clientY;
  };

  const handleCtxTouchEnd = (e) => {
    if (contextTab !== 'chapter' || ctxTouchStartX.current === null || ctxTouchStartY.current === null) return;
    const deltaX = e.changedTouches[0].clientX - ctxTouchStartX.current;
    const deltaY = e.changedTouches[0].clientY - ctxTouchStartY.current;
    ctxTouchStartX.current = null;
    ctxTouchStartY.current = null;
    if (Math.abs(deltaX) < 90) return;
    if (Math.abs(deltaX) < Math.abs(deltaY) * 1.3) return;
    const nextIdx = ctxChapterIdx + (deltaX < 0 ? 1 : -1);
    if (nextIdx >= 0 && nextIdx < bookChapters.length) loadCtxChapterByIdx(nextIdx);
  };

  const handlePreviewTextSelection = () => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    setHighlightedText(sel);
    emitWithSession('highlight-text', { text: sel });
  };

  const handleLanguageChange = async e => {
    const lang = e.target.value;
    setCurrentLanguage(lang);
    setRelatedVerses([]);   // force re-fetch in new language when modal reopened
    setRelatedConcept(null);
    setRelatedBatchPage(0);
    setRelatedTotal(0);
    setCtxTopicHistory([]);
    setCtxTopicHistoryIdx(-1);
    setChapterVerses([]);   // force re-fetch chapter verses in new language
    setExpandedTranslations(new Set()); // stale cache keys become invalid on language change
    emitWithSession('update-language', { language: lang });
    // Update live verse text directly (handles the case where presenter has no connected session)
    if (liveVerse) {
      try {
        const res = await fetch(`${API_URL}/verse/${liveVerse.verse_id}/translation?language=${lang}`).catch(() => null);
        if (res?.ok) {
          const d = await res.json();
          setLiveVerse(prev => prev ? { ...prev, scripture_text: d.scripture_text, segments: null, language: lang } : prev);
        }
      } catch { // ignore
      }
      // Also broadcast to connected clients (server will re-segment and send back proper update-verse)
      emitWithSession('go-live', { verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: lang, secondaryLanguage: secondaryLanguage || null });
    }
    // Update staged verse text to the new language
    if (staged) {
      try {
        const res = await fetch(`${API_URL}/verse/${staged.verse_id}/translation?language=${lang}`).catch(() => null);
        if (res?.ok) {
          const d = await res.json();
          setStaged(prev => prev ? { ...prev, scripture_text: d.scripture_text } : prev);
        }
      } catch { // ignore
      }
    }
    // Re-fetch chapter tab if modal is open on chapter tab
    if (contextOpen && contextTab === 'chapter' && liveVerse) {
      openContextModal('chapter');
    }
    // Re-run the current search in the new language so results update immediately
    if (query.trim()) {
      clearTimeout(searchDebounce.current);
      setCurrentPage(0);
      emitWithSession('search', { query, page: 0, pageSize: PAGE_SIZE, language: lang });
    }
  };

  const handleSecondaryLanguageChange = (lang) => {
    setSecondaryLanguage(lang);
    if (liveVerse) emitWithSession('go-live', { verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: currentLanguage, secondaryLanguage: lang || null });
  };

  const handleSwapLanguages = async () => {
    if (!secondaryLanguage) return;
    const newPrimary   = secondaryLanguage;
    const newSecondary = currentLanguage;
    setCurrentLanguage(newPrimary);
    setSecondaryLanguage(newSecondary);
    setExpandedTranslations(new Set());
    setChapterVerses([]);
    setRelatedVerses([]);
    setRelatedBatchPage(0);
    setRelatedTotal(0);
    setCtxTopicHistory([]);
    setCtxTopicHistoryIdx(-1);
    emitWithSession('update-language', { language: newPrimary });
    if (liveVerse) {
      try {
        const res = await fetch(`${API_URL}/verse/${liveVerse.verse_id}/translation?language=${newPrimary}`).catch(() => null);
        if (res?.ok) {
          const d = await res.json();
          setLiveVerse(prev => prev ? { ...prev, scripture_text: d.scripture_text, segments: null, language: newPrimary } : prev);
        }
      } catch { // ignore
      }
      emitWithSession('go-live', { verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: newPrimary, secondaryLanguage: newSecondary });
    }
    if (staged) {
      try {
        const res = await fetch(`${API_URL}/verse/${staged.verse_id}/translation?language=${newPrimary}`).catch(() => null);
        if (res?.ok) {
          const d = await res.json();
          setStaged(prev => prev ? { ...prev, scripture_text: d.scripture_text } : prev);
        }
      } catch { // ignore
      }
    }
    if (query.trim()) {
      clearTimeout(searchDebounce.current);
      setCurrentPage(0);
      emitWithSession('search', { query, page: 0, pageSize: PAGE_SIZE, language: newPrimary });
    }
  };

  const renderPreviewText = () => {
    if (!liveVerse) return '';
    const text = liveVerse.segments?.length > 0
      ? liveVerse.segments[currentSegment]
      : liveVerse.scripture_text;
    if (!highlightedText) return text;
    const parts = text.split(new RegExp(`(${highlightedText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === highlightedText.toLowerCase()
        ? <span key={i} className="highlight-yellow preview-highlight">{part}</span>
        : part
    );
  };

  const handleBrowseBook = async (book) => {
    setBrowseSelectedBook(book);
    const res = await fetch(`${API_URL}/browse/chapters?book_id=${book.book_id}&language=${currentLanguage}`).catch(() => null);
    if (res?.ok) setBrowseChapters(await res.json());
    setBrowseLevel('chapters');
  };
  const handleBrowseChapter = async (chapter) => {
    setBrowseSelectedChapter(chapter);
    const res = await fetch(`${API_URL}/browse/verses?chapter_id=${chapter.chapter_id}&language=${currentLanguage}`).catch(() => null);
    if (res?.ok) setBrowseVerses(await res.json());
    setBrowseLevel('verses');
  };

  const sendCustomToScreen = () => {
    if (!customText.trim()) return;
    emitWithSession('go-custom', { text: customText.trim(), subtext: customSubtext.trim(), theme: currentTheme });
    setIsCustomLive(true);
    showToast('Announcement sent to screen');
  };

  const fetchSavedSetlists = async () => {
    setSetlistsLoading(true);
    try {
      const r = await fetch(`${API_URL}/setlists`);
      if (r.ok) setSavedSetlists(await r.json());
    } finally { setSetlistsLoading(false); }
  };
  const saveSetlist = async () => {
    const name = setlistSaveName.trim();
    if (!name) return;
    try {
      const r = await fetch(`${API_URL}/setlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, items: setlist }),
      });
      if (!r.ok) throw new Error(`Server error ${r.status}`);
      setSetlistSaveOpen(false);
      setSetlistSaveName('');
      showToast(`Setlist "${name}" saved`);
    } catch {
      showToast(`Failed to save setlist "${name}" — check connection`);
    }
  };
  const loadSetlist = (saved) => {
    if (!window.confirm(`Replace current setlist with "${saved.name}"?`)) return;
    setSetlist(saved.items);
    setSetlistLoadOpen(false);
    showToast(`Loaded "${saved.name}"`);
  };
  const deleteSavedSetlist = async (id) => {
    await fetch(`${API_URL}/setlists/${id}`, { method: 'DELETE' });
    setSavedSetlists(prev => prev.filter(s => s.id !== id));
  };

  const toggleTranslation = async (verse_id) => {
    const targetLang = currentLanguage === 'en' ? 'tl' : currentLanguage === 'tl' ? 'ceb' : 'en';
    const cacheKey = `${verse_id}_${targetLang}`;
    setExpandedTranslations(prev => {
      const next = new Set(prev);
      next.has(verse_id) ? next.delete(verse_id) : next.add(verse_id);
      return next;
    });
    if (!translationCache[cacheKey]) {
      const res = await fetch(`${API_URL}/verse/${verse_id}/translation?language=${targetLang}`).catch(() => null);
      if (res?.ok) {
        const d = await res.json();
        setTranslationCache(c => ({ ...c, [cacheKey]: d.scripture_text }));
      } else {
        setTranslationCache(c => ({ ...c, [cacheKey]: '(translation unavailable)' }));
      }
    }
  };

  const updateVerseNote = (key, text) =>
    setVerseNotes(prev => ({ ...prev, [key]: text }));
  const toggleNotesExpanded = (key) =>
    setNotesExpandedFor(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  const addTextItem = () => {
    if (!runsheetTextDraft.trim()) return;
    setSetlist(prev => [...prev, {
      type: 'text',
      id: `text_${Date.now()}`,
      customText: runsheetTextDraft.trim(),
      customSubtext: runsheetSubtextDraft.trim(),
      theme: currentTheme,
    }]);
    setRunsheetTextDraft('');
    setRunsheetSubtextDraft('');
    setRunsheetAddingText(false);
    showToast('Text item added to service order');
  };

  const openDrawer = tab => {
    setDrawerTab(tab);
    setDrawerOpen(open => drawerTab === tab ? !open : true);
  };

  /* ── Keyboard shortcuts ─────────────────────────────────────────────────
     Active only when no input / textarea is focused so typing in search
     doesn't accidentally trigger navigation.
     Space  → next segment (or next verse if single-segment)
     →      → next verse
     ←      → previous verse
     L      → go live (if staged)
     E      → end live (if live)
     Esc    → clear highlight
     ────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.ctrlKey || e.metaKey) && e.key === '/') { e.preventDefault(); setKbdHelpOpen(o => !o); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key) {
        case ' ':
        case 'ArrowRight':
          e.preventDefault();
          if (e.key === ' ' && liveVerse?.segments?.length > 1) {
            navigateSegment('next');
          } else {
            fetchAdjacent('next');
          }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          fetchAdjacent('prev');
          break;
        case 'l':
        case 'L':
          if (staged) { e.preventDefault(); goLive(); }
          break;
        case 'e':
        case 'E':
          if (liveVerse) { e.preventDefault(); endLive(); }
          break;
        case 'Escape':
          if (highlightedText) { e.preventDefault(); clearHighlight(); }
          else if (drawerOpen) { e.preventDefault(); setDrawerOpen(false); }
          break;
        case '/':
          e.preventDefault();
          openDrawer('search');
          break;
        default: break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged, liveVerse, highlightedText, currentSegment, drawerOpen, kbdHelpOpen]);

  // Auto-advance segments
  useEffect(() => {
    clearTimeout(autoAdvanceTimer.current);
    if (!autoAdvance || !liveVerse) return;
    const seg = liveVerse.segments?.[liveVerse.currentSegment] || liveVerse.scripture_text || '';
    const wordCount = seg.trim().split(/\s+/).filter(Boolean).length;
    const dwell = Math.max(autoAdvanceSec * 1000, wordCount * 420);
    const hasNext = liveVerse.segments && liveVerse.currentSegment < liveVerse.segments.length - 1;
    if (!hasNext) return;
    autoAdvanceTimer.current = setTimeout(() => {
      fetchAdjacent('next', false);
    }, dwell);
    return () => clearTimeout(autoAdvanceTimer.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAdvance, liveVerse, autoAdvanceSec]);

  // Auto-suggest layout based on text length
  useEffect(() => {
    if (!staged) return;
    const wordCount = (staged.scripture_text || '').trim().split(/\s+/).filter(Boolean).length;
    const currentLayout = currentTheme?.layout || 'centered';
    if (wordCount > 80 && currentLayout === 'lower-third') {
      showToast('💡 Long verse — consider switching to "Centered" layout for readability');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged?.verse_id]);

  const hasSegments = liveVerse?.segments?.length > 1;
  const totalPages  = totalResults > 0 ? Math.ceil(totalResults / PAGE_SIZE) : (results.length > 0 ? 1 : 0);
  const isIdle      = !staged && !liveVerse;

  const launchTopic = (topic) => {
    setQuery(topic);
    setCurrentPage(0);
    setTotalResults(0);
    emitWithSession('search', { query: topic, page: 0, pageSize: PAGE_SIZE, language: currentLanguage });
    setDrawerTab('search');
    setDrawerOpen(true);
  };
  const presenterThemeClass = currentTheme?.tone === 'dark'
    ? 'presenter-container--dark'
    : 'presenter-container--light';

  /* ── Render ── */
  return (
    <div className={`presenter-container ${presenterThemeClass} presenter-ui--${presenterUiMode}`} style={{ '--ui-font-size': `${uiFontSize}rem` }}>

      {/* Phase 1: Presenter takeover alert — unobtrusive amber banner */}
      {takeoverAlert && (
        <div className="presenter-takeover-alert" role="alert" aria-live="assertive">
          ⚠ Another device attempted to join as presenter — your session is protected.
          <button className="presenter-takeover-dismiss" onClick={() => setTakeoverAlert(false)}>✕</button>
        </div>
      )}

      {/* Evicted presenter alert — persistent red banner, must be manually dismissed */}
      {evictedAlert && (
        <div className="presenter-takeover-alert presenter-evicted-alert" role="alert" aria-live="assertive">
          ⛔ You have been removed as presenter — the session is now controlled by another device.
          <button className="presenter-takeover-dismiss" onClick={() => setEvictedAlert(false)}>✕</button>
        </div>
      )}

      {/* Leave Session confirmation — prevents accidental mid-sermon tap */}
      {leaveConfirmOpen && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          onClick={() => setLeaveConfirmOpen(false)}
        >
          <div
            style={{
              background: '#1e1e1e', border: '1px solid #444', borderRadius: '0.75rem',
              padding: '1.75rem 2rem', maxWidth: '22rem', width: '90%', textAlign: 'center',
              color: '#f0f0f0', boxShadow: '0 8px 32px rgba(0,0,0,0.6)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ fontSize: '1.6rem', marginBottom: '0.5rem' }}>🚪</div>
            <div style={{ fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.5rem' }}>End the session?</div>
            <div style={{ fontSize: '0.85rem', color: '#aaa', marginBottom: '1.25rem', lineHeight: 1.4 }}>
              Leaving will release the presenter slot. The audience screen will show "Scan to present" until someone rejoins.
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
              <button
                className="theme-btn"
                style={{ minWidth: '7rem', background: '#c0392b', borderColor: '#c0392b' }}
                onClick={() => { setLeaveConfirmOpen(false); leaveSession(); }}
              >
                Leave
              </button>
              <button
                className="theme-btn"
                style={{ minWidth: '7rem' }}
                onClick={() => setLeaveConfirmOpen(false)}
              >
                Stay
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════
          COMMAND BAR HEADER
          ════════════════════════════════════════ */}
      <header className="presenter-header">

        {/* Brand */}
        <div className="hdr-brand">
          <EmblemSVG size={24} />
          <span className="hdr-title">Scripture</span>
          {isRemoteMode && sessionId && (
            <span className="hdr-session-badge" title={`Online session: ${sessionId}`}>
              🌐 {sessionLabel ? `${sessionLabel} · ${sessionId}` : sessionId}
            </span>
          )}
        </div>

        {/* Auto-update progress bar — Electron only, shown during download */}
        {isElectronApp && updateProgress && (
          <div className="hdr-update-bar" title={
            updateProgress.status === 'available'   ? `Update v${updateProgress.version} available — downloading…` :
            updateProgress.status === 'downloading' ? `Downloading update… ${updateProgress.percent}%` :
            'Update downloaded — restart when ready'
          }>
            {updateProgress.status === 'downloaded' ? (
              <span className="hdr-update-label">⬆ Update ready</span>
            ) : (
              <>
                <span className="hdr-update-label">⬇ {updateProgress.percent}%</span>
                <div className="hdr-update-progress">
                  <div className="hdr-update-fill" style={{ width: `${updateProgress.percent}%` }} />
                </div>
              </>
            )}
          </div>
        )}

        {/* Live verse summary */}
        <div className="hdr-center">
          {/* Persistent connection dot — always visible on desktop */}
          <span
            className={`hdr-conn-dot hdr-conn-dot--${connectionState}`}
            title={`Connection: ${connectionState}${queuedCount > 0 ? ` (${queuedCount} queued)` : ''}`}
            aria-label={`Connection: ${connectionState}`}
          />
          {queuedCount > 0 && (
            <span className="hdr-queue-badge" title={`${queuedCount} action${queuedCount > 1 ? 's' : ''} queued — will send on reconnect`}>
              {queuedCount} queued
            </span>
          )}
          {liveVerse ? (
            <div className="hdr-verse-info">
              <span className="hdr-verse-ref">
                {liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}
                <span className="hdr-verse-citation"> ({getCitation(currentLanguage, liveVerse.volume_id, secondaryLanguage)})</span>
              </span>
              {hasSegments && (
                <span className="hdr-seg-count">{currentSegment + 1}/{liveVerse.segments.length}</span>
              )}
            </div>
          ) : (
            <span className="hdr-no-verse">Tap 🔍 to find a verse</span>
          )}
        </div>

        {/* Right controls — desktop (hidden on narrow screens via CSS) */}
        <div className="hdr-right hdr-right--desktop">
          {electronDisplayCount > 1 && (
            <HdrBtn
              onClick={() => window.electronAPI.changeProjectionDisplay()}
              label="Change projection display"
              title="Change projection display"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="2" y="3" width="20" height="14" rx="2"/>
                <path d="M8 21h8M12 17v4"/>
                <path d="M17 3h5v5M22 3l-7 7"/>
              </svg>
            </HdrBtn>
          )}
          <HdrBtn onClick={openTour} label="Open walkthrough" title="Open walkthrough">
            <IconInfo />
          </HdrBtn>
          {(!isElectronApp || isRemoteMode) && (
          <div className={`hdr-session-wrap${activeTourTarget === 'session' ? ' tour-focus' : ''}`}>
            <HdrBtn
              onClick={() => setSessionPopover(o => !o)}
              active={sessionPopover}
              label="Session controls"
              title={`Session ${sessionId || '...'}`}
            >
              <IconSession />
            </HdrBtn>
            {sessionPopover && (
              <div className="hdr-session-popover">
                <div className="popover-label">
                  {sessionId ? `Session ${sessionId}${sessionLabel ? ` · ${sessionLabel}` : ''}` : 'Connect to TV'}
                </div>
                {sessionId && (
                  <div className="idle-viewer-count" style={{ justifyContent: 'center', marginBottom: '0.5rem' }}>
                    <span className={`idle-viewer-dot ${viewerCount > 0 ? 'idle-viewer-dot--live' : ''}`} />
                    {viewerCount === 0 ? 'No screens connected' : viewerCount === 1 ? '1 screen connected' : `${viewerCount} screens connected`}
                  </div>
                )}
                {/* Room label (optional) */}
                {!sessionId && (
                  <div className="popover-row" style={{ marginBottom: '0.3rem' }}>
                    <input
                      type="text"
                      className="popover-input"
                      maxLength={40}
                      value={sessionLabelInput}
                      onChange={e => setSessionLabelInput(e.target.value)}
                      placeholder="Room name (optional)"
                      aria-label="Room label"
                    />
                  </div>
                )}
                {/* Scan QR — primary action */}
                <div className="popover-row">
                  <button
                    className="popover-apply qr-scan-btn"
                    style={{ width: '100%' }}
                    onClick={() => { setScannerOpen(true); setSessionPopover(false); }}
                    aria-label="Scan QR code on TV"
                  >
                    <IconQr /> Scan TV QR Code
                  </button>
                </div>
                {/* Manual code entry — fallback */}
                <div className="session-tv-hint">or type the code shown on the TV screen</div>
                <div className="popover-row">
                  <input
                    type="text"
                    className="popover-input"
                    value={tvSessionInput}
                    onChange={e => setTvSessionInput(normalizeSessionId(e.target.value))}
                    onKeyDown={e => e.key === 'Enter' && joinTvSession()}
                    placeholder="AB12CD"
                    aria-label="TV session code"
                  />
                  <button className="popover-apply" onClick={() => joinTvSession()}>Join</button>
                </div>
                {sessionId && (
                  <div className="popover-row">
                    <button className="theme-btn" style={{ width: '100%' }} onClick={() => setLeaveConfirmOpen(true)}>Leave Session</button>
                  </div>
                )}
                {sessionId && (
                  <div className="popover-row" style={{ justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
                    <span className="pin-status-label">
                      {sessionPinActive ? '🔒 PIN enabled' : '🔓 No PIN set'}
                    </span>
                    <button
                      className="pin-manage-btn"
                      onClick={() => { setPinManageOpen(true); setPinManageInput(''); setPinManageConfirm(''); setPinManageError(''); setSessionPopover(false); }}
                    >
                      {sessionPinActive ? 'Change / Remove' : 'Set PIN'}
                    </button>
                  </div>
                )}
                <div className="session-message">{sessionMessage}</div>
                <div className="session-message">Connection: {connectionState}</div>
              </div>
            )}
          </div>
          )}

          {/* F8 — Language & secondary language popover */}
          <div className="hdr-lang-wrap">
            <button
              className={`hdr-lang-btn${langPopover ? ' hdr-lang-btn--active' : ''}`}
              onClick={() => setLangPopover(o => !o)}
              title="Language settings"
              aria-label="Language settings"
              aria-expanded={langPopover}
            >
              <IconGlobe />
              <span className="hdr-lang-badge">{currentLanguage.toUpperCase()}</span>
              {secondaryLanguage && <span className="hdr-lang-sec-dot" aria-hidden="true" />}
            </button>
            {langPopover && (
              <div className="hdr-lang-popover">
                <div className="popover-lang-row">
                  <label className="popover-label" htmlFor="lang-primary">Language</label>
                  <select
                    id="lang-primary"
                    className="lang-select"
                    value={currentLanguage}
                    onChange={handleLanguageChange}
                  >
                    <option value="en">English</option>
                    <option value="nrsvue">English w/ NRSVUE Bible</option>
                    <option value="tl">Tagalog</option>
                    <option value="ceb">Cebuano</option>
                    <option value="es">Español</option>
                    <option value="el">Greek</option>
                    <option value="ilo">Ilocano</option>
                    <option value="ja">Japanese</option>
                    <option value="war">Waray</option>
                  </select>
                </div>
                <div className="popover-divider" />
                <div className="popover-lang-row">
                  <label className="popover-label" htmlFor="lang-secondary">+ TV Screen</label>
                  <div className="popover-lang-swap-row">
                    <select
                      id="lang-secondary"
                      className="lang-select"
                      value={secondaryLanguage}
                      onChange={e => handleSecondaryLanguageChange(e.target.value)}
                    >
                      <option value="">Off</option>
                      <option value="en">English</option>
                      <option value="nrsvue">English w/ NRSVUE Bible</option>
                      <option value="tl">Tagalog</option>
                      <option value="ceb">Cebuano</option>
                      <option value="es">Español</option>
                      <option value="el">Greek</option>
                      <option value="ilo">Ilocano</option>
                      <option value="ja">Japanese</option>
                      <option value="war">Waray</option>
                    </select>
                    <button
                      className="popover-swap-btn"
                      onClick={handleSwapLanguages}
                      disabled={!secondaryLanguage}
                      title="Swap primary ↔ secondary language"
                      aria-label="Swap primary and secondary language"
                    >⇄</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Presenter UI dark/light mode toggle */}
          <HdrBtn
            onClick={() => {
              const next = presenterUiMode === 'dark' ? 'light' : 'dark';
              setPresenterUiMode(next);
              try { localStorage.setItem('scicp.presenter_ui_mode', next); } catch { /* ignore */ }
            }}
            label={presenterUiMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={presenterUiMode === 'dark' ? 'Switch presenter to light mode' : 'Switch presenter to dark mode'}
          >
            {presenterUiMode === 'dark'
              ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
              : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
            }
          </HdrBtn>

          {/* Theme popover */}
          <div className="hdr-theme-wrap">
            <div className="hdr-theme-quick">
              {[{ label: 'Light', theme: themes.light }, { label: 'Dark', theme: themes.dark }].map(({ label, theme: t }) => (
                <button
                  key={label}
                  className={`theme-quick-pill${currentTheme === t ? ' theme-quick-pill--active' : ''}`}
                  onClick={() => handleThemeChange({ ...t, force_animations: !!currentTheme.force_animations })}
                  title={`${label} theme`}
                >{label}</button>
              ))}
            </div>
            <HdrBtn onClick={() => setThemePopover(o => !o)} active={themePopover} label="Theme" title="Change theme">
              <IconPalette />
            </HdrBtn>
            {themePopover && (
              <div className="hdr-theme-popover">
                <div className="popover-label">Theme</div>
                {[
                  { label: '☀ Light', theme: themes.light },
                  { label: '☽ Dark',  theme: themes.dark  },
                ].map(({ label, theme }) => (
                  <button
                    key={label}
                    className={`theme-btn${currentTheme === theme ? ' active' : ''}`}
                    onClick={() => { handleThemeChange({ ...theme, force_animations: !!currentTheme.force_animations }); setThemePopover(false); }}
                  >{label}</button>
                ))}
                <button
                  className={`theme-btn${currentTheme.force_animations ? ' active' : ''}`}
                  onClick={() => handleThemeChange({ ...currentTheme, force_animations: !currentTheme.force_animations })}
                  title="Override reduced-motion and force client animations"
                >
                  {currentTheme.force_animations ? 'Animations: Forced On' : 'Animations: Auto (Respect OS)'}
                </button>
                <div className="popover-divider" />
                <div className="popover-label">Verse Transition</div>
                <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                  {[
                    { value: 'crossfade',  label: '⊙ Fade' },
                    { value: 'slide-up',   label: '↑ Slide' },
                    { value: 'fade-black', label: '◼ Black' },
                    { value: 'cut',        label: '⚡ Cut' },
                  ].map(({ value, label }) => (
                    <button
                      key={value}
                      className={`theme-btn${(currentTheme.transition_mode || 'crossfade') === value ? ' active' : ''}`}
                      onClick={() => handleThemeChange({ ...currentTheme, transition_mode: value })}
                    >{label}</button>
                  ))}
                </div>
                <div className="popover-divider" />
                <div className="popover-label">Layout</div>
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {[{ value: 'centered', label: '⊡ Centered' }, { value: 'lower-third', label: '⊟ Lower Third' }].map(({ value, label }) => (
                    <button
                      key={value}
                      className={`theme-btn${(currentTheme?.layout || 'centered') === value ? ' active' : ''}`}
                      onClick={() => handleThemeChange({ ...currentTheme, layout: value })}
                    >{label}</button>
                  ))}
                </div>

                <div className="popover-divider" />
                <div className="popover-label">Background</div>
                <div className="popover-bg-presets">
                  {BG_PRESETS.map(({ label, url }) => {
                    const isActive = !url ? !bgUrlInput : currentTheme?.background_url?.includes(url.split('/').pop());
                    return (
                      <button
                        key={label}
                        className={`popover-bg-preset${isActive ? ' popover-bg-preset--active' : ''}`}
                        style={url ? { backgroundImage: `url('${url}')`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}}
                        onClick={() => {
                          if (!url) {
                            handleThemeChange({ ...(currentTheme?.tone === 'dark' ? themes.dark : themes.light), transition_mode: currentTheme.transition_mode, force_animations: !!currentTheme.force_animations });
                            setBgUrlInput('');
                          } else {
                            handleThemeChange({ ...currentTheme, background_url: `url('${url}')` });
                            setBgUrlInput('');
                          }
                        }}
                        title={label}
                      >
                        <span className="popover-bg-preset-label">{label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="popover-divider" />
                <div className="popover-label">Custom URL</div>
                <div className="popover-row">
                  <input type="text" className="popover-input" placeholder="https://…" value={bgUrlInput} onChange={e => setBgUrlInput(e.target.value)} />
                  <button className="popover-apply" onClick={() => { if (!bgUrlInput) return; handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` }); setBgUrlInput(''); setThemePopover(false); }}>Apply</button>
                </div>
              </div>
            )}
          </div>

          {/* Search toggle */}
          <div className={activeTourTarget === 'search' ? 'tour-focus' : ''}>
            <HdrBtn onClick={() => openDrawer('search')} active={drawerOpen && drawerTab === 'search'} label="Search scripture">
              <IconSearch />
            </HdrBtn>
          </div>

          {/* Recent toggle */}
          <HdrBtn onClick={() => openDrawer('history')} active={drawerOpen && drawerTab === 'history'} label="Recent verses">
            <IconClock />
          </HdrBtn>

          {/* Keyboard shortcuts */}
          <div style={{ position: 'relative' }}>
            <HdrBtn onClick={() => setKbdHelpOpen(o => !o)} active={kbdHelpOpen} label="Keyboard shortcuts" title="Keyboard shortcuts (?)">
              <span style={{ fontSize: '0.85rem', fontWeight: 700 }}>?</span>
            </HdrBtn>
            {kbdHelpOpen && (
              <div className="kbd-help-panel">
                <div className="popover-label" style={{ marginBottom: '0.5rem' }}>Keyboard Shortcuts</div>
                {[
                  ['Space / Enter', 'Go Live (when verse staged)'],
                  ['← / →',        'Prev / Next segment'],
                  ['↑ / ↓',        'Prev / Next verse in results'],
                  ['Esc',          'Clear screen / close drawer'],
                  ['Ctrl + F',     'Focus search'],
                  ['Ctrl + /',     'Toggle this panel'],
                ].map(([key, desc]) => (
                  <div key={key} className="kbd-row">
                    <kbd className="kbd-key">{key}</kbd>
                    <span className="kbd-desc">{desc}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live badge */}
          {liveVerse && (
            <div className="live-badge live-badge--web">
              <span className="live-badge-dot" />
              <span className="live-badge--web-label">LIVE</span>
            </div>
          )}
        </div>

        {/* Right controls — mobile (narrow screens only, ≤540px) */}
        <div className="hdr-right hdr-right--mobile">
          {/* Search always visible */}
          <div className={activeTourTarget === 'search' ? 'tour-focus' : ''}>
            <HdrBtn onClick={() => { openDrawer('search'); setMobileMenuOpen(false); }} active={drawerOpen && drawerTab === 'search'} label="Search scripture">
              <IconSearch />
            </HdrBtn>
          </div>
          {/* Compact live dot */}
          {liveVerse && (
            <div className="live-badge live-badge--compact">
              <span className="live-badge-dot" />
            </div>
          )}
          {/* Hamburger */}
          <button
            className={`hdr-btn hdr-hamburger${mobileMenuOpen ? ' hdr-btn--active' : ''}`}
            onClick={() => setMobileMenuOpen(o => !o)}
            aria-label="More options"
            title="More options"
          >
            <IconMenu />
          </button>

          {/* Mobile dropdown panel */}
          {mobileMenuOpen && (
            <div className="hdr-mobile-menu">
              {/* Session (web only) / Display status (Electron only) */}
              {(isElectronApp && !isRemoteMode) ? (
                <div className="mobile-menu-section">
                  <div className="mobile-menu-label">Local Display</div>
                  <div className="idle-viewer-count">
                    <span className={`idle-viewer-dot idle-viewer-dot--live`} />
                    Display window active
                  </div>
                </div>
              ) : (
              <div className={`mobile-menu-section${activeTourTarget === 'session' ? ' tour-focus' : ''}`}>
                <div className="mobile-menu-label">
                  {sessionId ? `Session ${sessionId}` : 'Connect to TV'}
                </div>
                {sessionId && (
                  <div className="idle-viewer-count" style={{ marginBottom: '0.5rem' }}>
                    <span className={`idle-viewer-dot ${viewerCount > 0 ? 'idle-viewer-dot--live' : ''}`} />
                    {viewerCount === 0 ? 'No screens connected' : viewerCount === 1 ? '1 screen connected' : `${viewerCount} screens connected`}
                  </div>
                )}
                <div className="popover-row">
                  <button
                    className="popover-apply qr-scan-btn"
                    style={{ width: '100%' }}
                    onClick={() => { setScannerOpen(true); setMobileMenuOpen(false); }}
                    aria-label="Scan QR code on TV"
                  >
                    <IconQr /> Scan TV QR Code
                  </button>
                </div>
                <div className="session-tv-hint">or type the code shown on the TV screen</div>
                <div className="popover-row">
                  <input
                    type="text"
                    className="popover-input"
                    value={tvSessionInput}
                    onChange={e => setTvSessionInput(normalizeSessionId(e.target.value))}
                    onKeyDown={e => e.key === 'Enter' && joinTvSession()}
                    placeholder="AB12CD"
                    aria-label="TV session code"
                  />
                  <button className="popover-apply" onClick={() => joinTvSession()}>Join</button>
                </div>
                {sessionId && (
                  <div className="popover-row">
                    <button className="theme-btn" style={{ width: '100%' }} onClick={() => { setLeaveConfirmOpen(true); setMobileMenuOpen(false); }}>Leave Session</button>
                  </div>
                )}
                <div className="session-message">{sessionMessage}</div>
                <div className="session-message">Connection: {connectionState}</div>
              </div>
              )}

              <div className="mobile-menu-divider" />

              {/* Language */}
              <div className="mobile-menu-section">
                <div className="mobile-menu-label">Language</div>
                <div className="mobile-menu-row">
                  <select
                    className="lang-select lang-select--mobile"
                    value={currentLanguage}
                    onChange={e => { handleLanguageChange(e); setMobileMenuOpen(false); }}
                  >
                    <option value="en">English</option>
                    <option value="nrsvue">English w/ NRSVUE Bible</option>
                    <option value="tl">Tagalog</option>
                    <option value="ceb">Cebuano</option>
                    <option value="es">Español</option>
                    <option value="el">Greek</option>
                    <option value="ilo">Ilocano</option>
                    <option value="ja">Japanese</option>
                    <option value="war">Waray</option>
                  </select>
                </div>
                {/* F8 — secondary language */}
                <div className="mobile-menu-row" style={{ marginTop: '0.35rem', gap: '0.4rem' }}>
                  <span className="mobile-menu-label" style={{ margin: 0, flexShrink: 0 }}>+Screen</span>
                  <select
                    className="lang-select lang-select--mobile"
                    value={secondaryLanguage}
                    onChange={e => handleSecondaryLanguageChange(e.target.value)}
                    style={{ flex: 1 }}
                  >
                    <option value="">Off</option>
                    <option value="en">English</option>
                    <option value="nrsvue">English w/ NRSVUE Bible</option>
                    <option value="tl">Tagalog</option>
                    <option value="ceb">Cebuano</option>
                    <option value="es">Español</option>
                    <option value="el">Greek</option>
                    <option value="ilo">Ilocano</option>
                    <option value="ja">Japanese</option>
                    <option value="war">Waray</option>
                  </select>
                  <button
                    className="popover-swap-btn"
                    onClick={handleSwapLanguages}
                    disabled={!secondaryLanguage}
                    title="Swap primary ↔ secondary language"
                  >⇄</button>
                </div>
              </div>

              <div className="mobile-menu-divider" />

              {/* Theme */}
              <div className="mobile-menu-section">
                <div className="mobile-menu-label">Theme</div>
                <div className="mobile-menu-row">
                  {[{ label: '☀ Light', theme: themes.light }, { label: '☽ Dark', theme: themes.dark }].map(({ label, theme }) => (
                    <button
                      key={label}
                      className={`theme-btn${currentTheme === theme ? ' active' : ''}`}
                      onClick={() => { handleThemeChange({ ...theme, force_animations: !!currentTheme.force_animations }); setMobileMenuOpen(false); }}
                    >{label}</button>
                  ))}
                </div>
                <div className="popover-row" style={{ marginTop: '0.4rem' }}>
                  <input
                    type="text"
                    className="popover-input"
                    placeholder="Custom bg URL…"
                    value={bgUrlInput}
                    onChange={e => setBgUrlInput(e.target.value)}
                  />
                  <button className="popover-apply" onClick={() => {
                    if (!bgUrlInput) return;
                    handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` });
                    setBgUrlInput('');
                    setMobileMenuOpen(false);
                  }}>Apply</button>
                </div>
              </div>

              <div className="mobile-menu-divider" />

              {/* Misc */}
              <div className="mobile-menu-section">
                <div className="mobile-menu-row">
                  <button className="theme-btn" onClick={() => { openDrawer('history'); setMobileMenuOpen(false); }}>
                    <IconClock /> Recent
                  </button>
                  <button className="theme-btn" onClick={() => { openTour(); setMobileMenuOpen(false); }}>
                    <IconInfo /> Help
                  </button>
                  {electronDisplayCount > 1 && (
                    <button className="theme-btn" onClick={() => { window.electronAPI.changeProjectionDisplay(); setMobileMenuOpen(false); }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{display:'inline',verticalAlign:'middle',marginRight:'0.3em'}}><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="M17 3h5v5M22 3l-7 7"/></svg>
                      Change display
                    </button>
                  )}
                  {isElectronApp && window.electronAPI?.switchConnectionMode && (
                    <button className="theme-btn" onClick={async () => {
                      setMobileMenuOpen(false);
                      // Save state to sessionStorage before reload
                      try {
                        sessionStorage.setItem('scicp.mode_switch_state', JSON.stringify({
                          liveVerse, staged, currentTheme, currentLanguage, secondaryLanguage,
                          history: history.slice(0, 20),
                          setlist: setlist.slice(0, 50),
                        }));
                      } catch { /* ignore */ }
                      // Switch to the opposite mode
                      if (isRemoteMode) {
                        await window.electronAPI.switchConnectionMode({ mode: 'offline' });
                      } else {
                        const url = prompt('Enter remote server URL:', 'https://cap-teyyko.live');
                        if (url) await window.electronAPI.switchConnectionMode({ mode: 'online', serverUrl: url });
                      }
                    }}>
                      {isRemoteMode ? '📱 Switch to Offline' : '🌐 Switch to Online'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {tourOpen && (
        <aside className="tour-card" role="dialog" aria-live="polite" aria-label="Presenter walkthrough">
          <div className="tour-chip">Quick Walkthrough</div>
          <div className="tour-title">{presenterTourSteps[tourStep].title}</div>
          <div className="tour-desc">{presenterTourSteps[tourStep].description}</div>
          <div className="tour-progress">{tourStep + 1}/{presenterTourSteps.length}</div>
          <div className="tour-actions">
            <button className="tour-btn" onClick={closeTour}>Skip</button>
            <button className="tour-btn" onClick={() => setTourStep(s => Math.max(0, s - 1))} disabled={tourStep === 0}>Back</button>
            {tourStep < presenterTourSteps.length - 1 ? (
              <button className="tour-btn tour-btn--primary" onClick={() => setTourStep(s => Math.min(presenterTourSteps.length - 1, s + 1))}>Next</button>
            ) : (
              <button className="tour-btn tour-btn--primary" onClick={closeTour}>Done</button>
            )}
          </div>
        </aside>
      )}

      {/* ════════════════════════════════════════
          SLIDE-IN DRAWER  (search + history)
          ════════════════════════════════════════ */}
      <div className={`search-drawer${drawerOpen ? ' search-drawer--open' : ''}`}>
        <div className="drawer-header">
          <div className="drawer-tabs">
            <button className={`drawer-tab${drawerTab === 'search' ? ' active' : ''}`} onClick={() => setDrawerTab('search')} aria-label="Search" title="Search">
              <span className="drawer-tab-icon"><IconSearch /></span>
              <span className="drawer-tab-label">Search</span>
            </button>
            <button className={`drawer-tab${drawerTab === 'history' ? ' active' : ''}`} onClick={() => setDrawerTab('history')} aria-label="Recent" title="Recent">
              <span className="drawer-tab-icon"><IconClock /></span>
              <span className="drawer-tab-label">Recent</span>
            </button>
            <button className={`drawer-tab${drawerTab === 'setlist' ? ' active' : ''}`} onClick={() => setDrawerTab('setlist')} aria-label={`Setlist${setlist.length > 0 ? ` (${setlist.length})` : ''}`} title="Setlist">
              <span className="drawer-tab-icon"><IconList /></span>
              <span className="drawer-tab-label">Setlist</span>
              {setlist.length > 0 && <span className="drawer-tab-count" aria-hidden="true">{setlist.length}</span>}
            </button>
            <button className={`drawer-tab${drawerTab === 'browse' ? ' active' : ''}`} onClick={() => setDrawerTab('browse')} aria-label="Browse" title="Browse">
              <span className="drawer-tab-icon"><IconBook /></span>
              <span className="drawer-tab-label">Browse</span>
            </button>
          </div>
          {staged && (
            <span className="drawer-staged-badge" title="Verse staged — press Go Live">
              ● {staged.book_title} {staged.chapter_number}:{staged.verse_number}
            </span>
          )}
          <button className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close drawer">
            <IconClose />
          </button>
        </div>

        <div className="drawer-body">
          {drawerTab === 'search' ? (
            <div className="drawer-search">
              {query.length > 0 && (
                <div className="search-results-count">
                  {totalResults === 0 && results.length === 0
                    ? 'No verses found'
                    : totalResults > 0
                      ? `${totalResults.toLocaleString()} verse${totalResults === 1 ? '' : 's'} found`
                      : `${results.length} verse${results.length === 1 ? '' : 's'} found`}
                </div>
              )}
              <input
                type="search"
                inputMode="search"
                enterKeyHint="search"
                className="search-input"
                placeholder="John 3:16 or 'faith'…"
                value={query}
                onChange={handleSearch}
                onKeyDown={handleSearchKeyDown}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={drawerOpen && drawerTab === 'search'}
              />
              <div className="results-list-wrap">
                <div className="results-list"
                  ref={resultsListRef}
                  onScroll={e => setResultsScrolled(e.currentTarget.scrollTop > 120)}>
                  {results.length > 0
                    ? <SearchResults
                        results={results}
                        currentPage={currentPage}
                        totalPages={totalPages}
                        totalResults={totalResults}
                        onSelect={selectVerse}
                        onGoLive={goLiveDirectly}
                        onAddToSetlist={addToSetlist}
                        onPageChange={(newPage) => {
                          searchAppendRef.current = true;
                          setCurrentPage(newPage);
                          emitWithSession('search', { query, page: newPage, pageSize: PAGE_SIZE, language: currentLanguage });
                        }}
                        stagedVerseId={staged?.verse_id}
                        onToggleTranslation={toggleTranslation}
                        expandedTranslations={expandedTranslations}
                        translationCache={translationCache}
                        currentLanguage={currentLanguage}
                        sentinelRef={searchSentinelRef}
                      />
                    : <div className="empty-state">
                        {query.length > 0 ? 'No verses found' : <>Search for a verse<br />to begin…</>}
                      </div>
                  }
                </div>
                {resultsScrolled && (
                  <button className="ctx-back-to-top"
                    onClick={() => { if (resultsListRef.current) { resultsListRef.current.scrollTop = 0; setResultsScrolled(false); } }}
                    aria-label="Back to top">↑</button>
                )}
              </div>
            </div>
          ) : drawerTab === 'history' ? (
            <div className="drawer-history">
              {history.length > 0 ? (() => {
                // Group consecutive entries by book for a cleaner scan
                const groups = [];
                history.forEach(verse => {
                  const last = groups[groups.length - 1];
                  if (last && last.book === verse.book_title) last.verses.push(verse);
                  else groups.push({ book: verse.book_title, verses: [verse] });
                });
                const elapsed = (ts) => {
                  if (!ts) return '';
                  const m = Math.round((Date.now() - ts) / 60000);
                  if (m < 1) return 'just now';
                  if (m < 60) return `${m}m ago`;
                  return `${Math.round(m / 60)}h ago`;
                };
                return (
                  <div className="history-groups">
                    {groups.map((group, gi) => (
                      <div key={gi} className="history-group">
                        <div className="history-group-label">{group.book}</div>
                        <ul className="history-list">
                          {group.verses.map((verse, vi) => (
                            <li key={verse.verse_id ?? vi} className="history-item">
                              <div className="history-item-main" onClick={() => { setStaged(verse); setDrawerOpen(false); }}>
                                <span className="history-ref">{verse.chapter_number}:{verse.verse_number}</span>
                                <span className="history-time">{elapsed(verse._ts)}</span>
                              </div>
                              <div className="history-item-actions">
                                <button className="history-action-btn" onClick={() => { setStaged(verse); setDrawerOpen(false); }}>Stage</button>
                                <button className="history-action-btn" onClick={() => goLiveDirectly(verse)}>●</button>
                                <button className="history-action-btn" onClick={() => addToSetlist(verse)}>+</button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                );
              })() : (
                <div className="empty-state">Verses you display<br />will appear here</div>
              )}
            </div>
          ) : drawerTab === 'setlist' ? (
            <div className="drawer-setlist">
              {/* ── F3/F12 toolbar ── */}
              <div className="setlist-toolbar">
                <button className="setlist-toolbar-btn" onClick={() => setSetlistSaveOpen(o => !o)}>↓ Save</button>
                <button className="setlist-toolbar-btn" onClick={() => { setSetlistLoadOpen(o => !o); if (!setlistLoadOpen) fetchSavedSetlists(); }}>↑ Load</button>
                <button className="setlist-toolbar-btn" onClick={() => setRunsheetAddingText(o => !o)}>+ Text</button>
              </div>
              {setlistSaveOpen && (
                <div className="setlist-save-row">
                  <input className="popover-input" placeholder="Setlist name…" value={setlistSaveName}
                    onChange={e => setSetlistSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveSetlist()} />
                  <button className="popover-apply" onClick={saveSetlist}>Save</button>
                </div>
              )}
              {setlistLoadOpen && (
                <div className="setlist-load-list">
                  {setlistsLoading ? <div className="empty-state">Loading…</div>
                  : savedSetlists.length === 0 ? <div className="empty-state">No saved setlists</div>
                  : savedSetlists.map(s => (
                    <div key={s.id} className="setlist-load-item">
                      <div className="setlist-load-item-info" onClick={() => loadSetlist(s)}>
                        <span className="setlist-load-item-name">{s.name}</span>
                        <span className="setlist-load-item-count">{s.items.length} item{s.items.length !== 1 ? 's' : ''}</span>
                      </div>
                      <button className="setlist-remove-btn" onClick={() => deleteSavedSetlist(s.id)}>×</button>
                    </div>
                  ))}
                </div>
              )}
              {runsheetAddingText && (
                <div className="setlist-text-draft-area">
                  <input className="popover-input" placeholder="Announcement text…" value={runsheetTextDraft}
                    onChange={e => setRunsheetTextDraft(e.target.value)} />
                  <input className="popover-input" placeholder="Subtext (optional)" value={runsheetSubtextDraft}
                    onChange={e => setRunsheetSubtextDraft(e.target.value)} />
                  <div className="setlist-draft-actions">
                    <button className="popover-apply" onClick={addTextItem}>Add</button>
                    <button className="theme-btn" onClick={() => setRunsheetAddingText(false)}>Cancel</button>
                  </div>
                </div>
              )}
              {setlist.length > 0 ? (
                <>
                  <div className="setlist-hint">Tap ● to go live · ↑↓ to reorder · × to remove</div>
                  <ul className="setlist-list">
                    {setlist.map((item, i) => {
                      const isTextItem = item.type === 'text';
                      const itemKey = item.verse_id ?? item.id;
                      return (
                        <li key={itemKey} className={`setlist-item${isTextItem ? ' setlist-item--text' : ''}${liveVerse?.verse_id === item.verse_id ? ' setlist-item--live' : ''}`}>
                          <div className="setlist-order">
                            <button className="setlist-move-btn" onClick={() => moveSetlistItem(i, i - 1)} disabled={i === 0} aria-label="Move up">↑</button>
                            <span className="setlist-num">{i + 1}</span>
                            <button className="setlist-move-btn" onClick={() => moveSetlistItem(i, i + 1)} disabled={i === setlist.length - 1} aria-label="Move down">↓</button>
                          </div>
                          <div className="setlist-verse-info" onClick={() => !isTextItem && setStaged(item)}>
                            {isTextItem ? (
                              <>
                                <span className="setlist-ref">📢 {item.customText?.slice(0, 40)}{item.customText?.length > 40 ? '…' : ''}</span>
                                {item.customSubtext && <span className="setlist-text">{item.customSubtext}</span>}
                              </>
                            ) : (
                              <>
                                <span className="setlist-ref">{item.book_title} {item.chapter_number}:{item.verse_number}</span>
                                <span className="setlist-text">{item.scripture_text?.slice(0, 60)}…</span>
                              </>
                            )}
                            <button className="setlist-notes-btn" onClick={e => { e.stopPropagation(); toggleNotesExpanded(itemKey); }} title="Notes">
                              {notesExpandedFor.has(itemKey) ? '▴' : '✎'}
                            </button>
                            {notesExpandedFor.has(itemKey) && (
                              <textarea className="setlist-notes-area" placeholder="Private notes (not shown on TV)…"
                                value={verseNotes[itemKey] || ''} onClick={e => e.stopPropagation()}
                                onChange={e => updateVerseNote(itemKey, e.target.value)} rows={2} />
                            )}
                          </div>
                          <div className="setlist-actions">
                            <button className="setlist-live-btn" onClick={() => goLiveFromSetlist(item)}>●</button>
                            <button className="setlist-remove-btn" onClick={() => removeFromSetlist(itemKey)}>×</button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  <button className="setlist-clear-btn" onClick={() => { if (window.confirm('Clear entire setlist?')) setSetlist([]); }}>Clear Setlist</button>
                </>
              ) : (
                <div className="empty-state">No items yet.<br />Search and tap + to add,<br />or use + Text for announcements.</div>
              )}
            </div>
          ) : (
            <div className="drawer-browse">
              {browseLevel !== 'books' && (
                <button className="browse-back-btn" onClick={() => setBrowseLevel(browseLevel === 'verses' ? 'chapters' : 'books')}>
                  <IconChevronLeft />
                  {browseLevel === 'verses'
                    ? `${browseSelectedBook?.book_title} ${browseSelectedChapter?.chapter_number}`
                    : browseSelectedBook?.book_title}
                </button>
              )}
              {browseLevel === 'books' && (
                browseBooks.length === 0
                  ? <div className="empty-state">Loading…</div>
                  : <ul className="browse-book-list">
                      {browseBooks.map(b => (
                        <li key={b.book_id} className="browse-book-item" onClick={() => handleBrowseBook(b)}>
                          <div className="browse-book-info">
                            <span className="browse-book-title">{b.book_title}</span>
                            <span className="browse-book-meta">{b.volume_short_title} · {b.chapter_count} ch</span>
                          </div>
                          <IconChevronRight />
                        </li>
                      ))}
                    </ul>
              )}
              {browseLevel === 'chapters' && (
                <div className="browse-chapter-grid">
                  {browseChapters.map(c => (
                    <button key={c.chapter_id} className="browse-chapter-btn" onClick={() => handleBrowseChapter(c)}>
                      {c.chapter_number}
                    </button>
                  ))}
                </div>
              )}
              {browseLevel === 'verses' && (
                <ul className="browse-verse-list">
                  {browseVerses.map(v => (
                    <li key={v.verse_id}
                      className={`browse-verse-item${Number(v.verse_id) === Number(staged?.verse_id) ? ' browse-verse-item--staged' : ''}`}
                      onClick={() => { selectVerse(v); setDrawerOpen(false); }}>
                      <span className="browse-verse-num">{v.verse_number}</span>
                      <span className="browse-verse-text">{v.scripture_text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Backdrop */}
      {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} />}

      {/* ════════════════════════════════════════
          MAIN CONTENT AREA
          ════════════════════════════════════════ */}
      <main className="main-panel" ref={mainPanelRef}>

        {/* ══ IDLE WELCOME STATE ══════════════════════════════════
            Shown only when nothing is staged or live yet.
            ═══════════════════════════════════════════════════════ */}
        {isIdle && (
          <div className="idle-state">

            {/* ── Verse of the Day ───────────────────────────── */}
            <section className="card idle-votd">
              <div className="card-header">
                <span className="card-label">✦ Verse of the Day</span>
                <span className="card-hint">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              </div>
              {verseOfDay ? (
                <>
                  <p className="votd-text">"{verseOfDay.scripture_text}"</p>
                  <div className="votd-footer">
                    <span className="votd-ref">— {verseOfDay.book_title} {verseOfDay.chapter_number}:{verseOfDay.verse_number}{verseOfDay.version_citation ? ` (${verseOfDay.version_citation})` : ''}</span>
                    <div className="votd-actions">
                      <button className="votd-btn" title="Copy verse text" onClick={() => {
                        copyVerseText(verseOfDay, '');
                        setVotdCopied(true);
                        setTimeout(() => setVotdCopied(false), 1800);
                      }}>{votdCopied ? '✓ Copied' : 'Copy'}</button>
                      <button className="votd-btn" title="Stage this verse" onClick={() => {
                        setStaged({ ...verseOfDay, theme: themeForVerse(currentTheme, verseOfDay) });
                      }}>Stage</button>
                      <button className="votd-btn votd-btn--live" title="Go live with this verse" onClick={() => {
                        goLiveDirectly(verseOfDay);
                      }}>● Go Live</button>
                    </div>
                  </div>
                </>
              ) : votdError ? (
                <p className="votd-loading">Could not load verse — check the server is running.</p>
              ) : (
                <p className="votd-loading">Loading…</p>
              )}
            </section>

            {/* ── Two-column row: Session status + Ready checklist ── */}
            <div className="idle-grid">

              {/* Session card */}
              <section className="card idle-session">
                <div className="card-header">
                  <span className="card-label">⬡ Session</span>
                  <span className={`idle-conn-dot idle-conn-dot--${connectionState}`} title={connectionState} />
                </div>
                {sessionId ? (
                  <>
                    <div className="idle-session-id">{sessionId}</div>
                    <div className="idle-viewer-count">
                      <span className={`idle-viewer-dot ${viewerCount > 0 ? 'idle-viewer-dot--live' : ''}`} />
                      {viewerCount === 0 ? 'No screens connected' : viewerCount === 1 ? '1 screen connected' : `${viewerCount} screens connected`}
                    </div>
                    <p className="idle-session-hint">Connected to the TV session</p>
                  </>
                ) : (
                  <>
                    <p className="idle-session-hint">{sessionMessage}</p>
                    <button
                      className="idle-copy-btn"
                      onClick={() => { setScannerOpen(true); }}
                    >
                      <IconQr /> Scan TV QR Code
                    </button>
                  </>
                )}
              </section>

              {/* Ready checklist card */}
              <section className="card idle-checklist">
                <div className="card-header">
                  <span className="card-label">◈ Ready Check</span>
                </div>
                <ul className="idle-checks">
                  <li className={`idle-check ${connectionState === 'connected' ? 'idle-check--ok' : 'idle-check--wait'}`}>
                    <span className="idle-check-icon">{connectionState === 'connected' ? <IconCheck /> : '○'}</span>
                    <span>Server connected</span>
                  </li>
                  <li className={`idle-check ${sessionId ? 'idle-check--ok' : 'idle-check--wait'}`}>
                    <span className="idle-check-icon">{sessionId ? <IconCheck /> : '○'}</span>
                    <span>Session active</span>
                  </li>
                  <li className="idle-check idle-check--tip">
                    <span className="idle-check-icon"><IconBolt /></span>
                    <span>Search a verse to stage it</span>
                  </li>
                  <li className="idle-check idle-check--tip">
                    <span className="idle-check-icon"><IconBolt /></span>
                    <span>Hit ● Go Live to project</span>
                  </li>
                </ul>
              </section>

            </div>

            {/* ── Quick Topics ───────────────────────────────── */}
            <section className="card idle-topics">
              <div className="card-header">
                <span className="card-label">⚡ Quick Topics</span>
                <span className="card-hint">tap to search instantly</span>
              </div>
              <div className="idle-topic-chips">
                {QUICK_TOPICS.map(topic => (
                  <button
                    key={topic}
                    className="idle-chip"
                    onClick={() => launchTopic(topic)}
                  >
                    {topic}
                  </button>
                ))}
              </div>
            </section>

          </div>
        )}

        {/* ── Staged verse card ── */}
        {staged && (
          <section className="card card--staged">
            <div className="card-header">
              <span className="card-label">⏳ Staged</span>
              <div className="staging-nav">
                <button className="nav-button" onClick={() => fetchAdjacent('prev', true)}>← Prev</button>
                <button className="nav-button" onClick={() => fetchAdjacent('next', true)}>Next →</button>
              </div>
            </div>
            <div className="staged-verse-display">
              <p className="staged-text">{staged.scripture_text}</p>
              <div className="staged-caption">
                {staged.book_title}&ensp;{staged.chapter_number}:{staged.verse_number}
                {getCitation(currentLanguage, staged.volume_id, secondaryLanguage) && (
                  <span className="staged-caption-volume">
                    {getCitation(currentLanguage, staged.volume_id, secondaryLanguage)}
                  </span>
                )}
              </div>
            </div>
            {/* POV mood badge + doctrine chips on staged verse */}
            {(chapterEntities.people.length > 0 || chapterEntities.places.length > 0 || verseTags.pov) && (
              <div className="preview-entity-chips">
                {verseTags.pov && <span className="ctx-pov-badge">{verseTags.pov}</span>}
                {verseTags.speaker && <span className="ctx-pov-badge ctx-pov-badge--speaker" title="Speaker">✍ {verseTags.speaker}</span>}
                {verseTags.labels.slice(0, 3).map(t => (
                  <button key={t.label} className="ctx-doctrine-chip ctx-doctrine-chip--preview ctx-doctrine-chip--clickable"
                    onClick={() => {
                      setContextTab('related');
                      setContextOpen(true);
                      loadTopicInModal(t.label);
                    }}>
                    {t.label}
                  </button>
                ))}
                {chapterEntities.people.slice(0, 3).map(p => (
                  <button key={p} className="ctx-entity-chip ctx-entity-chip--person ctx-doctrine-chip--clickable"
                    onClick={() => openEntitySearchInModal(p, 'person')}>
                    {p}
                  </button>
                ))}
                {chapterEntities.places.slice(0, 2).map(p => (
                  <button key={p} className="ctx-entity-chip ctx-entity-chip--place ctx-doctrine-chip--clickable"
                    onClick={() => openEntitySearchInModal(p, 'place')}>
                    {p}
                  </button>
                ))}
              </div>
            )}
            <button className={`go-live-button${activeTourTarget === 'golive' ? ' tour-focus' : ''}`} onClick={goLive}>● Go Live</button>
          </section>
        )}

        {/* ── Live preview card ── */}
        {liveVerse && (
          <section className="card card--preview">
            <div className="card-header">
              <span className="card-label">👁 Preview</span>
              <div className="preview-card-actions">
                {highlightedText && (
                  <button className="clear-highlight-btn" onClick={clearHighlight} title="Clear highlight (Esc)">
                    ✕ Highlight
                  </button>
                )}
                <span className="card-hint">select text to highlight</span>
                <button className="context-expand-btn"
                  onClick={() => { setContextTab('chapter'); openContextModal('chapter'); }}
                  title="Chapter & related scriptures">
                  ☰ Context
                </button>
                <button
                  className={`now-reading-btn${nowReading ? ' now-reading-btn--on' : ''}`}
                  onClick={toggleNowReading}
                  title="Toggle 'Now Reading' label on the TV screen">
                  📖{nowReading ? ' On' : ' Off'}
                </button>
                <button className={`end-live-btn${clearArmed ? ' end-live-btn--armed' : ''}`} onClick={endLive} title="End live — clears TV screen (E)">
                  {clearArmed ? '⚠ Confirm?' : '◼ End Live'}
                </button>
              </div>
            </div>
            {/* Session status while live */}
            <div className="preview-session-status">
              <span className={`preview-conn-dot preview-conn-dot--${connectionState}`} />
              <span className="preview-session-text">
                {viewerCount === 0 ? 'No screens connected' : viewerCount === 1 ? '1 screen connected' : `${viewerCount} screens connected`}
                {sessionId && <span className="preview-session-id"> · {sessionId}</span>}
              </span>
            </div>
            <div className={`preview-nav${activeTourTarget === 'nav' ? ' tour-focus' : ''}`}>
              <button className="preview-nav-btn preview-nav-btn--verse" onClick={() => fetchAdjacent('prev')} aria-label="Previous verse" title="Previous verse">
                <IconChevronLeft /><IconChevronLeft />
              </button>
              <button className="preview-nav-btn" onClick={() => navigateSegment('prev')}
                disabled={!hasSegments || currentSegment === 0} aria-label="Previous segment" title="Previous segment">
                <IconChevronLeft />
              </button>
              <div className="preview-nav-meta">
                <span>{liveVerse.book_title} {liveVerse.chapter_number}:{liveVerse.verse_number}</span>
                {hasSegments && (
                  <div className="segment-dots-presenter">
                    {liveVerse.segments.map((_, idx) => (
                      <span key={idx} className={`seg-dot${idx === currentSegment ? ' seg-dot--active' : idx < currentSegment ? ' seg-dot--past' : ''}`} />
                    ))}
                  </div>
                )}
              </div>
              <button className="preview-nav-btn" onClick={() => navigateSegment('next')}
                disabled={!hasSegments || currentSegment === liveVerse.segments.length - 1}
                aria-label="Next segment" title="Next segment">
                <IconChevronRight />
              </button>
              <button className="preview-nav-btn preview-nav-btn--verse" onClick={() => fetchAdjacent('next')} aria-label="Next verse" title="Next verse">
                <IconChevronRight /><IconChevronRight />
              </button>
            </div>
            <div
              className={`preview-box${currentTheme?.background_url ? ' preview-box--has-bg' : ''}`}
              onMouseUp={handlePreviewTextSelection}
              style={{
                backgroundImage: currentTheme?.background_url || undefined,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                fontFamily: currentTheme?.font_family || undefined,
              }}
            >
              <div className="preview-text">{renderPreviewText()}</div>
              {(liveVerse.secondary_segments?.[currentSegment] || liveVerse.secondary_text) && (
                <p className="preview-secondary-text">
                  {liveVerse.secondary_segments?.[currentSegment] || liveVerse.secondary_text}
                </p>
              )}
              {hasSegments && currentSegment < liveVerse.segments.length - 1 && (
                <div className="preview-cont">cont…</div>
              )}
              {liveVerse.book_title && liveVerse.chapter_number && liveVerse.verse_number && (
                <div className="preview-caption">
                  {liveVerse.book_title}&ensp;{liveVerse.chapter_number}:{liveVerse.verse_number}
                  {liveVerse.version_citation && (
                    <span className="preview-caption-volume">{liveVerse.version_citation}</span>
                  )}
                </div>
              )}
            </div>
            {/* Clickable chips at bottom of preview — open Related tab */}
            {(verseTags.labels.length > 0 || chapterEntities.people.length > 0 || chapterEntities.places.length > 0) && (
              <div className="preview-entity-chips">
                {verseTags.labels.slice(0, 3).map(t => (
                  <button key={t.label} className="ctx-doctrine-chip ctx-doctrine-chip--preview ctx-doctrine-chip--clickable"
                    onClick={() => { setContextTab('related'); setContextOpen(true); loadTopicInModal(t.label); }}>
                    {t.label}
                  </button>
                ))}
                {chapterEntities.people.slice(0, 3).map(p => (
                  <button key={p} className="ctx-entity-chip ctx-entity-chip--person ctx-doctrine-chip--clickable"
                    onClick={() => openEntitySearchInModal(p, 'person')}>
                    {p}
                  </button>
                ))}
                {chapterEntities.places.slice(0, 2).map(p => (
                  <button key={p} className="ctx-entity-chip ctx-entity-chip--place ctx-doctrine-chip--clickable"
                    onClick={() => openEntitySearchInModal(p, 'place')}>
                    {p}
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ── F2 / F12 — Announcement card ── */}
        <section className="card card--custom">
          <div className="card-header">
            <span className="card-label">📢 Announcement</span>
            {isCustomLive && <button className="end-live-btn" onClick={endLive}>◼ End Custom</button>}
          </div>
          <div className="custom-text-form">
            <textarea className="custom-text-area" placeholder="Text shown large on screen…"
              value={customText} onChange={e => setCustomText(e.target.value)} rows={3} />
            <input className="custom-subtext-input" type="text" placeholder="Subtext / attribution (optional)"
              value={customSubtext} onChange={e => setCustomSubtext(e.target.value)} />
          </div>
          <button className={`go-live-button${!customText.trim() ? ' go-live-button--disabled' : ''}`}
            disabled={!customText.trim()} onClick={sendCustomToScreen}>
            ▶ Send to Screen
          </button>
        </section>

        {/* ── Theme card — collapsible ── */}
        <section className="card card--theme">
          <div
            className="card-header card-header--clickable"
            onClick={() => setThemeCardOpen(o => !o)}
            title={themeCardOpen ? 'Collapse theme controls' : 'Expand theme controls'}
          >
            <span className="card-label">🎨 Theme &amp; Display</span>
            <span className="card-collapse-icon">{themeCardOpen ? '▲' : '▼'}</span>
          </div>
          {themeCardOpen && (
            <>
              <div className="theme-buttons">
                <button className={`theme-btn${currentTheme === themes.light ? ' active' : ''}`} onClick={() => handleThemeChange({ ...themes.light, force_animations: !!currentTheme.force_animations })}>☀ Light</button>
                <button className={`theme-btn${currentTheme === themes.dark ? ' active' : ''}`} onClick={() => handleThemeChange({ ...themes.dark, force_animations: !!currentTheme.force_animations })}>☽ Dark</button>
                <button
                  className={`theme-btn${currentTheme.force_animations ? ' active' : ''}`}
                  onClick={() => handleThemeChange({ ...currentTheme, force_animations: !currentTheme.force_animations })}
                  title="Override reduced-motion and force client animations"
                >
                  {currentTheme.force_animations ? 'Animations: Forced On' : 'Animations: Auto (Respect OS)'}
                </button>
              </div>
              <div className="theme-buttons" style={{ marginTop: '0.4rem' }}>
                {[
                  { value: 'crossfade',  label: '⊙ Fade' },
                  { value: 'slide-up',   label: '↑ Slide' },
                  { value: 'fade-black', label: '◼ Black' },
                  { value: 'cut',        label: '⚡ Cut' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    className={`theme-btn${(currentTheme.transition_mode || 'crossfade') === value ? ' active' : ''}`}
                    onClick={() => handleThemeChange({ ...currentTheme, transition_mode: value })}
                  >{label}</button>
                ))}
              </div>
              {/* Live preview tile */}
              <div className="theme-preview-tile" style={{
                backgroundImage: currentTheme?.background_url || undefined,
                fontFamily: currentTheme?.font_family || undefined,
              }}>
                <span className="theme-preview-text" style={{
                  color: currentTheme?.tone === 'light' ? 'rgba(18,8,2,0.95)' : 'rgba(248,240,222,0.97)',
                }}>
                  {staged?.scripture_text?.slice(0, 60) || liveVerse?.scripture_text?.slice(0, 60) || 'Scripture preview…'}
                </span>
              </div>
              {/* Font size control */}
              <div className="font-size-controls">
                <span className="font-size-label">Text Size</span>
                <button className="font-size-btn" onClick={() => adjustFontSize(-0.3)} title="Smaller text" aria-label="Decrease font size">−</button>
                <span className="font-size-badge">{fontSizeRem.toFixed(1)}rem</span>
                <button className="font-size-btn" onClick={() => adjustFontSize(0.3)} title="Larger text" aria-label="Increase font size">+</button>
              </div>
              <div className="font-size-controls">
                <span className="font-size-label">Reading Size</span>
                <button className="font-size-btn" onClick={() => adjustUiFontSize(-0.1)} title="Smaller reading text" aria-label="Decrease reading font size">−</button>
                <span className="font-size-badge">{uiFontSize.toFixed(1)}×</span>
                <button className="font-size-btn" onClick={() => adjustUiFontSize(0.1)} title="Larger reading text" aria-label="Increase reading font size">+</button>
              </div>
              <div className="font-size-controls">
                <span className="font-size-label">Auto-Advance</span>
                <button
                  className={`font-size-btn${autoAdvance ? ' active' : ''}`}
                  onClick={() => setAutoAdvance(v => !v)}
                  title={autoAdvance ? 'Disable auto-advance' : 'Enable auto-advance segments'}
                  style={{ minWidth: '3.5rem', fontSize: '0.7rem' }}
                >{autoAdvance ? 'ON' : 'OFF'}</button>
                <button className="font-size-btn" onClick={() => setAutoAdvanceSec(s => Math.max(3, s - 1))} title="Shorter dwell time">−</button>
                <span className="font-size-badge">{autoAdvanceSec}s</span>
                <button className="font-size-btn" onClick={() => setAutoAdvanceSec(s => Math.min(30, s + 1))} title="Longer dwell time">+</button>
              </div>
              <div className="theme-inputs">
                <div className="theme-control-group">
                  <label htmlFor="bg-url">Background URL</label>
                  <div className="input-group">
                    <input id="bg-url" type="text" placeholder="https://example.com/image.jpg" value={bgUrlInput} onChange={e => setBgUrlInput(e.target.value)} />
                    <button className="control-button" onClick={() => {
                      if (!bgUrlInput) return;
                      handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` });
                      setBgUrlInput('');
                    }}>Apply</button>
                  </div>
                </div>
                <div className="theme-control-group">
                  <label htmlFor="font-family-sel">Font Family</label>
                  <select
                    id="font-family-sel"
                    className="theme-select"
                    value={currentTheme?.font_family || FONT_FAMILIES[0].value}
                    onChange={e => handleThemeChange({ ...currentTheme, font_family: e.target.value })}
                  >
                    {FONT_FAMILIES.map(f => (
                      <option key={f.value} value={f.value}>{f.label}</option>
                    ))}
                  </select>
                </div>
                <div className="theme-control-group">
                  <label htmlFor="highlight-color">Highlight Color</label>
                  <input
                    id="highlight-color"
                    type="color"
                    className="theme-color-input"
                    value={currentTheme?.highlight_color || '#ffe8b6'}
                    onChange={e => handleThemeChange({ ...currentTheme, highlight_color: e.target.value })}
                    title="Choose highlight text color for client display"
                  />
                </div>
              </div>
            </>
          )}
        </section>

      </main>
      {/* Toast notification */}
      {toastMsg && (
        <div className="presenter-toast" role="status" aria-live="polite">
          {toastMsg}
        </div>
      )}

      {/* Desktop footer — hidden on mobile via CSS; links live in hamburger menu on small screens */}
      <footer className="presenter-footer">
        <nav className="presenter-footer-links">
          <a href="/">Home</a>
          <a href="/presenter">Present</a>
          <a href="/client">Display</a>
          <a href="/about">About</a>
          <a href="/contact">Contact</a>
          <a href="/privacy">Privacy Policy</a>
          <a href="/terms">Terms of Service</a>
        </nav>
        <div className="presenter-footer-credit">
          © {new Date().getFullYear()} Scripture Projection Engine. Sacred Tech by Dagami Ward Dev Team.
        </div>
      </footer>

      {/* Sticky Go Live bar — mobile only, appears when a verse is staged */}
      {(staged || liveVerse) && (
        <div className="mobile-golive-bar">
          <button
            className="mobile-nav-btn"
            onClick={() => fetchAdjacent('prev', !liveVerse)}
            aria-label="Previous verse"
          >‹</button>
          <div className="mobile-golive-ref">
            {(staged || liveVerse).book_title} {(staged || liveVerse).chapter_number}:{(staged || liveVerse).verse_number}
          </div>
          <button
            className="mobile-nav-btn"
            onClick={() => fetchAdjacent('next', !liveVerse)}
            aria-label="Next verse"
          >›</button>
          <div className="mobile-golive-actions">
            {liveVerse && (
              <>
                <button className="mobile-font-btn" onClick={() => adjustFontSize(-0.3)} title="Smaller text" aria-label="Decrease font size">A−</button>
                <button className="mobile-font-btn" onClick={() => adjustFontSize( 0.3)} title="Larger text"  aria-label="Increase font size">A+</button>
                <button className={`mobile-endlive-btn${clearArmed ? ' end-live-btn--armed' : ''}`} onClick={endLive} title="End live">{clearArmed ? '?' : '◼ End'}</button>
              </>
            )}
            {staged && (
              <button
                className={`mobile-golive-btn${activeTourTarget === 'golive' ? ' tour-focus' : ''}`}
                onClick={goLive}
              >
                ● Go Live
              </button>
            )}
          </div>
        </div>
      )}

      {/* PIN Entry Modal — shown when a password-protected session requires a PIN */}
      {pinEntryOpen && (
        <div className="pin-modal-backdrop" onClick={() => { setPinEntryOpen(false); setSessionMessage(''); }}>
          <div className="pin-modal" onClick={e => e.stopPropagation()}>
            <div className="pin-modal-title">Session PIN Required</div>
            <div className="pin-modal-hint">This session is protected. Ask the operator for the PIN.</div>
            <input
              className="pin-modal-input"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinInput}
              autoFocus
              onChange={e => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(''); }}
              onKeyDown={e => e.key === 'Enter' && joinTvSession(pendingPinSession, pinInput)}
              placeholder="••••"
              aria-label="Session PIN"
            />
            {pinError && <div className="pin-modal-error">{pinError}</div>}
            <div className="pin-modal-row">
              <button className="pin-modal-btn" onClick={() => joinTvSession(pendingPinSession, pinInput)}>Unlock</button>
              <button className="pin-modal-btn pin-modal-btn--cancel" onClick={() => { setPinEntryOpen(false); setSessionMessage(''); }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* PIN Management Modal — set / change / remove the PIN for this session */}
      {pinManageOpen && (
        <div className="pin-modal-backdrop" onClick={() => setPinManageOpen(false)}>
          <div className="pin-modal" onClick={e => e.stopPropagation()}>
            <div className="pin-modal-title">{sessionPinActive ? 'Change Session PIN' : 'Set Session PIN'}</div>
            <div className="pin-modal-hint">4–8 digit PIN. Required for future presenters joining this session.</div>
            <input
              className="pin-modal-input"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinManageInput}
              autoFocus
              onChange={e => { setPinManageInput(e.target.value.replace(/\D/g, '')); setPinManageError(''); }}
              onKeyDown={e => e.key === 'Enter' && pinManageInput === pinManageConfirm && handleSetPin()}
              placeholder="New PIN"
              aria-label="New PIN"
            />
            <input
              className="pin-modal-input"
              type="password"
              inputMode="numeric"
              maxLength={8}
              value={pinManageConfirm}
              onChange={e => { setPinManageConfirm(e.target.value.replace(/\D/g, '')); setPinManageError(''); }}
              onKeyDown={e => e.key === 'Enter' && pinManageInput === pinManageConfirm && handleSetPin()}
              placeholder="Confirm PIN"
              aria-label="Confirm PIN"
            />
            {pinManageError && <div className="pin-modal-error">{pinManageError}</div>}
            <div className="pin-modal-row">
              <button className="pin-modal-btn" onClick={handleSetPin}>
                {sessionPinActive ? 'Update PIN' : 'Set PIN'}
              </button>
              {sessionPinActive && (
                <button className="pin-modal-btn pin-modal-btn--danger" onClick={handleClearPin}>Remove PIN</button>
              )}
              <button className="pin-modal-btn pin-modal-btn--cancel" onClick={() => setPinManageOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Context Expansion Modal — Chapter view and semantic related scriptures */}
      {contextOpen && (
        <div className="ctx-backdrop" onClick={() => setContextOpen(false)}>
          <div className="ctx-modal" onClick={e => e.stopPropagation()}>
            <div className="ctx-header">
              <span className="ctx-title">
                {contextTab === 'chapter' && bookChapters[ctxChapterIdx]
                  ? `${liveVerse.book_title} ${bookChapters[ctxChapterIdx].chapter_number}`
                  : contextTab === 'summary'
                    ? `Chapter ${bookChapters[ctxChapterIdx]?.chapter_number ?? liveVerse.chapter_number} Summary`
                    : contextTab === 'entities'
                      ? 'Peoples and Places'
                      : `${liveVerse.book_title} ${liveVerse.chapter_number}:${liveVerse.verse_number}`}
              </span>
              <button className="ctx-close" onClick={() => setContextOpen(false)}>✕</button>
            </div>

            <div className="ctx-tabs">
              <button className={`ctx-tab${contextTab === 'chapter' ? ' ctx-tab--active' : ''}`}
                onClick={() => switchCtxTab(contextTab, 'chapter', () => { setContextTab('chapter'); setCtxWordChip(null); if (!chapterVerses.length) openContextModal('chapter'); })}>
                Chapter {bookChapters[ctxChapterIdx]?.chapter_number ?? liveVerse.chapter_number}
              </button>
              <button className={`ctx-tab${contextTab === 'related' ? ' ctx-tab--active' : ''}`}
                onClick={() => switchCtxTab(contextTab, 'related', () => { setContextTab('related'); if (!relatedVerses.length) openContextModal('related'); })}>
                Related
                {relatedConcept && (
                  <span className="ctx-concept-tag">
                    {relatedConcept.replace(/^_+/, '').replace(/_/g, ' ')}
                  </span>
                )}
              </button>
              <button className={`ctx-tab${contextTab === 'summary' ? ' ctx-tab--active' : ''}`}
                onClick={() => switchCtxTab(contextTab, 'summary', () => { setContextTab('summary'); if (!chapterSummary.ready) openContextModal('chapter'); })}>
                Chapter Summary
              </button>
              <button className={`ctx-tab${contextTab === 'verse-context' ? ' ctx-tab--active' : ''}`}
                onClick={() => switchCtxTab(contextTab, 'verse-context', () => setContextTab('verse-context'))}>
                Verse Context
              </button>
              <button className={`ctx-tab${contextTab === 'entities' ? ' ctx-tab--active' : ''}`}
                onClick={() => switchCtxTab(contextTab, 'entities', () => { setContextTab('entities'); setEntitySearch(null); if (!chapterEntities.ready) openContextModal('chapter'); })}>
                People &amp; Places
              </button>
            </div>

            <div className="ctx-body-wrap">
              <div className="ctx-body"
                ref={ctxBodyRef}
                onScroll={handleCtxBodyScroll}
                onTouchStart={handleCtxTouchStart}
                onTouchEnd={handleCtxTouchEnd}
                onMouseUp={contextTab === 'related' ? handleCtxTextMouseUp : undefined}>
                {contextLoading ? (
                  <div className="ctx-loading">Loading…</div>
                ) : contextTab === 'chapter' ? (
                  <>
                    {bookChapters.length > 1 && (
                      <div className="ctx-chapter-nav">
                        <button className="ctx-chapter-arrow"
                          disabled={ctxChapterIdx <= 0}
                          onClick={() => loadCtxChapterByIdx(ctxChapterIdx - 1)}
                          aria-label="Previous chapter">‹ Prev</button>
                        <span className="ctx-chapter-indicator">
                          Ch {bookChapters[ctxChapterIdx]?.chapter_number ?? liveVerse.chapter_number}
                          {' '}<span className="ctx-chapter-indicator-of">of {bookChapters.length}</span>
                        </span>
                        <button className="ctx-chapter-arrow"
                          disabled={ctxChapterIdx >= bookChapters.length - 1}
                          onClick={() => loadCtxChapterByIdx(ctxChapterIdx + 1)}
                          aria-label="Next chapter">Next ›</button>
                      </div>
                    )}
                    <ul className={`ctx-list${ctxSlideDir ? ` ctx-list--exit-${ctxSlideDir}` : ' ctx-list--enter'}`}>
                      {chapterVerses.map(v => {
                        const isLive = v.verse_id === liveVerse.verse_id;
                        return (
                         <li key={v.verse_id}
                           ref={isLive ? el => {
                             if (!el) return;
                             if (ctxUserScrolled.current && ctxLastScrolledVerse.current === v.verse_id) return;
                             ctxLastScrolledVerse.current = v.verse_id;
                             setTimeout(() => {
                               ctxProgrammaticScroll.current = true;
                               el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                               setTimeout(() => { ctxProgrammaticScroll.current = false; }, 500);
                             }, 150);
                           } : undefined}
                           className={`ctx-item${isLive ? ' ctx-item--live' : ''}`}>
                           <span className="ctx-item-ref">{v.verse_number}</span>
                           <span className="ctx-item-text">{v.scripture_text}</span>
                           <div className="ctx-item-actions">
                             <button onClick={() => { setStaged({...v, theme: themeForVerse(currentTheme, v)}); setContextOpen(false); }}>Stage</button>
                             <button onClick={() => addToSetlist(v)}>+ List</button>
                             <button onClick={() => { goLiveDirectly(v); setContextOpen(false); }}>● Live</button>
                           </div>
                         </li>
                        );
                      })}
                    </ul>
                  </>
                ) : contextTab === 'related' ? (
                  <>
                    {(() => {
                      const _totalServerPages = relatedTotal > 0 ? Math.ceil(relatedTotal / RELATED_PAGE_SIZE) : 1;
                      return (
                        <>
                          {/* Topic drill-down back/forward (when navigating between different topics) */}
                          {ctxTopicHistory.length > 1 && (
                            <div className="ctx-topic-nav">
                              <button
                                className="ctx-topic-nav-btn"
                                disabled={ctxTopicHistoryIdx <= 0}
                                onClick={ctxTopicBack}
                                title="Previous topic"
                              >◀</button>
                              <span className="ctx-topic-nav-label">
                                {relatedConcept
                                  ? relatedConcept.replace(/^_+/, '').replace(/_/g, ' ')
                                  : 'Related'}
                              </span>
                              <button
                                className="ctx-topic-nav-btn"
                                disabled={ctxTopicHistoryIdx >= ctxTopicHistory.length - 1}
                                onClick={ctxTopicForward}
                                title="Next topic"
                              >▶</button>
                            </div>
                          )}
                          {ctxTopicHistory.length <= 1 && relatedConcept && (
                            <div className="ctx-topic-nav">
                              <span className="ctx-topic-nav-label">
                                {relatedConcept.replace(/^_+/, '').replace(/_/g, ' ')}
                              </span>
                            </div>
                          )}
                          {_totalServerPages > 1 && (
                            <div className="ctx-paginator">
                              <button disabled={relatedBatchPage <= 0} onClick={() => loadHistoryPage(relatedBatchPage - 1)}>◀</button>
                              <span>Page {relatedBatchPage + 1} of {_totalServerPages}</span>
                              <button disabled={relatedBatchPage >= _totalServerPages - 1} onClick={() => loadHistoryPage(relatedBatchPage + 1)}>▶</button>
                            </div>
                          )}
                          <ul className="ctx-list">
                            {relatedVerses.length === 0
                              ? <li className="ctx-empty">No related verses found.</li>
                              : relatedVerses.map(v => (
                                  <li key={v.verse_id} className="ctx-item">
                                    <span className="ctx-item-ref">{v.verse_title}</span>
                                    <span className="ctx-item-text">{v.scripture_text}</span>
                                    {v.matched_concept && (
                                      <button
                                        className="ctx-concept-tag ctx-concept-tag--link"
                                        onClick={() => loadTopicInModal(v.matched_concept)}
                                        title={`Explore topic: ${v.matched_concept.replace(/^_+/, '').replace(/_/g, ' ')}`}
                                      >
                                        🏷 {v.matched_concept.replace(/^_+/, '').replace(/_/g, ' ')}
                                      </button>
                                    )}
                                    <div className="ctx-item-actions">
                                      <button onClick={() => drillIntoVerse(v)} title="Find verses related to this verse" className="ctx-drill-btn">🔬 Related</button>
                                      <button onClick={() => { setStaged({...v, theme: themeForVerse(currentTheme, v)}); setContextOpen(false); }}>Stage</button>
                                      <button onClick={() => addToSetlist(v)}>+ List</button>
                                      <button onClick={() => { goLiveDirectly(v); setContextOpen(false); }}>● Live</button>
                                    </div>
                                  </li>
                                ))
                            }
                          </ul>
                        </>
                      );
                    })()}
                  </>
                ) : contextTab === 'summary' ? (
                  /* ── Summary tab ── */
                  <div className="ctx-summary-panel">
                    {!chapterSummary.ready && <p className="ctx-empty">Loading summary…</p>}
                    {chapterSummary.ready && (
                      <>
                        {/* Top doctrine topics */}
                        {chapterSummary.top_topics.length > 0 && (
                          <div className="ctx-tag-row ctx-tag-row--topics">
                            {chapterSummary.top_topics.map(t => (
                              <button key={t.label} className="ctx-doctrine-chip ctx-doctrine-chip--clickable"
                                title={`${Math.round(t.score * 100)}% match — tap to find related chapters`}
                                onClick={async () => {
                                  try {
                                    const res = await fetch(`${API_URL}/sermon-search?q=${encodeURIComponent(t.label)}&limit=20`);
                                    if (res.ok) {
                                      const d = await res.json();
                                      setSummaryTopicResults({ label: t.label, results: d.results || [] });
                                      setSummaryTopicPage(0);
                                      setTimeout(() => summaryTopicResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                                    }
                                  } catch { /* ignore */ }
                                }}>
                                {t.label}
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Summary prose — only for contextual/abstractive; extractive is just joined verses */}
                        {chapterSummary.summary_text && chapterSummary.summary_method !== 'extractive' && (
                          <div className="ctx-summary-text">
                            <span className="ctx-summary-method-badge">
                              {chapterSummary.summary_method === 'abstractive' ? '✨ AI Summary' : '📖 Chapter Summary'}
                            </span>
                            {chapterSummary.summary_text.split('\n\n').map((para, i) => (
                              <p key={i}>{para}</p>
                            ))}
                          </div>
                        )}
                        {/* Key verses — always shown; primary display when method is extractive */}
                        {chapterSummary.key_verses.length > 0 && (
                          <div className="ctx-key-verses">
                            <span className="ctx-entity-label">📌 Key Verses</span>
                            <ul className="ctx-items-list">
                              {chapterSummary.key_verses.map(v => (
                                <li key={v.verse_id} className="ctx-item">
                                  <span className="ctx-item-ref">v.{v.verse_number}</span>
                                  <span className="ctx-item-text">{v.text}</span>
                                  <div className="ctx-item-actions">
                                    <button onClick={() => { setStaged({ ...v, scripture_text: v.text, theme: themeForVerse(currentTheme, v) }); setContextOpen(false); }}>Stage</button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {/* Scholar Context — NABRE (historical) + NET (linguistic) footnotes */}
                        {(chapterSummary.nabre_footnotes || chapterSummary.net_footnotes) && (
                          <div className="ctx-scholar-context">
                            <span className="ctx-entity-label">🎓 Scholar Context</span>
                            {chapterSummary.nabre_footnotes && (() => {
                              const paras = chapterSummary.nabre_footnotes.split('\n').filter(p => p.trim().length > 30);
                              const visible = scholarExpanded.nabre ? paras : paras.slice(0, 3);
                              return (
                                <div className="ctx-scholar-source">
                                  <span className="ctx-scholar-source-label">Some scholars note… <em>(Historical &amp; Contextual — NABRE)</em></span>
                                  {visible.map((p, i) => <p key={i} className="ctx-scholar-note">{p.trim()}</p>)}
                                  {paras.length > 3 && (
                                    <button className="ctx-scholar-toggle" onClick={() => setScholarExpanded(s => ({ ...s, nabre: !s.nabre }))}>
                                      {scholarExpanded.nabre ? '▲ Show less' : `▼ Show ${paras.length - 3} more notes`}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                            {chapterSummary.net_footnotes && (() => {
                              const paras = chapterSummary.net_footnotes.split('\n').filter(p => p.trim().length > 30);
                              const visible = scholarExpanded.net ? paras : paras.slice(0, 3);
                              return (
                                <div className="ctx-scholar-source">
                                  <span className="ctx-scholar-source-label">Other scholars observe… <em>(Linguistic &amp; Translation — NET Bible)</em></span>
                                  {visible.map((p, i) => <p key={i} className="ctx-scholar-note">{p.trim()}</p>)}
                                  {paras.length > 3 && (
                                    <button className="ctx-scholar-toggle" onClick={() => setScholarExpanded(s => ({ ...s, net: !s.net }))}>
                                      {scholarExpanded.net ? '▲ Show less' : `▼ Show ${paras.length - 3} more notes`}
                                    </button>
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        )}
                        {/* Sermon topic search results from chip click — appears below summary + key verses */}
                        {summaryTopicResults && (
                          <div className="ctx-topic-results" ref={summaryTopicResultsRef}>
                            <span className="ctx-entity-label">📚 Chapters about "{summaryTopicResults.label}"</span>
                            {summaryTopicResults.results.length === 0 && <p className="ctx-empty">No matching chapters found.</p>}
                            {(() => {
                              const STP_SIZE = 8;
                              const totalPages = Math.ceil(summaryTopicResults.results.length / STP_SIZE);
                              const pageResults = summaryTopicResults.results.slice(summaryTopicPage * STP_SIZE, (summaryTopicPage + 1) * STP_SIZE);
                              return (
                                <>
                                  {totalPages > 1 && (
                                    <div className="ctx-paginator">
                                      <button disabled={summaryTopicPage <= 0} onClick={() => setSummaryTopicPage(p => p - 1)}>◀</button>
                                      <span>Page {summaryTopicPage + 1} of {totalPages}</span>
                                      <button disabled={summaryTopicPage >= totalPages - 1} onClick={() => setSummaryTopicPage(p => p + 1)}>▶</button>
                                    </div>
                                  )}
                                  <ul className="ctx-items-list">
                                    {pageResults.map(r => (
                                      <li key={r.chapter_id} className="ctx-item ctx-item--clickable" onClick={async () => {
                                        setContextLoading(true);
                                        try {
                                          const [versesRes, summaryRes, entitiesRes] = await Promise.all([
                                            fetch(`${API_URL}/browse/verses?chapter_id=${r.chapter_id}&language=${currentLanguage}`),
                                            fetch(`${API_URL}/chapter/${r.chapter_id}/summary`),
                                            fetch(`${API_URL}/chapter/${r.chapter_id}/entities`),
                                          ]);
                                          if (versesRes.ok) { const d = await versesRes.json(); setChapterVerses(Array.isArray(d) ? d : (d.verses ?? [])); }
                                          if (summaryRes.ok) setChapterSummary(await summaryRes.json());
                                          if (entitiesRes.ok) setChapterEntities(await entitiesRes.json());
                                          setSummaryTopicResults(null);
                                          setContextTab('chapter');
                                          if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
                                        } catch { /* ignore */ } finally { setContextLoading(false); }
                                      }}>
                                        <span className="ctx-item-ref">{r.book_title} {r.chapter_num}</span>
                                        <span className="ctx-item-text">{(r.summary_text || '').slice(0, 120)}…</span>
                                        {r.top_topics?.length > 0 && (
                                          <div className="ctx-tag-row ctx-tag-row--inline">
                                            {r.top_topics.map(tp => <span key={tp.label} className="ctx-doctrine-chip ctx-doctrine-chip--small">{tp.label}</span>)}
                                          </div>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
                                </>
                              );
                            })()}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                ) : contextTab === 'verse-context' ? (
                  /* ── Verse Context tab ── */
                  <div className="ctx-summary-panel">
                    {/* POV + Speaker + Doctrine badges from live verse */}
                    {(verseTags.pov || verseTags.speaker || verseTags.labels.length > 0) && (
                      <div className="ctx-tag-row">
                        {verseTags.pov && <span className="ctx-pov-badge">{verseTags.pov}</span>}
                        {verseTags.speaker && <span className="ctx-pov-badge ctx-pov-badge--speaker" title="Speaker">✍ {verseTags.speaker}</span>}
                        {verseTags.labels.slice(0, 4).map(t => (
                          <button key={t.label} className="ctx-doctrine-chip ctx-doctrine-chip--clickable"
                            title={t.source === 'topical-guide' ? 'LDS Topical Guide — click to explore' : `${Math.round((t.score || 0) * 100)}% match`}
                            onClick={() => {
                              setTopicResults({ topic: t.label, loading: true, results: [], total: 0, page: 0, pageSize: 10, groups: [] });
                              fetch(`${API_URL}/topic-search?q=${encodeURIComponent(t.label)}&language=${currentLanguage}&page=0&pageSize=10`)
                                .then(r => r.ok ? r.json() : null)
                                .then(d => {
                                  if (!d) return;
                                  const results = d.results || [];
                                  const vMap = new Map();
                                  for (const r of results) {
                                    const vid = r.volume_id || 0;
                                    if (!vMap.has(vid)) vMap.set(vid, { volume_id: vid, volume_title: r.volume_title || r.book_title, results: [] });
                                    vMap.get(vid).results.push(r);
                                  }
                                  setTopicResults({ topic: t.label, loading: false, results, total: d.total || 0, page: 0, pageSize: 10, groups: [...vMap.values()] });
                                  setTimeout(() => topicResultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                                })
                                .catch(() => setTopicResults(s => ({ ...s, loading: false })));
                            }}>
                            {t.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {!verseSummary.ready && <p className="ctx-empty">Loading verse context…</p>}
                    {verseSummary.ready && !verseSummary.summary && <p className="ctx-empty">No verse context available yet.</p>}
                    {verseSummary.ready && verseSummary.summary && (
                      <>
                        <div className="ctx-summary-text">
                          <span className="ctx-summary-method-badge">🔍 Verse Context</span>
                          {verseSummary.summary.split('\n\n').map((para, i) => (
                            <p key={i}>{para}</p>
                          ))}
                        </div>

                      </>
                    )}
                    {/* Topic search results from clicking a doctrine chip */}
                    {topicResults && (
                      <div className="ctx-entity-results" ref={topicResultsRef}>
                        <div className="ctx-entity-results-header">
                          <span>📚 "{topicResults.topic}" — {topicResults.loading ? '…' : topicResults.total} verse{topicResults.total !== 1 ? 's' : ''}</span>
                          <button className="ctx-close-mini" onClick={() => setTopicResults(null)}>✕</button>
                        </div>
                        {topicResults.loading && <p className="ctx-empty">Searching…</p>}
                        {!topicResults.loading && topicResults.results.length === 0 && <p className="ctx-empty">No verses found for this topic.</p>}
                        {!topicResults.loading && (() => {
                          const _topicTotalPages = topicResults.total > 0 ? Math.ceil(topicResults.total / topicResults.pageSize) : 1;
                          return _topicTotalPages > 1 ? (
                            <div className="ctx-paginator">
                              <button disabled={topicResults.page <= 0} onClick={() => loadTopicPage(topicResults.page - 1)}>◀</button>
                              <span>Page {topicResults.page + 1} of {_topicTotalPages}</span>
                              <button disabled={topicResults.page >= _topicTotalPages - 1} onClick={() => loadTopicPage(topicResults.page + 1)}>▶</button>
                            </div>
                          ) : null;
                        })()}
                        {!topicResults.loading && (topicResults.groups || []).map(g => (
                          <div key={g.volume_id} className="ctx-entity-volume-group">
                            <span className="ctx-entity-volume-label">{g.volume_title}</span>
                            <ul className="ctx-items-list">
                              {g.results.map(v => (
                                <li key={v.verse_id} className="ctx-item">
                                  <span className="ctx-item-ref">{v.verse_title}</span>
                                  <span className="ctx-item-text">{v.scripture_text}</span>
                                  <div className="ctx-item-actions">
                                    <button onClick={() => { setStaged({ ...v, theme: themeForVerse(currentTheme, v) }); setContextOpen(false); }}>Stage</button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  /* ── People & Places tab — chapter level ── */
                  <div className="ctx-entities-panel">
                    {/* Named people — chapter level */}
                    {chapterEntities.people.length > 0 && (
                      <div className="ctx-entity-group">
                        <span className="ctx-entity-label">👤 People in this chapter</span>
                        <div className="ctx-entity-chips">
                          {chapterEntities.people.map(p => (
                            <button key={p} className="ctx-entity-chip ctx-entity-chip--person"
                              onClick={() => {
                                setEntitySearch({ name: p, type: 'person', loading: true, results: [], total: 0, page: 0, pageSize: 10, groups: [], qualifier: null, siblings: [] });
                                fetch(`${API_URL}/entity/search?name=${encodeURIComponent(p)}&type=person&language=${currentLanguage}&page=0&pageSize=10&verse_id=${liveVerse?.verse_id || ''}`)
                                  .then(r => r.ok ? r.json() : null)
                                  .then(d => d && setEntitySearch({ name: p, type: 'person', loading: false, results: d.results, total: d.total, page: 0, pageSize: 10, groups: d.groups || [], entity_id: d.entity_id || null, qualifier: d.qualifier || null, siblings: d.siblings || [] }))
                                  .catch(() => setEntitySearch(s => ({ ...s, loading: false })));
                              }}
                            >{p}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Named places — chapter level */}
                    {chapterEntities.places.length > 0 && (
                      <div className="ctx-entity-group">
                        <span className="ctx-entity-label">📍 Places in this chapter</span>
                        <div className="ctx-entity-chips">
                          {chapterEntities.places.map(p => (
                            <button key={p} className="ctx-entity-chip ctx-entity-chip--place"
                              onClick={() => {
                                setEntitySearch({ name: p, type: 'place', loading: true, results: [], total: 0, page: 0, pageSize: 10, groups: [], qualifier: null, siblings: [] });
                                fetch(`${API_URL}/entity/search?name=${encodeURIComponent(p)}&type=place&language=${currentLanguage}&page=0&pageSize=10&verse_id=${liveVerse?.verse_id || ''}`)
                                  .then(r => r.ok ? r.json() : null)
                                  .then(d => d && setEntitySearch({ name: p, type: 'place', loading: false, results: d.results, total: d.total, page: 0, pageSize: 10, groups: d.groups || [], entity_id: d.entity_id || null, qualifier: d.qualifier || null, siblings: d.siblings || [] }))
                                  .catch(() => setEntitySearch(s => ({ ...s, loading: false })));
                              }}
                            >{p}</button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Entity search results — grouped by volume */}
                    {entitySearch && (
                      <div className="ctx-entity-results">
                        <div className="ctx-entity-results-header">
                          <span>"{entitySearch.name}"{entitySearch.qualifier ? ` — ${entitySearch.qualifier}` : ''} — {entitySearch.loading ? '…' : entitySearch.total} result{entitySearch.total !== 1 ? 's' : ''}</span>
                          <button className="ctx-close-mini" onClick={() => setEntitySearch(null)}>✕</button>
                        </div>
                        {/* Show sibling profiles (same name, different identity) */}
                        {!entitySearch.loading && entitySearch.siblings && entitySearch.siblings.length > 0 && (
                          <div className="ctx-entity-siblings">
                            <span className="ctx-entity-siblings-label">Also see:</span>
                            {entitySearch.siblings.map(s => (
                              <button key={s.entity_id} className="ctx-entity-chip ctx-entity-chip--sibling"
                                onClick={() => {
                                  setEntitySearch(prev => ({ ...prev, loading: true, results: [], groups: [] }));
                                  fetch(`${API_URL}/entity/search?name=${encodeURIComponent(entitySearch.name)}&type=${entitySearch.type}&language=${currentLanguage}&page=0&pageSize=10&entity_id=${encodeURIComponent(s.entity_id)}`)
                                    .then(r => r.ok ? r.json() : null)
                                    .then(d => d && setEntitySearch(prev => ({ ...prev, loading: false, results: d.results, total: d.total, page: 0, groups: d.groups || [], entity_id: d.entity_id || null, qualifier: d.qualifier || null, siblings: d.siblings || [] })))
                                    .catch(() => setEntitySearch(prev => ({ ...prev, loading: false })));
                                }}>
                                {s.qualifier || s.entity_id} ({s.verse_count})
                              </button>
                            ))}
                          </div>
                        )}
                        {entitySearch.loading && <p className="ctx-empty">Searching…</p>}
                        {!entitySearch.loading && entitySearch.results.length === 0 && <p className="ctx-empty">No verses found.</p>}
                        {!entitySearch.loading && (() => {
                          const _entityTotalPages = entitySearch.total > 0 ? Math.ceil(entitySearch.total / entitySearch.pageSize) : 1;
                          return _entityTotalPages > 1 ? (
                            <div className="ctx-paginator">
                              <button disabled={entitySearch.page <= 0} onClick={() => loadEntityPage(entitySearch.page - 1)}>◀</button>
                              <span>Page {entitySearch.page + 1} of {_entityTotalPages}</span>
                              <button disabled={entitySearch.page >= _entityTotalPages - 1} onClick={() => loadEntityPage(entitySearch.page + 1)}>▶</button>
                            </div>
                          ) : null;
                        })()}
                        {!entitySearch.loading && (entitySearch.groups || []).map(g => (
                          <div key={g.volume_id} className="ctx-entity-volume-group">
                            <span className="ctx-entity-volume-label">{g.volume_title}</span>
                            <ul className="ctx-items-list">
                              {g.results.map(v => (
                                <li key={v.verse_id} className="ctx-item">
                                  <span className="ctx-item-ref">{v.verse_title}</span>
                                  <span className="ctx-item-text">{v.scripture_text}</span>
                                  <div className="ctx-item-actions">
                                    <button onClick={() => { setStaged({ ...v, theme: themeForVerse(currentTheme, v) }); setContextOpen(false); }}>Stage</button>
                                  </div>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                    )}

                    {!chapterEntities.ready && <p className="ctx-empty">Loading people &amp; places…</p>}
                    {chapterEntities.ready && chapterEntities.people.length === 0 && chapterEntities.places.length === 0 && !verseTags.pov && (
                      <p className="ctx-empty">No named people or places found in this chapter.</p>
                    )}
                  </div>
                )}
              </div>
              {/* Scroll fade hint — only when not at bottom */}
              {!ctxAtBottom && chapterVerses.length > 3 && contextTab === 'chapter' && (
                <div className="ctx-scroll-fade" aria-hidden="true" />
              )}
              {/* Back to top */}
              {ctxScrolled && (
                <button className="ctx-back-to-top"
                  onClick={() => { if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0; }}
                  aria-label="Back to top">↑</button>
              )}
              {/* Floating word-explore chip */}
              {ctxWordChip && contextTab === 'related' && (
                <div
                  className="ctx-word-chip"
                  style={{ top: ctxWordChip.top, left: ctxWordChip.left }}
                >
                  <button
                    className="ctx-word-chip-btn"
                    onClick={() => { loadTopicInModal(ctxWordChip.word); setCtxWordChip(null); window.getSelection()?.removeAllRanges(); }}
                  >🔍 Explore &ldquo;{ctxWordChip.word}&rdquo;</button>
                  <button className="ctx-word-chip-close" onClick={() => setCtxWordChip(null)} aria-label="Dismiss">✕</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* QR Scanner Modal — rendered at root level so it overlays everything */}
      {scannerOpen && (
        <QrScannerModal
          onCode={handleScannedCode}
          onClose={() => setScannerOpen(false)}
        />
      )}
    </div>
  );
};

export default Presenter;
