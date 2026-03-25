/**
 * ConnectTV.jsx — "Connect TV" popover for all non-HDMI/AirPlay casting paths.
 *
 * Three scenarios, auto-detected:
 *
 *   A. Online  — Share session URL to TV browser. TV opens the web client,
 *                enters the session code, and joins instantly.
 *
 *   B. Local Wi-Fi (no internet) — Phone runs NanoHTTPD local server on :8080.
 *                TV browser navigates to phone's LAN IP. No internet needed.
 *
 *   C. Phone hotspot — Same as B but the TV connects to the phone's own hotspot.
 *                Phone IP is always 192.168.43.1 (Android) or 172.20.10.1 (iOS).
 *
 * The component picks the right path automatically and shows the clearest
 * possible instruction for the AV team / worship leader.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';

const IconTV = ({ size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <polyline points="8 21 12 17 16 21" />
  </svg>
);
const IconCopy = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);
const IconCheck = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 20 4 14" />
  </svg>
);

/**
 * @param {object} props
 * @param {boolean}     props.isOnline     - app is connected to a remote server
 * @param {string|null} props.serverUrl    - e.g. "https://scriptures-inview.app"
 * @param {string}      props.sessionId    - current session code ("LOCAL" when offline)
 * @param {string|null} props.lanServerUrl - local HTTP server URL if running
 * @param {string}      [props.className]
 */
export default function ConnectTV({ isOnline, serverUrl, sessionId, lanServerUrl, className = '' }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(null); // 'url' | 'code' | null
  const popRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (popRef.current && !popRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const copyText = useCallback(async (text, key) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback: execCommand for older WebViews
      try {
        const el = document.createElement('textarea');
        el.value = text; el.style.position = 'fixed'; el.style.opacity = '0';
        document.body.appendChild(el); el.select();
        document.execCommand('copy');
        document.body.removeChild(el);
      } catch { /* ignore */ }
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  // Determine scenario
  const onlineSessionReady = isOnline && sessionId && sessionId !== 'LOCAL';
  const hasLan = !!lanServerUrl;

  // Build the web client URL for online scenario
  const clientPageUrl = (() => {
    if (!onlineSessionReady) return null;
    const base = (serverUrl || '').replace(/\/+$/, '');
    return base ? `${base}/client` : null;
  })();

  const scenario = onlineSessionReady ? 'online' : hasLan ? 'lan' : 'hotspot';

  const ScenarioOnline = () => (
    <div className="ctv-scenario">
      <p className="ctv-scenario-title">📡 Online — TV joins via web browser</p>
      <ol className="ctv-steps">
        <li>On the TV, open any browser and go to:</li>
      </ol>
      <div className="ctv-url-row">
        <span className="ctv-url-text">{clientPageUrl}</span>
        <button className="ctv-copy-btn" onClick={() => copyText(clientPageUrl, 'url')}
          aria-label="Copy URL">
          {copied === 'url' ? <IconCheck /> : <IconCopy />}
        </button>
      </div>
      <ol className="ctv-steps" start={2}>
        <li>Enter the session code:</li>
      </ol>
      <div className="ctv-code-row">
        <span className="ctv-code-text">{sessionId}</span>
        <button className="ctv-copy-btn" onClick={() => copyText(sessionId, 'code')}
          aria-label="Copy session code">
          {copied === 'code' ? <IconCheck /> : <IconCopy />}
        </button>
      </div>
      <p className="ctv-note">Works on any Smart TV, Roku, Fire TV, webOS, Tizen — anything with a browser.</p>
    </div>
  );

  const ScenarioLan = () => (
    <div className="ctv-scenario">
      <p className="ctv-scenario-title">🌐 Local Wi-Fi — TV joins on same network</p>
      <ol className="ctv-steps">
        <li>Make sure the TV is on the <strong>same Wi-Fi</strong> as this phone</li>
        <li>On the TV, open any browser and go to:</li>
      </ol>
      <div className="ctv-url-row">
        <span className="ctv-url-text">{lanServerUrl}</span>
        <button className="ctv-copy-btn" onClick={() => copyText(lanServerUrl, 'url')}
          aria-label="Copy URL">
          {copied === 'url' ? <IconCheck /> : <IconCopy />}
        </button>
      </div>
      <p className="ctv-note">No internet needed. Works on any Smart TV browser (Samsung, LG, Sony, Roku, Fire TV).</p>
    </div>
  );

  const ScenarioHotspot = () => (
    <div className="ctv-scenario">
      <p className="ctv-scenario-title">📶 Phone Hotspot — no Wi-Fi needed</p>
      <ol className="ctv-steps">
        <li>Turn on <strong>Mobile Hotspot</strong> on this phone</li>
        <li>Connect the TV to your phone's hotspot Wi-Fi</li>
        <li>On the TV browser, go to one of these addresses:</li>
      </ol>
      <div className="ctv-url-row">
        <span className="ctv-url-text">192.168.43.1:8080</span>
        <button className="ctv-copy-btn" onClick={() => copyText('192.168.43.1:8080', 'url')}
          aria-label="Copy URL">
          {copied === 'url' ? <IconCheck /> : <IconCopy />}
        </button>
      </div>
      <p className="ctv-note-alt">iOS hotspot: try <code>172.20.10.1:8080</code></p>
      <p className="ctv-note">
        No internet or Wi-Fi router needed.{' '}
        {!hasLan && <span className="ctv-warn">⚠ Start the local server first by going online or tapping the Cast button.</span>}
      </p>
    </div>
  );

  return (
    <div className={`ctv-wrap${className ? ` ${className}` : ''}`} ref={popRef}>
      <button
        className={`ctv-btn${open ? ' ctv-btn--active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Connect TV"
        title="Connect a TV or Smart Display"
      >
        <IconTV size={17} />
        <span className="ctv-btn-label">TV</span>
      </button>

      {open && (
        <div className="ctv-popover" role="dialog" aria-label="Connect TV">
          <div className="ctv-header">
            <span className="ctv-header-title">Connect a TV</span>
            <button className="ctv-close" onClick={() => setOpen(false)} aria-label="Close">✕</button>
          </div>

          {/* Scenario tabs when multiple are available */}
          {(onlineSessionReady || hasLan) && (
            <div className="ctv-tabs">
              {onlineSessionReady && (
                <span className="ctv-tab ctv-tab--active">Online</span>
              )}
              {hasLan && (
                <span className={`ctv-tab${!onlineSessionReady ? ' ctv-tab--active' : ''}`}>Wi-Fi</span>
              )}
              {!hasLan && !onlineSessionReady && (
                <span className="ctv-tab ctv-tab--active">Hotspot</span>
              )}
            </div>
          )}

          {scenario === 'online' && <ScenarioOnline />}
          {scenario === 'lan' && <ScenarioLan />}
          {scenario === 'hotspot' && <ScenarioHotspot />}

          {/* Always show hotspot as fallback tip when other options exist */}
          {scenario !== 'hotspot' && (
            <details className="ctv-fallback">
              <summary>No Wi-Fi? Use phone hotspot instead</summary>
              <ScenarioHotspot />
            </details>
          )}
        </div>
      )}
    </div>
  );
}
