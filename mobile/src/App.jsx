import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { ExternalDisplay } from 'capacitor-external-display';
import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { SplashScreen } from '@capacitor/splash-screen';
import { socket as localSocket, isDisplayAvailable } from './socket-local';
import { socket as remoteSocket } from './socket-remote';
import { initAllDatabases } from './db-manager';
import { requestNotificationPermission } from './notify';
import SocketCtx from './socket-context';
import MobilePresenter from './pages/MobilePresenter.jsx';
import ScriptureReader from './pages/ScriptureReader.jsx';

const MODE_KEY  = 'scicp.conn_mode';    // 'offline' | 'online'
const URL_KEY   = 'scicp.server_url';
// M35: @capacitor/preferences is not installed in this project. localStorage is used
// intentionally — Capacitor 4+ wraps localStorage natively on Android/iOS, so no
// migration is needed.

// Upgrade http:// to https:// for non-local hosts (tunnels/proxies strip TLS)
function ensureHttps(origin) {
  if (!origin) return origin;
  try {
    const u = new URL(origin);
    const host = u.hostname;
    if (u.protocol === 'http:' && host !== 'localhost' && !host.startsWith('127.') && !host.startsWith('192.168.') && !host.startsWith('10.')) {
      u.protocol = 'https:';
      return u.origin;
    }
  } catch { /* ignore */ }
  return origin;
}

export default function App() {
  const [mode, setMode]           = useState(() => localStorage.getItem(MODE_KEY) || null);
  const [ready, setReady]         = useState(false);
  const [error, setError]         = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(URL_KEY) || 'https://cap-teyyko.live');
  const [scannerOpen, setScannerOpen] = useState(false);
  // Hot mode-switch: shows an overlay *over* MobilePresenter without unmounting it
  const [modeSwitchOpen, setModeSwitchOpen] = useState(false);
  const [networkStatus, setNetworkStatus] = useState('online');
  const [startupChecks, setStartupChecks] = useState({ camera: 'checking', cast: 'checking', online: 'checking' });
  const [checksBusy, setChecksBusy] = useState(false);
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const rafRef     = useRef(null);
  const streamRef  = useRef(null);
  const scanActiveRef = useRef(false);
  const switchToOnlineRef = useRef(null);

  // ── Offline init ──
  useEffect(() => {
    if (mode !== 'offline') return;
    localSocket.init()
      .then(() => setReady(true))
      .catch(err => {
        console.error('Failed to initialize databases:', err);
        setError(err.message || 'Failed to load scripture databases.');
      });
  }, [mode]);

  // ── Reader mode init (DBs only, no socket) ──
  useEffect(() => {
    if (mode !== 'reader') return;
    initAllDatabases()
      .then(() => setReady(true))
      .catch(err => setError(err.message || 'Failed to load scripture databases.'));
  }, [mode]);

  // ── Always load local DBs so context modals work in any mode ──
  useEffect(() => {
    initAllDatabases().catch(err => console.warn('[scicp] DB pre-init:', err.message || err));
  }, []);

  // ── QR scanner ──
  const stopCamera = useCallback(() => {
    scanActiveRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startScanner = useCallback(() => {
    (async () => {
      // Request camera permission natively before opening the scanner
      try {
        const perm = await ExternalDisplay.checkCameraPermission();
        if (perm.status === 'denied') {
          // Permanently denied — open app settings directly
          setError('Camera permission is blocked. Opening app settings so you can enable it.');
          await ExternalDisplay.openAppSettings();
          return;
        }
        if (perm.status !== 'granted') {
          const req = await ExternalDisplay.requestCameraPermission();
          if (req.status !== 'granted') {
            setError('Camera permission is required for QR scanning. Tap "Allow Camera" to grant it.');
            return;
          }
        }
      } catch { /* web fallback — proceed with getUserMedia */ }

      setScannerOpen(true);
      scanActiveRef.current = true;
      let jsQR;
      try {
        const mod = await import('jsqr');
        jsQR = mod.default || mod;
      } catch {
        setError('QR scanner not available');
        setScannerOpen(false);
        return;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        setScannerOpen(false);
        scanActiveRef.current = false;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Camera access was denied. To use the QR scanner, open your device Settings → Apps → Scriptures in View → Permissions and enable Camera.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError('Could not start camera: ' + (err.message || err.name));
        }
        return;
      }

      if (!scanActiveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }

      const tick = () => {
        if (!scanActiveRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            // Extract server URL + session code from the QR URL
            try {
              const url = new URL(code.data);
              const session = url.searchParams.get('session');
              if (session && session.length >= 4) {
                const origin = ensureHttps(url.origin);
                stopCamera();
                setScannerOpen(false);
                switchToOnlineRef.current(origin, session.toUpperCase());
                return;
              }
            } catch {
              // Not a valid URL — try bare session code
              const bare = code.data.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
              if (bare.length >= 4 && serverUrl) {
                stopCamera();
                setScannerOpen(false);
                switchToOnlineRef.current(serverUrl, bare);
                return;
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    })();
  }, [serverUrl, stopCamera]);

  // ── Switch mode (hot — keeps MobilePresenter mounted) ──
  const requestModeSwitch = useCallback(() => {
    setModeSwitchOpen(true);
    setError(null);
  }, []);

  const switchToOffline = useCallback(async () => {
    setModeSwitchOpen(false);
    setConnecting(true);
    try {
      // Ensure local DBs are initialised (no-op if already done)
      await localSocket.init();
      remoteSocket.destroy();
      localStorage.setItem(MODE_KEY, 'offline');
      setMode('offline');
      setReady(true);
    } catch (err) {
      setError('Failed to load local databases: ' + (err.message || err));
    } finally {
      setConnecting(false);
    }
  }, []);

  const switchToOnline = useCallback(async (url, sessionCode) => {
    setModeSwitchOpen(false);
    setConnecting(true);
    setError(null);
    const cleanUrl = (url || serverUrl).replace(/\/+$/, '');
    try {
      await remoteSocket.init(cleanUrl);
      // Also init local databases so context modals (summaries, footnotes, entities) work
      initAllDatabases().catch(err => console.warn('[scicp] DB pre-init:', err.message || err));
      localStorage.setItem(MODE_KEY, 'online');
      localStorage.setItem(URL_KEY, cleanUrl);
      setServerUrl(cleanUrl);
      setMode('online');
      setReady(true);
      if (sessionCode) sessionStorage.setItem('scicp.pending_session', sessionCode);
    } catch (err) {
      setError(`Failed to connect to ${cleanUrl}: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  }, [serverUrl]);
  switchToOnlineRef.current = switchToOnline;

  const runStartupChecks = useCallback(async () => {
    setChecksBusy(true);
    try {
      let camera = 'unknown';
      try {
        const result = await ExternalDisplay.checkCameraPermission();
        camera = result.status === 'granted' ? 'ok' : result.status === 'denied' ? 'blocked' : 'pending';
      } catch {
        camera = 'unknown';
      }

      let cast = 'unavailable';
      try {
        cast = (await isDisplayAvailable()) ? 'ok' : 'pending';
      } catch {
        cast = 'unavailable';
      }

      let online = 'offline';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        const base = String(serverUrl || '').replace(/\/+$/, '');
        if (base) {
          const res = await fetch(`${base}/health`, { signal: controller.signal });
          online = res.ok ? 'ok' : 'offline';
        }
        clearTimeout(timer);
      } catch {
        online = 'offline';
      }

      setStartupChecks({ camera, cast, online });

      // Pre-request notification permission (for download progress notifications)
      requestNotificationPermission().catch(err => console.warn('[scicp] Notification permission:', err.message || err));
    } finally {
      setChecksBusy(false);
    }
  }, [serverUrl]);

  useEffect(() => {
    if (!mode && !ready) runStartupChecks();
  }, [mode, ready, runStartupChecks]);

  // Re-check permissions when app resumes (e.g. returning from Android Settings)
  useEffect(() => {
    const listener = CapApp.addListener('appStateChange', ({ isActive }) => {
      if (isActive) runStartupChecks();
    });
    return () => { listener.then(l => l.remove()); };
  }, [runStartupChecks]);

  // ── Android back button handler (H15) ──
  useEffect(() => {
    const handler = CapApp.addListener('backButton', ({ canGoBack }) => {
      if (scannerOpen) {
        setScannerOpen(false);
        stopCamera();
        return;
      }
      if (modeSwitchOpen) {
        setModeSwitchOpen(false);
        return;
      }
      if (mode && ready) {
        setMode(null);
        setReady(false);
        return;
      }
      CapApp.minimizeApp();
    });
    return () => { handler.then(h => h.remove()).catch(err => console.warn('[scicp] back button cleanup:', err.message || err)); };
  }, [scannerOpen, modeSwitchOpen, mode, ready, stopCamera]);

  // ── Network state monitoring (H16) ──
  useEffect(() => {
    let listener;
    Network.getStatus().then(s => setNetworkStatus(s.connected ? 'online' : 'offline')).catch(() => {});
    Network.addListener('networkStatusChange', (status) => {
      setNetworkStatus(status.connected ? 'online' : 'offline');
      if (status.connected && mode === 'online' && remoteSocket && !remoteSocket.connected) {
        remoteSocket.connect();
      }
    }).then(l => { listener = l; }).catch(() => {});
    return () => { if (listener) listener.remove(); };
  }, [mode]);

  // ── Splash screen hide (H17) ──
  useEffect(() => {
    SplashScreen.hide().catch(() => {});
  }, []);

  const requestCameraPermission = useCallback(async () => {
    try {
      // Check if already permanently denied
      const check = await ExternalDisplay.checkCameraPermission();
      if (check.status === 'denied') {
        // Permanently denied — must open app settings
        await ExternalDisplay.openAppSettings();
        // Re-check after user returns from settings
        setTimeout(() => runStartupChecks(), 1500);
        return;
      }
      const result = await ExternalDisplay.requestCameraPermission();
      if (result.status !== 'granted') {
        // User denied — open app settings as fallback
        await ExternalDisplay.openAppSettings();
        setTimeout(() => runStartupChecks(), 1500);
      }
    } catch (err) {
      setError(`Camera check failed: ${err?.message || err}`);
    } finally {
      runStartupChecks();
    }
  }, [runStartupChecks]);

  const openCastSetup = useCallback(async () => {
    try { await ExternalDisplay.openCastSettings(); } catch { /* ignore */ }
    setTimeout(() => { runStartupChecks(); }, 1200);
  }, [runStartupChecks]);

  // Context value
  const ctxValue = React.useMemo(() => ({
    socket: mode === 'online' ? remoteSocket : localSocket,
    mode: mode || 'offline',
    serverUrl,
    switchMode: requestModeSwitch,
    switchToOffline,
    switchToOnline,
    isOnline: mode === 'online',
  }), [mode, serverUrl, requestModeSwitch, switchToOffline, switchToOnline]);

  // ── Mode-switch scanner (reuses the same QR flow but calls switchToOnline) ──
  const startModeSwitchScanner = useCallback(() => {
    setModeSwitchOpen(false);
    setScannerOpen(true);
    scanActiveRef.current = true;

    (async () => {
      // Request camera permission natively before opening the scanner
      try {
        const perm = await ExternalDisplay.checkCameraPermission();
        if (perm.status === 'denied') {
          setError('Camera permission is blocked. Opening app settings so you can enable it.');
          await ExternalDisplay.openAppSettings();
          setScannerOpen(false);
          return;
        }
        if (perm.status !== 'granted') {
          const req = await ExternalDisplay.requestCameraPermission();
          if (req.status !== 'granted') {
            setError('Camera permission is required for QR scanning. Tap "Allow Camera" to grant it.');
            setScannerOpen(false);
            return;
          }
        }
      } catch { /* web fallback — proceed with getUserMedia */ }

      let jsQR;
      try {
        const mod = await import('jsqr');
        jsQR = mod.default || mod;
      } catch {
        setError('QR scanner not available');
        setScannerOpen(false);
        return;
      }

      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
      } catch (err) {
        setScannerOpen(false);
        scanActiveRef.current = false;
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Camera access was denied. Open Settings → Apps → Scriptures in View → Permissions and enable Camera.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          setError('No camera found on this device.');
        } else {
          setError('Could not start camera: ' + (err.message || err.name));
        }
        return;
      }

      if (!scanActiveRef.current) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play(); }

      const tick = () => {
        if (!scanActiveRef.current) return;
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video && video.readyState === video.HAVE_ENOUGH_DATA && canvas) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
          if (code?.data) {
            try {
              const url = new URL(code.data);
              const session = url.searchParams.get('session');
              if (session && session.length >= 4) {
                stopCamera();
                setScannerOpen(false);
                switchToOnlineRef.current(ensureHttps(url.origin), session.toUpperCase());
                return;
              }
            } catch {
              const bare = code.data.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
              if (bare.length >= 4 && serverUrl) {
                stopCamera();
                setScannerOpen(false);
                switchToOnlineRef.current(serverUrl, bare);
                return;
              }
            }
          }
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    })();
  }, [serverUrl, stopCamera]);

  // ── Already initialized — show presenter + overlays (not reader mode) ──
  if (ready && mode && mode !== 'reader') {
    return (
      <SocketCtx.Provider value={ctxValue}>
        {networkStatus === 'offline' && (
          <div className="network-offline-banner" role="alert">No internet connection</div>
        )}
        <MobilePresenter />
        {/* Mode-switch overlay — floats above MobilePresenter without unmounting it */}
        {modeSwitchOpen && (
          <div className="mode-screen mode-screen--overlay">
            <button className="mode-overlay-close" onClick={() => setModeSwitchOpen(false)}>✕</button>
            <div className="mode-logo">📖</div>
            <h1 className="mode-title">Switch Mode</h1>
            <p className="mode-subtitle">Your live verse and settings will carry over</p>
            {error && <p style={{ color: '#e85050', fontSize: '0.85rem', textAlign: 'center', padding: '0 1rem' }}>{error}</p>}
            <div className="mode-cards">
              <button className={`mode-card${mode === 'offline' ? ' mode-card--active' : ''}`}
                disabled={connecting}
                onClick={mode === 'offline' ? () => setModeSwitchOpen(false) : switchToOffline}>
                <span className="mode-card-icon">📱</span>
                <span className="mode-card-label">Offline Mode{mode === 'offline' ? ' ✓' : ''}</span>
                <span className="mode-card-desc">Self-contained — search & present from this device.</span>
              </button>
              <button className={`mode-card mode-card--online${mode === 'online' ? ' mode-card--active' : ''}`}
                disabled={connecting}
                onClick={startModeSwitchScanner}>
                <span className="mode-card-icon">📷</span>
                <span className="mode-card-label">Online Mode{mode === 'online' ? ' ✓' : ''}</span>
                <span className="mode-card-desc">Scan QR code to connect to a TV session.</span>
              </button>
            </div>
            {/* Manual URL entry for online */}
            <details className="mode-manual">
              <summary>Enter server URL manually</summary>
              <select className="mode-url-input" style={{ marginBottom: 8 }}
                onChange={e => { if (e.target.value) setServerUrl(e.target.value); }} value={serverUrl}>
                <option value="https://cap-teyyko.live">cap-teyyko.live (Primary)</option>
                <option value="https://backend-production-9a27.up.railway.app">Railway (backend-production-9a27)</option>
                <option value="">Custom URL…</option>
              </select>
              <div className="mode-manual-form">
                <input type="url" placeholder="https://your-server.com" value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)} className="mode-url-input" />
                <button className="mode-connect-btn" disabled={connecting || !serverUrl.trim()}
                  onClick={() => switchToOnline(serverUrl)}>
                  {connecting ? 'Connecting…' : 'Connect'}
                </button>
              </div>
            </details>
          </div>
        )}
        {/* QR Scanner overlay (mode-switch or initial) */}
        {scannerOpen && (
          <div className="mode-screen mode-screen--overlay">
            <div className="qr-scan-overlay">
              <div className="qr-scan-header">
                <span>📷 Scan TV QR Code</span>
                <button onClick={() => { stopCamera(); setScannerOpen(false); setModeSwitchOpen(true); }} className="qr-scan-close">✕</button>
              </div>
              <div className="qr-scan-viewport">
                <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12 }} />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <div className="qr-scan-reticle"><span /><span /><span /><span /></div>
              </div>
              <p className="qr-scan-hint">Point your camera at the QR code on the TV screen</p>
            </div>
          </div>
        )}
      </SocketCtx.Provider>
    );
  }

  // ── Error state (before first init) ──
  if (error && !scannerOpen) {
    return (
      <div style={{ padding: 24, color: '#c9a84c', background: '#0a0a0f', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <h2>⚠️ Error</h2>
        <p>{error}</p>
        <button onClick={() => { setError(null); setMode(null); }}
          style={{ marginTop: 16, padding: '10px 24px', background: '#c9a84c', color: '#0a0a0f', border: 'none', borderRadius: 8, fontSize: '1rem', cursor: 'pointer' }}>
          Try Again
        </button>
      </div>
    );
  }

  // ── QR Scanner overlay ──
  if (scannerOpen) {
    return (
      <div className="mode-screen">
        <div className="qr-scan-overlay">
          <div className="qr-scan-header">
            <span>📷 Scan TV QR Code</span>
            <button onClick={() => { stopCamera(); setScannerOpen(false); }} className="qr-scan-close">✕</button>
          </div>
          <div className="qr-scan-viewport">
            <video ref={videoRef} playsInline muted style={{ width: '100%', borderRadius: 12 }} />
            <canvas ref={canvasRef} style={{ display: 'none' }} />
            <div className="qr-scan-reticle"><span /><span /><span /><span /></div>
          </div>
          <p className="qr-scan-hint">Point your camera at the QR code on the TV screen</p>
        </div>
      </div>
    );
  }

  // ── Connecting overlay (after QR scan or manual connect) ──
  if (connecting) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0a0a0f', color: '#c9a84c', fontFamily: 'sans-serif', gap: 16 }}>
        <div className="lang-download-toast-spinner" style={{ width: 32, height: 32, borderWidth: 3 }} />
        <p style={{ fontSize: '1.1rem', margin: 0 }}>Connecting to server…</p>
        <p style={{ fontSize: '0.8rem', color: '#888', margin: 0 }}>{serverUrl}</p>
      </div>
    );
  }

  // ── Loading (offline/reader init) ──
  if ((mode === 'offline' || mode === 'reader') && !ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0a0a0f', color: '#c9a84c', fontFamily: 'sans-serif' }}>
        <p>Loading scriptures...</p>
      </div>
    );
  }

  // ── Reader mode ──
  if (mode === 'reader' && ready) {
    return <ScriptureReader onExit={() => { setMode(null); setReady(false); try { localStorage.removeItem('scicp.conn_mode'); } catch {} }} />;
  }

  // ── Mode selection screen ──
  return (
    <div className="mode-screen">
      {networkStatus === 'offline' && (
        <div className="network-offline-banner" role="alert">No internet connection</div>
      )}
      <div className="mode-logo">📖</div>
      <h1 className="mode-title">Scriptures in View</h1>
      <p className="mode-subtitle">Choose how to present</p>

      <div className="mode-cards">
        <button className="mode-card" onClick={() => setMode('offline')}>
          <span className="mode-card-icon">📱</span>
          <span className="mode-card-label">Offline Mode</span>
          <span className="mode-card-desc">Self-contained — search & present from this device. Cast to a connected display.</span>
        </button>

        <button className="mode-card mode-card--online" onClick={startScanner}>
          <span className="mode-card-icon">📷</span>
          <span className="mode-card-label">Scan TV QR Code</span>
          <span className="mode-card-desc">Scan the QR code on the TV to connect and present remotely over the internet.</span>
        </button>

        <button className="mode-card mode-card--reader" onClick={() => { try { localStorage.setItem(MODE_KEY, 'reader'); } catch {} setMode('reader'); }}>
          <span className="mode-card-icon">📖</span>
          <span className="mode-card-label">Read Scriptures</span>
          <span className="mode-card-desc">Personal reading — search, browse by book and chapter, adjust font size. No screen required.</span>
        </button>
      </div>

      {/* Manual URL entry (expandable) */}
      <details className="mode-manual">
        <summary>Enter server URL manually</summary>
        <select
          className="mode-url-input"
          style={{ marginBottom: 8 }}
          onChange={e => { if (e.target.value) setServerUrl(e.target.value); }}
          value={serverUrl}
        >
          <option value="https://cap-teyyko.live">cap-teyyko.live (Primary)</option>
          <option value="https://backend-production-9a27.up.railway.app">Railway (backend-production-9a27)</option>
          <option value="">Custom URL…</option>
        </select>
        <div className="mode-manual-form">
          <input
            type="url"
            placeholder="https://your-server.com"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            className="mode-url-input"
          />
          <button
            className="mode-connect-btn"
            disabled={connecting || !serverUrl.trim()}
            onClick={() => switchToOnline(serverUrl)}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </details>
      <div className="startup-readiness">
        <div className="startup-readiness-title">Permissions &amp; Connectivity</div>
        <div className="startup-readiness-row">
          <span>📷 Camera (QR)</span>
          <span className={`startup-badge startup-badge--${startupChecks.camera}`}>{startupChecks.camera}</span>
        </div>
        <div className="startup-readiness-row">
          <span>📺 Cast display</span>
          <span className={`startup-badge startup-badge--${startupChecks.cast}`}>{startupChecks.cast}</span>
        </div>
        <div className="startup-readiness-row">
          <span>🌐 Server reachability</span>
          <span className={`startup-badge startup-badge--${startupChecks.online}`}>{startupChecks.online}</span>
        </div>
        <div className="startup-readiness-actions">
          <button className="mode-connect-btn" onClick={requestCameraPermission}>
            {startupChecks.camera === 'blocked' ? 'Open Settings' : startupChecks.camera === 'ok' ? '✓ Camera OK' : 'Allow Camera'}
          </button>
          <button className="mode-connect-btn" onClick={openCastSetup}>Open Cast Setup</button>
          <button className="mode-connect-btn" onClick={runStartupChecks} disabled={checksBusy}>{checksBusy ? 'Checking…' : 'Refresh'}</button>
        </div>
      </div>
    </div>
  );
}
