import React, { useEffect } from 'react';

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
    <div className="about-page">
      <header className="about-header">
        <h1>About Scripture Projection Engine</h1>
      </header>
      <main className="about-content">
        <section className="mission">
          <h2>Our Mission</h2>
          <p>Our mission is to spread the Word of God through innovative technology, providing accessible and reliable tools for churches and religious communities to enhance their worship and study experiences.</p>
        </section>
        <section className="vision">
          <h2>Our Vision</h2>
          <p>We envision a world where technology seamlessly bridges the gap between traditional religious practices and modern digital capabilities, enabling global communities to engage with scripture in real-time, regardless of location or resources.</p>
        </section>
      </main>
    </div>
  );
}

export default About;