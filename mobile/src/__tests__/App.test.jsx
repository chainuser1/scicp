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
  it('renders presenter mode by default', () => {
    render(<App />);
    expect(screen.getByText('Search')).toBeTruthy();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('renders search placeholder', () => {
    render(<App />);
    expect(screen.getByPlaceholderText('Search scriptures…')).toBeTruthy();
  });
});
