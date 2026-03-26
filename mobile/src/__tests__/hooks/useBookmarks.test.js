import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBookmarks } from '../../hooks/useBookmarks';

describe('useBookmarks', () => {
  beforeEach(() => localStorage.clear());

  const verse = { verse_id: 101, book_title: 'John', chapter_number: 3, verse_number: 16, scripture_text: 'For God so loved' };

  it('starts empty', () => {
    const { result } = renderHook(() => useBookmarks());
    expect(result.current.bookmarks).toEqual([]);
  });

  it('toggle adds a bookmark', () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => result.current.toggle(verse));
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.isBookmarked(101)).toBe(true);
  });

  it('toggle removes an existing bookmark', () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => result.current.toggle(verse));
    act(() => result.current.toggle(verse));
    expect(result.current.bookmarks).toHaveLength(0);
    expect(result.current.isBookmarked(101)).toBe(false);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => result.current.toggle(verse));
    const stored = JSON.parse(localStorage.getItem('scicp_bookmarks'));
    expect(stored).toHaveLength(1);
    expect(stored[0].verse_id).toBe(101);
  });

  it('restores from localStorage', () => {
    localStorage.setItem('scicp_bookmarks', JSON.stringify([verse]));
    const { result } = renderHook(() => useBookmarks());
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.isBookmarked(101)).toBe(true);
  });

  it('clearBookmarks empties all', () => {
    const { result } = renderHook(() => useBookmarks());
    act(() => result.current.toggle(verse));
    act(() => result.current.clearBookmarks());
    expect(result.current.bookmarks).toHaveLength(0);
  });
});
