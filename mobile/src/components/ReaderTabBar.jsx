import { useMemo } from 'react';
import './ReaderTabBar.css';

const TABS = [
  { id: 'home', label: 'Home', icon: '🏠' },
  { id: 'browse', label: 'Browse', icon: '📖' },
  { id: 'reading', label: 'Reading', icon: '📑' },
  { id: 'bookmarks', label: 'Bookmarks', icon: '🔖' },
  { id: 'more', label: 'More', icon: '⋯' },
];

export default function ReaderTabBar({ active, onSelect }) {
  const tabs = useMemo(() => TABS, []);
  return (
    <nav className="rd-tabbar">
      {tabs.map(t => (
        <button
          key={t.id}
          className={`rd-tab${active === t.id ? ' rd-tab-active' : ''}`}
          onClick={() => onSelect(t.id)}
          aria-label={t.label}
        >
          <span className="rd-tab-icon">{t.icon}</span>
          <span className="rd-tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
