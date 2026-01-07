import { useMemo, useState } from "react";
import { openLink, hapticFeedback } from '@telegram-apps/sdk-react';
import { Avatar, Button, Spinner, Text } from "@telegram-apps/telegram-ui";

import { useOwnerProfile } from "@/features/dashboard/useOwnerProfile.ts";
import { useUserProfile } from "@/features/profile/useUserProfile.ts";
import { completeChannelMission, spinDailyWheel } from "@/features/missions/api.ts";

import styles from "./ProfilePage.module.css";

/* --- Types & Constants --- */
type TabKey = "status" | "ops" | "armory";

type MissionIconKey = "check" | "stars" | "invite" | "trophy" | "brain" | "gift" | "link" | "groups" | "security";

type Mission = {
  id: string;
  title: string;
  description: string;
  xp: number;
  icon: MissionIconKey;
  verification?: { kind: "telegram-channel"; channelUsername: string };
  ctaLink?: string;
  ctaLabel?: string;
};

type Reward = {
  id: string;
  title: string;
  cost: number;
  description: string;
  isBadge?: boolean;
};

const DAILY_WHEEL_ID = "daily-wheel";
const FIREWALL_CHANNEL_URL = "https://t.me/firewall";
const FIREWALL_CHANNEL_USERNAME = "firewall";

const MISSIONS = {
  daily: [
    { id: DAILY_WHEEL_ID, title: "Daily Spin", description: "Spin the wheel for bonus XP.", xp: 20, icon: "trophy" },
  ],
  weekly: [
    { id: "upgrade-weekly", title: "Premium Upgrade", description: "Upgrade a group to Premium.", xp: 70, icon: "stars" },
    { id: "complete-daily-3", title: "3-Day Streak", description: "Maintain a strict 3-day ops streak.", xp: 70, icon: "check" },
  ],
  general: [
    {
      id: "join-channel",
      title: "Join HQ Channel",
      description: "Subscribe for critical intel.",
      xp: 30,
      icon: "link",
      ctaLink: FIREWALL_CHANNEL_URL,
      ctaLabel: "Open Comms",
      verification: { kind: "telegram-channel", channelUsername: FIREWALL_CHANNEL_USERNAME }
    },
  ]
} as const;

const REWARDS: Reward[] = [
  { id: "badge-rookie", title: "Rookie Badge", cost: 200, description: "Mark your debut.", isBadge: true },
  { id: "badge-elite", title: "Elite Badge", cost: 2000, description: "Flex elite status.", isBadge: true },
  { id: "reward-uptime-7", title: "7-Day Uptime", cost: 800, description: "Extend protection by a week." },
];

/* --- Helper Components --- */

function MissionIcon({ icon, completed }: { icon: MissionIconKey; completed: boolean }) {
  const map: Record<string, string> = {
    check: "✅", stars: "⭐", invite: "🤝", trophy: "🏆", brain: "🧠", gift: "🎁", link: "🔗", groups: "🛡️", security: "🔒"
  };
  return <span style={{ fontSize: '1.2rem', opacity: completed ? 0.5 : 1 }}>{map[icon] ?? "🔹"}</span>;
}

/* --- Main Page --- */

export function ProfilePage() {
  /* --- Hooks --- */
  const { displayName, username, avatarUrl: ownerAvatar } = useOwnerProfile();
  const { profile, missions: missionState, completions, loading, refresh, redeemReward } = useUserProfile();

  /* --- State --- */
  const [activeTab, setActiveTab] = useState<TabKey>("status");
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null); // ID of item being processed

  /* --- Computed --- */
  const xp = profile?.totalXp ?? 0;
  const level = profile?.level ?? 1;
  const nextLevelXp = profile?.nextLevelXp ?? (level * 1000); // Fallback
  const progress = Math.min(1, Math.max(0, (xp - (profile?.previousLevelXp ?? 0)) / ((nextLevelXp - (profile?.previousLevelXp ?? 0)) || 1)));

  const streak = profile?.streak ?? 0;

  // Referral Logic
  const referralLink = useMemo(() => {
    const userId = profile?.id ?? "";
    return `https://t.me/Firewallmainbot?start=ref_${userId}`;
  }, [profile?.id]);

  const copyReferral = async () => {
    try {
      hapticFeedback.impactOccurred('light');
      await navigator.clipboard.writeText(referralLink);
      setSnackbar("Referral link copied to clipboard.");
    } catch {
      setSnackbar("Failed to copy link.");
    }
  };

  /* --- Handlers --- */
  const handleCompleteMission = async (mission: Mission, _category: string) => {
    hapticFeedback.impactOccurred('light');
    if (processing) return;
    setProcessing(mission.id);

    try {
      if (mission.id === DAILY_WHEEL_ID) {
        const result = await spinDailyWheel();
        setSnackbar(`Spin result: +${result.rewardXp} XP!`);
        await refresh();
      } else if (mission.verification?.kind === "telegram-channel") {
        const res = await completeChannelMission(mission.verification.channelUsername);
        if (res.ok) {
          setSnackbar(`Mission Verified: +${mission.xp} XP`);
          await refresh();
        } else {
          setSnackbar("Verification failed. Join the channel first.");
        }
      } else {
        setSnackbar("This mission tracks automatically.");
      }
    } catch (e) {
      console.error(e);
      setSnackbar("Operation failed.");
    } finally {
      setProcessing(null);
    }
  };

  const handleRedeem = async (reward: Reward) => {
    hapticFeedback.impactOccurred('light');
    if (xp < reward.cost) {
      setSnackbar("Insufficient XP.");
      return;
    }
    setProcessing(reward.id);
    try {
      await redeemReward(reward.id, reward.cost);
      setSnackbar(`Acquired: ${reward.title}`);
      await refresh();
    } catch (e) {
      setSnackbar("Transaction failed.");
    } finally {
      setProcessing(null);
    }
  };

  /* --- Renderers --- */

  const renderHero = () => (
    <section className={styles.hero}>
      <div className={styles.heroHeader}>
        <div className={styles.heroProfile}>
          <Avatar size={48} src={profile?.avatarUrl ?? ownerAvatar} acronym="OP" />
          <div className={styles.heroMeta}>
            <span className={styles.heroLabel}>COMMAND DECK</span>
            <h1 className={styles.heroTitle}>{profile?.displayName ?? displayName}</h1>
            <span className={styles.heroSubtitle}>Class: Sentinel • {username ? `@${username}` : "No Callsign"}</span>
          </div>
        </div>
      </div>

      <div className={styles.heroStats}>
        <div className={styles.levelRow}>
          <span>LEVEL {level}</span>
          <span>{xp.toLocaleString('en-US')} XP</span>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressValue} style={{ width: `${progress * 100}%` }} />
        </div>
        <div className={styles.levelMeta}>
          <span className={styles.levelProgress}>Next Rank: {nextLevelXp.toLocaleString('en-US')} XP</span>
          <div className={styles.chipRow}>
            <span className={styles.chip}>🔥 {streak} Day Streak</span>
          </div>
        </div>
      </div>
    </section>
  );

  const renderTabs = () => (
    <nav className={styles.tabs}>
      <button className={`${styles.tabButton} ${activeTab === 'status' ? styles.tabButtonActive : ''}`} onClick={() => { hapticFeedback.impactOccurred('light'); setActiveTab('status'); }}>
        📊 STATUS
      </button>
      <button className={`${styles.tabButton} ${activeTab === 'ops' ? styles.tabButtonActive : ''}`} onClick={() => { hapticFeedback.impactOccurred('light'); setActiveTab('ops'); }}>
        ⚔️ OPS
      </button>
      <button className={`${styles.tabButton} ${activeTab === 'armory' ? styles.tabButtonActive : ''}`} onClick={() => { hapticFeedback.impactOccurred('light'); setActiveTab('armory'); }}>
        🛒 ARMORY
      </button>
    </nav>
  );

  const renderStatus = () => (
    <div className={styles.tabContent}>
      <h3 className={styles.sectionTitle}>PERFORMANCE PULSE</h3>
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Global Rank</span>
          <span className={styles.statValue}>#{profile?.globalRank ?? "---"}</span>
          <span className={styles.statHint}>Top 5%</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Missions Cleared</span>
          <span className={styles.statValue}>{profile?.missionsCleared ?? 0}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Uptime Score</span>
          <span className={styles.statValue}>{profile?.uptimeScore ?? 100}%</span>
          <span className={styles.statHint}>Stable</span>
        </div>
      </div>

      <h3 className={styles.sectionTitle} style={{ marginTop: 24 }}>LATEST INTEL</h3>
      <div className={styles.activityList}>
        {completions.slice(0, 5).map((log) => (
          <div key={log.completedAt} className={styles.activityItem}>
            <span className={styles.activityTime}>{new Date(log.completedAt).toLocaleDateString()}</span>
            <span className={styles.activityText}>Completed operation: {log.missionId} (+{log.xpEarned} XP)</span>
          </div>
        ))}
        {completions.length === 0 && <span style={{ color: '#666', fontStyle: 'italic' }}>No recent activity logged.</span>}
      </div>
    </div>
  );

  const renderOps = () => {
    // Combine local definitions with backend state (simplified for demo)
    const allMissions: any[] = [
      ...MISSIONS.daily.map(m => ({ ...m, category: 'daily' })),
      ...MISSIONS.weekly.map(m => ({ ...m, category: 'weekly' })),
      ...MISSIONS.general.map(m => ({ ...m, category: 'general' })),
    ];

    return (
      <div className={styles.missionList}>
        {allMissions.map(mission => {
          const isCompleted = (missionState?.[mission.category as keyof typeof missionState] ?? []).includes(mission.id);
          const isProcessing = processing === mission.id;

          return (
            <div key={mission.id} className={`${styles.missionCard} ${isCompleted ? styles.missionCardCompleted : ''}`}>
              <div className={styles.missionHeader}>
                <div className={styles.missionIcon}><MissionIcon icon={mission.icon} completed={isCompleted} /></div>
                <div className={styles.missionContent}>
                  <span className={styles.missionTitle}>{mission.title}</span>
                  <span className={styles.missionDesc}>{mission.description}</span>
                  <div className={styles.missionMeta}>
                    <span className={styles.xpBadge}>+{mission.xp} XP</span>
                    {isCompleted && <span style={{ color: 'var(--status-safe)', fontSize: '0.8rem', fontWeight: 700 }}>COMPLETED</span>}
                  </div>
                </div>
              </div>
              {!isCompleted && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  {mission.ctaLink && (
                    <Button size="s" mode="plain" onClick={() => openLink(mission.ctaLink!)}>
                      {mission.ctaLabel ?? "Execute"}
                    </Button>
                  )}
                  <Button
                    size="s"
                    mode="filled"
                    loading={isProcessing}
                    disabled={isProcessing}
                    onClick={() => handleCompleteMission(mission, mission.category)}
                  >
                    {mission.verification ? "Verify" : mission.id === DAILY_WHEEL_ID ? "Spin" : "Track"}
                  </Button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  const renderArmory = () => (
    <div>
      <div className={styles.referralCard}>
        <h3 style={{ color: '#fff', margin: 0 }}>INVITE NEW OPERATIVES</h3>
        <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.9rem' }}>Earn 100 XP for every activated recruit.</p>
        <div className={styles.referralCode}>
          {referralLink}
          <button className={styles.copyBtn} onClick={copyReferral}>📋</button>
        </div>
      </div>

      <h3 className={styles.sectionTitle} style={{ marginTop: 24 }}>SUPPLY DROP</h3>
      <div className={styles.marketGrid}>
        {REWARDS.map(reward => {
          const affordable = xp >= reward.cost;
          return (
            <div key={reward.id} className={styles.itemCard}>
              <div className={styles.itemIcon}>{reward.isBadge ? "🎖️" : "📦"}</div>
              <span className={styles.itemName}>{reward.title}</span>
              <span className={styles.itemCost}>{reward.cost} XP</span>
              <Button
                size="s"
                mode={affordable ? "filled" : "gray"}
                disabled={!affordable || processing === reward.id}
                loading={processing === reward.id}
                onClick={() => handleRedeem(reward)}
              >
                ACQUIRE
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );

  if (loading && !profile) {
    return (
      <div className={styles.page} style={{ justifyContent: 'center', alignItems: 'center' }}>
        <Spinner size="l" />
        <Text style={{ marginTop: 16 }}>Establishing Uplink...</Text>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {renderHero()}
      {renderTabs()}

      <main style={{ flex: 1 }}>
        {activeTab === 'status' && renderStatus()}
        {activeTab === 'ops' && renderOps()}
        {activeTab === 'armory' && renderArmory()}
      </main>

      {snackbar && (
        <div style={{
          position: 'fixed', bottom: 100, left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(0,0,0,0.8)', color: '#fff', padding: '12px 24px', borderRadius: 24,
          backdropFilter: 'blur(10px)', border: '1px solid rgba(255,255,255,0.1)', zIndex: 100
        }}>
          {snackbar}
          <button onClick={() => setSnackbar(null)} style={{ marginLeft: 12, background: 'none', border: 'none', color: '#fff' }}>✕</button>
        </div>
      )}
    </div>
  );
}
