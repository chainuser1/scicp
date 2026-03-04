import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import Presenter from './pages/Presenter';
import Client from './pages/Client';
import './App.css';

/* ─── Cross / Emblem SVG ─── */
const EmblemSVG = ({ size = 72 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg">
    {/* Cornerstone – rectangular base with slight 3D feel */}
    <rect x="12" y="46" width="48" height="18" rx="4" fill="#c9a84c" opacity="0.92"/>
    
    {/* Resurrection arch */}
    <path d="M14 46 Q36 10 58 46" stroke="#c9a84c" strokeWidth="4" strokeLinecap="round"/>
    
    {/* Christus figure – more defined but still stylized */}
    <circle cx="36" cy="28" r="8" fill="#e8c97a"/> {/* head */}
    <ellipse cx="36" cy="42" rx="12" ry="10" fill="#e8c97a"/> {/* shoulders/torso */}
    <path d="M24 38 Q18 32 12 28" stroke="#e8c97a" strokeWidth="5" strokeLinecap="round"/> {/* left arm */}
    <path d="M48 38 Q54 32 60 28" stroke="#e8c97a" strokeWidth="5" strokeLinecap="round"/> {/* right arm */}
    
    {/* Subtle center accent */}
    <circle cx="36" cy="28" r="3" fill="#0a0a0f" opacity="0.7"/>
    
    {/* Optional faint inner arch glow */}
    <path d="M18 46 Q36 18 54 46" stroke="#e8c97a" strokeWidth="1.5" opacity="0.4"/>
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

        <p className="home-eyebrow">Sacred Scripture Projector</p>

        <h1 className="home-title">
          His <em>Word</em><br />Endures
        </h1>

        <div className="home-divider" />

        <p className="home-subtitle">
          "Thy word is a lamp unto my feet, and a light unto my path"<br />
          — Psalms 119:105
        </p>

        <nav className="home-nav">
          <Link to="/presenter" className="home-card">
            <span className="home-card-icon">🏛️</span>
            <span className="home-card-label">Chapel Control</span>
            <span className="home-card-desc">Manage presentations,<br />stage testimonies</span>
          </Link>
          <Link to="/client" className="home-card">
            <span className="home-card-icon">⛪</span>
            <span className="home-card-label">Sacred Display</span>
            <span className="home-card-desc">Share scriptures<br />with reverence</span>
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
          <Link to="/presenter">Chapel Control</Link>
          <Link to="/client">Sacred Display</Link>
        </div>

        <div className="home-footer-credit">
          <span>© {new Date().getFullYear()} Sacred Scripture Projector</span>
          <span className="home-footer-separator">&nbsp;|&nbsp;</span>
          <span>Sacred Tech by <em>Dagami Ward Dev Team</em></span>
        </div>
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