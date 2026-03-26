/**
 * LongPressMenu.jsx — Bottom sheet for verse actions (highlight, bookmark, copy, share).
 */

const COLORS = ['yellow', 'green', 'pink', 'blue'];

export default function LongPressMenu({ verse, highlights, bookmarks, analytics, onClose, onOpenContext }) {
  const verseId = verse.verse_id || verse.id;
  const currentColor = highlights.getColor(verseId);
  const isBm = bookmarks.isBookmarked(verseId);
  const ref = `${verse.book_title || ''} ${verse.chapter_number || ''}:${verse.verse_number || ''}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(`${ref} — ${verse.scripture_text}`);
    } catch { /* clipboard not available */ }
    onClose();
  };

  const handleShare = async () => {
    const text = `${ref} — ${verse.scripture_text}`;
    if (navigator.share) {
      try { await navigator.share({ title: ref, text }); } catch { /* cancelled */ }
    } else {
      await handleCopy();
    }
    onClose();
  };

  const handleBookmark = () => {
    bookmarks.toggle({
      verse_id: verseId,
      book_title: verse.book_title,
      chapter_number: verse.chapter_number,
      verse_number: verse.verse_number,
      scripture_text: verse.scripture_text,
    });
    analytics?.trackEvent(verseId, 'bookmark');
    onClose();
  };

  const handleHighlight = (color) => {
    highlights.toggle(verseId, color);
    analytics?.trackEvent(verseId, 'highlight');
    onClose();
  };

  return (
    <div className="rd-lp-overlay" onClick={onClose}>
      <div className="rd-lp-sheet" onClick={e => e.stopPropagation()}>
        <div className="rd-lp-handle" />
        <div className="rd-lp-ref">{ref}</div>

        {/* Highlight Colors */}
        <div className="rd-lp-colors">
          {COLORS.map(c => (
            <button
              key={c}
              className={`rd-lp-color rd-lp-color-${c}${currentColor === c ? ' rd-lp-color-active' : ''}`}
              onClick={() => handleHighlight(c)}
              aria-label={`Highlight ${c}`}
            />
          ))}
          {currentColor && (
            <button
              className="rd-lp-color"
              style={{ background: 'var(--rd-surface)', border: '1px solid var(--rd-border)', fontSize: '0.75rem' }}
              onClick={() => { highlights.remove(verseId); onClose(); }}
              aria-label="Remove highlight"
            >✕</button>
          )}
        </div>

        {/* Actions */}
        <div className="rd-lp-actions">
          <button className="rd-lp-action" onClick={handleBookmark}>
            {isBm ? '🔖' : '📑'} {isBm ? 'Remove Bookmark' : 'Bookmark'}
          </button>
          <button className="rd-lp-action" onClick={handleCopy}>
            📋 Copy
          </button>
          <button className="rd-lp-action" onClick={handleShare}>
            ↗ Share
          </button>
          {onOpenContext && (
            <button className="rd-lp-action" onClick={() => onOpenContext(verse)}>
              ℹ️ Context
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
