import React from 'react';
import { Link } from 'react-router-dom';

export default function Footer() {
  return (
    <footer className="home-footer">
      <div className="home-footer-brand">
        <svg className="home-footer-logo" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="16" cy="16" r="15" stroke="#c9a84c" strokeWidth="0.8" />
          <rect x="14.5" y="6" width="3" height="20" rx="0.5" fill="#c9a84c" />
          <rect x="7" y="11" width="18" height="3" rx="0.5" fill="#c9a84c" />
        </svg>
        <span className="home-footer-name">Scripture Projector</span>
      </div>

      <nav className="home-footer-links">
        <ul>
          <li><Link to="/">Home</Link></li>
          <li><Link to="/presenter">Chapel Control</Link></li>
          <li><Link to="/client">Sacred Display</Link></li>
          <li><Link to="/about">About</Link></li>
          <li><Link to="/contact">Contact</Link></li>
          <li><Link to="/privacy">Privacy Policy</Link></li>
          <li><Link to="/terms">Terms of Service</Link></li>
        </ul>
      </nav>

      <div className="home-footer-credit">
        <span>© {new Date().getFullYear()} Scripture Projection Engine. Sacred Tech by Dagami Ward Dev Team.</span>
      </div>
    </footer>
  );
}