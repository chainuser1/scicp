/**
 * useReaderPrefs.js — Persisted reading preferences.
 * Theme, fontSize, lineHeight, fontFamily, language.
 */
import { useState, useCallback } from 'react';

const SK = {
  theme: 'scicp_rd_theme',
  fontSize: 'scicp_rd_fontsize',
  lineHeight: 'scicp_rd_lineheight',
  fontFamily: 'scicp_rd_fontfamily',
  lang: 'scicp_rd_lang',
  lastRead: 'scicp_rd_lastread',
};

function load(key, fallback) {
  try { const v = localStorage.getItem(key); return v !== null ? JSON.parse(v) : fallback; }
  catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* full */ }
}

export function useReaderPrefs() {
  const [theme, _setTheme] = useState(() => load(SK.theme, 'sepia'));
  const [fontSize, _setFontSize] = useState(() => load(SK.fontSize, 18));
  const [lineHeight, _setLineHeight] = useState(() => load(SK.lineHeight, 'comfortable'));
  const [fontFamily, _setFontFamily] = useState(() => load(SK.fontFamily, 'serif'));
  const [lang, _setLang] = useState(() => load(SK.lang, 'en'));
  const [lastRead, _setLastRead] = useState(() => load(SK.lastRead, null));

  const setTheme = useCallback((v) => { _setTheme(v); save(SK.theme, v); }, []);
  const setFontSize = useCallback((v) => {
    const clamped = Math.max(14, Math.min(28, v));
    _setFontSize(clamped); save(SK.fontSize, clamped);
  }, []);
  const setLineHeight = useCallback((v) => { _setLineHeight(v); save(SK.lineHeight, v); }, []);
  const setFontFamily = useCallback((v) => { _setFontFamily(v); save(SK.fontFamily, v); }, []);
  const setLang = useCallback((v) => { _setLang(v); save(SK.lang, v); }, []);
  const setLastRead = useCallback((v) => { _setLastRead(v); save(SK.lastRead, v); }, []);

  const LINE_HEIGHT_MAP = { compact: 1.55, comfortable: 1.85, relaxed: 2.2 };
  const lineHeightValue = LINE_HEIGHT_MAP[lineHeight] || 1.85;

  return {
    theme, setTheme,
    fontSize, setFontSize,
    lineHeight, setLineHeight, lineHeightValue,
    fontFamily, setFontFamily,
    lang, setLang,
    lastRead, setLastRead,
  };
}
