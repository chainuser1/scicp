import { useState, useCallback, useRef, useEffect } from 'react';
import { addToast } from '../hooks/useToast';
import { useSocketEvent } from '../hooks/useSocket';
import socket, { SERVER_URL } from '../socket';
import QrScanner from '../components/QrScanner';
import PinModal from '../components/PinModal';
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

const BG_PRESETS = [
  { label: 'None', url: null },
  { label: 'NT Dark', url: 'https://www.churchofjesuschrist.org/imgs/b1a19c15b0a1fd4b274d6e3decde033329db53f2/full/1080%2C/0/default' },
  { label: 'NT Light', url: 'https://www.churchofjesuschrist.org/imgs/5a979a326ee432c192220903e9c48b5332409a34/full/1080%2C/0/default' },
  { label: 'OT Dark', url: 'https://www.churchofjesuschrist.org/imgs/850c3faf9ed39b2193c9280a929f73469094982c/full/1080%2C/0/default' },
  { label: 'OT Light', url: 'https://www.churchofjesuschrist.org/imgs/91a96141d4471eac93f6d58e7d6db42cd6fd4192/full/1080%2C/0/default' },
  { label: 'BoM Dark', url: 'https://www.churchofjesuschrist.org/imgs/bc303ddc99f44c59f8c3b0743367f2180c9e91ef/full/1080%2C/0/default' },
  { label: 'D&C Dark', url: 'https://www.churchofjesuschrist.org/imgs/d424eaa659d3102b717c1825b0e48388d689a966/full/1080%2C/0/default' },
];

const FONT_FAMILIES = [
  { label: 'Cormorant Garamond', value: "'Cormorant Garamond', Georgia, serif" },
  { label: 'Cinzel (Classic)', value: "'Cinzel', serif" },
  { label: 'EB Garamond', value: "'EB Garamond', Georgia, serif" },
  { label: 'Georgia', value: "Georgia, serif" },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Arial (Sans)', value: "Arial, Helvetica, sans-serif" },
  { label: 'OpenDyslexic', value: "OpenDyslexic, Arial, sans-serif" },
];

const THEMES = [
  { name: 'Classic Dark', bg: '#0a0a0f', text: '#f0ece4' },
  { name: 'Warm Parchment', bg: '#f5f0e8', text: '#2c2416' },
  { name: 'Ocean', bg: '#0d1b2a', text: '#e0e1dd' },
  { name: 'Forest', bg: '#1a2e1a', text: '#d4e4d4' },
  { name: 'Sunset', bg: '#2d1810', text: '#f5deb3' },
  { name: 'Midnight Blue', bg: '#0f1626', text: '#c8d6e5' },
];

const TRANSITIONS = [
  'Fade', 'Slide', 'Push', 'Zoom', 'Flip', 'Dissolve',
  'Iris', 'Wipe', 'Morph', 'None',
];

const LAYOUTS = [
  { label: 'Centered', value: 'centered' },
  { label: 'Lower Third', value: 'lower-third' },
];

export default function SettingsPage({ session }) {
  const {
    sessionId, sessionLabel, viewerCount,
    joinSession, leaveSession,
    isConnected, connectionState, error,
  } = session;

  const [joinId, setJoinId] = useState('');
  const [language, setLanguage] = useState('en');
  const [secondaryLanguage, setSecondaryLanguage] = useState('');
  const [pin, setPin] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [hasPinActive, setHasPinActive] = useState(false);
  const [fontSize, setFontSize] = useState(32);
  const [fontScale, setFontScale] = useState(1.0);
  const [fontFamily, setFontFamily] = useState(FONT_FAMILIES[0].value);
  const [activeBg, setActiveBg] = useState(0);
  const [customBgUrl, setCustomBgUrl] = useState('');
  const [transition, setTransition] = useState('Fade');
  const [layout, setLayout] = useState('centered');
  const [takeoverAlert, setTakeoverAlert] = useState(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);
  const qrCanvasRef = useRef(null);
  const leaveTimerRef = useRef(null);

  // Takeover alert
  useSocketEvent('presenter-takeover-attempt', (data) => {
    setTakeoverAlert(data);
    addToast('⚠️ Another presenter is trying to take over!', 'error');
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
    if (sessionId) {
      socket.emit('update-language', { sessionId, language: code });
      addToast(`Language: ${LANGUAGES.find(l => l.code === code)?.label}`, 'info');
    }
  };

  const handleSecondaryLanguage = (code) => {
    setSecondaryLanguage(code === secondaryLanguage ? '' : code);
    if (sessionId) {
      socket.emit('update-language', { sessionId, language, secondaryLanguage: code === secondaryLanguage ? null : code });
    }
  };

  const applyTheme = (theme, idx) => {
    if (sessionId) {
      const bgUrl = BG_PRESETS[activeBg]?.url || null;
      socket.emit('update-theme', {
        sessionId,
        theme: {
          backgroundColor: theme.bg,
          textColor: theme.text,
          name: theme.name,
          font_size: fontSize,
          font_scale: fontScale,
          font_family: fontFamily,
          transition,
          layout,
          ...(bgUrl && { backgroundImage: bgUrl }),
        },
      });
      addToast(`Theme: ${theme.name}`, 'info');
    }
  };

  const applyFont = () => {
    if (sessionId) {
      socket.emit('update-theme', {
        sessionId,
        theme: { font_size: fontSize, font_scale: fontScale, font_family: fontFamily },
      });
      addToast('Font updated', 'info');
    }
  };

  const applyBg = (idx) => {
    setActiveBg(idx);
    if (sessionId) {
      const url = BG_PRESETS[idx]?.url || null;
      socket.emit('update-theme', { sessionId, theme: { backgroundImage: url } });
      if (url) socket.emit('preload-background', { sessionId, background_url: url });
      addToast(`Background: ${BG_PRESETS[idx].label}`, 'info');
    }
  };

  const applyCustomBg = () => {
    const url = customBgUrl.trim();
    if (!url || !sessionId) return;
    socket.emit('update-theme', { sessionId, theme: { backgroundImage: url } });
    socket.emit('preload-background', { sessionId, background_url: url });
    addToast('Custom background applied', 'info');
  };

  const applyTransition = (t) => {
    setTransition(t);
    if (sessionId) {
      socket.emit('update-theme', { sessionId, theme: { transition: t } });
      addToast(`Transition: ${t}`, 'info');
    }
  };

  const applyLayout = (l) => {
    setLayout(l);
    if (sessionId) {
      socket.emit('update-theme', { sessionId, theme: { layout: l } });
      addToast(`Layout: ${l}`, 'info');
    }
  };

  // Generate QR code when session exists
  useEffect(() => {
    if (!sessionId || !qrCanvasRef.current) return;
    import('qrcode').then(QRCode => {
      const mod = QRCode.default || QRCode;
      mod.toCanvas(qrCanvasRef.current, `${SERVER_URL}/client?session=${sessionId}`, {
        width: 200,
        margin: 2,
        color: { dark: '#c9a84c', light: '#0a0a0f' },
      });
    }).catch(() => {});
  }, [sessionId]);

  return (
    <div className="settings-page scroll-area safe-bottom">
      {/* Takeover alert */}
      {takeoverAlert && (
        <div className="card takeover-alert">
          <p className="text-sm text-gold font-semibold">⚠️ Presenter Takeover Attempt</p>
          <p className="text-xs text-secondary">Another device is trying to control this session.</p>
          <button className="btn btn-sm btn-secondary" onClick={() => setTakeoverAlert(null)} style={{ marginTop: 8 }}>
            Dismiss
          </button>
        </div>
      )}

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
            <div className="settings-session-btns">
              <button className="btn btn-secondary btn-sm" onClick={() => setPinModalOpen(true)}>
                🔒 {hasPinActive ? 'Change PIN' : 'Set PIN'}
              </button>
              <button
                className={`btn btn-sm ${leaveConfirm ? 'btn-danger' : 'btn-secondary'}`}
                onClick={handleLeave}
              >
                {leaveConfirm ? 'Tap Again to Leave' : 'Leave Session'}
              </button>
            </div>
          </div>
        ) : (
          <div className="card">
            <p className="text-sm font-medium" style={{ marginBottom: 4 }}>Connect to a Client</p>
            <p className="text-xs text-dim" style={{ marginBottom: 10 }}>
              Scan the QR code on the TV/Client display, or enter the session ID shown on screen.
            </p>
            {error && (
              <p className="text-xs" style={{ color: 'var(--accent-red)', marginBottom: 8 }}>
                {error}
              </p>
            )}
            <div className="settings-join-btns" style={{ marginBottom: 8 }}>
              <button className="btn btn-primary" onClick={() => setScannerOpen(true)} style={{ flex: 1 }}>
                📷 Scan QR Code
              </button>
            </div>
            <p className="text-xs text-dim" style={{ textAlign: 'center', margin: '6px 0' }}>or enter manually</p>
            <input
              className="input"
              placeholder="Session ID from TV screen"
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
            <button className="btn btn-secondary" onClick={() => handleJoin()} style={{ width: '100%', marginTop: 8 }}>
              Join Session
            </button>
          </div>
        )}
      </section>

      {/* QR Code Pairing */}
      {sessionId && (
        <section className="settings-section">
          <h3 className="settings-label text-xs text-dim font-semibold">CONNECT TV</h3>
          <div className="card text-center">
            <p className="text-sm text-secondary" style={{ marginBottom: 12 }}>
              Scan this QR code on the TV app to connect:
            </p>
            <canvas ref={qrCanvasRef} className="qr-canvas-display" />
            <p className="text-xl font-bold text-gold" style={{ marginTop: 8 }}>{sessionId}</p>
            <p className="text-xs text-dim" style={{ marginTop: 4 }}>
              TV app will auto-connect as display client
            </p>
          </div>
        </section>
      )}

      {/* Language */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">PRIMARY LANGUAGE</h3>
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

      {/* Secondary Language */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">SECONDARY LANGUAGE (DUAL DISPLAY)</h3>
        <div className="settings-lang-grid">
          <button
            className={`btn btn-sm ${!secondaryLanguage ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => handleSecondaryLanguage('')}
          >
            None
          </button>
          {LANGUAGES.filter(l => l.code !== language).map(lang => (
            <button
              key={lang.code}
              className={`btn btn-sm ${secondaryLanguage === lang.code ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => handleSecondaryLanguage(lang.code)}
            >
              {lang.label}
            </button>
          ))}
        </div>
      </section>

      {/* Theme */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">DISPLAY THEME</h3>
        <ThemePicker sessionId={sessionId} onApply={applyTheme} />
      </section>

      {/* Transition */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">TRANSITION</h3>
        <div className="settings-lang-grid">
          {TRANSITIONS.map(t => (
            <button
              key={t}
              className={`btn btn-sm ${transition === t ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => applyTransition(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </section>

      {/* Layout */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">LAYOUT</h3>
        <div className="settings-lang-grid">
          {LAYOUTS.map(l => (
            <button
              key={l.value}
              className={`btn btn-sm ${layout === l.value ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => applyLayout(l.value)}
            >
              {l.label}
            </button>
          ))}
        </div>
      </section>

      {/* Background */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">BACKGROUND IMAGE</h3>
        <div className="bg-grid">
          {BG_PRESETS.map((bg, i) => (
            <button
              key={i}
              className={`bg-swatch ${activeBg === i ? 'bg-active' : ''}`}
              onClick={() => applyBg(i)}
            >
              {bg.url ? (
                <img src={bg.url} alt={bg.label} className="bg-thumb" loading="lazy" />
              ) : (
                <span className="text-xs text-dim">None</span>
              )}
              <span className="text-xs bg-label">{bg.label}</span>
            </button>
          ))}
        </div>
        {/* Custom background URL */}
        <div className="custom-bg-row" style={{ marginTop: 8 }}>
          <input
            className="input"
            placeholder="Custom background URL…"
            value={customBgUrl}
            onChange={e => setCustomBgUrl(e.target.value)}
            style={{ flex: 1 }}
          />
          <button className="btn btn-secondary btn-sm" onClick={applyCustomBg}>Apply</button>
        </div>
      </section>

      {/* Font */}
      <section className="settings-section">
        <h3 className="settings-label text-xs text-dim font-semibold">FONT</h3>
        <div className="card">
          <label className="text-xs text-dim">Family</label>
          <div className="font-grid">
            {FONT_FAMILIES.map((f, i) => (
              <button
                key={i}
                className={`btn btn-sm ${fontFamily === f.value ? 'btn-primary' : 'btn-secondary'}`}
                style={{ fontFamily: f.value }}
                onClick={() => setFontFamily(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <label className="text-xs text-dim" style={{ marginTop: 12, display: 'block' }}>
            Size: {fontSize}px
          </label>
          <input
            type="range"
            min="18"
            max="72"
            value={fontSize}
            onChange={e => setFontSize(Number(e.target.value))}
            className="font-slider"
          />
          <label className="text-xs text-dim" style={{ marginTop: 8, display: 'block' }}>
            Scale: {fontScale.toFixed(1)}×
          </label>
          <input
            type="range"
            min="0.5"
            max="2.0"
            step="0.1"
            value={fontScale}
            onChange={e => setFontScale(Number(e.target.value))}
            className="font-slider"
          />
          <button className="btn btn-secondary btn-sm" onClick={applyFont} style={{ marginTop: 8, width: '100%' }}>
            Apply Font
          </button>
        </div>
      </section>

      <div style={{ height: 32 }} />

      {/* Modals */}
      {scannerOpen && (
        <QrScanner
          onCode={handleScannedCode}
          onClose={() => setScannerOpen(false)}
        />
      )}
      {pinModalOpen && (
        <PinModal
          sessionId={sessionId}
          hasPinActive={hasPinActive}
          onPinChanged={setHasPinActive}
          onClose={() => setPinModalOpen(false)}
        />
      )}
    </div>
  );
}

function ThemePicker({ sessionId, onApply }) {
  const [active, setActive] = useState(0);

  const apply = (theme, idx) => {
    setActive(idx);
    onApply?.(theme, idx);
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
