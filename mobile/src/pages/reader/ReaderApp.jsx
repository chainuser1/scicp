/**
 * ReaderApp.jsx — Root reader component. 5-tab warm-themed layout.
 * Completely independent from Presenter. REST-only (no sockets needed).
 */
import { useState, useCallback } from 'react';
import ReaderTabBar from '../../components/ReaderTabBar';
import { useReaderPrefs } from '../../hooks/useReaderPrefs';
import { useHighlights } from '../../hooks/useHighlights';
import { useReaderBookmarks } from '../../hooks/useReaderBookmarks';
import ReaderHome from './ReaderHome';
import ReaderBrowse from './ReaderBrowse';
import ChapterReader from './ChapterReader';
import ReadingTab from './ReadingTab';
import ReaderBookmarks from './ReaderBookmarks';
import ReaderMore from './ReaderMore';
import '../../styles/reader.css';

export default function ReaderApp({ onSwitchMode }) {
  const [tab, setTab] = useState('home');
  const prefs = useReaderPrefs();
  const highlights = useHighlights();
  const bookmarks = useReaderBookmarks();

  // Chapter reader state — opened from browse/search/bookmark
  const [chapterNav, setChapterNav] = useState(null);
  // chapterNav: { bookId, chapterId, scrollToVerse? }

  const openChapter = useCallback((bookId, chapterId, scrollToVerse) => {
    setChapterNav({ bookId, chapterId, scrollToVerse });
    setTab('reading');
  }, []);

  const handleTabSelect = useCallback((id) => {
    if (id === 'reading' && !chapterNav) {
      // Reading tab: if no chapter open, show reading tab (history/stats)
    }
    setTab(id);
  }, [chapterNav]);

  const lineHeightStyle = { '--rd-line-height': prefs.lineHeightValue, '--rd-font-size': `${prefs.fontSize}px` };

  return (
    <div
      className="reader-root"
      data-theme={prefs.theme}
      data-font={prefs.fontFamily}
      style={lineHeightStyle}
    >
      <div className="reader-content">
        {tab === 'home' && (
          <ReaderHome
            prefs={prefs}
            onSearch={(q) => { setTab('browse'); }}
            onOpenChapter={openChapter}
            onTopicSearch={(topic) => { setTab('browse'); }}
            _topicForBrowse={tab === 'browse' ? null : undefined}
          />
        )}
        {tab === 'browse' && (
          <ReaderBrowse
            prefs={prefs}
            onOpenChapter={openChapter}
          />
        )}
        {tab === 'reading' && chapterNav && (
          <ChapterReader
            bookId={chapterNav.bookId}
            chapterId={chapterNav.chapterId}
            scrollToVerse={chapterNav.scrollToVerse}
            prefs={prefs}
            highlights={highlights}
            bookmarks={bookmarks}
            onOpenChapter={openChapter}
            onBack={() => setTab('home')}
          />
        )}
        {tab === 'reading' && !chapterNav && (
          <ReadingTab
            prefs={prefs}
            onOpenChapter={openChapter}
          />
        )}
        {tab === 'bookmarks' && (
          <ReaderBookmarks
            bookmarks={bookmarks}
            onOpenChapter={openChapter}
          />
        )}
        {tab === 'more' && (
          <ReaderMore
            prefs={prefs}
            onSwitchMode={onSwitchMode}
          />
        )}
      </div>
      <ReaderTabBar active={tab} onSelect={handleTabSelect} />
    </div>
  );
}
