import React, { useEffect, useMemo, useState } from 'react';
import Footer from '../components/Footer';

const DOWNLOAD_LINKS = [
  {
    label: 'Android (Offline App)',
    platform: 'android',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000059743/artifacts/5889562783',
  },
  {
    label: 'Windows Installer',
    platform: 'windows',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889590639',
  },
  {
    label: 'Linux Installer',
    platform: 'linux',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889616163',
  },
  {
    label: 'Mac Installer',
    platform: 'mac',
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889569130',
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
                <button
                  key={item.platform}
                  type="button"
                  className="download-btn"
                  disabled={!accepted}
                  onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
      <Footer />
    </div>
  );
}
