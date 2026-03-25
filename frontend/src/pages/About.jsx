import React, { useEffect } from 'react';
import Footer from '../components/Footer';

function About() {
  useEffect(() => {
    document.title = 'About | Scriptures in View';
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogTitle) ogTitle.setAttribute('content', 'About | Scriptures in View');
    if (ogDesc) ogDesc.setAttribute('content', 'Learn about Sacred Scripture Projector');
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', 'Learn what Scriptures in View can do for church worship, talks, lessons, and home scripture study.');
    } else {
      const meta = document.createElement('meta');
      meta.name = 'description';
      meta.content = 'Learn what Scriptures in View can do for church worship, talks, lessons, and home scripture study.';
      document.head.appendChild(meta);
    }
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'index,follow');
    const canonical = document.querySelector('link[rel="canonical"]') || (() => { const el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); return el; })();
    canonical.setAttribute('href', 'https://cap-teyyko.live/about');
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
          About Scriptures in View
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          Scriptures in View helps teachers, speakers, and leaders share scriptures clearly during worship, classes, and home study.
        </p>

        <div className="home-divider" />

        <main className="about-content">
          <section className="mission">
            <h2>Our Mission</h2>
            <p>Our mission is to help people focus on the word of God with clear, reverent, and easy scripture presentation tools.</p>
          </section>
          <section className="vision">
            <h2>Our Vision</h2>
            <p>We want every ward, branch, family, and home to have dependable scripture presentation that is simple to run and respectful in worship settings.</p>
          </section>
          
          <section className="faq">
            <h2>Frequently Asked Questions</h2>
            <div className="faq-item">
              <h3>What can the app do?</h3>
              <p>You can search scriptures fast, stage verses before showing them, go live to displays, switch languages, highlight text, and prepare set lists for talks or lessons.</p>
            </div>
            <div className="faq-item">
              <h3>Where can it be used?</h3>
              <p>It can be used on web, desktop, and Android, including offline use for church and home settings.</p>
            </div>
        
            <div className="faq-item">
              <h3>What scriptures are available?</h3>
              <p>The app supports the standard works used in lessons and worship, including the Bible, Book of Mormon, Doctrine and Covenants, and Pearl of Great Price.</p>
            </div>
            <div className="faq-item">
              <h3>Who built this?</h3>
              <p>Scriptures in View is maintained by Dagami Ward Dev.</p>
            </div>
          </section>
        </main>
      </main>

      <Footer />
    </div>
  );
}

export default About;
