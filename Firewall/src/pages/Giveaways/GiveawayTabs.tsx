
import { NavLink, useLocation } from 'react-router-dom';

import styles from './GiveawayPages.module.css';

const TABS = [
  { key: 'active', label: 'Active', to: '/giveaway/active' },
  { key: 'create', label: 'Create', to: '/giveaway/create' },
  { key: 'history', label: 'History', to: '/giveaway/history' },
];

export function GiveawayTabs() {
  const location = useLocation();

  return (
    <nav className={styles.tabs} aria-label='Giveaway sections'>
      {TABS.map((tab) => (
        <NavLink
          key={tab.key}
          to={tab.to}
          className={({ isActive }) => [styles.tab, isActive || (tab.key === 'active' && location.pathname === '/giveaway') ? styles.tabActive : null].filter(Boolean).join(' ')}
          end={tab.key !== 'active'}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
