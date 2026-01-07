import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { hapticFeedback, openLink } from '@telegram-apps/sdk-react';
import type { FC } from 'react';

import { Page } from '@/components/Page.tsx';

import styles from './IndexPage.module.css';

// ═══════════════════════════════════════════════════════════════════════════
// 🔥 FIREWALL - Quick Start Page
// ═══════════════════════════════════════════════════════════════════════════

const QUICK_LINKS = [
  {
    id: 'dashboard',
    icon: '🏠',
    title: 'Dashboard',
    subtitle: 'Your command center',
    route: '/',
  },
  {
    id: 'groups',
    icon: '🛡️',
    title: 'My Groups',
    subtitle: 'Manage protected groups',
    route: '/my-groups',
  },
  {
    id: 'missions',
    icon: '🎯',
    title: 'Missions',
    subtitle: 'Complete tasks, earn XP',
    route: '/missions',
  },
  {
    id: 'profile',
    icon: '👤',
    title: 'Profile',
    subtitle: 'Your stats & badges',
    route: '/profile',
  },
  {
    id: 'premium',
    icon: '⭐',
    title: 'Premium',
    subtitle: 'Unlock all features',
    route: '/premium',
  },
] as const;

const SUPPORT_LINKS = [
  {
    id: 'channel',
    icon: '📢',
    title: 'Official Channel',
    subtitle: 'News & updates',
    url: 'https://t.me/firewall',
  },
  {
    id: 'support',
    icon: '💬',
    title: 'Support Chat',
    subtitle: 'Get help from our team',
    url: 'https://t.me/firewallsupport',
  },
] as const;

export const IndexPage: FC = () => {
  const navigate = useNavigate();

  const handleRoute = (route: string) => {
    hapticFeedback.impactOccurred('light');
    navigate(route);
  };

  const handleExternalLink = (url: string) => {
    hapticFeedback.impactOccurred('light');
    openLink(url);
  };

  return (
    <Page back={false}>
      <div className={styles.page}>
        {/* Hero Section */}
        <section className={styles.hero}>
          <div className={styles.heroIcon}>🔥</div>
          <h1 className={styles.heroTitle}>Firewall</h1>
          <p className={styles.heroSubtitle}>
            Advanced Protection for Telegram Groups
          </p>
        </section>

        {/* Quick Navigation */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>QUICK NAVIGATION</h2>
          <div className={styles.grid}>
            {QUICK_LINKS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.card}
                onClick={() => handleRoute(item.route)}
              >
                <span className={styles.cardIcon}>{item.icon}</span>
                <span className={styles.cardTitle}>{item.title}</span>
                <span className={styles.cardSubtitle}>{item.subtitle}</span>
              </button>
            ))}
          </div>
        </section>

        {/* Support Links */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>SUPPORT & COMMUNITY</h2>
          <div className={styles.list}>
            {SUPPORT_LINKS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.listItem}
                onClick={() => handleExternalLink(item.url)}
              >
                <span className={styles.listIcon}>{item.icon}</span>
                <div className={styles.listContent}>
                  <span className={styles.listTitle}>{item.title}</span>
                  <span className={styles.listSubtitle}>{item.subtitle}</span>
                </div>
                <span className={styles.listArrow}>→</span>
              </button>
            ))}
          </div>
        </section>

        {/* Version Footer */}
        <footer className={styles.footer}>
          <span>Firewall Bot v2.0</span>
          <span>•</span>
          <span>Made with 🔥</span>
        </footer>
      </div>
    </Page>
  );
};
