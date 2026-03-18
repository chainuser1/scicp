import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../scripture-service', () => ({
  init: vi.fn().mockResolvedValue(),
  search: vi.fn().mockResolvedValue({ results: [{ verse_id: 1 }], total: 1 }),
  browse: vi.fn(() => []),
  getVerse: vi.fn(() => null),
  getAdjacent: vi.fn(() => null),
  getRelated: vi.fn(() => ({ results: [] })),
  getVerseSummary: vi.fn(() => null),
  getChapterSummary: vi.fn(() => null),
  getChapterFootnotes: vi.fn(() => ({ nabre_footnotes: null, net_footnotes: null })),
  getChapterEntities: vi.fn(() => ({ people: [], places: [] })),
  getVerseTags: vi.fn(() => null),
  verseOfTheDay: vi.fn(() => null),
  searchEntityDisambiguated: vi.fn(() => ({ results: [], total: 0 })),
  searchSermonTopics: vi.fn(() => ({ results: [] })),
  segmentVerseText: vi.fn((t) => [t]),
  segmentVerseTextDual: vi.fn((a, b) => [[a], [b]]),
  getVersionCitation: vi.fn(() => 'KJV'),
}));

vi.mock('capacitor-external-display', () => ({
  ExternalDisplay: {
    isAvailable: vi.fn().mockResolvedValue({ available: false }),
    startPresentation: vi.fn().mockResolvedValue({}),
    stopPresentation: vi.fn().mockResolvedValue({}),
    updateContent: vi.fn().mockResolvedValue({}),
    openCastSettings: vi.fn().mockResolvedValue({}),
    sendToDisplay: vi.fn().mockResolvedValue({}),
    checkCameraPermission: vi.fn().mockResolvedValue({ status: 'granted' }),
  },
}));

import { socket } from '../socket-local';
import * as svc from '../scripture-service';

describe('socket-local', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('socket properties', () => {
    it('has connected=true', () => {
      expect(socket.connected).toBe(true);
    });

    it('has id="mobile-local"', () => {
      expect(socket.id).toBe('mobile-local');
    });

    it('has emit, on, off methods', () => {
      expect(typeof socket.emit).toBe('function');
      expect(typeof socket.on).toBe('function');
      expect(typeof socket.off).toBe('function');
    });

    it('has init method', () => {
      expect(typeof socket.init).toBe('function');
    });
  });

  describe('on/off listeners', () => {
    it('registers and fires a listener', async () => {
      const handler = vi.fn();
      socket.on('search-results', handler);

      await socket.emit('search', { query: 'test' });

      expect(handler).toHaveBeenCalled();
      const callArg = handler.mock.calls[0][0];
      expect(callArg).toHaveProperty('results');
      expect(callArg).toHaveProperty('query', 'test');

      socket.off('search-results', handler);
    });

    it('removes a specific listener with off', async () => {
      const handler = vi.fn();
      socket.on('search-results', handler);
      socket.off('search-results', handler);

      await socket.emit('search', { query: 'test' });

      expect(handler).not.toHaveBeenCalled();
    });

    it('removes all listeners for an event when no fn provided', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      socket.on('search-results', handler1);
      socket.on('search-results', handler2);
      socket.off('search-results');

      await socket.emit('search', { query: 'test' });

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).not.toHaveBeenCalled();
    });
  });

  describe('emit("search")', () => {
    it('calls svc.search and fires search-results', async () => {
      const handler = vi.fn();
      socket.on('search-results', handler);

      await socket.emit('search', { query: 'love', page: 0, pageSize: 10, language: 'en' });

      expect(svc.search).toHaveBeenCalledWith('love', 0, 10, 'en');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ results: [{ verse_id: 1 }], total: 1, query: 'love' })
      );

      socket.off('search-results', handler);
    });

    it('fires empty results for blank query', async () => {
      const handler = vi.fn();
      socket.on('search-results', handler);

      await socket.emit('search', { query: '' });

      expect(svc.search).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ results: [], total: 0 })
      );

      socket.off('search-results', handler);
    });

    it('fires empty results when query is missing', async () => {
      const handler = vi.fn();
      socket.on('search-results', handler);

      await socket.emit('search', {});

      expect(svc.search).not.toHaveBeenCalled();
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ results: [], total: 0 })
      );

      socket.off('search-results', handler);
    });
  });

  describe('emit("clear-screen")', () => {
    it('fires clear-screen event and calls ack', async () => {
      const handler = vi.fn();
      const ack = vi.fn();
      socket.on('clear-screen', handler);

      await socket.emit('clear-screen', {}, ack);

      expect(handler).toHaveBeenCalled();
      expect(ack).toHaveBeenCalledWith({ ok: true });

      socket.off('clear-screen', handler);
    });
  });

  describe('emit("update-theme")', () => {
    it('fires update-theme event to listeners', async () => {
      const handler = vi.fn();
      socket.on('update-theme', handler);

      const theme = { background: '#000', color: '#fff' };
      await socket.emit('update-theme', { theme });

      expect(handler).toHaveBeenCalledWith(theme);

      socket.off('update-theme', handler);
    });
  });

  describe('emit("highlight-text")', () => {
    it('fires highlight-text event', async () => {
      const handler = vi.fn();
      socket.on('highlight-text', handler);

      await socket.emit('highlight-text', { text: 'important' });

      expect(handler).toHaveBeenCalledWith('important');

      socket.off('highlight-text', handler);
    });
  });

  describe('emit("join-session")', () => {
    it('fires session-joined and calls ack', async () => {
      const handler = vi.fn();
      const ack = vi.fn();
      socket.on('session-joined', handler);

      await socket.emit('join-session', {}, ack);

      expect(ack).toHaveBeenCalledWith(
        expect.objectContaining({ ok: true, sessionId: 'LOCAL' })
      );
      expect(handler).toHaveBeenCalledWith({ sessionId: 'LOCAL' });

      socket.off('session-joined', handler);
    });
  });

  describe('emit("leave-session")', () => {
    it('fires session-left and calls ack', async () => {
      const handler = vi.fn();
      const ack = vi.fn();
      socket.on('session-left', handler);

      await socket.emit('leave-session', {}, ack);

      expect(ack).toHaveBeenCalledWith({ ok: true });
      expect(handler).toHaveBeenCalled();

      socket.off('session-left', handler);
    });
  });

  describe('init()', () => {
    it('calls svc.init and fires connect event', async () => {
      const connectHandler = vi.fn();
      socket.on('connect', connectHandler);

      await socket.init();

      expect(svc.init).toHaveBeenCalled();
      expect(connectHandler).toHaveBeenCalled();

      socket.off('connect', connectHandler);
    });
  });
});
