import React, { useEffect, useState, useCallback, createContext, useContext, useRef } from 'react';
import { socket as localSocket } from './socket-local';
import { socket as remoteSocket } from './socket-remote';
import MobilePresenter from './pages/MobilePresenter.jsx';

// ── Socket context — provides the active socket + mode to all children ──
const SocketCtx = createContext(null);
export function useSocketCtx() { return useContext(SocketCtx); }

const MODE_KEY  = 'scicp.conn_mode';    // 'offline' | 'online'
const URL_KEY   = 'scicp.server_url';

export default function App() {
  const [mode, setMode]           = useState(() => localStorage.getItem(MODE_KEY) || null);
  const [ready, setReady]         = useState(false);
  const [error, setError]         = useState(null);
  const [connecting, setConnecting] = useState(false);
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem(URL_KEY) || '');
  const [scannerOpen, setScannerOpen] = useState(false);
  const videoRef   = useRef(null);
  const canvasRef  = useRef(null);
  const rafRef     = useRef(null);
  const streamRef  = useRef(null);
  const scanActiveRef = useRef(false);

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

  // ── QR scanner ──
  const stopCamera = useCallback(() => {
    scanActiveRef.current = false;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  }, []);

  const startScanner = useCallback(() => {
    setScannerOpen(true);
    scanActiveRef.current = true;

    (async () => {
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
      } catch {
        setError('Camera access denied');
        setScannerOpen(false);
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
                const origin = url.origin;
                stopCamera();
                setScannerOpen(false);
                connectOnline(origin, session.toUpperCase());
                return;
              }
            } catch {
              // Not a valid URL — try bare session code
              const bare = code.data.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 24);
              if (bare.length >= 4 && serverUrl) {
                stopCamera();
                setScannerOpen(false);
                connectOnline(serverUrl, bare);
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

  // ── Online connect ──
  const connectOnline = useCallback(async (url, sessionCode) => {
    setConnecting(true);
    setError(null);
    const cleanUrl = url.replace(/\/+$/, '');
    try {
      await remoteSocket.init(cleanUrl);
      localStorage.setItem(MODE_KEY, 'online');
      localStorage.setItem(URL_KEY, cleanUrl);
      setServerUrl(cleanUrl);
      setMode('online');
      setReady(true);
      // Store session code for MobilePresenter to auto-join
      if (sessionCode) sessionStorage.setItem('scicp.pending_session', sessionCode);
    } catch (err) {
      setError(`Failed to connect to ${cleanUrl}: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  }, []);

  // ── Switch back to mode selection ──
  const switchMode = useCallback(() => {
    remoteSocket.destroy();
    setReady(false);
    setMode(null);
    setError(null);
    localStorage.removeItem(MODE_KEY);
  }, []);

  // Context value
  const ctxValue = React.useMemo(() => ({
    socket: mode === 'online' ? remoteSocket : localSocket,
    mode: mode || 'offline',
    serverUrl,
    switchMode,
    isOnline: mode === 'online',
  }), [mode, serverUrl, switchMode]);

  // ── Already initialized — show presenter ──
  if (ready && mode) {
    return (
      <SocketCtx.Provider value={ctxValue}>
        <MobilePresenter />
      </SocketCtx.Provider>
    );
  }

  // ── Error state ──
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

  // ── Loading (offline init) ──
  if (mode === 'offline' && !ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0a0a0f', color: '#c9a84c', fontFamily: 'sans-serif' }}>
        <p>Loading scriptures...</p>
      </div>
    );
  }

  // ── Mode selection screen ──
  return (
    <div className="mode-screen">
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
      </div>

      {/* Manual URL entry (expandable) */}
      <details className="mode-manual">
        <summary>Enter server URL manually</summary>
        <div className="mode-manual-form">
          <input
            type="url"
            placeholder="https://cap-teyyko.live"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            className="mode-url-input"
          />
          <button
            className="mode-connect-btn"
            disabled={connecting || !serverUrl.trim()}
            onClick={() => connectOnline(serverUrl)}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      </details>
    </div>
  );
}
