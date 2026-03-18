import { describe, it, expect, beforeEach } from 'vitest';
import { isEnhancedSearchEnabled, setEnhancedSearch, getStatus } from '../embedding-engine';

describe('embedding-engine', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('getStatus', () => {
    it('returns "idle" initially', () => {
      expect(getStatus()).toBe('idle');
    });
  });

  describe('isEnhancedSearchEnabled', () => {
    it('returns false when no localStorage value is set', () => {
      expect(isEnhancedSearchEnabled()).toBe(false);
    });

    it('returns true after setEnhancedSearch(true)', () => {
      setEnhancedSearch(true);
      expect(isEnhancedSearchEnabled()).toBe(true);
    });

    it('returns false after setEnhancedSearch(false)', () => {
      setEnhancedSearch(true);
      expect(isEnhancedSearchEnabled()).toBe(true);
      setEnhancedSearch(false);
      expect(isEnhancedSearchEnabled()).toBe(false);
    });
  });

  describe('setEnhancedSearch', () => {
    it('persists "true" to localStorage', () => {
      setEnhancedSearch(true);
      expect(localStorage.getItem('scicp_enhanced_search')).toBe('true');
    });

    it('persists "false" to localStorage', () => {
      setEnhancedSearch(false);
      expect(localStorage.getItem('scicp_enhanced_search')).toBe('false');
    });

    it('toggles value correctly', () => {
      setEnhancedSearch(true);
      expect(localStorage.getItem('scicp_enhanced_search')).toBe('true');
      setEnhancedSearch(false);
      expect(localStorage.getItem('scicp_enhanced_search')).toBe('false');
    });
  });
});
