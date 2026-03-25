/**
 * ScriptureReader (web + Electron) — Kindle-style immersive reading.
 * Uses the backend REST API. Same UX as mobile reader.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.MODE === 'production' ? '' : 'http://localhost:3000';
const api = async (path) => {
  const r = await fetch(`${API_URL}${path}`);
  if (!r.ok) throw new Error(`${r.status}`);
  return r.json();
};

// ── Constants (identical to mobile reader) ──────────────────────────────────

const LANGUAGES = [
  { value: 'en',  label: 'English'  },
  { value: 'tl',  label: 'Tagalog'  },
  { value: 'ceb', label: 'Cebuano'  },
];

const THEMES = [
  { id: 'night',  label: '🌑 Night',  desc: 'Dark room',        bg: '#0d0e14', fg: '#e8d8c0', ui: 'dark',  accent: '#c9a84c', surface: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.08)', toolbar: 'rgba(10,11,18,0.97)', sheet: '#14161f', overlay: 'rgba(0,0,0,0.65)' },
  { id: 'dim',    label: '🌒 Dim',    desc: 'Headache/migraine', bg: '#0e0b07', fg: '#c4af90', ui: 'dark',  accent: '#b8965a', surface: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)', toolbar: 'rgba(10,8,4,0.97)',  sheet: '#13100c', overlay: 'rgba(0,0,0,0.65)' },
  { id: 'sepia',  label: '🟤 Sepia',  desc: 'Long sessions',    bg: '#f4edd8', fg: '#3a2a14', ui: 'light', accent: '#8b5e2a', surface: 'rgba(0,0,0,0.04)',     border: 'rgba(0,0,0,0.1)',         toolbar: 'rgba(244,237,216,0.97)', sheet: '#fff8ec', overlay: 'rgba(0,0,0,0.4)'  },
  { id: 'day',    label: '☀️ Day',    desc: 'Bright light',     bg: '#fafafa', fg: '#111111', ui: 'light', accent: '#8b5e2a', surface: 'rgba(0,0,0,0.04)',     border: 'rgba(0,0,0,0.1)',         toolbar: 'rgba(250,250,250,0.97)', sheet: '#ffffff', overlay: 'rgba(0,0,0,0.4)'  },
  { id: 'amoled', label: '🖤 AMOLED', desc: 'Battery saver',    bg: '#000000', fg: '#f0f0f0', ui: 'dark',  accent: '#d4a84c', surface: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.09)', toolbar: 'rgba(0,0,0,0.99)',   sheet: '#0a0a0a', overlay: 'rgba(0,0,0,0.75)' },
];

const LINE_HEIGHTS   = [
  { id: 'compact',     label: 'Compact',     val: 1.55 },
  { id: 'comfortable', label: 'Comfortable', val: 1.85 },
  { id: 'relaxed',     label: 'Relaxed',     val: 2.2  },
];
const FONT_FAMILIES  = [
  { id: 'serif',    label: 'Serif',    css: "Georgia, 'Times New Roman', serif" },
  { id: 'sans',     label: 'Sans',     css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { id: 'dyslexic', label: 'Dyslexia', css: "'OpenDyslexic', 'Comic Sans MS', cursive" },
];
const HIGHLIGHT_COLORS = [
  { id: 'yellow', css: 'rgba(255,222,50,0.38)',  border: 'rgba(200,170,0,0.55)'  },
  { id: 'green',  css: 'rgba(72,220,100,0.28)',  border: 'rgba(40,180,70,0.5)'   },
  { id: 'pink',   css: 'rgba(255,90,150,0.25)',  border: 'rgba(220,50,120,0.45)' },
  { id: 'blue',   css: 'rgba(70,160,255,0.25)',  border: 'rgba(30,120,220,0.45)' },
];
const CHAPTER_TABS = [
  { id: 'summary', icon: '📝', label: 'Summary'  },
  { id: 'scholar', icon: '🎓', label: 'Scholar'  },
  { id: 'people',  icon: '👤', label: 'People'   },
];
const VERSE_TABS = [
  { id: 'about',   icon: '💬', label: 'About'   },
  { id: 'related', icon: '🔗', label: 'Related' },
];

const SK = {
  theme:      'scicp.reader_theme',
  fontSize:   'scicp.reader_font_size',
  lineHeight: 'scicp.reader_line_height',
  fontFamily: 'scicp.reader_font_family',
  lang:       'scicp.reader_lang',
  lastRead:   'scicp.reader_last_read',
  highlights: 'scicp.reader_highlights',
  bookmarks:  'scicp.reader_bookmarks',
  setlist:    'scicp.presenter_setlist_v1',
};

const store      = (k, v)  => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* ignore */ } };
const recall     = (k, fb) => { try { const r = localStorage.getItem(k); return r === null ? fb : JSON.parse(r); } catch { return fb; } };
const recallStr  = (k, fb) => { try { return localStorage.getItem(k) || fb; } catch { return fb; } };

const PAGE_SIZE = 20;

// ── Component ──────────────────────────────────────────────────────────────

export default function ScriptureReader({ onExit }) {
  const navigate = useNavigate();
  // Prefs
  const [theme,      setThemeId]    = useState(() => recallStr(SK.theme, 'night'));
  const [fontSize,   setFontSize]   = useState(() => recall(SK.fontSize, 18));
  const [lineHeight, setLineHeight] = useState(() => recallStr(SK.lineHeight, 'comfortable'));
  const [fontFamily, setFontFamily] = useState(() => recallStr(SK.fontFamily, 'serif'));
  const [lang,       setLang]       = useState(() => recallStr(SK.lang, 'en'));

  // Data
  const [books,          setBooks]          = useState([]);
  const [currentBook,    setCurrentBook]    = useState(null);
  const [allChapters,    setAllChapters]    = useState([]);
  const [chapterIdx,     setChapterIdx]     = useState(0);
  const [chapterVerses,  setChapterVerses]  = useState([]);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [lastRead,       setLastRead]       = useState(() => recall(SK.lastRead, null));
  // eslint-disable-next-line no-unused-vars
  const [setlist,        setSetlist]        = useState(() => {
    try { const r = localStorage.getItem(SK.setlist); return r ? JSON.parse(r) : []; } catch { return []; }
  });

  // Annotations
  const [highlights, setHighlights] = useState(() => recall(SK.highlights, {}));
  const [bookmarks,  setBookmarks]  = useState(() => new Set(recall(SK.bookmarks, [])));

  // Screen
  const [screen, setScreen] = useState('home');

  // Toolbar auto-hide
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [scrollPercent,  setScrollPercent]  = useState(0);
  const scrollRef   = useRef(null);
  const lastScrollY = useRef(0);
  const tbTimer     = useRef(null);

  // Sheets
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [rdNavOpen,    setRdNavOpen]    = useState(false);
  const [ctx,          setCtx]          = useState(null);
  const [ctxData,      setCtxData]      = useState({});
  const ctxCacheRef = useRef({});

  // Long-press menu
  const [lpMenu, setLpMenu] = useState(null);
  const lpTimer = useRef(null);

  // Toast
  const [toastMsg, setToastMsg] = useState('');
  const showToast = msg => { setToastMsg(msg); setTimeout(() => setToastMsg(''), 2000); };

  // Search
  const [query,         setQuery]         = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchPage,    setSearchPage]    = useState(0);
  const debounceRef = useRef(null);

  // Scroll-to-verse + found animation
  const scrollToRef  = useRef(null);
  const verseEls     = useRef({});
  const [foundVerse, setFoundVerse] = useState(null); // verse_id to animate as "found"
  const [isOffline, setIsOffline] = useState(() => !navigator.onLine);

  // ── Dwell time + reading pace + coverage ──────────────────────────────────
  const [sessionId]       = useState(() => `rs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  const sessionIdRef      = useRef(null);
  if (sessionIdRef.current === null) sessionIdRef.current = sessionId;
  const verseStartTimeRef = useRef(null);
  const verseInViewRef    = useRef(null);
  const lastVerseTimeRef  = useRef(null);
  const readingPaceRef    = useRef([]);
  const [flowMode,     setFlowMode]     = useState(false);
  const [coverage,     setCoverage]     = useState(new Map());
  const [spacedReview, setSpacedReview] = useState([]);

  // Derived
  const themeObj  = useMemo(() => THEMES.find(t => t.id === theme) || THEMES[0], [theme]);
  const lhObj     = useMemo(() => LINE_HEIGHTS.find(l => l.id === lineHeight) || LINE_HEIGHTS[1], [lineHeight]);
  const ffObj     = useMemo(() => FONT_FAMILIES.find(f => f.id === fontFamily) || FONT_FAMILIES[0], [fontFamily]);
  const currentCh = allChapters[chapterIdx] || null;
  const bookIdx   = useMemo(() => books.findIndex(b => b.book_id === currentBook?.book_id), [books, currentBook]);
  const isFirstChapter = chapterIdx === 0 && bookIdx <= 0;
  const isLastChapter  = chapterIdx >= allChapters.length - 1 && bookIdx >= books.length - 1;

  const cssVars = {
    '--rd-bg':      themeObj.bg,
    '--rd-fg':      themeObj.fg,
    '--rd-accent':  themeObj.accent,
    '--rd-surface': themeObj.surface,
    '--rd-border':  themeObj.border,
    '--rd-toolbar': themeObj.toolbar,
    '--rd-sheet':   themeObj.sheet,
    '--rd-overlay': themeObj.overlay,
    '--rd-dim':     themeObj.ui === 'dark' ? 'rgba(255,255,255,0.38)' : 'rgba(0,0,0,0.4)',
    '--rd-muted':   themeObj.ui === 'dark' ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.2)',
    '--rd-fs':      `${fontSize}px`,
    '--rd-lh':      lhObj.val,
    '--rd-ff':      ffObj.css,
  };

  // ── Pref helpers ──────────────────────────────────────────────────────────
  const saveTheme = id => { setThemeId(id); store(SK.theme, id); };
  const saveFs    = v  => { setFontSize(v); store(SK.fontSize, v); };
  const saveLh    = id => { setLineHeight(id); store(SK.lineHeight, id); };
  const saveFf    = id => { setFontFamily(id); store(SK.fontFamily, id); };
  const saveLang  = l  => { setLang(l); store(SK.lang, l); };

  // ── Reading event emission ─────────────────────────────────────────────────
  const emitReadingEvent = useCallback(async (verse, dwellMs = 0, eventType = 'read') => {
    try {
      const payload = {
        verse_id: verse.verse_id,
        book_id: verse.book_id,
        chapter_id: verse.chapter_id,
        book_title: verse.book_title,
        chapter_number: verse.chapter_number,
        verse_number: verse.verse_number,
        language: lang,
        session_id: sessionIdRef.current,
        dwell_ms: Math.round(dwellMs),
        event_type: eventType,
      };
      fetch(`${API_URL}/reading-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch { /* ignore */ }
  }, [lang]);

  // ── Reading pace (flow mode) ───────────────────────────────────────────────
  const updateReadingPace = useCallback((verseWordCount) => {
    const now = Date.now();
    if (lastVerseTimeRef.current) {
      const elapsed = now - lastVerseTimeRef.current;
      const expectedMs = verseWordCount * 250;
      const paceRatio = elapsed / expectedMs;
      readingPaceRef.current = [...readingPaceRef.current.slice(-4), paceRatio];
      const avgPace = readingPaceRef.current.reduce((a, b) => a + b, 0) / readingPaceRef.current.length;
      const shouldFlow = avgPace < 0.6 && readingPaceRef.current.length >= 3;
      setFlowMode(f => f !== shouldFlow ? shouldFlow : f);
    }
    lastVerseTimeRef.current = now;
  }, []);

  const onVerseVisible = useCallback((verse) => {
    if (verseInViewRef.current && verseStartTimeRef.current) {
      const dwell = Date.now() - verseStartTimeRef.current;
      emitReadingEvent(verseInViewRef.current, dwell, 'read');
    }
    verseInViewRef.current = verse;
    verseStartTimeRef.current = Date.now();
    updateReadingPace(verse.scripture_text?.split(' ').length || 10);
  }, [emitReadingEvent, updateReadingPace]);

  // ── Offline detection ─────────────────────────────────────────────────────
  useEffect(() => {
    document.title = 'Read Scriptures | Scriptures in View';
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogTitle) ogTitle.setAttribute('content', 'Read Scriptures | Scriptures in View');
    if (ogDesc) ogDesc.setAttribute('content', 'Browse and study scriptures');
  }, []);

  useEffect(() => {
    const on = () => setIsOffline(false);
    const off = () => setIsOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Close nav menu on outside click
  useEffect(() => {
    if (!rdNavOpen) return;
    const handler = e => { if (!e.target.closest('.rd-nav-wrap')) setRdNavOpen(false); };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    return () => { document.removeEventListener('mousedown', handler); document.removeEventListener('touchstart', handler); };
  }, [rdNavOpen]);

  // ── Coverage + spaced review fetches ─────────────────────────────────────
  useEffect(() => {
    fetch(`${API_URL}/reading-coverage`)
      .then(r => r.ok ? r.json() : { coverage: [] })
      .then(({ coverage: rows }) => {
        const map = new Map();
        for (const row of rows) map.set(row.chapter_id, row);
        setCoverage(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/spaced-review?limit=3`)
      .then(r => r.ok ? r.json() : { verses: [] })
      .then(({ verses }) => setSpacedReview(verses || []))
      .catch(() => {});
  }, []);

  // ── Load books ────────────────────────────────────────────────────────────
  useEffect(() => {
    api(`/browse/books?language=${lang}`).then(setBooks).catch(() => setBooks([]));
  }, [lang]);

  // ── Chapter loading ───────────────────────────────────────────────────────
  const loadChapter = useCallback(async (book, chapters, idx, anchorVerseId, forceLang) => {
    const ch = chapters[idx];
    if (!ch) return;
    const useLang = forceLang || lang;
    setCurrentBook(book);
    setAllChapters(chapters);
    setChapterIdx(idx);
    setLoadingChapter(true);
    setChapterVerses([]);
    setCtx(null);
    setLpMenu(null);
    ctxCacheRef.current = {};
    scrollToRef.current = anchorVerseId;
    setScreen('chapter');
    setToolbarVisible(true);

    try {
      const vs = await api(`/browse/verses?chapter_id=${ch.chapter_id}&language=${useLang}`);
      setChapterVerses(Array.isArray(vs) ? vs : []);
      const lr = { book_id: book.book_id, book_title: book.book_title, chapter_id: ch.chapter_id, chapter_number: ch.chapter_number, verse_id: anchorVerseId || vs[0]?.verse_id || null };
      setLastRead(lr);
      store(SK.lastRead, lr);
    } catch { setChapterVerses([]); }
    setLoadingChapter(false);
  }, [lang]);

  // Scroll-to-anchor after render + "found" pulse animation
  useEffect(() => {
    if (!scrollToRef.current || !chapterVerses.length) return;
    const target = scrollToRef.current;
    const tid = setTimeout(() => {
      const el = verseEls.current[target];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFoundVerse(target);
        setTimeout(() => setFoundVerse(null), 2800);
        scrollToRef.current = null;
      }
    }, 250);
    return () => clearTimeout(tid);
  }, [chapterVerses]);

  // ── IntersectionObserver: dwell tracking ─────────────────────────────────
  useEffect(() => {
    if (!chapterVerses.length) return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
          const verseId = parseInt(entry.target.dataset.verseId, 10);
          const verse = chapterVerses.find(v => v.verse_id === verseId);
          if (verse) onVerseVisible(verse);
        }
      }
    }, { threshold: 0.6 });
    document.querySelectorAll('[data-verse-id]').forEach(el => observer.observe(el));
    return () => {
      observer.disconnect();
      if (verseInViewRef.current && verseStartTimeRef.current) {
        const dwell = Date.now() - verseStartTimeRef.current;
        emitReadingEvent(verseInViewRef.current, dwell, 'read');
      }
    };
  }, [chapterVerses, onVerseVisible, emitReadingEvent]);

  // ── Book / chapter navigation ─────────────────────────────────────────────
  const openBook = useCallback(async (book) => {
    try {
      const chs = await api(`/browse/chapters?book_id=${book.book_id}&language=${lang}`);
      loadChapter(book, Array.isArray(chs) ? chs : [], 0, null);
    } catch { /* ignore */ }
  }, [lang, loadChapter]);

  const openVerseInReader = useCallback(async (verse) => {
    const book = books.find(b => b.book_id === verse.book_id) || { book_id: verse.book_id, book_title: verse.book_title };
    try {
      const chs = await api(`/browse/chapters?book_id=${verse.book_id}&language=${lang}`);
      const chapters = Array.isArray(chs) ? chs : [];
      const idx = chapters.findIndex(c => c.chapter_id === verse.chapter_id);
      loadChapter(book, chapters, idx >= 0 ? idx : 0, verse.verse_id);
    } catch { /* ignore */ }
  }, [books, lang, loadChapter]);

  const openContinue = useCallback(async () => {
    if (!lastRead) return;
    const book = books.find(b => b.book_id === lastRead.book_id) || { book_id: lastRead.book_id, book_title: lastRead.book_title };
    try {
      const chs = await api(`/browse/chapters?book_id=${lastRead.book_id}&language=${lang}`);
      const chapters = Array.isArray(chs) ? chs : [];
      const idx = chapters.findIndex(c => c.chapter_id === lastRead.chapter_id);
      loadChapter(book, chapters, idx >= 0 ? idx : 0, lastRead.verse_id);
    } catch { /* ignore */ }
  }, [lastRead, books, lang, loadChapter]);

  const goChapter = useCallback(async (delta) => {
    const next = chapterIdx + delta;
    if (next >= 0 && next < allChapters.length) {
      // Normal within-book navigation
      loadChapter(currentBook, allChapters, next, null);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 80);
      return;
    }
    // Cross-book boundary
    const adjBook = books[bookIdx + delta];
    if (!adjBook) return;
    try {
      const chs = await api(`/browse/chapters?book_id=${adjBook.book_id}&language=${lang}`);
      const chapters = Array.isArray(chs) ? chs : [];
      if (!chapters.length) return;
      loadChapter(adjBook, chapters, delta > 0 ? 0 : chapters.length - 1, null);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 80);
    } catch { /* ignore */ }
  }, [chapterIdx, allChapters, currentBook, books, bookIdx, lang, loadChapter]);

  // ── Keyboard navigation ───────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' && screen === 'chapter' && !isLastChapter)  { e.preventDefault(); goChapter(1);  }
      if (e.key === 'ArrowLeft'  && screen === 'chapter' && !isFirstChapter) { e.preventDefault(); goChapter(-1); }
      if (e.key === 'Escape') {
        if (settingsOpen) { setSettingsOpen(false); return; }
        if (ctx)          { setCtx(null); return; }
        if (rdNavOpen)    { setRdNavOpen(false); return; }
        if (screen === 'chapter') { setScreen('home'); setToolbarVisible(true); }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setScreen('home');
        setToolbarVisible(true);
        setTimeout(() => document.querySelector('.rd-search-input')?.focus(), 80);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [screen, goChapter, isFirstChapter, isLastChapter, settingsOpen, ctx, rdNavOpen]);

  // ── Toolbar auto-hide ─────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const dy = y - lastScrollY.current;
    lastScrollY.current = y;
    if (dy > 8 && y > 100) setToolbarVisible(false);
    else if (dy < -8 || y < 80) { setToolbarVisible(true); clearTimeout(tbTimer.current); }
    const max = el.scrollHeight - el.clientHeight;
    setScrollPercent(max > 0 ? Math.min(100, (y / max) * 100) : 0);
  }, []);

  const revealToolbar = useCallback(() => {
    setToolbarVisible(true);
    clearTimeout(tbTimer.current);
    tbTimer.current = setTimeout(() => setToolbarVisible(false), 5000);
  }, []);

  // ── Search ────────────────────────────────────────────────────────────────
  const doSearch = useCallback((q, p = 0, append = false) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    api(`/search?q=${encodeURIComponent(q)}&page=${p}&pageSize=${PAGE_SIZE}&language=${lang}`)
      .then(data => {
        const list = data?.results ?? [];
        setSearchResults(prev => append ? [...prev, ...list] : list);
        setSearchHasMore(list.length === PAGE_SIZE);
        setSearching(false);
      })
      .catch(() => setSearching(false));
  }, [lang]);

  const handleQueryChange = e => {
    const q = e.target.value;
    setQuery(q);
    setSearchPage(0);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(q, 0, false), 300);
  };

  // ── Context sheet ─────────────────────────────────────────────────────────
  const loadCtxData = useCallback(async (tab, verse, chId) => {
    const cache = ctxCacheRef.current;
    try {
      if (tab === 'summary' && !cache.summary) {
        const d = await api(`/chapter/${chId}/summary`);
        cache.summary = d;
        setCtxData(prev => ({ ...prev, summary: d }));
      } else if (tab === 'scholar' && !cache.scholar) {
        // footnotes are included in the summary endpoint
        const d = cache.summary || await api(`/chapter/${chId}/summary`);
        if (!cache.summary) cache.summary = d;
        cache.scholar = { nabre_footnotes: d.nabre_footnotes, net_footnotes: d.net_footnotes };
        setCtxData(prev => ({ ...prev, scholar: cache.scholar }));
      } else if (tab === 'people' && !cache.people) {
        const d = await api(`/chapter/${chId}/entities`);
        cache.people = d;
        setCtxData(prev => ({ ...prev, people: d }));
      } else if (tab === 'about' && verse && !cache[`about_${verse.verse_id}`]) {
        const [about, tags] = await Promise.all([
          api(`/verse/${verse.verse_id}/summary`).catch(() => null),
          api(`/verse/${verse.verse_id}/tags`).catch(() => null),
        ]);
        cache[`about_${verse.verse_id}`] = { about, tags };
        setCtxData(prev => ({ ...prev, about, tags }));
      } else if (tab === 'related' && verse && !cache[`related_${verse.verse_id}`]) {
        const d = await api(`/verse/${verse.verse_id}/related?language=${lang}`);
        cache[`related_${verse.verse_id}`] = d;
        setCtxData(prev => ({ ...prev, related: d }));
      } else {
        // load from cache into state
        if (tab === 'summary')  setCtxData(prev => ({ ...prev, summary: cache.summary }));
        if (tab === 'scholar')  setCtxData(prev => ({ ...prev, scholar: cache.scholar }));
        if (tab === 'people')   setCtxData(prev => ({ ...prev, people: cache.people }));
        if (tab === 'about' && verse)   setCtxData(prev => ({ ...prev, ...cache[`about_${verse.verse_id}`] }));
        if (tab === 'related' && verse) setCtxData(prev => ({ ...prev, related: cache[`related_${verse.verse_id}`] }));
      }
    } catch { /* ignore */ }
  }, [lang]);

  const openChapterContext = useCallback(() => {
    const ch = allChapters[chapterIdx];
    if (!ch) return;
    setCtxData(ctxCacheRef.current.summary ? { summary: ctxCacheRef.current.summary } : {});
    setCtx({ source: 'chapter', verse: null, tab: 'summary', chapterId: ch.chapter_id });
    loadCtxData('summary', null, ch.chapter_id);
  }, [allChapters, chapterIdx, loadCtxData]);

  const openVerseCtx = useCallback((verse) => {
    const ch = allChapters[chapterIdx];
    if (!ch) return;
    setCtxData({});
    setCtx({ source: 'verse', verse, tab: 'about', chapterId: ch.chapter_id });
    loadCtxData('about', verse, ch.chapter_id);
  }, [allChapters, chapterIdx, loadCtxData]);

  const switchCtxTab = useCallback((tab) => {
    if (!ctx) return;
    setCtx(c => ({ ...c, tab }));
    loadCtxData(tab, ctx.verse, ctx.chapterId);
  }, [ctx, loadCtxData]);

  // ── Annotations ───────────────────────────────────────────────────────────
  const toggleHighlight = (verseId, colorId) => {
    setHighlights(h => {
      const next = { ...h };
      if (next[verseId] === colorId) delete next[verseId]; else next[verseId] = colorId;
      store(SK.highlights, next);
      return next;
    });
    setLpMenu(null);
  };

  const toggleBookmark = (verseId) => {
    setBookmarks(b => {
      const next = new Set(b);
      if (next.has(verseId)) next.delete(verseId); else next.add(verseId);
      store(SK.bookmarks, [...next]);
      return next;
    });
    setLpMenu(null);
  };

  // ── Long press ────────────────────────────────────────────────────────────
  const startLp  = (verse) => { lpTimer.current = setTimeout(() => setLpMenu({ verse }), 550); };
  const cancelLp = () => clearTimeout(lpTimer.current);

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className={`rd-root${flowMode ? ' rd-flow-mode' : ''}`} style={cssVars}>

      {/* ── HOME SCREEN ── */}
      {screen === 'home' && (
        <div className="rd-home">
          <div className="rd-home-bar">
            <button className="rd-back" onClick={onExit}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="rd-home-title">Read Scriptures</span>
            {isOffline && (
              <span className="rd-offline-badge" title="You are offline — reading works fully offline">
                ✈ Offline
              </span>
            )}
            <button className="rd-settings-btn" onClick={() => setSettingsOpen(true)}>Aa</button>
            <div className="rd-nav-wrap">
              <button className="rd-settings-btn" onClick={() => setRdNavOpen(o => !o)} title="Navigation" aria-label="Open navigation menu">☰</button>
              {rdNavOpen && (
                <div className="rd-nav-menu" role="menu">
                  <button className="rd-nav-item" onClick={() => navigate('/presenter')}>🎙 Present</button>
                  <button className="rd-nav-item" onClick={() => navigate('/client')}>📺 Display</button>
                  <button className="rd-nav-item" onClick={() => navigate('/')}>🏠 Home</button>
                  <div className="rd-nav-divider" />
                  <button className="rd-nav-item" onClick={() => navigate('/about')}>About</button>
                  <button className="rd-nav-item" onClick={() => navigate('/contact')}>Contact</button>
                  <button className="rd-nav-item" onClick={() => navigate('/privacy')}>Privacy</button>
                  <button className="rd-nav-item" onClick={() => navigate('/terms')}>Terms</button>
                </div>
              )}
            </div>
          </div>

          <div className="rd-search-wrap">
            <span className="rd-search-icon">🔍</span>
            <input
              className="rd-search-input"
              type="search"
              value={query}
              onChange={handleQueryChange}
              onKeyDown={e => { if (e.key === 'Enter' && searchResults.length > 0) { e.preventDefault(); openVerseInReader(searchResults[0]); } }}
              placeholder="Topic, name, or reference (John 3:16)…"
              autoCorrect="off"
              autoComplete="off"
              spellCheck="false"
            />
            {query && searchResults.length > 0 && !searching && (
              <button className="rd-search-go" onClick={() => openVerseInReader(searchResults[0])} aria-label="Open first result">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
              </button>
            )}
            {query && (searching || searchResults.length === 0) && <button className="rd-search-clear" onClick={() => { setQuery(''); setSearchResults([]); }}>✕</button>}
          </div>

          {/* Quick-topic chips — same topics as presenter */}
          {!query && (
            <div className="rd-quick-topics">
              {['faith','prayer','hope','charity','repentance','grace','atonement','service','covenant','eternal life','holy ghost','resurrection','obedience','trials','gratitude'].map(t => (
                <button key={t} className="rd-qtopic" onClick={() => { setQuery(t); setSearchPage(0); doSearch(t, 0, false); }}>{t}</button>
              ))}
            </div>
          )}

          {(query || searchResults.length > 0) ? (
            <div className="rd-home-scroll">
              {searching && <div className="rd-hint">Searching…</div>}
              {!searching && query && !searchResults.length && <div className="rd-hint">No results for "{query}"</div>}
              {searchResults.map(v => (
                <button key={v.verse_id} className="rd-search-row" onClick={() => openVerseInReader(v)}>
                  <span className="rd-search-ref">{v.book_title} {v.chapter_number}:{v.verse_number}</span>
                  <p className="rd-search-preview">{v.scripture_text}</p>
                  <span className="rd-search-open">Open chapter ›</span>
                </button>
              ))}
              {searchHasMore && (
                <button className="rd-load-more" onClick={() => { const next = searchPage + 1; setSearchPage(next); doSearch(query, next, true); }} disabled={searching}>
                  {searching ? 'Loading…' : 'More results'}
                </button>
              )}
            </div>
          ) : (
            <div className="rd-home-scroll">
              {lastRead && (
                <section className="rd-section">
                  <h2 className="rd-section-hd">Continue Reading</h2>
                  <button className="rd-continue-card" onClick={openContinue}>
                    <div className="rd-continue-inner">
                      <span className="rd-continue-book">{lastRead.book_title}</span>
                      <span className="rd-continue-ch">Chapter {lastRead.chapter_number}</span>
                    </div>
                    <span className="rd-continue-arrow">›</span>
                  </button>
                </section>
              )}
              {setlist.length > 0 && (
                <section className="rd-section">
                  <h2 className="rd-section-hd">Your Setlist <span className="rd-section-sub">— tap to open chapter</span></h2>
                  <div className="rd-setlist-list">
                    {setlist.slice(0, 10).map((v, i) => (
                      <button key={v.verse_id || i} className="rd-setlist-row" onClick={() => openVerseInReader(v)}>
                        <span className="rd-setlist-ref">{v.book_title} {v.chapter_number}:{v.verse_number}</span>
                        <p className="rd-setlist-text">{v.scripture_text}</p>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {bookmarks.size > 0 && (() => {
                const bkdVerses = setlist.filter(v => bookmarks.has(v.verse_id));
                return bkdVerses.length > 0 ? (
                  <section className="rd-section">
                    <h2 className="rd-section-hd">🔖 Bookmarks</h2>
                    <div className="rd-setlist-list">
                      {bkdVerses.slice(0, 8).map((v, i) => (
                        <button key={v.verse_id || i} className="rd-setlist-row" onClick={() => openVerseInReader(v)}>
                          <span className="rd-setlist-ref">{v.book_title} {v.chapter_number}:{v.verse_number}</span>
                          <p className="rd-setlist-text">{v.scripture_text}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null;
              })()}
              {spacedReview.length > 0 && (
                <section className="rd-section rd-spaced-section">
                  <h2 className="rd-section-hd">📖 For Review <span className="rd-section-sub">— revisit these verses</span></h2>
                  <div className="rd-spaced-list">
                    {spacedReview.slice(0, 3).map(v => (
                      <button key={v.verse_id} className="rd-spaced-item" onClick={() => openBook({ book_id: v.book_id, book_title: v.book_title })}>
                        <span className="rd-spaced-ref">{v.book_title} {v.chapter_number}:{v.verse_number}</span>
                        <span className="rd-spaced-text">{v.scripture_text?.slice(0, 60)}…</span>
                        {v.review?.overdue && <span className="rd-spaced-due">Due</span>}
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="rd-section">
                {coverage.size > 0 && (
                  <div className="rd-coverage-summary">
                    <div className="rd-coverage-header">
                      <span className="rd-coverage-title">Your Reading</span>
                      <span className="rd-coverage-count">{coverage.size} chapters covered</span>
                    </div>
                    <div className="rd-coverage-bar">
                      <div className="rd-coverage-fill" style={{ width: `${Math.min(100, (coverage.size / 789) * 100).toFixed(1)}%` }} title={`${((coverage.size / 789) * 100).toFixed(1)}% of all chapters`} />
                    </div>
                  </div>
                )}
                <h2 className="rd-section-hd">Books of Scripture</h2>
                <div className="rd-books-grid">
                  {books.length === 0 ? (
                    <p className="rd-empty" style={{ gridColumn: '1/-1', padding: '1rem 0' }}>
                      Scripture library not available. Please check the server connection.
                    </p>
                  ) : books.map(b => (
                    <button key={b.book_id} className="rd-book-btn" style={{ position: 'relative' }} onClick={() => openBook(b)}>
                      {b.book_title}
                      {(() => {
                        const bookCovered = [...coverage.values()].filter(c => c.book_id === b.book_id);
                        if (bookCovered.length === 0) return null;
                        return <span className="rd-book-progress" title={`${bookCovered.length} chapters read`}>{bookCovered.length}</span>;
                      })()}
                    </button>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      )}

      {/* ── CHAPTER READER ── */}
      {screen === 'chapter' && (
        <div className="rd-chapter-root">
          <div className={`rd-toolbar${toolbarVisible ? '' : ' rd-toolbar--hidden'}`}>
            <button className="rd-tb-back" onClick={() => { setScreen('home'); setToolbarVisible(true); }}>‹</button>
            <button className="rd-tb-nav-btn" onClick={() => goChapter(-1)} disabled={isFirstChapter} aria-label="Previous chapter">‹‹</button>
            <button className="rd-tb-title" onClick={revealToolbar}>
              <span className="rd-tb-book">{currentBook?.book_title}</span>
              {currentCh && <span className="rd-tb-ch">Ch. {currentCh.chapter_number}{allChapters.length > 1 && <span className="rd-tb-total"> / {allChapters.length}</span>}</span>}
            </button>
            <button className="rd-tb-nav-btn" onClick={() => goChapter(1)} disabled={isLastChapter} aria-label="Next chapter">››</button>
            <div className="rd-tb-right">
              <button className="rd-tb-btn" title="Search" onClick={() => { setScreen('home'); setToolbarVisible(true); setTimeout(() => document.querySelector('.rd-search-input')?.focus(), 80); }}>🔍</button>
              <button className="rd-tb-btn" onClick={() => setSettingsOpen(true)}>Aa</button>
              <div className="rd-nav-wrap">
                <button className="rd-tb-btn" onClick={() => setRdNavOpen(o => !o)} title="Navigation" aria-label="Open navigation menu">☰</button>
                {rdNavOpen && (
                  <div className="rd-nav-menu" role="menu">
                    <button className="rd-nav-item" onClick={() => navigate('/presenter')}>🎙 Present</button>
                    <button className="rd-nav-item" onClick={() => navigate('/client')}>📺 Display</button>
                    <button className="rd-nav-item" onClick={() => navigate('/')}>🏠 Home</button>
                    <div className="rd-nav-divider" />
                    <button className="rd-nav-item" onClick={() => navigate('/about')}>About</button>
                    <button className="rd-nav-item" onClick={() => navigate('/contact')}>Contact</button>
                    <button className="rd-nav-item" onClick={() => navigate('/privacy')}>Privacy</button>
                    <button className="rd-nav-item" onClick={() => navigate('/terms')}>Terms</button>
                  </div>
                )}
              </div>
              <button className="rd-tb-exit" onClick={onExit} title="Exit Reader">✕</button>
            </div>
          </div>

          <div className="rd-progress-bar" aria-hidden="true">
            <div className="rd-progress-fill" style={{ width: `${scrollPercent}%` }} />
          </div>

          <div className="rd-scroll" ref={scrollRef} onScroll={handleScroll} onClick={revealToolbar}>
            <div className="rd-ch-heading">
              <div className="rd-ch-book">{currentBook?.book_title}</div>
              <div className="rd-ch-num">Chapter {currentCh?.chapter_number}</div>
            </div>

            {loadingChapter ? <div className="rd-loading">Loading…</div> : (
              <div className="rd-prose" style={{ fontSize: `${fontSize}px`, lineHeight: lhObj.val, fontFamily: ffObj.css }} onClick={flowMode ? () => setFlowMode(false) : undefined}>
                {chapterVerses.map(verse => {
                  const hlId  = highlights[verse.verse_id];
                  const hlObj = hlId ? HIGHLIGHT_COLORS.find(c => c.id === hlId) : null;
                  const bkd   = bookmarks.has(verse.verse_id);
                  const found = foundVerse === verse.verse_id;
                  return (
                    <p
                      key={verse.verse_id}
                      ref={el => { if (el) verseEls.current[verse.verse_id] = el; }}
                      className={`rd-verse${bkd ? ' rd-verse--bkd' : ''}${found ? ' rd-verse--found' : ''}`}
                      data-verse-id={verse.verse_id}
                      style={hlObj ? { background: hlObj.css } : {}}
                      onMouseDown={() => startLp(verse)}
                      onMouseUp={cancelLp}
                      onMouseLeave={cancelLp}
                      onTouchStart={() => startLp(verse)}
                      onTouchEnd={cancelLp}
                      onTouchMove={cancelLp}
                      onContextMenu={e => { e.preventDefault(); setLpMenu({ verse }); }}
                    >
                      <sup
                        className="rd-vnum"
                        onClick={e => { e.stopPropagation(); openVerseCtx(verse); }}
                      >
                        {bkd && <span className="rd-bk-mark">🔖</span>}
                        {verse.verse_number}
                      </sup>
                      {verse.scripture_text}
                    </p>
                  );
                })}
              </div>
            )}

            {!loadingChapter && chapterVerses.length > 0 && (
              <div className="rd-chapter-end">
                <button className="rd-notes-btn" onClick={openChapterContext}>
                  <span className="rd-notes-icon">📝</span>
                  <span className="rd-notes-main">Chapter Notes</span>
                  <span className="rd-notes-sub">Summary · Scholar · People &amp; Places</span>
                  <span className="rd-notes-arrow">›</span>
                </button>
                <div className="rd-end-divider" />
                <div className="rd-ch-nav">
                  <button className="rd-ch-nav-btn" onClick={() => goChapter(-1)} disabled={isFirstChapter}>
                    ← {chapterIdx > 0 ? `Ch. ${allChapters[chapterIdx - 1].chapter_number}` : books[bookIdx - 1]?.book_title || 'Prev'}
                  </button>
                  <span className="rd-ch-nav-dot" />
                  <button className="rd-ch-nav-btn" onClick={() => goChapter(1)} disabled={isLastChapter}>
                    {chapterIdx < allChapters.length - 1 ? `Ch. ${allChapters[chapterIdx + 1].chapter_number}` : books[bookIdx + 1]?.book_title || 'Next'} →
                  </button>
                </div>
              </div>
            )}
            <div style={{ height: 60 }} />
          </div>
        </div>
      )}

      {/* ── CONTEXT SHEET ── */}
      {ctx && (
        <div className="rd-overlay" onClick={() => setCtx(null)}>
          <div className="rd-sheet" onClick={e => e.stopPropagation()}>
            <div className="rd-sheet-handle" />
            <div className="rd-sheet-hdr">
              <div className="rd-sheet-title">
                {ctx.source === 'verse' && ctx.verse
                  ? `${ctx.verse.book_title} ${ctx.verse.chapter_number}:${ctx.verse.verse_number}`
                  : `${currentBook?.book_title} ${currentCh?.chapter_number} — Notes`}
              </div>
              <button className="rd-sheet-x" onClick={() => setCtx(null)}>✕</button>
            </div>
            {ctx.source === 'verse' && ctx.verse && (
              <div className="rd-sheet-verse-preview">{ctx.verse.scripture_text}</div>
            )}
            <div className="rd-sheet-tabs">
              {(ctx.source === 'chapter' ? CHAPTER_TABS : VERSE_TABS).map(t => (
                <button key={t.id} className={`rd-sheet-tab${ctx.tab === t.id ? ' rd-sheet-tab--on' : ''}`} onClick={() => switchCtxTab(t.id)}>
                  <span>{t.icon}</span><span>{t.label}</span>
                </button>
              ))}
            </div>
            <div className="rd-sheet-body">
              {/* Summary */}
              {ctx.tab === 'summary' && (() => {
                const s = ctxData.summary;
                if (!s) return <div className="rd-empty">Loading…</div>;
                if (!s.summary_text) return <div className="rd-empty">No summary for this chapter.</div>;
                return (
                  <div className="rd-ctx-content">
                    <p className="rd-ctx-para">{s.summary_text}</p>
                    {s.top_topics?.length > 0 && <div className="rd-chips">{s.top_topics.map((t, i) => <span key={i} className="rd-chip">{t.label || t}</span>)}</div>}
                    {s.key_verses?.length > 0 && (
                      <>
                        <div className="rd-ctx-label">Key Verses</div>
                        {s.key_verses.map((kv, i) => (
                          <button key={i} className="rd-ctx-vrow" onClick={() => { setCtx(null); const v = chapterVerses.find(cv => cv.verse_id === (kv.verse_id || kv)); if (v) setTimeout(() => verseEls.current[v.verse_id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200); }}>
                            <span className="rd-ctx-vref">{kv.verse_title || `v.${kv.verse_number || ''}`}</span>
                            <p className="rd-ctx-vtext">{kv.scripture_text || kv.text || ''}</p>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}
              {/* Scholar */}
              {ctx.tab === 'scholar' && (() => {
                const f = ctxData.scholar;
                if (!f) return <div className="rd-empty">Loading…</div>;
                if (!f.nabre_footnotes && !f.net_footnotes) return <div className="rd-empty">No scholarly notes for this chapter.</div>;
                return (
                  <div className="rd-ctx-content">
                    <p className="rd-scholar-intro">Historical context and linguistic analysis from two independent scholarly traditions.</p>
                    {f.nabre_footnotes && <div className="rd-scholar-block"><div className="rd-scholar-src">NABRE — Historical Setting</div><p className="rd-ctx-para">{f.nabre_footnotes}</p></div>}
                    {f.net_footnotes   && <div className="rd-scholar-block"><div className="rd-scholar-src">NET — Linguistics &amp; Translation</div><p className="rd-ctx-para">{f.net_footnotes}</p></div>}
                  </div>
                );
              })()}
              {/* People */}
              {ctx.tab === 'people' && (() => {
                const e = ctxData.people;
                if (!e) return <div className="rd-empty">Loading…</div>;
                if (!e.people?.length && !e.places?.length) return <div className="rd-empty">No people or places identified.</div>;
                return (
                  <div className="rd-ctx-content">
                    {e.people?.length > 0 && <><div className="rd-ctx-label">👤 People</div><div className="rd-chips">{e.people.map((p, i) => <span key={i} className="rd-chip">{p}</span>)}</div></>}
                    {e.places?.length > 0 && <><div className="rd-ctx-label">📍 Places</div><div className="rd-chips">{e.places.map((p, i) => <span key={i} className="rd-chip">{p}</span>)}</div></>}
                  </div>
                );
              })()}
              {/* About */}
              {ctx.tab === 'about' && (() => {
                const { about, tags } = ctxData;
                return (
                  <div className="rd-ctx-content">
                    {about?.summary && <p className="rd-ctx-para">{about.summary}</p>}
                    {tags?.speaker && <div className="rd-ctx-speaker">🗣 Speaker: <strong>{tags.speaker}</strong></div>}
                    {tags?.labels?.length > 0 && <><div className="rd-ctx-label">Topics</div><div className="rd-chips">{tags.labels.map((t, i) => <span key={i} className="rd-chip">{t.label || t}</span>)}</div></>}
                    {about?.cross_references?.length > 0 && (
                      <>
                        <div className="rd-ctx-label">Cross References</div>
                        {about.cross_references.slice(0, 6).map((xr, i) => (
                          <button key={i} className="rd-ctx-vrow" onClick={() => openVerseInReader(xr)}>
                            <span className="rd-ctx-vref">{xr.book_title} {xr.chapter_number}:{xr.verse_number}</span>
                            <p className="rd-ctx-vtext">{xr.scripture_text || ''}</p>
                          </button>
                        ))}
                      </>
                    )}
                    {!about?.summary && !tags?.labels?.length && <div className="rd-empty">No context available.</div>}
                    <button className="rd-ctx-more-btn" onClick={() => switchCtxTab('related')}>See related verses →</button>
                  </div>
                );
              })()}
              {/* Related */}
              {ctx.tab === 'related' && (() => {
                const r = ctxData.related;
                if (!r) return <div className="rd-empty">Loading…</div>;
                if (!r.results?.length) return <div className="rd-empty">No related verses found.</div>;
                return (
                  <div className="rd-ctx-content">
                    {r.matchedConcept && <div className="rd-ctx-concept">Matched concept: <strong>{r.matchedConcept}</strong></div>}
                    {r.results.map((rv, i) => (
                      <button key={rv.verse_id || i} className="rd-ctx-vrow" onClick={() => { setCtx(null); openVerseInReader(rv); }}>
                        <span className="rd-ctx-vref">{rv.book_title} {rv.chapter_number}:{rv.verse_number}</span>
                        <p className="rd-ctx-vtext">{rv.scripture_text}</p>
                      </button>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ── LONG-PRESS MENU ── */}
      {lpMenu && (
        <div className="rd-overlay" onClick={() => setLpMenu(null)}>
          <div className="rd-lp-menu" onClick={e => e.stopPropagation()}>
            <div className="rd-lp-ref">{lpMenu.verse.book_title} {lpMenu.verse.chapter_number}:{lpMenu.verse.verse_number}</div>
            <div className="rd-lp-section">
              <div className="rd-lp-label">Highlight</div>
              <div className="rd-lp-colors">
                {HIGHLIGHT_COLORS.map(c => (
                  <button key={c.id} className={`rd-lp-color${highlights[lpMenu.verse.verse_id] === c.id ? ' rd-lp-color--on' : ''}`} style={{ background: c.css, outlineColor: c.border }} onClick={() => { toggleHighlight(lpMenu.verse.verse_id, c.id); emitReadingEvent(lpMenu.verse, 0, 'highlight'); }} />
                ))}
                {highlights[lpMenu.verse.verse_id] && <button className="rd-lp-clear" onClick={() => toggleHighlight(lpMenu.verse.verse_id, highlights[lpMenu.verse.verse_id])}>Remove</button>}
              </div>
            </div>
            <div className="rd-lp-actions">
              <button className="rd-lp-act" onClick={() => { toggleBookmark(lpMenu.verse.verse_id); emitReadingEvent(lpMenu.verse, 0, 'bookmark'); }}>{bookmarks.has(lpMenu.verse.verse_id) ? '🔖 Remove bookmark' : '🔖 Bookmark'}</button>
              <button className="rd-lp-act" onClick={() => { try { navigator.clipboard.writeText(`${lpMenu.verse.scripture_text} — ${lpMenu.verse.book_title} ${lpMenu.verse.chapter_number}:${lpMenu.verse.verse_number}`); showToast('Copied'); } catch { /* ignore */ } setLpMenu(null); }}>📋 Copy verse</button>
              <button className="rd-lp-act" onClick={() => { openVerseCtx(lpMenu.verse); setLpMenu(null); }}>🔗 View context &amp; related</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SETTINGS SHEET ── */}
      {settingsOpen && (
        <div className="rd-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="rd-sheet" onClick={e => e.stopPropagation()}>
            <div className="rd-sheet-handle" />
            <div className="rd-sheet-hdr">
              <div className="rd-sheet-title">Reading Settings</div>
              <button className="rd-sheet-x" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <div className="rd-sheet-body rd-settings">
              <div className="rd-set-group">
                <div className="rd-set-label">Theme</div>
                <div className="rd-theme-grid">
                  {THEMES.map(t => (
                    <button key={t.id} className={`rd-theme-swatch${theme === t.id ? ' rd-theme-swatch--on' : ''}`} style={{ background: t.bg, color: t.fg, borderColor: theme === t.id ? t.accent : 'transparent' }} onClick={() => saveTheme(t.id)}>
                      <span className="rd-swatch-lbl">{t.label}</span>
                      <span className="rd-swatch-desc">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="rd-set-group">
                <div className="rd-set-label">Text size <span className="rd-set-val">{fontSize}px</span></div>
                <div className="rd-slider-row">
                  <span className="rd-slider-sm">A</span>
                  <input type="range" min={14} max={28} step={1} value={fontSize} onChange={e => saveFs(+e.target.value)} className="rd-slider" />
                  <span className="rd-slider-lg">A</span>
                </div>
                <p className="rd-preview" style={{ fontSize: `${fontSize}px`, fontFamily: ffObj.css, lineHeight: lhObj.val }}>For God so loved the world…</p>
              </div>
              <div className="rd-set-group">
                <div className="rd-set-label">Line spacing</div>
                <div className="rd-toggle-row">
                  {LINE_HEIGHTS.map(l => <button key={l.id} className={`rd-toggle${lineHeight === l.id ? ' rd-toggle--on' : ''}`} onClick={() => saveLh(l.id)}>{l.label}</button>)}
                </div>
              </div>
              <div className="rd-set-group">
                <div className="rd-set-label">Font</div>
                <div className="rd-toggle-row">
                  {FONT_FAMILIES.map(f => <button key={f.id} className={`rd-toggle${fontFamily === f.id ? ' rd-toggle--on' : ''}`} style={{ fontFamily: f.css }} onClick={() => saveFf(f.id)}>{f.label}</button>)}
                </div>
              </div>
              <div className="rd-set-group">
                <div className="rd-set-label">Language</div>
                <div className="rd-toggle-row">
                  {LANGUAGES.map(l => <button key={l.value} className={`rd-toggle${lang === l.value ? ' rd-toggle--on' : ''}`} onClick={() => saveLang(l.value)}>{l.label}</button>)}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {toastMsg && <div className="rd-toast" role="status">{toastMsg}</div>}

    </div>
  );
}
