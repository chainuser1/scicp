/**
 * ReaderMore.jsx — Settings: mode switch, theme, font, language, about.
 */
import { useState } from 'react';

const THEMES = [
  { id: 'sepia', label: 'Sepia', bg: '#f5f0e8', fg: '#3a2a1a' },
  { id: 'day', label: 'Day', bg: '#ffffff', fg: '#1a1a1a' },
  { id: 'dim', label: 'Dim', bg: '#2a2a32', fg: '#d8d0c0' },
  { id: 'night', label: 'Night', bg: '#0d0e14', fg: '#e8d8c0' },
  { id: 'amoled', label: 'AMOLED', bg: '#000000', fg: '#e0d8c8' },
];

const FONTS = [
  { id: 'serif', label: 'Serif' },
  { id: 'sans', label: 'Sans' },
  { id: 'dyslexic', label: 'Dyslexic' },
];

const LINE_HEIGHTS = [
  { id: 'compact', label: 'Compact' },
  { id: 'comfortable', label: 'Comfortable' },
  { id: 'relaxed', label: 'Relaxed' },
];

const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'tl', label: 'Tagalog' },
  { id: 'ceb', label: 'Cebuano' },
];

export default function ReaderMore({ prefs, onSwitchMode }) {
  return (
    <div className="rd-scroll">
      <div className="rd-header">
        <span className="rd-header-title">Settings</span>
      </div>

      <div style={{ padding: '0 16px' }}>
        {/* Switch to Presenter */}
        <div className="rd-section-label">Mode</div>
        <button
          style={{
            width: '100%', padding: '14px 16px', borderRadius: 10,
            background: 'var(--rd-surface)', border: '1px solid var(--rd-border)',
            color: 'var(--rd-fg)', fontSize: '0.9375rem', fontWeight: 600,
            textAlign: 'left', marginBottom: 16,
          }}
          onClick={onSwitchMode}
        >
          🎙️ Switch to Presenter Mode
        </button>

        {/* Theme */}
        <div className="rd-section-label">Reading Theme</div>
        <div className="rd-theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`rd-theme-btn${prefs.theme === t.id ? ' rd-theme-btn-active' : ''}`}
              style={{ background: t.bg, color: t.fg }}
              onClick={() => prefs.setTheme(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Font Size */}
        <div className="rd-section-label">Font Size</div>
        <div className="rd-font-slider">
          <button className="rd-font-slider-btn" onClick={() => prefs.setFontSize(prefs.fontSize - 1)}>A−</button>
          <span className="rd-font-slider-value">{prefs.fontSize}px</span>
          <button className="rd-font-slider-btn" onClick={() => prefs.setFontSize(prefs.fontSize + 1)}>A+</button>
        </div>

        {/* Font Family */}
        <div className="rd-section-label">Font</div>
        <div className="rd-segment" style={{ margin: '0 0 16px' }}>
          {FONTS.map(f => (
            <button
              key={f.id}
              className={`rd-segment-btn${prefs.fontFamily === f.id ? ' rd-segment-btn-active' : ''}`}
              onClick={() => prefs.setFontFamily(f.id)}
            >{f.label}</button>
          ))}
        </div>

        {/* Line Height */}
        <div className="rd-section-label">Line Spacing</div>
        <div className="rd-segment" style={{ margin: '0 0 16px' }}>
          {LINE_HEIGHTS.map(l => (
            <button
              key={l.id}
              className={`rd-segment-btn${prefs.lineHeight === l.id ? ' rd-segment-btn-active' : ''}`}
              onClick={() => prefs.setLineHeight(l.id)}
            >{l.label}</button>
          ))}
        </div>

        {/* Language */}
        <div className="rd-section-label">Language</div>
        <div className="rd-segment" style={{ margin: '0 0 16px' }}>
          {LANGUAGES.map(l => (
            <button
              key={l.id}
              className={`rd-segment-btn${prefs.lang === l.id ? ' rd-segment-btn-active' : ''}`}
              onClick={() => prefs.setLang(l.id)}
            >{l.label}</button>
          ))}
        </div>

        {/* About */}
        <div className="rd-section-label">About</div>
        <div style={{ padding: '8px 0 32px', fontSize: '0.8125rem', color: 'var(--rd-dim)', lineHeight: 1.5 }}>
          Sacred Scripture Projector (scicp)<br />
          Personal Scripture Study & Worship Presentation
        </div>
      </div>

      <div style={{ height: 80 }} />
    </div>
  );
}
