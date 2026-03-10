/**
 * CastingControl.jsx — "Cast to display" button with status indicator.
 *
 * Detects external displays, starts/stops presentation, and shows
 * connection status. Used in the MobilePresenter header.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { ExternalDisplay } from '../../plugins/capacitor-external-display/src/index.js';
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

  // Poll for display availability
  useEffect(() => {
    let mounted = true;

    const check = async () => {
      const avail = await isDisplayAvailable();
      if (mounted) setAvailable(avail);
    };
    check();

    // Listen for connect/disconnect events from native
    const onConnect = ExternalDisplay.addListener('displayConnected', () => {
      if (mounted) setAvailable(true);
    });
    const onDisconnect = ExternalDisplay.addListener('displayDisconnected', () => {
      if (mounted) {
        setAvailable(false);
        setCasting(false);
      }
    });

    return () => {
      mounted = false;
      onConnect.then(h => h.remove()).catch(() => {});
      onDisconnect.then(h => h.remove()).catch(() => {});
    };
  }, []);

  const handleToggle = useCallback(async () => {
    if (casting) {
      await stopCasting();
      setCasting(false);
    } else {
      // Build the client-display URL relative to the app's own origin
      const base = window.location.origin;
      const clientUrl = `${base}/client-display.html`;
      const success = await startCasting(clientUrl);
      setCasting(success);
    }
  }, [casting]);

  return (
    <button
      className={`hdr-btn${casting ? ' hdr-btn--active' : ''}${className ? ` ${className}` : ''}`}
      onClick={handleToggle}
      disabled={!available && !casting}
      aria-label={casting ? 'Stop casting' : 'Cast to display'}
      title={
        casting
          ? 'Stop casting'
          : available
            ? 'Cast to display'
            : 'No external display detected'
      }
      style={{ opacity: available || casting ? 1 : 0.4 }}
    >
      <IconCast active={casting} />
      {label && <span>{label}</span>}
      {casting && <span className="hdr-badge" style={{ background: '#c9a84c', width: 6, height: 6, borderRadius: '50%', position: 'absolute', top: 4, right: 4 }} />}
    </button>
  );
}
