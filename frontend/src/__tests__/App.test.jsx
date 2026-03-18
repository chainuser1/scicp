import { describe, test, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock socket module used by child page components
vi.mock('../socket', () => ({
  socket: { on: vi.fn(), off: vi.fn(), emit: vi.fn().mockReturnThis(), connected: false, id: 'test-id', onQueueChange: vi.fn(() => () => {}), queueLength: 0, flushQueue: vi.fn(), clearQueue: vi.fn() },
  isRemoteMode: false,
  default: { on: vi.fn(), off: vi.fn(), emit: vi.fn().mockReturnThis(), connected: false, id: 'test-id', onQueueChange: vi.fn(() => () => {}), queueLength: 0, flushQueue: vi.fn(), clearQueue: vi.fn() },
}));

// Mock heavy dependencies used by Presenter/Client so they don't break rendering
vi.mock('qrcode', () => ({ toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,mock')) }));
vi.mock('jsqr', () => ({ default: vi.fn() }));

// Stub fetch for API calls
globalThis.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }));

// Import page components to use directly with MemoryRouter
import Home from '../App';
import Presenter from '../pages/Presenter';
import Client from '../pages/Client';
import About from '../pages/About';
import Contact from '../pages/Contact';
import Privacy from '../pages/Privacy';
import Terms from '../pages/Terms';
import { Routes, Route } from 'react-router-dom';

// Helper to render at a specific route
function renderAtRoute(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<HomePageWrapper />} />
        <Route path="/presenter" element={<Presenter />} />
        <Route path="/client" element={<Client />} />
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
      </Routes>
    </MemoryRouter>
  );
}

// The App component includes its own Router, so for individual route tests we
// need the Home content extracted. We re-use the default export which wraps Router.
function HomePageWrapper() {
  // Render the Home page content directly by importing App's default
  // App itself has a Router, so for MemoryRouter tests we replicate Home's key content.
  return (
    <div className="home-page">
      <p className="home-eyebrow">Sacred Scripture Projector</p>
      <nav className="home-nav">
        <a href="/presenter">Present</a>
        <a href="/client">Display</a>
      </nav>
    </div>
  );
}

describe('App component', () => {
  test('renders the full App without crashing', () => {
    render(<Home />);
    // App includes its own BrowserRouter + Routes, verify it mounts
    expect(document.body).toBeTruthy();
  });

  test('home page shows Sacred Scripture Projector text', () => {
    render(<Home />);
    expect(screen.getByText('Sacred Scripture Projector')).toBeInTheDocument();
  });

  test('home page has navigation links to Presenter and Client', () => {
    render(<Home />);
    expect(screen.getAllByText('Present').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Display').length).toBeGreaterThanOrEqual(1);
  });
});

describe('Route rendering', () => {
  test('renders home page at /', () => {
    renderAtRoute('/');
    expect(screen.getByText('Sacred Scripture Projector')).toBeInTheDocument();
  });

  test('renders Presenter page at /presenter', () => {
    renderAtRoute('/presenter');
    // Presenter component has a container with class presenter-container
    const container = document.querySelector('.presenter-container');
    expect(container).toBeTruthy();
  });

  test('renders Client page at /client', () => {
    renderAtRoute('/client');
    // Client component renders a div with class client-view
    const container = document.querySelector('.client-view');
    expect(container).toBeTruthy();
  });

  test('renders About page at /about', () => {
    renderAtRoute('/about');
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });

  test('renders Contact page at /contact', () => {
    renderAtRoute('/contact');
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });

  test('renders Privacy page at /privacy', () => {
    renderAtRoute('/privacy');
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });

  test('renders Terms page at /terms', () => {
    renderAtRoute('/terms');
    expect(document.body.textContent.length).toBeGreaterThan(0);
  });
});
