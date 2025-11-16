import { useCallback, useEffect, useState, type ChangeEvent } from "react";
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
  Title,
} from "@telegram-apps/telegram-ui";

import { GroupMenuDrawer } from "@/features/dashboard/GroupMenuDrawer.tsx";
import {
  fetchGroupCountLimitSettings,
  fetchGroupDetails,
  updateGroupCountLimitSettings,
} from "@/features/dashboard/api.ts";
import type { CountLimitSettings, ManagedGroup } from "@/features/dashboard/types.ts";
import { classNames } from "@/css/classnames.ts";
import { formatNumber } from "@/utils/format.ts";

import styles from "./GroupCountLimitSettingsPage.module.css";

type LocationState = {
  group?: ManagedGroup;
};

const TEXT = {
  zeroDisabledNote: "Enter 0 to disable this limit.",
  loading: "Loading settings...",
  errorHeader: "Unable to load settings",
  back: "Back",
  unavailableHeader: "Settings are currently unavailable",
  unknownGroup: "Unknown group",
  pageSubtitle: "Count-based moderation limits",
  notice: "Set the values below to control message length, frequency, and duplicates. When a limit is exceeded the group's default penalty is applied automatically.",
  cardMinTitle: "Minimum message length",
  cardMinHint: "Messages shorter than this number of words are rejected.",
  cardMinLabel: "Minimum words",
  cardMinTooltip: "Shorter messages are removed and the default penalty is triggered.",
  placeholderWords: "Word count",
  cardMinStatusActive: "Messages must contain at least {value} words.",
  cardMaxTitle: "Maximum message length",
  cardMaxHint: "Messages longer than this many words are removed or warned.",
  cardMaxLabel: "Maximum words",
  cardMaxTooltip: "Set to 0 to allow any length or choose a value greater than the minimum.",
  cardMaxStatusInvalid: "The maximum cannot be lower than the minimum.",
  cardMaxStatusActive: "Messages longer than {value} words are blocked.",
  cardCountTitle: "Messages per window",
  cardCountHint: "Each user may send up to this many messages inside the selected window.",
  cardCountLabel: "Allowed messages",
  cardCountTooltip: "The bot counts messages per user and blocks them once the limit is exceeded.",
  cardCountStatusActive: "Up to {value} messages per window are allowed.",
  cardWindowTitle: "Counting window (minutes)",
  cardWindowHint: "Defines how long messages stay in the rolling window.",
  cardWindowLabel: "Window length",
  cardWindowTooltip: "Set to 0 to disable the rolling window.",
  cardWindowStatusActive: "Messages are counted over a {value} minute window.",
  cardWindowStatusDisabled: "Enable the message limit to configure the window.",
  cardDuplicateTitle: "Duplicate protection",
  cardDuplicateHint: "Limit how many times a user can repeat the same message.",
  cardDuplicateLabel: "Allowed duplicates",
  cardDuplicateTooltip: "After this many repeats the default penalty is applied.",
  cardDuplicateStatusActive: "Up to {value} duplicate messages are allowed.",
  cardDuplicateWindowTitle: "Duplicate tracking window (minutes)",
  cardDuplicateWindowHint: "Defines how long duplicates are remembered.",
  cardDuplicateWindowLabel: "Tracking window",
  cardDuplicateWindowTooltip: "Set to 0 to disable duplicate tracking.",
  cardDuplicateWindowStatusActive: "Duplicates are tracked for {value} minutes.",
  cardDuplicateWindowStatusDisabled: "Enable duplicate protection to configure the window.",
  placeholderMinutes: "Minutes",
  placeholderMessages: "Message count",
  saveText: "Save changes",
  savingText: "Saving...",
  saveSuccess: "Settings saved successfully.",
  saveErrorPrefix: "Failed to save settings: ",
};

const formatValue = (value: number): string => formatNumber(value);
export function GroupCountLimitSettingsPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [settings, setSettings] = useState<CountLimitSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [limits, detail] = await Promise.all([
          fetchGroupCountLimitSettings(groupId),
          fetchGroupDetails(groupId),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(limits);
        setGroup(detail.group);
        setDirty(false);
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

    void load();

    return () => {
      cancelled = true;
    };
  }, [groupId]);

  const updateSettings = useCallback((patch: Partial<CountLimitSettings>) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      setDirty(true);
      return { ...prev, ...patch };
    });
  }, []);

  const handleNumberChange = useCallback(
    (key: keyof CountLimitSettings) =>
      (event: ChangeEvent<HTMLInputElement>) => {
        const raw = event.target.value.trim();
        const parsed = raw === "" ? 0 : Number(raw);
        const sanitized = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : 0;
        updateSettings({ [key]: sanitized } as Partial<CountLimitSettings>);
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
        case "mute":
          navigate(`/groups/${groupId}/settings/mute`, { state: { group } });
          break;
        case "mandatory":
          navigate(`/groups/${groupId}/settings/mandatory`, { state: { group } });
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
        case "limits":
          break;
        default:
          console.info(`[count-limits] menu item '${key}' tapped`);
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
      const next = await updateGroupCountLimitSettings(groupId, settings);
      setSettings(next);
      setDirty(false);
      setToastMessage(TEXT.saveSuccess);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToastMessage(TEXT.saveErrorPrefix + message);
    } finally {
      setSaving(false);
    }
  }, [groupId, settings]);

  if (loading && !settings) {
    return (
      <div className={styles.loadingState} dir="ltr">
        <Text weight="2">{TEXT.loading}</Text>
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

  const minWords = settings.minWordsPerMessage;
  const maxWords = settings.maxWordsPerMessage;
  const messagesPerWindow = settings.messagesPerWindow;
  const windowMinutes = settings.windowMinutes;
  const duplicateMessages = settings.duplicateMessages;
  const duplicateWindowMinutes = settings.duplicateWindowMinutes;

  const minWordsInvalid = minWords <= 0;
  const maxWordsInvalid =
    maxWords <= 0 || (minWords > 0 && maxWords > 0 && maxWords < minWords);
  const messagesPerWindowInvalid = messagesPerWindow <= 0;
  const windowMinutesDisabled = messagesPerWindow <= 0;
  const windowMinutesInvalid = !windowMinutesDisabled && windowMinutes <= 0;
  const duplicateMessagesInvalid = duplicateMessages <= 0;
  const duplicateWindowDisabled = duplicateMessages <= 0;
  const duplicateWindowInvalid = !duplicateWindowDisabled && duplicateWindowMinutes <= 0;

  const canSave = dirty && !saving;

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
            acronym={group?.photoUrl ? undefined : group?.title?.charAt(0).toUpperCase() ?? "?"}
            alt={group?.title ?? "group"}
          />
          <div className={styles.headerTitles}>
            <Title level="3" className={styles.groupName}>
              {group ? group.title : TEXT.unknownGroup}
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
        <div className={styles.notice}>{TEXT.notice}</div>

        <div className={styles.cards}>
          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.cardMinTitle}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.cardMinHint}
                </Text>
              </div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.cardMinLabel}
                </Text>
                <button
                  type="button"
                  className={styles.tooltipButton}
                  title={TEXT.cardMinTooltip}
                >
                  ?
                </button>
              </div>
              <Input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder={TEXT.placeholderWords}
                value={minWords}
                status={minWordsInvalid ? "error" : "default"}
                onChange={handleNumberChange("minWordsPerMessage")}
              />
              <Text
                weight="2"
                className={classNames(
                  styles.fieldStatus,
                  minWordsInvalid ? styles.statusDisabled : styles.statusActive,
                )}
              >
                {minWordsInvalid
                  ? TEXT.zeroDisabledNote
                  : TEXT.cardMinStatusActive.replace("{value}", formatValue(minWords))}
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.cardMaxTitle}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.cardMaxHint}
                </Text>
              </div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.cardMaxLabel}
                </Text>
                <button
                  type="button"
                  className={styles.tooltipButton}
                  title={TEXT.cardMaxTooltip}
                >
                  ?
                </button>
              </div>
              <Input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder={TEXT.placeholderWords}
                value={maxWords}
                status={maxWordsInvalid ? "error" : "default"}
                onChange={handleNumberChange("maxWordsPerMessage")}
              />
              <Text
                weight="2"
                className={classNames(
                  styles.fieldStatus,
                  maxWordsInvalid ? styles.statusDisabled : styles.statusActive,
                )}
              >
                {maxWords <= 0
                  ? TEXT.zeroDisabledNote
                  : maxWords < minWords && minWords > 0
                    ? TEXT.cardMaxStatusInvalid
                    : TEXT.cardMaxStatusActive.replace("{value}", formatValue(maxWords))}
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.cardCountTitle}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.cardCountHint}
                </Text>
              </div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.cardCountLabel}
                </Text>
                <button
                  type="button"
                  className={styles.tooltipButton}
                  title={TEXT.cardCountTooltip}
                >
                  ?
                </button>
              </div>
              <Input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder={TEXT.placeholderMessages}
                value={messagesPerWindow}
                status={messagesPerWindowInvalid ? "error" : "default"}
                onChange={handleNumberChange("messagesPerWindow")}
              />
              <Text
                weight="2"
                className={classNames(
                  styles.fieldStatus,
                  messagesPerWindowInvalid ? styles.statusDisabled : styles.statusActive,
                )}
              >
                {messagesPerWindowInvalid
                  ? TEXT.zeroDisabledNote
                  : TEXT.cardCountStatusActive.replace("{value}", formatValue(messagesPerWindow))}
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.cardWindowTitle}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.cardWindowHint}
                </Text>
              </div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.cardWindowLabel}
                </Text>
                <button
                  type="button"
                  className={styles.tooltipButton}
                  title={TEXT.cardWindowTooltip}
                >
                  ?
                </button>
              </div>
              <Input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder={TEXT.placeholderMinutes}
                value={windowMinutes}
                status={windowMinutesInvalid ? "error" : "default"}
                disabled={windowMinutesDisabled}
                onChange={handleNumberChange("windowMinutes")}
              />
              <Text
                weight="2"
                className={classNames(
                  styles.fieldStatus,
                  windowMinutesInvalid ? styles.statusDisabled : styles.statusActive,
                )}
              >
                {windowMinutesDisabled
                  ? TEXT.cardWindowStatusDisabled
                  : windowMinutesInvalid
                    ? TEXT.zeroDisabledNote
                    : TEXT.cardWindowStatusActive.replace("{value}", formatValue(windowMinutes))}
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.cardDuplicateTitle}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.cardDuplicateHint}
                </Text>
              </div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.cardDuplicateLabel}
                </Text>
                <button
                  type="button"
                  className={styles.tooltipButton}
                  title={TEXT.cardDuplicateTooltip}
                >
                  ?
                </button>
              </div>
              <Input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder={TEXT.placeholderMessages}
                value={duplicateMessages}
                status={duplicateMessagesInvalid ? "error" : "default"}
                onChange={handleNumberChange("duplicateMessages")}
              />
              <Text
                weight="2"
                className={classNames(
                  styles.fieldStatus,
                  duplicateMessagesInvalid ? styles.statusDisabled : styles.statusActive,
                )}
              >
                {duplicateMessagesInvalid
                  ? TEXT.zeroDisabledNote
                  : TEXT.cardDuplicateStatusActive.replace("{value}", formatValue(duplicateMessages))}
              </Text>
            </div>
          </Card>

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div>
                <Title level="3" className={styles.cardTitle}>
                  {TEXT.cardDuplicateWindowTitle}
                </Title>
                <Text weight="2" className={styles.cardHint}>
                  {TEXT.cardDuplicateWindowHint}
                </Text>
              </div>
            </div>
            <div className={styles.field}>
              <div className={styles.fieldLabelRow}>
                <Text weight="2" className={styles.fieldLabel}>
                  {TEXT.cardDuplicateWindowLabel}
                </Text>
                <button
                  type="button"
                  className={styles.tooltipButton}
                  title={TEXT.cardDuplicateWindowTooltip}
                >
                  ?
                </button>
              </div>
              <Input
                className={styles.numberInput}
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                placeholder={TEXT.placeholderMinutes}
                value={duplicateWindowMinutes}
                status={duplicateWindowInvalid ? "error" : "default"}
                disabled={duplicateWindowDisabled}
                onChange={handleNumberChange("duplicateWindowMinutes")}
              />
              <Text
                weight="2"
                className={classNames(
                  styles.fieldStatus,
                  duplicateWindowInvalid ? styles.statusDisabled : styles.statusActive,
                )}
              >
                {duplicateWindowDisabled
                  ? TEXT.cardDuplicateWindowStatusDisabled
                  : duplicateWindowInvalid
                    ? TEXT.zeroDisabledNote
                    : TEXT.cardDuplicateWindowStatusActive.replace(
                        "{value}",
                        formatValue(duplicateWindowMinutes),
                      )}
              </Text>
            </div>
          </Card>
        </div>
      </main>

      <footer className={styles.saveBar}>
        <Button
          mode="filled"
          size="l"
          stretched
          disabled={!canSave}
          onClick={handleSave}
        >
          {saving ? TEXT.savingText : TEXT.saveText}
        </Button>
      </footer>

      <GroupMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey="limits"
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


