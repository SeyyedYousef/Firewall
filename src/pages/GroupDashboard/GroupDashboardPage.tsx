import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Button, IconButton, Placeholder, Snackbar } from '@telegram-apps/telegram-ui';

import { GroupMenuDrawer } from '@/features/dashboard/GroupMenuDrawer.tsx';
import { fetchGroupDetails } from '@/features/dashboard/api.ts';
import type { GroupDetail, GroupWarning, ManagedGroup } from '@/features/dashboard/types.ts';
import { formatNumber } from '@/utils/format.ts';

import styles from './GroupDashboardPage.module.css';

const DAY_MS = 86_400_000;

const TEXT = {
  errorHeader: 'Failed to load group',
  errorDescription: 'Please try again or return to My Groups.',
  unavailableHeader: 'Group unavailable',
  unavailableDescription: 'Could not load group data. Please try again.',
  retry: 'Retry',
  heroSubline: 'Quick overview',
  settingsTitle: 'Settings',
  menuActionTitle: 'Quick menu',
  warningsTitle: 'Recent Activity',
  warningsHint: 'Bot actions and interventions',
  warningsEmpty: 'No activity in the last 7 days.',
  removedTitle: 'Bot is not an admin here',
  removedDescription: 'Re-add the bot to restore automations and protections.',
  quickMenu: 'Open modules',
  menuGuidance: 'Tap menu to configure settings.',
  viewMore: 'View all',
};

type LocationState = {
  group?: ManagedGroup;
};

function initialsFromTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (!words.length) {
    return '?';
  }
  if (words.length === 1) {
    return words[0]?.charAt(0).toUpperCase() ?? '?';
  }
  return `${words[0]?.charAt(0) ?? ''}${words[1]?.charAt(0) ?? ''}`.toUpperCase();
}

function formatRelative(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function severityClass(severity: GroupWarning['severity']): string {
  switch (severity) {
    case 'critical':
      return styles.severityCritical || '';
    case 'warning':
      return styles.severityWarning || '';
    default:
      return styles.severityInfo || '';
  }
}

function resolveCreditBadge(group: ManagedGroup, remainingMs: number, isExpired: boolean): { label: string; className: string } {
  if (group.status.kind === 'removed') {
    return { label: 'Removed', className: styles.statusBadgeDanger || '' };
  }
  
  // Free groups don't expire
  if (group.subscriptionType !== 'premium') {
    return { label: '🆓 Free Plan', className: styles.statusBadge || '' };
  }
  
  // Premium group expired
  if (isExpired || group.status.kind === 'expired') {
    return { label: '⭐ Premium Expired', className: styles.statusBadgeDanger || '' };
  }

  const daysLeft = group.status.kind === 'active'
    ? typeof group.status.daysLeft === 'number'
      ? group.status.daysLeft
      : Math.max(0, Math.ceil(remainingMs / DAY_MS))
    : Math.max(0, Math.ceil(remainingMs / DAY_MS));

  if (daysLeft <= 5) {
    return { label: `⭐ Premium: ${daysLeft} days`, className: styles.statusBadgeDanger || '' };
  }
  if (daysLeft <= 10) {
    return { label: `⭐ Premium: ${daysLeft} days`, className: styles.statusBadgeWarning || '' };
  }
  return { label: `⭐ Premium: ${daysLeft} days`, className: styles.statusBadge || '' };
}

function trendClass(direction: 'up' | 'down' | 'flat'): string {
  if (direction === 'up') {
    return styles.deltaPositive || '';
  }
  if (direction === 'down') {
    return styles.deltaNegative || '';
  }
  return styles.deltaNeutral || '';
}

export function GroupDashboardPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;
    let intervalId: number | undefined;

    const load = async () => {
      try {
        const data = await fetchGroupDetails(groupId);
        if (cancelled) {
          return;
        }
        setDetail(data);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      }
    };

    const refresh = async () => {
      if (cancelled) {
        return;
      }
      try {
        const data = await fetchGroupDetails(groupId);
        if (cancelled) {
          return;
        }
        setDetail(data);
        setError(null);
      } catch (err) {
        // Silent refresh failure - don't update error state
        console.warn('[GroupDashboard] Refresh failed:', err);
      }
    };

    void load();

    // Auto-refresh every 10 seconds for real-time updates
    intervalId = window.setInterval(() => {
      void refresh();
    }, 10_000);

    return () => {
      cancelled = true;
      if (intervalId !== undefined) {
        clearInterval(intervalId);
      }
    };
  }, [groupId]);

  const group = detail?.group ?? state.group;
  const metrics = detail?.metrics;
  const warnings = detail?.warnings ?? [];

  const creditBadge = group && metrics
    ? resolveCreditBadge(group, metrics.remainingMs, metrics.isExpired)
    : null;

  const stats = useMemo(() => {
    if (!metrics) {
      return [];
    }

    return [
      {
        key: 'members',
        label: 'Total Members',
        value: formatNumber(metrics.membersTotal),
        delta: metrics.newMembersToday > 0 ? `+${metrics.newMembersToday} today` : 'No change today',
        tone: trendClass(metrics.newMembersToday > 0 ? 'up' : 'flat'),
      },
      {
        key: 'messages',
        label: "Today's Messages",
        value: formatNumber(metrics.messagesToday),
        delta: metrics.messagesToday > 0 ? 'Active chat' : 'Quiet day',
        tone: trendClass(metrics.messagesToday > 0 ? 'up' : 'flat'),
      },
      {
        key: 'newMembers',
        label: 'New Members Today',
        value: formatNumber(metrics.newMembersToday),
        delta: metrics.newMembersToday > 0 ? 'Growing' : 'Stable',
        tone: trendClass(metrics.newMembersToday > 0 ? 'up' : 'flat'),
      },
    ];
  }, [metrics]);

  const handleOpenMenu = () => {
    if (!groupId) {
      return;
    }
    console.info('[telemetry] group_menu_opened_hint', groupId);
    setMenuOpen(true);
  };

  const handleOpenSettings = () => {
    if (!groupId) {
      return;
    }

    navigate(`/groups/${groupId}/settings/general`, { state: { group } });
  };

  const handleRetry = useCallback(() => {
    if (!groupId) {
      return;
    }
    setDetail(null);
    setError(null);
    void fetchGroupDetails(groupId)
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      });
  }, [groupId]);



  if (!groupId) {
    return (
      <Placeholder
        header={TEXT.errorHeader}
        description='Group identifier is missing.'
      />
    );
  }

  if (error) {
    return (
      <Placeholder
        header={TEXT.errorHeader}
        description={TEXT.errorDescription}
      >
        <Button mode='filled' onClick={handleRetry}>
          {TEXT.retry}
        </Button>
      </Placeholder>
    );
  }

  if (!group || !metrics) {
    return (
      <Placeholder
        header={TEXT.unavailableHeader}
        description={TEXT.unavailableDescription}
      >
        <Button mode='filled' onClick={handleRetry}>
          {TEXT.retry}
        </Button>
      </Placeholder>
    );
  }

  return (
    <div className={styles.page} dir='ltr'>
      <section className={styles.heroCard}>
        <IconButton
          className={styles.menuButton}
          onClick={handleOpenMenu}
          aria-label={TEXT.quickMenu}
        >
          <span className={styles.menuBurger} aria-hidden='true'>
            <span />
            <span />
            <span />
          </span>
        </IconButton>
        <div className={styles.heroHeader}>
          <Avatar
            size={48}
            src={group.photoUrl ?? undefined}
            acronym={group.photoUrl ? undefined : (initialsFromTitle(group.title) ?? undefined)}
            alt={group.title}
          />
          <div className={styles.heroMeta}>
            <h1 className={styles.heroTitle}>{group.title}</h1>
            <p className={styles.heroSubline}>{TEXT.heroSubline}</p>
            {creditBadge && (
              <span className={`${styles.statusBadge} ${creditBadge.className}`}>{creditBadge.label}</span>
            )}
          </div>
        </div>

        <div className={styles.statsRow}>
          {stats.map((stat) => (
            <div key={stat.key} className={styles.statCard}>
              <p className={styles.statLabel}>{stat.label}</p>
              <p className={styles.statValue}>{stat.value}</p>
              <span className={`${styles.statDelta} ${stat.tone}`}>{stat.delta}</span>
            </div>
          ))}
        </div>

        <p className={styles.heroHint}>{TEXT.menuGuidance}</p>

        {group.status.kind === 'removed' && (
          <div className={styles.removedBanner}>
            <p className={styles.removedTitle}>{TEXT.removedTitle}</p>
            <p className={styles.removedDescription}>{TEXT.removedDescription}</p>
          </div>
        )}

        <div className={styles.quickActions}>
          <button
            type='button'
            className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
            onClick={handleOpenSettings}
          >
            ⚙️ {TEXT.settingsTitle}
          </button>
          <button
            type='button'
            className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
            onClick={handleOpenMenu}
          >
            📋 {TEXT.menuActionTitle}
          </button>
        </div>
      </section>

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{TEXT.warningsTitle}</h2>
          <span className={styles.sectionHint}>{TEXT.warningsHint}</span>
        </header>
        {warnings.length === 0 && (
          <div className={styles.emptyItem}>{TEXT.warningsEmpty}</div>
        )}
        {warnings.length > 0 && (
          <div className={styles.list}>
            {warnings.slice(0, 4).map((warning) => (
              <div key={warning.id} className={styles.listItem}>
                <div className={styles.listItemContent}>
                  <p className={styles.listItemTitle}>{warning.member}</p>
                  <p className={styles.listItemSubtitle}>{warning.message}</p>
                  <span className={`${styles.severityBadge} ${severityClass(warning.severity)}`}>
                    {warning.rule}
                  </span>
                </div>
                <span className={styles.listTimestamp}>{formatRelative(warning.timestamp)}</span>
              </div>
            ))}
          </div>
        )}
        {warnings.length > 4 && (
          <div className={styles.secondaryActions}>
            <button type='button' className={styles.secondaryButton}>{TEXT.viewMore}</button>
          </div>
        )}
      </section>


      <GroupMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey='home'
        onSelect={(key) => {
          if (!groupId) {
            return;
          }
          switch (key) {
            case 'home':
              console.log('[Menu] Navigating to Dashboard:', groupId);
              navigate(`/groups/${groupId}`, { state: { group } });
              break;
            case 'settings':
              navigate(`/groups/${groupId}/settings/general`, { state: { group } });
              break;
            case 'bans':
              navigate(`/groups/${groupId}/settings/bans`, { state: { group } });
              break;
            case 'limits':
              navigate(`/groups/${groupId}/settings/limits`, { state: { group } });
              break;
            case 'mute':
              navigate(`/groups/${groupId}/settings/mute`, { state: { group } });
              break;
            case 'mandatory':
              navigate(`/groups/${groupId}/settings/mandatory`, { state: { group } });
              break;
            case 'texts':
              navigate(`/groups/${groupId}/settings/texts`, { state: { group } });
              break;
            case 'analytics':
              navigate(`/groups/${groupId}/analytics`, { state: { group } });
              break;
            default:
              console.info(`[group-dashboard] unknown menu item '${key}' selected`);
          }
        }}
      />

      {toast && (
        <Snackbar onClose={() => setToast('')} className={styles.snackbar}>
          {toast}
        </Snackbar>
      )}
    </div>
  );
}
