import { useState, useEffect, useCallback } from 'react';
import { SERVER_URL } from '../socket';
import { addToast } from '../hooks/useToast';
import './Setlists.css';

export default function SetlistsPage({ onStage }) {
  const [setlists, setSetlists] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState(null);

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
