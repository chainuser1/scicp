/**
 * ChapterReader.jsx — Immersive chapter reading view (core reader).
 * Continuous prose, long-press verse menu, highlights, bookmarks, chapter nav.
 * Matches mockup screen 3.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SERVER_URL } from '../../socket';
import LongPressMenu from '../../components/reader/LongPressMenu';
import VerseContextSheet from '../../components/reader/VerseContextSheet';
import ChapterContextSheet from '../../components/reader/ChapterContextSheet';
import { useReadingAnalytics } from '../../hooks/useReadingAnalytics';

export default function ChapterReader({
  bookId, chapterId, scrollToVerse,
  prefs, highlights, bookmarks,
  onOpenChapter, onBack,
}) {
  const [book, setBook] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [currentChapter, setCurrentChapter] = useState(null);
  const [verses, setVerses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [headerVisible, setHeaderVisible] = useState(true);
  const [menuVerse, setMenuVerse] = useState(null);
  const [verseCtx, setVerseCtx] = useState(null);
  const [showChapterCtx, setShowChapterCtx] = useState(false);
  const [offline, setOffline] = useState(!navigator.onLine);

  const scrollRef = useRef(null);
  const lastScrollY = useRef(0);
  const hideTimer = useRef(null);
  const verseRefs = useRef({});

  // Reading analytics (IntersectionObserver + dwell tracking)
  const analytics = useReadingAnalytics({
    chapterId: currentChapter?.id || chapterId,
    bookId,
    lang: prefs.lang,
  });

  // Offline detection
  useEffect(() => {
    const goOff = () => setOffline(true);
    const goOn = () => setOffline(false);
    window.addEventListener('offline', goOff);
    window.addEventListener('online', goOn);
    return () => { window.removeEventListener('offline', goOff); window.removeEventListener('online', goOn); };
  }, []);

  // Fetch book info + chapters list
  useEffect(() => {
    if (!bookId) return;
    fetch(`${SERVER_URL}/browse/books?language=${prefs.lang}`)
      .then(r => r.ok ? r.json() : [])
      .then(allBooks => {
        const b = allBooks.find(x => x.id === bookId);
        setBook(b || null);
      }).catch(() => {});

    fetch(`${SERVER_URL}/browse/chapters?bookId=${bookId}`)
      .then(r => r.ok ? r.json() : [])
      .then(setChapters).catch(() => {});
  }, [bookId, prefs.lang]);

  // Fetch verses for current chapter (with localStorage cache for offline)
  useEffect(() => {
    const cid = chapterId || (chapters.length > 0 ? chapters[0].id : null);
    if (!cid) return;
    setLoading(true);
    setCurrentChapter(chapters.find(c => c.id === cid) || { id: cid });

    const cacheKey = `scicp_ch_${cid}_${prefs.lang}`;
    const cached = (() => { try { return JSON.parse(localStorage.getItem(cacheKey)); } catch { return null; } })();

    fetch(`${SERVER_URL}/browse/verses?chapterId=${cid}&language=${prefs.lang}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setVerses(data);
        setLoading(false);
        // Cache last 10 chapters
        try {
          localStorage.setItem(cacheKey, JSON.stringify(data));
          const keys = JSON.parse(localStorage.getItem('scicp_ch_keys') || '[]');
          if (!keys.includes(cacheKey)) {
            keys.push(cacheKey);
            while (keys.length > 10) localStorage.removeItem(keys.shift());
            localStorage.setItem('scicp_ch_keys', JSON.stringify(keys));
          }
        } catch { /* storage full */ }
      }).catch(() => {
        // Offline fallback: use cache
        if (cached) { setVerses(cached); }
        setLoading(false);
      });

    // Save last read position
    prefs.setLastRead({
      bookId,
      chapterId: cid,
      verseAnchor: scrollToVerse || null,
      label: book ? `${book.book_title} ${currentChapter?.chapter_number || ''}` : '',
    });
  }, [chapterId, chapters, prefs.lang]);

  // Scroll to target verse
  useEffect(() => {
    if (!scrollToVerse || loading) return;
    const timer = setTimeout(() => {
      const el = verseRefs.current[scrollToVerse];
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('rd-verse-found');
        setTimeout(() => el.classList.remove('rd-verse-found'), 3000);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [scrollToVerse, loading]);

  // Scroll progress + auto-hide header
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pct = el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight);
    setScrollProgress(Math.min(1, pct));

    // Show/hide header on scroll direction
    if (el.scrollTop < lastScrollY.current - 10) {
      setHeaderVisible(true);
    } else if (el.scrollTop > lastScrollY.current + 10) {
      setHeaderVisible(false);
    }
    lastScrollY.current = el.scrollTop;

    // Auto-show after inactivity
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHeaderVisible(true), 5000);
  }, []);

  // Chapter navigation
  const currentIdx = useMemo(() =>
    chapters.findIndex(c => c.id === (currentChapter?.id || chapterId)),
    [chapters, currentChapter, chapterId]
  );
  const prevChapter = currentIdx > 0 ? chapters[currentIdx - 1] : null;
  const nextChapter = currentIdx < chapters.length - 1 ? chapters[currentIdx + 1] : null;

  const goToChapter = useCallback((ch) => {
    onOpenChapter(bookId, ch.id);
    scrollRef.current?.scrollTo(0, 0);
  }, [bookId, onOpenChapter]);

  // Long-press handler
  const longPressTimer = useRef(null);
  const handleVerseDown = useCallback((verse) => {
    longPressTimer.current = setTimeout(() => setMenuVerse(verse), 500);
  }, []);
  const handleVerseUp = useCallback(() => {
    clearTimeout(longPressTimer.current);
  }, []);

  // Reading event tracking
  useEffect(() => {
    if (!currentChapter?.id || !verses.length) return;
    fetch(`${SERVER_URL}/reading-event`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: 'chapter_open',
        chapter_id: currentChapter.id,
        book_id: bookId,
      }),
    }).catch(() => {});
  }, [currentChapter?.id, bookId, verses.length]);

  const chapterNum = currentChapter?.chapter_number || '';
  const bookTitle = book?.book_title || '';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Offline badge */}
      {offline && (
        <div style={{ background: '#e74c3c', color: '#fff', textAlign: 'center', padding: '4px 0', fontSize: '0.75rem', fontWeight: 600 }}>
          ✈ Offline — reading from cache
        </div>
      )}

      {/* Progress bar */}
      <div className="rd-progress-bar">
        <div className="rd-progress-fill" style={{ width: `${scrollProgress * 100}%` }} />
      </div>

      {/* Header */}
      <div className={`rd-header${headerVisible ? '' : ' rd-header-hidden'}`}>
        <button className="rd-header-back" onClick={onBack}>← Back</button>
        <span className="rd-header-title" onClick={() => setShowChapterCtx(true)} style={{ cursor: 'pointer' }}>{bookTitle}</span>
        <button className="rd-header-action" onClick={() => {
          if (nextChapter) goToChapter(nextChapter);
        }} disabled={!nextChapter}>›</button>
      </div>

      {/* Prose */}
      <div className="rd-scroll" ref={scrollRef} onScroll={handleScroll}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--rd-dim)' }}>Loading...</div>
        ) : (
          <>
            <div className="rd-chapter-label">{bookTitle}</div>
            <div className="rd-chapter-title">Chapter {chapterNum}</div>
            <div className="rd-prose">
              {verses.map(v => {
                const hlColor = highlights.getColor(v.verse_id || v.id);
                const isBm = bookmarks.isBookmarked(v.verse_id || v.id);
                const hlClass = hlColor ? ` rd-hl-${hlColor}` : '';
                const vid = v.verse_id || v.id;
                return (
                  <span
                    key={vid}
                    ref={el => {
                      verseRefs.current[vid] = el;
                      if (el) { el.dataset.verseId = vid; analytics.observeVerse(el); }
                    }}
                    className={`rd-verse-span${hlClass}`}
                    onTouchStart={() => handleVerseDown(v)}
                    onTouchEnd={handleVerseUp}
                    onMouseDown={() => handleVerseDown(v)}
                    onMouseUp={handleVerseUp}
                    onContextMenu={e => { e.preventDefault(); setMenuVerse(v); }}
                  >
                    <sup className={`rd-verse-num${isBm ? ' rd-verse-num-bookmarked' : ''}`}>
                      {v.verse_number}
                    </sup>
                    {v.scripture_text}{' '}
                  </span>
                );
              })}
            </div>
          </>
        )}

        {/* Chapter Navigation */}
        <div className="rd-chapter-nav">
          <button
            className="rd-chapter-nav-btn"
            disabled={!prevChapter}
            onClick={() => prevChapter && goToChapter(prevChapter)}
          >
            ‹ Prev
          </button>
          <div className="rd-chapter-dots">
            {chapters.slice(Math.max(0, currentIdx - 2), currentIdx + 3).map((c, i) => (
              <span key={c.id} className={`rd-chapter-dot${c.id === currentChapter?.id ? ' rd-chapter-dot-active' : ''}`} />
            ))}
          </div>
          <button
            className="rd-chapter-nav-btn"
            disabled={!nextChapter}
            onClick={() => nextChapter && goToChapter(nextChapter)}
          >
            Next ›
          </button>
        </div>

        <div style={{ height: 80 }} />
      </div>

      {/* Long-press menu */}
      {menuVerse && (
        <LongPressMenu
          verse={menuVerse}
          highlights={highlights}
          bookmarks={bookmarks}
          analytics={analytics}
          onClose={() => setMenuVerse(null)}
          onOpenContext={(v) => { setMenuVerse(null); setVerseCtx(v); }}
        />
      )}

      {/* Verse context sheet */}
      {verseCtx && (
        <VerseContextSheet
          verse={verseCtx}
          onClose={() => setVerseCtx(null)}
          onOpenVerse={(vid) => {
            setVerseCtx(null);
            // Scroll to verse if in current chapter, else navigate
            if (verseRefs.current[vid]) {
              const el = verseRefs.current[vid];
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('rd-verse-found');
              setTimeout(() => el.classList.remove('rd-verse-found'), 3000);
            }
          }}
        />
      )}

      {/* Chapter context sheet */}
      {showChapterCtx && currentChapter && (
        <ChapterContextSheet
          chapterId={currentChapter.id}
          bookTitle={bookTitle}
          chapterNumber={chapterNum}
          onClose={() => setShowChapterCtx(false)}
          onOpenVerse={(vid) => {
            setShowChapterCtx(false);
            const el = verseRefs.current[vid];
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.classList.add('rd-verse-found');
              setTimeout(() => el.classList.remove('rd-verse-found'), 3000);
            }
          }}
        />
      )}
    </div>
  );
}
