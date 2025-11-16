import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
  fetchGroupCustomTextSettings,
  fetchGroupDetails,
  updateGroupCustomTextSettings,
} from "@/features/dashboard/api.ts";
import type { CustomTextSettings, ManagedGroup } from "@/features/dashboard/types.ts";

import styles from "./GroupCustomTextsPage.module.css";

type LocationState = {
  group?: ManagedGroup;
};

type TemplateKey = keyof Pick<
  CustomTextSettings,
  | "welcomeMessage"
  | "rulesMessage"
  | "silenceStartMessage"
  | "silenceEndMessage"
  | "warningMessage"
  | "forcedInviteMessage"
  | "mandatoryChannelMessage"
>;

type TemplateDefinition = {
  key: TemplateKey;
  title: string;
  description: string;
  placeholders: string[];
  requiredAll?: string[];
  requiredAny?: string[][];
  example?: string;
};



const DEFAULT_TEXTS: CustomTextSettings = {
  welcomeMessage: "Hello {user}!\nWelcome to {group}.\nPlease read the next message to learn the rules.",
  rulesMessage: "{user}, these guidelines keep {group} safe. Read them carefully before you start chatting.",
  silenceStartMessage: "Quiet hours are now active.\nMessages are paused from {starttime} until {endtime}.\nThanks for keeping the chat tidy.",
  silenceEndMessage: "Quiet hours have finished.\nThe next quiet period starts at {starttime}.",
  warningMessage: "Reason: {reason}\nPenalty: {penalty}\n\nWarning {user_warnings} of {warnings_count}\nEach warning expires after {warningstime} days.",
  forcedInviteMessage: "{user}\nYou need to invite {number} new member(s) before you can send messages.\nYou have invited {added} so far.",
  mandatoryChannelMessage: "Please join the required channel(s) below before sending messages:\n{channel_names}",
  promoButtonEnabled: false,
  promoButtonText: "Read more",
  promoButtonUrl: "https://t.me/tgfirewall",
};



const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: "welcomeMessage",
    title: "Welcome message",
    description: "Sent automatically to new members. Use {user} and {group} placeholders.",
    placeholders: ["{user}", "{group}"],
    requiredAny: [["{user}", "{group}"]],
  },
  {
    key: "rulesMessage",
    title: "Rules reminder",
    description: "Shown after the welcome message. Reference {user} or {group} as needed.",
    placeholders: ["{user}", "{group}"],
    requiredAny: [["{group}"]],
  },
  {
    key: "silenceStartMessage",
    title: "Quiet hours started",
    description: "Explain when messaging is disabled. Include {starttime} and {endtime}.",
    placeholders: ["{starttime}", "{endtime}"],
    requiredAll: ["{starttime}", "{endtime}"],
  },
  {
    key: "silenceEndMessage",
    title: "Quiet hours ended",
    description: "Let members know when quiet hours finish. Mention {starttime} for the next cycle.",
    placeholders: ["{starttime}", "{endtime}"],
    requiredAll: ["{starttime}", "{endtime}"],
  },
  {
    key: "warningMessage",
    title: "Warning notification",
    description:
      "Sent when a member breaks the rules. Include {reason}, {penalty}, {user_warnings}, {warnings_count}, {warningstime}.",
    placeholders: ["{reason}", "{penalty}", "{user_warnings}", "{warnings_count}", "{warningstime}"],
    requiredAll: ["{reason}", "{penalty}", "{user_warnings}", "{warnings_count}", "{warningstime}"],
  },
  {
    key: "forcedInviteMessage",
    title: "Invite requirement",
    description: "Used when members must invite others. Use {user}, {number}, and {added}.",
    placeholders: ["{user}", "{number}", "{added}"],
    requiredAll: ["{number}", "{added}"],
  },
  {
    key: "mandatoryChannelMessage",
    title: "Channels to join",
    description: "List the channels members must join. Include {channel_names}.",
    placeholders: ["{channel_names}"],
    requiredAll: ["{channel_names}"],
  },
];



const PREVIEW_DATA: Record<string, string> = {
  user: "Alex",
  group: "Developers Hub",
  starttime: "22:00",
  endtime: "07:00",
  reason: "Spamming links",
  penalty: "Muted for 24 hours",
  user_warnings: "2",
  warnings_count: "3",
  warningstime: "7",
  number: "2",
  added: "1",
  channel_names: "@devhub @newsroom",
};

const VALID_BUTTON_PROTOCOLS = ["https://", "tg://"] as const;

export function GroupCustomTextsPage() {
  const navigate = useNavigate();
  const { groupId } = useParams<{ groupId: string }>();
  const location = useLocation();
  const state = (location.state ?? {}) as LocationState;

  const [group, setGroup] = useState<ManagedGroup | null>(state.group ?? null);
  const [settings, setSettings] = useState<CustomTextSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);

  const defaultsRef = useRef<CustomTextSettings>(DEFAULT_TEXTS);

  useEffect(() => {
    if (!groupId) {
      return;
    }
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [texts, detail] = await Promise.all([
          fetchGroupCustomTextSettings(groupId),
          fetchGroupDetails(groupId),
        ]);
        if (cancelled) {
          return;
        }
        setSettings(texts);
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

  const updateSettings = useCallback((patch: Partial<CustomTextSettings>) => {
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      setDirty(true);
      return { ...prev, ...patch };
    });
  }, []);

  const handleTextChange = useCallback(
    (key: TemplateKey) => (event: ChangeEvent<HTMLTextAreaElement>) => {
      updateSettings({ [key]: event.target.value } as Partial<CustomTextSettings>);
    },
    [updateSettings],
  );

  const handlePromoToggle = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateSettings({ promoButtonEnabled: event.target.checked });
    },
    [updateSettings],
  );

  const handlePromoTextChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateSettings({ promoButtonText: event.target.value });
    },
    [updateSettings],
  );

  const handlePromoUrlChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      updateSettings({ promoButtonUrl: event.target.value });
    },
    [updateSettings],
  );

  const handleResetTemplate = useCallback(
    (key: TemplateKey) => {
      const defaults = defaultsRef.current;
      updateSettings({ [key]: defaults[key] } as Partial<CustomTextSettings>);
    },
    [updateSettings],
  );

  const handleResetButton = useCallback(() => {
    const defaults = defaultsRef.current;
    updateSettings({
      promoButtonEnabled: defaults.promoButtonEnabled,
      promoButtonText: defaults.promoButtonText,
      promoButtonUrl: defaults.promoButtonUrl,
    });
  }, [updateSettings]);

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
        default:
          console.info(`[custom-texts] menu item '${key}' tapped`);
      }
    },
    [groupId, group, navigate],
  );

  const handleToastClose = useCallback(() => {
    setToastMessage("");
  }, []);

  
const validationErrors = useMemo(() => {
  if (!settings) {
    return {} as Record<TemplateKey, string>;
  }
  const errors: Partial<Record<TemplateKey, string>> = {};
  TEMPLATE_DEFINITIONS.forEach((template) => {
    const value = settings[template.key].trim();
    if (!value) {
      return;
    }
    if (template.requiredAll) {
      const missing = template.requiredAll.filter((token) => !value.includes(token));
      if (missing.length > 0) {
        errors[template.key] = `Missing required placeholders: ${missing.join(", ")}.`;
        return;
      }
    }
    if (template.requiredAny) {
      const satisfiesAny = template.requiredAny.some((groupTokens) =>
        groupTokens.some((token) => value.includes(token)),
      );
      if (!satisfiesAny) {
        const options = template.requiredAny
          .map((groupTokens) => groupTokens.join(" or "))
          .join(", ");
        errors[template.key] = `Include at least one of: ${options}.`;
      }
    }
  });
  return errors as Record<TemplateKey, string>;
}, [settings]);


  
const promoButtonError = useMemo(() => {
  if (!settings) {
    return "";
  }
  if (settings.promoButtonEnabled && settings.promoButtonText.trim().length === 0) {
    return "Button text is required when the promo button is enabled.";
  }
  const url = settings.promoButtonUrl.trim();
  if (url.length > 0 && !VALID_BUTTON_PROTOCOLS.some((protocol) => url.startsWith(protocol))) {
    return "Only https:// or tg:// links are allowed.";
  }
  return "";
}, [settings]);


  const hasErrors = useMemo(() => {
    if (!settings) {
      return true;
    }
    return Object.values(validationErrors).some(Boolean) || Boolean(promoButtonError);
  }, [settings, validationErrors, promoButtonError]);

  const applyPreview = useCallback((template: string) => {
    return template.replace(/\{([a-z_]+)\}/gi, (match, key) => {
      const normalized = key.toLowerCase();
      return PREVIEW_DATA[normalized] ?? match;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!groupId || !settings || hasErrors) {
      return;
    }
    try {
      setSaving(true);
      const next = await updateGroupCustomTextSettings(groupId, settings);
      setSettings(next);
      setDirty(false);
      setToastMessage("Custom texts saved successfully.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setToastMessage(`Failed to save custom texts: ${message}`);
    } finally {
      setSaving(false);
    }
  }, [groupId, settings, hasErrors]);

  if (loading && !settings) {
    return (
      <div className={styles.loadingState} dir="ltr">
        <Text weight="2">Loading custom texts...</Text>
      </div>
    );
  }

  if (error) {
    return (
      <Placeholder header="Unable to load custom texts" description={error.message}>
        <Button mode="filled" onClick={() => navigate(-1)}>
          Back
        </Button>
      </Placeholder>
    );
  }

  if (!settings) {
    return (
      <Placeholder header="No custom texts available">
        <Button mode="filled" onClick={() => navigate(-1)}>
          Back
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
              {group ? group.title : "Loading..."}
            </Title>
            <Text weight="2" className={styles.groupSubtitle}>Custom text templates</Text>
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
        <Text weight="2" className={styles.notice}>Adjust the automated messages that the bot sends. Use the previews to verify placeholders.</Text>

        <div className={styles.cards}>
          {TEMPLATE_DEFINITIONS.map((template) => {
            const value = settings[template.key];
            const errorMessage = validationErrors[template.key];
            return (
              <Card key={template.key} className={styles.card}>
                <div className={styles.cardHeader}>
                  <div className={styles.headerMain}>
                    <Title level="3" className={styles.cardTitle}>
                      {template.title}
                    </Title>
                    <Text weight="2" className={styles.cardHint}>
                      {template.description}
                    </Text>
                  </div>
                  <div className={styles.buttonRow}>
                    <Button mode="outline" size="s" onClick={() => handleResetTemplate(template.key)}>Restore default</Button>
                  </div>
                </div>
                <Textarea
                  className={styles.textarea}
                  value={value}
                  onChange={handleTextChange(template.key)}
                />
                <div className={styles.textareaFooter}>
                  <Text weight="2" className={styles.charCounter}>
                    {value.length} characters
                  </Text>
                </div>
                {errorMessage && (
                  <Text weight="2" className={styles.errorText}>
                    {errorMessage}
                  </Text>
                )}
                <div className={styles.previewBox}>{applyPreview(value)}</div>
              </Card>
            );
          })}

          <Card className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.headerMain}>
                <Title level="3" className={styles.cardTitle}>Promo button</Title>
                <Text weight="2" className={styles.cardHint}>Use the promo button to highlight an external link in automated messages. Provide a short label and a valid URL.</Text>
              </div>
              <Switch checked={settings.promoButtonEnabled} onChange={handlePromoToggle} />
            </div>
            <div className={styles.field}>
              <div className={styles.fieldRow}>
                <Text weight="2" className={styles.cardHint}>Button text</Text>
                <Input
                  value={settings.promoButtonText}
                  maxLength={30}
                  onChange={handlePromoTextChange}
                  placeholder="Enter button text"
                />
              </div>
              <div className={styles.fieldRow}>
                <Text weight="2" className={styles.cardHint}>Button link</Text>
                <Input
                  value={settings.promoButtonUrl}
                  onChange={handlePromoUrlChange}
                  placeholder="https://t.me/YourChannel"
                />
              </div>
              <div className={styles.textareaFooter}>
                <Text weight="2" className={styles.charCounter}>
                  {settings.promoButtonText.length} / 30
                </Text>
                <Button mode="outline" size="s" onClick={handleResetButton}>Reset button</Button>
              </div>
              {promoButtonError && (
                <Text weight="2" className={styles.errorText}>
                  {promoButtonError}
                </Text>
              )}
              <div className={styles.previewBox}>
                {settings.promoButtonEnabled && settings.promoButtonText.trim()
                  ? `Text: ${settings.promoButtonText}
Link: ${settings.promoButtonUrl || "(not set)"}`
                  : "Promo button disabled."}
              </div>
            </div>
          </Card>
        </div>
      </main>

      <footer className={styles.saveBar}>
        <Button mode="filled" size="l" stretched disabled={!canSave} onClick={handleSave}>
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </footer>

      <GroupMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        activeKey="texts"
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


