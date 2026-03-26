import { useState, useEffect, useCallback } from 'react';
import { SERVER_URL } from '../socket';
import socket from '../socket';
import { addToast } from '../hooks/useToast';
import './Setlists.css';

export default function SetlistsPage({ onStage, bookmarks, toggleBookmark, sessionId, liveVerseId }) {
  const [setlists, setSetlists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState(null);
  const [showBookmarks, setShowBookmarks] = useState(false);

  const fetchSetlists = useCallback(async () => {
    try {
      const res = await fetch(`${SERVER_URL}/setlists`);
      if (res.ok) setSetlists(await res.json());
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchSetlists(); }, [fetchSetlists]);

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
        addToast('Setlist created', 'success');
      }
    } catch { addToast('Failed to create setlist', 'error'); }
  };

  const deleteSetlist = async (id) => {
    try {
      const res = await fetch(`${SERVER_URL}/setlists/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSetlists(prev => prev.filter(s => s.id !== id));
        addToast('Setlist deleted', 'info');
      }
    } catch { addToast('Failed to delete', 'error'); }
  };

  const updateSetlist = async (id, items) => {
    try {
      await fetch(`${SERVER_URL}/setlists/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
    } catch { /* silent */ }
  };

  const removeItem = (setlistId, itemIdx) => {
    setSetlists(prev => prev.map(sl => {
      if (sl.id !== setlistId) return sl;
      const items = [...(sl.items || [])];
      items.splice(itemIdx, 1);
      updateSetlist(sl.id, items);
      return { ...sl, items };
    }));
    addToast('Item removed', 'info');
  };

  const moveItem = (setlistId, fromIdx, dir) => {
    setSetlists(prev => prev.map(sl => {
      if (sl.id !== setlistId) return sl;
      const items = [...(sl.items || [])];
      const toIdx = fromIdx + (dir === 'up' ? -1 : 1);
      if (toIdx < 0 || toIdx >= items.length) return sl;
      [items[fromIdx], items[toIdx]] = [items[toIdx], items[fromIdx]];
      updateSetlist(sl.id, items);
      return { ...sl, items };
    }));
  };

  const goLiveFromItem = (item) => {
    if (!sessionId) { addToast('Join a session first', 'error'); return; }
    socket.emit('go-live', { sessionId, verseData: item });
    addToast('Live!', 'success');
  };

  return (
    <div className="setlists-page scroll-area safe-bottom">
      {/* Bookmarks toggle */}
      {bookmarks?.length > 0 && (
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => setShowBookmarks(!showBookmarks)}
          style={{ alignSelf: 'flex-start' }}
        >
          🔖 Bookmarks ({bookmarks.length}) {showBookmarks ? '▲' : '▼'}
        </button>
      )}

      {showBookmarks && bookmarks?.length > 0 && (
        <div className="card setlist-card">
          <div className="setlist-header">
            <span className="font-semibold">🔖 Bookmarks</span>
            <span className="badge badge-gold">{bookmarks.length} verses</span>
          </div>
          <div className="setlist-items">
            {bookmarks.map((v, i) => (
              <div key={v.verse_id || i} className="setlist-item-row">
                <button className="setlist-item" onClick={() => onStage(v)} style={{ flex: 1 }}>
                  <span className="text-sm text-gold">
                    {v.verse_title || `${v.book_title} ${v.chapter_number}:${v.verse_number}`}
                  </span>
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggleBookmark(v)} title="Remove bookmark">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="setlists-create">
        <input
          className="input"
          placeholder="New setlist name…"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createSetlist()}
        />
        <button className="btn btn-primary btn-sm" onClick={createSetlist}>Create</button>
      </div>

      {loading && (
        <div className="search-loading"><div className="spinner" /></div>
      )}

      {!loading && setlists.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon">📋</span>
          <p className="text-secondary">No setlists yet</p>
          <p className="text-xs text-dim">Create one to save verse collections for services</p>
        </div>
      )}

      {setlists.map(sl => (
        <div key={sl.id} className="card setlist-card">
          <div className="setlist-header-row">
            <button
              className="setlist-header"
              onClick={() => setExpanded(expanded === sl.id ? null : sl.id)}
            >
              <span className="font-semibold">{sl.name}</span>
              <span className="badge badge-gold">{(sl.items || []).length}</span>
            </button>
            <button className="btn btn-ghost btn-sm sl-delete-btn" onClick={() => deleteSetlist(sl.id)} title="Delete">
              🗑
            </button>
          </div>
          {expanded === sl.id && (
            <div className="setlist-items">
              {(sl.items || []).length === 0 && (
                <p className="text-xs text-dim" style={{ padding: '8px 0' }}>Empty setlist</p>
              )}
              {(sl.items || []).map((item, i) => {
                const isLive = liveVerseId && (item.verse_id === liveVerseId || item.id === liveVerseId);
                return (
                  <div key={i} className={`setlist-item-row ${isLive ? 'sl-item-live' : ''}`}>
                    <div className="sl-reorder">
                      <button className="sl-move-btn" onClick={() => moveItem(sl.id, i, 'up')} disabled={i === 0}>▲</button>
                      <button className="sl-move-btn" onClick={() => moveItem(sl.id, i, 'down')} disabled={i === (sl.items || []).length - 1}>▼</button>
                    </div>
                    <button className="setlist-item" onClick={() => onStage(item)} style={{ flex: 1 }}>
                      <span className="text-sm text-gold">
                        {item.verse_title || item.reference || `Verse ${i + 1}`}
                      </span>
                      {isLive && <span className="badge badge-green" style={{ marginLeft: 6 }}>LIVE</span>}
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => goLiveFromItem(item)} title="Go Live">
                      🔴
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => removeItem(sl.id, i)} title="Remove">
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
