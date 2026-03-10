import React, { useEffect, useState } from 'react';
import { socket } from './socket-local';
import MobilePresenter from './pages/MobilePresenter.jsx';

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    socket.init()
      .then(() => setReady(true))
      .catch(err => {
        console.error('Failed to initialize databases:', err);
        setError(err.message || 'Failed to load scripture databases.');
      });
  }, []);

  if (error) {
    return (
      <div style={{ padding: 24, color: '#c9a84c', background: '#0a0a0f', minHeight: '100vh', fontFamily: 'sans-serif' }}>
        <h2>Failed to load</h2>
        <p>{error}</p>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: '#0a0a0f', color: '#c9a84c', fontFamily: 'sans-serif' }}>
        <p>Loading scriptures...</p>
      </div>
    );
  }

  return <MobilePresenter />;
}
