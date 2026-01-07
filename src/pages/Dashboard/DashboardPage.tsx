import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { hapticFeedback } from '@telegram-apps/sdk-react';

import { PromoSlider } from '@/features/dashboard/PromoSlider';
import { useDashboardData } from '@/features/dashboard/useDashboardData';
import { useOwnerProfile } from '@/features/dashboard/useOwnerProfile';
import { LoadingState } from '@/components/LoadingState';
import type { ManagedGroup } from '@/features/dashboard/types';

import styles from './DashboardPage.module.css';

// ═══════════════════════════════════════════════════════════════════════════
// 🔥 FIREWALL DASHBOARD - Telegram Group Management Hub
// ═══════════════════════════════════════════════════════════════════════════

const TEXT = {
  greeting: 'COMMAND CENTER',
  badge: '🔥 Firewall Operator',
  stats: {
    groups: 'Groups Managed',
    members: 'Total Members',
    messages: 'Messages Today',
    premium: 'Premium Active',
  },
  actions: {
    addGroup: 'Add Group',
    addGroupHint: 'Protect new groups',
    premium: 'Get Premium',
    premiumHint: 'Unlock all features',
    missions: 'Missions',
    missionsHint: 'Earn XP rewards',
    profile: 'Profile',
    profileHint: 'Your stats & badges',
  },
  sections: {
    groups: 'YOUR GROUPS',
    viewAll: 'View All',
    news: 'LATEST UPDATES',
  },
  empty: {
    icon: '🛡️',
    title: 'No Groups Yet',
    description: 'Add Firewall bot to your Telegram groups to start protecting them.',
    action: 'Add First Group',
  },
  status: {
    online: 'Bot Online • All Systems Operational',
  },
};

function getInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  if (words.length === 1) return words[0]?.charAt(0).toUpperCase() ?? '?';
  return `${words[0]?.charAt(0) ?? ''}${words[1]?.charAt(0) ?? ''}`.toUpperCase();
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function getGroupStatusClass(group: ManagedGroup): string {
  if (group.subscriptionType !== 'premium') return styles.groupStatusFree ?? '';
  if (group.status.kind === 'expired') return styles.groupStatusExpired ?? '';
  return styles.groupStatusActive ?? '';
}

function getGroupStatusLabel(group: ManagedGroup): string {
  if (group.subscriptionType !== 'premium') return '🆓 Free';
  if (group.status.kind === 'expired') return '⭐ Expired';
  if (group.status.kind === 'active' && typeof group.status.daysLeft === 'number') {
    return `⭐ ${group.status.daysLeft}d`;
  }
  return '⭐ Premium';
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { displayName, avatarUrl } = useOwnerProfile();
  const { groups, insights, promotions, loading, summary } = useDashboardData();

  // Calculate total members across all groups
  const totalMembers = useMemo(() => {
    return groups.reduce((sum, g) => sum + (g.memberCount ?? 0), 0);
  }, [groups]);

  // Handle navigation with haptic feedback
  const handleNavigate = useCallback((path: string) => {
    hapticFeedback.impactOccurred('light');
    navigate(path);
  }, [navigate]);

  const handleGroupClick = useCallback((group: ManagedGroup) => {
    hapticFeedback.impactOccurred('light');
    navigate(`/groups/${group.id}`, { state: { group } });
  }, [navigate]);

  if (loading) return <LoadingState />;

  return (
    <div className={styles.page}>
      {/* ────────────────────────────────────────────────────────────────────
          Hero Welcome Card
          ──────────────────────────────────────────────────────────────────── */}
      <section className={styles.heroCard}>
        <div className={styles.heroHeader}>
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className={styles.heroAvatar} />
          ) : (
            <div className={styles.heroAvatarFallback}>
              {displayName?.charAt(0)?.toUpperCase() ?? '👤'}
            </div>
          )}
          <div className={styles.heroMeta}>
            <span className={styles.heroGreeting}>{TEXT.greeting}</span>
            <h1 className={styles.heroName}>{displayName ?? 'Operator'}</h1>
            <div className={styles.heroBadge}>{TEXT.badge}</div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────────
          Stats Grid - Real Telegram Bot Metrics
          ──────────────────────────────────────────────────────────────────── */}
      <section className={styles.statsGrid}>
        <div className={styles.statCard} data-tone="groups">
          <span className={styles.statIcon}>🛡️</span>
          <span className={styles.statValue}>{summary.total}</span>
          <span className={styles.statLabel}>{TEXT.stats.groups}</span>
          {summary.total > 0 && (
            <span className={`${styles.statDelta} ${styles.statDeltaPositive}`}>
              {summary.active} active
            </span>
          )}
        </div>

        <div className={styles.statCard} data-tone="members">
          <span className={styles.statIcon}>👥</span>
          <span className={styles.statValue}>{formatNumber(totalMembers)}</span>
          <span className={styles.statLabel}>{TEXT.stats.members}</span>
          {insights.newMembersToday > 0 && (
            <span className={`${styles.statDelta} ${styles.statDeltaPositive}`}>
              +{insights.newMembersToday} today
            </span>
          )}
        </div>

        <div className={styles.statCard} data-tone="messages">
          <span className={styles.statIcon}>💬</span>
          <span className={styles.statValue}>{formatNumber(insights.messagesToday)}</span>
          <span className={styles.statLabel}>{TEXT.stats.messages}</span>
          {insights.messagesToday > 0 && (
            <span className={`${styles.statDelta} ${styles.statDeltaNeutral}`}>
              Active chat
            </span>
          )}
        </div>

        <div className={styles.statCard} data-tone="premium">
          <span className={styles.statIcon}>⭐</span>
          <span className={styles.statValue}>{summary.active}</span>
          <span className={styles.statLabel}>{TEXT.stats.premium}</span>
          {insights.expiringSoon > 0 && (
            <span className={`${styles.statDelta} ${styles.statDeltaNeutral}`}>
              {insights.expiringSoon} expiring soon
            </span>
          )}
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────────
          Bot Status Bar
          ──────────────────────────────────────────────────────────────────── */}
      <div className={styles.statusBar}>
        <span className={styles.statusDot} />
        <span className={styles.statusText}>{TEXT.status.online}</span>
      </div>

      {/* ────────────────────────────────────────────────────────────────────
          Quick Actions Grid
          ──────────────────────────────────────────────────────────────────── */}
      <section className={styles.actionsGrid}>
        <button
          type="button"
          className={styles.actionCard}
          onClick={() => handleNavigate('/my-groups')}
        >
          <span className={styles.actionIcon}>➕</span>
          <span className={styles.actionLabel}>{TEXT.actions.addGroup}</span>
          <span className={styles.actionHint}>{TEXT.actions.addGroupHint}</span>
        </button>

        <button
          type="button"
          className={styles.actionCard}
          onClick={() => handleNavigate('/premium')}
        >
          <span className={styles.actionIcon}>⭐</span>
          <span className={styles.actionLabel}>{TEXT.actions.premium}</span>
          <span className={styles.actionHint}>{TEXT.actions.premiumHint}</span>
        </button>

        <button
          type="button"
          className={styles.actionCard}
          onClick={() => handleNavigate('/missions')}
        >
          <span className={styles.actionIcon}>🎯</span>
          <span className={styles.actionLabel}>{TEXT.actions.missions}</span>
          <span className={styles.actionHint}>{TEXT.actions.missionsHint}</span>
        </button>

        <button
          type="button"
          className={styles.actionCard}
          onClick={() => handleNavigate('/profile')}
        >
          <span className={styles.actionIcon}>👤</span>
          <span className={styles.actionLabel}>{TEXT.actions.profile}</span>
          <span className={styles.actionHint}>{TEXT.actions.profileHint}</span>
        </button>
      </section>

      {/* ────────────────────────────────────────────────────────────────────
          Your Groups List
          ──────────────────────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{TEXT.sections.groups}</h2>
          {groups.length > 3 && (
            <button
              type="button"
              className={styles.sectionAction}
              onClick={() => handleNavigate('/my-groups')}
            >
              {TEXT.sections.viewAll}
            </button>
          )}
        </div>

        {groups.length === 0 ? (
          <div className={styles.emptyState}>
            <span className={styles.emptyIcon}>{TEXT.empty.icon}</span>
            <h3 className={styles.emptyTitle}>{TEXT.empty.title}</h3>
            <p className={styles.emptyDescription}>{TEXT.empty.description}</p>
            <button
              type="button"
              className={styles.emptyAction}
              onClick={() => handleNavigate('/my-groups')}
            >
              {TEXT.empty.action}
            </button>
          </div>
        ) : (
          <div className={styles.groupsList}>
            {groups.slice(0, 4).map((group) => (
              <div
                key={group.id}
                className={styles.groupItem}
                onClick={() => handleGroupClick(group)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && handleGroupClick(group)}
              >
                {group.photoUrl ? (
                  <img src={group.photoUrl} alt="" className={styles.groupAvatar} />
                ) : (
                  <div className={styles.groupAvatarFallback}>
                    {getInitials(group.title)}
                  </div>
                )}
                <div className={styles.groupInfo}>
                  <h3 className={styles.groupName}>{group.title}</h3>
                  <span className={styles.groupMeta}>
                    {formatNumber(group.memberCount ?? 0)} members
                  </span>
                </div>
                <span className={`${styles.groupStatus} ${getGroupStatusClass(group)}`}>
                  {getGroupStatusLabel(group)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ────────────────────────────────────────────────────────────────────
          News/Promo Slider
          ──────────────────────────────────────────────────────────────────── */}
      {promotions.slots.length > 0 && (
        <section className={styles.newsSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>{TEXT.sections.news}</h2>
          </div>
          <div className={styles.sliderContainer}>
            <PromoSlider
              slots={promotions.slots}
              rotationSeconds={5}
              metadata={promotions.metadata}
            />
          </div>
        </section>
      )}
    </div>
  );
}
