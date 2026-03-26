import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock socket.io-client
vi.mock('socket.io-client', () => {
  const onHandlers = {};
  const ioHandlers = {};
  const socket = {
    connected: false,
    on: vi.fn((ev, fn) => { onHandlers[ev] = fn; }),
    off: vi.fn(),
    emit: vi.fn(),
    io: {
      on: vi.fn((ev, fn) => { ioHandlers[ev] = fn; }),
      off: vi.fn(),
    },
    getServerUrl: () => 'https://test.example.com',
    getQueueLength: () => 0,
    onQueueChange: vi.fn(() => () => {}),
  };
  return { io: vi.fn(() => socket), default: socket };
});

import App from '../App';

describe('App', () => {
  it('renders Home tab by default', () => {
    const { container } = render(<App />);
    // Home page has hero title with class
    expect(container.querySelector('.home-title-m')).toBeTruthy();
    expect(container.textContent).toContain('Endures');
  });

  it('renders root tab bar with 4 tabs', () => {
    render(<App />);
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('Present')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('renders emblem SVG on home', () => {
    const { container } = render(<App />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
