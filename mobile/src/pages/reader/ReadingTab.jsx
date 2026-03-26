/**
 * ReadingTab.jsx — Reading history, stats, continue reading, spaced review.
 */
import { useState, useEffect } from 'react';
import { SERVER_URL } from '../../socket';

export default function ReadingTab({ prefs, onOpenChapter }) {
  const [coverage, setCoverage] = useState(null);
  const [reviewItems, setReviewItems] = useState([]);

  useEffect(() => {
    fetch(`${SERVER_URL}/reading-coverage`).then(r => r.ok ? r.json() : null).then(setCoverage).catch(() => {});
    fetch(`${SERVER_URL}/spaced-review?limit=5`).then(r => r.ok ? r.json() : []).then(setReviewItems).catch(() => {});
  }, []);

  const { lastRead } = prefs;

  return (
    <div className="rd-scroll">
      <div className="rd-header">
        <span className="rd-header-title">Reading</span>
      </div>

      {/* Continue Reading */}
      {lastRead && (
        <div className="rd-continue" onClick={() => onOpenChapter(lastRead.bookId, lastRead.chapterId, lastRead.verseAnchor)}>
          <div className="rd-continue-info">
            <span className="rd-continue-label">Continue Reading</span>
            <span className="rd-continue-ref">{lastRead.label || 'Last position'}</span>
          </div>
          <button className="rd-continue-btn">Resume</button>
        </div>
      )}

      {/* Reading Stats */}
      {coverage && coverage.total > 0 && (
        <div style={{ padding: '0 16px 16px' }}>
          <div className="rd-section-label" style={{ padding: '12px 0 8px' }}>Reading Progress</div>
          <div style={{ height: 8, borderRadius: 4, background: 'var(--rd-border)', overflow: 'hidden' }}>
            <div style={{ width: `${Math.min(100, (coverage.read / coverage.total) * 100)}%`, height: '100%', background: 'var(--rd-accent)', borderRadius: 4 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--rd-dim)' }}>{coverage.read} chapters read</span>
            <span style={{ fontSize: '0.75rem', color: 'var(--rd-dim)' }}>{coverage.total} total</span>
          </div>
        </div>
      )}

      {/* Spaced Review */}
      {reviewItems.length > 0 && (
        <>
          <div className="rd-section-label">📖 For Review</div>
          {reviewItems.map((item, i) => (
            <div key={i} className="rd-result-card" onClick={() => onOpenChapter(item.book_id, item.chapter_id, item.verse_id)}>
              <div className="rd-result-ref">{item.book_title} {item.chapter_number}:{item.verse_number}</div>
              <div className="rd-result-text">{item.scripture_text}</div>
            </div>
          ))}
        </>
      )}

      {!lastRead && !coverage && reviewItems.length === 0 && (
        <div style={{ textAlign: 'center', padding: 60, color: 'var(--rd-dim)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 12 }}>📖</div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600 }}>Start Reading</div>
          <div style={{ fontSize: '0.8125rem', marginTop: 4 }}>Open a book from Home or Browse to begin</div>
        </div>
      )}

      <div style={{ height: 80 }} />
    </div>
  );
}
