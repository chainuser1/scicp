/**
 * Setlists.jsx — Combined preview card + ORDER OF SERVICE.
 * Matches the Setlist mockup: preview at top, media controls,
 * "projecting now" bar, numbered items with live badge, FAB.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { SERVER_URL } from '../socket';
import socket from '../socket';
import { addToast } from '../hooks/useToast';
import './Setlists.css';

export default function SetlistsPage({ onStage, onGoLive, sessionId, liveVerse, staged, setStaged }) {
  const [setlists, setSetlists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeIdx, setActiveIdx] = useState(0); // which setlist is selected
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const touchStartRef = useRef(null);

  const fetchSetlists = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/setlists`);
      if (res.ok) setSetlists(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSetlists(); }, [fetchSetlists]);

  const activeSetlist = setlists[activeIdx] || null;
  const items = activeSetlist?.items || [];
  const liveVerseId = liveVerse?.verse_id || liveVerse?.id;
  const liveItemIdx = items.findIndex(it => (it.verse_id || it.id) === liveVerseId);
  const displayVerse = staged || liveVerse;

  const createSetlist = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      const res = await fetch(`${SERVER_URL}/setlists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, items: [] }),
      });
      if (res.ok) {
        const sl = await res.json();
        setSetlists(prev => [sl, ...prev]);
        setNewName('');
        setShowCreate(false);
        setActiveIdx(0);
        addToast('Setlist created', 'success');
      }
    } catch { addToast('Failed to create setlist', 'error'); }
  };

  const deleteSetlist = async (id) => {
    try {
      const res = await fetch(`${SERVER_URL}/setlists/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSetlists(prev => prev.filter(s => s.id !== id));
        setActiveIdx(0);
        addToast('Setlist deleted', 'info');
      }
    } catch { addToast('Failed to delete', 'error'); }
  };

  const updateItems = async (newItems) => {
    if (!activeSetlist) return;
    setSetlists(prev => prev.map((sl, i) => i === activeIdx ? { ...sl, items: newItems } : sl));
    try {
      await fetch(`${SERVER_URL}/setlists/${activeSetlist.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: newItems }),
      });
    } catch { /* silent */ }
  };

  const removeItem = (itemIdx) => {
    const newItems = [...items];
    newItems.splice(itemIdx, 1);
    updateItems(newItems);
    addToast('Removed', 'info');
  };

  const moveItem = (fromIdx, dir) => {
    const toIdx = fromIdx + (dir === 'up' ? -1 : 1);
    if (toIdx < 0 || toIdx >= items.length) return;
    const newItems = [...items];
    [newItems[fromIdx], newItems[toIdx]] = [newItems[toIdx], newItems[fromIdx]];
    updateItems(newItems);
  };

  const goLiveItem = (item) => {
    if (!sessionId) { addToast('Join a session first', 'error'); return; }
    onGoLive(item);
  };

  const goLiveNext = () => {
    if (liveItemIdx < 0 || liveItemIdx >= items.length - 1) return;
    goLiveItem(items[liveItemIdx + 1]);
  };
  const goLivePrev = () => {
    if (liveItemIdx <= 0) return;
    goLiveItem(items[liveItemIdx - 1]);
  };

  // Swipe-to-remove touch handlers
  const handleTouchStart = (e, idx) => {
    touchStartRef.current = { x: e.touches[0].clientX, idx };
  };
  const handleTouchEnd = (e) => {
    if (!touchStartRef.current) return;
    const dx = e.changedTouches[0].clientX - touchStartRef.current.x;
    if (Math.abs(dx) > 100) removeItem(touchStartRef.current.idx);
    touchStartRef.current = null;
  };

  const title = (v) => v?.verse_title || v?.reference || `${v?.book_title || ''} ${v?.chapter_number || ''}:${v?.verse_number || ''}`;

  return (
    <div className="setlists-page scroll-area safe-bottom">
      {/* Setlist selector if multiple */}
      {setlists.length > 1 && (
        <div className="sl-selector">
          {setlists.map((sl, i) => (
            <button
              key={sl.id}
              className={`sl-select-btn ${i === activeIdx ? 'sl-select-active' : ''}`}
              onClick={() => setActiveIdx(i)}
            >
              {sl.name}
            </button>
          ))}
        </div>
      )}

      {/* Preview card at top */}
      {displayVerse && (
        <div className="sl-preview-card">
          <p className="sl-preview-text">{displayVerse.scripture_text || ''}</p>
          <p className="sl-preview-ref">{title(displayVerse)}</p>
        </div>
      )}

      {/* Media controls */}
      {displayVerse && (
        <div className="sl-media-controls">
          <button className="media-btn media-btn-sm" onClick={goLivePrev} disabled={liveItemIdx <= 0}>⏮</button>
          <button className="media-btn media-btn-sm" disabled>◀</button>
          <button className="media-btn media-btn-play" onClick={() => {
            if (displayVerse && sessionId) {
              onGoLive(displayVerse);
            }
          }}>▶</button>
          <button className="media-btn media-btn-sm" disabled>▶</button>
          <button className="media-btn media-btn-sm" onClick={goLiveNext} disabled={liveItemIdx < 0 || liveItemIdx >= items.length - 1}>⏭</button>
        </div>
      )}

      {/* Projecting now bar */}
      {liveVerse && liveItemIdx >= 0 && (
        <div className="sl-projecting-bar">
          <button className="sl-proj-arrow" onClick={goLivePrev} disabled={liveItemIdx <= 0}>◀</button>
          <div className="sl-proj-info">
            <span className="sl-proj-label">projecting now</span>
            <span className="sl-proj-ref">{title(liveVerse)}</span>
          </div>
          <button className="sl-proj-arrow" onClick={goLiveNext} disabled={liveItemIdx >= items.length - 1}>▶</button>
        </div>
      )}

      {/* ORDER OF SERVICE */}
      {activeSetlist && (
        <section className="sl-order-section">
          <div className="sl-order-header">
            <span className="sl-order-title">{activeSetlist.name?.toUpperCase()}</span>
            <button className="sl-delete-btn" onClick={() => deleteSetlist(activeSetlist.id)}>🗑</button>
          </div>
          {items.length === 0 && (
            <p className="sl-empty-hint">No items yet — search for verses and tap 🔴 to add</p>
          )}
          <div className="sl-items">
            {items.map((item, i) => {
              const isLive = liveVerseId && ((item.verse_id || item.id) === liveVerseId);
              return (
                <div
                  key={i}
                  className={`sl-item ${isLive ? 'sl-item-live' : ''}`}
                  onClick={() => onStage(item)}
                  onTouchStart={(e) => handleTouchStart(e, i)}
                  onTouchEnd={handleTouchEnd}
                >
                  <span className="sl-item-num">{i + 1}</span>
                  <span className="sl-item-ref">{title(item)}</span>
                  {isLive && <span className="sl-live-badge">◆ live</span>}
                  <button
                    className="sl-item-live-dot"
                    onClick={(e) => { e.stopPropagation(); goLiveItem(item); }}
                  >
                    <span className="dot-red" />
                  </button>
                </div>
              );
            })}
          </div>
          {items.length > 0 && (
            <p className="sl-reorder-hint">hold to reorder · swipe to remove</p>
          )}
        </section>
      )}

      {/* Empty state */}
      {!loading && setlists.length === 0 && !showCreate && (
        <div className="empty-state">
          <span className="empty-state-icon">☰</span>
          <p className="text-secondary">No setlists yet</p>
          <p className="text-xs text-dim">Tap + to create an order of service</p>
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="sl-create-form">
          <input
            className="ss-input"
            placeholder="Setlist name (e.g. Sacrament Meeting)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && createSetlist()}
            autoFocus
          />
          <div className="sl-create-actions">
            <button className="ss-btn ss-btn-secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="ss-btn ss-btn-primary" onClick={createSetlist}>Create</button>
          </div>
        </div>
      )}

      {loading && <div className="search-loading"><div className="spinner" /></div>}

      {/* Green FAB */}
      <button className="sl-fab" onClick={() => setShowCreate(true)} aria-label="Create setlist">
        +
      </button>
    </div>
  );
}
