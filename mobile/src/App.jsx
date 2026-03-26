import { useState, useCallback, lazy, Suspense } from 'react';
import { useSession, useSocketEvent } from './hooks/useSocket';
import { useToast } from './hooks/useToast';
import { addToast } from './hooks/useToast';
import { useHistory } from './hooks/useHistory';
import { useBookmarks } from './hooks/useBookmarks';
import TabBar from './components/TabBar';
import StatusHeader from './components/StatusHeader';
import SubTabs from './components/SubTabs';
import ToastContainer from './components/ToastContainer';
import SearchPage from './pages/Search';
import PreviewPage from './pages/Preview';
import SetlistsPage from './pages/Setlists';
import BrowsePage from './pages/Browse';
import RecentPage from './pages/Recent';
import SettingsSheet from './pages/SettingsSheet';
import TVClient from './pages/TVClient';
import { SERVER_URL } from './socket';
import './styles/app.css';

const ReaderApp = lazy(() => import('./pages/reader/ReaderApp'));

const APP_MODE = import.meta.env.VITE_APP_MODE || 'presenter';
const MODE_KEY = 'scicp_app_mode';

export default function App() {
  if (APP_MODE === 'tv') return <TVClient />;

  const [appMode, setAppMode] = useState(
    () => localStorage.getItem(MODE_KEY) || 'reader'
  );
  const switchMode = useCallback((mode) => {
    localStorage.setItem(MODE_KEY, mode);
    setAppMode(mode);
  }, []);

  if (appMode === 'reader') {
    return (
      <Suspense fallback={<div style={{ background: '#f5f0e8', height: '100%' }} />}>
        <ReaderApp onSwitchMode={() => switchMode('presenter')} />
      </Suspense>
    );
  }
  return <PresenterApp onSwitchToReader={() => switchMode('reader')} />;
}

/* Maps bottom tabs to default sub-tabs */
const TAB_TO_SUBTAB = { search: 'search', preview: null, setlists: 'setlist', browse: 'browse' };
/* Maps sub-tabs to bottom tabs */
const SUBTAB_TO_TAB = { search: 'search', recent: 'search', setlist: 'setlists', browse: 'browse' };

function PresenterApp({ onSwitchToReader }) {
  const [tab, setTab] = useState('search');
  const [subTab, setSubTab] = useState('search');
  const [staged, setStaged] = useState(null);
  const [liveVerse, setLiveVerse] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const session = useSession();
  const { toasts } = useToast();
  const historyHook = useHistory();
  const bookmarkHook = useBookmarks();

  const isLive = !!liveVerse;

  useSocketEvent('update-verse', (data) => {
    setLiveVerse(data || null);
  });
  useSocketEvent('clear-screen', () => setLiveVerse(null));
  useSocketEvent('update-theme', () => {
    // Theme is managed by the TV client; presenter just acknowledges
  });

  /* Bottom tab change → also sync sub-tab */
  const handleTabChange = (newTab) => {
    setTab(newTab);
    const defaultSub = TAB_TO_SUBTAB[newTab];
    if (defaultSub) setSubTab(defaultSub);
  };

  /* Sub-tab change → also sync bottom tab */
  const handleSubTabChange = (newSub) => {
    setSubTab(newSub);
    const targetTab = SUBTAB_TO_TAB[newSub];
    if (targetTab && targetTab !== tab) setTab(targetTab);
  };

  const handleStage = (verse) => {
    setStaged(verse);
    setTab('preview');
    setSubTab('search'); // preview has no sub-tab
  };

  /* 🔴 red dot = go live immediately */
  const handleGoLiveImmediate = useCallback((verse) => {
    setStaged(verse);
    setLiveVerse(verse);
    setTab('preview');
    // Emit will happen from Preview component when staged+liveVerse set
    const { default: socket } = require('./socket');
    socket.emit('go-live', {
      verse,
      language: localStorage.getItem('scicp_language') || 'en',
    });
    historyHook.addToHistory(verse);
    addToast(
      `Live: ${verse.verse_title || verse.book_title + ' ' + verse.chapter_number + ':' + verse.verse_number}`,
      'success'
    );
  }, [historyHook]);

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

  /* Determine which content to show based on sub-tab overrides */
  const showSearch = tab === 'search' && subTab === 'search';
  const showRecent = (tab === 'search' || tab === 'setlists') && subTab === 'recent';
  const showSetlist = tab === 'setlists' && subTab === 'setlist';
  const showBrowse = tab === 'browse' || subTab === 'browse';
  const showPreview = tab === 'preview';

  const headerTitle = showBrowse ? 'Browse' : 'Scripture';

  return (
    <div className="app-root">
      <StatusHeader
        sessionId={session.sessionId}
        viewerCount={session.viewerCount}
        liveVerse={liveVerse}
        isLive={isLive}
        title={headerTitle}
        onMenuOpen={() => setSettingsOpen(true)}
      />
      <ToastContainer toasts={toasts} />
      <main className="app-content">
        {/* Sub-tabs shown on all screens except Preview */}
        {!showPreview && (
          <SubTabs active={subTab} onChange={handleSubTabChange} />
        )}

        {showSearch && (
          <SearchPage
            onStage={handleStage}
            onGoLive={handleGoLiveImmediate}
            history={historyHook.history}
            clearHistory={historyHook.clearHistory}
            bookmarks={bookmarkHook}
            sessionId={session.sessionId}
            session={session}
            onAddToSetlist={handleAddToSetlist}
          />
        )}
        {showRecent && (
          <RecentPage
            history={historyHook.history}
            clearHistory={historyHook.clearHistory}
            onStage={handleStage}
            onGoLive={handleGoLiveImmediate}
          />
        )}
        {showPreview && (
          <PreviewPage
            staged={staged}
            setStaged={setStaged}
            liveVerse={liveVerse}
            setLiveVerse={setLiveVerse}
            sessionId={session.sessionId}
            addToHistory={historyHook.addToHistory}
          />
        )}
        {showSetlist && (
          <SetlistsPage
            onStage={handleStage}
            onGoLive={handleGoLiveImmediate}
            sessionId={session.sessionId}
            liveVerse={liveVerse}
            staged={staged}
            setStaged={setStaged}
          />
        )}
        {showBrowse && (
          <BrowsePage
            onStage={handleStage}
            onGoLive={handleGoLiveImmediate}
          />
        )}
      </main>
      <TabBar active={tab} onChange={handleTabChange} />

      {/* Settings as slide-up sheet */}
      {settingsOpen && (
        <SettingsSheet
          session={session}
          onClose={() => setSettingsOpen(false)}
          onSwitchToReader={onSwitchToReader}
        />
      )}
    </div>
  );
}
