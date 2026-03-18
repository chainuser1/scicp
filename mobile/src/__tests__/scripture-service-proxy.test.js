import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../scripture-service', () => ({
  search: vi.fn().mockResolvedValue({ results: ['local'], total: 1 }),
  browse: vi.fn().mockReturnValue([{ id: 1, title: 'Genesis' }]),
  getAdjacent: vi.fn().mockReturnValue({ verse_id: 2 }),
  getChapterSummary: vi.fn().mockReturnValue({ summary_text: 'local summary' }),
  getChapterFootnotes: vi.fn().mockReturnValue({ nabre_footnotes: null, net_footnotes: null }),
  getChapterEntities: vi.fn().mockReturnValue({ people: [], places: [] }),
  getVerseSummary: vi.fn().mockReturnValue({ summary: 'local verse' }),
  getRelated: vi.fn().mockReturnValue({ results: [] }),
  getVerseTags: vi.fn().mockReturnValue({ pov: null, labels: [] }),
  getVerse: vi.fn().mockReturnValue({ verse_id: 1, scripture_text: 'text' }),
  searchEntityDisambiguated: vi.fn().mockReturnValue({ results: [], total: 0 }),
  searchSermonTopics: vi.fn().mockReturnValue({ results: [] }),
  verseOfTheDay: vi.fn().mockReturnValue({ verse_id: 100 }),
  getLoadedLanguages: vi.fn().mockReturnValue(['en']),
}));

vi.mock('../scripture-service-remote', () => ({
  setServerUrl: vi.fn(),
  search: vi.fn().mockResolvedValue({ results: ['remote'], total: 1 }),
  browse: vi.fn().mockResolvedValue([{ id: 1, title: 'Genesis' }]),
  getAdjacent: vi.fn().mockResolvedValue({ verse_id: 3 }),
  getChapterSummary: vi.fn().mockResolvedValue({ summary_text: 'remote summary' }),
  getChapterFootnotes: vi.fn().mockResolvedValue({ nabre_footnotes: 'fn', net_footnotes: null }),
  getChapterEntities: vi.fn().mockResolvedValue({ people: ['Moses'], places: [] }),
  getVerseSummary: vi.fn().mockResolvedValue({ summary: 'remote verse' }),
  getRelated: vi.fn().mockResolvedValue({ results: [{ verse_id: 5 }] }),
  getVerseTags: vi.fn().mockResolvedValue({ pov: 'narrator', labels: ['law'] }),
  getVerse: vi.fn().mockResolvedValue({ verse_id: 1, scripture_text: 'remote text' }),
  searchEntityDisambiguated: vi.fn().mockResolvedValue({ results: [{ id: 1 }], total: 1 }),
  searchSermonTopics: vi.fn().mockResolvedValue({ results: [{ topic: 'love' }] }),
  verseOfTheDay: vi.fn().mockResolvedValue({ verse_id: 200 }),
  getLoadedLanguages: vi.fn().mockReturnValue(['en', 'tl']),
}));

import { createServiceProxy } from '../scripture-service-proxy';
import * as local from '../scripture-service';
import * as remote from '../scripture-service-remote';

describe('createServiceProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const ALL_METHODS = [
    'search', 'browse', 'getAdjacent', 'getChapterSummary',
    'getChapterFootnotes', 'getChapterEntities', 'getVerseSummary',
    'getRelated', 'getVerseTags', 'getVerse',
    'searchEntityDisambiguated', 'searchSermonTopics', 'verseOfTheDay',
  ];

  it('exposes all expected methods', () => {
    const proxy = createServiceProxy(false, '');
    for (const method of ALL_METHODS) {
      expect(typeof proxy[method]).toBe('function');
    }
    expect(typeof proxy.getLoadedLanguages).toBe('function');
  });

  describe('offline mode (isOnline=false)', () => {
    it('routes search to local service', async () => {
      const proxy = createServiceProxy(false, '');
      const result = await proxy.search('love', 0, 10, 'en');
      expect(local.search).toHaveBeenCalledWith('love', 0, 10, 'en');
      expect(remote.search).not.toHaveBeenCalled();
      expect(result).toEqual({ results: ['local'], total: 1 });
    });

    it('routes browse to local service', async () => {
      const proxy = createServiceProxy(false, '');
      await proxy.browse('books', {}, 'en');
      expect(local.browse).toHaveBeenCalledWith('books', {}, 'en');
      expect(remote.browse).not.toHaveBeenCalled();
    });

    it('routes getChapterSummary to local service', async () => {
      const proxy = createServiceProxy(false, '');
      const result = await proxy.getChapterSummary(1);
      expect(local.getChapterSummary).toHaveBeenCalledWith(1);
      expect(result).toEqual({ summary_text: 'local summary' });
    });

    it('routes getVerseSummary to local service', async () => {
      const proxy = createServiceProxy(false, '');
      await proxy.getVerseSummary(42);
      expect(local.getVerseSummary).toHaveBeenCalledWith(42);
      expect(remote.getVerseSummary).not.toHaveBeenCalled();
    });

    it('routes verseOfTheDay to local service', async () => {
      const proxy = createServiceProxy(false, '');
      const result = await proxy.verseOfTheDay();
      expect(local.verseOfTheDay).toHaveBeenCalled();
      expect(result).toEqual({ verse_id: 100 });
    });

    it('does not call setServerUrl', () => {
      createServiceProxy(false, '');
      expect(remote.setServerUrl).not.toHaveBeenCalled();
    });
  });

  describe('online mode (isOnline=true, serverUrl set)', () => {
    it('calls setServerUrl with the provided URL', () => {
      createServiceProxy(true, 'https://example.com');
      expect(remote.setServerUrl).toHaveBeenCalledWith('https://example.com');
    });

    it('routes search to remote service', async () => {
      const proxy = createServiceProxy(true, 'https://example.com');
      const result = await proxy.search('faith', 0, 10, 'en');
      expect(remote.search).toHaveBeenCalledWith('faith', 0, 10, 'en');
      expect(local.search).not.toHaveBeenCalled();
      expect(result).toEqual({ results: ['remote'], total: 1 });
    });

    it('routes browse to remote service', async () => {
      const proxy = createServiceProxy(true, 'https://example.com');
      await proxy.browse('chapters', { bookId: 1 }, 'en');
      expect(remote.browse).toHaveBeenCalledWith('chapters', { bookId: 1 }, 'en');
      expect(local.browse).not.toHaveBeenCalled();
    });

    it('routes getChapterSummary to remote service', async () => {
      const proxy = createServiceProxy(true, 'https://example.com');
      const result = await proxy.getChapterSummary(5);
      expect(remote.getChapterSummary).toHaveBeenCalledWith(5);
      expect(result).toEqual({ summary_text: 'remote summary' });
    });

    it('routes getRelated to remote service', async () => {
      const proxy = createServiceProxy(true, 'https://example.com');
      await proxy.getRelated(10, 'tl');
      expect(remote.getRelated).toHaveBeenCalledWith(10, 'tl');
    });

    it('routes getLoadedLanguages to remote service', () => {
      const proxy = createServiceProxy(true, 'https://example.com');
      const langs = proxy.getLoadedLanguages();
      expect(remote.getLoadedLanguages).toHaveBeenCalled();
      expect(langs).toEqual(['en', 'tl']);
    });
  });

  describe('online mode without serverUrl falls back to local', () => {
    it('routes to local when isOnline=true but serverUrl is empty', async () => {
      const proxy = createServiceProxy(true, '');
      await proxy.search('hope', 0, 10, 'en');
      expect(local.search).toHaveBeenCalled();
      expect(remote.search).not.toHaveBeenCalled();
    });
  });
});
