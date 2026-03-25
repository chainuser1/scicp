import React, { useEffect, useMemo, useState } from 'react';
import Footer from '../components/Footer';

const PLATFORM_META = [
  {
    label: 'Windows',
    platform: 'windows',
    category: 'desktop',
    icon: '🪟',
    note: 'Chapel computers & laptops',
    guide: ['Download the installer.', 'Open it and follow the on-screen steps.', 'Launch from Start and begin presenting scriptures.'],
  },
  {
    label: 'Mac',
    platform: 'mac',
    category: 'desktop',
    icon: '🍎',
    note: 'MacBook and iMac',
    guide: ['Download the app file.', 'Open it and move the app to Applications.', 'Start the app and begin scripture display.'],
  },
  {
    label: 'Linux',
    platform: 'linux',
    category: 'desktop',
    icon: '🐧',
    note: 'Linux desktop computers',
    guide: ['Download the app package.', 'Install using your system package tool.', 'Open from your applications menu.'],
  },
  {
    label: 'Android',
    platform: 'android',
    category: 'mobile',
    icon: '📱',
    note: 'Phones and tablets',
    guide: ['Download the app file.', 'Tap it and allow installation when prompted.', 'Open and begin presenting scriptures.'],
  },
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
    document.title = 'Download | Scriptures in View';
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogTitle) ogTitle.setAttribute('content', 'Download | Scriptures in View');
    if (ogDesc) ogDesc.setAttribute('content', 'Download desktop and mobile apps for offline use');
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
    const canonical = document.querySelector('link[rel="canonical"]') || (() => { const el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); return el; })();
    canonical.setAttribute('href', 'https://cap-teyyko.live/download');
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
    if (geoState.checking) return 'Verifying location and network integrity…';
    if (!geoState.allowed) return geoState.reason || 'Access restricted.';
    return '';
  }, [geoState]);

  const groupedDownloads = useMemo(
    () => ({
      desktop: downloadLinks.filter(item => item.category === 'desktop'),
      mobile: downloadLinks.filter(item => item.category === 'mobile'),
    }),
    [downloadLinks]
  );

  const [activeTab, setActiveTab] = useState('desktop');
  const visiblePlatforms = activeTab === 'desktop' ? groupedDownloads.desktop : groupedDownloads.mobile;

  return (
    <div className="dl-page">
      {/* ── Hero ── */}
      <section className="dl-hero" aria-labelledby="dl-hero-title">
        <div className="dl-hero-glow" aria-hidden="true" />
        <span className="dl-hero-emblem" aria-hidden="true">✦</span>
        <p className="dl-hero-eyebrow">Scriptures in View</p>
        <h1 className="dl-hero-title" id="dl-hero-title">Download the App</h1>
        <p className="dl-hero-sub">
          Present sacred scriptures beautifully — offline, for your chapel and home.
        </p>
        {!geoState.checking && geoState.allowed && releaseTag !== 'fallback' && (
          <span className="dl-version-chip">{releaseTag}</span>
        )}
      </section>

      {/* ── Body ── */}
      <div className="dl-body">
        {geoState.checking ? (
          <div className="dl-status-card">
            <span className="dl-status-icon" aria-hidden="true">◌</span>
            <p>Verifying your location…</p>
          </div>
        ) : !geoState.allowed ? (
          <div className="dl-status-card dl-status-card--blocked">
            <span className="dl-status-icon" aria-hidden="true">⊘</span>
            <p>{gatedMessage}</p>
          </div>
        ) : (
          <>
            {/* Agreement notice */}
            <div className="dl-notice" role="region" aria-label="Usage agreement">
              <p className="dl-notice-text">
                This application is made available for non-commercial church and home use only.
                By downloading, you agree to use it in compliance with all applicable laws.
              </p>
              <label className="dl-consent">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={e => setAccepted(e.target.checked)}
                />
                <span>I understand and accept this usage policy.</span>
              </label>
              {geoState.reason && (
                <p className="dl-caution">{geoState.reason}</p>
              )}
            </div>

            {/* Platform tabs */}
            <div className="dl-tabs" role="tablist" aria-label="Choose platform type">
              <button
                role="tab"
                aria-selected={activeTab === 'desktop'}
                className={`dl-tab${activeTab === 'desktop' ? ' dl-tab--active' : ''}`}
                onClick={() => setActiveTab('desktop')}
              >
                <span aria-hidden="true">🖥</span> Desktop
              </button>
              <button
                role="tab"
                aria-selected={activeTab === 'mobile'}
                className={`dl-tab${activeTab === 'mobile' ? ' dl-tab--active' : ''}`}
                onClick={() => setActiveTab('mobile')}
              >
                <span aria-hidden="true">📱</span> Mobile
              </button>
            </div>

            {/* Cards */}
            <div className={`dl-grid dl-grid--${activeTab}`}>
              {visiblePlatforms.map(item => (
                <div key={item.platform} className="dl-card">
                  <div className="dl-card-icon-wrap">
                    <span className="dl-card-icon" aria-hidden="true">{item.icon}</span>
                  </div>
                  <h2 className="dl-card-title">{item.label}</h2>
                  <p className="dl-card-note">{item.note}</p>
                  <div className="dl-card-rule" aria-hidden="true" />
                  <p className="dl-steps-label">How to get started</p>
                  <ol className="dl-steps" aria-label={`Installation steps for ${item.label}`}>
                    {item.guide.map((step, i) => (
                      <li key={step} className="dl-step">
                        <span className="dl-step-n" aria-hidden="true">{i + 1}</span>
                        <span className="dl-step-text">{step}</span>
                      </li>
                    ))}
                  </ol>
                  <div className="dl-card-footer">
                    <button
                      type="button"
                      className="dl-btn"
                      disabled={!accepted || !item.url}
                      aria-disabled={!accepted || !item.url}
                      onClick={() => window.open(item.url, '_blank', 'noopener,noreferrer')}
                    >
                      Download for {item.label}
                    </button>
                    <span className="dl-source">
                      {item.source === 'release' ? `Latest · ${releaseTag}` : 'Fallback link'}
                    </span>
                    <details className="dl-verify">
                      <summary>Verify file integrity</summary>
                      <code className="dl-sha">SHA256: {item.sha256}</code>
                    </details>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      <Footer />
    </div>
  );
}
