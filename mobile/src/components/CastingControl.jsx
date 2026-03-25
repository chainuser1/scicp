/**
 * CastingControl.jsx — Prominent "Cast to display" button with status.
 *
 * Detects external displays, starts/stops presentation, and shows
 * connection status. Used in the MobilePresenter header.
 *
 * HOW CASTING WORKS:
 *   The plugin uses Android's DISPLAY_CATEGORY_PRESENTATION API, which only
 *   sees displays that Android has already connected at the OS level.
 *   Android: quick settings → Cast/Screen Cast → select your receiver → tap Cast here.
 *   iOS: tap here → AirPlay picker appears → select Apple TV or AirPlay TV.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { ExternalDisplay } from 'capacitor-external-display';
import { startCasting, stopCasting, isDisplayAvailable, isCasting, getDisplayName, onDisplayReady, setLastCastState } from '../socket-local';

const IconCast = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
    <line x1="2" y1="20" x2="2.01" y2="20"/>
  </svg>
);

const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);

export default function CastingControl({ className = '', compact = false, label = null, currentVerse, currentTheme }) {
  const [available, setAvailable] = useState(false);
  const [casting, setCasting] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [showHint, setShowHint] = useState(false);
  const pendingAutoStartRef = useRef(false);

  const getClientUrl = () => {
    if (window.Capacitor?.isNativePlatform?.()) {
      return 'http://localhost/client-display.html';
    }
    const href = window.location.href.replace(/^capacitor:\/\//, 'http://');
    return new URL('client-display.html', href).toString();
  };

  // Keep socket-local in sync with latest verse/theme for reconnect restore
  useEffect(() => {
    setLastCastState(currentVerse, currentTheme);
  }, [currentVerse, currentTheme]);

  // Poll for display availability + subscribe to plugin events
  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const avail = await isDisplayAvailable(getClientUrl());
      if (mounted) {
        setAvailable(avail);
        const name = getDisplayName();
        if (name) setDisplayName(name);
      }
    };
    setCasting(isCasting());
    check();

    const pollInterval = setInterval(check, 2000);

    // When display page finishes loading, re-send current state
    onDisplayReady(() => {
      if (!mounted) return;
      setReconnecting(false);
      window.dispatchEvent(new CustomEvent('scicp-cast-started'));
    });

    const onConnect = ExternalDisplay.addListener('displayConnected', async () => {
      if (!mounted) return;
      setAvailable(true);
      setShowHint(false);
      if (pendingAutoStartRef.current && !isCasting()) {
        const success = await startCasting(getClientUrl());
        if (success) {
          setCasting(true);
          pendingAutoStartRef.current = false;
        }
      }
    });
    const onDisconnect = ExternalDisplay.addListener('displayDisconnected', () => {
      if (mounted) {
        setAvailable(false);
        setReconnecting(true);
        // casting stays true while reconnect loop runs; will flip to false if all retries fail
        setTimeout(() => {
          if (!isCasting()) { setCasting(false); setReconnecting(false); }
        }, 8000); // 3 retries × 2s backoff ≈ 6-7s
      }
    });

    return () => {
      mounted = false;
      clearInterval(pollInterval);
      onConnect.then(h => h.remove()).catch(err => console.warn('[scicp]', err.message || err));
      onDisconnect.then(h => h.remove()).catch(err => console.warn('[scicp]', err.message || err));
    };
  }, []);

  const handleToggle = useCallback(async () => {
    if (casting) {
      await stopCasting();
      pendingAutoStartRef.current = false;
      setCasting(false);
      setReconnecting(false);
      return;
    }
    if (!available) {
      pendingAutoStartRef.current = true;
      try { await ExternalDisplay.openCastSettings(); } catch { /* ignore */ }
      if (!isIOS()) setShowHint(h => !h); // iOS shows AirPlay picker inline; no extra hint needed
      return;
    }
    setShowHint(false);
    const clientUrl = getClientUrl();
    const success = await startCasting(clientUrl);
    if (success) {
      setCasting(true);
      const name = getDisplayName();
      if (name) setDisplayName(name);
    } else {
      setAvailable(false);
      setShowHint(true);
    }
  }, [casting, available]);

  const stateClass = casting ? (reconnecting ? 'cast-btn--reconnecting' : 'cast-btn--active') : available ? 'cast-btn--ready' : '';
  const compactClass = compact ? ' cast-btn--compact' : '';
  const castLabel = casting
    ? (reconnecting ? 'Reconnecting…' : (displayName ? `Casting to ${displayName}` : 'Casting'))
    : 'Cast';

  return (
    <div className={`cast-wrap${className ? ` ${className}` : ''}`}>
      <button
        className={`cast-btn ${stateClass}${compactClass}`}
        onClick={handleToggle}
        aria-label={casting ? 'Stop casting' : available ? 'Cast to display' : 'Cast setup'}
        title={casting ? 'Tap to stop casting' : available ? 'Tap to cast to TV' : 'Tap for cast setup'}
      >
        <IconCast size={compact ? 16 : 18} />
        {!compact && (
          <span className="cast-btn-label">
            {label ?? castLabel}
          </span>
        )}
        {casting && !reconnecting && <span className="cast-btn-dot" />}
        {reconnecting && <span className="cast-btn-spinner" />}
      </button>

      {showHint && !casting && (
        <div className="cast-hint-popover" role="dialog" aria-label="Cast setup instructions">
          <button className="cast-hint-close" onClick={() => setShowHint(false)} aria-label="Dismiss">✕</button>
          <p className="cast-hint-title">📡 How to Cast</p>
          {isIOS() ? (
            <ol className="cast-hint-steps">
              <li>Tap <strong>Cast</strong> again — the AirPlay picker will open</li>
              <li>Select your <strong>Apple TV</strong> or AirPlay-compatible TV</li>
              <li>Return here — display will activate automatically</li>
            </ol>
          ) : (
            <ol className="cast-hint-steps">
              <li>Swipe down twice → tap <strong>"Cast"</strong> or <strong>"Screen Cast"</strong></li>
              <li>Select your TV or <strong>AirServer</strong> from the list</li>
              <li>Wait for the connection to establish</li>
              <li>Return here — casting will auto-start when display is detected</li>
            </ol>
          )}
          <p className="cast-hint-note">Works with Miracast TVs, HDMI, AirServer, and Apple TV. Auto-reconnects on disconnect.</p>
        </div>
      )}
    </div>
  );
}
