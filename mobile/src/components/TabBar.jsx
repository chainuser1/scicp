import './TabBar.css';

const TABS = [
  { id: 'search',   icon: '🔍', label: 'Search' },
  { id: 'preview',  icon: '≡',  label: 'Preview' },
  { id: 'setlists', icon: '☰',  label: 'Setlist' },
  { id: 'browse',   icon: '⊞',  label: 'Browse' },
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
