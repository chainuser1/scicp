import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useReaderPrefs } from '../../hooks/useReaderPrefs';

describe('useReaderPrefs', () => {
  beforeEach(() => localStorage.clear());

  it('returns sensible defaults', () => {
    const { result } = renderHook(() => useReaderPrefs());
    expect(result.current.theme).toBe('sepia');
    expect(result.current.fontSize).toBe(18);
    expect(result.current.lang).toBe('en');
  });

  it('setTheme changes and persists', () => {
    const { result } = renderHook(() => useReaderPrefs());
    act(() => result.current.setTheme('night'));
    expect(result.current.theme).toBe('night');
    expect(JSON.parse(localStorage.getItem('scicp_rd_theme'))).toBe('night');
  });

  it('setFontSize changes and persists', () => {
    const { result } = renderHook(() => useReaderPrefs());
    act(() => result.current.setFontSize(22));
    expect(result.current.fontSize).toBe(22);
    expect(JSON.parse(localStorage.getItem('scicp_rd_fontsize'))).toBe(22);
  });

  it('setLang changes and persists', () => {
    const { result } = renderHook(() => useReaderPrefs());
    act(() => result.current.setLang('tl'));
    expect(result.current.lang).toBe('tl');
    expect(JSON.parse(localStorage.getItem('scicp_rd_lang'))).toBe('tl');
  });

  it('setLastRead stores reading position', () => {
    const { result } = renderHook(() => useReaderPrefs());
    act(() => result.current.setLastRead({ bookId: 5, chapterId: 10, label: 'Alma 32' }));
    expect(result.current.lastRead.bookId).toBe(5);
    const stored = JSON.parse(localStorage.getItem('scicp_rd_lastread'));
    expect(stored.label).toBe('Alma 32');
  });

  it('restores saved values', () => {
    localStorage.setItem('scicp_rd_theme', JSON.stringify('dim'));
    localStorage.setItem('scicp_rd_fontsize', JSON.stringify(24));
    localStorage.setItem('scicp_rd_lang', JSON.stringify('ceb'));
    const { result } = renderHook(() => useReaderPrefs());
    expect(result.current.theme).toBe('dim');
    expect(result.current.fontSize).toBe(24);
    expect(result.current.lang).toBe('ceb');
  });
});
