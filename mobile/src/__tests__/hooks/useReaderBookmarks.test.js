import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReaderBookmarks } from '../../hooks/useReaderBookmarks';

describe('useReaderBookmarks', () => {
  beforeEach(() => localStorage.clear());

  const verse = {
    verse_id: 200,
    book_title: 'Alma',
    chapter_number: 32,
    verse_number: 21,
    scripture_text: 'Faith is not to have a perfect knowledge',
  };

  it('starts empty', () => {
    const { result } = renderHook(() => useReaderBookmarks());
    expect(result.current.bookmarks).toEqual([]);
    expect(result.current.count).toBe(0);
  });

  it('add inserts a bookmark with metadata', () => {
    const { result } = renderHook(() => useReaderBookmarks());
    act(() => result.current.add(verse));
    expect(result.current.count).toBe(1);
    expect(result.current.isBookmarked(200)).toBe(true);
    expect(result.current.bookmarks[0].book_title).toBe('Alma');
  });

  it('toggle adds then removes', () => {
    const { result } = renderHook(() => useReaderBookmarks());
    act(() => result.current.toggle(verse));
    expect(result.current.isBookmarked(200)).toBe(true);
    act(() => result.current.toggle(verse));
    expect(result.current.isBookmarked(200)).toBe(false);
  });

  it('search filters by text', () => {
    const { result } = renderHook(() => useReaderBookmarks());
    act(() => result.current.add(verse));
    act(() => result.current.add({
      verse_id: 201, book_title: 'Moroni', chapter_number: 10, verse_number: 4,
      scripture_text: 'Ask with a sincere heart',
    }));
    const found = result.current.search('faith');
    expect(found).toHaveLength(1);
    expect(found[0].verse_id).toBe(200);
  });

  it('byBook groups bookmarks', () => {
    const { result } = renderHook(() => useReaderBookmarks());
    act(() => result.current.add(verse));
    act(() => result.current.add({ ...verse, verse_id: 201, verse_number: 22 }));
    const groups = result.current.byBook;
    expect(Object.keys(groups)).toContain('Alma');
    expect(groups['Alma']).toHaveLength(2);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useReaderBookmarks());
    act(() => result.current.add(verse));
    const stored = JSON.parse(localStorage.getItem('scicp_rd_bookmarks'));
    expect(stored).toHaveLength(1);
  });
});
