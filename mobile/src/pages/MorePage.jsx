/**
 * MorePage.jsx — Hub for settings + info pages.
 * Sub-navigation: main list → About/Contact/Privacy/Terms sub-screens.
 */
import { useState } from 'react';
import { useReaderPrefs } from '../hooks/useReaderPrefs';
import AboutPage from './info/AboutPage';
import ContactPage from './info/ContactPage';
import PrivacyPage from './info/PrivacyPage';
import TermsPage from './info/TermsPage';
import './MorePage.css';

const THEMES = [
  { id: 'sepia', label: 'Sepia', bg: '#f5f0e8', fg: '#3a2a1a' },
  { id: 'day', label: 'Day', bg: '#ffffff', fg: '#1a1a1a' },
  { id: 'dim', label: 'Dim', bg: '#2a2a32', fg: '#d8d0c0' },
  { id: 'night', label: 'Night', bg: '#0d0e14', fg: '#e8d8c0' },
  { id: 'amoled', label: 'AMOLED', bg: '#000', fg: '#e0d8c8' },
];

const FONTS = [
  { id: 'serif', label: 'Serif' },
  { id: 'sans', label: 'Sans' },
  { id: 'dyslexic', label: 'Dyslexic' },
];

const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'tl', label: 'Tagalog' },
  { id: 'ceb', label: 'Cebuano' },
];

export default function MorePage() {
  const [subPage, setSubPage] = useState(null); // null | 'about' | 'contact' | 'privacy' | 'terms'
  const prefs = useReaderPrefs();

  if (subPage === 'about') return <AboutPage onBack={() => setSubPage(null)} />;
  if (subPage === 'contact') return <ContactPage onBack={() => setSubPage(null)} />;
  if (subPage === 'privacy') return <PrivacyPage onBack={() => setSubPage(null)} />;
  if (subPage === 'terms') return <TermsPage onBack={() => setSubPage(null)} />;

  return (
    <div className="more-page">
      <div className="more-scroll">
        <div className="more-header">
          <span className="more-header-title">More</span>
        </div>

        {/* Reading Preferences */}
        <div className="more-section-label">Reading Theme</div>
        <div className="more-theme-grid">
          {THEMES.map(t => (
            <button
              key={t.id}
              className={`more-theme-btn${prefs.theme === t.id ? ' more-theme-active' : ''}`}
              style={{ background: t.bg, color: t.fg }}
              onClick={() => prefs.setTheme(t.id)}
            >{t.label}</button>
          ))}
        </div>

        <div className="more-section-label">Font Size</div>
        <div className="more-font-row">
          <button className="more-font-btn" onClick={() => prefs.setFontSize(prefs.fontSize - 1)}>A−</button>
          <span className="more-font-value">{prefs.fontSize}px</span>
          <button className="more-font-btn" onClick={() => prefs.setFontSize(prefs.fontSize + 1)}>A+</button>
        </div>

        <div className="more-section-label">Font</div>
        <div className="more-segment">
          {FONTS.map(f => (
            <button
              key={f.id}
              className={`more-seg-btn${prefs.fontFamily === f.id ? ' more-seg-active' : ''}`}
              onClick={() => prefs.setFontFamily(f.id)}
            >{f.label}</button>
          ))}
        </div>

        <div className="more-section-label">Language</div>
        <div className="more-segment">
          {LANGUAGES.map(l => (
            <button
              key={l.id}
              className={`more-seg-btn${prefs.lang === l.id ? ' more-seg-active' : ''}`}
              onClick={() => prefs.setLang(l.id)}
            >{l.label}</button>
          ))}
        </div>

        {/* Info Links */}
        <div className="more-section-label" style={{ marginTop: 24 }}>Information</div>
        <div className="more-links">
          <button className="more-link" onClick={() => setSubPage('about')}>
            <span>ℹ️ About</span><span className="more-link-arrow">›</span>
          </button>
          <button className="more-link" onClick={() => setSubPage('contact')}>
            <span>✉️ Contact</span><span className="more-link-arrow">›</span>
          </button>
          <button className="more-link" onClick={() => setSubPage('privacy')}>
            <span>🔒 Privacy Policy</span><span className="more-link-arrow">›</span>
          </button>
          <button className="more-link" onClick={() => setSubPage('terms')}>
            <span>📄 Terms of Service</span><span className="more-link-arrow">›</span>
          </button>
        </div>

        <div className="more-footer-text">
          Sacred Scripture Projector (scicp)<br />
          Dagami Ward Dev
        </div>

        <div style={{ height: 80 }} />
      </div>
    </div>
  );
}
