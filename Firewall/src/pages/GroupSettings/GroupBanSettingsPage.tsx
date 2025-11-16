import { useCallback, useEffect, useMemo, useState } from "react";
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
  Textarea,
  Title,
} from "@telegram-apps/telegram-ui";

import { GroupMenuDrawer } from "@/features/dashboard/GroupMenuDrawer.tsx";
import {
  fetchGroupBanSettings,
  fetchGroupDetails,
  updateGroupBanSettings,
} from "@/features/dashboard/api.ts";
import type {
  BanRuleKey,
  BanRuleSetting,
  GroupBanSettings,
  ManagedGroup,
  TimeRangeMode,
  TimeRangeSetting,
} from "@/features/dashboard/types.ts";

import styles from "./GroupBanSettingsPage.module.css";

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

type KeywordListCardProps = {
  title: string;
  description: string;
  value: string[];
  onChange: (next: string[]) => void;
  onImport: () => void;
  onExport: () => void;
};

function KeywordListCard({ title, description, value, onChange, onImport, onExport }: KeywordListCardProps) {
  const lines = value.length;

  return (
    <Card className={styles.card}>
      <div className={styles.cardHeader}>
        <div>
          <Title level="3" className={styles.cardTitle}>
            {title}
          </Title>
          <Text weight="2" className={styles.cardHint}>
            {description}
          </Text>
        </div>
        <div className={styles.keywordActions}>
          <Button mode="outline" size="s" onClick={onImport}>
            Import
          </Button>
          <Button mode="outline" size="s" onClick={onExport}>
            Copy export
          </Button>
        </div>
      </div>
      <Textarea
        className={styles.textarea}
        rows={6}
        placeholder="Each line contains one word or phrase"
        value={value.join("\n")}
        onChange={(event) => {
          const next = event.target.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean);
          onChange(next);
        }}
      />
      <Text weight="2" className={styles.keywordMeta}>
        {lines} entries recorded
      </Text>
    </Card>
  );
}

type BanRuleDefinition = {
  key: BanRuleKey;
  title: string;
  description: string;
  category: string;
  icon?: string;
};



const BAN_RULE_DEFINITIONS: BanRuleDefinition[] = [
  { key: "banLinks", title: "Remove links", description: "All URLs and links are removed.", category: "links", icon: "🔗" },
  { key: "banBots", title: "Block bots", description: "Messages sent by bots are blocked.", category: "links", icon: "🤖" },
  { key: "banBotInviters", title: "Remove bot inviters", description: "Users who add bots are removed from the group.", category: "links", icon: "🚫🤖" },
  { key: "banDomains", title: "Block domains", description: "Messages containing a website address are removed.", category: "links", icon: "🌐" },
  { key: "banUsernames", title: "Block usernames", description: "@username mentions are not allowed.", category: "links", icon: "@" },
  { key: "banHashtags", title: "Block hashtags", description: "Messages containing # are removed.", category: "text", icon: "#" },
  { key: "banTextPatterns", title: "Block text patterns", description: "Custom text patterns are not allowed.", category: "text", icon: "✳️" },
  { key: "banForward", title: "Block forwards", description: "Forwarded messages are not allowed.", category: "interaction", icon: "🔁" },
  { key: "banForwardChannels", title: "Restrict forwards from channels", description: "Only forwards from channels are restricted.", category: "interaction", icon: "📣" },
  { key: "banPhotos", title: "Block photos", description: "Sending photos is not allowed.", category: "media", icon: "🖼️" },
  { key: "banStickers", title: "Block stickers", description: "Using stickers is not allowed.", category: "media", icon: "💠" },
  { key: "banEmojis", title: "Block emojis", description: "Messages containing emojis are removed.", category: "text", icon: "😊" },
  { key: "banEmojiOnly", title: "Block emoji-only messages", description: "Messages composed solely of emojis are removed.", category: "text", icon: "😀" },
  { key: "banLocation", title: "Block locations", description: "Sharing locations is restricted.", category: "media", icon: "📍" },
  { key: "banPhones", title: "Block phone numbers", description: "Messages containing phone numbers are removed.", category: "text", icon: "📞" },
  { key: "banAudio", title: "Block audio", description: "Audio files (songs) are blocked.", category: "media", icon: "🎵" },
  { key: "banVoice", title: "Block voice messages", description: "Voice messages are not allowed.", category: "media", icon: "🎤" },
  { key: "banFiles", title: "Block files", description: "Files and documents are removed.", category: "media", icon: "📄" },
  { key: "banApps", title: "Block app messages", description: "Messages from games or apps are blocked.", category: "interaction", icon: "🕹️" },
  { key: "banGif", title: "Block GIFs", description: "Sending GIFs is not allowed.", category: "media", icon: "🎞️" },
  { key: "banPolls", title: "Block polls", description: "Creating polls in the group is not allowed.", category: "interaction", icon: "📊" },
  { key: "banInlineKeyboards", title: "Block inline keyboards", description: "Messages with inline buttons are removed.", category: "interaction", icon: "🔘" },
  { key: "banGames", title: "Block games", description: "Game messages are restricted.", category: "interaction", icon: "🎮" },
  { key: "banSlashCommands", title: "Block slash commands", description: "Slash commands (/command) cannot be used.", category: "interaction", icon: "/" },
  { key: "banCaptionless", title: "Block captionless posts", description: "Images without captions are removed.", category: "media", icon: "🖼️" },
  { key: "banLatin", title: "Block Latin letters", description: "English letters are not allowed in messages.", category: "language", icon: "A" },
  { key: "banPersian", title: "Block Persian/Arabic letters", description: "Persian or Arabic text is restricted.", category: "language", icon: "فا" },
  { key: "banCyrillic", title: "Block Cyrillic letters", description: "Cyrillic characters are removed.", category: "language", icon: "РУ" },
  { key: "banChinese", title: "Block Chinese characters", description: "Chinese characters are not allowed.", category: "language", icon: "汉" },
  { key: "banUserReplies", title: "Block user replies", description: "Regular members cannot reply to each other.", category: "interaction", icon: "💬" },
  { key: "banCrossReplies", title: "Block cross-chat replies", description: "Replies from other chats are blocked.", category: "interaction", icon: "↔️" },
];const CATEGORY_GROUPS = [
  { id: "links", title: "Links & IDs" },
  { id: "text", title: "Text & symbols" },
  { id: "media", title: "Media & files" },
  { id: "interaction", title: "Interactions" },
  { id: "language", title: "Languages" },
  { id: "advanced", title: "Advanced" },
];


export function GroupBanSettingsPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [settings, setSettings] = useState<GroupBanSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  const groupedRules = useMemo(() => {
    const map = new Map<string, BanRuleDefinition[]>();
    BAN_RULE_DEFINITIONS.forEach((rule) => {
      const bucket = map.get(rule.category) ?? [];
      bucket.push(rule);
      map.set(rule.category, bucket);
    });
    return CATEGORY_GROUPS.map((category) => ({
      ...category,
      rules: map.get(category.id) ?? [],
    })).filter((category) => category.rules.length > 0);
  }, []);

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [banSettings, detail] = await Promise.all([
          fetchGroupBanSettings(groupId),
          fetchGroupDetails(groupId),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(banSettings);
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

  const updateRule = useCallback((key: BanRuleKey, patch: Partial<BanRuleSetting>) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      return {
        ...prev,
        rules: {
          ...prev.rules,
          [key]: {
            ...prev.rules[key],
            ...patch,
          },
        },
      };
    });
    setDirty(true);
  }, []);

  const updateRuleSchedule = useCallback(
    (key: BanRuleKey, schedule: TimeRangeSetting) => {
      updateRule(key, { schedule });
    },
    [updateRule],
  );

  const updateKeywordList = useCallback(
    (type: "blacklist" | "whitelist", list: string[]) => {
      setSettings((prev) => (prev ? { ...prev, [type]: list } : prev));
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
          navigate(`/groups/${groupId}/settings/general`, { state: { group } });
          break;
        case "bans":
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
          navigate("/giveaways/create", { state: { focusGroupId: groupId } });
          break;
        case "stars":
          navigate("/stars", { state: { focusGroupId: groupId } });
          break;
        case "analytics":
          navigate(`/groups/${groupId}/analytics`, { state: { group } });
          break;
        default:
          console.info(`[ban-settings] menu item '${key}' tapped`);
      }
    },
    [groupId, group, navigate],
  );

  const handleImportList = useCallback(
    (type: "blacklist" | "whitelist") => {
      const value = window.prompt("Enter words separated by new lines:", "");
      if (value === null) {
        return;
      }
      const next = value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      updateKeywordList(type, next);
      setToastMessage("List replaced successfully \u2705");
    },
    [updateKeywordList],
  );

  const handleExportList = useCallback(
    async (type: "blacklist" | "whitelist") => {
      if (!settings) {
        return;
      }
      const text = settings[type].join("\n");
      try {
        await navigator.clipboard.writeText(text);
        setToastMessage("List copied to clipboard \u2705");
      } catch (err) {
        console.error("clipboard error", err);
        setToastMessage("Copy to clipboard failed \u274C");
      }
    },
    [settings],
  );

  const handleSave = useCallback(async () => {
    if (!groupId || !settings) {
      return;
    }
    try {
      setSaving(true);
      await updateGroupBanSettings(groupId, settings);
      setDirty(false);
      setToastMessage("Settings saved successfully \u2705");
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
        <Text weight="2">Loading rules...</Text>
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
              Content restriction rules
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
        <div className={styles.sections}>
          {groupedRules.map((category) => (
            <details key={category.id} className={styles.section} open>
              <summary className={styles.sectionSummary}>{category.title}</summary>
              <div className={styles.sectionContent}>
                {category.rules.map((rule) => {
                  const ruleSetting = settings.rules[rule.key];
                  return (
                    <Card key={rule.key} className={styles.card}>
                      <div className={styles.cardHeader}>
                        <div>
                          <Title level="3" className={styles.cardTitle}>
                            {rule.icon && <span className={styles.cardIcon}>{rule.icon}</span>}
                            {rule.title}
                          </Title>
                          <Text weight="2" className={styles.cardHint}>
                            {rule.description}
                          </Text>
                        </div>
                        <Switch
                          checked={ruleSetting.enabled}
                          onChange={(event) => updateRule(rule.key, { enabled: event.target.checked })}
                        />
                      </div>
                      {ruleSetting.enabled && (
                        <ScheduleSection
                          title="Execution window"
                          value={ruleSetting.schedule}
                          onModeChange={(mode) =>
                            updateRuleSchedule(rule.key, { ...ruleSetting.schedule, mode })
                          }
                          onStartChange={(value) =>
                            updateRuleSchedule(rule.key, { ...ruleSetting.schedule, start: value })
                          }
                          onEndChange={(value) =>
                            updateRuleSchedule(rule.key, { ...ruleSetting.schedule, end: value })
                          }
                        />
                      )}
                    </Card>
                  );
                })}
              </div>
            </details>
          ))}
        </div>

        <KeywordListCard
          title="Banned keywords"
          description="Messages containing any of these words are removed."
          value={settings.blacklist}
          onChange={(list) => updateKeywordList("blacklist", list)}
          onImport={() => handleImportList("blacklist")}
          onExport={() => handleExportList("blacklist")}
        />

        <KeywordListCard
          title="Required keywords"
          description="Messages must include at least one of these words."
          value={settings.whitelist}
          onChange={(list) => updateKeywordList("whitelist", list)}
          onImport={() => handleImportList("whitelist")}
          onExport={() => handleExportList("whitelist")}
        />
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
        activeKey="bans"
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







