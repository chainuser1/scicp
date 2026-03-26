import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setServerUrl,
  getServerUrl,
  search,
  browse,
  getAdjacent,
  getChapterSummary,
  getChapterFootnotes,
  getChapterEntities,
  getVerseSummary,
  getRelated,
  getVerseTags,
  getVerse,
  searchEntityDisambiguated,
  searchSermonTopics,
  verseOfTheDay,
  getLoadedLanguages,
} from '../scripture-service-remote';

function mockFetchJson(data, ok = true) {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(data),
  });
}

describe('scripture-service-remote', () => {
  beforeEach(() => {
    setServerUrl('https://api.example.com');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setServerUrl('');
  });

  // ── setServerUrl ──────────────────────────────────────────────────────────

  describe('setServerUrl', () => {
    it('strips trailing slashes', () => {
      setServerUrl('https://api.example.com///');
      expect(getServerUrl()).toBe('https://api.example.com');
    });

    it('handles empty/null input', () => {
      setServerUrl(null);
      expect(getServerUrl()).toBe('');
      setServerUrl('');
      expect(getServerUrl()).toBe('');
    });
  });

  // ── search ────────────────────────────────────────────────────────────────

  describe('search', () => {
    it('calls fetch with correct URL', async () => {
      mockFetchJson({ results: [{ verse_id: 1 }], total: 1 });
      const result = await search('love', 0, 10, 'en');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/search?q=love&page=0&pageSize=10&language=en',
        expect.any(Object)
      );
      expect(result).toEqual({ results: [{ verse_id: 1 }], total: 1 });
    });

    it('encodes special characters in query', async () => {
      mockFetchJson({ results: [], total: 0 });
      await search('God & love', 0, 10, 'en');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining('q=God'),
        expect.any(Object)
      );
      // URLSearchParams encodes spaces as + and & as %26
      const calledUrl = globalThis.fetch.mock.calls[0][0];
      expect(calledUrl).toMatch(/q=God[+%20]+%26[+%20]+love/);
    });
  });

  // ── browse ────────────────────────────────────────────────────────────────

  describe('browse', () => {
    it('calls /browse/books for books', async () => {
      mockFetchJson([{ id: 1, book_title: 'Genesis' }]);
      const result = await browse('books');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/browse/books?language=en',
        expect.any(Object)
      );
      expect(result).toEqual([{ id: 1, book_title: 'Genesis' }]);
    });

    it('calls /browse/chapters with book_id', async () => {
      mockFetchJson([{ id: 10, chapter_number: 1 }]);
      await browse('chapters', { bookId: 1 }, 'en');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/browse/chapters?book_id=1&language=en',
        expect.any(Object)
      );
    });

    it('calls /browse/verses with chapter_id', async () => {
      mockFetchJson([]);
      await browse('verses', { chapterId: 5 }, 'tl');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/browse/verses?chapter_id=5&language=tl',
        expect.any(Object)
      );
    });

    it('returns empty array for unknown type', async () => {
      const result = await browse('unknown');
      expect(result).toEqual([]);
    });
  });

  // ── getChapterSummary ─────────────────────────────────────────────────────

  describe('getChapterSummary', () => {
    it('calls /chapter/:id/summary', async () => {
      mockFetchJson({
        summary_text: 'A summary', summary_method: 'extractive',
        key_verses: [1], top_topics: ['love'], ready: true,
        nabre_footnotes: 'fn1', net_footnotes: null,
      });
      const result = await getChapterSummary(42);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/chapter/42/summary',
        expect.any(Object)
      );
      expect(result.summary_text).toBe('A summary');
      expect(result.ready).toBe(true);
    });
  });

  // ── getChapterFootnotes ───────────────────────────────────────────────────

  describe('getChapterFootnotes', () => {
    it('extracts footnotes from chapter summary endpoint', async () => {
      mockFetchJson({ nabre_footnotes: 'note1', net_footnotes: 'note2' });
      const result = await getChapterFootnotes(7);
      expect(result).toEqual({ nabre_footnotes: 'note1', net_footnotes: 'note2' });
    });
  });

  // ── getChapterEntities ────────────────────────────────────────────────────

  describe('getChapterEntities', () => {
    it('calls /chapter/:id/entities', async () => {
      mockFetchJson({ people: ['Moses'], places: ['Sinai'], ready: true });
      const result = await getChapterEntities(3);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/chapter/3/entities',
        expect.any(Object)
      );
      expect(result.people).toEqual(['Moses']);
    });
  });

  // ── getVerseSummary ───────────────────────────────────────────────────────

  describe('getVerseSummary', () => {
    it('calls /verse/:id/summary', async () => {
      mockFetchJson({ summary: 'verse summary', cross_references: [], ready: true });
      const result = await getVerseSummary(100);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/verse/100/summary',
        expect.any(Object)
      );
      expect(result.summary).toBe('verse summary');
    });
  });

  // ── getRelated ────────────────────────────────────────────────────────────

  describe('getRelated', () => {
    it('calls /verse/:id/related with language', async () => {
      mockFetchJson({ results: [{ verse_id: 2 }], matchedConcept: 'love', total: 1 });
      const result = await getRelated(1, 'en');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/verse/1/related?language=en&pageSize=20',
        expect.any(Object)
      );
      expect(result.matchedConcept).toBe('love');
    });
  });

  // ── getVerseTags ──────────────────────────────────────────────────────────

  describe('getVerseTags', () => {
    it('calls /verse/:id/tags', async () => {
      mockFetchJson({ pov: 'narrator', labels: ['law'], speaker: null, ready: true });
      const result = await getVerseTags(50);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/verse/50/tags',
        expect.any(Object)
      );
      expect(result.pov).toBe('narrator');
    });
  });

  // ── getVerse ──────────────────────────────────────────────────────────────

  describe('getVerse', () => {
    it('calls /verse/:id/translation', async () => {
      mockFetchJson({ verse_id: 5, scripture_text: 'translated' });
      const result = await getVerse({ verse_id: 5 }, 'tl');
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/verse/5/translation?language=tl',
        expect.any(Object)
      );
      expect(result.scripture_text).toBe('translated');
    });

    it('returns null when params have no verse_id', async () => {
      const result = await getVerse({}, 'en');
      expect(result).toBeNull();
    });

    it('returns null when params is null', async () => {
      const result = await getVerse(null, 'en');
      expect(result).toBeNull();
    });
  });

  // ── searchEntityDisambiguated ─────────────────────────────────────────────

  describe('searchEntityDisambiguated', () => {
    it('calls /entity/search with query params', async () => {
      mockFetchJson({ results: [{ id: 1 }], total: 1, name: 'Moses', type: 'person', groups: [] });
      await searchEntityDisambiguated('Moses', 'person', 10, null, 0, 10);
      const url = globalThis.fetch.mock.calls[0][0];
      expect(url).toContain('/entity/search?');
      expect(url).toContain('name=Moses');
      expect(url).toContain('type=person');
      expect(url).toContain('verse_id=10');
    });
  });

  // ── searchSermonTopics ────────────────────────────────────────────────────

  describe('searchSermonTopics', () => {
    it('calls /sermon-search and returns results array', async () => {
      mockFetchJson({ results: [{ topic: 'grace' }] });
      const result = await searchSermonTopics('grace', 5);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/sermon-search?q=grace&limit=5',
        expect.any(Object)
      );
      expect(result).toEqual([{ topic: 'grace' }]);
    });
  });

  // ── verseOfTheDay ─────────────────────────────────────────────────────────

  describe('verseOfTheDay', () => {
    it('calls /verse/of-the-day', async () => {
      mockFetchJson({ verse_id: 999, scripture_text: 'daily verse' });
      const result = await verseOfTheDay();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'https://api.example.com/verse/of-the-day',
        expect.any(Object)
      );
      expect(result.verse_id).toBe(999);
    });
  });

  // ── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('returns fallback on network error', async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
      const result = await search('test');
      expect(result).toEqual({ results: [], total: 0, page: 0, pageSize: 10 });
    });

    it('returns fallback on non-ok response', async () => {
      mockFetchJson({}, false);
      const result = await search('test');
      expect(result).toEqual({ results: [], total: 0, page: 0, pageSize: 10 });
    });

    it('returns fallback when serverUrl is empty', async () => {
      setServerUrl('');
      globalThis.fetch = vi.fn();
      const result = await search('test');
      expect(result).toEqual({ results: [], total: 0, page: 0, pageSize: 10 });
      expect(globalThis.fetch).not.toHaveBeenCalled();
    });
  });

  // ── getLoadedLanguages ────────────────────────────────────────────────────

  describe('getLoadedLanguages', () => {
    it('returns all supported language codes', () => {
      const langs = getLoadedLanguages();
      expect(langs).toContain('en');
      expect(langs).toContain('tl');
      expect(Array.isArray(langs)).toBe(true);
    });
  });
});
