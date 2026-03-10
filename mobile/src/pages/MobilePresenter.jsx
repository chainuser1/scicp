import React, { useState, useEffect, useRef } from 'react';
import { socket } from '../socket-local';
import * as svc from '../scripture-service';
import CastingControl from '../components/CastingControl';

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
  if (!imageUrl) return baseTheme;
  return { ...baseTheme, background_url: `url('${imageUrl}')` };
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
// Pip dots are capped at MAX_PIPS to avoid rendering 300 dots for broad queries.
const MAX_PIPS = 7;

const SearchResults = ({ results, currentPage, totalPages, onSelect, onGoLive, onPageChange, onAddToSetlist, stagedVerseId, onToggleTranslation, expandedTranslations, translationCache, currentLanguage: srLang }) => {
  if (results.length === 0) return null;

  // Build a compact pip sequence around the current page
  const buildPips = () => {
    if (totalPages <= MAX_PIPS) {
      return Array.from({ length: totalPages }, (_, i) => i);
    }
    // Always show first, last, current, and neighbours
    const set = new Set([0, totalPages - 1, currentPage]);
    if (currentPage > 0) set.add(currentPage - 1);
    if (currentPage < totalPages - 1) set.add(currentPage + 1);
    return Array.from(set).sort((a, b) => a - b);
  };
  const pips = buildPips();

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
                  return translationCache?.[`${verse.verse_id}_${tl}`] || 'Loading...';
                })()}
              </div>
            )}
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="results-pagination">
          <button className="pagination-arrow" onClick={() => onPageChange(Math.max(0, currentPage - 1))} disabled={currentPage === 0}>&#8249;</button>
          <div className="pagination-track">
            {pips.map((pageIdx, i) => {
              const prevPip = pips[i - 1];
              const gap = prevPip !== undefined && pageIdx - prevPip > 1;
              return (
                <React.Fragment key={pageIdx}>
                  {gap && <span className="pagination-ellipsis">...</span>}
                  <button
                    className={`pagination-pip${pageIdx === currentPage ? ' active' : ''}`}
                    onClick={() => onPageChange(pageIdx)}
                    aria-label={`Page ${pageIdx + 1}`}
                  />
                </React.Fragment>
              );
            })}
          </div>
          <span className="pagination-label">{currentPage + 1}<span className="pagination-sep">/</span>{totalPages}</span>
          <button className="pagination-arrow" onClick={() => onPageChange(Math.min(totalPages - 1, currentPage + 1))} disabled={currentPage === totalPages - 1}>&#8250;</button>
        </div>
      )}
    </>
  );
};

/* ─── Quick-topic chips shown in the idle state ─── */
const QUICK_TOPICS = [
  'faith', 'atonement', 'prayer', 'hope', 'charity',
  'repentance', 'grace', 'service', 'covenant', 'eternal life',
  'holy ghost', 'resurrection', 'obedience', 'trials', 'gratitude',
];

const BIBLE_CITATIONS = { en: 'KJV', nrsvue: 'NRSVUE', tl: 'Ang Biblia', ceb: 'Ang Biblia', ilo: 'RIPV', es: 'RVR', el: 'Greek Bible', ja: '\u53E3\u8A9E\u8A33', war: 'Samarenyo Bible' };
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

/* ─── Main component ─── */
const MobilePresenter = () => {
  const PRESENTER_TOUR_KEY = 'scicp.presenter_tour_seen_v1';
  const presenterTourSteps = [
    {
      target: 'search',
      title: 'Search Scriptures',
      description: 'Use search to find references or keywords, then click a result to stage it.',
    },
    {
      target: 'golive',
      title: 'Go Live',
      description: 'Review the staged verse and send it to your connected clients.',
    },
    {
      target: 'nav',
      title: 'Navigate Fast',
      description: 'Use preview controls for previous/next verse and segment navigation while live.',
    },
  ];
  const [query, setQuery]                   = useState('');
  const [results, setResults]               = useState([]);
  const [totalResults, setTotalResults]     = useState(0);
  const [currentTheme, setCurrentTheme]     = useState(themes.light);
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
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [drawerTab, setDrawerTab]           = useState('search');
  const [themePopover, setThemePopover]     = useState(false);
  const [langPopover,  setLangPopover]      = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
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

  // ── F1 — Browse ─────────────────────────────────────────────────────────────
  const [browseLevel, setBrowseLevel]                     = useState('books');
  const [browseBooks, setBrowseBooks]                     = useState([]);
  const [browseChapters, setBrowseChapters]               = useState([]);
  const [browseVerses, setBrowseVerses]                   = useState([]);
  const [browseSelectedBook, setBrowseSelectedBook]       = useState(null);
  const [browseSelectedChapter, setBrowseSelectedChapter] = useState(null);
  const [browseBooksLoaded, setBrowseBooksLoaded]         = useState(false);

  // ── F2 / F12 — Announcement / Custom Text ────────────────────────────────────
  const [customText, setCustomText]       = useState('');
  const [customSubtext, setCustomSubtext] = useState('');
  const [isCustomLive, setIsCustomLive]   = useState(false);

  // ── F3 — Saved Setlists (local-only on mobile) ────────────────────────────────
  const [savedSetlists, setSavedSetlists]     = useState([]);
  const [setlistSaveOpen, setSetlistSaveOpen] = useState(false);
  const [setlistSaveName, setSetlistSaveName] = useState('');
  const [setlistLoadOpen, setSetlistLoadOpen] = useState(false);
  const [setlistsLoading, setSetlistsLoading] = useState(false);

  // ── F4 — Translation Preview ─────────────────────────────────────────────────
  const [expandedTranslations, setExpandedTranslations] = useState(() => new Set());
  const [translationCache, setTranslationCache]         = useState({});

  // ── F6 — Verse Notes (private, never sent to TV) ─────────────────────────────
  const [verseNotes, setVerseNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('scicp.verse_notes_v1')) || {}; } catch { return {}; }
  });
  const [notesExpandedFor, setNotesExpandedFor] = useState(() => new Set());

  // ── F8 — Secondary (dual) Language displayed on TV ───────────────────────────
  const [secondaryLanguage, setSecondaryLanguage] = useState(() => {
    try { return localStorage.getItem('scicp.secondary_language_v1') || ''; } catch { return ''; }
  });

  // ── F12 — Runsheet text-item draft ───────────────────────────────────────────
  const [runsheetAddingText, setRunsheetAddingText]     = useState(false);
  const [runsheetTextDraft, setRunsheetTextDraft]       = useState('');
  const [runsheetSubtextDraft, setRunsheetSubtextDraft] = useState('');

  // Persist setlist to localStorage
  useEffect(() => {
    try { window.localStorage.setItem('scicp.presenter_setlist_v1', JSON.stringify(setlist)); }
    catch { /* ignore */ }
  }, [setlist]);

  // F6 — persist verse notes
  useEffect(() => {
    try { localStorage.setItem('scicp.verse_notes_v1', JSON.stringify(verseNotes)); } catch { /* ignore */ }
  }, [verseNotes]);

  // F8 — persist secondary language choice
  useEffect(() => {
    try { localStorage.setItem('scicp.secondary_language_v1', secondaryLanguage); } catch { /* ignore */ }
  }, [secondaryLanguage]);

  // F1 — reset book list when language changes
  useEffect(() => { setBrowseBooksLoaded(false); setBrowseLevel('books'); }, [currentLanguage]);

  // F1 — fetch books when Browse tab is opened (uses local svc)
  useEffect(() => {
    if (drawerTab === 'browse' && !browseBooksLoaded) {
      try {
        const data = svc.browse('books', {}, currentLanguage);
        setBrowseBooks(data || []);
        setBrowseBooksLoaded(true);
      } catch {
        setBrowseBooks([]);
      }
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
  const [themeCardOpen, setThemeCardOpen]     = useState(true);
  const [fontSizeRem, setFontSizeRem]         = useState(4.1); // mirrors currentTheme.font_size
  const mainPanelRef    = useRef(null);
  const searchDebounce  = useRef(null); // debounce timer for search socket emits

  // Show the sticky Go Live bar whenever a verse is staged and we're on mobile
  // No scroll logic needed — the bar simply mirrors the `staged` state on small screens
  const PAGE_SIZE = 5; // 5 results/page keeps pagination controls clear of the mobile nav bar
  const emitWithSession = (event, payload = {}) => socket.emit(event, { ...payload, sessionId: 'LOCAL' });

  // ── Toast notification ───────────────────────────────────────────────────
  const showToast = (msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  };

  // ── End Live — clear TV screen ─────────────────────────────────────────
  const endLive = () => {
    emitWithSession('clear-screen');
    setLiveVerse(null);
    setHighlightedText('');
    setCurrentSegment(0);
    setIsCustomLive(false);
    showToast('Screen cleared');
  };

  // ── Clear highlight only ──────────────────────────────────────────────────
  const clearHighlight = () => {
    setHighlightedText('');
    emitWithSession('highlight-text', { text: '' });
  };

  // ── Font size control ─────────────────────────────────────────────────────
  const adjustFontSize = (delta) => {
    setFontSizeRem(prev => {
      const next = Math.min(7, Math.max(2, parseFloat((prev + delta).toFixed(1))));
      const updatedTheme = { ...currentTheme, font_size: next + 'rem' };
      handleThemeChange(updatedTheme);
      return next;
    });
  };

  // ── Copy verse text to clipboard ─────────────────────────────────────────
  const copyVerseText = (verseObj, label = '') => {
    if (!verseObj) return;
    const text = `${verseObj.book_title} ${verseObj.chapter_number}:${verseObj.verse_number}\n"${verseObj.scripture_text}"`;
    navigator.clipboard.writeText(text).then(() => {
      showToast(`Copied${label ? ' ' + label : ''}`);
    }).catch(() => showToast('Copy failed -- clipboard not available'));
  };
  const activeTourTarget = tourOpen ? presenterTourSteps[tourStep].target : '';

  useEffect(() => {
    document.title = 'Presenter | Scriptures in View';
  }, []);

  // ── Verse of the Day (local) ─────────────────────────────────────────────
  useEffect(() => {
    try {
      const data = svc.verseOfTheDay();
      if (data && data.verse_id) setVerseOfDay(data);
      else setVotdError(true);
    } catch (err) {
      console.error('[MobilePresenter] verse-of-the-day failed:', err);
      setVotdError(true);
    }
  }, []);

  const closeTour = () => {
    setTourOpen(false);
    try {
      window.localStorage.setItem(PRESENTER_TOUR_KEY, 'true');
    } catch {
      // ignore storage errors
    }
  };

  const openTour = () => {
    setTourStep(0);
    setTourOpen(true);
  };

  /* ── Socket & data ── */
  useEffect(() => {
    const handleConnect = () => {
      setConnectionState('connected');
    };
    const handleDisconnect = () => {
      setConnectionState('disconnected');
    };
    const handleSearchResults = ({ results, total }) => {
      setResults(results ?? []);
      setTotalResults(total ?? 0);
    };
    const handleUpdateVerse = data => { setLiveVerse(data); setCurrentSegment(data.currentSegment || 0); };
    socket.on('search-results', handleSearchResults);
    socket.on('update-verse',   handleUpdateVerse);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    // Initialize the local socket (loads DBs and fires 'connect')
    socket.init().catch(err => {
      console.error('[MobilePresenter] socket.init failed:', err);
      setConnectionState('error');
    });
    if (socket.connected) {
      handleConnect();
    }
    return () => {
      socket.off('search-results', handleSearchResults);
      socket.off('update-verse',   handleUpdateVerse);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Close drawer, theme popover, and mobile menu on outside tap ── */
  useEffect(() => {
    if (!drawerOpen && !themePopover && !langPopover && !mobileMenuOpen) return;
    const handler = e => {
      if (!e.target.closest('.search-drawer') && !e.target.closest('.hdr-btn') && !e.target.closest('.hdr-theme-wrap'))
        setDrawerOpen(false);
      if (!e.target.closest('.hdr-theme-wrap'))
        setThemePopover(false);
      if (!e.target.closest('.hdr-lang-wrap'))
        setLangPopover(false);
      if (!e.target.closest('.hdr-mobile-menu') && !e.target.closest('.hdr-hamburger'))
        setMobileMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [drawerOpen, themePopover, langPopover, mobileMenuOpen]);

  /* ── Handlers ── */
  const handleThemeChange = theme => {
    setCurrentTheme(theme);
    if (staged) setStaged(prev => ({ ...prev, theme: themeForVerse(theme, prev) }));
    emitWithSession('update-theme', { theme });
    // Keep fontSizeRem slider in sync when theme is changed externally
    if (theme.font_size) {
      const parsed = parseFloat(theme.font_size);
      if (!isNaN(parsed)) setFontSizeRem(parsed);
    }
  };

  const handleSearch = e => {
    const q = e.target.value;
    setQuery(q);
    setCurrentPage(0);
    setTotalResults(0);
    // 250 ms debounce — avoids flooding with a socket emit per
    // keystroke, and prevents stale out-of-order results.
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
    // F11 — preload background into TV browser cache before go-live
    if (verseTheme?.background_url) {
      const match = String(verseTheme.background_url).match(/url\((['"]?)(.*?)\1\)/i);
      if (match?.[2]) emitWithSession('preload-background', { background_url: match[2] });
    }
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
    setHistory(h => [{ ...staged, _ts: Date.now() }, ...h.filter(v => v.verse_id !== staged.verse_id).slice(0, 19)]);
    setStaged(null);
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
    try {
      const data = svc.getAdjacent(source, direction, currentLanguage);
      if (!data) return;
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
      console.error('adjacent fetch failed', err);
    }
  };

  const handlePreviewTextSelection = () => {
    const sel = window.getSelection()?.toString().trim();
    if (!sel) return;
    setHighlightedText(sel);
    emitWithSession('highlight-text', { text: sel });
  };

  const handleLanguageChange = e => {
    const lang = e.target.value;
    setCurrentLanguage(lang);
    emitWithSession('update-language', { language: lang });
    if (liveVerse) emitWithSession('go-live', { verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: lang, secondaryLanguage: secondaryLanguage || null });
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

  const handleSwapLanguages = () => {
    if (!secondaryLanguage) return;
    const newPrimary   = secondaryLanguage;
    const newSecondary = currentLanguage;
    setCurrentLanguage(newPrimary);
    setSecondaryLanguage(newSecondary);
    emitWithSession('update-language', { language: newPrimary });
    if (liveVerse) emitWithSession('go-live', { verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: newPrimary, secondaryLanguage: newSecondary });
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

  // ── F1 — Browse handlers (local svc calls) ───────────────────────────────
  const handleBrowseBook = (book) => {
    setBrowseSelectedBook(book);
    try {
      const data = svc.browse('chapters', { bookId: book.book_id }, currentLanguage);
      setBrowseChapters(data || []);
    } catch { setBrowseChapters([]); }
    setBrowseLevel('chapters');
  };
  const handleBrowseChapter = (chapter) => {
    setBrowseSelectedChapter(chapter);
    try {
      const data = svc.browse('verses', { chapterId: chapter.chapter_id }, currentLanguage);
      setBrowseVerses(data || []);
    } catch { setBrowseVerses([]); }
    setBrowseLevel('verses');
  };

  // ── F2 — Send announcement to screen ──────────────────────────────────────
  const sendCustomToScreen = () => {
    if (!customText.trim()) return;
    emitWithSession('go-custom', { text: customText.trim(), subtext: customSubtext.trim(), theme: currentTheme });
    setIsCustomLive(true);
    showToast('Announcement sent to screen');
  };

  // ── F3 — Named setlist persistence (local-only on mobile) ────────────────
  const fetchSavedSetlists = () => {
    setSetlistsLoading(true);
    // Setlists are not persisted on mobile for now — use local state only
    setSavedSetlists([]);
    setSetlistsLoading(false);
  };
  const saveSetlist = () => {
    const name = setlistSaveName.trim();
    if (!name) return;
    // Keep in local state only (no server persistence on mobile)
    setSavedSetlists(prev => [...prev, { id: `local_${Date.now()}`, name, items: [...setlist] }]);
    setSetlistSaveOpen(false);
    setSetlistSaveName('');
    showToast(`Setlist "${name}" saved locally`);
  };
  const loadSetlist = (saved) => {
    if (!window.confirm(`Replace current setlist with "${saved.name}"?`)) return;
    setSetlist(saved.items);
    setSetlistLoadOpen(false);
    showToast(`Loaded "${saved.name}"`);
  };
  const deleteSavedSetlist = (id) => {
    setSavedSetlists(prev => prev.filter(s => s.id !== id));
  };

  // ── F4 — Translation preview in search results ────────────────────────────
  const toggleTranslation = (verse_id) => {
    const targetLang = currentLanguage === 'en' ? 'tl' : currentLanguage === 'tl' ? 'ceb' : 'en';
    const cacheKey = `${verse_id}_${targetLang}`;
    setExpandedTranslations(prev => {
      const next = new Set(prev);
      next.has(verse_id) ? next.delete(verse_id) : next.add(verse_id);
      return next;
    });
    if (!translationCache[cacheKey]) {
      try {
        const row = svc.getVerse({ verse_id }, targetLang);
        if (row?.scripture_text) {
          setTranslationCache(c => ({ ...c, [cacheKey]: row.scripture_text }));
        }
      } catch { /* ignore */ }
    }
  };

  // ── F6 — Verse notes ──────────────────────────────────────────────────────
  const updateVerseNote = (key, text) =>
    setVerseNotes(prev => ({ ...prev, [key]: text }));
  const toggleNotesExpanded = (key) =>
    setNotesExpandedFor(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });

  // ── F12 — Add text/announcement item to service order ────────────────────
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
     Space  -> next segment (or next verse if single-segment)
     ->     -> next verse
     <-     -> previous verse
     L      -> go live (if staged)
     E      -> end live (if live)
     Esc    -> clear highlight
     ────────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
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
  }, [staged, liveVerse, highlightedText, currentSegment, drawerOpen]);

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
  const presenterThemeClass = currentTheme === themes.dark
    ? 'presenter-container--dark'
    : 'presenter-container--light';

  /* ── Render ── */
  return (
    <div className={`presenter-container ${presenterThemeClass}`}>

      {/* ════════════════════════════════════════
          COMMAND BAR HEADER
          ════════════════════════════════════════ */}
      <header className="presenter-header">

        {/* Brand */}
        <div className="hdr-brand">
          <EmblemSVG size={24} />
          <span className="hdr-title">Scripture</span>
        </div>

        {/* Live verse summary */}
        <div className="hdr-center">
          {/* Persistent connection dot — always visible on desktop */}
          <span
            className={`hdr-conn-dot hdr-conn-dot--${connectionState}`}
            title={`Connection: ${connectionState}`}
            aria-label={`Connection: ${connectionState}`}
          />
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
            <span className="hdr-no-verse">Tap search to find a verse</span>
          )}
        </div>

        {/* Right controls — desktop (hidden on narrow screens via CSS) */}
        <div className="hdr-right hdr-right--desktop">
          <HdrBtn onClick={openTour} label="Open walkthrough" title="Open walkthrough">
            <IconInfo />
          </HdrBtn>

          {/* Cast placeholder (Milestone 3) */}
          <CastingControl />

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
                    <option value="es">Espanol</option>
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
                      <option value="es">Espanol</option>
                      <option value="el">Greek</option>
                      <option value="ilo">Ilocano</option>
                      <option value="ja">Japanese</option>
                      <option value="war">Waray</option>
                      <option value="zh">Chinese (Simplified)</option>
                    </select>
                    <button
                      className="popover-swap-btn"
                      onClick={handleSwapLanguages}
                      disabled={!secondaryLanguage}
                      title="Swap primary and secondary language"
                      aria-label="Swap primary and secondary language"
                    >&#8644;</button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Theme popover */}
          <div className="hdr-theme-wrap">
            <HdrBtn onClick={() => setThemePopover(o => !o)} active={themePopover} label="Theme" title="Change theme">
              <IconPalette />
            </HdrBtn>
            {themePopover && (
              <div className="hdr-theme-popover">
                <div className="popover-label">Theme</div>
                {[
                  { label: 'Light', theme: themes.light },
                  { label: 'Dark',  theme: themes.dark  },
                ].map(({ label, theme }) => (
                  <button
                    key={label}
                    className={`theme-btn${currentTheme === theme ? ' active' : ''}`}
                    onClick={() => { handleThemeChange(theme); setThemePopover(false); }}
                  >{label}</button>
                ))}
                <div className="popover-divider" />
                <div className="popover-label">Custom background</div>
                <div className="popover-row">
                  <input
                    type="text"
                    className="popover-input"
                    placeholder="https://..."
                    value={bgUrlInput}
                    onChange={e => setBgUrlInput(e.target.value)}
                  />
                  <button className="popover-apply" onClick={() => {
                    if (!bgUrlInput) return;
                    handleThemeChange({ ...currentTheme, background_url: `url('${bgUrlInput}')` });
                    setBgUrlInput('');
                    setThemePopover(false);
                  }}>Apply</button>
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

          {/* Live badge */}
          {liveVerse && (
            <div className="live-badge">
              <span className="live-badge-dot" />
              <span>Live</span>
            </div>
          )}
        </div>

        {/* Right controls — mobile (narrow screens only) */}
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
              {/* Cast placeholder */}
              <div className="mobile-menu-section">
                <div className="mobile-menu-label">Display</div>
                <div className="mobile-menu-row">
                  <CastingControl />
                </div>
              </div>

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
                    <option value="es">Espanol</option>
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
                    <option value="es">Espanol</option>
                    <option value="el">Greek</option>
                    <option value="ilo">Ilocano</option>
                    <option value="ja">Japanese</option>
                    <option value="war">Waray</option>
                  </select>
                  <button
                    className="popover-swap-btn"
                    onClick={handleSwapLanguages}
                    disabled={!secondaryLanguage}
                    title="Swap primary and secondary language"
                  >&#8644;</button>
                </div>
              </div>

              <div className="mobile-menu-divider" />

              {/* Theme */}
              <div className="mobile-menu-section">
                <div className="mobile-menu-label">Theme</div>
                <div className="mobile-menu-row">
                  {[{ label: 'Light', theme: themes.light }, { label: 'Dark', theme: themes.dark }].map(({ label, theme }) => (
                    <button
                      key={label}
                      className={`theme-btn${currentTheme === theme ? ' active' : ''}`}
                      onClick={() => { handleThemeChange(theme); setMobileMenuOpen(false); }}
                    >{label}</button>
                  ))}
                </div>
                <div className="popover-row" style={{ marginTop: '0.4rem' }}>
                  <input
                    type="text"
                    className="popover-input"
                    placeholder="Custom bg URL..."
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
            <span className="drawer-staged-badge" title="Verse staged -- press Go Live">
              {staged.book_title} {staged.chapter_number}:{staged.verse_number}
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
                placeholder="John 3:16 or 'faith'..."
                value={query}
                onChange={handleSearch}
                onKeyDown={handleSearchKeyDown}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                autoFocus={drawerOpen && drawerTab === 'search'}
              />
              <div className="results-list">
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
                        setCurrentPage(newPage);
                        emitWithSession('search', { query, page: newPage, pageSize: PAGE_SIZE, language: currentLanguage });
                      }}
                      stagedVerseId={staged?.verse_id}
                      onToggleTranslation={toggleTranslation}
                      expandedTranslations={expandedTranslations}
                      translationCache={translationCache}
                      currentLanguage={currentLanguage}
                    />
                  : <div className="empty-state">
                      {query.length > 0 ? 'No verses found' : <>Search for a verse<br />to begin...</>}
                    </div>
                }
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
                <button className="setlist-toolbar-btn" onClick={() => setSetlistSaveOpen(o => !o)}>Save</button>
                <button className="setlist-toolbar-btn" onClick={() => { setSetlistLoadOpen(o => !o); if (!setlistLoadOpen) fetchSavedSetlists(); }}>Load</button>
                <button className="setlist-toolbar-btn" onClick={() => setRunsheetAddingText(o => !o)}>+ Text</button>
              </div>
              {setlistSaveOpen && (
                <div className="setlist-save-row">
                  <input className="popover-input" placeholder="Setlist name..." value={setlistSaveName}
                    onChange={e => setSetlistSaveName(e.target.value)} onKeyDown={e => e.key === 'Enter' && saveSetlist()} />
                  <button className="popover-apply" onClick={saveSetlist}>Save</button>
                </div>
              )}
              {setlistLoadOpen && (
                <div className="setlist-load-list">
                  {setlistsLoading ? <div className="empty-state">Loading...</div>
                  : savedSetlists.length === 0 ? <div className="empty-state">No saved setlists</div>
                  : savedSetlists.map(s => (
                    <div key={s.id} className="setlist-load-item">
                      <div className="setlist-load-item-info" onClick={() => loadSetlist(s)}>
                        <span className="setlist-load-item-name">{s.name}</span>
                        <span className="setlist-load-item-count">{s.items.length} item{s.items.length !== 1 ? 's' : ''}</span>
                      </div>
                      <button className="setlist-remove-btn" onClick={() => deleteSavedSetlist(s.id)}>x</button>
                    </div>
                  ))}
                </div>
              )}
              {runsheetAddingText && (
                <div className="setlist-text-draft-area">
                  <input className="popover-input" placeholder="Announcement text..." value={runsheetTextDraft}
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
                  <div className="setlist-hint">Tap to go live -- reorder -- x to remove</div>
                  <ul className="setlist-list">
                    {setlist.map((item, i) => {
                      const isTextItem = item.type === 'text';
                      const itemKey = item.verse_id ?? item.id;
                      return (
                        <li key={itemKey} className={`setlist-item${isTextItem ? ' setlist-item--text' : ''}${liveVerse?.verse_id === item.verse_id ? ' setlist-item--live' : ''}`}>
                          <div className="setlist-order">
                            <button className="setlist-move-btn" onClick={() => moveSetlistItem(i, i - 1)} disabled={i === 0} aria-label="Move up">Up</button>
                            <span className="setlist-num">{i + 1}</span>
                            <button className="setlist-move-btn" onClick={() => moveSetlistItem(i, i + 1)} disabled={i === setlist.length - 1} aria-label="Move down">Dn</button>
                          </div>
                          <div className="setlist-verse-info" onClick={() => !isTextItem && setStaged(item)}>
                            {isTextItem ? (
                              <>
                                <span className="setlist-ref">Announcement: {item.customText?.slice(0, 40)}{item.customText?.length > 40 ? '...' : ''}</span>
                                {item.customSubtext && <span className="setlist-text">{item.customSubtext}</span>}
                              </>
                            ) : (
                              <>
                                <span className="setlist-ref">{item.book_title} {item.chapter_number}:{item.verse_number}</span>
                                <span className="setlist-text">{item.scripture_text?.slice(0, 60)}...</span>
                              </>
                            )}
                            <button className="setlist-notes-btn" onClick={e => { e.stopPropagation(); toggleNotesExpanded(itemKey); }} title="Notes">
                              {notesExpandedFor.has(itemKey) ? 'Hide' : 'Note'}
                            </button>
                            {notesExpandedFor.has(itemKey) && (
                              <textarea className="setlist-notes-area" placeholder="Private notes (not shown on TV)..."
                                value={verseNotes[itemKey] || ''} onClick={e => e.stopPropagation()}
                                onChange={e => updateVerseNote(itemKey, e.target.value)} rows={2} />
                            )}
                          </div>
                          <div className="setlist-actions">
                            <button className="setlist-live-btn" onClick={() => goLiveFromSetlist(item)}>Go Live</button>
                            <button className="setlist-remove-btn" onClick={() => removeFromSetlist(itemKey)}>x</button>
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
                  ? <div className="empty-state">Loading...</div>
                  : <ul className="browse-book-list">
                      {browseBooks.map(b => (
                        <li key={b.book_id} className="browse-book-item" onClick={() => handleBrowseBook(b)}>
                          <div className="browse-book-info">
                            <span className="browse-book-title">{b.book_title}</span>
                            <span className="browse-book-meta">{b.volume_short_title} -- {b.chapter_count} ch</span>
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
                <span className="card-label">Verse of the Day</span>
                <span className="card-hint">{new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</span>
              </div>
              {verseOfDay ? (
                <>
                  <p className="votd-text">"{verseOfDay.scripture_text}"</p>
                  <div className="votd-footer">
                    <span className="votd-ref">-- {verseOfDay.book_title} {verseOfDay.chapter_number}:{verseOfDay.verse_number}{verseOfDay.version_citation ? ` (${verseOfDay.version_citation})` : ''}</span>
                    <div className="votd-actions">
                      <button className="votd-btn" title="Copy verse text" onClick={() => {
                        copyVerseText(verseOfDay, '');
                        setVotdCopied(true);
                        setTimeout(() => setVotdCopied(false), 1800);
                      }}>{votdCopied ? 'Copied' : 'Copy'}</button>
                      <button className="votd-btn" title="Stage this verse" onClick={() => {
                        setStaged({ ...verseOfDay, theme: themeForVerse(currentTheme, verseOfDay) });
                      }}>Stage</button>
                      <button className="votd-btn votd-btn--live" title="Go live with this verse" onClick={() => {
                        goLiveDirectly(verseOfDay);
                      }}>Go Live</button>
                    </div>
                  </div>
                </>
              ) : votdError ? (
                <p className="votd-loading">Could not load verse -- check databases are loaded.</p>
              ) : (
                <p className="votd-loading">Loading...</p>
              )}
            </section>

            {/* ── Status + Ready checklist ── */}
            <div className="idle-grid">

              {/* Ready checklist card */}
              <section className="card idle-checklist">
                <div className="card-header">
                  <span className="card-label">Ready Check</span>
                </div>
                <ul className="idle-checks">
                  <li className={`idle-check ${connectionState === 'connected' ? 'idle-check--ok' : 'idle-check--wait'}`}>
                    <span className="idle-check-icon">{connectionState === 'connected' ? <IconCheck /> : 'O'}</span>
                    <span>Databases loaded</span>
                  </li>
                  <li className="idle-check idle-check--tip">
                    <span className="idle-check-icon"><IconBolt /></span>
                    <span>Search a verse to stage it</span>
                  </li>
                  <li className="idle-check idle-check--tip">
                    <span className="idle-check-icon"><IconBolt /></span>
                    <span>Hit Go Live to project</span>
                  </li>
                </ul>
              </section>

            </div>

            {/* ── Quick Topics ───────────────────────────────── */}
            <section className="card idle-topics">
              <div className="card-header">
                <span className="card-label">Quick Topics</span>
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
              <span className="card-label">Staged</span>
              <div className="staging-nav">
                <button className="nav-button" onClick={() => fetchAdjacent('prev', true)}>Prev</button>
                <button className="nav-button" onClick={() => fetchAdjacent('next', true)}>Next</button>
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
            <button className={`go-live-button${activeTourTarget === 'golive' ? ' tour-focus' : ''}`} onClick={goLive}>Go Live</button>
          </section>
        )}

        {/* ── Live preview card ── */}
        {liveVerse && (
          <section className="card card--preview">
            <div className="card-header">
              <span className="card-label">Preview</span>
              <div className="preview-card-actions">
                {highlightedText && (
                  <button className="clear-highlight-btn" onClick={clearHighlight} title="Clear highlight (Esc)">
                    Clear Highlight
                  </button>
                )}
                <span className="card-hint">select text to highlight</span>
                <button className="end-live-btn" onClick={endLive} title="End live -- clears screen (E)">
                  End Live
                </button>
              </div>
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
            <div className="preview-box" onMouseUp={handlePreviewTextSelection}>
              <div className="preview-text">{renderPreviewText()}</div>
              {(liveVerse.secondary_segments?.[currentSegment] || liveVerse.secondary_text) && (
                <p className="preview-secondary-text">
                  {liveVerse.secondary_segments?.[currentSegment] || liveVerse.secondary_text}
                </p>
              )}
              {hasSegments && currentSegment < liveVerse.segments.length - 1 && (
                <div className="preview-cont">cont...</div>
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
          </section>
        )}

        {/* ── F2 / F12 — Announcement card ── */}
        <section className="card card--custom">
          <div className="card-header">
            <span className="card-label">Announcement</span>
            {isCustomLive && <button className="end-live-btn" onClick={endLive}>End Custom</button>}
          </div>
          <div className="custom-text-form">
            <textarea className="custom-text-area" placeholder="Text shown large on screen..."
              value={customText} onChange={e => setCustomText(e.target.value)} rows={3} />
            <input className="custom-subtext-input" type="text" placeholder="Subtext / attribution (optional)"
              value={customSubtext} onChange={e => setCustomSubtext(e.target.value)} />
          </div>
          <button className={`go-live-button${!customText.trim() ? ' go-live-button--disabled' : ''}`}
            disabled={!customText.trim()} onClick={sendCustomToScreen}>
            Send to Screen
          </button>
        </section>

        {/* ── Theme card — collapsible ── */}
        <section className="card card--theme">
          <div
            className="card-header card-header--clickable"
            onClick={() => setThemeCardOpen(o => !o)}
            title={themeCardOpen ? 'Collapse theme controls' : 'Expand theme controls'}
          >
            <span className="card-label">Theme &amp; Display</span>
            <span className="card-collapse-icon">{themeCardOpen ? 'Hide' : 'Show'}</span>
          </div>
          {themeCardOpen && (
            <>
              <div className="theme-buttons">
                <button className={`theme-btn${currentTheme === themes.light ? ' active' : ''}`} onClick={() => handleThemeChange(themes.light)}>Light</button>
                <button className={`theme-btn${currentTheme === themes.dark ? ' active' : ''}`} onClick={() => handleThemeChange(themes.dark)}>Dark</button>
              </div>
              {/* Font size control */}
              <div className="font-size-controls">
                <span className="font-size-label">Text Size</span>
                <button className="font-size-btn" onClick={() => adjustFontSize(-0.3)} title="Smaller text" aria-label="Decrease font size">-</button>
                <span className="font-size-badge">{fontSizeRem.toFixed(1)}rem</span>
                <button className="font-size-btn" onClick={() => adjustFontSize(0.3)} title="Larger text" aria-label="Increase font size">+</button>
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

      {/* Sticky Go Live bar — mobile only, appears when a verse is staged */}
      {(staged || liveVerse) && (
        <div className="mobile-golive-bar">
          <button
            className="mobile-nav-btn"
            onClick={() => fetchAdjacent('prev', !liveVerse)}
            aria-label="Previous verse"
          >&#8249;</button>
          <div className="mobile-golive-ref">
            {(staged || liveVerse).book_title} {(staged || liveVerse).chapter_number}:{(staged || liveVerse).verse_number}
          </div>
          <button
            className="mobile-nav-btn"
            onClick={() => fetchAdjacent('next', !liveVerse)}
            aria-label="Next verse"
          >&#8250;</button>
          <div className="mobile-golive-actions">
            {liveVerse && (
              <>
                <button className="mobile-font-btn" onClick={() => adjustFontSize(-0.3)} title="Smaller text" aria-label="Decrease font size">A-</button>
                <button className="mobile-font-btn" onClick={() => adjustFontSize( 0.3)} title="Larger text"  aria-label="Increase font size">A+</button>
                <button className="mobile-endlive-btn" onClick={endLive} title="End live">End</button>
              </>
            )}
            {staged && (
              <button
                className={`mobile-golive-btn${activeTourTarget === 'golive' ? ' tour-focus' : ''}`}
                onClick={goLive}
              >
                Go Live
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default MobilePresenter;
