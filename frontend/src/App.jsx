import React, {useEffect, useState} from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate } from 'react-router-dom';
import About from './pages/About';
import Contact from './pages/Contact';
import Privacy from './pages/Privacy';
import Terms from './pages/Terms';
import './App.css';
import Footer from './components/Footer';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastProvider } from './components/Toast';
import ConnectionStatus from './components/ConnectionStatus';

const Presenter = React.lazy(() => import('./pages/Presenter'));
const Client = React.lazy(() => import('./pages/Client'));
const ScriptureReader = React.lazy(() => import('./pages/ScriptureReader'));
const Download = React.lazy(() => import('./pages/Download'));

/* ─── Cross / Emblem SVG ─── */
const EmblemSVG = ({ size = 72 }) => (
  <svg width={size} height={size} viewBox="0 0 72 72" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Sacred Scripture Projector emblem">
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
  const HOME_TOUR_KEY = 'scicp.home_tour_prompt_seen_v1';
  const [showHomeTourPrompt, setShowHomeTourPrompt] = useState(() => {
    try {
      const seen = window.localStorage.getItem(HOME_TOUR_KEY) === 'true';
      return !seen;
    } catch {
      return true;
    }
  });

  const dismissHomeTourPrompt = () => {
    setShowHomeTourPrompt(false);
    try {
      window.localStorage.setItem(HOME_TOUR_KEY, 'true');
    } catch {
      // ignore storage errors
    }
  };

  useEffect(() => {
    document.title = 'Scriptures in View | Real-Time Scripture Presentation';
    const robotsMeta = document.querySelector('meta[name="robots"]');
    if (robotsMeta) robotsMeta.setAttribute('content', 'index,follow');
    const canonical = document.querySelector('link[rel="canonical"]') || (() => { const el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); return el; })();
    canonical.setAttribute('href', 'https://cap-teyyko.live/');
  }, []);

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
            <span className="home-card-label">Present</span>
            <span className="home-card-desc">Search, stage, and go live<br />during your meeting</span>
          </Link>
          <Link to="/client" className="home-card">
            <span className="home-card-icon">⛪</span>
            <span className="home-card-label">Display</span>
            <span className="home-card-desc">Show scriptures on the<br />screen for everyone</span>
          </Link>
          <Link to="/download" className="home-card">
            <span className="home-card-icon">⬇️</span>
            <span className="home-card-label">Offline Downloads</span>
            <span className="home-card-desc">Get desktop and mobile apps<br />for offline church use</span>
          </Link>
          <Link to="/reader" className="home-card home-card--reader">
            <span className="home-card-icon">📖</span>
            <span className="home-card-label">Read Scriptures</span>
            <span className="home-card-desc">Personal reading — browse by chapter,<br />highlight, bookmark, and explore context</span>
          </Link>
        </nav>
      </main>

     
     <div id="container-6da4a92b964c03d6c84f2de481fd6bb0"></div>

      {showHomeTourPrompt && (
        <aside className="home-tour-prompt" aria-live="polite">
          <div className="home-tour-prompt-title">First Time Here?</div>
          <div className="home-tour-prompt-body">
            Open Present and we will show a short walkthrough of sessions, search, and going live.
          </div>
          <div className="home-tour-prompt-actions">
            <Link to="/presenter?tour=1" className="home-tour-btn home-tour-btn--primary" onClick={dismissHomeTourPrompt}>
              Start Tour
            </Link>
            <button className="home-tour-btn" onClick={dismissHomeTourPrompt}>Dismiss</button>
          </div>
        </aside>
      )}

    <Footer />
    </div>
  );
}

function ReaderPage() {
  const navigate = useNavigate();
  return <ScriptureReader onExit={() => navigate('/')} />;
}

function NotFound() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <h1>Page not found</h1>
      <Link to="/">Go back home</Link>
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ConnectionStatus />
        <Router>
          <React.Suspense fallback={<div style={{display:'flex',justifyContent:'center',alignItems:'center',height:'100vh'}}><p>Loading…</p></div>}>
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/reader" element={<ReaderPage />} />
              <Route path="/presenter" element={<Presenter />} />
              <Route path="/client" element={<Client />} />
              <Route path="/about" element={<About />} />
              <Route path="/contact" element={<Contact />} />
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/download" element={<Download />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </React.Suspense>
        </Router>
      </ToastProvider>
    </ErrorBoundary>
  );
}

export default App;
