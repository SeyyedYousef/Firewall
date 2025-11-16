import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Avatar, Button, Input, Placeholder, Text } from '@telegram-apps/telegram-ui';

import { dashboardConfig } from '@/config/dashboard.ts';
import { GroupCardSkeleton } from '@/features/dashboard/GroupCardSkeleton.tsx';
import { PromoSlider } from '@/features/dashboard/PromoSlider.tsx';
import { useDashboardData } from '@/features/dashboard/useDashboardData.ts';
import type { DashboardInsights, ManagedGroup } from '@/features/dashboard/types.ts';
import { EmptyState } from '@/features/dashboard/EmptyState.tsx';
import { formatNumber } from '@/utils/format.ts';

import styles from './DashboardPage.module.css';

const TEXT = {
  searchPlaceholder: 'Search groups',
  searchDescription: 'Use filters or search to find the community you need in seconds.',
  errorHeader: 'Unable to load groups',
  errorDescription: 'Please try again in a moment.',
  retry: 'Retry',
  expiringSectionTitle: 'Renewal radar',
  expiredLabel: 'Credits expired',
  removedLabel: 'Removed from group',
  manage: 'Open dashboard',
  analytics: 'View stats',
  filterAll: 'All',
  filterActive: 'Active',
  filterExpiring: 'Expiring soon',
  filterExpired: 'Expired',
  filterRemoved: 'Removed',
  sortLabel: 'Sort by',
  sortExpiration: 'Soonest expiry',
  sortAlphabetical: 'Alphabetical',
  sortMembers: 'Members',
  overviewDescription: 'Quick snapshot of your groups - keep an eye on renewals, activity, and growth at a glance.',
  sectionDescription: 'Use filters to spotlight the groups that need your attention.',
  statusActive: 'Active',
  statusExpired: 'Expired',
  statusRemoved: 'Removed',
  detailStatus: 'Status',
  detailMembers: 'Members',
  detailNextAction: 'Next action',
};

const FILTERS = [
  { id: 'all', label: TEXT.filterAll },
  { id: 'active', label: TEXT.filterActive },
  { id: 'expiring', label: TEXT.filterExpiring },
  { id: 'expired', label: TEXT.filterExpired },
  { id: 'removed', label: TEXT.filterRemoved },
] as const;

const SORT_OPTIONS = [
  { id: 'expiration', label: TEXT.sortExpiration },
  { id: 'alphabetical', label: TEXT.sortAlphabetical },
  { id: 'members', label: TEXT.sortMembers },
] as const;

type FilterId = typeof FILTERS[number]['id'];
type SortId = typeof SORT_OPTIONS[number]['id'];

const DAY_MS = 86_400_000;
const EXPIRING_THRESHOLD_DAYS = 5;
const FAR_FUTURE_ORDER = 1_000_000;
const titleCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function membersLabel(count: number): string {
  return formatNumber(count) + ' members';
}

function expiringLabel(days: number): string {
  if (days <= 0) {
    return 'Expiring today';
  }
  return 'Expiring in ' + days + ' days';
}

function totalLabel(total: number): string {
  return formatNumber(total) + ' total';
}

function statusLabel(group: ManagedGroup): string {
  if (group.status.kind === 'active') {
    return TEXT.statusActive;
  }
  if (group.status.kind === 'expired') {
    return TEXT.statusExpired;
  }
  return TEXT.statusRemoved;
}

function getDaysLeft(group: ManagedGroup): number | null {
  if (group.status.kind === 'active') {
    if (typeof group.status.daysLeft === 'number') {
      return group.status.daysLeft;
    }
    return Math.max(
      0,
      Math.ceil((new Date(group.status.expiresAt).getTime() - Date.now()) / DAY_MS),
    );
  }
  if (group.status.kind === 'expired') {
    return 0;
  }
  return null;
}

function isExpiringSoonGroup(group: ManagedGroup): boolean {
  if (group.status.kind !== 'active') {
    return false;
  }
  const daysLeft = getDaysLeft(group);
  return daysLeft !== null && daysLeft <= EXPIRING_THRESHOLD_DAYS;
}

function getExpirationSortValue(group: ManagedGroup): number {
  if (group.status.kind === 'expired') {
    return -1;
  }
  if (group.status.kind === 'active') {
    const daysLeft = getDaysLeft(group);
    return daysLeft ?? FAR_FUTURE_ORDER / 2;
  }
  return FAR_FUTURE_ORDER;
}

function initialsFromTitle(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return '?';
  }
  if (words.length === 1) {
    return words[0].charAt(0).toUpperCase();
  }
  const letters = words.slice(0, 2).map((word) => word.charAt(0).toUpperCase());
  return letters.join('');
}

type BadgeTone = 'badgeGreen' | 'badgeAmber' | 'badgeRed' | 'badgeMuted';

type WidgetTone = 'widgetTonePrimary' | 'widgetToneWarning' | 'widgetToneSuccess' | 'widgetToneInfo';

type WidgetConfig = {
  id: string;
  label: string;
  value: string;
  tone: WidgetTone;
};

function resolveCreditBadge(group: ManagedGroup): { label: string; tone: BadgeTone } {
  if (group.status.kind === 'active') {
    const daysLeft = typeof group.status.daysLeft === 'number' ? group.status.daysLeft : 0;
    const label = expiringLabel(daysLeft);
    if (daysLeft > 10) {
      return { label, tone: 'badgeGreen' };
    }
    if (daysLeft > EXPIRING_THRESHOLD_DAYS) {
      return { label, tone: 'badgeAmber' };
    }
    return { label, tone: 'badgeRed' };
  }
  if (group.status.kind === 'expired') {
    return { label: TEXT.expiredLabel, tone: 'badgeRed' };
  }
  return { label: TEXT.removedLabel, tone: 'badgeMuted' };
}

type DashboardSummary = {
  total: number;
  active: number;
  expired: number;
  removed: number;
};

function buildWidgets(insights: DashboardInsights, summary: DashboardSummary): WidgetConfig[] {
  return [
    {
      id: 'expiring',
      label: 'Expiring soon',
      value: formatNumber(insights.expiringSoon),
      tone: 'widgetToneWarning',
    },
    {
      id: 'activeGroups',
      label: 'Active groups',
      value: formatNumber(summary.active),
      tone: 'widgetToneInfo',
    },
    {
      id: 'messages',
      label: "Today's messages",
      value: formatNumber(insights.messagesToday),
      tone: 'widgetTonePrimary',
    },
    {
      id: 'newMembers',
      label: 'New members',
      value: formatNumber(insights.newMembersToday),
      tone: 'widgetToneSuccess',
    },
  ];
}

export function DashboardPage() {
  const navigate = useNavigate();
  const {
    groups,
    loading,
    error,
    refresh,
    insights,
    summary,
    promotions,
  } = useDashboardData();
  const [query, setQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState<FilterId>('all');
  const [sortMode, setSortMode] = useState<SortId>('expiration');

  const normalizedQuery = query.trim().toLowerCase();
  const hasPromotions = useMemo(
    () => promotions.slots.some((slot) => slot.active),
    [promotions.slots],
  );

  const filterCounts = useMemo(() => {
    const counts: Record<FilterId, number> = {
      all: groups.length,
      active: 0,
      expiring: 0,
      expired: 0,
      removed: 0,
    };

    groups.forEach((group) => {
      if (group.status.kind === 'active') {
        counts.active += 1;
        if (isExpiringSoonGroup(group)) {
          counts.expiring += 1;
        }
      } else if (group.status.kind === 'expired') {
        counts.expired += 1;
      } else if (group.status.kind === 'removed') {
        counts.removed += 1;
      }
    });

    return counts;
  }, [groups]);

  const filteredGroups = useMemo(() => {
    const matchesQuery = (group: ManagedGroup) =>
      !normalizedQuery || group.title.toLowerCase().includes(normalizedQuery);

    const matchesFilter = (group: ManagedGroup) => {
      switch (activeFilter) {
        case 'active':
          return group.status.kind === 'active';
        case 'expiring':
          return isExpiringSoonGroup(group);
        case 'expired':
          return group.status.kind === 'expired';
        case 'removed':
          return group.status.kind === 'removed';
        default:
          return true;
      }
    };

    const candidates = groups.filter((group) => matchesQuery(group) && matchesFilter(group));
    const sorted = [...candidates].sort((a, b) => {
      if (sortMode === 'expiration') {
        const diff = getExpirationSortValue(a) - getExpirationSortValue(b);
        if (diff !== 0) {
          return diff;
        }
        return titleCollator.compare(a.title, b.title);
      }
      if (sortMode === 'members') {
        const diff = b.membersCount - a.membersCount;
        if (diff !== 0) {
          return diff;
        }
        return titleCollator.compare(a.title, b.title);
      }
      return titleCollator.compare(a.title, b.title);
    });

    return sorted;
  }, [groups, normalizedQuery, activeFilter, sortMode]);

  const shouldShowSearch = groups.length > 6;
  const isEmpty = !loading && groups.length === 0;
  const noMatches = !loading && groups.length > 0 && filteredGroups.length === 0;

  const widgets = useMemo(() => buildWidgets(insights, summary), [insights, summary]);

  const topWidgets = widgets.slice(0, 2);
  const bottomWidgets = widgets.slice(2, 4);

  const openGroup = (group: ManagedGroup) => {
    console.info('[telemetry] group_manage_opened', group.id);
    navigate(`/groups/${group.id}`, { state: { group } });
  };

  const openAnalytics = (group: ManagedGroup) => {
    console.info('[telemetry] analytics_requested', group.id);
    navigate(`/groups/${group.id}/analytics`, { state: { group } });
  };

  return (
    <div className={styles.page} dir='ltr'>
      {hasPromotions && (
        <div className={styles.promoSection}>
          <PromoSlider
            slots={promotions.slots}
            rotationSeconds={promotions.rotationSeconds}
            metadata={promotions.metadata}
            canManage={promotions.canManage ?? false}
            onManageClick={() => navigate('/promo-slides/manage')}
          />
        </div>
      )}

      <section className={styles.widgetsSection}>
        <Text weight='2' className={styles.overviewDescription}>
          {TEXT.overviewDescription}
        </Text>
        <div className={styles.widgetRows}>
          {topWidgets.length > 0 && (
            <div className={styles.widgetsRow}>
              {topWidgets.map((widget) => {
                const className = [styles.widgetCard, styles[widget.tone]].join(' ');
                return (
                  <article key={widget.id} className={className}>
                    <div className={styles.widgetContent}>
                      <p className={styles.widgetLabel}>{widget.label}</p>
                      <p className={styles.widgetValue}>{widget.value}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {bottomWidgets.length > 0 && (
            <div className={styles.widgetsRow}>
              {bottomWidgets.map((widget) => {
                const className = [styles.widgetCard, styles[widget.tone]].join(' ');
                return (
                  <article key={widget.id} className={className}>
                    <div className={styles.widgetContent}>
                      <p className={styles.widgetLabel}>{widget.label}</p>
                      <p className={styles.widgetValue}>{widget.value}</p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {error && (
        <Placeholder header={TEXT.errorHeader} description={TEXT.errorDescription}>
          <Button mode='filled' onClick={refresh}>
            {TEXT.retry}
          </Button>
        </Placeholder>
      )}

      {!error && (
        <section className={styles.groupsSection}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>My Groups</h2>
            <Text weight='2' className={styles.sectionTotal}>
              {totalLabel(groups.length)}
            </Text>
          </div>
          <Text weight='2' className={styles.sectionDescription}>
            {TEXT.sectionDescription}
          </Text>

          <div className={styles.groupsToolbar}>
            <div className={styles.toolbarPrimary}>
              {FILTERS.map((filter) => {
                const isActive = activeFilter === filter.id;
                const chipClassName = [
                  styles.filterChip,
                  isActive ? styles.filterChipActive : null,
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button
                    key={filter.id}
                    type='button'
                    className={chipClassName}
                    onClick={() => setActiveFilter(filter.id)}
                  >
                    {filter.label}
                    <span className={styles.filterCount}>{filterCounts[filter.id]}</span>
                  </button>
                );
              })}
            </div>
            <div className={styles.toolbarSecondary}>
              {shouldShowSearch && (
                <div className={styles.searchField}>
                  <Input
                    className={styles.searchInput}
                    placeholder={TEXT.searchPlaceholder}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                </div>
              )}
              <div className={styles.sortControl}>
                <label className={styles.sortLabel} htmlFor='group-sort'>
                  {TEXT.sortLabel}
                </label>
                <select
                  id='group-sort'
                  className={styles.sortSelect}
                  value={sortMode}
                  onChange={(event) => setSortMode(event.target.value as SortId)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {loading && (
            <div className={styles.loaderList}>
              {Array.from({ length: 4 }).map((_, index) => (
                <GroupCardSkeleton key={index} />
              ))}
            </div>
          )}

          {!loading && isEmpty && (
            <div className={styles.emptyState}>
              <EmptyState inviteUrl={dashboardConfig.inviteLink} />
            </div>
          )}

          {!loading && noMatches && (
            <Placeholder header='No groups found' description='Try adjusting your filters or keywords.' />
          )}

          {!loading && filteredGroups.length > 0 && (
            <div className={styles.groupList}>
              {filteredGroups.map((group) => {
                const badge = resolveCreditBadge(group);
                const badgeClassName = [styles.badge, styles[badge.tone]].join(' ');
                const status = statusLabel(group);
                const daysLeft = getDaysLeft(group);
                let nextAction = 'On track';
                if (group.status.kind === 'removed') {
                  nextAction = 'Restore access';
                } else if (group.status.kind === 'expired') {
                  nextAction = 'Renew now';
                } else if (group.status.kind === 'active') {
                  if (daysLeft !== null) {
                    if (daysLeft <= 0) {
                      nextAction = 'Renew now';
                    } else if (daysLeft <= EXPIRING_THRESHOLD_DAYS) {
                      nextAction = daysLeft === 1 ? 'Renew within a day' : `Renew within ${daysLeft} days`;
                    } else {
                      nextAction = `${daysLeft} days remaining`;
                    }
                  }
                }
                return (
                  <article key={group.id} className={styles.groupCard}>
                    <header className={styles.groupHeader}>
                      <div className={styles.groupIdentity}>
                        <Avatar
                          size={48}
                          src={group.photoUrl ?? undefined}
                          acronym={group.photoUrl ? undefined : initialsFromTitle(group.title)}
                          alt={group.title}
                        />
                        <div className={styles.groupMeta}>
                          <h3 className={styles.groupName}>{group.title}</h3>
                          <div className={styles.groupMetaRow}>
                            <span className={badgeClassName}>{badge.label}</span>
                          </div>
                        </div>
                      </div>
                    </header>

                    {(group.status.kind === 'expired' || group.status.kind === 'removed') && (
                      <div className={styles.warningBanner}>
                        <span className={styles.warningIcon}>!</span>
                        <p className={styles.warningText}>
                          {group.status.kind === 'expired'
                            ? 'This group\'s credits have expired. Recharge within 7 days to keep your settings.'
                            : 'Firewall Bot was removed from this group. Re-add it within 7 days to preserve the configuration.'}
                        </p>
                      </div>
                    )}

                    <div className={styles.groupDetails}>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>{TEXT.detailNextAction}</span>
                        <span className={styles.detailValue}>{nextAction}</span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>{TEXT.detailStatus}</span>
                        <span className={styles.detailValue}>{status}</span>
                      </div>
                      <div className={styles.detailItem}>
                        <span className={styles.detailLabel}>{TEXT.detailMembers}</span>
                        <span className={styles.detailValue}>{membersLabel(group.membersCount)}</span>
                      </div>
                    </div>

                    <div className={styles.groupActions}>
                      <button
                        type='button'
                        className={styles.ctaButton}
                        onClick={() => openGroup(group)}
                      >
                        {TEXT.manage}
                      </button>
                      <button
                        type='button'
                        className={`${styles.ctaButton} ${styles.ctaButtonSecondary}`}
                        onClick={() => openAnalytics(group)}
                      >
                        {TEXT.analytics}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
