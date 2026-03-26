import './RootTabBar.css';

const TABS = [
  { id: 'home', icon: '🏠', label: 'Home' },
  { id: 'read', icon: '📖', label: 'Read' },
  { id: 'present', icon: '🎙️', label: 'Present' },
  { id: 'more', icon: '⋯', label: 'More' },
];

export default function RootTabBar({ active, onChange }) {
  return (
    <nav className="root-tab-bar safe-bottom">
      {TABS.map(t => (
        <button
          key={t.id}
          className={`root-tab ${active === t.id ? 'root-tab-active' : ''}`}
          onClick={() => onChange(t.id)}
          aria-label={t.label}
        >
          <span className="root-tab-icon">{t.icon}</span>
          <span className="root-tab-label">{t.label}</span>
        </button>
      ))}
    </nav>
  );
}
