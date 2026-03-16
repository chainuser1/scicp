/**
 * CastingControl.jsx — "Cast to display" button with status indicator.
 *
 * Detects external displays, starts/stops presentation, and shows
 * connection status. Used in the MobilePresenter header.
 *
 * HOW CASTING WORKS:
 *   The plugin uses Android's DISPLAY_CATEGORY_PRESENTATION API, which only
 *   sees displays that Android has already connected at the OS level.
 *   Steps: Android quick settings → Cast/Screen Cast → select your receiver
 *   (AirServer, Miracast TV, Chromecast, etc.) → then tap Cast here.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ExternalDisplay } from 'capacitor-external-display';
import { startCasting, stopCasting, isDisplayAvailable, isCasting } from '../socket-local';

const IconCast = ({ active }) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={active ? '#c9a84c' : 'currentColor'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
    <line x1="2" y1="20" x2="2.01" y2="20"/>
  </svg>
);

export default function CastingControl({ className = '', label = '' }) {
  const [available, setAvailable] = useState(false);
  const [casting, setCasting] = useState(false);
  const [showHint, setShowHint] = useState(false);

  // Poll for display availability
  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const avail = await isDisplayAvailable();
      if (mounted) setAvailable(avail);
    };
    check();

    // Poll every 2s so we catch displays connected before component mounts
    // and handle devices where the event fires before CATEGORY_PRESENTATION is ready.
    const pollInterval = setInterval(check, 2000);

    // Listen for connect/disconnect events from native
    const onConnect = ExternalDisplay.addListener('displayConnected', () => {
      if (mounted) { setAvailable(true); setShowHint(false); }
    });
    const onDisconnect = ExternalDisplay.addListener('displayDisconnected', () => {
      if (mounted) {
        setAvailable(false);
        setCasting(false);
      }
    });

    return () => {
      mounted = false;
      clearInterval(pollInterval);
      onConnect.then(h => h.remove()).catch(() => {});
      onDisconnect.then(h => h.remove()).catch(() => {});
    };
  }, []);

  const handleToggle = useCallback(async () => {
    if (casting) {
      await stopCasting();
      setCasting(false);
      return;
    }
    if (!available) {
      // Show setup hint instead of silently doing nothing
      setShowHint(h => !h);
      return;
    }
    setShowHint(false);
    // Capacitor Android serves the app at http://localhost
    const base = window.location.origin.replace('capacitor://', 'http://');
    const clientUrl = `${base}/client-display.html`;
    const success = await startCasting(clientUrl);
    if (success) {
      setCasting(true);
    } else {
      // Display was detected but presentation failed — re-check availability
      setAvailable(false);
      setShowHint(true);
    }
  }, [casting, available]);

  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        className={`hdr-btn${casting ? ' hdr-btn--active' : ''}${className ? ` ${className}` : ''}`}
        onClick={handleToggle}
        aria-label={casting ? 'Stop casting' : available ? 'Cast to display' : 'Cast setup'}
        title={casting ? 'Stop casting' : available ? 'Cast to display' : 'Tap for cast setup instructions'}
        style={{ opacity: available || casting ? 1 : 0.55, position: 'relative' }}
      >
        <IconCast active={casting} />
        {label && <span>{label}</span>}
        {casting && <span className="hdr-badge" style={{ background: '#c9a84c', width: 6, height: 6, borderRadius: '50%', position: 'absolute', top: 4, right: 4 }} />}
      </button>

      {showHint && !casting && (
        <div className="cast-hint-popover" role="dialog" aria-label="Cast setup instructions">
          <button className="cast-hint-close" onClick={() => setShowHint(false)} aria-label="Dismiss">✕</button>
          <p className="cast-hint-title">📡 How to Cast</p>
          <ol className="cast-hint-steps">
            <li>Swipe down twice → tap <strong>"Cast"</strong> or <strong>"Screen Cast"</strong></li>
            <li>Select your TV or <strong>AirServer</strong> from the list</li>
            <li>Wait for the connection to establish (a few seconds)</li>
            <li>Return here — the Cast button turns gold when ready</li>
            <li>Tap Cast → scripture shows on the TV</li>
          </ol>
          <p className="cast-hint-note">Works with Miracast TVs and AirServer. The button polls every 2 seconds — it will activate automatically once connected.</p>
        </div>
      )}
    </div>
  );
}
