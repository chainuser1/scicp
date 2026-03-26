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
        </div>
      </div>
    </div>
  );
}
