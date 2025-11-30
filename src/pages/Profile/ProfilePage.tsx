import { useMemo, useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Button, Switch, Text } from "@telegram-apps/telegram-ui";

import { useOwnerProfile } from "@/features/dashboard/useOwnerProfile.ts";
import { useUserProfile } from "@/features/profile/useUserProfile.ts";
import type { ProfileBootstrap, UserProfileSummary } from "@/features/profile/api.ts";
import { fetchUserPreferences, updateUserPreferences, type UserPreferences } from "@/features/profile/api.ts";

import styles from "./ProfilePage.module.css";

const TEXT = {
  tagline: "Show your power",
  statsTitle: "Performance pulse",
  progressTitle: "Mission cadence",
  actionsTitle: "Command shortcuts",
  alertsTitle: "Signal alerts",
  automationTitle: "Automation",
  securityTitle: "Security posture",
  activityTitle: "Latest activity",
  supportTitle: "Support & resources",
};

const BADGE_LABELS: Record<string, string> = {
  rookie: "Rookie",
  active: "Active",
  master: "Master",
  elite: "Elite",
  legend: "Legend",
};

function buildPerformance(xp: number, profile: UserProfileSummary | null) {
  const uptimeScore = profile?.uptimeScore ?? 0;
  const missionsCleared = profile?.missionsCleared ?? 0;
  const globalRank = profile?.globalRank ?? null;

  return [
    {
      label: "Season XP",
      value: xp,
      formatted: xp.toLocaleString("en-US"),
      delta: xp > 0 ? "+12% vs last season" : "Start your journey",
    },
    {
      label: "Uptime score",
      value: uptimeScore,
      formatted: uptimeScore > 0 ? `${uptimeScore.toFixed(1)}%` : "0%",
      delta: uptimeScore > 95 ? "All networks stable" : "No data yet",
    },
    {
      label: "Missions cleared",
      value: missionsCleared,
      formatted: `${missionsCleared}`,
      delta: missionsCleared > 0 ? "3 remaining this week" : "No missions completed",
    },
    {
      label: "Global rank",
      value: globalRank ?? 0,
      formatted: globalRank ? `#${globalRank}` : "Unranked",
      delta: globalRank && globalRank <= 100 ? "Top 3% of commanders" : "Complete missions to rank",
    },
  ];
}

function clampProgress(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function buildProgressTracks(profile: UserProfileSummary | null, missions: ProfileBootstrap["missions"]) {
  const streak = profile?.streak ?? 0;
  const dailyCaption = streak > 0 ? `${streak} day${streak === 1 ? "" : "s"} active` : "No activity recorded yet";
  const dailyValue = Math.min(1, Math.max(0, streak / 7));

  const weeklyCompleted = profile?.weeklyObjectivesCompleted ?? missions.weekly?.length ?? 0;
  const weeklyTotal = profile?.weeklyObjectivesTotal ?? 0;
  const weeklyValue = weeklyTotal > 0 ? clampProgress(weeklyCompleted / weeklyTotal) : 0;
  const weeklyCaption =
    weeklyTotal > 0
      ? `${weeklyCompleted} of ${weeklyTotal} completed`
      : weeklyCompleted > 0
        ? `${weeklyCompleted} completed this week`
        : "No weekly objectives completed yet";

  const seasonProgress = clampProgress(profile?.seasonAmbitionProgress ?? 0);
  const seasonGoal = profile?.seasonAmbitionGoal ?? null;
  const seasonCaption =
    seasonGoal && seasonGoal.trim().length > 0
      ? `Goal: ${seasonGoal}`
      : seasonProgress > 0
        ? `${Math.round(seasonProgress * 100)}% of season target`
        : "Season ambition not set";

  return [
    { key: "daily", label: "Daily streak", value: dailyValue, caption: dailyCaption },
    { key: "weekly", label: "Weekly objectives", value: weeklyValue, caption: weeklyCaption },
    { key: "monthly", label: "Season ambitions", value: seasonProgress, caption: seasonCaption },
  ];
}

export function ProfilePage() {
  const navigate = useNavigate();
  const owner = useOwnerProfile();
  const { profile, missions, achievements, completions, loading, checkIn } = useUserProfile();

  const displayName = profile?.displayName ?? owner.displayName ?? "Firewall Commander";
  const username = profile?.username ?? owner.username ?? null;
  const avatarUrl = profile?.avatarUrl ?? owner.avatarUrl ?? null;
  const badges = profile?.badges ?? [];
  const latestBadgeId = badges[badges.length - 1] ?? null;
  const latestBadgeLabel = latestBadgeId ? BADGE_LABELS[latestBadgeId] ?? latestBadgeId : "No badge yet";

  const initials = useMemo(() => {
    const source = displayName || username || "User";
    const parts = source.trim().split(/\s+/).filter(Boolean);
    const letters = parts.slice(0, 2).map((word) => word.charAt(0).toUpperCase());
    return letters.join("") || "U";
  }, [displayName, username]);

  const xp = profile?.totalXp ?? 0;
  const performance = useMemo(() => buildPerformance(xp, profile), [xp, profile]);
  const progressTracks = useMemo(() => buildProgressTracks(profile, missions), [profile, missions]);
  const level = profile?.level ?? 1;
  const progressToNext = clampProgress(profile?.progressToNext ?? 0);
  const hasNextLevel = typeof profile?.nextLevelXp === "number" && profile.nextLevelXp !== null;
  const remainingToNext =
    hasNextLevel && typeof profile?.nextLevelXp === "number"
      ? Math.max(0, profile.nextLevelXp - xp)
      : 0;

  const activityItems = useMemo(
    () => {
      const items: { key: string; title: string; time: string; timestamp: number }[] = [];

      completions.forEach((completion) => {
        const date = new Date(completion.completedAt);
        const timestamp = date.getTime();
        items.push({
          key: `completion-${completion.missionId}-${completion.cycleKey}-${completion.completedAt}`,
          title: `Completed ${completion.category} mission (+${completion.xpEarned.toLocaleString("en-US")} XP)`,
          time: date.toLocaleString("en-US"),
          timestamp,
        });
      });

      achievements.forEach((achievement) => {
        const date = new Date(achievement.unlockedAt);
        const timestamp = date.getTime();
        items.push({
          key: `achievement-${achievement.achievementId}-${achievement.unlockedAt}`,
          title: `Unlocked achievement ${achievement.achievementId}`,
          time: date.toLocaleString("en-US"),
          timestamp,
        });
      });

      items.sort((a, b) => b.timestamp - a.timestamp);

      return items.slice(0, 10);
    },
    [completions, achievements],
  );

  const [preferences, setPreferences] = useState<UserPreferences>({
    pushEnabled: true,
    digestEnabled: true,
    autoEscalate: false,
    silentFailures: true,
  });

  const [checkInLoading, setCheckInLoading] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    const loadPreferences = async () => {
      try {
        const userPrefs = await fetchUserPreferences();
        setPreferences(userPrefs);
      } catch (error) {
        console.warn("Failed to load preferences:", error);
      }
    };
    void loadPreferences();
  }, []);

  // Handle preference updates
  const handlePreferenceChange = useCallback(async (key: keyof UserPreferences, value: boolean) => {
    const newPreferences = { ...preferences, [key]: value };
    setPreferences(newPreferences);

    try {
      await updateUserPreferences(newPreferences);
    } catch (error) {
      // Revert on error
      setPreferences(preferences);
      console.error("Failed to update preferences:", error);
    } finally {
      // Loading state removed
    }
  }, [preferences]);

  const handleDailyCheckIn = useCallback(async () => {
    if (!checkIn || !profile) {
      return;
    }
    try {
      setCheckInLoading(true);
      await checkIn();
    } catch (error) {
      console.error("Failed to record daily check-in:", error);
    } finally {
      setCheckInLoading(false);
    }
  }, [checkIn, profile]);

  const automationOptions = [
    {
      key: "push-alerts",
      label: "Push alerts",
      description: "Send instant notifications for high-priority incidents.",
      value: preferences.pushEnabled,
      onToggle: (value: boolean) => handlePreferenceChange('pushEnabled', value),
    },
    {
      key: "weekly-digest",
      label: "Weekly digest",
      description: "Receive a summary of group performance every Monday.",
      value: preferences.digestEnabled,
      onToggle: (value: boolean) => handlePreferenceChange('digestEnabled', value),
    },
    {
      key: "silence-failures",
      label: "Silence failed rules",
      description: "Automatically mute users when automated rules cannot apply.",
      value: preferences.silentFailures,
      onToggle: (value: boolean) => handlePreferenceChange('silentFailures', value),
    },
    {
      key: "auto-escalate",
      label: "Auto-escalate",
      description: "Escalate unresolved incidents to managers for follow-up.",
      value: preferences.autoEscalate,
      onToggle: (value: boolean) => handlePreferenceChange('autoEscalate', value),
    },
  ];

  if (loading && !profile) {
    return (
      <div className={styles.page} dir="ltr">
        <section className={styles.heroCard}>
          <Text>Loading profile…</Text>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.page} dir="ltr">
      <section className={styles.heroCard}>
        <div className={styles.heroProfile}>
          <Avatar
            size={96}
            src={avatarUrl ?? undefined}
            acronym={avatarUrl ? undefined : (initials ?? undefined)}
            alt={displayName}
          />
          <div className={styles.heroMeta}>
            <span className={styles.heroLabel}>{TEXT.tagline}</span>
            <h1 className={styles.heroName}>{displayName}</h1>
            <span className={styles.heroUsername}>{username ? `@${username}` : "No username"}</span>
          </div>
        </div>
        <div className={styles.heroProgress}>
          <div className={styles.heroBadge}>
            <span className={styles.heroBadgeLabel}>Current badge</span>
            <span className={styles.heroBadgeValue}>{latestBadgeLabel}</span>
          </div>
          <div className={styles.progressTrack}>
            <div className={styles.progressValue} style={{ width: `${progressToNext * 100}%` }} />
          </div>
          <span className={styles.progressCaption}>
            {hasNextLevel
              ? `${remainingToNext.toLocaleString("en-US")} XP until level ${level + 1}`
              : "Season level cap reached"}
          </span>
          <span className={styles.heroSubtitle}>
            Level {level.toString().padStart(2, "0")}
          </span>
        </div>
      </section>

      <div className={styles.layout}>
        <div className={styles.columnPrimary}>
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{TEXT.statsTitle}</h2>
              <Text className={styles.sectionHint}>Pulse metrics that define your rank each season.</Text>
              <Button
                size="s"
                mode="filled"
                disabled={checkInLoading || !profile}
                onClick={() => {
                  void handleDailyCheckIn();
                }}
              >
                {checkInLoading ? "Checking in..." : "Daily check-in"}
              </Button>
            </header>
            <div className={styles.statsGrid}>
              {performance.map((item) => (
                <div key={item.label} className={styles.statCard}>
                  <span className={styles.statLabel}>{item.label}</span>
                  <span className={styles.statValue}>{item.formatted}</span>
                  <span className={styles.statHint}>{item.delta}</span>
                </div>
              ))}
            </div>
          </section>

          {achievements.length > 0 && (
            <section className={styles.section}>
              <header className={styles.sectionHeader}>
                <h2 className={styles.sectionTitle}>Achievements</h2>
                <Text className={styles.sectionHint}>Recently unlocked milestones.</Text>
              </header>
              <div className={styles.activityList}>
                {achievements.slice(0, 8).map((achievement) => {
                  const label = BADGE_LABELS[achievement.achievementId] ?? achievement.achievementId;
                  const unlockedAt = new Date(achievement.unlockedAt).toLocaleString("en-US");
                  return (
                    <article
                      key={`${achievement.achievementId}-${achievement.unlockedAt}`}
                      className={styles.activityCard}
                    >
                      <span className={styles.activityTitle}>{label}</span>
                      <span className={styles.activityTime}>{unlockedAt}</span>
                    </article>
                  );
                })}
              </div>
            </section>
          )}

          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{TEXT.progressTitle}</h2>
              <Text className={styles.sectionHint}>Track how consistently you are hitting mission rhythm.</Text>
            </header>
            <div className={styles.progressGrid}>
              {progressTracks.map((item) => (
                <div key={item.key} className={styles.progressCard}>
                  <div className={styles.progressHeader}>
                    <Text weight="2">{item.label}</Text>
                    <Text className={styles.progressPercent}>{Math.round(item.value * 100)}%</Text>
                  </div>
                  <div className={styles.progressTrack}>
                    <div className={styles.progressValue} style={{ width: `${Math.min(1, item.value) * 100}%` }} />
                  </div>
                  <span className={styles.progressCaption}>{item.caption}</span>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{TEXT.actionsTitle}</h2>
              <Text className={styles.sectionHint}>Jump straight to the commands you use the most.</Text>
            </header>
            <div className={styles.actionsGrid}>
              {[
                { key: "missions", label: "Open missions", hint: "Prioritize next objectives", to: "/missions" },
                { key: "rewards", label: "XP Store", hint: "Get Premium upgrades & badges", to: "/missions" },
                { key: "activity", label: "Activity log", hint: "Premium purchases & actions", to: "/stars" },
                { key: "groups", label: "Manage groups", hint: "Jump to dashboard", to: "/groups" },
                { key: "analytics", label: "Review analytics", hint: "Week-over-week trends", to: "/groups" },
                { key: "giveaway", label: "Launch giveaway", hint: "Boost community energy", to: "/giveaway/create" },
              ].map((action) => (
                <button
                  key={action.key}
                  type="button"
                  className={styles.actionCard}
                  onClick={() => navigate(action.to)}
                >
                  <span className={styles.actionLabel}>{action.label}</span>
                  <span className={styles.actionHint}>{action.hint}</span>
                </button>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{TEXT.automationTitle}</h2>
              <Text className={styles.sectionHint}>Keep the bot two steps ahead of trouble.</Text>
            </header>
            <div className={styles.statusList}>
              {automationOptions.map((option) => (
                <div key={option.key} className={styles.toggleRow}>
                  <div className={styles.toggleText}>
                    <Text weight="2">{option.label}</Text>
                    <Text className={styles.linkHint}>{option.description}</Text>
                  </div>
                  <Switch checked={option.value} onChange={(event) => option.onToggle(event.target.checked)} />
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{TEXT.activityTitle}</h2>
              <Text className={styles.sectionHint}>Signals from your latest missions, Premium purchases, and bot actions.</Text>
            </header>
            <div className={styles.activityList}>
              {activityItems.length > 0 ? (
                activityItems.map((item) => (
                  <article key={item.key} className={styles.activityCard}>
                    <span className={styles.activityTitle}>{item.title}</span>
                    <span className={styles.activityTime}>{item.time}</span>
                  </article>
                ))
              ) : (
                <div className={styles.emptyActivity}>
                  <Text>No activity yet. Complete your first mission!</Text>
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className={styles.columnSecondary}>
          <section className={styles.section}>
            <header className={styles.sectionHeader}>
              <h2 className={styles.sectionTitle}>{TEXT.supportTitle}</h2>
              <Text className={styles.sectionHint}>Need backup? Reach out to the Firewall crew.</Text>
            </header>
            <div className={styles.supportCard}>
              <Text weight="2">Support channel</Text>
              <Text className={styles.supportHint}>Firewall HQ provides 24/7 coverage.</Text>
              <Button size="s" mode="filled" onClick={() => navigate("/support")}>
                Contact support
              </Button>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
