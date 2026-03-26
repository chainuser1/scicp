import React, { useEffect, useMemo, useState } from 'react';
import Footer from '../components/Footer';
import SEO from '../components/SEO';

const PLATFORM_META = [
  {
    label: 'Windows',
    platform: 'windows',
    category: 'desktop',
    icon: '🪟',
    note: 'Chapel computers & laptops · Fully offline',
    guide: ['Download the installer.', 'Open it and follow the on-screen steps.', 'Launch from Start and begin presenting scriptures.'],
  },
  {
    label: 'Mac',
    platform: 'mac',
    category: 'desktop',
    icon: '🍎',
    note: 'MacBook and iMac · Fully offline',
    guide: ['Download the app file.', 'Open it and move the app to Applications.', 'Start the app and begin scripture display.'],
  },
  {
    label: 'Linux (.AppImage)',
    platform: 'linux-appimage',
    category: 'desktop',
    icon: '🐧',
    note: 'All Linux distributions · Fully offline',
    guide: ['Download the .AppImage file.', 'Make it executable: chmod +x *.AppImage', 'Double-click or run it — no install needed.'],
  },
  {
    label: 'Linux (.deb)',
    platform: 'linux-deb',
    category: 'desktop',
    icon: '🐧',
    note: 'Debian, Ubuntu, Kali, Mint · Fully offline',
    guide: ['Download the .deb package.', 'Install: sudo dpkg -i scriptures*.deb', 'Open from your applications menu.'],
  },
  {
    label: 'Android',
    platform: 'android',
    category: 'mobile',
    icon: '📱',
    note: 'Phones and tablets · Requires internet',
    guide: ['Download the app file.', 'Tap it and allow installation when prompted.', 'Open and begin presenting scriptures.'],
  },
  {
    label: 'iOS',
    platform: 'ios',
    category: 'mobile',
    icon: '🍏',
    note: 'iPhone and iPad · Coming soon',
    guide: ['iOS version is currently in development.', 'Check back for updates on availability.'],
    comingSoon: true,
  },
];

/** Detect the visitor's OS to pre-select the best platform. */
function detectPlatform() {
  const ua = navigator.userAgent.toLowerCase();
  if (/android/.test(ua)) return 'android';
  if (/iphone|ipad|ipod/.test(ua)) return null; // iOS not supported
  if (/win/.test(ua)) return 'windows';
  if (/mac/.test(ua)) return 'mac';
  if (/linux/.test(ua)) {
    // Debian/Ubuntu/Kali/Mint: default to .deb
    return 'linux-deb';
  }
  return null;
}

const RELEASES_PAGE = 'https://github.com/chainuser1/scicp/releases/latest';

const FALLBACK_BY_PLATFORM = {
  android: {
    url: RELEASES_PAGE,
    sha256: null,
  },
  windows: {
    url: RELEASES_PAGE,
    sha256: null,
  },
  'linux-appimage': {
    url: RELEASES_PAGE,
    sha256: null,
  },
  'linux-deb': {
    url: RELEASES_PAGE,
    sha256: null,
  },
  mac: {
    url: RELEASES_PAGE,
    sha256: null,
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

  // Auto-select the tab matching the visitor's OS
  const detectedPlatform = useMemo(() => detectPlatform(), []);
  const detectedCategory = detectedPlatform === 'android' ? 'mobile' : detectedPlatform ? 'desktop' : 'desktop';
  const [activeTab, setActiveTab] = useState(detectedCategory);

  useEffect(() => {
    let active = true;
    const loadLatestReleaseAssets = async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const res = await fetch('https://api.github.com/repos/chainuser1/scicp/releases/latest', {
          headers: { Accept: 'application/vnd.github+json' },
          signal: controller.signal,
        });
        clearTimeout(timer);
        if (!res.ok) return;
        const data = await res.json();
        const assets = Array.isArray(data?.assets) ? data.assets : [];
        const find = (matcher) => assets.find(a => matcher(String(a.name || '').toLowerCase()))?.browser_download_url || null;
        const found = {
          android: find(n => n.endsWith('.apk')),
          windows: find(n => n.endsWith('.exe')),
          mac: find(n => n.endsWith('.dmg')),
          'linux-appimage': find(n => n.endsWith('.appimage')),
          'linux-deb': find(n => n.endsWith('.deb')),
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
        clearTimeout(timer);
        // Keep fallback links — they point to the GitHub releases page as safe fallback
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

  const visiblePlatforms = activeTab === 'desktop' ? groupedDownloads.desktop : groupedDownloads.mobile;

  return (
    <div className="dl-page">
      <SEO
        title="Download"
        description="Download Scriptures in View for Windows, Mac, Linux, and Android. Desktop apps work fully offline. Free scripture presentation for church and home."
        path="/download"
        jsonLd={{
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'Scriptures in View',
          applicationCategory: 'ReligiousApp',
          operatingSystem: 'Windows, macOS, Linux, Android',
          offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
          description: 'Free offline scripture presentation app for worship services.',
          url: 'https://cap-teyyko.live/download',
        }}
      />
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

            {activeTab === 'desktop' && (
              <p className="dl-capability-note">
                Desktop apps bundle all scripture databases locally and work completely offline — 
                no internet connection needed after installation.
              </p>
            )}
            {activeTab === 'mobile' && (
              <p className="dl-capability-note">
                Mobile apps connect to the Scriptures in View server for search, scripture data, 
                and real-time projection. An internet connection is required.
              </p>
            )}

            {/* Cards */}
            <div className={`dl-grid dl-grid--${activeTab}`}>
              {visiblePlatforms.map(item => (
                <div key={item.platform} className={`dl-card${detectedPlatform === item.platform ? ' dl-card--detected' : ''}`}>
                  <div className="dl-card-icon-wrap">
                    <span className="dl-card-icon" aria-hidden="true">{item.icon}</span>
                    {detectedPlatform === item.platform && (
                      <span className="dl-card-detected-badge">Your system</span>
                    )}
                  </div>
                  <h2 className="dl-card-title">{item.label}</h2>
                  <p className="dl-card-note">{item.note}</p>
                  {item.category === 'desktop' && (
                    <span className="dl-offline-badge">✓ Works without internet</span>
                  )}
                  {item.platform === 'android' && (
                    <span className="dl-online-badge">⚡ Requires server connection</span>
                  )}
                  {item.comingSoon && (
                    <span className="dl-coming-badge">Coming Soon</span>
                  )}
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
                      disabled={!accepted || !item.url || item.comingSoon}
                      aria-disabled={!accepted || !item.url || item.comingSoon}
                      onClick={() => !item.comingSoon && window.open(item.url, '_blank', 'noopener,noreferrer')}
                    >
                      {item.comingSoon ? 'Coming Soon' : `Download for ${item.label}`}
                    </button>
                    <span className="dl-source">
                      {item.source === 'release' ? `Latest · ${releaseTag}` : (
                        <a href="https://github.com/chainuser1/scicp/releases/latest" target="_blank" rel="noopener noreferrer" className="dl-fallback-link">
                          View releases page ↗
                        </a>
                      )}
                    </span>
                    {item.sha256 && (
                    <details className="dl-verify">
                      <summary>Verify file integrity</summary>
                      <code className="dl-sha">SHA256: {item.sha256}</code>
                    </details>
                    )}
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
