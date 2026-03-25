import React, { useEffect } from 'react';
import Footer from '../components/Footer';

export default function Terms() {
  useEffect(() => {
    document.title = "Terms of Service | Scriptures in View";
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogTitle) ogTitle.setAttribute('content', 'Terms of Service | Scriptures in View');
    if (ogDesc) ogDesc.setAttribute('content', 'Terms of service for Scriptures in View');
    const metaDesc = document.querySelector('meta[name="description"]');
    const description = "Terms for using Scriptures in View for non-commercial church and home use.";
    if (metaDesc) metaDesc.setAttribute('content', description);
    const robots = document.querySelector('meta[name="robots"]');
    if (robots) robots.setAttribute('content', 'index,follow');
    const canonical = document.querySelector('link[rel="canonical"]') || (() => { const el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); return el; })();
    canonical.setAttribute('href', 'https://cap-teyyko.live/terms');
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
          Terms of Service
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          Please read these terms before using the software.
        </p>

        <div className="home-divider" />

        <main className="terms-content">
          <section>
            <h2>Allowed Use</h2>
            <p>This software is for non-commercial church use and home use only.</p>
          </section>
          
          <section>
            <h2>User Responsibility</h2>
            <p>You are fully responsible for how you use this software and you agree to follow all applicable laws and regulations.</p>
          </section>
          
          <section>
            <h2>No Commercial Use</h2>
            <p>You may not sell, resell, rent, or commercially license this software without written permission from Dagami Ward Dev.</p>
          </section>
          
          <section>
            <h2>Software Provided As Is</h2>
            <p>The software is provided as is, without guarantees of uninterrupted operation in all environments.</p>
          </section>

          <section>
            <h2>Changes to Terms</h2>
            <p>These terms may be updated from time to time. Continuing to use the software means you accept the updated terms.</p>
          </section>
        </main>
      </main>
      
      <Footer />
    </div>
  );
}
