import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import MobileClient from './pages/MobileClient.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <MobileClient />
  </StrictMode>,
);
