import React from 'react';
import Footer from '../components/Footer';
import SEO from '../components/SEO';

function About() {
  return (
    <div className="home-page">
      <SEO
        title="About"
        description="Learn what Scriptures in View can do for church worship, talks, lessons, and home scripture study. Free real-time scripture presentation for every ward and family."
        path="/about"
      />
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
          <section>
            <h2>What is Scriptures in View?</h2>
            <p>Scriptures in View is a free, real-time scripture presentation tool designed for worship services, seminary classes, family study, and personal devotion. It helps presenters project scripture verses onto screens while congregations follow along, keeping everyone focused on God's word.</p>
            <p>Whether you're preparing a sacrament meeting talk, leading a youth fireside, or studying at home, Scriptures in View makes it easy to find, display, and explore the standard works.</p>
          </section>

          <section>
            <h2>Features</h2>
            <ul className="features-list">
              <li><strong>Intelligent Search</strong> — Find verses by reference, topic, or concept. The search understands context — searching "anger issues" surfaces verses about patience, meekness, and self-control.</li>
              <li><strong>Real-Time Projection</strong> — Push verses live to any connected display. Changes appear instantly on TVs, projectors, and monitors.</li>
              <li><strong>Multi-Language Support</strong> — Search and display in English, Tagalog, and Cebuano. Switch languages on the fly or show dual-language text.</li>
              <li><strong>Reader Mode</strong> — A personal scripture study experience with highlights, bookmarks, reading analytics, and five visual themes.</li>
              <li><strong>Set Lists</strong> — Prepare ordered verse collections for talks, lessons, or devotionals. Add notes to verses for quick reference.</li>
              <li><strong>Desktop Offline</strong> — The desktop app works completely offline with all scripture databases bundled locally.</li>
            </ul>
          </section>

          <section>
            <h2>Supported Scriptures</h2>
            <p>Scriptures in View includes the complete text of the standard works: The Holy Bible (King James Version), the Book of Mormon, the Doctrine and Covenants, and the Pearl of Great Price — over 41,000 verses across all volumes.</p>
          </section>

          <section>
            <h2>Available On</h2>
            <ul className="features-list">
              <li><strong>Web</strong> — Any modern browser at scripturesinview.com</li>
              <li><strong>Windows, Mac, Linux</strong> — Desktop apps with full offline support</li>
              <li><strong>Android</strong> — Mobile app for on-the-go presenting and study</li>
            </ul>
          </section>

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
            <div className="faq-item">
              <h3>Is it free?</h3>
              <p>Yes. Scriptures in View is completely free to use on all platforms. There are no subscriptions, ads, or in-app purchases.</p>
            </div>
            <div className="faq-item">
              <h3>Can I use it without internet?</h3>
              <p>The desktop app (Windows, Mac, Linux) works fully offline. The web and mobile versions require an internet connection for search and real-time features.</p>
            </div>
            <div className="faq-item">
              <h3>How does the search work?</h3>
              <p>Our search combines full-text matching with semantic understanding. It recognizes scripture references (like "John 3:16"), expands abbreviations, and uses mathematical models to find verses related to your query even when exact words don't match.</p>
            </div>
          </section>
        </main>
      </main>

      <Footer />
    </div>
  );
}

export default About;
