import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { hapticFeedback } from '@telegram-apps/sdk-react';
import { Avatar, Button, Input, Placeholder, Text } from '@telegram-apps/telegram-ui';

import { dashboardConfig } from '@/config/dashboard.ts';
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
  expiringSectionTitle: 'Attention needed',
  expiredLabel: 'Plan expired',
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
  overviewDescription: 'Quick snapshot of your groups - monitor activity, growth, and subscription status.',
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
  { id: 'premium', label: '⭐ Premium' },
  { id: 'free', label: '🆓 Free' },
] as const;

const SORT_OPTIONS = [
  { id: 'expiration', label: TEXT.sortExpiration },
  { id: 'alphabetical', label: TEXT.sortAlphabetical },
  { id: 'members', label: TEXT.sortMembers },
] as const;

type FilterId = typeof FILTERS[number]['id'];
type SortId = typeof SORT_OPTIONS[number]['id'];

const FAR_FUTURE_ORDER = 1_000_000;
const titleCollator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

function membersLabel(count: number): string {
  return formatNumber(count) + ' members';
}

function totalLabel(total: number): string {
  return formatNumber(total) + ' total';
}

function getDaysLeft(group: ManagedGroup): number | null {
  if (group.status.kind === 'active') {
    const days = typeof group.status.daysLeft === 'number' ? group.status.daysLeft : 0;
    return Math.max(0, days);
  }
  if (group.status.kind === 'expired') {
    return 0;
  }
  return null;
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
    return words[0]?.charAt(0).toUpperCase() ?? '?';
  }
  const letters = words.slice(0, 2).map((word) => word?.charAt(0).toUpperCase() ?? '').filter(Boolean);
  return letters.join('');
}

type WidgetTone = 'widgetTonePrimary' | 'widgetToneWarning' | 'widgetToneSuccess' | 'widgetToneInfo';

type WidgetConfig = {
  id: string;
  label: string;
  value: string;
  tone: WidgetTone;
};

type DashboardSummary = {
  total: number;
  active: number;
  expired: number;
  removed: number;
};

function buildWidgets(insights: DashboardInsights, _summary: DashboardSummary, premiumCount: number, freeCount: number): WidgetConfig[] {
  return [
    {
      id: 'premiumGroups',
      label: '⭐ Premium',
      value: formatNumber(premiumCount),
      tone: 'widgetToneWarning',
    },
    {
      id: 'freeGroups',
      label: '🆓 Free',
      value: formatNumber(freeCount),
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
      premium: 0,
      free: 0,
    };

    groups.forEach((group) => {
      // Count by subscription type
      if (group.subscriptionType === 'premium') {
        counts.premium += 1;
      } else {
        counts.free += 1;
      }

      // Count by status
      if (group.status.kind === 'active') {
        counts.active += 1;
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
        case 'premium':
          return group.subscriptionType === 'premium';
        case 'free':
          return group.subscriptionType !== 'premium';
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
  const isEmpty = groups.length === 0;
  const noMatches = groups.length > 0 && filteredGroups.length === 0;

  const widgets = useMemo(() => buildWidgets(insights, summary, filterCounts.premium, filterCounts.free), [insights, summary, filterCounts.premium, filterCounts.free]);

  const topWidgets = widgets.slice(0, 2);
  const bottomWidgets = widgets.slice(2, 4);

  const openGroup = (group: ManagedGroup) => {
    console.info('[telemetry] group_manage_opened', group.id);
    navigate(`/groups/${group.id}`, { state: { group } });
  };


  // Show empty state prominently at top when no groups
  if (isEmpty) {
    return (
      <div className={styles.page} dir='ltr'>
        <EmptyState inviteUrl={dashboardConfig.inviteLink || ''} />
      </div>
    );
  }

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

          {noMatches && (
            <Placeholder header='No groups found' description='Try adjusting your filters or keywords.' />
          )}

          {filteredGroups.length > 0 && (
            <div className={styles.groupList}>
              {filteredGroups.map((group) => {
                const isPremium = group.subscriptionType === 'premium';
                const isRemoved = group.status.kind === 'removed';
                const statusText = group.status.kind === 'active' 
                  ? (isPremium ? 'Protected' : 'Basic protection')
                  : group.status.kind === 'expired' 
                    ? 'Expired' 
                    : 'Inactive';
                
                return (
                  <article 
                    key={group.id} 
                    className={`${styles.groupCard} ${isRemoved ? styles.groupCardRemoved : ''} ${isPremium ? styles.groupCardPremium : ''}`}
                  >
                    {/* Header */}
                    <div className={styles.groupHeader}>
                      <Avatar
                        size={40}
                        src={group.photoUrl ?? undefined}
                        acronym={group.photoUrl ? undefined : initialsFromTitle(group.title)}
                        alt={group.title}
                      />
                      <div className={styles.groupInfo}>
                        <h3 className={styles.groupName}>{group.title}</h3>
                        <div className={styles.groupMetaRow}>
                          <span className={styles.groupMeta}>{membersLabel(group.membersCount)}</span>
                          <span className={styles.groupMetaDot}>•</span>
                          <span className={`${styles.groupStatus} ${isRemoved ? styles.groupStatusRemoved : ''}`}>
                            {statusText}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Plan badge */}
                    <div className={styles.planRow}>
                      <span className={`${styles.planBadge} ${isPremium ? styles.planBadgePremium : styles.planBadgeFree}`}>
                        {isPremium ? '⭐ Premium' : '🆓 Free'}
                      </span>
                      {!isPremium && !isRemoved && (
                        <span className={styles.upgradeHint}>Upgrade for full protection</span>
                      )}
                    </div>

                    {/* Warning for removed */}
                    {isRemoved && (
                      <div className={styles.warningRow}>
                        <span className={styles.warningIcon}>⚠️</span>
                        <span className={styles.warningText}>Bot removed. Re-add to restore.</span>
                      </div>
                    )}

                    {/* Actions */}
                    <div className={styles.groupActions}>
                      <button
                        type='button'
                        className={styles.ctaButtonPrimary}
                        onClick={() => {
                          hapticFeedback.impactOccurred('light');
                          openGroup(group);
                        }}
                        disabled={isRemoved}
                      >
                        ⚙️ Manage
                      </button>
                      {!isPremium && !isRemoved && (
                        <button
                          type='button'
                          className={styles.ctaButtonUpgrade}
                          onClick={() => {
                            hapticFeedback.impactOccurred('light');
                            navigate('/stars', { state: { focusGroupId: group.id } });
                          }}
                        >
                          ⭐ Upgrade
                        </button>
                      )}
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
