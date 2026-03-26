import './SubTabs.css';

const TABS = [
  { id: 'search',  label: 'Search' },
  { id: 'recent',  label: 'Recent' },
  { id: 'setlist', label: 'Setlist' },
  { id: 'browse',  label: 'Browse' },
];

export default function SubTabs({ active, onChange }) {
  return (
    <div className="sub-tabs">
      {TABS.map(t => (
        <button
          key={t.id}
          className={`sub-tab ${active === t.id ? 'sub-tab-active' : ''}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
