import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNotes } from '../../hooks/useNotes';

describe('useNotes', () => {
  beforeEach(() => localStorage.clear());

  it('starts with empty notes', () => {
    const { result } = renderHook(() => useNotes());
    expect(result.current.notes).toEqual({});
  });

  it('getNote returns empty string for unknown id', () => {
    const { result } = renderHook(() => useNotes());
    expect(result.current.getNote('999')).toBe('');
  });

  it('setNote stores a note and getNote retrieves it', () => {
    const { result } = renderHook(() => useNotes());
    act(() => result.current.setNote('101', 'Remember emphasis'));
    expect(result.current.getNote('101')).toBe('Remember emphasis');
  });

  it('setNote with empty text removes the key', () => {
    const { result } = renderHook(() => useNotes());
    act(() => result.current.setNote('101', 'Some note'));
    act(() => result.current.setNote('101', ''));
    expect(result.current.hasNote('101')).toBe(false);
  });

  it('removeNote deletes an existing note', () => {
    const { result } = renderHook(() => useNotes());
    act(() => result.current.setNote('101', 'My note'));
    act(() => result.current.removeNote('101'));
    expect(result.current.getNote('101')).toBe('');
    expect(result.current.hasNote('101')).toBe(false);
  });

  it('hasNote returns true for existing, false for missing', () => {
    const { result } = renderHook(() => useNotes());
    expect(result.current.hasNote('101')).toBe(false);
    act(() => result.current.setNote('101', 'Note text'));
    expect(result.current.hasNote('101')).toBe(true);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useNotes());
    act(() => result.current.setNote('42', 'Persisted'));
    const stored = JSON.parse(localStorage.getItem('scicp_verse_notes'));
    expect(stored['42']).toBe('Persisted');
  });

  it('restores from localStorage', () => {
    localStorage.setItem('scicp_verse_notes', JSON.stringify({ '7': 'Saved earlier' }));
    const { result } = renderHook(() => useNotes());
    expect(result.current.getNote('7')).toBe('Saved earlier');
    expect(result.current.hasNote('7')).toBe(true);
  });

  it('handles corrupt localStorage gracefully', () => {
    localStorage.setItem('scicp_verse_notes', '{bad json');
    const { result } = renderHook(() => useNotes());
    expect(result.current.notes).toEqual({});
  });

  it('supports multiple notes simultaneously', () => {
    const { result } = renderHook(() => useNotes());
    act(() => result.current.setNote('1', 'First'));
    act(() => result.current.setNote('2', 'Second'));
    expect(result.current.getNote('1')).toBe('First');
    expect(result.current.getNote('2')).toBe('Second');
  });
});
