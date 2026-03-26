import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import LongPressMenu from '../../components/reader/LongPressMenu';

describe('LongPressMenu', () => {
  const verse = {
    verse_id: 100,
    book_title: 'Mosiah',
    chapter_number: 2,
    verse_number: 17,
    scripture_text: 'When ye are in the service of your fellow beings',
  };
  const highlights = { getColor: () => null, toggle: vi.fn(), remove: vi.fn() };
  const bookmarks = { isBookmarked: () => false, toggle: vi.fn() };

  it('renders verse reference', () => {
    render(
      <LongPressMenu verse={verse} highlights={highlights} bookmarks={bookmarks} onClose={() => {}} />
    );
    expect(screen.getByText('Mosiah 2:17')).toBeTruthy();
  });

  it('shows Bookmark action', () => {
    render(
      <LongPressMenu verse={verse} highlights={highlights} bookmarks={bookmarks} onClose={() => {}} />
    );
    expect(screen.getByText(/Bookmark/)).toBeTruthy();
  });

  it('shows Copy and Share actions', () => {
    render(
      <LongPressMenu verse={verse} highlights={highlights} bookmarks={bookmarks} onClose={() => {}} />
    );
    expect(screen.getByText(/Copy/)).toBeTruthy();
    expect(screen.getByText(/Share/)).toBeTruthy();
  });

  it('shows Context action when onOpenContext provided', () => {
    render(
      <LongPressMenu
        verse={verse} highlights={highlights} bookmarks={bookmarks}
        onClose={() => {}} onOpenContext={() => {}}
      />
    );
    expect(screen.getByText(/Context/)).toBeTruthy();
  });

  it('does not show Context when onOpenContext absent', () => {
    render(
      <LongPressMenu verse={verse} highlights={highlights} bookmarks={bookmarks} onClose={() => {}} />
    );
    expect(screen.queryByText(/Context/)).toBeNull();
  });

  it('renders 4 highlight color buttons', () => {
    const { container } = render(
      <LongPressMenu verse={verse} highlights={highlights} bookmarks={bookmarks} onClose={() => {}} />
    );
    const colorBtns = container.querySelectorAll('.rd-lp-color');
    expect(colorBtns.length).toBe(4);
  });

  it('calls onClose when overlay clicked', () => {
    const onClose = vi.fn();
    const { container } = render(
      <LongPressMenu verse={verse} highlights={highlights} bookmarks={bookmarks} onClose={onClose} />
    );
    fireEvent.click(container.querySelector('.rd-lp-overlay'));
    expect(onClose).toHaveBeenCalled();
  });
});
