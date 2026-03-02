import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Presenter from './pages/Presenter';
import Client from './pages/Client';
import './App.css';

/* ─── Cross / Emblem SVG ─── */
const EmblemSVG = ({ size = 72 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Outer ring */}
    <circle cx="36" cy="36" r="34" stroke="#c9a84c" strokeWidth="0.8" strokeDasharray="4 3" />
    <circle cx="36" cy="36" r="28" stroke="#c9a84c" strokeWidth="0.4" opacity="0.5" />
    {/* Cross */}
    <rect x="33.5" y="14" width="5" height="44" rx="1" fill="#c9a84c" />
    <rect x="16" y="26" width="40" height="5" rx="1" fill="#c9a84c" />
    {/* Center diamond */}
    <rect x="33" y="33" width="6" height="6" rx="0.5" transform="rotate(45 36 36)" fill="#e8c97a" />
    {/* Corner flourishes */}
    <circle cx="36" cy="36" r="3" fill="#0a0a0f" />
    <circle cx="36" cy="36" r="2" fill="#c9a84c" opacity="0.8" />
  </svg>
);

function Home() {
  return (
    <div className="home-page">
      {/* Hero */}
      <main className="home-hero">
        <div className="home-emblem">
          <EmblemSVG size={72} />
        </div>

        <p className="home-eyebrow">Scripture Projector</p>

        <h1 className="home-title">
          The Living<br /><em>Word</em>
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          Bring scripture to life on every screen.<br />
          Project with precision, present with reverence.
        </p>

        <nav className="home-nav">
          <Link to="/presenter" className="home-card">
            <span className="home-card-icon">🎛️</span>
            <span className="home-card-label">Presenter</span>
            <span className="home-card-desc">Control the live display,<br />stage verses, manage themes</span>
          </Link>
          <Link to="/client" className="home-card">
            <span className="home-card-icon">📽️</span>
            <span className="home-card-label">Display</span>
            <span className="home-card-desc">Full-screen audience view<br />with dynamic backgrounds</span>
          </Link>
        </nav>
      </main>

      {/* Footer */}
      <footer className="home-footer">
        <div className="home-footer-brand">
          <svg className="home-footer-logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="16" cy="16" r="15" stroke="#c9a84c" strokeWidth="0.8" />
            <rect x="14.5" y="6" width="3" height="20" rx="0.5" fill="#c9a84c" />
            <rect x="7" y="11" width="18" height="3" rx="0.5" fill="#c9a84c" />
          </svg>
          <span className="home-footer-name">Scripture Projector</span>
        </div>

        <div className="home-footer-links">
          <Link to="/presenter">Presenter</Link>
          <Link to="/client">Display</Link>
        </div>

        <span className="home-footer-copy">
          Built for the house of worship
        </span>
      </footer>
    </div>
  );
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/presenter" element={<Presenter />} />
        <Route path="/client" element={<Client />} />
      </Routes>
    </Router>
  );
}

export default App;