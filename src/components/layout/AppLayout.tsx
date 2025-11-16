import { useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { matchPath } from 'react-router-dom';

import styles from './AppLayout.module.css';

type TabKey = 'groups' | 'stars' | 'missions' | 'profile';

type TabDefinition = {
  key: TabKey;
  path: string;
  label: string;
  icon: (active: boolean) => JSX.Element;
};

const tabs: TabDefinition[] = [
  { key: 'groups', path: '/groups', label: 'My Groups', icon: (active) => <GroupsIcon active={active}/> },
  { key: 'stars', path: '/stars', label: 'Renew Group', icon: (active) => <RenewIcon active={active}/> },
  { key: 'missions', path: '/missions', label: 'Missions', icon: (active) => <MissionIcon active={active}/> },
  { key: 'profile', path: '/profile', label: 'Profile', icon: (active) => <UserIcon active={active}/> },
];

function isTabActive(tabPath: string, pathname: string): boolean {
  if (tabPath === '/groups') {
    return pathname === '/groups' || pathname.startsWith('/groups/');
  }
  return matchPath({ path: tabPath, end: false }, pathname) != null;
}

export function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();

  const activeTabKey = useMemo(() => {
    const match = tabs.find((tab) => isTabActive(tab.path, location.pathname));
    return match?.key ?? null;
  }, [location.pathname]);

  useEffect(() => {
    if (activeTabKey) {
      console.info('[telemetry] tab_opened', activeTabKey, location.pathname);
    }
  }, [activeTabKey, location.pathname]);

  const isGroupSettingsRoute = useMemo(
    () => matchPath('/groups/:groupId/settings/*', location.pathname) != null,
    [location.pathname],
  );

  const mainClassName = isGroupSettingsRoute ? styles.mainFluid : styles.main;
  const contentClassName = isGroupSettingsRoute ? styles.contentFluid : styles.content;

  return (
    <div className={styles.shell}>
      <main className={mainClassName}>
        <div className={contentClassName}>
          <Outlet/>
        </div>
      </main>

      {!isGroupSettingsRoute && (
        <nav className={styles.tabBar} aria-label='Primary navigation'>
          <div className={styles.tabList}>
            {tabs.map((tab) => {
              const active = tab.key === activeTabKey;
              const className = [styles.tabButton, active ? styles.tabButtonActive : null].filter(Boolean).join(' ');
              return (
                <button
                  key={tab.key}
                  type='button'
                  className={className}
                  aria-current={active ? 'page' : undefined}
                  onClick={() => {
                    if (!active) {
                      navigate(tab.path);
                    }
                  }}
                >
                  <span className={styles.tabIconWrapper}>{tab.icon(active)}</span>
                  <span className={styles.tabLabel}>{tab.label}</span>
                </button>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

type IconProps = {
  active: boolean;
};

function GroupsIcon({ active }: IconProps) {
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' fill='none' role='presentation'>
      <path d='M6.25 7.25c1.243 0 2.25-1.007 2.25-2.25S7.493 2.75 6.25 2.75 4 3.757 4 5s1.007 2.25 2.25 2.25Z' stroke={active ? 'var(--app-color-accent-cyan)' : 'currentColor'} strokeWidth='1.4' strokeLinecap='round'/>
      <path d='M11.75 8.5c1.104 0 2-.896 2-2s-.896-2-2-2-2 .896-2 2 .896 2 2 2Z' stroke={active ? 'var(--app-color-accent-cyan)' : 'currentColor'} strokeWidth='1.3' strokeLinecap='round'/>
      <path d='M2 13c.35-2 1.9-3.25 4.25-3.25S10.1 11 10.5 13' stroke={active ? 'var(--app-color-accent-cyan)' : 'currentColor'} strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
      <path d='M10.75 11.5c.6-.42 1.3-.75 2.5-.75 2.1 0 3.25 1.25 3.5 2.75' stroke={active ? 'var(--app-color-accent-cyan)' : 'currentColor'} strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
    </svg>
  );
}

function RenewIcon({ active }: IconProps) {
  const primary = active ? 'var(--app-color-accent-cyan)' : 'currentColor';
  const accent = active ? 'var(--app-color-accent-lime)' : 'currentColor';
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' fill='none' role='presentation'>
      <path d='M4.25 11.25a5.25 5.25 0 0 0 9 2.55' stroke={primary} strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
      <path d='M13.75 6.75a5.25 5.25 0 0 0-9-2.55' stroke={primary} strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
      <path d='M5.5 12.5H3v-2.5' stroke={primary} strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
      <path d='M12.5 5.5H15V8' stroke={primary} strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
      <path d='M9 6.75a2.25 2.25 0 1 1 0 4.5 2.25 2.25 0 0 1 0-4.5Z' stroke={accent} strokeWidth='1.2' strokeLinecap='round' strokeLinejoin='round'/>
      <path d='M9 5v1.25' stroke={accent} strokeWidth='1.2' strokeLinecap='round'/>
      <path d='M9 11.75V13' stroke={accent} strokeWidth='1.2' strokeLinecap='round'/>
    </svg>
  );
}
function MissionIcon({ active }: IconProps) {
  const stroke = active ? 'var(--app-color-accent-cyan)' : 'currentColor';
  const fill = active ? 'var(--app-color-accent-green)' : 'none';
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' fill='none' role='presentation'>
      <path
        d='M8.99999 2.25L10.8476 5.99652L15 6.5793L11.9 9.54348L12.6952 13.75L8.99999 11.725L5.30479 13.75L6.09999 9.54348L2.99999 6.5793L7.15239 5.99652L8.99999 2.25Z'
        stroke={stroke}
        strokeWidth='1.25'
        strokeLinejoin='round'
        fill={fill}
      />
      <path
        d='M9 6.75L9.8 8.35L11.55 8.57L10.25 9.82L10.57 11.55L9 10.72L7.43 11.55L7.75 9.82L6.45 8.57L8.2 8.35L9 6.75Z'
        fill={stroke}
        fillOpacity={active ? 1 : 0.55}
      />
    </svg>
  );
}
function UserIcon({ active }: IconProps) {
  const color = active ? 'var(--app-color-accent-cyan)' : 'currentColor';
  return (
    <svg width='18' height='18' viewBox='0 0 18 18' fill='none' role='presentation'>
      <circle cx='9' cy='5.75' r='2.75' stroke={color} strokeWidth='1.3'/>
      <path d='M3.5 14.25c.55-2.45 2.8-3.5 5.5-3.5s4.95 1.05 5.5 3.5' stroke={color} strokeWidth='1.3' strokeLinecap='round' strokeLinejoin='round'/>
    </svg>
  );
}

