import React, { useEffect } from 'react';

function Contact() {
  useEffect(() => {
    document.title = 'Contact | Scripture Projection Engine';
    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.setAttribute('content', 'Contact the Scripture Projection Engine team for support, feedback, or collaboration opportunities. We are here to help spread the Word of God through technology.');
    } else {
      const meta = document.createElement('meta');
      meta.name = 'description';
      meta.content = 'Contact the Scripture Projection Engine team for support, feedback, or collaboration opportunities. We are here to help spread the Word of God through technology.';
      document.head.appendChild(meta);
    }
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'index,follow');
    const canonical = document.querySelector('link[rel="canonical"]');
    if (canonical) canonical.setAttribute('href', 'https://cap-teyyko.live/contact');
  }, []);

  return (
    <div className="contact-page">
      <header className="contact-header">
        <h1>Contact Us</h1>
      </header>
      <main className="contact-content">
        <p>
          For any inquiries or support, please reach out to our team via email:
        </p>
        <p>
          <a href="mailto:contact@scicp_dev.com">********@scip_dev.com</a>
        </p>
        <p>
          Lead Developer: Dagami Ward Dev (alias)
        </p>
      </main>
    </div>
  );
}

export default Contact;