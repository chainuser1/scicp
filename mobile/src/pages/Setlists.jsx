import { useState, useEffect, useCallback } from 'react';
import { SERVER_URL } from '../socket';
import { addToast } from '../hooks/useToast';
import './Setlists.css';

export default function SetlistsPage({ onStage, bookmarks, toggleBookmark }) {
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
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => toggleBookmark(v)}
                  title="Remove bookmark"
                >
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
          <button
            className="setlist-header"
            onClick={() => setExpanded(expanded === sl.id ? null : sl.id)}
          >
            <span className="font-semibold">{sl.name}</span>
            <span className="badge badge-gold">{(sl.items || []).length} verses</span>
          </button>
          {expanded === sl.id && (
            <div className="setlist-items">
              {(sl.items || []).length === 0 && (
                <p className="text-xs text-dim" style={{ padding: '8px 0' }}>Empty setlist</p>
              )}
              {(sl.items || []).map((item, i) => (
                <button
                  key={i}
                  className="setlist-item"
                  onClick={() => onStage(item)}
                >
                  <span className="text-sm text-gold">{item.verse_title || item.reference}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
