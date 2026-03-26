import { useState } from 'react';
import { useSession } from './hooks/useSocket';
import { useToast } from './hooks/useToast';
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
import './styles/app.css';

const APP_MODE = import.meta.env.VITE_APP_MODE || 'presenter';

export default function App() {
  if (APP_MODE === 'tv') return <TVClient />;
  return <PresenterApp />;
}

function PresenterApp() {
  const [tab, setTab] = useState('search');
  const [staged, setStaged] = useState(null);
  const session = useSession();
  const { toasts } = useToast();
  const historyHook = useHistory();
  const bookmarkHook = useBookmarks();

  const handleStage = (verse) => {
    setStaged(verse);
    setTab('live');
  };

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
          />
        )}
        {tab === 'settings' && <SettingsPage session={session} />}
      </main>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
