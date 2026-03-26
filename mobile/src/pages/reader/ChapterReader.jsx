/**
 * ChapterReader.jsx — Immersive chapter reading view (core reader).
 * Continuous prose, long-press verse menu, highlights, bookmarks, chapter nav.
 * Matches mockup screen 3.
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { SERVER_URL } from '../../socket';
import LongPressMenu from '../../components/reader/LongPressMenu';

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

  const scrollRef = useRef(null);
  const lastScrollY = useRef(0);
  const hideTimer = useRef(null);
  const verseRefs = useRef({});

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

  // Fetch verses for current chapter
  useEffect(() => {
    const cid = chapterId || (chapters.length > 0 ? chapters[0].id : null);
    if (!cid) return;
    setLoading(true);
    setCurrentChapter(chapters.find(c => c.id === cid) || { id: cid });

    fetch(`${SERVER_URL}/browse/verses?chapterId=${cid}&language=${prefs.lang}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => {
        setVerses(data);
        setLoading(false);
      }).catch(() => setLoading(false));

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
      {/* Progress bar */}
      <div className="rd-progress-bar">
        <div className="rd-progress-fill" style={{ width: `${scrollProgress * 100}%` }} />
      </div>

      {/* Header */}
      <div className={`rd-header${headerVisible ? '' : ' rd-header-hidden'}`}>
        <button className="rd-header-back" onClick={onBack}>← Back</button>
        <span className="rd-header-title">{bookTitle}</span>
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
                return (
                  <span
                    key={v.verse_id || v.id}
                    ref={el => { verseRefs.current[v.verse_id || v.id] = el; }}
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
          onClose={() => setMenuVerse(null)}
        />
      )}
    </div>
  );
}
