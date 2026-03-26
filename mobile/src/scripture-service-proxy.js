/**
 * scripture-service-proxy.js — Unified service that routes to local (offline)
 * or remote scripture service.
 *
 * Uses the remote API whenever the server URL is known AND the device has
 * network connectivity — regardless of session mode (online vs offline cast).
 * Falls back to local SQL.js when offline or the API is unreachable.
 *
 * Usage in MobilePresenter:
 *   import { createServiceProxy } from '../scripture-service-proxy';
 *   const svcProxy = useMemo(() => createServiceProxy(networkAvailable, serverUrl), [networkAvailable, serverUrl]);
 *   // then: const data = await svcProxy.getChapterSummary(chapterId);
 */
import * as local from './scripture-service';
import * as remote from './scripture-service-remote';

export function createServiceProxy(networkAvailable, serverUrl) {
  if (networkAvailable && serverUrl) {
    remote.setServerUrl(serverUrl);
  }

  const useRemote = networkAvailable && !!serverUrl;

  return {
    // ── Search ──
    async search(query, page, pageSize, language) {
      if (useRemote) return remote.search(query, page, pageSize, language);
      return local.search(query, page, pageSize, language);
    },

    // ── Browse ──
    async browse(type, params, language) {
      if (useRemote) return remote.browse(type, params, language);
      return local.browse(type, params, language);
    },

    // ── Adjacent ──
    async getAdjacent(source, direction, language) {
      if (useRemote) return remote.getAdjacent(source, direction, language);
      return local.getAdjacent(source, direction, language);
    },

    // ── Chapter Summary (includes footnotes from remote) ──
    async getChapterSummary(chapterId) {
      if (useRemote) return remote.getChapterSummary(chapterId);
      return local.getChapterSummary(chapterId);
    },

    // ── Chapter Footnotes ──
    async getChapterFootnotes(chapterId) {
      if (useRemote) return remote.getChapterFootnotes(chapterId);
      return local.getChapterFootnotes(chapterId);
    },

    // ── Chapter Entities ──
    async getChapterEntities(chapterId) {
      if (useRemote) return remote.getChapterEntities(chapterId);
      return local.getChapterEntities(chapterId);
    },

    // ── Verse Summary ──
    async getVerseSummary(verseId) {
      if (useRemote) return remote.getVerseSummary(verseId);
      return local.getVerseSummary(verseId);
    },

    // ── Related Verses ──
    async getRelated(verseId, language) {
      if (useRemote) return remote.getRelated(verseId, language);
      return local.getRelated(verseId, language);
    },

    // ── Verse Tags ──
    async getVerseTags(verseId) {
      if (useRemote) return remote.getVerseTags(verseId);
      return local.getVerseTags(verseId);
    },

    // ── Verse (for language switching) ──
    async getVerse(params, language) {
      if (useRemote) return remote.getVerse(params, language);
      return local.getVerse(params, language);
    },

    // ── Entity Search ──
    async searchEntityDisambiguated(name, type, verseId, entityId, page, pageSize) {
      if (useRemote) return remote.searchEntityDisambiguated(name, type, verseId, entityId, page, pageSize);
      return local.searchEntityDisambiguated(name, type, verseId, entityId, page, pageSize);
    },

    // ── Sermon Topics ──
    async searchSermonTopics(query, limit) {
      if (useRemote) return remote.searchSermonTopics(query, limit);
      return local.searchSermonTopics(query, limit);
    },

    // ── Verse of the Day ──
    async verseOfTheDay() {
      if (useRemote) return remote.verseOfTheDay();
      return local.verseOfTheDay();
    },

    // ── Loaded Languages ──
    getLoadedLanguages() {
      if (useRemote) return remote.getLoadedLanguages();
      return local.getLoadedLanguages ? local.getLoadedLanguages() : [];
    },
  };
}
