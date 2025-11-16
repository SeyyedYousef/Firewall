import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Avatar, Button, Input, Placeholder, Snackbar, Text } from '@telegram-apps/telegram-ui';

import {
  fetchStarsOverview,
  giftStarsToGroup,
  purchaseStarsForGroup,
  searchGroupsForStars,
} from '@/features/dashboard/api.ts';
import type {
  GroupStarsStatus,
  ManagedGroup,
  StarsPlan,
  StarsOverview,
  StarsPurchaseResult,
} from '@/features/dashboard/types.ts';
import { formatNumber } from '@/utils/format.ts';
import { openTelegramInvoice, type InvoiceOutcome } from '@/utils/telegram.ts';

import styles from './StarsPage.module.css';

type TargetMode = 'my-groups' | 'other' | 'giveaway';

type TargetSelection =
  | { kind: 'managed'; status: GroupStarsStatus }
  | { kind: 'external'; group: ManagedGroup };

const MIN_SEARCH_LENGTH = 5;

const TEXT = {
  stepTarget: 'Step 1 - Select target',
  stepPlan: 'Step 2 - Choose plan',
  stepConfirm: 'Step 3 - Confirm',
  tabs: {
    myGroups: 'My groups',
    other: 'Other group',
    giveaway: 'Create giveaway',
  },
  myGroupsEmpty: 'No managed groups ready for top-up.',
  searchPlaceholder: 'Search by @username or ID (userid)',
  searchHint: 'Enter at least 5 characters to search.',
  searchEmpty: 'The bot is not a member of that group. Please add the bot to the group and try again.',
  giveawayTitle: 'Create a giveaway',
  giveawayDescription: 'Invite members to engage with your group by gifting extra uptime credits.',
  giveawayAction: 'Open giveaway creator',
  summary: {
    group: 'Group',
    plan: 'Plan',
    total: 'Total Stars',
  },
  pay: 'Pay with Stars',
  loading: 'Loading Stars overview...',
  loadError: 'Failed to load Stars data.',
  retry: 'Retry',
  snackbarPurchase: (group: string, days: number) => `Credit extended for ${group} by ${days} days`,
  snackbarGift: (group: string, days: number) => `You extended ${group} by ${days} days`,
  badge: {
    active: 'Active',
    expiring: 'Expiring soon',
    expired: 'Expired',
  },
  invoice: {
    prompt: 'Complete the payment in Telegram to finish checkout.',
    opening: 'Opening invoice in Telegram...',
    paid: (group: string, days: number) => `Payment confirmed. ${group} extended by ${days} days.`,
    cancelled: 'Payment cancelled in Telegram.',
    failed: 'Payment failed. Please try again.',
    external: 'Invoice opened in a new window. Confirm the payment when ready.',
  },
  refund: {
    success: (target: string) => `Refund processed for ${target}.`,
    error: 'Unable to refund this transaction. Please try again.',
  },
};

function planLabel(plan: StarsPlan): string {
  return `${plan.days} days - ${formatNumber(plan.price)} Stars`;
}

function findPlan(plans: StarsPlan[], planId: string | null): StarsPlan | null {
  if (!planId) {
    return null;
  }
  return plans.find((plan) => plan.id === planId) ?? null;
}

export function StarsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const focusGroupIdFromState =
    (location.state as { focusGroupId?: string } | null | undefined)?.focusGroupId ?? null;

  const [overview, setOverview] = useState<StarsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [mode, setMode] = useState<TargetMode>(() => (focusGroupIdFromState ? 'my-groups' : 'other'));
  const [selectedManagedId, setSelectedManagedId] = useState<string | null>(null);
  const [selectedExternal, setSelectedExternal] = useState<ManagedGroup | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResults, setSearchResults] = useState<ManagedGroup[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const loadData = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) {
        setLoading(true);
      }
      try {
        const overviewData = await fetchStarsOverview();
        setOverview(overviewData);
        if (overviewData.groups.length > 0) {
          setSelectedManagedId((prev) => prev ?? overviewData.groups[0].group.id);
        }
        setError(null);
      } catch (err) {
        if (options?.silent) {
          setSnackbar(err instanceof Error ? err.message : String(err));
        } else {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!options?.silent) {
          setLoading(false);
        }
      }
    },
    [setSnackbar],
  );

  const processStarsResult = useCallback(
    async (
      result: StarsPurchaseResult,
      context: { targetId?: string | null; targetTitle: string; gifted: boolean; planDays: number },
    ) => {
      const targetLabel = context.targetTitle;
      if (result.status === "completed") {
        console.info("[telemetry] stars_payment_success", {
          groupId: result.groupId ?? context.targetId ?? "unknown",
          planId: result.planId,
          gifted: context.gifted,
        });
        await loadData({ silent: true });
        setSnackbar(
          context.gifted
            ? TEXT.snackbarGift(targetLabel, context.planDays)
            : TEXT.snackbarPurchase(targetLabel, context.planDays),
        );
        return;
      }

      if (result.status === "pending") {
        console.info("[telemetry] stars_payment_pending", {
          groupId: result.groupId ?? context.targetId ?? "unknown",
          planId: result.planId,
          gifted: context.gifted,
        });
        if (result.paymentUrl) {
          setSnackbar(TEXT.invoice.opening);
          const outcome: InvoiceOutcome = await openTelegramInvoice(result.paymentUrl);
          if (outcome === "paid") {
            await loadData({ silent: true });
            setSnackbar(TEXT.invoice.paid(targetLabel, context.planDays));
          } else if (outcome === "cancelled") {
            setSnackbar(TEXT.invoice.cancelled);
          } else if (outcome === "failed") {
            setSnackbar(TEXT.invoice.failed);
          } else {
            setSnackbar(TEXT.invoice.external);
          }
        } else {
          window.open(result.message ?? "", "_blank", "noopener,noreferrer");
          setSnackbar(TEXT.invoice.external);
        }
        return;
      }

      console.info("[telemetry] stars_payment_refunded", {
        groupId: result.groupId ?? context.targetId ?? "unknown",
        planId: result.planId,
        gifted: context.gifted,
      });
      await loadData({ silent: true });
      setSnackbar(TEXT.refund.success(targetLabel));
    },
    [loadData, setSnackbar],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (focusGroupIdFromState) {
      setMode('my-groups');
      setSelectedManagedId(focusGroupIdFromState);
    } else {
      setMode('other');
    }
  }, [focusGroupIdFromState]);

  useEffect(() => {
    if (mode !== 'other') {
      return;
    }
    if (searchQuery.trim().length < MIN_SEARCH_LENGTH) {
      setSearchResults([]);
      return;
    }
    let cancelled = false;
    const run = async () => {
      setSearchLoading(true);
      try {
        const results = await searchGroupsForStars(searchQuery);
        if (!cancelled) {
          setSearchResults(results);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('[stars] search failed', err);
          setSearchResults([]);
        }
      } finally {
        if (!cancelled) {
          setSearchLoading(false);
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [mode, searchQuery]);

  const plans = overview?.plans ?? [];

  const selectedTarget: TargetSelection | null = useMemo(() => {
    if (mode === 'my-groups') {
      const status = overview?.groups.find((item) => item.group.id === selectedManagedId);
      return status ? { kind: 'managed', status } : null;
    }
    if (mode === 'other') {
      return selectedExternal ? { kind: 'external', group: selectedExternal } : null;
    }
    return null;
  }, [mode, overview, selectedManagedId, selectedExternal]);

  const selectedPlan = useMemo(() => findPlan(plans, selectedPlanId), [plans, selectedPlanId]);

  const canSubmit = selectedTarget != null && selectedPlan != null && !processing;

  const handleSwitchMode = (next: TargetMode) => {
    setMode(next);
    setSelectedPlanId(null);
    setSnackbar(null);
    if (next !== 'other') {
      setSelectedExternal(null);
    }
  };

  const handleSelectManaged = (groupId: string) => {
    setSelectedManagedId(groupId);
    setSnackbar(null);
  };

  const handleSelectExternal = (group: ManagedGroup) => {
    setSelectedExternal(group);
    setSnackbar(null);
  };

  const handleSubmit = async () => {
    if (!overview || !selectedTarget || !selectedPlan) {
      return;
    }
    setProcessing(true);
    try {
      const result =
        selectedTarget.kind === 'managed'
          ? await purchaseStarsForGroup(selectedTarget.status.group.id, selectedPlan.id, selectedTarget.status.group)
          : await giftStarsToGroup(selectedTarget.group, selectedPlan.id);
      await processStarsResult(result, {
        targetId: selectedTarget.kind === 'managed' ? selectedTarget.status.group.id : selectedTarget.group.id,
        targetTitle: selectedTarget.kind === 'managed' ? selectedTarget.status.group.title : selectedTarget.group.title,
        gifted: selectedTarget.kind !== 'managed',
        planDays: selectedPlan.days,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSnackbar(message);
    } finally {
      setProcessing(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.page} dir='ltr'>
        <Placeholder header={TEXT.loading} />
      </div>
    );
  }

  if (error || !overview) {
    return (
      <div className={styles.page} dir='ltr'>
        <Placeholder header={TEXT.loadError} description={error?.message}>
          <Button mode='filled' onClick={() => loadData()}>{TEXT.retry}</Button>
        </Placeholder>
      </div>
    );
  }

  return (
    <div className={styles.page} dir='ltr'>
      <section className={styles.section}>
        <Text weight='2' className={styles.stepTitle}>{TEXT.stepTarget}</Text>
        <div className={styles.tabRow}>
          <button
            type='button'
            className={`${styles.tabButton} ${mode === 'my-groups' ? styles.tabButtonActive : ''}`}
            onClick={() => handleSwitchMode('my-groups')}
          >
            {TEXT.tabs.myGroups}
          </button>
          <button
            type='button'
            className={`${styles.tabButton} ${mode === 'other' ? styles.tabButtonActive : ''}`}
            onClick={() => handleSwitchMode('other')}
          >
            {TEXT.tabs.other}
          </button>
          <button
            type='button'
            className={`${styles.tabButton} ${mode === 'giveaway' ? styles.tabButtonActive : ''}`}
            onClick={() => handleSwitchMode('giveaway')}
          >
            {TEXT.tabs.giveaway}
          </button>
        </div>

        {mode === 'my-groups' && (
          <div className={styles.groupGrid}>
            {overview.groups.length === 0 && (
              <div className={styles.emptyState}>{TEXT.myGroupsEmpty}</div>
            )}
            {overview.groups.map((item) => {
              const active = item.group.id === selectedManagedId;
              return (
                <button
                  key={item.group.id}
                  type='button'
                  className={`${styles.groupCard} ${active ? styles.groupCardActive : ''}`}
                  onClick={() => handleSelectManaged(item.group.id)}
                >
                  <Avatar
                    size={48}
                    src={item.group.photoUrl ?? undefined}
                    acronym={item.group.photoUrl ? undefined : initialsFromTitle(item.group.title)}
                    alt={item.group.title}
                  />
                  <div className={styles.groupMeta}>
                    <span className={styles.groupName}>{item.group.title}</span>
                    <span className={styles.groupMembers}>{formatNumber(item.group.membersCount)} members</span>
                    <span className={`${styles.groupBadge} ${styles[`badge_${item.status}`]}`}>
                      {TEXT.badge[item.status]}
                    </span>
                  </div>
                  <span className={styles.groupDays}>{item.daysLeft} days left</span>
                </button>
              );
            })}
          </div>
        )}

        {mode === 'other' && (
          <div className={styles.otherTarget}>
            <Input
              placeholder={TEXT.searchPlaceholder}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            <Text weight='2' className={styles.searchHint}>
              {TEXT.searchHint}
            </Text>
            {searchLoading && <Text className={styles.searchStatus}>Searching...</Text>}
            {!searchLoading && searchQuery.trim().length >= MIN_SEARCH_LENGTH && searchResults.length === 0 && (
              <div className={styles.emptyState}>{TEXT.searchEmpty}</div>
            )}
            <div className={styles.groupGrid}>
              {searchResults.map((group) => {
                const active = selectedExternal?.id === group.id;
                return (
                  <button
                    key={group.id}
                    type='button'
                    className={`${styles.groupCard} ${active ? styles.groupCardActive : ''}`}
                    onClick={() => handleSelectExternal(group)}
                  >
                    <Avatar
                      size={48}
                      src={group.photoUrl ?? undefined}
                      acronym={group.photoUrl ? undefined : initialsFromTitle(group.title)}
                      alt={group.title}
                    />
                    <div className={styles.groupMeta}>
                      <span className={styles.groupName}>{group.title}</span>
                      <span className={styles.groupMembers}>{formatNumber(group.membersCount)} members</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {mode === 'giveaway' && (
          <div className={styles.giveawayCard}>
            <Text weight='2' className={styles.giveawayTitle}>{TEXT.giveawayTitle}</Text>
            <Text className={styles.giveawayDescription}>{TEXT.giveawayDescription}</Text>
            <Button
              mode='filled'
              size='m'
              onClick={() => navigate('/giveaway/create')}
            >
              {TEXT.giveawayAction}
            </Button>
          </div>
        )}
      </section>
      {mode !== 'giveaway' && (
        <>
          <section className={styles.section}>
            <Text weight='2' className={styles.stepTitle}>{TEXT.stepPlan}</Text>
            <div className={styles.planGrid}>
              {plans.map((plan) => {
                const active = plan.id === selectedPlanId;
                return (
                  <button
                    key={plan.id}
                    type='button'
                    className={`${styles.planCard} ${active ? styles.planCardActive : ''}`}
                    onClick={() => setSelectedPlanId(plan.id)}
                  >
                    <span className={styles.planDays}>{plan.days} days</span>
                    <span className={styles.planPrice}>{formatNumber(plan.price)} Stars</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className={styles.section}>
            <Text weight='2' className={styles.stepTitle}>{TEXT.stepConfirm}</Text>
            <div className={styles.summaryCard}>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{TEXT.summary.group}</span>
                <span className={styles.summaryValue}>
                  {selectedTarget
                    ? selectedTarget.kind === 'managed'
                      ? selectedTarget.status.group.title
                      : selectedTarget.group.title
                    : 'Not selected'}
                </span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{TEXT.summary.plan}</span>
                <span className={styles.summaryValue}>{selectedPlan ? planLabel(selectedPlan) : 'Not selected'}</span>
              </div>
              <div className={styles.summaryRow}>
                <span className={styles.summaryLabel}>{TEXT.summary.total}</span>
                <span className={styles.summaryValue}>{selectedPlan ? `${formatNumber(selectedPlan.price)} Stars` : '-'}</span>
              </div>
            </div>
            <Button
              mode='filled'
              size='l'
              stretched
              disabled={!canSubmit}
              loading={processing}
              onClick={handleSubmit}
            >
              {TEXT.pay}
            </Button>
            {selectedPlan && (
              <Text className={styles.invoiceHint}>{TEXT.invoice.prompt}</Text>
            )}
          </section>
        </>
      )}

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </div>
  );
}

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


