import React from 'react';
import Footer from '../components/Footer';
import SEO from '../components/SEO';

function Contact() {
  return (
    <div className="home-page">
      <SEO
        title="Contact"
        description="Contact Dagami Ward Dev for support and feedback about Scriptures in View. Get help with scripture presentation for your ward or family."
        path="/contact"
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
          Contact Us
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          For questions, support, and feedback, contact Dagami Ward Dev:
        </p>

        <div className="home-divider" />

        <main className="contact-content">
          <p>
            <a href="mailto:lumpsam47@gmail.com">lumpsam47@gmail.com</a>
          </p>
          <p>
            Team: Dagami Ward Dev
          </p>
        </main>
      </main>

      <Footer />
    </div>
  );
}

export default Contact;
