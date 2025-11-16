import type { MissionCategory } from "./missionTypes.js";

export type MissionVerificationDefinition =
  | {
      kind: "daily-spin";
      minXp: number;
      maxXp: number;
    }
  | {
      kind: "channel-membership";
      channelUsername: string;
      xp: number;
    }
  | {
      kind: "backend-event";
      event: string;
      xp: number;
    };

export type MissionDefinition = {
  id: string;
  category: MissionCategory;
  title: string;
  verification: MissionVerificationDefinition;
};

const DEFAULT_CHANNEL_USERNAME = (process.env.MISSIONS_CHANNEL_USERNAME ?? "firewall")
  .replace(/^@+/u, "")
  .trim()
  .toLowerCase();

const MISSION_DEFINITIONS: MissionDefinition[] = [
  {
    id: "daily-wheel",
    category: "daily",
    title: "Spin the daily wheel",
    verification: {
      kind: "daily-spin",
      minXp: 1,
      maxXp: 20,
    },
  },
  {
    id: "renew-weekly",
    category: "weekly",
    title: "Renew one group credit",
    verification: {
      kind: "backend-event",
      event: "group:credit-renewed",
      xp: 70,
    },
  },
  {
    id: "complete-daily-3",
    category: "weekly",
    title: "Reach a 3-day streak",
    verification: {
      kind: "backend-event",
      event: "streak:three-day",
      xp: 70,
    },
  },
  {
    id: "weekly-referral-activated",
    category: "weekly",
    title: "Activate one referral",
    verification: {
      kind: "backend-event",
      event: "referral:activated",
      xp: 70,
    },
  },
  {
    id: "rookie-badge-progress",
    category: "weekly",
    title: "Wear the Rookie badge",
    verification: {
      kind: "backend-event",
      event: "badge:equipped:rookie",
      xp: 70,
    },
  },
  {
    id: "streak-day-6",
    category: "monthly",
    title: "Hold a 6-day streak",
    verification: {
      kind: "backend-event",
      event: "streak:six-day",
      xp: 180,
    },
  },
  {
    id: "monthly-referrals",
    category: "monthly",
    title: "Activate three referrals",
    verification: {
      kind: "backend-event",
      event: "referral:activated:three",
      xp: 180,
    },
  },
  {
    id: "monthly-giveaway",
    category: "monthly",
    title: "Host a giveaway",
    verification: {
      kind: "backend-event",
      event: "giveaway:created",
      xp: 180,
    },
  },
  {
    id: "master-badge-progress",
    category: "monthly",
    title: "Wear the Master badge",
    verification: {
      kind: "backend-event",
      event: "badge:equipped:master",
      xp: 180,
    },
  },
  {
    id: "join-channel",
    category: "general",
    title: "Join the official Firewall channel",
    verification: {
      kind: "channel-membership",
      channelUsername: DEFAULT_CHANNEL_USERNAME,
      xp: 30,
    },
  },
  {
    id: "add-group",
    category: "general",
    title: "Add Firewall to a new group",
    verification: {
      kind: "backend-event",
      event: "group:added",
      xp: 30,
    },
  },
  {
    id: "badge-rookie",
    category: "general",
    title: "Equip the Rookie badge",
    verification: {
      kind: "backend-event",
      event: "badge:equipped:rookie",
      xp: 30,
    },
  },
  {
    id: "badge-active",
    category: "general",
    title: "Equip the Active badge",
    verification: {
      kind: "backend-event",
      event: "badge:equipped:active",
      xp: 40,
    },
  },
  {
    id: "badge-master",
    category: "general",
    title: "Equip the Master badge",
    verification: {
      kind: "backend-event",
      event: "badge:equipped:master",
      xp: 50,
    },
  },
  {
    id: "badge-elite",
    category: "general",
    title: "Equip the Elite badge",
    verification: {
      kind: "backend-event",
      event: "badge:equipped:elite",
      xp: 60,
    },
  },
  {
    id: "badge-legend",
    category: "general",
    title: "Equip the Legend badge",
    verification: {
      kind: "backend-event",
      event: "badge:equipped:legend",
      xp: 80,
    },
  },
  {
    id: "referral-1",
    category: "general",
    title: "Activate one referral",
    verification: {
      kind: "backend-event",
      event: "referral:activated:1",
      xp: 40,
    },
  },
  {
    id: "referral-3",
    category: "general",
    title: "Activate three referrals",
    verification: {
      kind: "backend-event",
      event: "referral:activated:3",
      xp: 70,
    },
  },
  {
    id: "referral-6",
    category: "general",
    title: "Activate six referrals",
    verification: {
      kind: "backend-event",
      event: "referral:activated:6",
      xp: 120,
    },
  },
  {
    id: "referral-9",
    category: "general",
    title: "Activate nine referrals",
    verification: {
      kind: "backend-event",
      event: "referral:activated:9",
      xp: 180,
    },
  },
  {
    id: "referral-30",
    category: "general",
    title: "Activate thirty referrals",
    verification: {
      kind: "backend-event",
      event: "referral:activated:30",
      xp: 400,
    },
  },
];

const MISSION_DEFINITION_INDEX = new Map<string, MissionDefinition>(
  MISSION_DEFINITIONS.map((definition) => [definition.id, definition]),
);

export function listMissionDefinitions(): MissionDefinition[] {
  return [...MISSION_DEFINITION_INDEX.values()];
}

export function getMissionDefinition(missionId: string): MissionDefinition {
  const definition = MISSION_DEFINITION_INDEX.get(missionId);
  if (!definition) {
    throw new Error(`Mission definition not found for id '${missionId}'`);
  }
  return definition;
}

export function tryGetMissionDefinition(missionId: string): MissionDefinition | null {
  return MISSION_DEFINITION_INDEX.get(missionId) ?? null;
}
