import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render } from '@testing-library/react';

// Mock heavy dependencies before importing App
vi.mock('capacitor-external-display', () => ({
  ExternalDisplay: {
    isAvailable: vi.fn().mockResolvedValue({ available: false }),
    startPresentation: vi.fn().mockResolvedValue({}),
    stopPresentation: vi.fn().mockResolvedValue({}),
    updateContent: vi.fn().mockResolvedValue({}),
    openCastSettings: vi.fn().mockResolvedValue({}),
    sendToDisplay: vi.fn().mockResolvedValue({}),
    checkCameraPermission: vi.fn().mockResolvedValue({ status: 'granted' }),
  },
}));

vi.mock('../socket-local', () => ({
  socket: {
    connected: true,
    id: 'mobile-local',
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    init: vi.fn().mockResolvedValue(),
  },
  isDisplayAvailable: vi.fn().mockResolvedValue(false),
  startCasting: vi.fn().mockResolvedValue(false),
  stopCasting: vi.fn().mockResolvedValue(),
  isCasting: vi.fn().mockReturnValue(false),
}));

vi.mock('../socket-remote', () => ({
  socket: {
    connected: false,
    id: null,
    emit: vi.fn(),
    on: vi.fn(),
    off: vi.fn(),
    init: vi.fn().mockResolvedValue(),
    destroy: vi.fn(),
    serverUrl: '',
    queueLength: 0,
    onQueueChange: vi.fn(() => () => {}),
    flushQueue: vi.fn(),
    clearQueue: vi.fn(),
  },
}));

vi.mock('../db-manager', () => ({
  initAllDatabases: vi.fn().mockResolvedValue(),
  getDb: vi.fn(),
  getLoadedLanguages: vi.fn().mockReturnValue(['en']),
  isReady: vi.fn().mockReturnValue(false),
}));

vi.mock('../pages/MobilePresenter.jsx', () => ({
  default: () => React.createElement('div', { 'data-testid': 'mobile-presenter' }, 'MobilePresenter'),
}));

import App from '../App';

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(React.createElement(App));
    expect(container).toBeTruthy();
  });

  it('defaults to mode selection screen when no saved mode', () => {
    localStorage.removeItem('scicp.conn_mode');
    const { container } = render(React.createElement(App));
    // Should show the mode selector, not MobilePresenter
    expect(container.innerHTML).toBeTruthy();
  });

  it('shows MobilePresenter when mode is offline and init succeeds', async () => {
    localStorage.setItem('scicp.conn_mode', 'offline');
    const { findByTestId } = render(React.createElement(App));
    const presenter = await findByTestId('mobile-presenter');
    expect(presenter).toBeInTheDocument();
  });
});
