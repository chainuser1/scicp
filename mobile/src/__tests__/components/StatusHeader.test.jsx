import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock useSocket hooks
vi.mock('../../hooks/useSocket', () => ({
  useConnectionState: () => 'connected',
}));

import StatusHeader from '../../components/StatusHeader';

describe('StatusHeader', () => {
  it('renders title', () => {
    render(<StatusHeader title="Scripture" onMenuOpen={() => {}} />);
    expect(screen.getByText('Scripture')).toBeTruthy();
  });

  it('shows LIVE badge when live', () => {
    render(<StatusHeader title="Scripture" isLive={true} onMenuOpen={() => {}} />);
    expect(screen.getByText(/live/i)).toBeTruthy();
  });

  it('shows not live when not live', () => {
    render(<StatusHeader title="Scripture" isLive={false} onMenuOpen={() => {}} />);
    expect(screen.getByText(/not live/i)).toBeTruthy();
  });

  it('shows viewer count', () => {
    render(<StatusHeader title="Scripture" viewerCount={3} onMenuOpen={() => {}} />);
    expect(screen.getByText(/3/)).toBeTruthy();
  });
});
