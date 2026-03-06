import React, { useEffect } from 'react';

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
    <div className="terms-page">
      <main className="terms-content">
        <h1>Terms of Service</h1>
        <p>Last updated: March 6, 2026</p>
        
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
      
      <footer className="terms-footer">
        <p>© {new Date().getFullYear()} Scripture Projection Engine. Sacred Tech by LDS Dev Team.</p>
      </footer>
    </div>
  );
}