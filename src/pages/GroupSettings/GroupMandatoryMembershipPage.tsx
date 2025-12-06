import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Button,
  Card,
  IconButton,
  Input,
  Placeholder,
  Snackbar,
  Text,
  Textarea,
  Title,
} from "@telegram-apps/telegram-ui";

import { GroupMenuDrawer } from "@/features/dashboard/GroupMenuDrawer.tsx";
import {
  fetchGroupDetails,
  fetchGroupMandatoryMembershipSettings,
  updateGroupMandatoryMembershipSettings,
} from "@/features/dashboard/api.ts";
import type { ManagedGroup, MandatoryMembershipSettings } from "@/features/dashboard/types.ts";
import { classNames } from "@/css/classnames.ts";
import { PremiumBadge } from "@/components/PremiumLock";

import styles from "./GroupMandatoryMembershipPage.module.css";

type LocationState = {
  group?: ManagedGroup;
};

const TEXT = {
  pageSubtitle: "Mandatory membership",
  loading: "Loading settings...",
  errorHeader: "Unable to load information",
  back: "Back",
  unavailableHeader: "Settings are currently unavailable",
  notice: "Require members to invite newcomers or join specific channels before they can send messages.",
  forcedTitle: "Invite requirement",
  forcedHint: "Members must invite a set number of new users before they can chat.",
  forcedTooltip: "Enter 0 to disable the invite requirement.",
  forcedLabel: "Required invitations per member",
  resetTitle: "Invite counter reset (days)",
  resetHint: "Automatically reset the invite counter after the selected number of days.",
  resetTooltip: "Set to 0 to keep the counter without automatic resets.",
  resetLabel: "Reset after (days)",
  channelsTitle: "Required channels",
  channelsHint: "Members must join every channel in the list before they can chat.",
  channelsTooltip:
    "Add one @username per line. The bot must be an administrator in each required channel (public or private).",
  channelsPlaceholder: `@channel_one
@channel_two`,
  channelsSummary: (channels: string[]) =>
    channels.length > 0
      ? `Members must join: ${channels.join(", ")}.`
      : "No mandatory channels configured.",
  forcedSummary: (count: number, reset: number) => {
    if (count <= 0) {
      return "Inviting new members is not required.";
    }
    if (reset <= 0) {
      return `Members must invite ${count} new member(s); the counter never resets automatically.`;
    }
    return `Members must invite ${count} new member(s); the counter resets every ${reset} day(s).`;
  },
  resetSummary: (count: number, reset: number) => {
    if (count <= 0) {
      return "The invite counter stays inactive while the requirement is disabled.";
    }
    if (reset <= 0) {
      return "The invite counter never resets automatically.";
    }
    return `The invite counter resets every ${reset} day(s).`;
  },
  channelsErrorPrefix: "Channel validation failed:",
  save: "Save settings",
  saving: "Saving...",
  saveSuccess: "Settings saved successfully.",
  saveErrorPrefix: "Failed to save settings: ",
};

const CHANNEL_REGEX = /^@[a-zA-Z0-9_]{5,}$/;


export function GroupMandatoryMembershipPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [settings, setSettings] = useState<MandatoryMembershipSettings | null>(null);
  const [channelsInput, setChannelsInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [forcedInviteCountText, setForcedInviteCountText] = useState("");
  const [forcedInviteResetDaysText, setForcedInviteResetDaysText] = useState("");

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [mandatory, detail] = await Promise.all([
          fetchGroupMandatoryMembershipSettings(groupId),
          fetchGroupDetails(groupId),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(mandatory);
        setChannelsInput(mandatory.mandatoryChannels.join("\n"));
        setForcedInviteCountText(String(mandatory.forcedInviteCount ?? 0));
        setForcedInviteResetDaysText(String(mandatory.forcedInviteResetDays ?? 0));
        setGroup(detail.group);
        setDirty(false);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err : new Error(String(err)));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const updateSettings = useCallback((patch: Partial<MandatoryMembershipSettings>) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      setDirty(true);
      return { ...prev, ...patch };
    });
  }, []);

  const handleForcedChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setForcedInviteCountText(raw);
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        updateSettings({ forcedInviteCount: 0 });
        return;
      }
      const parsed = Number(trimmed);
      const value = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
      updateSettings({ forcedInviteCount: value });
    },
    [updateSettings],
  );

  const handleResetChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setForcedInviteResetDaysText(raw);
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        updateSettings({ forcedInviteResetDays: 0 });
        return;
      }
      const parsed = Number(trimmed);
      const value = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
      updateSettings({ forcedInviteResetDays: value });
    },
    [updateSettings],
  );

  const handleChannelsChange = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      const value = event.target.value;
      setChannelsInput(value);
      const channels = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      updateSettings({ mandatoryChannels: channels });
    },
    [updateSettings],
  );

  const handleMenuSelect = useCallback(
    (key: string) => {
      if (!groupId) {
        return;
      }
      switch (key) {
        case "home":
          navigate(`/groups/${groupId}`, { state: { group } });
          break;
        case "settings":
          navigate(`/groups/${groupId}/settings/general`, { state: { group } });
          break;
        case "bans":
          navigate(`/groups/${groupId}/settings/bans`, { state: { group } });
          break;
        case "limits":
          navigate(`/groups/${groupId}/settings/limits`, { state: { group } });
          break;
        case "mute":
          navigate(`/groups/${groupId}/settings/mute`, { state: { group } });
          break;
        case "texts":
          navigate(`/groups/${groupId}/settings/texts`, { state: { group } });
          break;
        case "giveaway":
          navigate("/giveaways/create", { state: { focusGroupId: groupId } });
          break;
        case "stars":
          navigate("/stars", { state: { focusGroupId: groupId } });
          break;
        case "analytics":
          navigate(`/groups/${groupId}/analytics`, { state: { group } });
          break;
        case "mandatory":
          break;
        default:
          console.info(`[mandatory-settings] menu item '${key}' tapped`);
      }
    },
    [groupId, group, navigate],
  );

  const handleToastClose = useCallback(() => {
    setToastMessage("");
  }, []);

  const handleSave = useCallback(async () => {
    if (!groupId || !settings) {
      return;
    }
    try {
      setSaving(true);
      const next = await updateGroupMandatoryMembershipSettings(groupId, settings);
      setSettings(next);
      setChannelsInput(next.mandatoryChannels.join("\n"));
      setForcedInviteCountText(String(next.forcedInviteCount ?? 0));
      setForcedInviteResetDaysText(String(next.forcedInviteResetDays ?? 0));
      setDirty(false);
      setToastMessage(TEXT.saveSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToastMessage(TEXT.saveErrorPrefix + message);
    } finally {
      setSaving(false);
    }
  }, [groupId, settings]);

  const invalidChannels = useMemo(() => {
    if (!settings) {
      return [] as string[];
    }
    return settings.mandatoryChannels.filter((channel) => !CHANNEL_REGEX.test(channel));
  }, [settings]);

  const hasErrors = invalidChannels.length > 0;

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '200px' }}>
        <div style={{ width: 32, height: 32, border: '3px solid rgba(255,255,255,0.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      </div>
    );
  }

  if (error) {
    return (
      <Placeholder header={TEXT.errorHeader} description={error.message}>
        <Button mode="filled" onClick={() => navigate(-1)}>
          {TEXT.back}
        </Button>
      </Placeholder>
    );
  }

  if (!settings) {
    return (
      <Placeholder header={TEXT.unavailableHeader}>
        <Button mode="filled" onClick={() => navigate(-1)}>
          {TEXT.back}
        </Button>
      </Placeholder>
    );
  }

  const canSave = dirty && !saving && !hasErrors;
  const forcedInviteCount = settings.forcedInviteCount;
  const forcedInviteResetDays = settings.forcedInviteResetDays;
  const mandatoryChannels = settings.mandatoryChannels;

  const forcedSummaryText = TEXT.forcedSummary(forcedInviteCount, forcedInviteResetDays);
  const resetSummaryText = TEXT.resetSummary(forcedInviteCount, forcedInviteResetDays);
  const channelsSummaryText = TEXT.channelsSummary(mandatoryChannels);

  return (
    <div className={styles.page} dir="ltr">
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <IconButton
            aria-label="Back"
            onClick={() => navigate(-1)}
            className={styles.backButton}
          >
            <span className={styles.backIcon} aria-hidden="true" />
          </IconButton>
        </div>
        <div className={styles.headerCenter}>
          <Avatar
            size={48}
            src={group?.photoUrl ?? undefined}
            acronym={group?.photoUrl ? undefined : ((group?.title?.charAt(0).toUpperCase() ?? "?") ?? undefined)}
            alt={group?.title ?? "group"}
          />
          <div className={styles.headerTitles}>
            <Title level="3" className={styles.groupName}>
              {group ? group.title : "Unknown group"}
            </Title>
            <Text weight="2" className={styles.groupSubtitle}>
              {TEXT.pageSubtitle}
            </Text>
          </div>
        </div>
        <div className={styles.headerRight}>
          <IconButton aria-label="Open menu" onClick={() => setMenuOpen(true)} className={styles.menuButton}>
            <span className={styles.burger}>
              <span />
              <span />
              <span />
            </span>
          </IconButton>
        </div>
      </header>

      <main className={styles.body}>
        <Text weight="2" className={styles.notice}>
          {TEXT.notice}
        </Text>

        <div className={styles.cards}>
          <Card className={classNames(styles.card, styles.cardPrimary)}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.forcedTitle} {group?.subscriptionType !== 'premium' && '⭐'}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.forcedHint}
                  {group?.subscriptionType !== 'premium' && (
                    <span style={{ color: 'var(--tg-theme-destructive-text-color)', display: 'block', marginTop: 4 }}>
                      Premium feature. Upgrade to enable.
                    </span>
                  )}
                </Text>
              </div>
              <button type="button" className={styles.tooltipButton} title={TEXT.forcedTooltip}>
                ?
              </button>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.forcedLabel}
                </Text>
                <Input
                  className={styles.numberInput}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={forcedInviteCountText}
                  onChange={handleForcedChange}
                  disabled={group?.subscriptionType !== 'premium'}
                />
              </div>
              <Text weight="2" className={classNames(styles.summaryText, forcedInviteCount <= 0 && styles.summaryMuted)}>
                {forcedSummaryText}
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.resetTitle}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.resetHint}
                </Text>
              </div>
              <button type="button" className={styles.tooltipButton} title={TEXT.resetTooltip}>
                ?
              </button>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.resetLabel}
                </Text>
                <Input
                  className={styles.numberInput}
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  placeholder="0"
                  value={forcedInviteResetDaysText}
                  onChange={handleResetChange}
                />
              </div>
              <Text weight="2" className={classNames(styles.summaryText, forcedInviteCount <= 0 && styles.summaryMuted)}>
                {resetSummaryText}
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.channelsTitle} {group?.subscriptionType !== 'premium' && '⭐'}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.channelsHint}
                  {group?.subscriptionType !== 'premium' && (
                    <span style={{ color: 'var(--tg-theme-destructive-text-color)', display: 'block', marginTop: 4 }}>
                      Premium feature. Upgrade to enable.
                    </span>
                  )}
                </Text>
              </div>
              <button type="button" className={styles.tooltipButton} title={TEXT.channelsTooltip}>
                ?
              </button>
            </div>
            <div className={styles.field}>
              <Textarea
                className={styles.textarea}
                placeholder={TEXT.channelsPlaceholder}
                value={channelsInput}
                onChange={handleChannelsChange}
                disabled={group?.subscriptionType !== 'premium'}
              />
              {group?.subscriptionType !== 'premium' && mandatoryChannels.length >= 1 && (
                <Text weight="2" className={styles.premiumNotice}>
                  <PremiumBadge /> Free plan: 1 channel max. Upgrade for up to 3 channels.
                </Text>
              )}
              <Text
                weight="2"
                className={classNames(styles.summaryText, mandatoryChannels.length === 0 && styles.summaryMuted)}
              >
                {channelsSummaryText}
              </Text>
              {mandatoryChannels.length > 0 && (
                <div className={styles.channelPreview}>
                  {mandatoryChannels.map((channel) => (
                    <span key={channel}>{channel}</span>
                  ))}
                </div>
              )}
              {invalidChannels.length > 0 && (
                <Text weight="2" className={styles.errorText}>
                  {`${TEXT.channelsErrorPrefix} ${invalidChannels.join(", ")}`}
                </Text>
              )}
            </div>
          </Card>
        </div>
      </main>

      <footer className={styles.saveBar}>
        <Button mode="filled" size="l" stretched disabled={!canSave} onClick={handleSave}>
          {saving ? TEXT.saving : TEXT.save}
        </Button>
      </footer>

      <GroupMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey="mandatory"
        onSelect={handleMenuSelect}
      />

      {toastMessage && (
        <Snackbar onClose={handleToastClose} duration={3500} className={styles.snackbar}>
          {toastMessage}
        </Snackbar>
      )}
    </div>
  );
}
