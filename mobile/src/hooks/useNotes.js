/**
 * useNotes.js — Private per-verse presenter notes via localStorage.
 * Notes are NOT sent to the TV — they stay local to the device.
 */
import { useState, useCallback } from 'react';

const KEY = 'scicp_verse_notes';

export function useNotes() {
  const [notes, setNotes] = useState(() => {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
  });

  const save = (next) => {
    setNotes(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
  };

  const getNote = useCallback((id) => notes[id] || '', [notes]);

  const setNote = useCallback((id, text) => {
    save({ ...notes, [id]: text || undefined });
  }, [notes]);

  const removeNote = useCallback((id) => {
    const { [id]: _, ...rest } = notes;
    save(rest);
  }, [notes]);

  const hasNote = useCallback((id) => !!notes[id], [notes]);

  return { notes, getNote, setNote, removeNote, hasNote };
}
