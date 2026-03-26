/**
 * useHistory.js — Tracks recently viewed/live verses in localStorage.
 */
import { useState, useCallback, useEffect } from 'react';

const HISTORY_KEY = 'scicp_history';
const MAX = 30;

export function useHistory() {
  const [history, setHistory] = useState(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw).slice(0, MAX) : [];
    } catch { return []; }
  });

  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(history)); }
    catch { /* storage full */ }
  }, [history]);

  const addToHistory = useCallback((verse) => {
    if (!verse?.verse_id) return;
    setHistory(h => [
      { ...verse, _ts: Date.now() },
      ...h.filter(e => e.verse_id !== verse.verse_id).slice(0, MAX - 1),
    ]);
  }, []);

  const clearHistory = useCallback(() => setHistory([]), []);

  return { history, addToHistory, clearHistory };
}
