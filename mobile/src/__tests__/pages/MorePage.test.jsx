import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import MorePage from '../../pages/MorePage';

describe('MorePage', () => {
  it('renders More heading', () => {
    render(<MorePage />);
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('renders info page links', () => {
    const { container } = render(<MorePage />);
    expect(container.textContent).toContain('About');
    expect(container.textContent).toContain('Contact');
    expect(container.textContent).toContain('Privacy');
    expect(container.textContent).toContain('Terms');
  });

  it('navigates to About sub-screen when clicked', () => {
    render(<MorePage />);
    fireEvent.click(screen.getByText(/About/i));
    // Should render About sub-screen content
    expect(screen.getByText(/Back/i)).toBeTruthy();
  });
});
