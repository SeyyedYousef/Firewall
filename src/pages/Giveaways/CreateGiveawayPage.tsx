import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Button, Input, Placeholder, Snackbar, Switch, Text } from '@telegram-apps/telegram-ui';

import {
  createGiveaway,
  fetchDashboardSnapshot,
  fetchGiveawayConfig,
} from '@/features/dashboard/api.ts';
import type {
  GiveawayConfig,
  GiveawayCreationPayload,
  GiveawayPlanOption,
  ManagedGroup,
} from '@/features/dashboard/types.ts';

import { GiveawayTabs } from './GiveawayTabs';
import styles from './GiveawayPages.module.css';

type LocationState = {
  focusGroupId?: string;
};

const TEXT = {
  loading: 'Loading giveaway builder...',
  loadError: 'Unable to load giveaway data.',
  retry: 'Retry',
  stepReward: 'Step 1 - Choose reward',
  stepGroup: 'Step 2 - Host & channels',
  stepLinks: 'Step 3 - Extra links',
  stepDuration: 'Step 4 - Timing & winners',
  stepRequirements: 'Step 5 - Participant rules',
  stepSummary: 'Step 6 - Review & confirm',
  giftsHint: 'Pick the reward your winners will receive.',
  groupTitle: 'Included channels/groups',
  channelsHint: 'Select the host group and add extra channels that will be required.',
  linksTitle: 'Other links',
  linksHint: 'Add external links participants must visit (optional, up to 10).',
  durationTitle: 'Duration',
  requirementsTitle: 'Participant requirements',
  notificationsTitle: 'Notifications',
  summaryTitle: 'Summary',
  addChannel: 'Add channel',
  addLink: 'Add link',
  startGiveaway: 'Start Giveaway',
  processing: 'Creating...',
  winnersLabel: 'Number of winners',
  durationCustom: 'Custom (hours)',
  success: 'Giveaway created successfully.',
};

const MIN_WINNERS = 1;
const MIN_DURATION = 1;

export function CreateGiveawayPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;
  const focusGroupId = state.focusGroupId;

  const [config, setConfig] = useState<GiveawayConfig | null>(null);
  const [groups, setGroups] = useState<ManagedGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [winners, setWinners] = useState<number>(MIN_WINNERS);
  const [durationOption, setDurationOption] = useState<number | 'custom'>(6);
  const [customDuration, setCustomDuration] = useState<number>(6);
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [chatBoosterOnly, setChatBoosterOnly] = useState(false);
  const [inviteFriend, setInviteFriend] = useState(false);
  const [notifyStart, setNotifyStart] = useState(true);
  const [notifyEnd, setNotifyEnd] = useState(true);
  const [extraChannel, setExtraChannel] = useState('');
  const [includedChannels, setIncludedChannels] = useState<string[]>([]);
  const [links, setLinks] = useState<string[]>([]);
  const [title, setTitle] = useState('');

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [cfg, snapshot] = await Promise.all([
        fetchGiveawayConfig(),
        fetchDashboardSnapshot(),
      ]);
      const manageable = snapshot.groups.filter((group) => group.canManage && group.status.kind !== 'removed');
      setGroups(manageable);
      setConfig(cfg);

      const defaultGroup = focusGroupId && manageable.some((group) => group.id === focusGroupId)
        ? focusGroupId
        : manageable[0]?.id ?? null;
      const defaultPlan = cfg.plans[0]?.id ?? null;
      const defaultDuration = cfg.durationOptions[0] ?? 6;

      setSelectedGroupId(defaultGroup);
      setSelectedPlanId(defaultPlan);
      setDurationOption(defaultDuration);
      setCustomDuration(defaultDuration);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, [focusGroupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const plan = useMemo<GiveawayPlanOption | null>(() => {
    if (!config || !selectedPlanId) {
      return null;
    }
    return config.plans.find((item) => item.id === selectedPlanId) ?? null;
  }, [config, selectedPlanId]);

  const durationHours = useMemo(() => {
    if (durationOption === 'custom') {
      return Math.max(MIN_DURATION, customDuration);
    }
    return durationOption;
  }, [durationOption, customDuration]);

  const totalCost = useMemo(() => {
    if (!plan) {
      return 0;
    }
    return plan.pricePerWinner * Math.max(MIN_WINNERS, winners);
  }, [plan, winners]);

  const canSubmit = Boolean(selectedGroupId && plan && winners >= MIN_WINNERS && durationHours >= MIN_DURATION && !processing);

  const handleAddChannel = () => {
    const trimmed = extraChannel.trim();
    if (!trimmed || includedChannels.includes(trimmed)) {
      return;
    }
    setIncludedChannels((prev) => [...prev, trimmed]);
    setExtraChannel('');
  };

  const handleRemoveChannel = (value: string) => {
    setIncludedChannels((prev) => prev.filter((item) => item !== value));
  };

  const handleAddLink = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || links.includes(trimmed) || links.length >= 10) {
      return;
    }
    setLinks((prev) => [...prev, trimmed]);
  };

  const handleRemoveLink = (value: string) => {
    setLinks((prev) => prev.filter((item) => item !== value));
  };

  const handleWinnersChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    if (Number.isNaN(parsed)) {
      setWinners(MIN_WINNERS);
      return;
    }
    setWinners(Math.max(MIN_WINNERS, parsed));
  };

  const handleCustomDurationChange = (event: ChangeEvent<HTMLInputElement>) => {
    const parsed = Number(event.target.value);
    if (Number.isNaN(parsed)) {
      setCustomDuration(MIN_DURATION);
      return;
    }
    setCustomDuration(Math.max(MIN_DURATION, parsed));
  };

  const submit = async () => {
    if (!selectedGroupId || !plan || !config) {
      return;
    }

    const payload: GiveawayCreationPayload = {
      groupId: selectedGroupId,
      planId: plan.id,
      winners: Math.max(MIN_WINNERS, winners),
      durationHours,
      premiumOnly,
      chatBoosterOnly,
      inviteUniqueFriend: inviteFriend,
      includedChannels,
      externalLinks: links,
      notifyStart,
      notifyEnd,
      extraChannel: includedChannels[0] ?? null,
      title: title.trim() || undefined,
    };

    setProcessing(true);
    try {
      const response = await createGiveaway(payload);
      setSnackbar(TEXT.success);
      navigate(`/giveaway/join/${response.id}`);
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
        <GiveawayTabs />
        <Placeholder header={TEXT.loading} />
      </div>
    );
  }

  if (error || !config || groups.length === 0) {
    return (
      <div className={styles.page} dir='ltr'>
        <GiveawayTabs />
        <Placeholder header={TEXT.loadError} description={error?.message}>
          <Button mode='filled' onClick={() => void load()}>{TEXT.retry}</Button>
        </Placeholder>
      </div>
    );
  }

  return (
    <div className={styles.page} dir='ltr'>
      <GiveawayTabs />

      <section className={styles.section}>
        <Text weight='2' className={styles.stepTitle}>{TEXT.stepReward}</Text>
        <Text className={styles.formHint}>{TEXT.giftsHint}</Text>
        <div className={styles.planGrid}>
          {config.plans.map((item) => (
            <button
              key={item.id}
              type='button'
              className={`${styles.planCard} ${item.id === selectedPlanId ? styles.planCardActive : ''}`}
              onClick={() => setSelectedPlanId(item.id)}
            >
              <span className={styles.planDays}>{item.days} day access</span>
              <span className={styles.planPrice}>{item.pricePerWinner.toLocaleString('en-US')} Stars per winner</span>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <Text weight='2' className={styles.stepTitle}>{TEXT.stepGroup}</Text>
        <Text className={styles.formHint}>{TEXT.channelsHint}</Text>
        <div className={styles.groupGrid}>
          {groups.map((group) => (
            <button
              key={group.id}
              type='button'
              className={`${styles.groupCard} ${group.id === selectedGroupId ? styles.groupCardActive : ''}`}
              onClick={() => setSelectedGroupId(group.id)}
            >
              <Text className={styles.groupName}>{group.title}</Text>
              <Text className={styles.groupMembers}>{group.membersCount.toLocaleString('en-US')} members</Text>
            </button>
          ))}
        </div>
        <div className={styles.inputRow}>
          <Input
            placeholder='@channel'
            value={extraChannel}
            onChange={(event) => setExtraChannel(event.target.value)}
          />
          <Button size='s' mode='filled' onClick={handleAddChannel}>{TEXT.addChannel}</Button>
        </div>
        {includedChannels.length > 0 && (
          <div className={styles.tagRow}>
            {includedChannels.map((channel) => (
              <button
                key={channel}
                type='button'
                className={styles.actionButton}
                onClick={() => handleRemoveChannel(channel)}
              >
                {channel} x
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <Text weight='2' className={styles.stepTitle}>{TEXT.stepLinks}</Text>
        <Text className={styles.formHint}>{TEXT.linksHint}</Text>
        <div className={styles.inputRow}>
          <Input
            placeholder='https://example.com'
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                const target = event.target as HTMLInputElement;
                handleAddLink(target.value);
                target.value = '';
              }
            }}
          />
          <Button
            size='s'
            mode='filled'
            onClick={(event) => {
              const input = event.currentTarget.previousElementSibling as HTMLInputElement | null;
              if (input) {
                handleAddLink(input.value);
                input.value = '';
              }
            }}
            disabled={links.length >= 10}
          >
            {TEXT.addLink}
          </Button>
        </div>
        {links.length > 0 && (
          <div className={styles.tagRow}>
            {links.map((link) => (
              <button
                key={link}
                type='button'
                className={styles.actionButton}
                onClick={() => handleRemoveLink(link)}
              >
                {link} x
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.section}>
        <Text weight='2' className={styles.stepTitle}>{TEXT.stepDuration}</Text>
        <div className={styles.inputRow}>
          {config.durationOptions.map((option) => (
            <button
              key={option}
              type='button'
              className={`${styles.actionButton} ${option === durationOption ? styles.actionPrimary : ''}`}
              onClick={() => setDurationOption(option)}
            >
              {option} hours
            </button>
          ))}
          <button
            type='button'
            className={`${styles.actionButton} ${durationOption === 'custom' ? styles.actionPrimary : ''}`}
            onClick={() => setDurationOption('custom')}
          >
            {TEXT.durationCustom}
          </button>
          {durationOption === 'custom' && (
            <Input
              type='number'
              min={MIN_DURATION}
              value={customDuration}
              onChange={handleCustomDurationChange}
            />
          )}
        </div>
        <div className={styles.inputRow}>
          <Text weight='2'>{TEXT.winnersLabel}</Text>
          <Input type='number' min={MIN_WINNERS} value={winners} onChange={handleWinnersChange} />
        </div>
      </section>

      <section className={styles.section}>
        <Text weight='2' className={styles.stepTitle}>{TEXT.stepRequirements}</Text>
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <Text weight='2'>Premium users only</Text>
            <Text className={styles.formHint}>Participants must have Telegram Premium.</Text>
          </div>
          <Switch checked={premiumOnly} onChange={(event) => setPremiumOnly(event.target.checked)} />
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <Text weight='2'>Chat booster only</Text>
            <Text className={styles.formHint}>Limit to members boosting the host chat.</Text>
          </div>
          <Switch checked={chatBoosterOnly} onChange={(event) => setChatBoosterOnly(event.target.checked)} />
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <Text weight='2'>Invite a unique friend</Text>
            <Text className={styles.formHint}>Require participants to bring one new member.</Text>
          </div>
          <Switch checked={inviteFriend} onChange={(event) => setInviteFriend(event.target.checked)} />
        </div>

        <Text weight='2' className={styles.subTitle}>{TEXT.notificationsTitle}</Text>
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <Text weight='2'>Announce start in channel</Text>
          </div>
          <Switch checked={notifyStart} onChange={(event) => setNotifyStart(event.target.checked)} />
        </div>
        <div className={styles.toggleRow}>
          <div className={styles.toggleText}>
            <Text weight='2'>Announce results in channel</Text>
          </div>
          <Switch checked={notifyEnd} onChange={(event) => setNotifyEnd(event.target.checked)} />
        </div>
        <Input
          placeholder='Giveaway title (optional)'
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </section>

      <section className={styles.section}>
        <Text weight='2' className={styles.stepTitle}>{TEXT.stepSummary}</Text>
        <div className={styles.summaryBox}>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Host group</span>
            <span className={styles.summaryValue}>
              {groups.find((group) => group.id === selectedGroupId)?.title ?? 'Not selected'}
            </span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Reward</span>
            <span className={styles.summaryValue}>{plan ? `${plan.days} days access` : 'Not selected'}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Winners</span>
            <span className={styles.summaryValue}>{Math.max(MIN_WINNERS, winners)}</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Duration</span>
            <span className={styles.summaryValue}>{durationHours} hours</span>
          </div>
          <div className={styles.summaryItem}>
            <span className={styles.summaryLabel}>Total cost</span>
            <span className={styles.summaryValue}>{totalCost.toLocaleString('en-US')} Stars</span>
          </div>
        </div>
        <Button
          mode='filled'
          size='l'
          stretched
          disabled={!canSubmit}
          loading={processing}
          onClick={submit}
        >
          {processing ? TEXT.processing : TEXT.startGiveaway}
        </Button>
      </section>

      {snackbar && (
        <Snackbar onClose={() => setSnackbar(null)}>{snackbar}</Snackbar>
      )}
    </div>
  );
}
