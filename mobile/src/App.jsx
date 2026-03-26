import { useState } from 'react';
import { useSession } from './hooks/useSocket';
import { useToast } from './hooks/useToast';
import TabBar from './components/TabBar';
import StatusHeader from './components/StatusHeader';
import ToastContainer from './components/ToastContainer';
import SearchPage from './pages/Search';
import LivePage from './pages/Live';
import SetlistsPage from './pages/Setlists';
import SettingsPage from './pages/Settings';
import TVClient from './pages/TVClient';
import './styles/app.css';

const APP_MODE = import.meta.env.VITE_APP_MODE || 'presenter';

export default function App() {
  // TV mode — render dedicated client
  if (APP_MODE === 'tv') return <TVClient />;

  return <PresenterApp />;
}

function PresenterApp() {
  const [tab, setTab] = useState('search');
  const [staged, setStaged] = useState(null);
  const session = useSession();
  const { toasts } = useToast();

  const handleStage = (verse) => {
    setStaged(verse);
    setTab('live');
  };

  return (
    <div className="app-root">
      <StatusHeader sessionId={session.sessionId} viewerCount={session.viewerCount} />
      <ToastContainer toasts={toasts} />
      <main className="app-content">
        {tab === 'search' && <SearchPage onStage={handleStage} />}
        {tab === 'live' && <LivePage staged={staged} setStaged={setStaged} sessionId={session.sessionId} />}
        {tab === 'setlists' && <SetlistsPage onStage={handleStage} />}
        {tab === 'settings' && <SettingsPage session={session} />}
      </main>
      <TabBar active={tab} onChange={setTab} />
    </div>
  );
}
