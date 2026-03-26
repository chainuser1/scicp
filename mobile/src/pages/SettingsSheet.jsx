/**
 * SettingsSheet.jsx — Slide-up overlay for settings.
 * Accessed via ⋯ menu in header, NOT a bottom tab.
 * Contains: session management, theme, transitions, layout, background, font, language.
 */
import { useState, useCallback, useRef, useEffect } from 'react';
import { addToast } from '../hooks/useToast';
import { useSocketEvent } from '../hooks/useSocket';
import socket, { SERVER_URL } from '../socket';
import QrScanner from '../components/QrScanner';
import PinModal from '../components/PinModal';
import './SettingsSheet.css';

const LANGUAGES = [
  { code: 'en', label: 'English (KJV)' },
  { code: 'nrsvue', label: 'NRSVUE' },
  { code: 'es', label: 'Español' },
  { code: 'tl', label: 'Tagalog' },
  { code: 'ceb', label: 'Cebuano' },
  { code: 'ilo', label: 'Ilocano' },
  { code: 'war', label: 'Waray' },
  { code: 'el', label: 'Greek' },
  { code: 'ja', label: '日本語' },
];

const TRANSITIONS = ['Fade', 'Slide', 'Push', 'Zoom', 'Morph', 'Wipe', 'Split', 'Scroll', 'Black', 'Cut'];
const LAYOUTS = ['Centered', 'Lower Third'];
const BG_COLORS = ['#0a0a0f', '#0d1b2a', '#1a2e1a', '#2d1810', '#f5f0e8', '#0f1626'];

export default function SettingsSheet({ session, onClose }) {
  const {
    sessionId, viewerCount, joinSession, leaveSession,
    isConnected, connectionState, error,
  } = session;

  const [joinId, setJoinId] = useState('');
  const [pin, setPin] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [language, setLanguage] = useState(() => localStorage.getItem('scicp_language') || 'en');
  const [transition, setTransition] = useState('Fade');
  const [layout, setLayout] = useState('Centered');
  const [activeBg, setActiveBg] = useState(0);
  const [customBgUrl, setCustomBgUrl] = useState('');
  const [fontScale, setFontScale] = useState(1.0);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const leaveTimerRef = useRef(null);

  useSocketEvent('presenter-takeover-attempt', () => {
    addToast('⚠️ Another presenter trying to take over!', 'error');
  });

  const handleJoin = (id) => {
    const sid = (id || joinId).trim();
    if (!sid) return;
    joinSession(sid, pin ? { pin } : {});
    setJoinId('');
    setPin('');
  };

  const handleLeave = () => {
    if (!leaveConfirm) {
      setLeaveConfirm(true);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = setTimeout(() => setLeaveConfirm(false), 3000);
      return;
    }
    setLeaveConfirm(false);
    leaveSession();
  };

  const handleScannedCode = (code) => {
    setScannerOpen(false);
    handleJoin(code);
    addToast(`Joining session: ${code}`, 'info');
  };

  const handleLanguage = (code) => {
    setLanguage(code);
    localStorage.setItem('scicp_language', code);
    if (sessionId) socket.emit('update-language', { sessionId, language: code });
  };

  const emitTheme = (partial) => {
    if (sessionId) socket.emit('update-theme', { sessionId, theme: partial });
  };

  const handleTransition = (t) => { setTransition(t); emitTheme({ transition: t }); };
  const handleLayout = (l) => { setLayout(l); emitTheme({ layout: l.toLowerCase().replace(' ', '-') }); };
  const handleBgColor = (i) => { setActiveBg(i); emitTheme({ backgroundColor: BG_COLORS[i] }); };
  const handleCustomBg = () => {
    if (!customBgUrl.trim()) return;
    emitTheme({ backgroundImage: customBgUrl.trim() });
    if (sessionId) socket.emit('preload-background', { sessionId, background_url: customBgUrl.trim() });
    addToast('Background applied', 'info');
  };
  const handleFontScale = (delta) => {
    const next = Math.max(0.5, Math.min(2.0, +(fontScale + delta).toFixed(2)));
    setFontScale(next);
    emitTheme({ font_scale: next });
  };

  return (
    <>
      <div className="settings-overlay" onClick={onClose} />
      <div className="settings-sheet">
        <div className="settings-sheet-handle" />

        {/* ── Session ── */}
        <section className="ss-section">
          <h3 className="ss-label">SESSION</h3>
          {sessionId ? (
            <div className="ss-session-active">
              <div className="ss-session-row">
                <span className="ss-session-code">{sessionId}</span>
                <span className="ss-viewer-count">👁 {viewerCount}</span>
              </div>
              <button
                className={`ss-btn ${leaveConfirm ? 'ss-btn-danger' : 'ss-btn-secondary'}`}
                onClick={handleLeave}
              >
                {leaveConfirm ? 'Tap Again to Leave' : 'Leave Session'}
              </button>
            </div>
          ) : (
            <div className="ss-session-join">
              <div className="ss-join-row">
                <input
                  className="ss-input"
                  placeholder="Session code"
                  value={joinId}
                  onChange={e => setJoinId(e.target.value.toUpperCase())}
                  maxLength={24}
                />
                <button className="ss-btn ss-btn-primary" onClick={() => handleJoin()}>Join</button>
              </div>
              <button className="ss-scan-btn" onClick={() => setScannerOpen(true)}>
                ⊞ Scan QR Code
              </button>
            </div>
          )}
          {error && <p className="ss-error">{error}</p>}
        </section>

        {/* ── Language ── */}
        <section className="ss-section">
          <h3 className="ss-label">LANGUAGE</h3>
          <div className="ss-pill-row">
            {LANGUAGES.map(l => (
              <button
                key={l.code}
                className={`ss-pill ${language === l.code ? 'ss-pill-active' : ''}`}
                onClick={() => handleLanguage(l.code)}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>

        {/* ── Transition ── */}
        <section className="ss-section">
          <h3 className="ss-label">TRANSITION</h3>
          <div className="ss-pill-grid">
            {TRANSITIONS.map(t => (
              <button
                key={t}
                className={`ss-pill ${transition === t ? 'ss-pill-active' : ''}`}
                onClick={() => handleTransition(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* ── Layout ── */}
        <section className="ss-section">
          <h3 className="ss-label">LAYOUT</h3>
          <div className="ss-layout-row">
            {LAYOUTS.map(l => (
              <button
                key={l}
                className={`ss-layout-btn ${layout === l ? 'ss-layout-active' : ''}`}
                onClick={() => handleLayout(l)}
              >
                {l}
              </button>
            ))}
          </div>
        </section>

        {/* ── Background ── */}
        <section className="ss-section">
          <h3 className="ss-label">BACKGROUND</h3>
          <div className="ss-color-swatches">
            {BG_COLORS.map((c, i) => (
              <button
                key={c}
                className={`ss-swatch ${activeBg === i ? 'ss-swatch-active' : ''}`}
                style={{ background: c }}
                onClick={() => handleBgColor(i)}
              />
            ))}
          </div>
          <div className="ss-custom-bg-row">
            <input
              className="ss-input ss-input-sm"
              placeholder="Custom image URL"
              value={customBgUrl}
              onChange={e => setCustomBgUrl(e.target.value)}
            />
            <button className="ss-btn ss-btn-secondary ss-btn-sm" onClick={handleCustomBg}>Apply</button>
          </div>
        </section>

        {/* ── Text & Font ── */}
        <section className="ss-section">
          <h3 className="ss-label">TEXT & FONT</h3>
          <div className="ss-font-row">
            <button className="ss-font-btn" onClick={() => handleFontScale(-0.1)}>−</button>
            <span className="ss-font-value">{fontScale.toFixed(2)}×</span>
            <button className="ss-font-btn" onClick={() => handleFontScale(0.1)}>+</button>
          </div>
          <p className="ss-font-name">Cormorant Garamond (Sacred)</p>
          <div className="ss-auto-advance-row">
            <span className="ss-auto-label">Auto-advance</span>
            <button
              className={`ss-pill ${autoAdvance ? 'ss-pill-active' : ''}`}
              onClick={() => setAutoAdvance(!autoAdvance)}
            >
              {autoAdvance ? '5s' : 'Off'}
            </button>
          </div>
        </section>

        {/* ── Connection ── */}
        <section className="ss-section">
          <h3 className="ss-label">CONNECTION</h3>
          <div className="ss-connection-row">
            <span className={`status-dot ${connectionState}`} />
            <span className="ss-conn-text">
              {isConnected ? 'Connected' : connectionState === 'connecting' ? 'Reconnecting…' : 'Offline'}
            </span>
          </div>
        </section>

        <button className="ss-close-btn" onClick={onClose}>Close</button>
      </div>

      {scannerOpen && (
        <QrScanner onScan={handleScannedCode} onClose={() => setScannerOpen(false)} />
      )}
      {pinModalOpen && (
        <PinModal onClose={() => setPinModalOpen(false)} sessionId={sessionId} />
      )}
    </>
  );
}
