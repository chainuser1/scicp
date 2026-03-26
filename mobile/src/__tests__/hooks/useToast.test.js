import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast, addToast } from '../../hooks/useToast';

describe('useToast', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('addToast pushes a toast', () => {
    const { result } = renderHook(() => useToast());
    act(() => addToast('Hello', 'success'));
    expect(result.current.toasts.length).toBeGreaterThanOrEqual(1);
    expect(result.current.toasts.some(t => t.message === 'Hello')).toBe(true);
  });

  it('toasts auto-expire', () => {
    const { result } = renderHook(() => useToast());
    act(() => addToast('Temp', 'info'));
    expect(result.current.toasts.length).toBeGreaterThanOrEqual(1);
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current.toasts.filter(t => t.message === 'Temp')).toHaveLength(0);
  });
});
