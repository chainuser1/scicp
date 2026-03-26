import '../../styles/info.css';

export default function AboutPage({ onBack }) {
  return (
    <div className="info-page">
      <div className="info-header">
        <button className="info-back" onClick={onBack}>← Back</button>
        <span className="info-header-title">About</span>
      </div>
      <div className="info-scroll">
        <div className="info-content">
          <h2>What is Scriptures in View?</h2>
          <p>Scriptures in View is a free, real-time scripture presentation tool for worship services, seminary classes, family study, and personal devotion. It helps presenters project verses onto screens while congregations follow along.</p>
          <p>Whether you're preparing a talk, leading a fireside, or studying at home, Scriptures in View makes it easy to find, display, and explore the standard works.</p>

          <h2>Features</h2>
          <ul>
            <li><strong>Intelligent Search</strong> — Find verses by reference, topic, or concept with context-aware results.</li>
            <li><strong>Real-Time Projection</strong> — Push verses live to any connected display instantly.</li>
            <li><strong>Multi-Language</strong> — English, Tagalog, and Cebuano with on-the-fly switching.</li>
            <li><strong>Reader Mode</strong> — Personal study with highlights, bookmarks, analytics, and themes.</li>
            <li><strong>Set Lists</strong> — Prepare ordered verse collections with notes for talks and lessons.</li>
            <li><strong>Desktop Offline</strong> — Full offline support with bundled scripture databases.</li>
          </ul>

          <h2>Supported Scriptures</h2>
          <p>Includes the complete standard works: The Holy Bible (KJV), Book of Mormon, Doctrine and Covenants, and Pearl of Great Price — over 41,000 verses.</p>

          <h2>Available On</h2>
          <ul>
            <li><strong>Web</strong> — Any modern browser at scripturesinview.com</li>
            <li><strong>Windows, Mac, Linux</strong> — Desktop apps with offline support</li>
            <li><strong>Android</strong> — Mobile app for presenting and study</li>
          </ul>

          <h2>Our Mission</h2>
          <p>Our mission is to help people focus on the word of God with clear, reverent, and easy scripture presentation tools.</p>

          <h2>Our Vision</h2>
          <p>We want every ward, branch, family, and home to have dependable scripture presentation that is simple to run and respectful in worship settings.</p>

          <h2>Frequently Asked Questions</h2>

          <h3>What can the app do?</h3>
          <p>You can search scriptures fast, stage verses before showing them, go live to displays, switch languages, highlight text, and prepare set lists for talks or lessons.</p>

          <h3>Where can it be used?</h3>
          <p>It can be used on web, desktop, and Android, including offline use for church and home settings.</p>

          <h3>What scriptures are available?</h3>
          <p>The app supports the standard works used in lessons and worship, including the Bible, Book of Mormon, Doctrine and Covenants, and Pearl of Great Price.</p>

          <h3>Who built this?</h3>
          <p>Scriptures in View is maintained by Dagami Ward Dev.</p>

          <h3>Is it free?</h3>
          <p>Yes. Scriptures in View is completely free on all platforms. No subscriptions, ads, or in-app purchases.</p>

          <h3>Can I use it without internet?</h3>
          <p>The desktop app works fully offline. The web and mobile versions require an internet connection for search and real-time features.</p>

          <h3>How does the search work?</h3>
          <p>Our search combines full-text matching with semantic understanding. It recognizes references, expands abbreviations, and finds related verses even when exact words don't match.</p>
        </div>
      </div>
    </div>
  );
}
