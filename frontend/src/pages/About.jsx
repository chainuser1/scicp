import React, { useEffect } from 'react';
import Footer from '../components/Footer';

function About() {
  useEffect(() => {
    document.title = 'About | Scripture Projection Engine';
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', 'Learn about Scripture Projection Engine (scicp), our mission to spread the Word of God through technology, and our vision for real-time scripture presentation.');
    } else {
      const meta = document.createElement('meta');
      meta.name = 'description';
      meta.content = 'Learn about Scripture Projection Engine (scicp), our mission to spread the Word of God through technology, and our vision for real-time scripture presentation.';
      document.head.appendChild(meta);
    }
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'index,follow');
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', 'https://cap-teyyko.live/about');
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
          About Scripture Projection Engine
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          "Thy word is a lamp unto my feet, and a light unto my path"<br />
          — Psalms 119:105
        </p>

        <div className="home-divider" />

        <main className="about-content">
          <section className="mission">
            <h2>Our Mission</h2>
            <p className="home-subtitle">
              Our mission is to spread the Word of God through innovative technology, providing accessible and reliable tools for churches and religious communities to enhance their worship and study experiences.
            </p>
          </section>
          <section className="vision">
            <h2>Our Vision</h2>
            <p className="home-subtitle">
              We envision a world where technology seamlessly bridges the gap between traditional religious practices and modern digital capabilities, enabling global communities to engage with scripture in real-time, regardless of location or resources.
            </p>
          </section>
        </main>
      </main>

      <Footer />
    </div>
  );
}

export default About;