import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Placeholder, Snackbar, Text } from '@telegram-apps/telegram-ui';

import { fetchGiveawayDashboard } from '@/features/dashboard/api.ts';
import type { GiveawayDashboardData, GiveawaySummary } from '@/features/dashboard/types.ts';

import { GiveawayTabs } from './GiveawayTabs';
import styles from './GiveawayPages.module.css';

const TEXT = {
  empty: 'No active giveaways. Create one to boost engagement.',
  loading: 'Loading giveaways...',
  loadError: 'Unable to load giveaways.',
  retry: 'Retry',
  create: 'Create giveaway',
  endsIn: (value: string) => `Ends in ${value}`,
  endedOn: (value: string) => `Ended on ${value}`,
  participants: (value: number) => `${value.toLocaleString('en-US')} participants`,
  winners: (value: number) => `${value} winners`,
  copySuccess: 'Invite link copied to clipboard.',
  winnerCodesTitle: 'Winner redemption codes',
  winnerCodesHint: 'Share these codes with your winners so they can redeem their reward.'
};

function formatCountdown(endsAt: string): string {
  const now = Date.now();
  const diff = Math.max(0, new Date(endsAt).getTime() - now);
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return [hours, minutes, seconds]
    .map((value) => value.toString().padStart(2, '0'))
    .join(':');
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US');
}

function statusBadge(status: GiveawaySummary['status']): string {
  if (status === 'active') {
    return styles.badgeActive;
  }
  if (status === 'scheduled') {
    return styles.badgeScheduled;
  }
  return styles.badgeCompleted;
}

export function GiveawayDashboardPage() {
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<GiveawayDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchGiveawayDashboard();
      setDashboard(data);
      setError(null);
    } catch (err) {
      const normalized = err instanceof Error ? err : new Error(String(err));
      setError(normalized);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeGiveaways = useMemo(() => dashboard?.active ?? [], [dashboard]);
  const pastGiveaways = useMemo(() => dashboard?.past ?? [], [dashboard]);

  const handleCopyLink = async (item: GiveawaySummary) => {
    try {
      const link = `${window.location.origin}/#/giveaway/join/${item.id}`;
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      }
      setSnackbar(TEXT.copySuccess);
    } catch (err) {
      console.error('[giveaway] copy failed', err);
      setSnackbar('Unable to copy link.');
    }
  };

  if (loading) {
    return (
      <div className={styles.page} dir='ltr'>
        <GiveawayTabs />
        <Placeholder header={TEXT.loading} />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className={styles.page} dir='ltr'>
        <GiveawayTabs />
        <Placeholder header={TEXT.loadError} description={error?.message}>
          <Button mode='filled' onClick={load}>{TEXT.retry}</Button>
        </Placeholder>
      </div>
    );
  }

  return (
    <div className={styles.page} dir='ltr'>
      <GiveawayTabs />

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Active giveaways</h2>
          <div className={styles.inlineActions}>
            <span className={styles.sectionHint}>Manage live and scheduled campaigns</span>
            <Button mode='filled' size='s' onClick={() => navigate('/giveaway/create')}>{TEXT.create}</Button>
          </div>
        </div>

        {activeGiveaways.length === 0 && (
          <div className={styles.emptyState}>{TEXT.empty}</div>
        )}

        {activeGiveaways.length > 0 && (
          <div className={styles.list}>
            {activeGiveaways.map((item) => (
              <article key={item.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  <span className={`${styles.badge} ${statusBadge(item.status)}`}>
                    {item.status === 'active' ? 'Active' : 'Scheduled'}
                  </span>
                </div>
                <div className={styles.tagRow}>
                  <span>{TEXT.endsIn(formatCountdown(item.endsAt))}</span>
                  <span>{TEXT.participants(item.participants)}</span>
                  <span>{TEXT.winners(item.winnersCount)}</span>
                </div>
                <div className={styles.tagRow}>
                  <span>Group: {item.targetGroup.title}</span>
                  <span>Cost: {item.prize.totalCost.toLocaleString('en-US')} Stars</span>
                </div>
                <div className={styles.actionsRow}>
                  <button
                    type='button'
                    className={`${styles.actionButton} ${styles.actionPrimary}`}
                    onClick={() => navigate(`/giveaway/join/${item.id}`)}
                  >
                    View
                  </button>
                  <button
                    type='button'
                    className={styles.actionButton}
                    onClick={() => handleCopyLink(item)}
                  >
                    Copy link
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {pastGiveaways.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>Completed giveaways</h2>
            <span className={styles.sectionHint}>Share the redemption codes with your winners</span>
          </div>
          <div className={styles.list}>
            {pastGiveaways.map((item) => {
              const codes = item.winnerCodes ?? [];
              return (
                <article key={item.id} className={styles.card}>
                  <div className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>{item.title}</h3>
                    <span className={`${styles.badge} ${statusBadge(item.status)}`}>
                      Completed
                    </span>
                  </div>
                  <div className={styles.tagRow}>
                    <span>{TEXT.endedOn(formatDateTime(item.endsAt))}</span>
                    <span>{TEXT.participants(item.participants)}</span>
                    <span>{TEXT.winners(item.winnersCount)}</span>
                  </div>
                  <div className={styles.tagRow}>
                    <span>Group: {item.targetGroup.title}</span>
                    <span>Cost: {item.prize.totalCost.toLocaleString('en-US')} Stars</span>
                  </div>
                  <div className={styles.winnerList}>
                    <Text weight='2'>{TEXT.winnerCodesTitle}</Text>
                    <Text className={styles.winnerHint}>{TEXT.winnerCodesHint}</Text>
                    {codes.length === 0 ? (
                      <div className={styles.winnerItem}>
                        <span className={styles.winnerMessage}>Codes will appear automatically once the giveaway completes.</span>
                      </div>
                    ) : (
                      codes.map((entry, index) => (
                        <div key={entry.code} className={styles.winnerItem}>
                          <span className={styles.winnerBadge}>Winner {index + 1}</span>
                          <span className={styles.winnerCode}>{entry.code}</span>
                          <span className={styles.winnerMessage}>{entry.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                  <div className={styles.actionsRow}>
                    <button
                      type='button'
                      className={`${styles.actionButton} ${styles.actionPrimary}`}
                      onClick={() => navigate(`/giveaway/join/${item.id}`)}
                    >
                      View
                    </button>
                    <button
                      type='button'
                      className={styles.actionButton}
                      onClick={() => handleCopyLink(item)}
                    >
                      Copy link
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </div>
  );
}
