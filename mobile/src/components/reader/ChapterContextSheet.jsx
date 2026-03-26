/**
 * ChapterContextSheet.jsx — Bottom sheet for chapter summary + entities.
 * GET /chapter/:id/summary, /chapter/:id/entities
 */
import { useState, useEffect } from 'react';
import { SERVER_URL } from '../../socket';

export default function ChapterContextSheet({ chapterId, bookTitle, chapterNumber, onClose, onOpenVerse }) {
  const [summary, setSummary] = useState(null);
  const [entities, setEntities] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!chapterId) return;
    setLoading(true);

    Promise.all([
      fetch(`${SERVER_URL}/chapter/${chapterId}/summary`).then(r => r.ok ? r.json() : null).catch(() => null),
      fetch(`${SERVER_URL}/chapter/${chapterId}/entities`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([sum, ent]) => {
      setSummary(sum);
      setEntities(ent);
      setLoading(false);
    });
  }, [chapterId]);

  return (
    <div className="rd-lp-overlay" onClick={onClose}>
      <div className="rd-lp-sheet" style={{ maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div className="rd-lp-handle" />
        <div className="rd-lp-ref">{bookTitle} — Chapter {chapterNumber}</div>

        {loading && (
          <div style={{ textAlign: 'center', padding: 24, color: 'var(--rd-dim)' }}>Loading...</div>
        )}

        {!loading && (
          <>
            {/* Summary */}
            {summary?.summary_text && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Summary</div>
                <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--rd-fg)' }}>
                  {summary.summary_text}
                </p>
                {summary.summary_method && (
                  <span style={{ fontSize: '0.625rem', color: 'var(--rd-muted)', textTransform: 'uppercase' }}>
                    {summary.summary_method}
                  </span>
                )}
              </div>
            )}

            {/* Key Verses */}
            {summary?.key_verses?.length > 0 && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Key Verses</div>
                <div className="rd-topic-chips" style={{ padding: 0, flexWrap: 'wrap' }}>
                  {summary.key_verses.map((kv, i) => (
                    <button key={i} className="rd-topic-chip" onClick={() => { onOpenVerse?.(kv.verse_id); onClose(); }}>
                      v{kv.verse_number}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Top Topics */}
            {summary?.top_topics?.length > 0 && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Topics</div>
                <div className="rd-topic-chips" style={{ padding: 0, flexWrap: 'wrap' }}>
                  {summary.top_topics.map((t, i) => (
                    <span key={i} className="rd-topic-chip">{t.name || t.slug}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Entities */}
            {entities?.people?.length > 0 && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>People</div>
                <div className="rd-topic-chips" style={{ padding: 0, flexWrap: 'wrap' }}>
                  {entities.people.map((p, i) => (
                    <span key={i} className="rd-topic-chip">👤 {p}</span>
                  ))}
                </div>
              </div>
            )}
            {entities?.places?.length > 0 && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Places</div>
                <div className="rd-topic-chips" style={{ padding: 0, flexWrap: 'wrap' }}>
                  {entities.places.map((p, i) => (
                    <span key={i} className="rd-topic-chip">📍 {p}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Footnotes */}
            {(summary?.nabre_footnotes || summary?.net_footnotes) && (
              <div style={{ padding: '0 4px 16px' }}>
                <div className="rd-section-label" style={{ padding: '0 0 6px' }}>Scholar Notes</div>
                {summary.nabre_footnotes && (
                  <p style={{ fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--rd-dim)', marginBottom: 8 }}>
                    {summary.nabre_footnotes}
                  </p>
                )}
                {summary.net_footnotes && (
                  <p style={{ fontSize: '0.8125rem', lineHeight: 1.5, color: 'var(--rd-dim)' }}>
                    {summary.net_footnotes}
                  </p>
                )}
              </div>
            )}

            {/* No data */}
            {!summary?.summary_text && !entities?.people?.length && !entities?.places?.length && (
              <div style={{ textAlign: 'center', padding: 24, color: 'var(--rd-dim)', fontSize: '0.875rem' }}>
                No context data available for this chapter
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
