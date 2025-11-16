import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Card,
  IconButton,
  Placeholder,
  Snackbar,
  Text,
  Textarea,
  Title,
} from '@telegram-apps/telegram-ui';

import { fetchBroadcasts, createBroadcast, fetchBroadcastStats } from '@/features/dashboard/api.ts';

import styles from './BroadcastPage.module.css';

type BroadcastRecord = {
  id: string;
  message: string;
  createdAt: string;
};

type BroadcastStats = {
  total: number;
  last30Days: number;
  lastBroadcast: string | null;
  avgPerMonth: number;
};

const TEXT = {
  title: 'Broadcast Messages',
  subtitle: 'Send messages to all active groups',
  loading: 'Loading broadcasts...',
  error: 'Unable to load broadcasts',
  retry: 'Retry',
  newBroadcast: 'New Broadcast',
  messageLabel: 'Broadcast Message',
  messagePlaceholder: 'Enter your message to send to all groups...',
  previewTitle: 'Preview & Confirm',
  confirmHint: 'This message will be sent to all active groups. Please review carefully.',
  send: 'Send Broadcast',
  cancel: 'Cancel',
  sending: 'Sending...',
  success: 'Broadcast sent successfully!',
  historyTitle: 'Broadcast History',
  noHistory: 'No broadcasts sent yet',
  statsTitle: 'Statistics',
  totalBroadcasts: 'Total broadcasts',
  last30Days: 'Last 30 days',
  avgPerMonth: 'Average per month',
  lastBroadcast: 'Last broadcast',
  never: 'Never',
};

export function BroadcastPage() {
  const navigate = useNavigate();
  const [broadcasts, setBroadcasts] = useState<BroadcastRecord[]>([]);
  const [stats, setStats] = useState<BroadcastStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNewBroadcast, setShowNewBroadcast] = useState(false);
  const [message, setMessage] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [broadcastsData, statsData] = await Promise.all([
        fetchBroadcasts(),
        fetchBroadcastStats(),
      ]);
      setBroadcasts(broadcastsData.broadcasts || []);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCreateBroadcast = useCallback(() => {
    setShowNewBroadcast(true);
    setMessage('');
    setShowPreview(false);
  }, []);

  const handlePreview = useCallback(() => {
    if (message.trim().length === 0) {
      setSnackbar('Please enter a message');
      return;
    }
    setShowPreview(true);
  }, [message]);

  const handleSend = useCallback(async () => {
    if (message.trim().length === 0) {
      setSnackbar('Please enter a message');
      return;
    }

    try {
      setSending(true);
      await createBroadcast(message.trim(), true);
      setSnackbar(TEXT.success);
      setShowNewBroadcast(false);
      setShowPreview(false);
      setMessage('');
      await loadData();
    } catch (err) {
      setSnackbar(err instanceof Error ? err.message : 'Failed to send broadcast');
    } finally {
      setSending(false);
    }
  }, [message, loadData]);

  const handleCancel = useCallback(() => {
    setShowNewBroadcast(false);
    setShowPreview(false);
    setMessage('');
  }, []);

  const formatDate = useCallback((dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
  }, []);

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Text weight="2">{TEXT.loading}</Text>
      </div>
    );
  }

  if (error) {
    return (
      <Placeholder header={TEXT.error} description={error}>
        <Button mode="filled" onClick={loadData}>
          {TEXT.retry}
        </Button>
      </Placeholder>
    );
  }

  if (showNewBroadcast) {
    return (
      <div className={styles.page}>
        <header className={styles.header}>
          <IconButton
            aria-label="Back"
            onClick={handleCancel}
            className={styles.backButton}
          >
            ←
          </IconButton>
          <Title level="2">{showPreview ? TEXT.previewTitle : TEXT.newBroadcast}</Title>
        </header>

        <main className={styles.content}>
          {!showPreview ? (
            <Card className={styles.card}>
              <div className={styles.field}>
                <Text weight="2" className={styles.label}>
                  {TEXT.messageLabel}
                </Text>
                <Textarea
                  className={styles.textarea}
                  placeholder={TEXT.messagePlaceholder}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  rows={8}
                />
              </div>
              <div className={styles.actions}>
                <Button mode="outline" onClick={handleCancel}>
                  {TEXT.cancel}
                </Button>
                <Button mode="filled" onClick={handlePreview}>
                  Preview
                </Button>
              </div>
            </Card>
          ) : (
            <Card className={styles.card}>
              <Text weight="2" className={styles.confirmHint}>
                {TEXT.confirmHint}
              </Text>
              <div className={styles.preview}>
                <Text className={styles.previewMessage}>{message}</Text>
              </div>
              <div className={styles.actions}>
                <Button mode="outline" onClick={() => setShowPreview(false)}>
                  Edit
                </Button>
                <Button 
                  mode="filled" 
                  onClick={handleSend}
                  loading={sending}
                  disabled={sending}
                >
                  {sending ? TEXT.sending : TEXT.send}
                </Button>
              </div>
            </Card>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <IconButton
          aria-label="Back"
          onClick={() => navigate(-1)}
          className={styles.backButton}
        >
          ←
        </IconButton>
        <div>
          <Title level="2">{TEXT.title}</Title>
          <Text className={styles.subtitle}>{TEXT.subtitle}</Text>
        </div>
        <Button mode="filled" size="s" onClick={handleCreateBroadcast}>
          {TEXT.newBroadcast}
        </Button>
      </header>

      <main className={styles.content}>
        {stats && (
          <Card className={styles.statsCard}>
            <Title level="3">{TEXT.statsTitle}</Title>
            <div className={styles.statsGrid}>
              <div className={styles.statItem}>
                <Text weight="2">{stats.total}</Text>
                <Text className={styles.statLabel}>{TEXT.totalBroadcasts}</Text>
              </div>
              <div className={styles.statItem}>
                <Text weight="2">{stats.last30Days}</Text>
                <Text className={styles.statLabel}>{TEXT.last30Days}</Text>
              </div>
              <div className={styles.statItem}>
                <Text weight="2">{stats.avgPerMonth}</Text>
                <Text className={styles.statLabel}>{TEXT.avgPerMonth}</Text>
              </div>
              <div className={styles.statItem}>
                <Text weight="2">
                  {stats.lastBroadcast ? formatDate(stats.lastBroadcast) : TEXT.never}
                </Text>
                <Text className={styles.statLabel}>{TEXT.lastBroadcast}</Text>
              </div>
            </div>
          </Card>
        )}

        <Card className={styles.historyCard}>
          <Title level="3">{TEXT.historyTitle}</Title>
          {broadcasts.length === 0 ? (
            <Text className={styles.noHistory}>{TEXT.noHistory}</Text>
          ) : (
            <div className={styles.historyList}>
              {broadcasts.map((broadcast) => (
                <div key={broadcast.id} className={styles.historyItem}>
                  <Text className={styles.broadcastMessage}>
                    {broadcast.message}
                  </Text>
                  <Text className={styles.broadcastDate}>
                    {formatDate(broadcast.createdAt)}
                  </Text>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)} duration={3000}>
          {snackbar}
        </Snackbar>
      )}
    </div>
  );
}
