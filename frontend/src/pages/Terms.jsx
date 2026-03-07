import React, { useEffect } from 'react';
import Footer from '../components/Footer';

export default function Terms() {
  useEffect(() => {
    document.title = "Terms of Service | Scripture Projection Engine";
    
    const metaDescription = document.createElement('meta');
    metaDescription.name = "description";
    metaDescription.content = "Terms governing use of Scripture Projection Engine: free service, user responsibility, and no liability.";
    document.head.appendChild(metaDescription);

    const metaRobots = document.createElement('meta');
    metaRobots.name = "robots";
    metaRobots.content = "index,follow";
    document.head.appendChild(metaRobots);

    const canonicalLink = document.createElement('link');
    canonicalLink.rel = "canonical";
    canonicalLink.href = "https://cap-teyyko.live/terms";
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
          Terms of Service
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          Please read these terms carefully before using our service.
        </p>

        <div className="home-divider" />

        <main className="terms-content">
          <section>
            <h2>Free Service</h2>
            <p>Scripture Projection Engine is provided free of charge to all users. We intend to maintain this service at no cost indefinitely. However, we reserve the right to modify or discontinue any aspect of the service at our discretion without prior notice.</p>
          </section>
          
          <section>
            <h2>User Responsibility</h2>
            <p>You are solely responsible for your use of this service. You agree to use Scripture Projection Engine in compliance with all applicable laws and regulations. You acknowledge that the content displayed is for religious and educational purposes only.</p>
          </section>
          
          <section>
            <h2>No Liability</h2>
            <p>To the fullest extent permitted by law, Scripture Projection Engine and its developers shall not be liable for any direct, indirect, incidental, special, or consequential damages arising from your use of or inability to use the service.</p>
          </section>
          
          <section>
            <h2>Changes to Terms</h2>
            <p>We may update these Terms of Service periodically. Continued use of the service after changes constitutes acceptance of the revised terms.</p>
          </section>
        </main>
      </main>
      
      <Footer />
    </div>
  );
}