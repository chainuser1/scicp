/**
 * VerseContextSheet.jsx — Bottom sheet for verse summary, tags, related verses.
 * GET /verse/:id/summary, /verse/:id/tags, /verse/:id/related
 */
import { useState, useEffect } from 'react';
import { SERVER_URL } from '../../socket';

export default function VerseContextSheet({ verse, onClose, onOpenVerse }) {
  const [summary, setSummary] = useState(null);
  const [tags, setTags] = useState(null);
  const [related, setRelated] = useState([]);
  const [loading, setLoading] = useState(true);

  const verseId = verse?.verse_id || verse?.id;
  const ref = `${verse?.book_title || ''} ${verse?.chapter_number || ''}:${verse?.verse_number || ''}`;

  useEffect(() => {
    if (!verseId) return;
    setLoading(true);

    Promise.all([
      fetch(`${SERVER_URL}/verse/${verseId}/summary`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${SERVER_URL}/verse/${verseId}/tags`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${SERVER_URL}/verse/${verseId}/related?page=0&pageSize=6`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([sum, tg, rel]) => {
      setSummary(sum);
      setTags(tg);
      setRelated(rel?.results || []);
      setLoading(false);
    });
  }, [verseId]);

  return (
    <div className="rd-lp-overlay" onClick={onClose}>
      <div className="rd-lp-sheet" style={{ maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="rd-lp-handle" />
        <div className="rd-lp-ref">{ref}</div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--rd-dim)' }}>Loading context...</div>
        )}

        {!loading && (
          <>
            {/* Summary */}
            {summary?.summary && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>About this verse</div>
                <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--rd-fg)' }}>{summary.summary}</p>
              </div>
            )}

            {/* Tags */}
            {tags?.labels?.length > 0 && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Topics</div>
                <div className="rd-topic-chips" style={{ padding: 0, flexWrap: 'wrap' }}>
                  {tags.speaker && <span className="rd-topic-chip" style={{ fontWeight: 700 }}>🗣 {tags.speaker}</span>}
                  {tags.pov && <span className="rd-topic-chip" style={{ opacity: 0.7 }}>{tags.pov}</span>}
                  {tags.labels.map((l, i) => <span key={i} className="rd-topic-chip">{l}</span>)}
                </div>
              </div>
            )}

            {/* Cross References */}
            {summary?.cross_references?.length > 0 && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Cross References</div>
                {summary.cross_references.slice(0, 5).map((xr, i) => (
                  <button key={i} className="rd-result-open" style={{ display: 'block', padding: '4px 0' }}
                    onClick={() => { onOpenVerse?.(xr.verse_id); onClose(); }}>
                    {xr.reference || `${xr.book_title}`}
                  </button>
                ))}
              </div>
            )}

            {/* Related Verses */}
            {related.length > 0 && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Related</div>
                {related.map((v, i) => (
                  <div key={v.verse_id || i} className="rd-result-card" style={{ padding: '10px 0' }}
                    onClick={() => { onOpenVerse?.(v.verse_id); onClose(); }}>
                    <div className="rd-result-ref">{v.book_title} {v.chapter_number}:{v.verse_number}</div>
                    <div className="rd-result-text">{v.scripture_text}</div>
                    {v.matched_concept && (
                      <span style={{ fontSize: '0.6875rem', color: 'var(--rd-accent)', opacity: 0.7 }}>
                        {v.matched_concept} · {Math.round((v.similarity_score || 0) * 100)}%
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* No data */}
            {!summary?.summary && !tags?.labels?.length && related.length === 0 && (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--rd-dim)', fontSize: '0.875rem' }}>
                No context data available for this verse
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
