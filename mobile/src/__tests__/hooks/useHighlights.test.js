import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHighlights } from '../../hooks/useHighlights';

describe('useHighlights', () => {
  beforeEach(() => localStorage.clear());

  it('starts empty', () => {
    const { result } = renderHook(() => useHighlights());
    expect(result.current.count).toBe(0);
    expect(result.current.getColor(1)).toBe(null);
  });

  it('setColor applies a highlight', () => {
    const { result } = renderHook(() => useHighlights());
    act(() => result.current.setColor(42, 'yellow'));
    expect(result.current.getColor(42)).toBe('yellow');
    expect(result.current.count).toBe(1);
  });

  it('toggle toggles color on/off', () => {
    const { result } = renderHook(() => useHighlights());
    act(() => result.current.toggle(42, 'green'));
    expect(result.current.getColor(42)).toBe('green');
    act(() => result.current.toggle(42, 'green'));
    expect(result.current.getColor(42)).toBe(null);
  });

  it('toggle switches to new color', () => {
    const { result } = renderHook(() => useHighlights());
    act(() => result.current.toggle(42, 'green'));
    act(() => result.current.toggle(42, 'pink'));
    expect(result.current.getColor(42)).toBe('pink');
  });

  it('remove clears a highlight', () => {
    const { result } = renderHook(() => useHighlights());
    act(() => result.current.setColor(42, 'blue'));
    act(() => result.current.remove(42));
    expect(result.current.getColor(42)).toBe(null);
  });

  it('persists to localStorage', () => {
    const { result } = renderHook(() => useHighlights());
    act(() => result.current.setColor(42, 'yellow'));
    const stored = JSON.parse(localStorage.getItem('scicp_rd_highlights'));
    expect(stored['42']).toBe('yellow');
  });

  it('restores from localStorage', () => {
    localStorage.setItem('scicp_rd_highlights', JSON.stringify({ '99': 'pink' }));
    const { result } = renderHook(() => useHighlights());
    expect(result.current.getColor(99)).toBe('pink');
  });
});
