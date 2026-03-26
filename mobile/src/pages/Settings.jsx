import { useState, useCallback } from 'react';
import { addToast } from '../hooks/useToast';
import socket, { SERVER_URL } from '../socket';
import './Settings.css';

const LANGUAGES = [
  { code: 'en', label: 'English (KJV)' },
  { code: 'nrsvue', label: 'English (NRSVUE)' },
  { code: 'es', label: 'Español' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ceb', label: 'Cebuano' },
  { code: 'ilo', label: 'Ilocano' },
  { code: 'war', label: 'Waray' },
  { code: 'el', label: 'Greek' },
  { code: 'ja', label: '日本語' },
];

export default function SettingsPage({ session }) {
  const {
    sessionId, sessionLabel, viewerCount,
    createSession, joinSession, leaveSession,
    isConnected, connectionState,
  } = session;

  const [joinId, setJoinId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [language, setLanguage] = useState('en');
  const [pin, setPin] = useState('');

  const handleCreate = () => {
    createSession(newLabel.trim() || undefined);
    setNewLabel('');
  };

  const handleJoin = () => {
    if (!joinId.trim()) return;
    joinSession(joinId.trim(), pin ? { pin } : {});
    setJoinId('');
    setPin('');
  };

  const handleLanguage = (code) => {
    setLanguage(code);
    if (sessionId) {
      socket.emit('update-language', { sessionId, language: code });
      addToast(`Language: ${LANGUAGES.find(l => l.code === code)?.label}`, 'info');
    }
  };

  return (
    <div className="settings-page scroll-area safe-bottom">
      {/* Connection Status */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">CONNECTION</h3>
        <div className="card settings-status-card">
          <div className="settings-status-row">
            <span className={`status-dot ${connectionState}`} />
            <span>{isConnected ? 'Connected to server' : 'Disconnected'}</span>
          </div>
          <p className="text-xs text-dim">{SERVER_URL}</p>
        </div>
      </section>

      {/* Session */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">SESSION</h3>
        {sessionId ? (
          <div className="card">
            <div className="settings-session-info">
              <p className="font-semibold text-gold">{sessionLabel || sessionId}</p>
              <p className="text-xs text-dim">Session ID: {sessionId}</p>
              {viewerCount > 0 && (
                <p className="text-sm">👁 {viewerCount} viewer{viewerCount !== 1 ? 's' : ''}</p>
              )}
            </div>
            <button className="btn btn-danger btn-sm" onClick={leaveSession} style={{ marginTop: 12 }}>
              Leave Session
            </button>
          </div>
        ) : (
          <div className="settings-session-actions">
            <div className="card">
              <p className="text-sm font-medium" style={{ marginBottom: 8 }}>Create New Session</p>
              <input
                className="input"
                placeholder="Session label (optional)"
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
              />
              <button className="btn btn-primary" onClick={handleCreate} style={{ marginTop: 8, width: '100%' }}>
                Create Session
              </button>
            </div>
            <div className="card">
              <p className="text-sm font-medium" style={{ marginBottom: 8 }}>Join Existing</p>
              <input
                className="input"
                placeholder="Session ID"
                value={joinId}
                onChange={e => setJoinId(e.target.value)}
                style={{ marginBottom: 6 }}
              />
              <input
                className="input"
                type="password"
                placeholder="PIN (if required)"
                value={pin}
                onChange={e => setPin(e.target.value)}
              />
              <button className="btn btn-secondary" onClick={handleJoin} style={{ marginTop: 8, width: '100%' }}>
                Join Session
              </button>
            </div>
          </div>
        )}
      </section>

      {/* QR Code Pairing */}
      {sessionId && (
        <section className="settings-section">
          <h3 className="settings-label text-xs text-dim font-semibold">CONNECT TV</h3>
          <div className="card text-center">
            <p className="text-sm text-secondary" style={{ marginBottom: 8 }}>
              On the TV app, scan this QR code or enter session ID:
            </p>
            <p className="text-xl font-bold text-gold">{sessionId}</p>
            <p className="text-xs text-dim" style={{ marginTop: 4 }}>
              TV app will auto-connect as display client
            </p>
          </div>
        </section>
      )}

      {/* Language */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">LANGUAGE</h3>
        <div className="settings-lang-grid">
          {LANGUAGES.map(lang => (
            <button
              key={lang.code}
              className={`btn btn-sm ${language === lang.code ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleLanguage(lang.code)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </section>

      {/* Theme */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">DISPLAY THEME</h3>
        <ThemePicker sessionId={sessionId} />
      </section>

      <div style={{ height: 32 }} />
    </div>
  );
}

const THEMES = [
  { name: 'Classic Dark', bg: '#0a0a0f', text: '#f0ece4' },
  { name: 'Warm Parchment', bg: '#f5f0e8', text: '#2c2416' },
  { name: 'Ocean', bg: '#0d1b2a', text: '#e0e1dd' },
  { name: 'Forest', bg: '#1a2e1a', text: '#d4e4d4' },
  { name: 'Sunset', bg: '#2d1810', text: '#f5deb3' },
  { name: 'Midnight Blue', bg: '#0f1626', text: '#c8d6e5' },
];

function ThemePicker({ sessionId }) {
  const [active, setActive] = useState(0);

  const apply = (theme, idx) => {
    setActive(idx);
    if (sessionId) {
      socket.emit('update-theme', {
        sessionId,
        theme: { backgroundColor: theme.bg, textColor: theme.text, name: theme.name },
      });
      addToast(`Theme: ${theme.name}`, 'info');
    }
  };

  return (
    <div className="theme-grid">
      {THEMES.map((t, i) => (
        <button
          key={i}
          className={`theme-swatch ${active === i ? 'theme-active' : ''}`}
          style={{ background: t.bg, color: t.text, borderColor: active === i ? 'var(--gold)' : 'var(--surface-3)' }}
          onClick={() => apply(t, i)}
        >
          <span className="text-xs font-medium">{t.name}</span>
        </button>
      ))}
    </div>
  );
}
