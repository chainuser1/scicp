/**
 * prefs.js — Durable key-value storage
 *
 * Uses @capacitor/preferences (native SQLite-backed on iOS/Android) as the
 * primary store, with localStorage as an immediate-read cache and fallback.
 *
 * Pattern: write-both (Preferences + localStorage), read-from-localStorage
 * for synchronous init + async-override from Preferences on mount.
 *
 * Why: iOS WebView purges localStorage under storage pressure; Preferences
 * persists in app-group storage which survives low-storage events.
 */

import { Preferences } from '@capacitor/preferences';

const isNative = !!(window.Capacitor?.isNativePlatform?.() || window.Capacitor?.platform);

/** Synchronously read from localStorage (for useState initializers). */
export function prefGetSync(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? raw : fallback;
  } catch {
    return fallback;
  }
}

/** Asynchronously read from Preferences, falling back to localStorage. */
export async function prefGet(key, fallback = null) {
  if (isNative) {
    try {
      const { value } = await Preferences.get({ key });
      if (value !== null) {
        // Keep localStorage in sync for fast next-read
        try { localStorage.setItem(key, value); } catch { /* ignore */ }
        return value;
      }
    } catch { /* fall through to localStorage */ }
  }
  return prefGetSync(key, fallback);
}

/** Write value to both Preferences (durable) and localStorage (fast cache). */
export async function prefSet(key, value) {
  // Write to localStorage immediately so reads are always fast
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
  // Write to Preferences asynchronously for durability
  if (isNative) {
    try { await Preferences.set({ key, value }); } catch { /* ignore */ }
  }
}

/** Remove from both stores. */
export async function prefRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
  if (isNative) {
    try { await Preferences.remove({ key }); } catch { /* ignore */ }
  }
}
