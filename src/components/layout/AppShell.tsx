import { useMemo } from 'react';
import { Outlet, useLocation, useNavigate, matchPath } from 'react-router-dom';
import { hapticFeedback } from '@telegram-apps/sdk-react';

import styles from './AppShell.module.css';

type TabKey = 'dashboard' | 'profile' | 'settings' | 'premium';

type TabDefinition = {
    key: TabKey;
    path: string;
    label: string;
    icon: (active: boolean) => JSX.Element;
};

// Zero-Latency Haptic Helper
const triggerHaptic = () => {
    try {
        if (hapticFeedback.impactOccurred.isAvailable()) {
            hapticFeedback.impactOccurred('light');
        }
    } catch (e) {
        // Fallback or ignore
    }
};

const tabs: TabDefinition[] = [
    { key: 'dashboard', path: '/', label: 'HOME', icon: (active) => <DashboardIcon active={active} /> },
    { key: 'settings', path: '/settings', label: 'CONFIG', icon: (active) => <SettingsIcon active={active} /> },
    { key: 'premium', path: '/premium', label: 'PREMIUM', icon: (active) => <PremiumIcon active={active} /> },
    { key: 'profile', path: '/profile', label: 'PROFILE', icon: (active) => <ProfileIcon active={active} /> },
];

function isTabActive(tabPath: string, pathname: string): boolean {
    if (tabPath === '/') {
        return pathname === '/';
    }
    return matchPath({ path: tabPath, end: false }, pathname) != null;
}

export function AppShell() {
    const location = useLocation();
    const navigate = useNavigate();

    const activeTabKey = useMemo(() => {
        const match = tabs.find((tab) => isTabActive(tab.path, location.pathname));
        return match?.key ?? null;
    }, [location.pathname]);



    return (
        <div className={styles.shell}>
            <header className={styles.header}>
                <div className={styles.headerTitle}>
                    <FirewallLogo />
                    FIREWALL
                </div>
            </header>

            <main className={styles.main}>
                <Outlet />
            </main>

            <nav className={styles.tabBar}>
                {tabs.map((tab) => {
                    const active = tab.key === activeTabKey;
                    const className = [styles.tabButton, active ? styles.tabButtonActive : null].filter(Boolean).join(' ');
                    return (
                        <button
                            key={tab.key}
                            type='button'
                            className={className}
                            onClick={() => {
                                if (!active) {
                                    triggerHaptic();
                                    navigate(tab.path);
                                }
                            }}
                        >
                            <span className={styles.tabIconWrapper}>{tab.icon(active)}</span>
                            <span className={styles.tabLabel}>{tab.label}</span>
                        </button>
                    );
                })}
            </nav>
        </div>
    );
}

type IconProps = { active: boolean };

function DashboardIcon({ active }: IconProps) {
    const color = active ? 'var(--magma-primary)' : 'var(--text-muted)';
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
            <line x1="8" y1="21" x2="16" y2="21"></line>
            <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
    );
}

function SettingsIcon({ active }: IconProps) {
    const color = active ? 'var(--magma-primary)' : 'var(--text-muted)';
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
    );
}

function PremiumIcon({ active }: IconProps) {
    const color = active ? 'var(--status-premium)' : 'var(--text-muted)';
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
        </svg>
    );
}

function ProfileIcon({ active }: IconProps) {
    const color = active ? 'var(--magma-primary)' : 'var(--text-muted)';
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
            <circle cx="12" cy="7" r="4"></circle>
        </svg>
    );
}

function FirewallLogo() {
    return (
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="url(#magma-gradient-id)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <defs>
                <linearGradient id="magma-gradient-id" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="#FF4500" />
                    <stop offset="100%" stopColor="#FF0000" />
                </linearGradient>
            </defs>
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
        </svg>
    )
}
