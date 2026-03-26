import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HomePage from '../../pages/HomePage';

describe('HomePage', () => {
  it('renders hero title', () => {
    const { container } = render(<HomePage onNavigate={() => {}} />);
    expect(container.querySelector('.home-title-m')).toBeTruthy();
    expect(container.textContent).toContain('Endures');
  });

  it('renders Present and Read mode cards', () => {
    const { container } = render(<HomePage onNavigate={() => {}} />);
    const cards = container.querySelectorAll('.home-card-m');
    expect(cards.length).toBe(2);
  });

  it('calls onNavigate("present") when Present card clicked', () => {
    const onNavigate = vi.fn();
    const { container } = render(<HomePage onNavigate={onNavigate} />);
    const cards = container.querySelectorAll('.home-card-m');
    fireEvent.click(cards[0]); // first card = Present
    expect(onNavigate).toHaveBeenCalledWith('present');
  });

  it('calls onNavigate("read") when Read card clicked', () => {
    const onNavigate = vi.fn();
    const { container } = render(<HomePage onNavigate={onNavigate} />);
    const cards = container.querySelectorAll('.home-card-m');
    fireEvent.click(cards[1]); // second card = Read
    expect(onNavigate).toHaveBeenCalledWith('read');
  });

  it('renders the emblem SVG', () => {
    const { container } = render(<HomePage onNavigate={() => {}} />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('renders psalm subtitle', () => {
    const { container } = render(<HomePage onNavigate={() => {}} />);
    expect(container.textContent).toContain('Psalms 119:105');
  });
});
