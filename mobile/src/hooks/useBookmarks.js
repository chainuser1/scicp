/**
 * useBookmarks.js — Persistent verse bookmarks via localStorage.
 */
import { useState, useCallback, useEffect } from 'react';

const BM_KEY = 'scicp_bookmarks';

export function useBookmarks() {
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      const raw = localStorage.getItem(BM_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem(BM_KEY, JSON.stringify(bookmarks)); }
    catch { /* storage full */ }
  }, [bookmarks]);

  const toggle = useCallback((verse) => {
    if (!verse?.verse_id) return;
    setBookmarks(prev => {
      const exists = prev.some(b => b.verse_id === verse.verse_id);
      if (exists) return prev.filter(b => b.verse_id !== verse.verse_id);
      return [{ ...verse, _ts: Date.now() }, ...prev];
    });
  }, []);

  const isBookmarked = useCallback((verseId) => {
    return bookmarks.some(b => b.verse_id === verseId);
  }, [bookmarks]);

  const clearBookmarks = useCallback(() => setBookmarks([]), []);

  return { bookmarks, toggle, isBookmarked, clearBookmarks };
}
