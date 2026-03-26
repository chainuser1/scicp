import './TabBar.css';

const TABS = [
  { id: 'search', icon: '🔍', label: 'Search' },
  { id: 'live',   icon: '📡', label: 'Live' },
  { id: 'reader', icon: '📖', label: 'Read' },
  { id: 'setlists', icon: '📋', label: 'Setlists' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
];

export default function TabBar({ active, onChange }) {
  return (
    <nav className="tab-bar safe-bottom">
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={`tab-item ${active === tab.id ? 'tab-active' : ''}`}
          onClick={() => onChange(tab.id)}
        >
          <span className="tab-icon">{tab.icon}</span>
          <span className="tab-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
