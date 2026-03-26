import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHistory } from '../../hooks/useHistory';

describe('useHistory', () => {
  beforeEach(() => localStorage.clear());

  const verse = { verse_id: 50, book_title: 'Genesis', chapter_number: 1, verse_number: 1 };

  it('starts empty', () => {
    const { result } = renderHook(() => useHistory());
    expect(result.current.history).toEqual([]);
  });

  it('addToHistory pushes an entry', () => {
    const { result } = renderHook(() => useHistory());
    act(() => result.current.addToHistory(verse));
    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0].verse_id).toBe(50);
  });

  it('clearHistory empties all', () => {
    const { result } = renderHook(() => useHistory());
    act(() => result.current.addToHistory(verse));
    act(() => result.current.clearHistory());
    expect(result.current.history).toEqual([]);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useHistory());
    act(() => result.current.addToHistory(verse));
    const stored = JSON.parse(localStorage.getItem('scicp_history'));
    expect(stored.length).toBeGreaterThan(0);
  });

  it('restores from localStorage', () => {
    localStorage.setItem('scicp_history', JSON.stringify([verse]));
    const { result } = renderHook(() => useHistory());
    expect(result.current.history).toHaveLength(1);
  });
});
