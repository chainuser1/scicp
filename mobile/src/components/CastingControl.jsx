/**
 * CastingControl.jsx — Prominent "Cast to display" button with status.
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

const IconCast = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 16.1A5 5 0 0 1 5.9 20M2 12.05A9 9 0 0 1 9.95 20M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6"/>
    <line x1="2" y1="20" x2="2.01" y2="20"/>
  </svg>
);

export default function CastingControl({ className = '', compact = false }) {
  const [available, setAvailable] = useState(false);
  const [casting, setCasting] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const getClientUrl = () => {
    const base = window.location.origin.replace('capacitor://', 'http://');
    return `${base}/client-display.html`;
  };

  // Poll for display availability
  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const avail = await isDisplayAvailable(getClientUrl());
      if (mounted) setAvailable(avail);
    };
    check();

    const pollInterval = setInterval(check, 2000);

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
      setShowHint(h => !h);
      return;
    }
    setShowHint(false);
    const clientUrl = getClientUrl();
    const success = await startCasting(clientUrl);
    if (success) {
      setCasting(true);
    } else {
      setAvailable(false);
      setShowHint(true);
    }
  }, [casting, available]);

  const stateClass = casting ? 'cast-btn--active' : available ? 'cast-btn--ready' : '';
  const compactClass = compact ? ' cast-btn--compact' : '';

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
            {casting ? 'Casting' : 'Cast'}
          </span>
        )}
        {casting && <span className="cast-btn-dot" />}
      </button>

      {showHint && !casting && (
        <div className="cast-hint-popover" role="dialog" aria-label="Cast setup instructions">
          <button className="cast-hint-close" onClick={() => setShowHint(false)} aria-label="Dismiss">✕</button>
          <p className="cast-hint-title">📡 How to Cast</p>
          <ol className="cast-hint-steps">
            <li>Swipe down twice → tap <strong>"Cast"</strong> or <strong>"Screen Cast"</strong></li>
            <li>Select your TV or <strong>AirServer</strong> from the list</li>
            <li>Wait for the connection to establish</li>
            <li>Return here — the Cast button turns gold when ready</li>
            <li>Tap Cast → scripture shows on the TV</li>
          </ol>
          <p className="cast-hint-note">Works with Miracast TVs and AirServer. Polls every 2 seconds — activates automatically once connected.</p>
        </div>
      )}
    </div>
  );
}
