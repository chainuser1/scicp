/**
 * useHighlights.js — 4-color verse highlights, localStorage-persisted.
 * Map: verse_id → 'yellow' | 'green' | 'pink' | 'blue'
 */
import { useState, useCallback } from 'react';

const KEY = 'scicp_rd_highlights';

function loadAll() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
  catch { return {}; }
}
function saveAll(m) {
  try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* full */ }
}

export function useHighlights() {
  const [highlights, setHighlights] = useState(loadAll);

  const getColor = useCallback((verseId) => highlights[verseId] || null, [highlights]);

  const setColor = useCallback((verseId, color) => {
    setHighlights(prev => {
      const next = { ...prev, [verseId]: color };
      saveAll(next);
      return next;
    });
  }, []);

  const toggle = useCallback((verseId, color) => {
    setHighlights(prev => {
      const next = { ...prev };
      if (next[verseId] === color) delete next[verseId];
      else next[verseId] = color;
      saveAll(next);
      return next;
    });
  }, []);

  const remove = useCallback((verseId) => {
    setHighlights(prev => {
      const next = { ...prev };
      delete next[verseId];
      saveAll(next);
      return next;
    });
  }, []);

  const count = Object.keys(highlights).length;

  return { highlights, getColor, setColor, toggle, remove, count };
}
