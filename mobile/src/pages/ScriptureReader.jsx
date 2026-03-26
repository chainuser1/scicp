/**
 * ScriptureReader — immersive reading mode.
 *
 * Design contract:
 * - Chapter is the unit. Open → scroll top-to-bottom. No cards, no drawers by default.
 * - Zero chrome while reading: toolbar hides on scroll, returns on tap/scroll-up.
 * - Context is discoverable, never pushed:
 *     · tap a verse superscript  → verse sheet (About + Related + cross-refs)
 *     · long-press a verse       → highlight / bookmark / copy
 *     · "Chapter Notes" at end   → chapter sheet (Summary, Scholar, People & Places)
 * - 5 reading themes cover every condition: dark room, migraine, sepia, daylight, AMOLED.
 * - Persistent: theme, font, last-read position, highlights, bookmarks all survive restarts.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as svc from '../scripture-service';
import * as remote from '../scripture-service-remote';
import { useSocketCtx } from '../socket-context';
import { Share } from '@capacitor/share';
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { StatusBar, Style } from '@capacitor/status-bar';
import { prefSet } from '../prefs';

// ── Constants ──────────────────────────────────────────────────────────────

const LANGUAGES = [
  { value: 'en',  label: 'English'  },
  { value: 'tl',  label: 'Tagalog'  },
  { value: 'ceb', label: 'Cebuano'  },
];

const THEMES = [
  { id: 'night',  label: '🌑 Night',  desc: 'Dark room',      bg: '#0d0e14', fg: '#e8d8c0', ui: 'dark',  accent: '#c9a84c', surface: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.08)', toolbar: 'rgba(10,11,18,0.97)', sheet: '#14161f', overlay: 'rgba(0,0,0,0.65)' },
  { id: 'dim',    label: '🌒 Dim',    desc: 'Headache/migraine', bg: '#0e0b07', fg: '#c4af90', ui: 'dark',  accent: '#b8965a', surface: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.07)', toolbar: 'rgba(10,8,4,0.97)',  sheet: '#13100c', overlay: 'rgba(0,0,0,0.65)' },
  { id: 'sepia',  label: '🟤 Sepia',  desc: 'Long sessions',  bg: '#f4edd8', fg: '#3a2a14', ui: 'light', accent: '#8b5e2a', surface: 'rgba(0,0,0,0.04)',     border: 'rgba(0,0,0,0.1)',         toolbar: 'rgba(244,237,216,0.97)', sheet: '#fff8ec', overlay: 'rgba(0,0,0,0.4)'  },
  { id: 'day',    label: '☀️ Day',    desc: 'Bright light',   bg: '#fafafa', fg: '#111111', ui: 'light', accent: '#8b5e2a', surface: 'rgba(0,0,0,0.04)',     border: 'rgba(0,0,0,0.1)',         toolbar: 'rgba(250,250,250,0.97)', sheet: '#ffffff', overlay: 'rgba(0,0,0,0.4)'  },
  { id: 'amoled', label: '🖤 AMOLED', desc: 'Battery saver',  bg: '#000000', fg: '#f0f0f0', ui: 'dark',  accent: '#d4a84c', surface: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.09)', toolbar: 'rgba(0,0,0,0.99)',   sheet: '#0a0a0a', overlay: 'rgba(0,0,0,0.75)' },
];

const LINE_HEIGHTS = [
  { id: 'compact',     label: 'Compact',     val: 1.55 },
  { id: 'comfortable', label: 'Comfortable', val: 1.85 },
  { id: 'relaxed',     label: 'Relaxed',     val: 2.2  },
];

const FONT_FAMILIES = [
  { id: 'serif',    label: 'Serif',   css: "Georgia, 'Times New Roman', serif" },
  { id: 'sans',     label: 'Sans',    css: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
  { id: 'dyslexic', label: 'Dyslexia', css: "'OpenDyslexic', 'Comic Sans MS', cursive" },
];

const HIGHLIGHT_COLORS = [
  { id: 'yellow', css: 'rgba(255,222,50,0.38)',  border: 'rgba(200,170,0,0.55)'   },
  { id: 'green',  css: 'rgba(72,220,100,0.28)',  border: 'rgba(40,180,70,0.5)'    },
  { id: 'pink',   css: 'rgba(255,90,150,0.25)',  border: 'rgba(220,50,120,0.45)'  },
  { id: 'blue',   css: 'rgba(70,160,255,0.25)',  border: 'rgba(30,120,220,0.45)'  },
];

// Chapter-level tabs (opened from "Chapter Notes" button)
const CHAPTER_TABS = [
  { id: 'summary',  icon: '📝', label: 'Summary'  },
  { id: 'scholar',  icon: '🎓', label: 'Scholar'  },
  { id: 'people',   icon: '👤', label: 'People'   },
];

// Verse-level tabs (opened from tapping a verse number)
const VERSE_TABS = [
  { id: 'about',   icon: '💬', label: 'About'    },
  { id: 'related', icon: '🔗', label: 'Related'  },
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
  bookmarksMeta: 'scicp.reader_bookmarks_meta',
  setlist:    'scicp.presenter_setlist_v1',
};

const store  = (k, v) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  try { localStorage.setItem(k, s); } catch {}
  prefSet(k, s); // durable write — survives iOS storage pressure
};
const recall = (k, fb) => { try { const r = localStorage.getItem(k); return r === null ? fb : JSON.parse(r); } catch { return fb; } };
const recallStr = (k, fb) => { try { return localStorage.getItem(k) || fb; } catch { return fb; } };

// ── Component ──────────────────────────────────────────────────────────────

export default function ScriptureReader({ onExit }) {
  const { serverUrl, networkAvailable } = useSocketCtx() || {};

  // ── Prefs (persist across launches) ──────────────────────────────────────
  const [theme,      setThemeId]    = useState(() => recallStr(SK.theme, 'night'));
  const [fontSize,   setFontSize]   = useState(() => recall(SK.fontSize, 18));
  const [lineHeight, setLineHeight] = useState(() => recallStr(SK.lineHeight, 'comfortable'));
  const [fontFamily, setFontFamily] = useState(() => recallStr(SK.fontFamily, 'serif'));
  const [lang,       setLang]       = useState(() => recallStr(SK.lang, 'en'));

  // ── Reading data ──────────────────────────────────────────────────────────
  const [books,              setBooks]              = useState([]);
  const [currentBook,        setCurrentBook]        = useState(null);
  const [allChapters,        setAllChapters]        = useState([]);
  const [chapterIdx,         setChapterIdx]         = useState(0);
  const [chapterVerses,      setChapterVerses]      = useState([]);
  const [loadingChapter,     setLoadingChapter]     = useState(false);
  const [lastRead,           setLastRead]           = useState(() => recall(SK.lastRead, null));
  const [setlist,            setSetlist]            = useState(() => {
    try { const r = localStorage.getItem(SK.setlist); return r ? JSON.parse(r) : []; } catch { return []; }
  });

  // ── Annotations ───────────────────────────────────────────────────────────
  const [highlights, setHighlights] = useState(() => recall(SK.highlights, {}));
  const [bookmarks,      setBookmarks]      = useState(() => new Set(recall(SK.bookmarks, [])));
  const [bookmarksMeta,  setBookmarksMeta]  = useState(() => new Map(Object.entries(recall(SK.bookmarksMeta, {}))));

  // ── Screen state ──────────────────────────────────────────────────────────
  const [screen, setScreen] = useState('home'); // 'home' | 'chapter'

  // ── Toolbar auto-hide ─────────────────────────────────────────────────────
  const [toolbarVisible, setToolbarVisible] = useState(true);
  const [scrollPercent,  setScrollPercent]  = useState(0);
  const [rdNavOpen,      setRdNavOpen]      = useState(false);
  const tbHideTimer = useRef(null);
    const scrollRef    = useRef(null);
  const lastScrollY  = useRef(0);

  // ── Sheets ────────────────────────────────────────────────────────────────
  const [settingsOpen, setSettingsOpen] = useState(false);

  // context sheet: { source: 'chapter'|'verse', verse?, tab }
  const [ctx, setCtx]           = useState(null);
  const [ctxLoading, setCtxLoading] = useState(false);
  const [ctxData, setCtxData]   = useState({});
  // cache per chapter_id so we don't re-fetch on tab switches
  const ctxCacheRef = useRef({});

  // ── Long-press menu ───────────────────────────────────────────────────────
  const [lpMenu, setLpMenu]     = useState(null); // { verse }
  const lpTimer                 = useRef(null);

  // ── Search ────────────────────────────────────────────────────────────────
  const [query,         setQuery]         = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching,     setSearching]     = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchPage,    setSearchPage]    = useState(0);
  const debounceRef = useRef(null);

  // ── Scroll-to-verse after chapter load ───────────────────────────────────
  const scrollToRef = useRef(null); // verse_id to scroll to
  const verseEls    = useRef({});   // verse_id → DOM element
  const [foundVerse, setFoundVerse] = useState(null); // verse_id to pulse-animate as "found"
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

  const PAGE_SIZE = 20;

  // ── Derived ───────────────────────────────────────────────────────────────
  const themeObj    = useMemo(() => THEMES.find(t => t.id === theme) || THEMES[0], [theme]);
  const lhObj       = useMemo(() => LINE_HEIGHTS.find(l => l.id === lineHeight) || LINE_HEIGHTS[1], [lineHeight]);
  const ffObj       = useMemo(() => FONT_FAMILIES.find(f => f.id === fontFamily) || FONT_FAMILIES[0], [fontFamily]);
  const currentCh   = allChapters[chapterIdx] || null;
  const bookIdx     = useMemo(() => books.findIndex(b => b.book_id === currentBook?.book_id), [books, currentBook]);
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
  const saveTheme  = id => { setThemeId(id); store(SK.theme, id); };
  const saveFs     = v  => { setFontSize(v); store(SK.fontSize, v); };
  const saveLh     = id => { setLineHeight(id); store(SK.lineHeight, id); };
  const saveFf     = id => { setFontFamily(id); store(SK.fontFamily, id); };
  const saveLang   = l  => {
    setLang(l); store(SK.lang, l);
    if (screen === 'chapter' && currentBook && allChapters.length) {
      // reload chapter in new language
      setTimeout(() => loadChapter(currentBook, allChapters, chapterIdx, null, l), 0);
    }
  };

  // ── StatusBar sync: match system bar to reader theme ──────────────────────
  useEffect(() => {
    const isDark = themeObj.ui === 'dark';
    StatusBar.setStyle({ style: isDark ? Style.Light : Style.Dark }).catch(() => {});
    StatusBar.setBackgroundColor({ color: themeObj.bg }).catch(() => {});
  }, [themeObj]);

  // ── Reading event emission ─────────────────────────────────────────────────
  const emitReadingEvent = useCallback(async (verse, dwellMs = 0, eventType = 'read') => {
    try {
      const base = (serverUrl) ? String(serverUrl).replace(/\/+$/, '') : '';
      if (!base) return; // skip when no server URL (pure offline)
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
      fetch(`${base}/reading-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(err => console.warn('[scicp]', err.message || err));
    } catch { /* ignore */ }
  }, [serverUrl, lang]);

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
    const on = () => setIsOffline(false);
    const off = () => setIsOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // ── Load books ────────────────────────────────────────────────────────────
  useEffect(() => {
    try { setBooks(svc.browse('books', {}, lang) || []); } catch { setBooks([]); }
  }, [lang]);

  // ── Coverage + spaced review fetches ─────────────────────────────────────
  useEffect(() => {
    const base = serverUrl ? String(serverUrl).replace(/\/+$/, '') : '';
    if (!base) return;
    fetch(`${base}/reading-coverage`)
      .then(r => r.ok ? r.json() : { coverage: [] })
      .then(({ coverage: rows }) => {
        const map = new Map();
        for (const row of rows) map.set(row.chapter_id, row);
        setCoverage(map);
      })
      .catch(err => console.warn('[scicp]', err.message || err));
  }, [serverUrl]);

  useEffect(() => {
    const base = serverUrl ? String(serverUrl).replace(/\/+$/, '') : '';
    if (!base) return;
    fetch(`${base}/spaced-review?limit=3`)
      .then(r => r.ok ? r.json() : { verses: [] })
      .then(({ verses }) => setSpacedReview(verses || []))
      .catch(err => console.warn('[scicp]', err.message || err));
  }, [serverUrl]);
  // ── Chapter loading ───────────────────────────────────────────────────────
  const loadChapter = useCallback((book, chapters, idx, anchorVerseId, forceLang) => {
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
      const vs = svc.browse('verses', { chapterId: ch.chapter_id }, useLang) || [];
      setChapterVerses(vs);
      const lr = { book_id: book.book_id, book_title: book.book_title, chapter_id: ch.chapter_id, chapter_number: ch.chapter_number, verse_id: anchorVerseId || vs[0]?.verse_id || null };
      setLastRead(lr);
      store(SK.lastRead, lr);
    } catch { setChapterVerses([]); }
    setLoadingChapter(false);
  }, [lang]);

  // Scroll to anchor verse after render + "found" pulse animation
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
  const openBook = useCallback((book) => {
    let chs = [];
    try { chs = svc.browse('chapters', { bookId: book.book_id }, lang) || []; } catch {}
    loadChapter(book, chs, 0, null);
  }, [lang, loadChapter]);

  const openVerseInReader = useCallback((verse) => {
    const book = books.find(b => b.book_id === verse.book_id) || { book_id: verse.book_id, book_title: verse.book_title };
    let chs = [];
    try { chs = svc.browse('chapters', { bookId: verse.book_id }, lang) || []; } catch {}
    const idx = chs.findIndex(c => c.chapter_id === verse.chapter_id);
    loadChapter(book, chs, idx >= 0 ? idx : 0, verse.verse_id);
  }, [books, lang, loadChapter]);

  const openContinue = useCallback(() => {
    if (!lastRead) return;
    const book = books.find(b => b.book_id === lastRead.book_id) || { book_id: lastRead.book_id, book_title: lastRead.book_title };
    let chs = [];
    try { chs = svc.browse('chapters', { bookId: lastRead.book_id }, lang) || []; } catch {}
    const idx = chs.findIndex(c => c.chapter_id === lastRead.chapter_id);
    loadChapter(book, chs, idx >= 0 ? idx : 0, lastRead.verse_id);
  }, [lastRead, books, lang, loadChapter]);

  const goChapter = useCallback((delta) => {
    const next = chapterIdx + delta;
    if (next >= 0 && next < allChapters.length) {
      // Normal navigation within the same book
      loadChapter(currentBook, allChapters, next, null);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 80);
      return;
    }
    // Cross-book boundary: find adjacent book
    const bookIdx = books.findIndex(b => b.book_id === currentBook?.book_id);
    const adjBook = books[bookIdx + delta];
    if (!adjBook) return; // already at absolute start/end
    try {
      const chs = svc.browse('chapters', { bookId: adjBook.book_id }, lang) || [];
      if (!chs.length) return;
      const targetIdx = delta > 0 ? 0 : chs.length - 1;
      loadChapter(adjBook, chs, targetIdx, null);
      setTimeout(() => { if (scrollRef.current) scrollRef.current.scrollTop = 0; }, 80);
    } catch { /* ignore */ }
  }, [chapterIdx, allChapters, currentBook, books, lang, loadChapter]);

  // ── Toolbar auto-hide ─────────────────────────────────────────────────────
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const y = el.scrollTop;
    const dy = y - lastScrollY.current;
    lastScrollY.current = y;
    if (dy > 8 && y > 100) {
      setToolbarVisible(false);
    } else if (dy < -8 || y < 80) {
      setToolbarVisible(true);
      clearTimeout(tbHideTimer.current);
    }
    // Scroll progress indicator (0–100)
    const max = el.scrollHeight - el.clientHeight;
    setScrollPercent(max > 0 ? Math.min(100, (y / max) * 100) : 0);
  }, []);

  const revealToolbar = useCallback(() => {
    setToolbarVisible(true);
    clearTimeout(tbHideTimer.current);
    tbHideTimer.current = setTimeout(() => setToolbarVisible(false), 5000);
  }, []);

  // ── Swipe-to-chapter (horizontal swipe on chapter scroll area) ────────────
  const swipeTouchX = useRef(null);
  const onTouchStart = useCallback((e) => {
    if (e.touches.length === 1) swipeTouchX.current = e.touches[0].clientX;
  }, []);
  const onTouchEnd = useCallback((e) => {
    if (swipeTouchX.current === null) return;
    const dx = e.changedTouches[0].clientX - swipeTouchX.current;
    swipeTouchX.current = null;
    if (Math.abs(dx) < 60) return; // threshold 60px
    if (dx < 0 && !isLastChapter) {
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      goChapter(1);
    } else if (dx > 0 && !isFirstChapter) {
      Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
      goChapter(-1);
    }
  }, [goChapter, isFirstChapter, isLastChapter]);

  // ── Search ────────────────────────────────────────────────────────────────
  const doSearch = useCallback((q, p = 0, append = false) => {
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    // Try remote API when network is available, fall back to local SQL.js
    const remoteBase = serverUrl || remote.getServerUrl();
    const useRemote = networkAvailable && !!remoteBase;
    if (useRemote) remote.setServerUrl(remoteBase);
    const searchFn = useRemote ? () => remote.search(q, p, PAGE_SIZE, lang) : () => svc.search(q, p, PAGE_SIZE, lang);
    searchFn()
      .then(data => {
        const list = data?.results ?? data ?? [];
        setSearchResults(prev => append ? [...prev, ...list] : list);
        setSearchHasMore(list.length === PAGE_SIZE);
        setSearching(false);
      })
      .catch(() => {
        // On remote failure, fall back to local
        if (useRemote) {
          svc.search(q, p, PAGE_SIZE, lang)
            .then(data => {
              const list = data?.results ?? data ?? [];
              setSearchResults(prev => append ? [...prev, ...list] : list);
              setSearchHasMore(list.length === PAGE_SIZE);
              setSearching(false);
            })
            .catch(() => setSearching(false));
        } else {
          setSearching(false);
        }
      });
  }, [lang, networkAvailable, serverUrl]);

  const handleQueryChange = e => {
    const q = e.target.value;
    setQuery(q);
    setSearchPage(0);
    clearTimeout(debounceRef.current);
    if (!q.trim()) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(() => doSearch(q, 0, false), 300);
  };

  // ── Context sheet ─────────────────────────────────────────────────────────
  const loadCtxData = useCallback((tab, verse, chId) => {
    const cache = ctxCacheRef.current;
    try {
      if (tab === 'summary' && !cache.summary) {
        cache.summary = svc.getChapterSummary(chId);
        setCtxData(d => ({ ...d, summary: cache.summary }));
      } else if (tab === 'scholar' && !cache.scholar) {
        cache.scholar = svc.getChapterFootnotes(chId);
        setCtxData(d => ({ ...d, scholar: cache.scholar }));
      } else if (tab === 'people' && !cache.people) {
        cache.people = svc.getChapterEntities(chId);
        setCtxData(d => ({ ...d, people: cache.people }));
      } else if (tab === 'about' && verse && !cache[`about_${verse.verse_id}`]) {
        const about = svc.getVerseSummary(verse.verse_id);
        const tags  = svc.getVerseTags(verse.verse_id);
        cache[`about_${verse.verse_id}`] = { about, tags };
        setCtxData(d => ({ ...d, about, tags }));
      } else if (tab === 'related' && verse && !cache[`related_${verse.verse_id}`]) {
        const r = svc.getRelated(verse.verse_id, lang);
        cache[`related_${verse.verse_id}`] = r;
        setCtxData(d => ({ ...d, related: r }));
      } else {
        // pull from cache into state if needed
        if (tab === 'summary')   setCtxData(d => ({ ...d, summary: cache.summary }));
        if (tab === 'scholar')   setCtxData(d => ({ ...d, scholar: cache.scholar }));
        if (tab === 'people')    setCtxData(d => ({ ...d, people: cache.people }));
        if (tab === 'about' && verse)   setCtxData(d => ({ ...d, ...cache[`about_${verse.verse_id}`] }));
        if (tab === 'related' && verse) setCtxData(d => ({ ...d, related: cache[`related_${verse.verse_id}`] }));
      }
    } catch {}
  }, [lang]);

  const openChapterContext = useCallback(() => {
    const ch = allChapters[chapterIdx];
    if (!ch) return;
    const firstTab = 'summary';
    setCtxData(ctxCacheRef.current.summary ? { summary: ctxCacheRef.current.summary } : {});
    setCtx({ source: 'chapter', verse: null, tab: firstTab, chapterId: ch.chapter_id });
    loadCtxData(firstTab, null, ch.chapter_id);
  }, [allChapters, chapterIdx, loadCtxData]);

  const openVerseCtx = useCallback((verse) => {
    const ch = allChapters[chapterIdx];
    if (!ch) return;
    const firstTab = 'about';
    setCtxData({});
    setCtx({ source: 'verse', verse, tab: firstTab, chapterId: ch.chapter_id });
    loadCtxData(firstTab, verse, ch.chapter_id);
  }, [allChapters, chapterIdx, loadCtxData]);

  const switchCtxTab = useCallback((tab) => {
    if (!ctx) return;
    setCtx(c => ({ ...c, tab }));
    loadCtxData(tab, ctx.verse, ctx.chapterId);
  }, [ctx, loadCtxData]);

  // ── Annotations ───────────────────────────────────────────────────────────
  const toggleHighlight = useCallback((verseId, colorId) => {
    setHighlights(h => {
      const next = { ...h };
      if (next[verseId] === colorId) delete next[verseId];
      else next[verseId] = colorId;
      store(SK.highlights, next);
      return next;
    });
    setLpMenu(null);
  }, []);

  const toggleBookmark = useCallback((verseOrId) => {
    const verseId = typeof verseOrId === 'object' ? verseOrId.verse_id : verseOrId;
    setBookmarks(b => {
      const next = new Set(b);
      if (next.has(verseId)) next.delete(verseId); else next.add(verseId);
      store(SK.bookmarks, [...next]);
      return next;
    });
    setBookmarksMeta(m => {
      const next = new Map(m);
      if (next.has(verseId)) {
        next.delete(verseId);
      } else if (typeof verseOrId === 'object') {
        const { book_title, chapter_number, verse_number, scripture_text } = verseOrId;
        next.set(verseId, { book_title, chapter_number, verse_number, scripture_text });
      }
      store(SK.bookmarksMeta, Object.fromEntries(next));
      return next;
    });
    setLpMenu(null);
  }, []);

  // ── Long press ────────────────────────────────────────────────────────────
  const startLp = useCallback((verse) => {
    lpTimer.current = setTimeout(() => setLpMenu({ verse }), 550);
  }, []);
  const cancelLp = useCallback(() => clearTimeout(lpTimer.current), []);

  // ── RENDER ─────────────────────────────────────────────────────────────────

  return (
    <div className={`rd-root${flowMode ? ' rd-flow-mode' : ''}`} style={cssVars}>

      {/* ═══════════════════════════════════════════════════════════════
          HOME SCREEN
      ═══════════════════════════════════════════════════════════════ */}
      {screen === 'home' && (
        <div className="rd-home">

          {/* Top bar */}
          <div className="rd-home-bar">
            <button className="rd-back" onClick={onExit} aria-label="Exit Reader">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="rd-home-title">Scriptures</span>
            {isOffline && (
              <span className="rd-offline-badge" title="You are offline — reading works fully offline">
                ✈ Offline
              </span>
            )}
            <button className="rd-settings-btn" onClick={() => setSettingsOpen(true)} aria-label="Reading settings">Aa</button>
          </div>

          {/* Search input */}
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
              {!searching && query && !searchResults.length && (
                <div className="rd-hint">No results for "{query}"</div>
              )}
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

              {/* Continue reading */}
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

              {/* Bookmarks */}
              {bookmarks.size > 0 && (
                <section className="rd-section">
                  <h2 className="rd-section-hd">🔖 Bookmarks <span className="rd-section-sub">— tap to open chapter</span></h2>
                  <div className="rd-setlist-list">
                    {[...bookmarks].slice(0, 12).map(vid => {
                      const meta = bookmarksMeta.get(vid) || setlist.find(v => v.verse_id === vid);
                      if (!meta) return null;
                      return (
                        <button key={vid} className="rd-setlist-row" onClick={() => openVerseInReader({ verse_id: vid, ...meta })}>
                          <span className="rd-setlist-ref">{meta.book_title} {meta.chapter_number}:{meta.verse_number}</span>
                          <p className="rd-setlist-text">{meta.scripture_text}</p>
                        </button>
                      );
                    }).filter(Boolean)}
                  </div>
                </section>
              )}

              {/* Setlist (from presenter) */}
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

              {/* Books grid */}
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
                      Scripture library not available. Make sure the database is downloaded.
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

      {/* ═══════════════════════════════════════════════════════════════
          CHAPTER READER
      ═══════════════════════════════════════════════════════════════ */}
      {screen === 'chapter' && (
        <div className="rd-chapter-root">

          {/* Scroll progress bar — pinned below toolbar */}
          <div className="rd-progress-bar">
            <div className="rd-progress-fill" style={{ width: `${scrollPercent}%` }} />
          </div>

          {/* Auto-hiding top toolbar */}
          <div className={`rd-toolbar${toolbarVisible ? '' : ' rd-toolbar--hidden'}`}>
            {/* Left: back to reader home */}
            <button className="rd-tb-back" onClick={() => { setScreen('home'); setToolbarVisible(true); }} aria-label="Books">‹</button>

            {/* Prev chapter */}
            <button
              className="rd-tb-nav-btn"
              onClick={() => goChapter(-1)}
              disabled={isFirstChapter}
              aria-label="Previous chapter"
            >‹‹</button>

            {/* Book + chapter title (tapping reveals toolbar) */}
            <button className="rd-tb-title" onClick={revealToolbar}>
              <span className="rd-tb-book">{currentBook?.book_title}</span>
              {currentCh && (
                <span className="rd-tb-ch">
                  Ch. {currentCh.chapter_number}
                  {allChapters.length > 1 && <span className="rd-tb-total"> / {allChapters.length}</span>}
                </span>
              )}
            </button>

            {/* Next chapter */}
            <button
              className="rd-tb-nav-btn"
              onClick={() => goChapter(1)}
              disabled={isLastChapter}
              aria-label="Next chapter"
            >››</button>

            {/* Right actions: search + settings + nav menu + exit */}
            <div className="rd-tb-right">
              <button className="rd-tb-btn" aria-label="Search" onClick={() => { setScreen('home'); setToolbarVisible(true); setTimeout(() => document.querySelector('.rd-search-input')?.focus(), 80); }}>🔍</button>
              <button className="rd-tb-btn" onClick={() => setSettingsOpen(true)} aria-label="Settings">Aa</button>
              <div className="rd-nav-wrap">
                <button className="rd-tb-btn" onClick={() => setRdNavOpen(o => !o)} aria-label="Navigation menu">☰</button>
                {rdNavOpen && (
                  <div className="rd-nav-menu" role="menu">
                    <button className="rd-nav-item" onClick={() => { onExit(); }}>🎙 Present / Home</button>
                    <div className="rd-nav-divider" />
                    <button className="rd-nav-item" onClick={() => setRdNavOpen(false)}>✕ Close</button>
                  </div>
                )}
              </div>
              <button className="rd-tb-exit" onClick={onExit} aria-label="Exit Reader">✕</button>
            </div>
          </div>

          {/* Scrollable chapter body */}
          <div
            className="rd-scroll"
            ref={scrollRef}
            onScroll={handleScroll}
            onClick={revealToolbar}
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {/* Chapter heading */}
            <div className="rd-ch-heading">
              <div className="rd-ch-book">{currentBook?.book_title}</div>
              <div className="rd-ch-num">Chapter {currentCh?.chapter_number}</div>
            </div>

            {/* Continuous prose — the actual reading experience */}
            {loadingChapter ? (
              <div className="rd-loading">Loading…</div>
            ) : (
              <div
                className="rd-prose"
                style={{ fontSize: `${fontSize}px`, lineHeight: lhObj.val, fontFamily: ffObj.css }}
                onClick={flowMode ? () => setFlowMode(false) : undefined}
              >
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
                      onTouchStart={() => startLp(verse)}
                      onTouchEnd={cancelLp}
                      onTouchMove={cancelLp}
                      onMouseDown={() => startLp(verse)}
                      onMouseUp={cancelLp}
                      onMouseLeave={cancelLp}
                    >
                      {/* Verse number superscript — tap for verse context */}
                      <sup
                        className="rd-vnum"
                        onClick={e => { e.stopPropagation(); openVerseCtx(verse); }}
                        title={`Verse ${verse.verse_number} — tap for context`}
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

            {/* End of chapter */}
            {!loadingChapter && chapterVerses.length > 0 && (
              <div className="rd-chapter-end">
                {/* Chapter notes button */}
                <button className="rd-notes-btn" onClick={openChapterContext}>
                  <span className="rd-notes-icon">📝</span>
                  <span className="rd-notes-main">Chapter Notes</span>
                  <span className="rd-notes-sub">Summary · Scholar · People &amp; Places</span>
                  <span className="rd-notes-arrow">›</span>
                </button>

                <div className="rd-end-divider" />

                {/* Prev / Next chapter */}
                <div className="rd-ch-nav">
                  <button
                    className="rd-ch-nav-btn"
                    onClick={() => goChapter(-1)}
                    disabled={isFirstChapter}
                  >
                    ← {chapterIdx > 0 ? `Ch. ${allChapters[chapterIdx - 1].chapter_number}` : books[bookIdx - 1]?.book_title || 'Prev'}
                  </button>
                  <span className="rd-ch-nav-dot" />
                  <button
                    className="rd-ch-nav-btn"
                    onClick={() => goChapter(1)}
                    disabled={isLastChapter}
                  >
                    {chapterIdx < allChapters.length - 1 ? `Ch. ${allChapters[chapterIdx + 1].chapter_number}` : books[bookIdx + 1]?.book_title || 'Next'} →
                  </button>
                </div>
              </div>
            )}

            <div style={{ height: 60 }} />
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          CONTEXT SHEET (chapter notes OR verse context)
      ═══════════════════════════════════════════════════════════════ */}
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

            {/* Verse text preview (verse context only) */}
            {ctx.source === 'verse' && ctx.verse && (
              <div className="rd-sheet-verse-preview">{ctx.verse.scripture_text}</div>
            )}

            {/* Tabs */}
            <div className="rd-sheet-tabs">
              {(ctx.source === 'chapter' ? CHAPTER_TABS : VERSE_TABS).map(t => (
                <button
                  key={t.id}
                  className={`rd-sheet-tab${ctx.tab === t.id ? ' rd-sheet-tab--on' : ''}`}
                  onClick={() => switchCtxTab(t.id)}
                >
                  <span>{t.icon}</span>
                  <span>{t.label}</span>
                </button>
              ))}
            </div>

            <div className="rd-sheet-body">

              {/* ── Summary ── */}
              {ctx.tab === 'summary' && (() => {
                const s = ctxData.summary;
                if (!s) return <div className="rd-empty">Loading…</div>;
                if (!s.summary_text) return <div className="rd-empty">No summary for this chapter.</div>;
                return (
                  <div className="rd-ctx-content">
                    <p className="rd-ctx-para">{s.summary_text}</p>
                    {s.top_topics?.length > 0 && (
                      <div className="rd-chips">
                        {s.top_topics.map((t, i) => (
                          <span key={i} className="rd-chip">{t.label || t}</span>
                        ))}
                      </div>
                    )}
                    {s.key_verses?.length > 0 && (
                      <>
                        <div className="rd-ctx-label">Key Verses</div>
                        {s.key_verses.map((kv, i) => (
                          <button
                            key={i}
                            className="rd-ctx-vrow"
                            onClick={() => {
                              setCtx(null);
                              const v = chapterVerses.find(cv => cv.verse_id === (kv.verse_id || kv));
                              if (v) setTimeout(() => verseEls.current[v.verse_id]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
                            }}
                          >
                            <span className="rd-ctx-vref">{kv.verse_title || `v.${kv.verse_number || ''}`}</span>
                            <p className="rd-ctx-vtext">{kv.scripture_text || kv.text || ''}</p>
                          </button>
                        ))}
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ── Scholar ── */}
              {ctx.tab === 'scholar' && (() => {
                const f = ctxData.scholar;
                if (!f) return <div className="rd-empty">Loading…</div>;
                if (!f.nabre_footnotes && !f.net_footnotes) return <div className="rd-empty">No scholarly notes for this chapter.</div>;
                return (
                  <div className="rd-ctx-content">
                    <p className="rd-scholar-intro">These notes are from two independent scholarly traditions — historical context and linguistic analysis.</p>
                    {f.nabre_footnotes && (
                      <div className="rd-scholar-block">
                        <div className="rd-scholar-src">NABRE — Historical Setting</div>
                        <p className="rd-ctx-para">{f.nabre_footnotes}</p>
                      </div>
                    )}
                    {f.net_footnotes && (
                      <div className="rd-scholar-block">
                        <div className="rd-scholar-src">NET — Linguistics &amp; Translation</div>
                        <p className="rd-ctx-para">{f.net_footnotes}</p>
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* ── People & Places ── */}
              {ctx.tab === 'people' && (() => {
                const e = ctxData.people;
                if (!e) return <div className="rd-empty">Loading…</div>;
                if (!e.people?.length && !e.places?.length) return <div className="rd-empty">No people or places identified.</div>;
                return (
                  <div className="rd-ctx-content">
                    {e.people?.length > 0 && (
                      <>
                        <div className="rd-ctx-label">👤 People in this chapter</div>
                        <div className="rd-chips">
                          {e.people.map((p, i) => <span key={i} className="rd-chip">{p}</span>)}
                        </div>
                      </>
                    )}
                    {e.places?.length > 0 && (
                      <>
                        <div className="rd-ctx-label">📍 Places in this chapter</div>
                        <div className="rd-chips">
                          {e.places.map((p, i) => <span key={i} className="rd-chip">{p}</span>)}
                        </div>
                      </>
                    )}
                  </div>
                );
              })()}

              {/* ── About this verse ── */}
              {ctx.tab === 'about' && (() => {
                const about = ctxData.about;
                const tags  = ctxData.tags;
                return (
                  <div className="rd-ctx-content">
                    {about?.summary && <p className="rd-ctx-para">{about.summary}</p>}
                    {tags?.speaker && (
                      <div className="rd-ctx-speaker">🗣 Speaker: <strong>{tags.speaker}</strong></div>
                    )}
                    {tags?.labels?.length > 0 && (
                      <>
                        <div className="rd-ctx-label">Topics</div>
                        <div className="rd-chips">
                          {tags.labels.map((t, i) => <span key={i} className="rd-chip">{t.label || t}</span>)}
                        </div>
                      </>
                    )}
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
                    {!about?.summary && !tags?.labels?.length && (
                      <div className="rd-empty">No context available for this verse.</div>
                    )}
                    <button className="rd-ctx-more-btn" onClick={() => switchCtxTab('related')}>
                      See related verses →
                    </button>
                  </div>
                );
              })()}

              {/* ── Related ── */}
              {ctx.tab === 'related' && (() => {
                const r = ctxData.related;
                if (!r) return <div className="rd-empty">Loading…</div>;
                if (!r.results?.length) return <div className="rd-empty">No related verses found.</div>;
                return (
                  <div className="rd-ctx-content">
                    {r.matchedConcept && (
                      <div className="rd-ctx-concept">Matched concept: <strong>{r.matchedConcept}</strong></div>
                    )}
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

      {/* ═══════════════════════════════════════════════════════════════
          LONG-PRESS MENU
      ═══════════════════════════════════════════════════════════════ */}
      {lpMenu && (
        <div className="rd-overlay" onClick={() => setLpMenu(null)}>
          <div className="rd-lp-menu" onClick={e => e.stopPropagation()}>
            <div className="rd-lp-ref">
              {lpMenu.verse.book_title} {lpMenu.verse.chapter_number}:{lpMenu.verse.verse_number}
            </div>

            {/* Highlight colors */}
            <div className="rd-lp-section">
              <span className="rd-lp-label">Highlight</span>
              <div className="rd-lp-colors">
                {HIGHLIGHT_COLORS.map(c => (
                  <button
                    key={c.id}
                    className={`rd-lp-color${highlights[lpMenu.verse.verse_id] === c.id ? ' rd-lp-color--on' : ''}`}
                    style={{ background: c.css, outlineColor: c.border }}
                    onClick={() => { toggleHighlight(lpMenu.verse.verse_id, c.id); emitReadingEvent(lpMenu.verse, 0, 'highlight'); }}
                    aria-label={`Highlight ${c.id}`}
                  />
                ))}
                {highlights[lpMenu.verse.verse_id] && (
                  <button
                    className="rd-lp-clear"
                    onClick={() => toggleHighlight(lpMenu.verse.verse_id, highlights[lpMenu.verse.verse_id])}
                  >Remove</button>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="rd-lp-actions">
              <button className="rd-lp-act" onClick={() => { toggleBookmark(lpMenu.verse); emitReadingEvent(lpMenu.verse, 0, 'bookmark'); }}>
                {bookmarks.has(lpMenu.verse.verse_id) ? '🔖 Remove bookmark' : '🔖 Bookmark'}
              </button>
              <button className="rd-lp-act" onClick={async () => {
                const v = lpMenu.verse;
                const text = `${v.book_title} ${v.chapter_number}:${v.verse_number}\n"${v.scripture_text}"`;
                setLpMenu(null);
                const canShare = await Share.canShare().then(r => r.value).catch(() => false);
                if (canShare) {
                  Share.share({ text, title: `${v.book_title} ${v.chapter_number}:${v.verse_number}` }).catch(() => {});
                } else {
                  try { navigator.clipboard.writeText(text); } catch {}
                }
              }}>📤 Share verse</button>
              <button className="rd-lp-act" onClick={() => { openVerseCtx(lpMenu.verse); setLpMenu(null); }}>
                🔗 View context &amp; related
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════
          SETTINGS SHEET
      ═══════════════════════════════════════════════════════════════ */}
      {settingsOpen && (
        <div className="rd-overlay" onClick={() => setSettingsOpen(false)}>
          <div className="rd-sheet" onClick={e => e.stopPropagation()}>
            <div className="rd-sheet-handle" />
            <div className="rd-sheet-hdr">
              <div className="rd-sheet-title">Reading Settings</div>
              <button className="rd-sheet-x" onClick={() => setSettingsOpen(false)}>✕</button>
            </div>
            <div className="rd-sheet-body rd-settings">

              {/* Theme */}
              <div className="rd-set-group">
                <div className="rd-set-label">Theme</div>
                <div className="rd-theme-grid">
                  {THEMES.map(t => (
                    <button
                      key={t.id}
                      className={`rd-theme-swatch${theme === t.id ? ' rd-theme-swatch--on' : ''}`}
                      style={{ background: t.bg, color: t.fg, borderColor: theme === t.id ? t.accent : 'transparent' }}
                      onClick={() => saveTheme(t.id)}
                    >
                      <span className="rd-swatch-lbl">{t.label}</span>
                      <span className="rd-swatch-desc">{t.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Font size */}
              <div className="rd-set-group">
                <div className="rd-set-label">Text size <span className="rd-set-val">{fontSize}px</span></div>
                <div className="rd-slider-row">
                  <span className="rd-slider-sm">A</span>
                  <input type="range" min={14} max={28} step={1} value={fontSize}
                    onChange={e => saveFs(+e.target.value)} className="rd-slider" />
                  <span className="rd-slider-lg">A</span>
                </div>
                <p className="rd-preview" style={{ fontSize: `${fontSize}px`, fontFamily: ffObj.css, lineHeight: lhObj.val }}>
                  For God so loved the world…
                </p>
              </div>

              {/* Line height */}
              <div className="rd-set-group">
                <div className="rd-set-label">Line spacing</div>
                <div className="rd-toggle-row">
                  {LINE_HEIGHTS.map(l => (
                    <button key={l.id}
                      className={`rd-toggle${lineHeight === l.id ? ' rd-toggle--on' : ''}`}
                      onClick={() => saveLh(l.id)}>{l.label}</button>
                  ))}
                </div>
              </div>

              {/* Font */}
              <div className="rd-set-group">
                <div className="rd-set-label">Font</div>
                <div className="rd-toggle-row">
                  {FONT_FAMILIES.map(f => (
                    <button key={f.id}
                      className={`rd-toggle${fontFamily === f.id ? ' rd-toggle--on' : ''}`}
                      style={{ fontFamily: f.css }}
                      onClick={() => saveFf(f.id)}>{f.label}</button>
                  ))}
                </div>
              </div>

              {/* Language */}
              <div className="rd-set-group">
                <div className="rd-set-label">Language</div>
                <div className="rd-toggle-row">
                  {LANGUAGES.map(l => (
                    <button key={l.value}
                      className={`rd-toggle${lang === l.value ? ' rd-toggle--on' : ''}`}
                      onClick={() => saveLang(l.value)}>{l.label}</button>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      )}

    </div>
  );
}
