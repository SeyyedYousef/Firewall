import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { Avatar, Button, IconButton, Placeholder, Snackbar, Switch } from '@telegram-apps/telegram-ui';

import { GroupMenuDrawer } from '@/features/dashboard/GroupMenuDrawer.tsx';
import { fetchGroupDetails, updateGroupLockStatus } from '@/features/dashboard/api.ts';
import type { GroupBotAction, GroupDetail, GroupWarning, ManagedGroup } from '@/features/dashboard/types.ts';
import { formatNumber, formatSignedPercent } from '@/utils/format.ts';

import styles from './GroupDashboardPage.module.css';

const DAY_MS = 86_400_000;

const TEXT = {
  loadingHeader: 'Loading group',
  loadingDescription: 'Fetching the latest stats...',
  errorHeader: 'Failed to load group',
  errorDescription: 'Please try again or return to My Groups.',
  retry: 'Retry',
  heroSubline: 'Quick overview',
  lockTitle: 'Lock group',
  analyticsTitle: 'Analytics',
  settingsTitle: 'Open settings',
  menuActionTitle: 'Open quick menu',
  warningsTitle: 'Recent warnings',
  warningsHint: 'Last automated interventions',
  warningsEmpty: 'No warnings in the last 24 hours.',
  actionsTitle: 'Latest bot actions',
  actionsHint: 'Firewall automation log',
  actionsEmpty: 'No automated actions recorded yet.',
  removedTitle: 'Bot is not an admin here',
  removedDescription: 'Re-add the bot to restore automations and protections.',
  toastLockEnabled: 'Group locked. Members cannot send messages.',
  toastLockDisabled: 'Group unlocked. Members can chat again.',
  quickMenu: 'Open modules',
  menuGuidance: 'Tap the menu button to open settings and choose the section you need.',
  viewMore: 'View all warnings',
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
    return words[0].charAt(0).toUpperCase();
  }
  return `${words[0].charAt(0)}${words[1].charAt(0)}`.toUpperCase();
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
      return styles.severityCritical;
    case 'warning':
      return styles.severityWarning;
    default:
      return styles.severityInfo;
  }
}

function resolveCreditBadge(group: ManagedGroup, remainingMs: number, isExpired: boolean): { label: string; className: string } {
  if (group.status.kind === 'removed') {
    return { label: 'Removed', className: styles.statusBadgeDanger };
  }
  if (isExpired || group.status.kind === 'expired') {
    return { label: 'Expired', className: styles.statusBadgeDanger };
  }

  const daysLeft = group.status.kind === 'active'
    ? typeof group.status.daysLeft === 'number'
      ? group.status.daysLeft
      : Math.max(0, Math.ceil(remainingMs / DAY_MS))
    : Math.max(0, Math.ceil(remainingMs / DAY_MS));

  if (daysLeft <= 5) {
    return { label: `Expiring in ${daysLeft} days`, className: styles.statusBadgeDanger };
  }
  if (daysLeft <= 10) {
    return { label: `Expiring in ${daysLeft} days`, className: styles.statusBadgeWarning };
  }
  return { label: `Credit: ${daysLeft} days left`, className: styles.statusBadge };
}

function trendClass(direction: 'up' | 'down' | 'flat'): string {
  if (direction === 'up') {
    return styles.deltaPositive;
  }
  if (direction === 'down') {
    return styles.deltaNegative;
  }
  return styles.deltaNeutral;
}

export function GroupDashboardPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [detail, setDetail] = useState<GroupDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;
    let intervalId: number | undefined;

    const load = async () => {
      try {
        setLoading(true);
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
      } finally {
        if (!cancelled) {
          setLoading(false);
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
  const actions = detail?.botActions ?? [];

  const creditBadge = group && metrics
    ? resolveCreditBadge(group, metrics.remainingMs, metrics.isExpired)
    : null;

  const stats = useMemo(() => {
    if (!metrics) {
      return [];
    }
    const membersDelta = formatSignedPercent(metrics.membersTrend.direction, metrics.membersTrend.percent);
    const messagesDelta = formatSignedPercent(metrics.messagesTrend.direction, metrics.messagesTrend.percent);
    const newcomersDelta = formatSignedPercent(metrics.newMembersTrend.direction, metrics.newMembersTrend.percent);

    return [
      {
        key: 'members',
        label: 'Members',
        value: formatNumber(metrics.membersTotal),
        delta: `${membersDelta} vs yesterday`,
        tone: trendClass(metrics.membersTrend.direction),
      },
      {
        key: 'messages',
        label: "Today's messages",
        value: formatNumber(metrics.messagesToday),
        delta: `${messagesDelta} vs yesterday`,
        tone: trendClass(metrics.messagesTrend.direction),
      },
      {
        key: 'newMembers',
        label: 'New members',
        value: formatNumber(metrics.newMembersToday),
        delta: `${newcomersDelta} vs yesterday`,
        tone: trendClass(metrics.newMembersTrend.direction),
      },
    ];
  }, [metrics]);

  const toggleLock = async (next?: boolean) => {
    if (!groupId) {
      return;
    }
    const nextState = typeof next === 'boolean' ? next : !locked;
    try {
      await updateGroupLockStatus(groupId, nextState);
      setLocked(nextState);
      setToast(nextState ? TEXT.toastLockEnabled : TEXT.toastLockDisabled);
    } catch (error) {
      console.error('[Lock] Failed:', error);
      setToast('Failed to update lock status');
    }
  };

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

  const handleAnalytics = () => {
    if (!groupId) {
      return;
    }

    navigate(`/groups/${groupId}/analytics`, { state: { group } });
  };

  const handleRetry = useCallback(() => {
    if (!groupId) {
      return;
    }
    setDetail(null);
    setError(null);
    setLoading(true);
    void fetchGroupDetails(groupId)
      .then((data) => {
        setDetail(data);
        setError(null);
      })
      .catch((err) => {
        setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        setLoading(false);
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

  if (loading && !group) {
    return (
      <Placeholder
        header={TEXT.loadingHeader}
        description={TEXT.loadingDescription}
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
        header='Group unavailable'
        description='This group could not be loaded. Please return to My Groups.'
      />
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
            acronym={group.photoUrl ? undefined : initialsFromTitle(group.title)}
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
            className={`${styles.actionButton} ${styles.actionToggle}`}
            onClick={() => {
              void toggleLock();
            }}
          >
            <span>{TEXT.lockTitle}</span>
            <Switch
              checked={locked}
              onChange={(event) => {
                event.stopPropagation();
                void toggleLock(event.target.checked);
              }}
              onClick={(event) => event.stopPropagation()}
            />
          </button>
          <button
            type='button'
            className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
            onClick={handleOpenMenu}
          >
            {TEXT.menuActionTitle}
          </button>
          <button
            type='button'
            className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
            onClick={handleAnalytics}
          >
            {TEXT.analyticsTitle}
          </button>
          <button
            type='button'
            className={`${styles.actionButton} ${styles.actionButtonSecondary}`}
            onClick={handleOpenSettings}
          >
            {TEXT.settingsTitle}
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

      <section className={styles.section}>
        <header className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>{TEXT.actionsTitle}</h2>
          <span className={styles.sectionHint}>{TEXT.actionsHint}</span>
        </header>
        {actions.length === 0 && (
          <div className={styles.emptyItem}>{TEXT.actionsEmpty}</div>
        )}
        {actions.length > 0 && (
          <div className={styles.list}>
            {actions.slice(0, 5).map((action: GroupBotAction) => (
              <div key={action.id} className={styles.listItem}>
                <div className={styles.listItemContent}>
                  <p className={styles.listItemTitle}>{action.action}</p>
                  <p className={styles.listItemSubtitle}>
                    {action.target ? `Target: ${action.target}` : 'System action'}
                  </p>
                </div>
                <span className={styles.listTimestamp}>{formatRelative(action.timestamp)}</span>
              </div>
            ))}
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
