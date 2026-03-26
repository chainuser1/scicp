import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import EmblemSVG from '../../components/EmblemSVG';

describe('EmblemSVG', () => {
  it('renders an SVG element', () => {
    const { container } = render(<EmblemSVG size={80} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
  });

  it('applies size prop', () => {
    const { container } = render(<EmblemSVG size={120} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('120');
    expect(svg.getAttribute('height')).toBe('120');
  });
});
