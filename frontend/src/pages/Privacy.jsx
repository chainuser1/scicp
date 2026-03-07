import React, { useEffect } from 'react';
import Footer from '../components/Footer';

export default function Privacy() {
  useEffect(() => {
    document.title = "Privacy Policy | Scripture Projection Engine";
    
    const metaDescription = document.createElement('meta');
    metaDescription.name = "description";
    metaDescription.content = "We do not collect any user data. Google AdSense interactions are governed by third-party policies.";
    document.head.appendChild(metaDescription);

    const metaRobots = document.createElement('meta');
    metaRobots.name = "robots";
    metaRobots.content = "index,follow";
    document.head.appendChild(metaRobots);

    const canonicalLink = document.createElement('link');
    canonicalLink.rel = "canonical";
    canonicalLink.href = "https://cap-teyyko.live/privacy";
    document.head.appendChild(canonicalLink);

    return () => {
      document.head.removeChild(metaDescription);
      document.head.removeChild(metaRobots);
      document.head.removeChild(canonicalLink);
    };
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

        <p className="home-eyebrow">Scripture Projector</p>

        <h1 className="home-title">
          Privacy Policy
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          Your privacy is important to us. This policy explains how we handle your data.
        </p>

        <div className="home-divider" />

        <main className="privacy-content">
          <section>
            <h2>Data Collection</h2>
            <p>We do not collect, store, or process any personal data from users of Scripture Projection Engine. Our service operates without cookies, tracking scripts, or user identifiers.</p>
          </section>
          
          <section>
            <h2>Google AdSense</h2>
            <p>This website utilizes Google AdSense for monetization. Your interactions with advertisements are governed solely by <a href="https://policies.google.com/technologies/ads" target="_blank" rel="noopener">Google's privacy policies</a>. We have no access to or control over data collected by third-party advertisers.</p>
          </section>
          
          <section>
            <h2>Service Terms</h2>
            <p>By using this service, you acknowledge that:
              <ul>
                <li>No user data is collected by our platform</li>
                <li>Ad interactions are independent of our site operations</li>
                <li>We reserve the right to modify service terms with notice</li>
              </ul>
            </p>
          </section>
        </main>
      </main>
      
      <Footer />
    </div>
  );
}