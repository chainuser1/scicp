import React, { useEffect } from 'react';
import Footer from '../components/Footer';

export default function Privacy() {
  useEffect(() => {
    document.title = "Privacy Policy | Scriptures in View";
    const metaDesc = document.querySelector('meta[name="description"]');
    const description = "Privacy policy for Scriptures in View, including location checks for restricted downloads.";
    if (metaDesc) metaDesc.setAttribute('content', description);
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', 'index,follow');
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', 'https://cap-teyyko.live/privacy');
  }, []);

  return (
    <div className="home-page">
      <main className="home-hero">
        <div className="home-emblem">
          <svg width="72" height="72" viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="12" y="46" width="48" height="18" rx="4" fill="#c9a84c" opacity="0.92"/>
            <path d="M14 46 Q36 10 58 46" stroke="#c9a84c" strokeWidth="4" strokeLinecap="round"/>
            <circle cx="36" cy="28" r="8" fill="#e8c97a"/>
            <ellipse cx="36" cy="42" rx="12" ry="10" fill="#e8c97a"/>
            <path d="M24 38 Q18 32 12 28" stroke="#e8c97a" strokeWidth="5" strokeLinecap="round"/>
            <path d="M48 38 Q54 32 60 28" stroke="#e8c97a" strokeWidth="5" strokeLinecap="round"/>
            <circle cx="36" cy="28" r="3" fill="#0a0a0f" opacity="0.7"/>
            <path d="M18 46 Q36 18 54 46" stroke="#e8c97a" strokeWidth="1.5" opacity="0.4"/>
          </svg>
        </div>

        <p className="home-eyebrow">Scriptures in View</p>

        <h1 className="home-title">
          Privacy Policy
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          Your privacy matters to us. This page explains what we collect and what we do not collect.
        </p>

        <div className="home-divider" />

        <main className="privacy-content">
          <section>
            <h2>Data Collection</h2>
            <p>For normal scripture presentation use, we do not ask for accounts and we do not collect personal profiles.</p>
          </section>
          
          <section>
            <h2>Download Page Checks</h2>
            <p>On the downloads page, we check country and network risk flags (such as VPN/proxy) to enforce access rules. This check is used only to allow or block access and is not used for user profiling.</p>
          </section>
          
          <section>
            <h2>Third-Party Services</h2>
            <p>If a third-party service is used (for example, hosting or download providers), their own privacy policies apply to their systems.</p>
          </section>

          <section>
            <h2>Policy Updates</h2>
            <p>We may update this policy as the software changes. Continued use means you accept the latest published policy.</p>
          </section>
        </main>
      </main>
      
      <Footer />
    </div>
  );
}
