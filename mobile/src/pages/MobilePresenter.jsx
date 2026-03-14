import React, { useState, useEffect, useRef } from 'react';
import { socket, isDisplayAvailable, isCasting } from '../socket-local';
import * as svc from '../scripture-service';
const { searchEntities } = svc;
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
const SearchResults = ({ results, currentPage, totalPages, onSelect, onGoLive, onPageChange, onAddToSetlist, stagedVerseId, onToggleTranslation, expandedTranslations, translationCache, currentLanguage: srLang }) => {
  if (results.length === 0) return null;
  const hasPrev = currentPage > 0;
  const hasNext = currentPage < totalPages - 1;

  return (
    <>
      {hasPrev && (
        <button className="batch-nav batch-nav--prev" onClick={() => onPageChange(currentPage - 1)} aria-label="Previous batch">
          ▲ <span>Prev batch</span>
        </button>
      )}
      {totalPages > 1 && (
        <div className="batch-indicator">Batch {currentPage + 1} of {totalPages}</div>
      )}
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
      {hasNext && (
        <button className="batch-nav batch-nav--next" onClick={() => onPageChange(currentPage + 1)} aria-label="Next batch">
          ▼ <span>Next batch</span>
        </button>
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
  const [currentTheme, setCurrentTheme]     = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('scicp.display_prefs_v1'));
      if (saved?.theme) return saved.theme;
    } catch { /* ignore */ }
    try { if (window.matchMedia('(prefers-color-scheme: light)').matches) return themes.light; } catch { /* ignore */ }
    return themes.dark;
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
  const [drawerOpen, setDrawerOpen]         = useState(false);
  const [drawerTab, setDrawerTab]           = useState('search');

  const [themePopover, setThemePopover]     = useState(false);
  const [langPopover,  setLangPopover]      = useState(false);
  const [connectionState, setConnectionState] = useState('connecting');
  const [pendingGoLive, setPendingGoLive]   = useState(false);
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

  const [contextOpen,    setContextOpen]    = useState(false);
  const [contextTab,     setContextTab]     = useState('chapter');
  const [contextLoading, setContextLoading] = useState(false);
  const [chapterVerses,  setChapterVerses]  = useState([]);
  const [relatedVerses,  setRelatedVerses]  = useState([]);
  const [relatedConcept, setRelatedConcept] = useState(null);
  const [relatedPage,    setRelatedPage]    = useState(0);
  const [relatedTotal,   setRelatedTotal]   = useState(0);
  const [relatedBatchPage, setRelatedBatchPage] = useState(0);
  const [verseTags,       setVerseTags]       = useState({ pov: null, speaker: null, labels: [], ready: false });
  const [verseEntities,   setVerseEntities]   = useState({ people: [], places: [] });
  const [chapterSummary,  setChapterSummary]  = useState({ summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false });
  const [chapterEntities, setChapterEntities] = useState({ people: [], places: [], ready: false });
  const [entitySearch,    setEntitySearch]    = useState(null);
  const [nowReading,      setNowReading]      = useState(false); // "Now Reading" TV label toggle
  // Topic navigation history inside the Related tab: [{label, verses, concept, total, page, pageSize, type, payload}]
  const [ctxTopicHistory,    setCtxTopicHistory]    = useState([]);
  const [ctxTopicHistoryIdx, setCtxTopicHistoryIdx] = useState(-1);
  // Floating word-explore chip: { word, top, left } | null
  const [ctxWordChip, setCtxWordChip] = useState(null);
  const [bookChapters,   setBookChapters]   = useState([]);
  const [ctxChapterIdx,  setCtxChapterIdx]  = useState(0);
  const [ctxScrolled,    setCtxScrolled]    = useState(false);
  const [ctxAtBottom,    setCtxAtBottom]    = useState(false);
  const ctxBodyRef     = useRef(null);
  const ctxTouchStartX = useRef(null);
  const chapterNeedsRefetchRef = useRef(false); // set true when chapter changes so openContextModal force-refetches
  const [ctxSlideDir,  setCtxSlideDir]  = useState(null); // 'prev' | 'next' | null
  const RELATED_PAGE_SIZE = 8;

  // Reset verse-level and navigation context when live verse changes
  useEffect(() => {
    setRelatedVerses([]);
    setRelatedConcept(null);
    setRelatedPage(0);
    setRelatedBatchPage(0);
    setRelatedTotal(0);
    setCtxTopicHistory([]);
    setCtxTopicHistoryIdx(-1);
    setBookChapters([]);
    setCtxChapterIdx(0);
    setCtxScrolled(false);
    setCtxAtBottom(false);
    setVerseTags({ pov: null, speaker: null, labels: [], ready: false });
    setVerseEntities({ people: [], places: [] });
    setEntitySearch(null);
    // Fetch verse-level NLP tags
    if (liveVerse?.verse_id) {
      const tags = svc.getVerseTags(liveVerse.verse_id);
      if (tags) setVerseTags(tags);
    }
  }, [liveVerse?.verse_id]);

  // Reset chapter-level modal data only when the CHAPTER changes (not on every verse)
  useEffect(() => {
    setChapterVerses([]);
    setChapterSummary({ summary_text: null, summary_method: null, key_verses: [], top_topics: [], ready: false });
    setChapterEntities({ people: [], places: [], ready: false });
    chapterNeedsRefetchRef.current = true; // signal openContextModal to force-refetch
  }, [liveVerse?.chapter_id]);

  // Re-fetch chapter modal data when chapter changes and modal is already open
  useEffect(() => {
    if (!liveVerse?.chapter_id || !contextOpen) return;
    if (contextTab === 'chapter' || contextTab === 'summary' || contextTab === 'entities') {
      openContextModal('chapter');
    }
  }, [liveVerse?.chapter_id]); // eslint-disable-line react-hooks/exhaustive-deps
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

  useEffect(() => { setBrowseBooksLoaded(false); setBrowseLevel('books'); }, [currentLanguage]);

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
  const [themeCardOpen, setThemeCardOpen]     = useState(() => window.innerWidth > 768);
  const [fontSizeRem, setFontSizeRem]         = useState(() => { try { const s = JSON.parse(localStorage.getItem('scicp.display_prefs_v1')); return s?.fontSizeRem ?? 4.1; } catch { return 4.1; } });
  const [uiFontSize, setUiFontSize]           = useState(() => { try { const s = JSON.parse(localStorage.getItem('scicp.display_prefs_v1')); return s?.uiFontSize ?? 1.0; } catch { return 1.0; } });
  const [autoAdvance, setAutoAdvance]         = useState(false);
  const [autoAdvanceSec, setAutoAdvanceSec]   = useState(5);
  const autoAdvanceTimer                       = useRef(null);
  const pendingGoLivePayload                   = useRef(null);
  const mainPanelRef    = useRef(null);
  const searchDebounce  = useRef(null); // debounce timer for search socket emits
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
  const PAGE_SIZE = 4; // 4 results/batch on mobile — thumb-friendly glide navigation
  const emitWithSession = (event, payload = {}) => socket.emit(event, { ...payload, sessionId: 'LOCAL' });

  const showToast = (msg) => {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2200);
  };

  const endLive = () => {
    emitWithSession('clear-screen');
    setLiveVerse(null);
    setHighlightedText('');
    setCurrentSegment(0);
    setIsCustomLive(false);
    showToast('Screen cleared');
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
      showToast(`Copied${label ? ' ' + label : ''}`);
    }).catch(() => showToast('Copy failed -- clipboard not available'));
  };
  const activeTourTarget = tourOpen ? presenterTourSteps[tourStep].target : '';

  const exportDiagnostics = async () => {
    let displayAvailable = false;
    try { displayAvailable = await isDisplayAvailable(); } catch { /* ignore */ }
    const payload = {
      generatedAt: new Date().toISOString(),
      mode: 'offline-mobile',
      connectionState,
      pendingGoLive,
      casting: {
        available: displayAvailable,
        active: isCasting(),
      },
      language: {
        primary: currentLanguage,
        secondary: secondaryLanguage || null,
        loaded: svc.getLoadedLanguages ? svc.getLoadedLanguages() : [],
      },
      runtime: {
        online: navigator.onLine,
        userAgent: navigator.userAgent,
      },
    };
    const text = JSON.stringify(payload, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      showToast('Diagnostics copied');
      return;
    } catch { /* fallback below */ }

    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scicp-mobile-diagnostics-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Diagnostics downloaded');
  };

  const emitGoLiveWithRetry = (payload) => {
    if (connectionState !== 'connected') {
      pendingGoLivePayload.current = payload;
      setPendingGoLive(true);
      showToast('Go Live queued until reconnected');
      return false;
    }
    try {
      emitWithSession('go-live', payload);
      pendingGoLivePayload.current = null;
      setPendingGoLive(false);
      return true;
    } catch (err) {
      console.error('[MobilePresenter] go-live failed:', err);
      pendingGoLivePayload.current = payload;
      setPendingGoLive(true);
      setConnectionState('error');
      showToast('Go Live queued until reconnected');
      return false;
    }
  };

  useEffect(() => {
    document.title = 'Presenter | Scriptures in View';
  }, []);

  useEffect(() => {
    if (connectionState !== 'connected' || !pendingGoLivePayload.current) return;
    const payload = pendingGoLivePayload.current;
    try {
      emitWithSession('go-live', payload);
      pendingGoLivePayload.current = null;
      setPendingGoLive(false);
      showToast('Queued Go Live sent');
    } catch (err) {
      console.error('[MobilePresenter] queued go-live failed:', err);
      setConnectionState('error');
    }
  }, [connectionState]);

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
    }
  };

  const openTour = () => {
    setTourStep(0);
    setTourOpen(true);
  };

  const retryConnection = () => {
    setConnectionState('connecting');
    socket.init().catch(err => {
      console.error('[MobilePresenter] reconnect failed:', err);
      setConnectionState('error');
    });
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
    if (verseTheme?.background_url) {
      const match = String(verseTheme.background_url).match(/url\((['"]?)(.*?)\1\)/i);
      if (match?.[2]) emitWithSession('preload-background', { background_url: match[2] });
    }
  };

  const goLiveDirectly = verse => {
    const v = { ...verse, theme: themeForVerse(currentTheme, verse) };
    emitGoLiveWithRetry({ verse: v, theme: v.theme, language: currentLanguage, secondaryLanguage: secondaryLanguage || null });
    setLiveVerse(v);
    setCurrentSegment(0);
    setHistory(h => [{ ...v, _ts: Date.now() }, ...h.filter(e => e.verse_id !== v.verse_id).slice(0, 19)]);
    setDrawerOpen(false);
  };

  const goLive = () => {
    if (!staged) return;
    emitGoLiveWithRetry({ verse: staged, theme: staged.theme, language: currentLanguage, secondaryLanguage: secondaryLanguage || null });
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
    try {
      const data = svc.getAdjacent(source, direction, currentLanguage);
      if (!data) return;
      const v = { ...data, theme: themeForVerse(currentTheme, data) };
      if (preferStaged && staged) {
        setStaged(v);
      } else {
        emitGoLiveWithRetry({ verse: v, theme: v.theme, language: currentLanguage, secondaryLanguage: secondaryLanguage || null });
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

  const openContextModal = (tab = 'chapter') => {
    if (!liveVerse) return;
    setContextOpen(true);
    setContextLoading(true);
    setCtxScrolled(false);
    setCtxAtBottom(false);
    try {
      if (tab === 'chapter') {
        let chapterId = liveVerse.chapter_id;
        let chapters  = bookChapters;
        if (!chapters.length && liveVerse.book_id) {
          chapters = svc.browse('chapters', { bookId: liveVerse.book_id }, currentLanguage);
          if (Array.isArray(chapters)) setBookChapters(chapters);
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
        if (force || !chapterVerses.length) {
          const verses = svc.browse('verses', { chapterId }, currentLanguage);
          setChapterVerses(Array.isArray(verses) ? verses : []);
        }
        if (force || !chapterSummary.ready) {
          const summary = svc.getChapterSummary(chapterId);
          setChapterSummary(summary);
        }
        if (force || !chapterEntities.ready) {
          const entities = svc.getChapterEntities(chapterId);
          setChapterEntities(entities);
        }
      } else if (tab === 'related' && !relatedVerses.length) {
        const { results, matchedConcept: mc, total } = svc.getRelated(liveVerse.verse_id, currentLanguage);
        const allResults = results ?? [];
        setRelatedVerses(allResults.slice(0, RELATED_PAGE_SIZE));
        setRelatedConcept(mc ?? null);
        setRelatedBatchPage(0);
        setRelatedTotal(allResults.length);
        setRelatedPage(0);
        // store all results for page navigation (mobile frontend-paginated)
        setCtxTopicHistory([{ label: mc ?? 'Related', concept: mc ?? 'Related', type: 'verse', payload: liveVerse.verse_id, verses: allResults, total: allResults.length, page: 0, pageSize: RELATED_PAGE_SIZE }]);
        setCtxTopicHistoryIdx(0);
      }
    } catch (err) {
      console.error('openContextModal failed', err);
    } finally {
      setContextLoading(false);
    }
  };

  // Mobile uses frontend pagination: load all results, slice by batch page
  const _mobileSetBatchFromAllVerses = (allVerses, label, concept, batchPage = 0) => {
    const pageSlice = allVerses.slice(batchPage * RELATED_PAGE_SIZE, (batchPage + 1) * RELATED_PAGE_SIZE);
    setRelatedVerses(pageSlice);
    setRelatedConcept(concept);
    setRelatedBatchPage(batchPage);
    setRelatedTotal(allVerses.length);
    setRelatedPage(0);
    if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
  };

  const loadTopicInModal = (topicLabel, batchPage = 0) => {
    if (!topicLabel) return;
    setContextLoading(true);
    try {
      const data = svc.search(topicLabel, 0, 50, currentLanguage);
      const allVerses = data?.results ?? [];
      const newEntry = { label: topicLabel, concept: topicLabel, type: 'topic', payload: topicLabel, verses: allVerses, total: allVerses.length, page: batchPage, pageSize: RELATED_PAGE_SIZE };
      setCtxTopicHistory(prev => {
        const base = ctxTopicHistoryIdx >= 0 ? prev.slice(0, ctxTopicHistoryIdx + 1) : [];
        const next = [...base, newEntry];
        setCtxTopicHistoryIdx(next.length - 1);
        return next;
      });
      _mobileSetBatchFromAllVerses(allVerses, topicLabel, topicLabel, batchPage);
    } finally {
      setContextLoading(false);
    }
  };

  // Navigate to a different batch within the current history entry (mobile frontend-paginated)
  const loadHistoryPage = (batchPage) => {
    const entry = ctxTopicHistory[ctxTopicHistoryIdx];
    if (!entry) return;
    const allVerses = entry.verses;
    const updated = { ...entry, page: batchPage };
    setCtxTopicHistory(prev => prev.map((e, i) => i === ctxTopicHistoryIdx ? updated : e));
    _mobileSetBatchFromAllVerses(allVerses, entry.label, entry.concept, batchPage);
  };

  const ctxTopicBack = () => {
    const newIdx = ctxTopicHistoryIdx - 1;
    if (newIdx < 0) return;
    const entry = ctxTopicHistory[newIdx];
    setCtxTopicHistoryIdx(newIdx);
    _mobileSetBatchFromAllVerses(entry.verses, entry.label, entry.concept, entry.page ?? 0);
  };

  const ctxTopicForward = () => {
    const newIdx = ctxTopicHistoryIdx + 1;
    if (newIdx >= ctxTopicHistory.length) return;
    const entry = ctxTopicHistory[newIdx];
    setCtxTopicHistoryIdx(newIdx);
    _mobileSetBatchFromAllVerses(entry.verses, entry.label, entry.concept, entry.page ?? 0);
  };

  const drillIntoVerse = (verse, batchPage = 0) => {
    setContextLoading(true);
    setCtxWordChip(null);
    try {
      const data = svc.getRelated(verse.verse_id, currentLanguage);
      const allVerses = data?.results ?? [];
      const label = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
      const concept = data?.matchedConcept ?? label;
      const newEntry = { label, concept, type: 'verse', payload: verse.verse_id, verses: allVerses, total: allVerses.length, page: batchPage, pageSize: RELATED_PAGE_SIZE };
      setCtxTopicHistory(prev => {
        const base = ctxTopicHistoryIdx >= 0 ? prev.slice(0, ctxTopicHistoryIdx + 1) : [];
        const next = [...base, newEntry];
        setCtxTopicHistoryIdx(next.length - 1);
        return next;
      });
      _mobileSetBatchFromAllVerses(allVerses, label, concept, batchPage);
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
    try {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const containerRect = e.currentTarget.getBoundingClientRect();
      setCtxWordChip({
        word,
        top: rect.bottom - containerRect.top + 6,
        left: Math.max(4, Math.min(rect.left - containerRect.left, containerRect.width - 180)),
      });
    } catch { setCtxWordChip(null); }
  };

  const loadCtxChapterByIdx = (idx) => {
    const ch = bookChapters[idx];
    if (!ch) return;
    const dir = idx > ctxChapterIdx ? 'next' : 'prev';
    setCtxSlideDir(dir);
    setTimeout(() => {
      setCtxSlideDir(null);
      setCtxScrolled(false);
      setCtxAtBottom(false);
      setContextLoading(true);
      try {
        const verses = svc.browse('verses', { chapterId: ch.chapter_id }, currentLanguage);
        setChapterVerses(Array.isArray(verses) ? verses : []);
        const summary = svc.getChapterSummary(ch.chapter_id);
        setChapterSummary(summary);
        const entities = svc.getChapterEntities(ch.chapter_id);
        setChapterEntities(entities);
        setCtxChapterIdx(idx);
        if (ctxBodyRef.current) ctxBodyRef.current.scrollTop = 0;
      } catch (err) {
        console.error('loadCtxChapterByIdx failed', err);
      } finally {
        setContextLoading(false);
      }
    }, 210);
  };

  const handleCtxBodyScroll = (e) => {
    const el = e.currentTarget;
    setCtxScrolled(el.scrollTop > 80);
    setCtxAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 16);
  };

  const handleCtxTouchStart = (e) => {
    if (contextTab !== 'chapter') return;
    ctxTouchStartX.current = e.touches[0].clientX;
  };

  const handleCtxTouchEnd = (e) => {
    if (contextTab !== 'chapter' || ctxTouchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - ctxTouchStartX.current;
    ctxTouchStartX.current = null;
    if (Math.abs(delta) < 60) return;
    const nextIdx = ctxChapterIdx + (delta < 0 ? 1 : -1);
    if (nextIdx >= 0 && nextIdx < bookChapters.length) loadCtxChapterByIdx(nextIdx);
  };

  const handleLanguageChange = e => {
    const lang = e.target.value;
    setCurrentLanguage(lang);
    setRelatedVerses([]);   // force re-fetch in new language when modal reopened
    setRelatedConcept(null);
    setRelatedBatchPage(0);
    setRelatedTotal(0);
    setCtxTopicHistory([]);
    setCtxTopicHistoryIdx(-1);
    setChapterVerses([]);   // force re-fetch chapter verses in new language
    setExpandedTranslations(new Set());
    emitWithSession('update-language', { language: lang });
    // Update live verse text directly (handles offline / no session case)
    if (liveVerse) {
      try {
        const row = svc.getVerse({ verse_id: liveVerse.verse_id }, lang);
        if (row?.scripture_text) setLiveVerse(prev => prev ? { ...prev, scripture_text: row.scripture_text, segments: null, language: lang } : prev);
      } catch (_) {}
      emitGoLiveWithRetry({ verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: lang, secondaryLanguage: secondaryLanguage || null });
    }
    // Update staged verse text to the new language
    if (staged) {
      try {
        const row = svc.getVerse({ verse_id: staged.verse_id }, lang);
        if (row?.scripture_text) setStaged(prev => prev ? { ...prev, scripture_text: row.scripture_text } : prev);
      } catch (_) {}
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
    if (liveVerse) emitGoLiveWithRetry({ verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: currentLanguage, secondaryLanguage: lang || null });
  };

  const handleSwapLanguages = () => {
    if (!secondaryLanguage) return;
    const newPrimary   = secondaryLanguage;
    const newSecondary = currentLanguage;
    setCurrentLanguage(newPrimary);
    setSecondaryLanguage(newSecondary);
    setExpandedTranslations(new Set());
    setChapterVerses([]);
    setRelatedVerses([]);
    setCtxTopicHistory([]);
    setCtxTopicHistoryIdx(-1);
    emitWithSession('update-language', { language: newPrimary });
    if (liveVerse) {
      try {
        const row = svc.getVerse({ verse_id: liveVerse.verse_id }, newPrimary);
        if (row?.scripture_text) setLiveVerse(prev => prev ? { ...prev, scripture_text: row.scripture_text, segments: null, language: newPrimary } : prev);
      } catch (_) {}
      emitGoLiveWithRetry({ verse: liveVerse, theme: themeForVerse(currentTheme, liveVerse), language: newPrimary, secondaryLanguage: newSecondary });
    }
    if (staged) {
      try {
        const row = svc.getVerse({ verse_id: staged.verse_id }, newPrimary);
        if (row?.scripture_text) setStaged(prev => prev ? { ...prev, scripture_text: row.scripture_text } : prev);
      } catch (_) {}
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

  const sendCustomToScreen = () => {
    if (!customText.trim()) return;
    emitWithSession('go-custom', { text: customText.trim(), subtext: customSubtext.trim(), theme: currentTheme });
    setIsCustomLive(true);
    showToast('Announcement sent to screen');
  };

  const fetchSavedSetlists = () => {
    setSetlistsLoading(true);
    // Setlists are not persisted on mobile for now — use local state only
    setSavedSetlists([]);
    setSetlistsLoading(false);
  };
  const saveSetlist = () => {
    const name = setlistSaveName.trim();
    if (!name) return;
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
        setTranslationCache(c => ({ ...c, [cacheKey]: row?.scripture_text || '(translation unavailable)' }));
      } catch {
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
  }, [autoAdvance, liveVerse, autoAdvanceSec]);

  // Auto-suggest layout based on text length
  useEffect(() => {
    if (!staged) return;
    const wordCount = (staged.scripture_text || '').trim().split(/\s+/).filter(Boolean).length;
    const currentLayout = currentTheme?.layout || 'centered';
    if (wordCount > 80 && currentLayout === 'lower-third') {
      showToast('💡 Long verse — consider switching to "Centered" layout for readability');
    }
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
  const hasLiveActionBar = Boolean(staged || liveVerse);

  return (
    <>
    <div className={`presenter-container ${presenterThemeClass}${hasLiveActionBar ? ' presenter-container--actionbar' : ''}`} style={{ '--ui-font-size': `${uiFontSize}rem` }}>

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
          <CastingControl />
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

      {connectionState !== 'connected' && (
        <div className={`mobile-conn-banner mobile-conn-banner--${connectionState}`} role="status" aria-live="polite">
          <span>
            {connectionState === 'connecting' ? 'Connecting offline services...' : 'Offline services disconnected.'}
            {pendingGoLive ? ' Go Live is queued.' : ''}
          </span>
          {connectionState !== 'connecting' && (
            <button className="mobile-conn-banner-btn" onClick={retryConnection}>Retry</button>
          )}
        </div>
      )}

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
                          setCurrentPage(newPage);
                          setResultsScrolled(false);
                          if (resultsListRef.current) resultsListRef.current.scrollTop = 0;
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

              <section className="card idle-checklist idle-diagnostics">
                <div className="card-header">
                  <span className="card-label">Offline Health</span>
                </div>
                <ul className="idle-checks">
                  <li className={`idle-check ${connectionState === 'connected' ? 'idle-check--ok' : 'idle-check--wait'}`}>
                    <span className="idle-check-icon">{connectionState === 'connected' ? <IconCheck /> : 'O'}</span>
                    <span>Service: {connectionState}</span>
                  </li>
                  <li className={`idle-check ${pendingGoLive ? 'idle-check--wait' : 'idle-check--ok'}`}>
                    <span className="idle-check-icon">{pendingGoLive ? 'O' : <IconCheck />}</span>
                    <span>Go Live queue: {pendingGoLive ? '1 pending' : 'empty'}</span>
                  </li>
                  <li className="idle-check idle-check--tip">
                    <span className="idle-check-icon"><IconGlobe /></span>
                    <span>Primary: {currentLanguage.toUpperCase()}{secondaryLanguage ? `, +${secondaryLanguage.toUpperCase()}` : ''}</span>
                  </li>
                </ul>
                <button className="theme-btn idle-diagnostics-btn" onClick={exportDiagnostics}>
                  Export diagnostics
                </button>
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
            {/* POV + doctrine chips on staged verse */}
            {(verseTags.pov || verseTags.labels.length > 0) && (
              <div className="preview-entity-chips">
                {verseTags.pov && <span className="ctx-pov-badge">{verseTags.pov}</span>}
                {verseTags.speaker && <span className="ctx-pov-badge ctx-pov-badge--speaker" title="Speaker">✍ {verseTags.speaker}</span>}
                {verseTags.labels.slice(0, 3).map(t => (
                  <span key={t.label} className="ctx-doctrine-chip ctx-doctrine-chip--preview">{t.label}</span>
                ))}
              </div>
            )}
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
                <button className="context-expand-btn"
                  onClick={() => { setContextTab('chapter'); openContextModal('chapter'); }}
                  title="Chapter & related scriptures">
                  ☰ Context
                </button>
                <button
                  className={`now-reading-btn${nowReading ? ' now-reading-btn--on' : ''}`}
                  onClick={toggleNowReading}
                  title="Toggle 'Now Reading' label on the display screen">
                  📖{nowReading ? ' On' : ' Off'}
                </button>
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
                <button className="font-size-btn" onClick={() => adjustFontSize(-0.3)} title="Smaller text" aria-label="Decrease font size">-</button>
                <span className="font-size-badge">{fontSizeRem.toFixed(1)}rem</span>
                <button className="font-size-btn" onClick={() => adjustFontSize(0.3)} title="Larger text" aria-label="Increase font size">+</button>
              </div>
              <div className="font-size-controls">
                <span className="font-size-label">Reading Size</span>
                <button className="font-size-btn" onClick={() => adjustUiFontSize(-0.1)} title="Smaller reading text" aria-label="Decrease reading font size">-</button>
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

      {!hasLiveActionBar && (
        <div className="mobile-core-bar">
          <button
            className={`mobile-core-btn${drawerOpen && drawerTab === 'search' ? ' mobile-core-btn--active' : ''}`}
            onClick={() => { openDrawer('search'); setMobileMenuOpen(false); }}
            aria-label="Open search"
            title="Search scriptures"
          >
            <IconSearch />
            <span>Search</span>
          </button>
          <button
            className={`mobile-core-btn${drawerOpen && drawerTab === 'setlist' ? ' mobile-core-btn--active' : ''}`}
            onClick={() => { openDrawer('setlist'); setMobileMenuOpen(false); }}
            aria-label="Open setlist"
            title="Open setlist"
          >
            <IconList />
            <span>Setlist</span>
          </button>
          <button
            className={`mobile-core-btn${staged ? ' mobile-core-btn--live' : ''}${drawerOpen && drawerTab === 'history' && !staged ? ' mobile-core-btn--active' : ''}`}
            onClick={() => {
              if (staged) goLive();
              else if (!drawerOpen || drawerTab !== 'history') openDrawer('history');
              else setDrawerOpen(false);
            }}
            aria-label={staged ? 'Go live now' : 'Open recent verses'}
            title={staged ? 'Go Live' : 'Recent verses'}
          >
            {staged ? <IconBolt /> : <IconClock />}
            <span>{staged ? 'Go Live' : 'Recent'}</span>
          </button>
          <CastingControl className="mobile-core-btn mobile-core-btn--cast" label="Cast" />
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
            <button className="mobile-mini-btn" onClick={() => openDrawer('search')}>Search</button>
            <button className="mobile-mini-btn" onClick={() => openDrawer('setlist')}>Setlist</button>
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

      {/* Context Modal — Chapter / Related (offline, TG-powered) */}
      {contextOpen && liveVerse && (
        <div className="ctx-backdrop" onClick={() => setContextOpen(false)}>
          <div className="ctx-modal" onClick={e => e.stopPropagation()}>
            <div className="ctx-header">
              <span className="ctx-title">
                {contextTab === 'chapter' && bookChapters[ctxChapterIdx]
                  ? `${liveVerse.book_title} ${bookChapters[ctxChapterIdx].chapter_number}`
                  : `${liveVerse.book_title} ${liveVerse.chapter_number}:${liveVerse.verse_number}`}
              </span>
              <button className="ctx-close" onClick={() => setContextOpen(false)}>✕</button>
            </div>
            <div className="ctx-tabs">
              <button className={`ctx-tab${contextTab === 'chapter' ? ' ctx-tab--active' : ''}`}
                onClick={() => { setContextTab('chapter'); setCtxWordChip(null); if (!chapterVerses.length) openContextModal('chapter'); }}>
                Chapter {liveVerse.chapter_number}
              </button>
              <button className={`ctx-tab${contextTab === 'related' ? ' ctx-tab--active' : ''}`}
                onClick={() => { setContextTab('related'); if (!relatedVerses.length) openContextModal('related'); }}>
                Related
                {relatedConcept && (
                  <span className="ctx-concept-tag">
                    {relatedConcept.replace(/^_+/, '').replace(/_/g, ' ')}
                  </span>
                )}
              </button>
              <button className={`ctx-tab${contextTab === 'summary' ? ' ctx-tab--active' : ''}`}
                onClick={() => { setContextTab('summary'); if (!chapterSummary.ready) openContextModal('chapter'); }}>
                Summary
              </button>
              <button className={`ctx-tab${contextTab === 'entities' ? ' ctx-tab--active' : ''}`}
                onClick={() => { setContextTab('entities'); setEntitySearch(null); if (!chapterEntities.ready) openContextModal('chapter'); }}>
                People &amp; Places
              </button>
            </div>
            <div className="ctx-body-wrap">
              <div className="ctx-body"
                ref={ctxBodyRef}
                onScroll={handleCtxBodyScroll}
                onTouchStart={handleCtxTouchStart}
                onTouchEnd={(e) => { handleCtxTouchEnd(e); if (contextTab === 'related') handleCtxTextMouseUp(e); }}
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
                      {chapterVerses.map(v => (
                        <li key={v.verse_id}
                          className={`ctx-item${v.verse_id === liveVerse.verse_id ? ' ctx-item--live' : ''}`}>
                          <span className="ctx-item-ref">{v.verse_number}</span>
                          <span className="ctx-item-text">{v.scripture_text}</span>
                          <div className="ctx-item-actions">
                            <button onClick={() => { setStaged({ ...v, theme: themeForVerse(currentTheme, v) }); setContextOpen(false); }}>Stage</button>
                            <button onClick={() => addToSetlist(v)}>+ List</button>
                            <button onClick={() => { goLiveDirectly(v); setContextOpen(false); }}>● Live</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    {(() => {
                      const totalRelPages = relatedTotal > 0 ? Math.ceil(relatedTotal / RELATED_PAGE_SIZE) : 1;
                      return (
                        <>
                          {/* Topic history nav bar */}
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
                          {relatedBatchPage > 0 && (
                            <button className="batch-nav batch-nav--prev" onClick={() => loadHistoryPage(relatedBatchPage - 1)}>
                              ▲ <span>Prev batch</span>
                            </button>
                          )}
                          {totalRelPages > 1 && (
                            <div className="batch-indicator">Batch {relatedBatchPage + 1} of {totalRelPages}</div>
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
                                      <button onClick={() => { setStaged({ ...v, theme: themeForVerse(currentTheme, v) }); setContextOpen(false); }}>Stage</button>
                                      <button onClick={() => addToSetlist(v)}>+ List</button>
                                      <button onClick={() => { goLiveDirectly(v); setContextOpen(false); }}>● Live</button>
                                    </div>
                                  </li>
                                ))
                            }
                          </ul>
                          {relatedBatchPage < totalRelPages - 1 && (
                            <button className="batch-nav batch-nav--next" onClick={() => loadHistoryPage(relatedBatchPage + 1)}>
                              ▼ <span>Next batch</span>
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </>
                )}
              </div>
              {/* ── Summary tab ── */}
              {contextTab === 'summary' && (
                <div className="ctx-body" style={{ overflowY: 'auto' }}>
                  <div className="ctx-summary-panel">
                    {!chapterSummary.ready && <p className="ctx-empty">Loading summary…</p>}
                    {chapterSummary.ready && (
                      <>
                        {chapterSummary.top_topics.length > 0 && (
                          <div className="ctx-tag-row ctx-tag-row--topics">
                            {chapterSummary.top_topics.map(t => (
                              <span key={t.label} className="ctx-doctrine-chip" title={`${Math.round(t.score * 100)}% match`}>{t.label}</span>
                            ))}
                          </div>
                        )}
                        {/* Summary prose — only for contextual/abstractive */}
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
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
              {/* ── People & Places tab — chapter level ── */}
              {contextTab === 'entities' && (
                <div className="ctx-body" style={{ overflowY: 'auto' }}>
                  <div className="ctx-entities-panel">
                    {(verseTags.pov || verseTags.speaker) && (
                      <div className="ctx-tag-row">
                        {verseTags.pov && <span className="ctx-pov-badge">{verseTags.pov}</span>}
                        {verseTags.speaker && <span className="ctx-pov-badge ctx-pov-badge--speaker" title="Speaker">✍ {verseTags.speaker}</span>}
                        {verseTags.labels.slice(0, 4).map(t => (
                          <span key={t.label} className="ctx-doctrine-chip" title={`${Math.round(t.score * 100)}% match`}>{t.label}</span>
                        ))}
                      </div>
                    )}
                    {chapterEntities.people.length > 0 && (
                      <div className="ctx-entity-group">
                        <span className="ctx-entity-label">👤 People in this chapter</span>
                        <div className="ctx-entity-chips">
                          {chapterEntities.people.map(p => (
                            <button key={p} className="ctx-entity-chip ctx-entity-chip--person"
                              onClick={() => {
                            const res = searchEntities(p, 'person');
                            setEntitySearch({ name: p, type: 'person', loading: false, results: res.results, total: res.total });
                          }}
                            >{p}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {chapterEntities.places.length > 0 && (
                      <div className="ctx-entity-group">
                        <span className="ctx-entity-label">📍 Places in this chapter</span>
                        <div className="ctx-entity-chips">
                          {chapterEntities.places.map(p => (
                            <button key={p} className="ctx-entity-chip ctx-entity-chip--place"
                              onClick={() => {
                            const res = searchEntities(p, 'place');
                            setEntitySearch({ name: p, type: 'place', loading: false, results: res.results, total: res.total });
                          }}
                            >{p}</button>
                          ))}
                        </div>
                      </div>
                    )}
                    {entitySearch && (
                      <div className="ctx-entity-results">
                        <div className="ctx-entity-results-header">
                          <span>"{entitySearch.name}" appears in {entitySearch.total} verse{entitySearch.total !== 1 ? 's' : ''}</span>
                          <button className="ctx-close-mini" onClick={() => setEntitySearch(null)}>✕</button>
                        </div>
                        {entitySearch.results.length === 0 && <p className="ctx-empty">No verses found.</p>}
                        <ul className="ctx-items-list">
                          {entitySearch.results.map(v => (
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
                    )}
                    {!chapterEntities.ready && <p className="ctx-empty">Loading people &amp; places…</p>}
                    {chapterEntities.ready && chapterEntities.people.length === 0 && chapterEntities.places.length === 0 && (
                      <p className="ctx-empty">No named people or places found in this chapter.</p>
                    )}
                  </div>
                </div>
              )}
              {/* Scroll fade hint */}
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
                <div className="ctx-word-chip" style={{ top: ctxWordChip.top, left: ctxWordChip.left }}>
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
    </>
  );
};

export default MobilePresenter;
