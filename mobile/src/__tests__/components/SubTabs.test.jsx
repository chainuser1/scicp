import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SubTabs from '../../components/SubTabs';

describe('SubTabs', () => {
  it('renders all sub-tab labels', () => {
    render(<SubTabs active="search" onChange={() => {}} />);
    expect(screen.getByText('Search')).toBeTruthy();
    expect(screen.getByText('Recent')).toBeTruthy();
    expect(screen.getByText('Setlist')).toBeTruthy();
    expect(screen.getByText('Browse')).toBeTruthy();
  });

  it('marks active sub-tab', () => {
    const { container } = render(<SubTabs active="browse" onChange={() => {}} />);
    const active = container.querySelector('.sub-tab.sub-tab-active');
    expect(active).toBeTruthy();
    expect(active.textContent).toContain('Browse');
  });

  it('calls onChange on click', () => {
    const onChange = vi.fn();
    render(<SubTabs active="search" onChange={onChange} />);
    fireEvent.click(screen.getByText('Recent'));
    expect(onChange).toHaveBeenCalledWith('recent');
  });
});
