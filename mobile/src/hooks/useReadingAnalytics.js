/**
 * useReadingAnalytics.js — IntersectionObserver-based dwell time + reading event posting.
 * Tracks verse visibility, sends POST /reading-event with dwell_ms.
 * Detects flow mode (fast sequential reading).
 */
import { useRef, useCallback, useEffect } from 'react';
import { SERVER_URL } from '../socket';

const DWELL_THRESHOLD = 8000; // ms before posting a reading event
const BATCH_INTERVAL = 5000;  // batch post every 5s
const MAX_DWELL = 300000;     // cap at 5 min

export function useReadingAnalytics({ chapterId, bookId, lang = 'en' }) {
  const dwellMap = useRef({}); // verse_id → { startTime, totalMs }
  const pendingEvents = useRef([]);
  const batchTimer = useRef(null);
  const observerRef = useRef(null);
  const flowRef = useRef({ lastVerseTime: 0, consecutive: 0 });

  // Flush pending events to server
  const flush = useCallback(() => {
    if (pendingEvents.current.length === 0) return;
    const batch = pendingEvents.current.splice(0);
    // Post each event (could batch, but individual is fine for now)
    for (const evt of batch) {
      fetch(`${SERVER_URL}/reading-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(evt),
      }).catch(() => {
        // Queue locally on failure
        try {
          const q = JSON.parse(localStorage.getItem('scicp_rd_event_queue') || '[]');
          q.push(evt);
          if (q.length > 50) q.shift(); // cap offline queue
          localStorage.setItem('scicp_rd_event_queue', JSON.stringify(q));
        } catch { /* full */ }
      });
    }
  }, []);

  // Retry offline queue on mount
  useEffect(() => {
    try {
      const q = JSON.parse(localStorage.getItem('scicp_rd_event_queue') || '[]');
      if (q.length > 0) {
        localStorage.removeItem('scicp_rd_event_queue');
        for (const evt of q) {
          fetch(`${SERVER_URL}/reading-event`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(evt),
          }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
  }, []);

  // Batch timer
  useEffect(() => {
    batchTimer.current = setInterval(flush, BATCH_INTERVAL);
    return () => {
      clearInterval(batchTimer.current);
      flush();
    };
  }, [flush]);

  // Create IntersectionObserver
  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        const now = Date.now();
        for (const entry of entries) {
          const vid = entry.target.dataset?.verseId;
          if (!vid) continue;

          if (entry.isIntersecting) {
            // Verse entered viewport
            if (!dwellMap.current[vid]) {
              dwellMap.current[vid] = { startTime: now, totalMs: 0 };
            } else {
              dwellMap.current[vid].startTime = now;
            }

            // Flow detection
            const gap = now - flowRef.current.lastVerseTime;
            if (gap < 2000 && gap > 0) {
              flowRef.current.consecutive++;
            } else {
              flowRef.current.consecutive = 0;
            }
            flowRef.current.lastVerseTime = now;
          } else {
            // Verse left viewport — accumulate dwell
            const rec = dwellMap.current[vid];
            if (rec && rec.startTime) {
              const elapsed = now - rec.startTime;
              rec.totalMs = Math.min(MAX_DWELL, rec.totalMs + elapsed);
              rec.startTime = null;

              // Post if threshold met
              if (rec.totalMs >= DWELL_THRESHOLD) {
                pendingEvents.current.push({
                  verse_id: Number(vid),
                  book_id: bookId || null,
                  chapter_id: chapterId || null,
                  language: lang,
                  dwell_ms: rec.totalMs,
                  event_type: 'read',
                });
              }
            }
          }
        }
      },
      { threshold: 0.5 }
    );

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
      // Final flush: capture any still-visible verses
      const now = Date.now();
      for (const [vid, rec] of Object.entries(dwellMap.current)) {
        if (rec.startTime) {
          rec.totalMs = Math.min(MAX_DWELL, rec.totalMs + (now - rec.startTime));
          if (rec.totalMs >= DWELL_THRESHOLD) {
            pendingEvents.current.push({
              verse_id: Number(vid),
              book_id: bookId || null,
              chapter_id: chapterId || null,
              language: lang,
              dwell_ms: rec.totalMs,
              event_type: 'read',
            });
          }
        }
      }
      dwellMap.current = {};
      flush();
    };
  }, [chapterId, bookId, lang, flush]);

  // Observe a verse element
  const observeVerse = useCallback((el) => {
    if (el && observerRef.current) {
      observerRef.current.observe(el);
    }
  }, []);

  // Manual event (bookmark, highlight)
  const trackEvent = useCallback((verseId, eventType, dwellMs = 0) => {
    pendingEvents.current.push({
      verse_id: verseId,
      book_id: bookId || null,
      chapter_id: chapterId || null,
      language: lang,
      dwell_ms: dwellMs,
      event_type: eventType,
    });
  }, [bookId, chapterId, lang]);

  // Flow mode: 3+ consecutive fast reads
  const isFlowMode = flowRef.current.consecutive >= 3;

  return { observeVerse, trackEvent, isFlowMode };
}
