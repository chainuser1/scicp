import React, { useEffect, useMemo, useState } from 'react';
import Footer from '../components/Footer';

const DOWNLOAD_LINKS = [
  {
    label: 'Android (Offline App)',
    platform: 'android',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000059743/artifacts/5889562783',
    sha256: '11a670361a6426981391d5250895d06977a99b697480127ff1cd4b0c4463a604',
  },
  {
    label: 'Windows Installer',
    platform: 'windows',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889590639',
    sha256: '4feeb9e6620197a8a3136aabcbb9fd849f482a8f4afc254b390225a7327d6ddd',
  },
  {
    label: 'Linux Installer',
    platform: 'linux',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889616163',
    sha256: 'e6291127b52c1c3d025375361bb3e79544177da67a69c8552f9759a885b9c1b4',
  },
  {
    label: 'Mac Installer',
    platform: 'mac',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889569130',
    sha256: 'ec5d380ce6200833887d8d5c5ae8403644b9829d62d80265d44bcd20453f77b2',
  },
];

export default function Download() {
  const [geoState, setGeoState] = useState({ checking: true, allowed: false, reason: '' });
  const [accepted, setAccepted] = useState(false);

  useEffect(() => {
    document.title = 'Downloads | Scriptures in View';
    const metaDesc = document.querySelector('meta[name="description"]');
    const description = 'Download offline Scriptures in View apps for Android, Windows, Linux, and Mac. Non-commercial church and home use only.';
    if (metaDesc) metaDesc.setAttribute('content', description);
    else {
      const meta = document.createElement('meta');
      meta.name = 'description';
      meta.content = description;
      document.head.appendChild(meta);
    }
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'index,follow');
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', 'https://cap-teyyko.live/download');
  }, []);

  useEffect(() => {
    let active = true;
    const checkAccess = async () => {
      try {
        const res = await fetch('https://ipwho.is/?security=1');
        const data = await res.json();
        if (!active) return;
        if (!data?.success) {
          setGeoState({ checking: false, allowed: false, reason: 'Location check unavailable.' });
          return;
        }

        const country = String(data.country_code || '').toUpperCase();
        const vpnOrProxy = Boolean(data?.security?.vpn || data?.security?.proxy || data?.security?.tor);
        if (country !== 'PH') {
          setGeoState({ checking: false, allowed: false, reason: 'Downloads are available in the Philippines only.' });
          return;
        }
        if (vpnOrProxy) {
          setGeoState({ checking: false, allowed: false, reason: 'Please disable VPN/proxy to access downloads.' });
          return;
        }
        setGeoState({ checking: false, allowed: true, reason: '' });
      } catch {
        if (!active) return;
        setGeoState({ checking: false, allowed: false, reason: 'Unable to verify your location.' });
      }
    };
    checkAccess();
    return () => { active = false; };
  }, []);

  const gatedMessage = useMemo(() => {
    if (geoState.checking) return 'Verifying location and network integrity...';
    if (!geoState.allowed) return geoState.reason || 'Access restricted.';
    return '';
  }, [geoState]);

  return (
    <div className="home-page download-page">
      <main className="home-hero">
        <div className="home-emblem" aria-hidden="true">✦</div>
        <p className="home-eyebrow">Offline Installers</p>
        <h1 className="home-title">Sacred Deployment Downloads</h1>
        <div className="home-divider" />
        <p className="home-subtitle">
          Download offline builds for worship services and home scripture study.
        </p>

        {!geoState.allowed ? (
          <section className="download-gate">
            <h2>Restricted Access</h2>
            <p>{gatedMessage}</p>
          </section>
        ) : (
          <section className="download-panel">
            <h2>Usage Agreement</h2>
            <p className="download-agreement">
              By downloading, you agree to use this application in full compliance with all applicable laws and regulations,
              and only for non-commercial church and home use.
            </p>
            <label className="download-consent">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
              />
              <span>I understand and accept this responsibility and usage policy.</span>
            </label>

            <div className="download-grid">
              {DOWNLOAD_LINKS.map((item) => (
                <div key={item.platform} className="download-item">
                  <button
                    type="button"
                    className="download-btn"
                    disabled={!accepted}
                    onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                  >
                    {item.label}
                  </button>
                  <code className="download-sha">SHA256: {item.sha256}</code>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
