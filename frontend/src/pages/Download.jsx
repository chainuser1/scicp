import React, { useEffect, useMemo, useState } from 'react';
import Footer from '../components/Footer';

const PLATFORM_META = [
  { label: 'Android (Offline App)', platform: 'android' },
  { label: 'Windows Installer', platform: 'windows' },
  { label: 'Linux Installer', platform: 'linux' },
  { label: 'Mac Installer', platform: 'mac' },
];

const FALLBACK_BY_PLATFORM = {
  android: {
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000059743/artifacts/5889562783',
    sha256: '11a670361a6426981391d5250895d06977a99b697480127ff1cd4b0c4463a604',
  },
  windows: {
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889590639',
    sha256: '4feeb9e6620197a8a3136aabcbb9fd849f482a8f4afc254b390225a7327d6ddd',
  },
  linux: {
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889616163',
    sha256: 'e6291127b52c1c3d025375361bb3e79544177da67a69c8552f9759a885b9c1b4',
  },
  mac: {
    url: 'https://github.com/chainuser1/scicp/actions/runs/23000048595/artifacts/5889569130',
    sha256: 'ec5d380ce6200833887d8d5c5ae8403644b9829d62d80265d44bcd20453f77b2',
  },
};

export default function Download() {
  const [geoState, setGeoState] = useState({ checking: true, allowed: false, reason: '' });
  const [accepted, setAccepted] = useState(false);
  const [releaseTag, setReleaseTag] = useState('fallback');
  const [downloadLinks, setDownloadLinks] = useState(
    PLATFORM_META.map(item => ({
      ...item,
      ...FALLBACK_BY_PLATFORM[item.platform],
      source: 'fallback',
    }))
  );

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
    const loadLatestReleaseAssets = async () => {
      try {
        const res = await fetch('https://api.github.com/repos/chainuser1/scicp/releases/latest', {
          headers: { Accept: 'application/vnd.github+json' },
        });
        if (!res.ok) return;
        const data = await res.json();
        const assets = Array.isArray(data?.assets) ? data.assets : [];
        const find = (matcher) => assets.find(a => matcher(String(a.name || '').toLowerCase()))?.browser_download_url || null;
        const found = {
          android: find(n => n.endsWith('.apk')),
          windows: find(n => n.endsWith('.exe')),
          mac: find(n => n.endsWith('.dmg')),
          linux: find(n => n.endsWith('.appimage')) || find(n => n.endsWith('.deb')),
        };
        if (!active) return;
        setReleaseTag(data?.tag_name || 'latest');
        setDownloadLinks(
          PLATFORM_META.map(item => ({
            ...item,
            url: found[item.platform] || FALLBACK_BY_PLATFORM[item.platform].url,
            sha256: FALLBACK_BY_PLATFORM[item.platform].sha256,
            source: found[item.platform] ? 'release' : 'fallback',
          }))
        );
      } catch {
        // Keep fallback links
      }
    };
    loadLatestReleaseAssets();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const checkAccess = async () => {
      try {
        const [rWho, rApi] = await Promise.allSettled([
          fetch('https://ipwho.is/?security=1').then(r => r.json()),
          fetch('https://ipapi.co/json/').then(r => r.json()),
        ]);
        if (!active) return;

        const who = rWho.status === 'fulfilled' ? rWho.value : null;
        const api = rApi.status === 'fulfilled' ? rApi.value : null;
        const countries = [
          String(who?.country_code || '').toUpperCase(),
          String(api?.country_code || '').toUpperCase(),
        ].filter(Boolean);

        if (!countries.length) {
          // Fail-open to avoid false lockouts when geo services are down.
          setGeoState({ checking: false, allowed: true, reason: 'Location provider unavailable. Proceed responsibly.' });
          return;
        }

        const anyPH = countries.includes('PH');
        const allNonPH = countries.every(c => c !== 'PH');
        if (allNonPH) {
          setGeoState({ checking: false, allowed: false, reason: 'Downloads are available in the Philippines only.' });
          return;
        }

        const isTor = Boolean(who?.security?.tor);
        const isVpnOrProxy = Boolean(who?.security?.vpn || who?.security?.proxy);
        if (isTor || (isVpnOrProxy && !anyPH)) {
          setGeoState({ checking: false, allowed: false, reason: 'Please disable VPN/proxy to access downloads.' });
          return;
        }

        // Allow PH users even when one provider flags proxy (common ISP false positive).
        const caution = isVpnOrProxy && anyPH ? 'Network flagged as proxy by one provider; downloads are allowed.' : '';
        setGeoState({ checking: false, allowed: true, reason: caution });
      } catch {
        if (!active) return;
        setGeoState({ checking: false, allowed: true, reason: 'Unable to verify location. Proceed responsibly.' });
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
        <p className="home-eyebrow">Download Center</p>
        <h1 className="home-title">Get the App</h1>
        <div className="home-divider" />
        <p className="home-subtitle">
          Simple offline apps for worship services, classes, and home scripture study.
        </p>

        {!geoState.allowed ? (
          <section className="download-gate">
            <h2>Restricted Access</h2>
            <p>{gatedMessage}</p>
          </section>
        ) : (
          <section className="download-panel">
            <h2>Before You Download</h2>
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
            <p className="download-meta">
              Release source: {releaseTag}
              {geoState.reason ? ` • ${geoState.reason}` : ''}
            </p>

            <section className="download-steps" aria-label="How to use downloads">
              <h3>How it works</h3>
              <ol>
                <li>Choose your device below.</li>
                <li>Download and install the app.</li>
                <li>Use it offline for church or home scripture use.</li>
              </ol>
            </section>

            <h3 className="download-choose">Choose your device</h3>
            <div className="download-grid">
              {downloadLinks.map((item) => (
                <div key={item.platform} className="download-item">
                  <button
                    type="button"
                    className="download-btn"
                    disabled={!accepted || !item.url}
                    onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                  >
                    {item.label}
                  </button>
                  <code className="download-sha">SHA256: {item.sha256}</code>
                  <span className="download-source">{item.source === 'release' ? 'Auto-updated from latest release' : 'Using fallback link'}</span>
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
