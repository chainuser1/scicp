import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import RootTabBar from '../../components/RootTabBar';

describe('RootTabBar', () => {
  it('renders all 4 tabs', () => {
    render(<RootTabBar active="home" onChange={() => {}} />);
    expect(screen.getByText('Home')).toBeTruthy();
    expect(screen.getByText('Read')).toBeTruthy();
    expect(screen.getByText('Present')).toBeTruthy();
    expect(screen.getByText('More')).toBeTruthy();
  });

  it('marks active tab', () => {
    const { container } = render(<RootTabBar active="read" onChange={() => {}} />);
    const activeBtn = container.querySelector('.root-tab.root-tab-active');
    expect(activeBtn).toBeTruthy();
    expect(activeBtn.textContent).toContain('Read');
  });

  it('calls onChange when tab clicked', () => {
    const onChange = vi.fn();
    render(<RootTabBar active="home" onChange={onChange} />);
    fireEvent.click(screen.getByText('Present'));
    expect(onChange).toHaveBeenCalledWith('present');
  });
});
