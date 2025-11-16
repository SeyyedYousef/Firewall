import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Placeholder, Snackbar } from '@telegram-apps/telegram-ui';

import { fetchGiveawayDashboard } from '@/features/dashboard/api.ts';
import type { GiveawayDashboardData, GiveawaySummary } from '@/features/dashboard/types.ts';

import { GiveawayTabs } from './GiveawayTabs';
import styles from './GiveawayPages.module.css';

const TEXT = {
  loading: 'Loading giveaway history...',
  loadError: 'Unable to load history.',
  retry: 'Retry',
  empty: 'No past giveaways yet.',
  exportSuccess: 'History exported to console.',
};

function prepareCsv(items: GiveawaySummary[]): string {
  const headers = ['id', 'title', 'status', 'winners', 'participants', 'startsAt', 'endsAt'];
  const rows = items.map((item) => [
    item.id,
    item.title.replace(/"/g, "'"),
    item.status,
    item.winnersCount.toString(),
    item.participants.toString(),
    item.startsAt,
    item.endsAt,
  ]);
  return [headers.join(','), ...rows.map((row) => row.join(','))].join('\n');
}

export function GiveawayHistoryPage() {
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
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pastGiveaways = useMemo(() => dashboard?.past ?? [], [dashboard]);

  const handleExport = () => {
    if (!pastGiveaways.length) {
      return;
    }
    const csv = prepareCsv(pastGiveaways);
    console.info('[giveaway] export history\n' + csv);
    setSnackbar(TEXT.exportSuccess);
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
          <h2 className={styles.sectionTitle}>Giveaway history</h2>
          <div className={styles.actionsRow}>
            <Button mode='plain' size='s' onClick={handleExport}>Export CSV</Button>
            <Button mode='filled' size='s' onClick={() => navigate('/giveaway/create')}>Recreate</Button>
          </div>
        </div>

        {pastGiveaways.length === 0 && (
          <div className={styles.emptyState}>{TEXT.empty}</div>
        )}

        {pastGiveaways.length > 0 && (
          <div className={styles.list}>
            {pastGiveaways.map((item) => (
              <article key={item.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <h3 className={styles.cardTitle}>{item.title}</h3>
                  <span className={`${styles.badge} ${styles.badgeCompleted}`}>Completed</span>
                </div>
                <div className={styles.tagRow}>
                  <span>Group: {item.targetGroup.title}</span>
                  <span>Winners: {item.winnersCount}</span>
                  <span>Participants: {item.participants.toLocaleString('en-US')}</span>
                </div>
                <div className={styles.tagRow}>
                  <span>Started: {new Date(item.startsAt).toLocaleString('en-US')}</span>
                  <span>Ended: {new Date(item.endsAt).toLocaleString('en-US')}</span>
                </div>
                <div className={styles.actionsRow}>
                  <button
                    type='button'
                    className={styles.actionButton}
                    onClick={() => navigate('/giveaway/create', { state: { focusGroupId: item.targetGroup.id } })}
                  >
                    Recreate
                  </button>
                  <button
                    type='button'
                    className={styles.actionButton}
                    onClick={() => navigate(`/giveaway/join/${item.id}`)}
                  >
                    View
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </div>
  );
}
