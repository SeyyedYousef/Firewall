import { useCallback, useEffect, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Avatar,
  Button,
  Card,
  IconButton,
  Input,
  Placeholder,
  Snackbar,
  Switch,
  Text,
  Title,
} from "@telegram-apps/telegram-ui";

import { GroupMenuDrawer } from "@/features/dashboard/GroupMenuDrawer.tsx";
import { fetchGroupDetails, fetchGroupGeneralSettings, updateGroupGeneralSettings } from "@/features/dashboard/api.ts";
import type {
  AutoWarningPenalty,
  GroupGeneralSettings,
  ManagedGroup,
  TimeRangeMode,
  TimeRangeSetting,
} from "@/features/dashboard/types.ts";

import styles from "./GeneralSettingsPage.module.css";

type LocationState = {
  group?: ManagedGroup;
};

type ScheduleSectionProps = {
  title: string;
  value: TimeRangeSetting;
  disabled?: boolean;
  onModeChange: (mode: TimeRangeMode) => void;
  onStartChange: (time: string) => void;
  onEndChange: (time: string) => void;
};

const TIMEZONE_OPTIONS = [
  { value: "UTC", label: "UTC (GMT+00:00 - Global)" },
  { value: "Europe/London", label: "Europe/London (GMT+00:00 - London)" },
  { value: "Europe/Lisbon", label: "Europe/Lisbon (GMT+00:00 - Lisbon)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (GMT+01:00 - Central Europe)" },
  { value: "Europe/Paris", label: "Europe/Paris (GMT+01:00 - Paris)" },
  { value: "Africa/Cairo", label: "Africa/Cairo (GMT+02:00 - Cairo)" },
  { value: "Europe/Kaliningrad", label: "Europe/Kaliningrad (GMT+02:00 - Kaliningrad)" },
  { value: "Europe/Istanbul", label: "Europe/Istanbul (GMT+03:00 - Istanbul)" },
  { value: "Europe/Moscow", label: "Europe/Moscow (GMT+03:00 - Moscow)" },
  { value: "Asia/Riyadh", label: "Asia/Riyadh (GMT+03:00 - Riyadh)" },
  { value: "Asia/Tehran", label: "Asia/Tehran (GMT+03:30 - Tehran)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GMT+04:00 - Dubai)" },
  { value: "Asia/Tbilisi", label: "Asia/Tbilisi (GMT+04:00 - Tbilisi)" },
  { value: "Asia/Yekaterinburg", label: "Asia/Yekaterinburg (GMT+05:00 - Yekaterinburg)" },
  { value: "Asia/Karachi", label: "Asia/Karachi (GMT+05:00 - Karachi)" },
  { value: "Asia/Colombo", label: "Asia/Colombo (GMT+05:30 - Colombo)" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (GMT+05:30 - New Delhi)" },
  { value: "Asia/Dhaka", label: "Asia/Dhaka (GMT+06:00 - Dhaka)" },
  { value: "Asia/Urumqi", label: "Asia/Urumqi (GMT+06:00 - Urumqi)" },
  { value: "Asia/Novosibirsk", label: "Asia/Novosibirsk (GMT+07:00 - Novosibirsk)" },
  { value: "Asia/Bangkok", label: "Asia/Bangkok (GMT+07:00 - Bangkok)" },
  { value: "Asia/Jakarta", label: "Asia/Jakarta (GMT+07:00 - Jakarta)" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai (GMT+08:00 - Beijing)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (GMT+08:00 - Singapore)" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (GMT+08:00 - Hong Kong)" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (GMT+09:00 - Tokyo)" },
  { value: "Asia/Seoul", label: "Asia/Seoul (GMT+09:00 - Seoul)" },
  { value: "Asia/Vladivostok", label: "Asia/Vladivostok (GMT+10:00 - Vladivostok)" },
  { value: "Australia/Sydney", label: "Australia/Sydney (GMT+10:00 - Sydney)" },
  { value: "Pacific/Auckland", label: "Pacific/Auckland (GMT+12:00 - Auckland)" },
  { value: "America/Sao_Paulo", label: "America/Sao_Paulo (GMT-03:00 - Sao Paulo)" },
  { value: "America/Buenos_Aires", label: "America/Buenos_Aires (GMT-03:00 - Buenos Aires)" },
  { value: "America/New_York", label: "America/New_York (GMT-05:00 - New York)" },
  { value: "America/Toronto", label: "America/Toronto (GMT-05:00 - Toronto)" },
  { value: "America/Chicago", label: "America/Chicago (GMT-06:00 - Chicago)" },
  { value: "America/Mexico_City", label: "America/Mexico_City (GMT-06:00 - Mexico City)" },
  { value: "America/Denver", label: "America/Denver (GMT-07:00 - Denver)" },
  { value: "America/Phoenix", label: "America/Phoenix (GMT-07:00 - Phoenix)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (GMT-08:00 - Los Angeles)" },
  { value: "America/Vancouver", label: "America/Vancouver (GMT-08:00 - Vancouver)" },
];


function ScheduleSection({ title, value, disabled, onModeChange, onStartChange, onEndChange }: ScheduleSectionProps) {
  return (
    <div className={styles.scheduleBlock} aria-disabled={disabled}>
      <Text weight="2" className={styles.fieldLabel}>
        {title}
      </Text>
      <div className={styles.fieldControl}>
        <select
          className={styles.select}
          value={value.mode}
          disabled={disabled}
          onChange={(event) => onModeChange(event.target.value as TimeRangeMode)}
        >
          <option value="all">Active at all hours</option>
          <option value="custom">Only during specific hours</option>
        </select>
      </div>
      {value.mode === "custom" && (
        <div className={styles.timeRange}>
          <label className={styles.timeItem}>
            <span>From</span>
            <Input
              type="time"
              value={value.start}
              disabled={disabled}
              onChange={(event) => onStartChange(event.target.value)}
            />
          </label>
          <label className={styles.timeItem}>
            <span>To</span>
            <Input
              type="time"
              value={value.end}
              disabled={disabled}
              onChange={(event) => onEndChange(event.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}

export function GroupGeneralSettingsPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [settings, setSettings] = useState<GroupGeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [general, detail] = await Promise.all([
          fetchGroupGeneralSettings(groupId),
          fetchGroupDetails(groupId),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(general);
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

  const updateSettings = useCallback((patch: Partial<GroupGeneralSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  }, []);

  const updateSchedule = useCallback(
    (
      key:
        | "welcomeSchedule"
        | "warningSchedule"
        | "userVerificationSchedule"
        | "disablePublicCommandsSchedule"
        | "removeJoinLeaveSchedule",
      value: TimeRangeSetting,
    ) => {
      setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
      setDirty(true);
    },
    [],
  );

  const updateAutoWarning = useCallback(
    (patch: Partial<GroupGeneralSettings["autoWarning"]>) => {
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              autoWarning: {
                ...prev.autoWarning,
                ...patch,
              },
            }
          : prev,
      );
      setDirty(true);
    },
    [],
  );

  const handleMenuSelect = useCallback(
    (key: string) => {
      if (!groupId) {
        return;
      }
      switch (key) {
        case "home":
          navigate(`/groups/${groupId}`);
          break;
        case "settings":
          break;
        case "bans":
          navigate(`/groups/${groupId}/settings/bans`, { state: { group } });
          break;
        case "mute":
          navigate(`/groups/${groupId}/settings/mute`, { state: { group } });
          break;
        case "limits":
          navigate(`/groups/${groupId}/settings/limits`, { state: { group } });
          break;
        case "mandatory":
          navigate(`/groups/${groupId}/settings/mandatory`, { state: { group } });
          break;
        case "texts":
          navigate(`/groups/${groupId}/settings/texts`, { state: { group } });
          break;
        case "giveaway":
          navigate("/giveaway/create", { state: { focusGroupId: groupId } });
          break;
        case "stars":
          navigate("/stars", { state: { focusGroupId: groupId } });
          break;
        case "analytics":
          navigate(`/groups/${groupId}/analytics`, { state: { group } });
          break;
        default:
          console.info(`[general-settings] menu item '${key}' tapped`);
      }
    },
    [groupId, group, navigate],
  );

  const handleSave = useCallback(async () => {
    if (!groupId || !settings) {
      return;
    }
    try {
      setSaving(true);
      await updateGroupGeneralSettings(groupId, settings);
      setDirty(false);
      setToastMessage("Settings saved successfully.");
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSaving(false);
    }
  }, [groupId, settings]);

  const handleToastClose = useCallback(() => setToastMessage(""), []);

  if (!groupId) {
    return (
      <Placeholder header="Group ID is invalid" description="Tap the button below to go back.">
        <Button mode="filled" onClick={() => navigate("/")}>
          Back
        </Button>
      </Placeholder>
    );
  }

  if (loading && !settings) {
    return (
      <div className={styles.loadingState}>
        <Text weight="2">Loading settings...</Text>
      </div>
    );
  }

  if (error && !settings) {
    return (
      <Placeholder header="Error loading" description={error.message}>
        <Button mode="filled" onClick={() => navigate(-1)}>
          Back
        </Button>
      </Placeholder>
    );
  }

  if (!settings) {
    return null;
  }

  return (
    <div className={styles.page}>
      <header className={styles.header} dir="ltr">
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
              {group ? group.title : "Loading"}
            </Title>
            <Text weight="2" className={styles.groupSubtitle}>
              General settings
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
        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Time zone</Title>
              <Text weight="2" className={styles.cardHint}>
                All schedules will use this selection.
              </Text>
            </div>
          </div>
          <div className={styles.fieldControl}>
            <select
              className={styles.select}
              value={settings.timezone}
              onChange={(event) => updateSettings({ timezone: event.target.value })}
            >
              {TIMEZONE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Welcome message</Title>
              <Text weight="2" className={styles.cardHint}>Send a welcome message to new members.</Text>
            </div>
            <Switch
              checked={settings.welcomeEnabled}
              onChange={(event) => updateSettings({ welcomeEnabled: event.target.checked })}
            />
          </div>
          {settings.welcomeEnabled && (
            <ScheduleSection
              title="Execution window"
              value={settings.welcomeSchedule}
              onModeChange={(mode) => updateSchedule("welcomeSchedule", { ...settings.welcomeSchedule, mode })}
              onStartChange={(value) => updateSchedule("welcomeSchedule", { ...settings.welcomeSchedule, start: value })}
              onEndChange={(value) => updateSchedule("welcomeSchedule", { ...settings.welcomeSchedule, end: value })}
            />
          )}
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Vote to mute</Title>
              <Text weight="2" className={styles.cardHint}>Members can vote to temporarily mute violating users.</Text>
            </div>
            <Switch
              checked={settings.voteMuteEnabled}
              onChange={(event) => updateSettings({ voteMuteEnabled: event.target.checked })}
            />
          </div>
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Warning message</Title>
              <Text weight="2" className={styles.cardHint}>Delete rule-breaking messages and post a warning in the group.</Text>
            </div>
            <Switch
              checked={settings.warningEnabled}
              onChange={(event) => updateSettings({ warningEnabled: event.target.checked })}
            />
          </div>
          {settings.warningEnabled && (
            <ScheduleSection
              title="Execution window"
              value={settings.warningSchedule}
              onModeChange={(mode) => updateSchedule("warningSchedule", { ...settings.warningSchedule, mode })}
              onStartChange={(value) => updateSchedule("warningSchedule", { ...settings.warningSchedule, start: value })}
              onEndChange={(value) => updateSchedule("warningSchedule", { ...settings.warningSchedule, end: value })}
            />
          )}
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Silent mode</Title>
              <Text weight="2" className={styles.cardHint}>When enabled, bot messages are sent without sound notifications.</Text>
            </div>
            <Switch
              checked={settings.silentModeEnabled}
              onChange={(event) => updateSettings({ silentModeEnabled: event.target.checked })}
            />
          </div>
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Auto-delete bot messages</Title>
              <Text weight="2" className={styles.cardHint}>Remove bot messages after the specified duration.</Text>
            </div>
            <Switch
              checked={settings.autoDeleteEnabled}
              onChange={(event) => updateSettings({ autoDeleteEnabled: event.target.checked })}
            />
          </div>
          {settings.autoDeleteEnabled && (
            <div className={styles.fieldRow}>
              <label className={styles.fieldLabel}>Deletion time (minutes)</label>
              <Input
                type="number"
                min={1}
                value={settings.autoDeleteDelayMinutes}
                onChange={(event) => updateSettings({ autoDeleteDelayMinutes: Number(event.target.value) })}
              />
            </div>
          )}
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Track admin violations</Title>
              <Text weight="2" className={styles.cardHint}>Track admin violations when enabled.</Text>
            </div>
            <Switch
              checked={settings.countAdminViolationsEnabled}
              onChange={(event) => updateSettings({ countAdminViolationsEnabled: event.target.checked })}
            />
          </div>
          {settings.countAdminViolationsEnabled && (
            <div className={styles.optionStack}>
              <label className={styles.optionItem}>
                <Switch
                  checked={settings.countAdminsOnly}
                  onChange={(event) => updateSettings({ countAdminsOnly: event.target.checked })}
                />
                <span>Only log violations</span>
              </label>
              <label className={styles.optionItem}>
                <Switch
                  checked={settings.deleteAdminViolations}
                  onChange={(event) => updateSettings({ deleteAdminViolations: event.target.checked })}
                />
                <span>Delete the admin's message on violation</span>
              </label>
            </div>
          )}
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Verify new members</Title>
              <Text weight="2" className={styles.cardHint}>New members cannot send messages until verified.</Text>
            </div>
            <Switch
              checked={settings.userVerificationEnabled}
              onChange={(event) => updateSettings({ userVerificationEnabled: event.target.checked })}
            />
          </div>
          {settings.userVerificationEnabled && (
            <ScheduleSection
              title="Verification schedule"
              value={settings.userVerificationSchedule}
              onModeChange={(mode) =>
                updateSchedule("userVerificationSchedule", { ...settings.userVerificationSchedule, mode })
              }
              onStartChange={(value) =>
                updateSchedule("userVerificationSchedule", { ...settings.userVerificationSchedule, start: value })
              }
              onEndChange={(value) =>
                updateSchedule("userVerificationSchedule", { ...settings.userVerificationSchedule, end: value })
              }
            />
          )}
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Public commands</Title>
              <Text weight="2" className={styles.cardHint}>Prevent members from using public commands.</Text>
            </div>
            <Switch
              checked={settings.disablePublicCommands}
              onChange={(event) => updateSettings({ disablePublicCommands: event.target.checked })}
            />
          </div>
          {settings.disablePublicCommands && (
            <ScheduleSection
              title="Restriction window"
              value={settings.disablePublicCommandsSchedule}
              onModeChange={(mode) =>
                updateSchedule("disablePublicCommandsSchedule", {
                  ...settings.disablePublicCommandsSchedule,
                  mode,
                })
              }
              onStartChange={(value) =>
                updateSchedule("disablePublicCommandsSchedule", {
                  ...settings.disablePublicCommandsSchedule,
                  start: value,
                })
              }
              onEndChange={(value) =>
                updateSchedule("disablePublicCommandsSchedule", {
                  ...settings.disablePublicCommandsSchedule,
                  end: value,
                })
              }
            />
          )}
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Hide join and leave messages</Title>
              <Text weight="2" className={styles.cardHint}>Do not show join and leave notifications.</Text>
            </div>
            <Switch
              checked={settings.removeJoinLeaveMessages}
              onChange={(event) => updateSettings({ removeJoinLeaveMessages: event.target.checked })}
            />
          </div>
          {settings.removeJoinLeaveMessages && (
            <ScheduleSection
              title="Message removal window"
              value={settings.removeJoinLeaveSchedule}
              onModeChange={(mode) =>
                updateSchedule("removeJoinLeaveSchedule", { ...settings.removeJoinLeaveSchedule, mode })
              }
              onStartChange={(value) =>
                updateSchedule("removeJoinLeaveSchedule", { ...settings.removeJoinLeaveSchedule, start: value })
              }
              onEndChange={(value) =>
                updateSchedule("removeJoinLeaveSchedule", { ...settings.removeJoinLeaveSchedule, end: value })
              }
            />
          )}
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Default system penalty</Title>
              <Text weight="2" className={styles.cardHint}>
                This penalty is used as the default for other modules unless they override it.
              </Text>
            </div>
          </div>
          <div className={styles.fieldControl}>
            <select
              className={styles.select}
              value={settings.defaultPenalty}
              onChange={(event) => updateSettings({ defaultPenalty: event.target.value as AutoWarningPenalty })}
            >
              <option value="delete">Delete message</option>
              <option value="mute">Mute</option>
              <option value="kick">Kick</option>
            </select>
          </div>
        </Card>

        <Card className={styles.card}>
          <div className={styles.cardHeader}>
            <div>
              <Title level="3" className={styles.cardTitle}>Automatic warning counter</Title>
              <Text weight="2" className={styles.cardHint}>Once the threshold is exceeded, the default penalty is applied.</Text>
            </div>
            <Switch
              checked={settings.autoWarningEnabled}
              onChange={(event) => updateSettings({ autoWarningEnabled: event.target.checked })}
            />
          </div>
          {settings.autoWarningEnabled && (
            <div className={styles.autoWarningFields}>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Allowed warning count</label>
                <Input
                  type="number"
                  min={1}
                  value={settings.autoWarning.threshold}
                  onChange={(event) => updateAutoWarning({ threshold: Number(event.target.value) })}
                />
              </div>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Retention period (days)</label>
                <Input
                  type="number"
                  min={1}
                  value={settings.autoWarning.retentionDays}
                  onChange={(event) => updateAutoWarning({ retentionDays: Number(event.target.value) })}
                />
              </div>
              <div className={styles.fieldRow}>
                <label className={styles.fieldLabel}>Default warning penalty</label>
                <select
                  className={styles.select}
                  value={settings.autoWarning.penalty}
                  onChange={(event) => updateAutoWarning({ penalty: event.target.value as AutoWarningPenalty })}
                >
                  <option value="delete">Delete message</option>
                  <option value="mute">Mute</option>
                  <option value="kick">Kick</option>
                </select>
              </div>
              <ScheduleSection
                title="Execution window"
                value={settings.autoWarning.schedule}
                onModeChange={(mode) => updateAutoWarning({ schedule: { ...settings.autoWarning.schedule, mode } })}
                onStartChange={(value) => updateAutoWarning({ schedule: { ...settings.autoWarning.schedule, start: value } })}
                onEndChange={(value) => updateAutoWarning({ schedule: { ...settings.autoWarning.schedule, end: value } })}
              />
            </div>
          )}
        </Card>
      </main>

      <footer className={styles.saveBar}>
        <Button
          mode="filled"
          size="l"
          stretched
          disabled={!dirty || saving}
          onClick={handleSave}
        >
          {saving ? "Saving..." : "Save settings"}
        </Button>
      </footer>

      <GroupMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey="settings"
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
