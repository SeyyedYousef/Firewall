import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Placeholder, Snackbar, Switch, Text } from '@telegram-apps/telegram-ui';

import { fetchGiveawayDetail, joinGiveaway } from '@/features/dashboard/api.ts';
import type { GiveawayDetail } from '@/features/dashboard/types.ts';
import { useOwnerProfile } from '@/features/dashboard/useOwnerProfile.ts';

import styles from './GiveawayPages.module.css';

type RouteParams = {
  giveawayId: string;
};

const TEXT = {
  loading: 'Loading giveaway...',
  loadError: 'Giveaway not found.',
  retry: 'Back',
  joined: 'You’re in! Results will be announced soon.',
  join: 'Join Giveaway',
  joinedButton: 'Already joined',
  requirePremium: 'Only available to Telegram Premium users.',
};

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, seconds);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`;
}

export function JoinGiveawayPage() {
  const { giveawayId } = useParams<RouteParams>();
  const navigate = useNavigate();
  const { user } = useOwnerProfile();
  const hasPremium = user?.is_premium === true;

  const [detail, setDetail] = useState<GiveawayDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const [subscribed, setSubscribed] = useState(false);
  const [extraChecked, setExtraChecked] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const load = useCallback(async () => {
    if (!giveawayId) {
      return;
    }
    try {
      setLoading(true);
      const data = await fetchGiveawayDetail(giveawayId);
      setDetail(data);
      setCountdown(data.remainingSeconds);
      setSubscribed(false);
      setExtraChecked(false);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [giveawayId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    setCountdown(detail.remainingSeconds);
  }, [detail]);

  useEffect(() => {
    if (!detail) {
      return;
    }
    const timer = window.setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [detail]);

  const requirementsMet = useMemo(() => {
    if (!detail) {
      return false;
    }
    if (detail.requirements.premiumOnly && !hasPremium) {
      return false;
    }
    if (!subscribed) {
      return false;
    }
    if (detail.requirements.extraChannel && !extraChecked) {
      return false;
    }
    return true;
  }, [detail, hasPremium, subscribed, extraChecked]);

  const handleJoin = useCallback(async () => {
    if (!giveawayId || !requirementsMet || detail?.joined) {
      return;
    }
    try {
      setJoining(true);
      const updated = await joinGiveaway(giveawayId);
      setDetail(updated);
      setSnackbar('Participation recorded. Good luck!');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setSnackbar(message);
    } finally {
      setJoining(false);
    }
  }, [detail, giveawayId, requirementsMet]);

  if (loading) {
    return (
      <div className={styles.page} dir='ltr'>
        <Placeholder header={TEXT.loading} />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className={styles.page} dir='ltr'>
        <Placeholder header={TEXT.loadError} description={error?.message}>
          <Button mode='filled' onClick={() => navigate('/giveaway/active')}>{TEXT.retry}</Button>
        </Placeholder>
      </div>
    );
  }

  const rewardChips = [
    `${detail.prize.days} day access`,
    `${detail.winnersCount} winners`,
    `${detail.prize.pricePerWinner.toLocaleString('en-US')} ? each`,
  ];

  return (
    <div className={styles.page} dir='ltr'>
      <section className={styles.joinHeader}>
        <Text weight='2'>Ends in {formatCountdown(countdown)}</Text>
        <h1 className={styles.cardTitle}>{detail.title}</h1>
        <Text className={styles.sectionHint}>Earn points & climb the leaderboard</Text>
        <div className={styles.rewardStrip}>
          {rewardChips.map((chip) => (
            <span key={chip} className={styles.rewardPill}>{chip}</span>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Requirements</h2>
          <span className={styles.sectionHint}>Complete all steps to unlock Join</span>
        </div>
        <div className={styles.requirements}>
          <div className={styles.requirementItem}>
            <div>
              <Text weight='2'>Subscribe to host channel</Text>
              <Text className={styles.requirementStatus}>{detail.requirements.targetChannel}</Text>
            </div>
            <Switch checked={subscribed} onChange={(event) => setSubscribed(event.target.checked)} />
          </div>
          {detail.requirements.extraChannel && (
            <div className={styles.requirementItem}>
              <div>
                <Text weight='2'>Follow partner channel</Text>
                <Text className={styles.requirementStatus}>{detail.requirements.extraChannel}</Text>
              </div>
              <Switch checked={extraChecked} onChange={(event) => setExtraChecked(event.target.checked)} />
            </div>
          )}
          {detail.requirements.premiumOnly && (
            <div className={styles.requirementItem}>
              <div>
                <Text weight='2'>Telegram Premium</Text>
                <Text className={styles.requirementStatus}>{hasPremium ? 'Premium verified' : TEXT.requirePremium}</Text>
              </div>
              <Switch checked={hasPremium} disabled />
            </div>
          )}
        </div>
      </section>

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2 className={styles.sectionTitle}>Giveaway summary</h2>
          <span className={styles.sectionHint}>{detail.participants.toLocaleString('en-US')} participants</span>
        </div>
        <div className={styles.tagRow}>
          <span>Group: {detail.targetGroup.title}</span>
          <span>Ends: {new Date(detail.endsAt).toLocaleString('en-US')}</span>
        </div>
      </section>

      <section className={`${styles.section} ${styles.joinCTA}`}>
        {detail.joined && <div className={styles.successState}>{TEXT.joined}</div>}
        <Button
          mode='filled'
          size='l'
          stretched
          disabled={!requirementsMet || detail.joined}
          loading={joining}
          onClick={handleJoin}
        >
          {detail.joined ? TEXT.joinedButton : TEXT.join}
        </Button>
      </section>

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </div>
  );
}

