import React, { useEffect } from 'react';

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
    <div className="privacy-page">
      <main className="privacy-content">
        <h1>Privacy Policy</h1>
        <p>Last updated: March 6, 2026</p>
        
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
      
      <footer className="privacy-footer">
        <p>© {new Date().getFullYear()} Scripture Projection Engine. Sacred Tech by Dagami Ward Dev Team.</p>
      </footer>
    </div>
  );
}