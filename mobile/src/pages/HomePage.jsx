/**
 * HomePage.jsx — Landing page matching the mockup.
 * Hero with emblem, title, subtitle, two mode cards.
 */
import EmblemSVG from '../components/EmblemSVG';
import './HomePage.css';

export default function HomePage({ onNavigate }) {
  return (
    <div className="home-page-m">
      <div className="home-scroll">
        {/* Hero */}
        <header className="home-hero-m">
          <div className="home-emblem-m">
            <EmblemSVG size={64} />
          </div>

          <h1 className="home-title-m">
            His <em>Word</em><br />Endures
          </h1>

          <p className="home-subtitle-m">
            "Thy word is a lamp unto my feet, and a light unto my path"<br />
            — Psalms 119:105
          </p>
        </header>

        {/* Mode Cards */}
        <nav className="home-cards-m">
          <div className="home-card-m" onClick={() => onNavigate('present')}>
            <span className="home-card-icon-m">🏛️</span>
            <span className="home-card-label-m">PRESENT</span>
            <span className="home-card-desc-m">Search, stage, and present live</span>
            <button className="home-card-btn-m">Explore Presenting</button>
          </div>

          <div className="home-card-m home-card-reader-m" onClick={() => onNavigate('read')}>
            <span className="home-card-icon-m">📖</span>
            <span className="home-card-label-m">READ SCRIPTURES</span>
            <span className="home-card-desc-m">Browse, highlight, bookmark, and explore context</span>
            <button className="home-card-btn-m">Start Reading</button>
          </div>
        </nav>

        <div style={{ height: 80 }} />
      </div>
    </div>
  );
}
