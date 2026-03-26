import { useState, useCallback } from 'react';
import { useSession, useSocketEvent } from './hooks/useSocket';
import { useToast } from './hooks/useToast';
import { addToast } from './hooks/useToast';
import { useHistory } from './hooks/useHistory';
import { useBookmarks } from './hooks/useBookmarks';
import TabBar from './components/TabBar';
import StatusHeader from './components/StatusHeader';
import ToastContainer from './components/ToastContainer';
import SearchPage from './pages/Search';
import LivePage from './pages/Live';
import ReaderPage from './pages/Reader';
import SetlistsPage from './pages/Setlists';
import SettingsPage from './pages/Settings';
import TVClient from './pages/TVClient';
import { SERVER_URL } from './socket';
import './styles/app.css';

const APP_MODE = import.meta.env.VITE_APP_MODE || 'presenter';

export default function App() {
  if (APP_MODE === 'tv') return <TVClient />;
  return <PresenterApp />;
}

function PresenterApp() {
  const [tab, setTab] = useState('search');
  const [staged, setStaged] = useState(null);
  const [liveVerseId, setLiveVerseId] = useState(null);
  const session = useSession();
  const { toasts } = useToast();
  const historyHook = useHistory();
  const bookmarkHook = useBookmarks();

  // Track which verse is currently live
  useSocketEvent('update-verse', (data) => {
    setLiveVerseId(data?.verse_id || data?.id || null);
  });
  useSocketEvent('clear-screen', () => setLiveVerseId(null));

  const handleStage = (verse) => {
    setStaged(verse);
    setTab('live');
  };

  // Add verse to the first setlist (quick-add from search results)
  const handleAddToSetlist = useCallback(async (verse) => {
    try {
      const res = await fetch(`${SERVER_URL}/setlists`);
      if (!res.ok) { addToast('Failed to load setlists', 'error'); return; }
      const lists = await res.json();
      if (lists.length === 0) { addToast('Create a setlist first', 'info'); setTab('setlists'); return; }
      const target = lists[0];
      const items = [...(target.items || []), verse];
      const upd = await fetch(`${SERVER_URL}/setlists/${target.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (upd.ok) {
        const ref = verse.verse_title || `${verse.book_title} ${verse.chapter_number}:${verse.verse_number}`;
        addToast(`Added to "${target.name}": ${ref}`, 'success');
      }
    } catch { addToast('Failed to add to setlist', 'error'); }
  }, []);

  return (
    <div className="app-root">
      <StatusHeader sessionId={session.sessionId} viewerCount={session.viewerCount} />
      <ToastContainer toasts={toasts} />
      <main className="app-content">
        {tab === 'search' && (
          <SearchPage
            onStage={handleStage}
            history={historyHook.history}
            clearHistory={historyHook.clearHistory}
            bookmarks={bookmarkHook}
            sessionId={session.sessionId}
            onAddToSetlist={handleAddToSetlist}
          />
        )}
        {tab === 'live' && (
          <LivePage
            staged={staged}
            setStaged={setStaged}
            sessionId={session.sessionId}
            addToHistory={historyHook.addToHistory}
          />
        )}
        {tab === 'reader' && (
          <ReaderPage
            onStage={handleStage}
            bookmarks={bookmarkHook.bookmarks}
            toggleBookmark={bookmarkHook.toggle}
            isBookmarked={bookmarkHook.isBookmarked}
          />
        )}
        {tab === 'setlists' && (
          <SetlistsPage
            onStage={handleStage}
            bookmarks={bookmarkHook.bookmarks}
            toggleBookmark={bookmarkHook.toggle}
            sessionId={session.sessionId}
            liveVerseId={liveVerseId}
          />
        )}
        {tab === 'settings' && <SettingsPage session={session} />}
      </main>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
