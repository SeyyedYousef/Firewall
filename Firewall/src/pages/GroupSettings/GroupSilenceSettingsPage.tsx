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
  Switch,
  Text,
  Title,
} from "@telegram-apps/telegram-ui";

import { GroupMenuDrawer } from "@/features/dashboard/GroupMenuDrawer.tsx";
import {
  fetchGroupDetails,
  fetchGroupSilenceSettings,
  updateGroupSilenceSettings,
} from "@/features/dashboard/api.ts";
import type { ManagedGroup, SilenceSettings, SilenceWindowSetting } from "@/features/dashboard/types.ts";
import { classNames } from "@/css/classnames.ts";

import styles from "./GroupSilenceSettingsPage.module.css";

type LocationState = {
  group?: ManagedGroup;
};

type SilenceKey = keyof SilenceSettings;

type TimeField = "start" | "end";

const TEXT = {
  pageSubtitle: "Quiet periods",
  loading: "Loading settings...",
  errorHeader: "Error fetching data",
  back: "Back",
  unavailableHeader: "Settings are unavailable",
  notice: "Use this section to define an emergency lock or scheduled quiet periods. When enabled, messages are blocked according to the schedule.",
  save: "Save settings",
  saving: "Saving...",
  saveSuccess: "Settings saved successfully.",
  saveErrorPrefix: "Saving settings failed: ",
  emergencyTitle: "Temporary group lock",
  emergencyHint: "If enabled, every message type (text, images, files, etc.) is blocked for the entire duration.",
  silenceTitle: (index: number) => `Quiet period ${index}`,
  silenceHint: "Use this to limit conversations during specific hours (for example overnight).",
  startLabel: "Start time",
  endLabel: "End time",
  summaryActive: (start: string, end: string) => `Quiet period active from ${start} to ${end}`,
  summaryInactive: "Quiet period is disabled.",
  summaryEmergencyActive: (start: string, end: string) => `Emergency lock active from ${start} to ${end}`,
  summaryEmergencyInactive: "Emergency lock is inactive.",
  errorRange: "End time must be after the start time.",
};


function parseTimeMinutes(value: string): number | null {
  const parts = value.split(":");
  if (parts.length !== 2) {
    return null;
  }
  const [hourText, minuteText] = parts;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    return null;
  }
  return hour * 60 + minute;
}

function sanitizeTimeInput(value: string): string {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(trimmed);
  if (!match) {
    return trimmed.length === 0 ? "00:00" : trimmed;
  }
  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;
}

function isWindowInvalid(window: SilenceWindowSetting): boolean {
  if (!window.enabled) {
    return false;
  }
  const startMinutes = parseTimeMinutes(window.start);
  const endMinutes = parseTimeMinutes(window.end);
  if (startMinutes === null || endMinutes === null) {
    return true;
  }
  return endMinutes <= startMinutes;
}

const CARD_DEFINITIONS: Array<{
  key: SilenceKey;
  title: string;
  hint: string;
  accent?: "danger";
  summaryActive: (start: string, end: string) => string;
  summaryInactive: string;
}> = [
  {
    key: "emergencyLock",
    title: TEXT.emergencyTitle,
    hint: TEXT.emergencyHint,
    accent: "danger",
    summaryActive: TEXT.summaryEmergencyActive,
    summaryInactive: TEXT.summaryEmergencyInactive,
  },
  {
    key: "window1",
    title: TEXT.silenceTitle(1),
    hint: TEXT.silenceHint,
    summaryActive: TEXT.summaryActive,
    summaryInactive: TEXT.summaryInactive,
  },
  {
    key: "window2",
    title: TEXT.silenceTitle(2),
    hint: TEXT.silenceHint,
    summaryActive: TEXT.summaryActive,
    summaryInactive: TEXT.summaryInactive,
  },
  {
    key: "window3",
    title: TEXT.silenceTitle(3),
    hint: TEXT.silenceHint,
    summaryActive: TEXT.summaryActive,
    summaryInactive: TEXT.summaryInactive,
  },
];

export function GroupSilenceSettingsPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [settings, setSettings] = useState<SilenceSettings | null>(null);
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
        const [silence, detail] = await Promise.all([
          fetchGroupSilenceSettings(groupId),
          fetchGroupDetails(groupId),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(silence);
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

  const updateWindow = useCallback(
    (key: SilenceKey, patch: Partial<SilenceWindowSetting>) => {
      setSettings((prev) => {
        if (!prev) {
          return prev;
        }
        setDirty(true);
        return { ...prev, [key]: { ...prev[key], ...patch } };
      });
    },
    [],
  );

  const handleToggle = useCallback(
    (key: SilenceKey) => (event: ChangeEvent<HTMLInputElement>) => {
      updateWindow(key, { enabled: event.target.checked });
    },
    [updateWindow],
  );

  const handleTimeChange = useCallback(
    (key: SilenceKey, field: TimeField) => (event: ChangeEvent<HTMLInputElement>) => {
      updateWindow(key, { [field]: sanitizeTimeInput(event.target.value) } as Partial<SilenceWindowSetting>);
    },
    [updateWindow],
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
        case "mute":
          break;
        default:
          console.info(`[silence-settings] menu item '${key}' tapped`);
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
      const next = await updateGroupSilenceSettings(groupId, settings);
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

  const windowErrors = useMemo(() => {
    if (!settings) {
      return {
        emergencyLock: false,
        window1: false,
        window2: false,
        window3: false,
      } as Record<SilenceKey, boolean>;
    }
    return {
      emergencyLock: isWindowInvalid(settings.emergencyLock),
      window1: isWindowInvalid(settings.window1),
      window2: isWindowInvalid(settings.window2),
      window3: isWindowInvalid(settings.window3),
    } satisfies Record<SilenceKey, boolean>;
  }, [settings]);

  const hasErrors = useMemo(() => Object.values(windowErrors).some(Boolean), [windowErrors]);

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

  const canSave = dirty && !saving && !hasErrors;

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
        <Text weight="2">{TEXT.notice}</Text>

        <div className={styles.cards}>
          {CARD_DEFINITIONS.map((definition) => {
            const windowSetting = settings[definition.key];
            const hasError = windowErrors[definition.key];
            const isActive = windowSetting.enabled;
            const cardClass = classNames(
              styles.card,
              definition.accent === "danger" && styles.cardDanger,
            );
            const summaryClass = classNames(
              styles.summaryText,
              !isActive ? styles.summaryInactive : definition.accent === "danger" ? styles.summaryDanger : styles.summaryActive,
            );
            const summaryText = isActive
              ? definition.summaryActive(windowSetting.start, windowSetting.end)
              : definition.summaryInactive;

            return (
              <Card key={definition.key} className={cardClass}>
                <div className={styles.cardHeader}>
                  <div>
                    <Title level="3" className={styles.cardTitle}>
                      {definition.title}
                    </Title>
                    <Text weight="2" className={styles.cardHint}>
                      {definition.hint}
                    </Text>
                  </div>
                  <Switch checked={isActive} onChange={handleToggle(definition.key)} />
                </div>

                <div className={styles.summaryRow}>
                  <Text weight="2" className={summaryClass}>
                    {summaryText}
                  </Text>
                </div>

                {isActive && (
                  <div className={styles.field}>
                    <div className={styles.timeFields}>
                      <label className={styles.timeLabel}>
                        <span>{TEXT.startLabel}</span>
                        <Input
                          type="time"
                          value={windowSetting.start}
                          onChange={handleTimeChange(definition.key, "start")}
                          min="00:00"
                          max="23:59"
                          step={300}
                        />
                      </label>
                      <label className={styles.timeLabel}>
                        <span>{TEXT.endLabel}</span>
                        <Input
                          type="time"
                          value={windowSetting.end}
                          onChange={handleTimeChange(definition.key, "end")}
                          min="00:00"
                          max="23:59"
                          step={300}
                        />
                      </label>
                    </div>
                    {hasError && (
                      <Text weight="2" className={styles.errorText}>
                        {TEXT.errorRange}
                      </Text>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
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
        activeKey="mute"
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
