/**
 * useReaderBookmarks.js — Bookmarks with metadata, search, categories.
 * Each bookmark: { verse_id, book_title, chapter_number, verse_number, scripture_text, added_at }
 */
import { useState, useCallback, useMemo } from 'react';

const KEY = 'scicp_rd_bookmarks';

function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { return []; }
}
function saveAll(arr) {
  try { localStorage.setItem(KEY, JSON.stringify(arr)); } catch { /* full */ }
}

export function useReaderBookmarks() {
  const [bookmarks, setBookmarks] = useState(loadAll);

  const isBookmarked = useCallback((verseId) =>
    bookmarks.some(b => b.verse_id === verseId), [bookmarks]);

  const add = useCallback((entry) => {
    setBookmarks(prev => {
      if (prev.some(b => b.verse_id === entry.verse_id)) return prev;
      const next = [{ ...entry, added_at: Date.now() }, ...prev];
      saveAll(next);
      return next;
    });
  }, []);

  const remove = useCallback((verseId) => {
    setBookmarks(prev => {
      const next = prev.filter(b => b.verse_id !== verseId);
      saveAll(next);
      return next;
    });
  }, []);

  const toggle = useCallback((entry) => {
    setBookmarks(prev => {
      const exists = prev.some(b => b.verse_id === entry.verse_id);
      const next = exists
        ? prev.filter(b => b.verse_id !== entry.verse_id)
        : [{ ...entry, added_at: Date.now() }, ...prev];
      saveAll(next);
      return next;
    });
  }, []);

  const search = useCallback((query) => {
    if (!query) return bookmarks;
    const q = query.toLowerCase();
    return bookmarks.filter(b =>
      (b.book_title || '').toLowerCase().includes(q) ||
      (b.scripture_text || '').toLowerCase().includes(q) ||
      `${b.book_title} ${b.chapter_number}:${b.verse_number}`.toLowerCase().includes(q)
    );
  }, [bookmarks]);

  // Group by book_title for categories view
  const byBook = useMemo(() => {
    const map = {};
    for (const b of bookmarks) {
      const key = b.book_title || 'Unknown';
      if (!map[key]) map[key] = [];
      map[key].push(b);
    }
    return map;
  }, [bookmarks]);

  return { bookmarks, isBookmarked, add, remove, toggle, search, byBook, count: bookmarks.length };
}
