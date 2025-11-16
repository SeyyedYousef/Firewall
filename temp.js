import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { open, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "../server/utils/logger.js";
const moduleDir = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(moduleDir, "../data");
const statePath = resolve(dataDir, "bot-state.json");
const stateLockPath = resolve(dataDir, "bot-state.lock");
const databaseAvailable = Boolean(process.env.DATABASE_URL);
const ownerTelegramId = process.env.BOT_OWNER_ID?.trim() ?? null;
const LOCK_RETRY_DELAY_MS = 40;
const LOCK_STALE_THRESHOLD_MS = 3e4;
const DEFAULT_ONBOARDING_MESSAGES = [
  "Firewall Bot is ready to protect your group with automated rules and security tools.",
  "A {trial_days}-day trial is active. You can add credit later from the admin panel.",
  "Promote the bot to Administrator so it can enforce rules and manage messages.",
  "Tip: send /panel in a private chat with the bot to open the dashboard."
];
const EMPTY_PROMO_ANALYTICS = Object.freeze({
  impressions: 0,
  clicks: 0,
  ctr: 0,
  avgTimeSpent: 0,
  bounceRate: 0
});
function normalizePromoSlideEntry(raw, index) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw;
  const id = typeof value.id === "string" && value.id.trim().length > 0 ? value.id.trim() : `promo-${String(index + 1).padStart(3, "0")}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const imageUrl = typeof value.imageUrl === "string" && value.imageUrl.trim().length > 0 ? value.imageUrl : typeof value.fileId === "string" ? value.fileId : "";
  const analytics = value.analytics && typeof value.analytics === "object" ? {
    impressions: Number(value.analytics.impressions ?? 0),
    clicks: Number(value.analytics.clicks ?? 0),
    ctr: Number(value.analytics.ctr ?? 0),
    avgTimeSpent: Number(value.analytics.avgTimeSpent ?? 0),
    bounceRate: Number(value.analytics.bounceRate ?? 0)
  } : { ...EMPTY_PROMO_ANALYTICS };
  return {
    id,
    title: typeof value.title === "string" ? value.title : null,
    subtitle: typeof value.subtitle === "string" ? value.subtitle : null,
    description: typeof value.description === "string" ? value.description : null,
    imageUrl,
    thumbnailUrl: typeof value.thumbnailUrl === "string" ? value.thumbnailUrl : null,
    thumbnailStorageKey: typeof value.thumbnailStorageKey === "string" ? value.thumbnailStorageKey : null,
    storageKey: typeof value.storageKey === "string" ? value.storageKey : null,
    originalFileId: typeof value.originalFileId === "string" ? value.originalFileId : null,
    contentType: typeof value.contentType === "string" ? value.contentType : null,
    fileSize: typeof value.fileSize === "number" && Number.isFinite(value.fileSize) ? Math.floor(value.fileSize) : null,
    width: typeof value.width === "number" && Number.isFinite(value.width) ? Math.floor(value.width) : null,
    height: typeof value.height === "number" && Number.isFinite(value.height) ? Math.floor(value.height) : null,
    checksum: typeof value.checksum === "string" ? value.checksum : null,
    accentColor: typeof value.accentColor === "string" ? value.accentColor : null,
    linkUrl: typeof value.linkUrl === "string" ? value.linkUrl : typeof value.link === "string" ? value.link : null,
    ctaLabel: typeof value.ctaLabel === "string" ? value.ctaLabel : null,
    ctaLink: typeof value.ctaLink === "string" ? value.ctaLink : null,
    position: typeof value.position === "number" && Number.isFinite(value.position) ? Math.floor(value.position) : index,
    active: value.active !== false,
    startsAt: typeof value.startsAt === "string" ? value.startsAt : null,
    endsAt: typeof value.endsAt === "string" ? value.endsAt : null,
    abTestGroupId: typeof value.abTestGroupId === "string" ? value.abTestGroupId : null,
    variant: typeof value.variant === "string" ? value.variant : null,
    analytics,
    views: typeof value.views === "number" && Number.isFinite(value.views) ? Math.floor(value.views) : void 0,
    clicks: typeof value.clicks === "number" && Number.isFinite(value.clicks) ? Math.floor(value.clicks) : void 0,
    totalViewDurationMs: typeof value.totalViewDurationMs === "number" && Number.isFinite(value.totalViewDurationMs) ? Math.max(0, Math.floor(value.totalViewDurationMs)) : void 0,
    bounces: typeof value.bounces === "number" && Number.isFinite(value.bounces) ? Math.floor(value.bounces) : void 0,
    createdBy: typeof value.createdBy === "string" ? value.createdBy : null,
    createdAt: typeof value.createdAt === "string" && value.createdAt.trim().length > 0 ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt.trim().length > 0 ? value.updatedAt : now,
    metadata: value.metadata && typeof value.metadata === "object" ? value.metadata : {}
  };
}
async function delay(ms) {
  await new Promise((resolve2) => setTimeout(resolve2, ms));
}
const defaultOwnerSession = { state: "idle" };
const defaultState = {
  panelAdmins: [],
  bannedUserIds: [],
  groups: {},
  settings: {
    freeTrialDays: 15,
    monthlyStars: 10,
    welcomeMessages: [],
    onboardingMessages: Array.from(DEFAULT_ONBOARDING_MESSAGES),
    gpidHelpText: "Share the group ID or forward a message so the bot can detect it automatically.",
    buttonLabels: {},
    channelAnnouncement: "Channel link not configured yet.",
    infoCommands: "Use /panel in a private chat to access owner tools."
  },
  promoSlides: [],
  broadcasts: [],
  stars: {
    balance: 0,
    plans: [
      { id: "stars-30", days: 30, price: 500 },
      { id: "stars-60", days: 60, price: 900 },
      { id: "stars-90", days: 90, price: 1300 }
    ],
    groups: {}
  },
  ownerSession: defaultOwnerSession
};
function normalizeOwnerSession(input) {
  if (!input || typeof input !== "object") {
    return { state: "idle" };
  }
  const raw = input;
  const stateValue = typeof raw.state === "string" ? raw.state : null;
  if (!stateValue) {
    return { state: "idle" };
  }
  const simpleStates = /* @__PURE__ */ new Set([
    "idle",
    "awaitingAddAdmin",
    "awaitingRemoveAdmin",
    "awaitingManageGroup",
    "awaitingIncreaseCredit",
    "awaitingDecreaseCredit",
    "awaitingBroadcastMessage",
    "awaitingSliderPhoto",
    "awaitingSliderRemoval",
    "awaitingBanUserId",
    "awaitingUnbanUserId",
    "awaitingDailyTaskLink",
    "awaitingSettingsFreeDays",
    "awaitingSettingsStars",
    "awaitingSettingsWelcomeMessages",
    "awaitingSettingsOnboardingMessages",
    "awaitingSettingsGpidHelp",
    "awaitingSettingsLabels",
    "awaitingSettingsChannelText",
    "awaitingSettingsInfoCommands",
    "awaitingFirewallRuleCreate"
  ]);
  if (simpleStates.has(stateValue)) {
    return { state: stateValue };
  }
  const pending = raw.pending;
  switch (stateValue) {
    case "awaitingBroadcastConfirm":
      if (pending && typeof pending === "object" && typeof pending.message === "string") {
        return { state: "awaitingBroadcastConfirm", pending: { message: pending.message } };
      }
      return { state: "idle" };
    case "awaitingSliderLink":
      if (pending && typeof pending === "object" && typeof pending.fileId === "string" && typeof pending.width === "number" && typeof pending.height === "number") {
        const typed = pending;
        return {
          state: "awaitingSliderLink",
          pending: { fileId: typed.fileId, width: typed.width, height: typed.height }
        };
      }
      return { state: "idle" };
    case "awaitingDailyTaskButton":
      if (pending && typeof pending === "object" && typeof pending.channelLink === "string") {
        return {
          state: "awaitingDailyTaskButton",
          pending: { channelLink: pending.channelLink }
        };
      }
      return { state: "idle" };
    case "awaitingDailyTaskDescription":
      if (pending && typeof pending === "object" && typeof pending.channelLink === "string" && typeof pending.buttonLabel === "string") {
        const typed = pending;
        return {
          state: "awaitingDailyTaskDescription",
          pending: { channelLink: typed.channelLink, buttonLabel: typed.buttonLabel }
        };
      }
      return { state: "idle" };
    case "awaitingDailyTaskXp":
      if (pending && typeof pending === "object" && typeof pending.channelLink === "string" && typeof pending.buttonLabel === "string" && typeof pending.description === "string") {
        const typed = pending;
        return {
          state: "awaitingDailyTaskXp",
          pending: {
            channelLink: typed.channelLink,
            buttonLabel: typed.buttonLabel,
            description: typed.description
          }
        };
      }
      return { state: "idle" };
    case "awaitingFirewallRuleEdit":
      if (pending && typeof pending === "object" && typeof pending.ruleId === "string" && ("chatId" in pending ? typeof pending.chatId === "string" || pending.chatId === null : true)) {
        const typed = pending;
        return {
          state: "awaitingFirewallRuleEdit",
          pending: { ruleId: typed.ruleId, chatId: typed.chatId ?? null }
        };
      }
      return { state: "idle" };
    default:
      return { state: "idle" };
  }
}
function ensureDataDir() {
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
}
function readStateFromDisk() {
  ensureDataDir();
  if (!existsSync(statePath)) {
    return structuredClone(defaultState);
  }
  try {
    const raw = readFileSync(statePath, "utf8");
    const parsed = JSON.parse(raw);
    const groupsInput = typeof parsed.groups === "object" && parsed.groups !== null ? parsed.groups : {};
    const groups = Object.fromEntries(
      Object.entries(groupsInput).map(([id, value]) => {
        const title = typeof value.title === "string" && value.title.trim().length > 0 ? value.title : `Group ${id}`;
        const creditBalance = typeof value.creditBalance === "number" && Number.isFinite(value.creditBalance) ? Math.max(0, value.creditBalance) : 0;
        const createdAt = typeof value.createdAt === "string" ? value.createdAt : (/* @__PURE__ */ new Date()).toISOString();
        const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : createdAt;
        return [
          id,
          {
            chatId: id,
            title,
            creditBalance,
            createdAt,
            updatedAt,
            lastAdjustmentNote: typeof value.lastAdjustmentNote === "string" ? value.lastAdjustmentNote : null,
            membersCount: typeof value.membersCount === "number" && Number.isFinite(value.membersCount) ? Math.max(0, value.membersCount) : 0,
            inviteLink: typeof value.inviteLink === "string" ? value.inviteLink : null,
            photoUrl: typeof value.photoUrl === "string" ? value.photoUrl : null,
            managed: value?.managed !== false,
            adminRestricted: value?.adminRestricted === true,
            adminWarningSentAt: typeof value?.adminWarningSentAt === "string" ? value.adminWarningSentAt : null
          }
        ];
      })
    );
    const starsInput = parsed.stars ?? {};
    const plans = Array.isArray(starsInput?.plans) ? starsInput.plans.map((plan) => ({
      id: String(plan.id),
      days: Number.isFinite(plan.days) ? plan.days : 0,
      price: Number.isFinite(plan.price) ? plan.price : 0,
      ...plan.label ? { label: String(plan.label) } : {},
      ...plan.description ? { description: String(plan.description) } : {}
    })) : structuredClone(defaultState.stars.plans);
    const starsGroupsInput = typeof starsInput?.groups === "object" && starsInput?.groups !== null ? starsInput.groups : {};
    const starsGroups = Object.fromEntries(
      Object.entries(starsGroupsInput).map(([id, entry]) => [
        id,
        {
          groupId: id,
          expiresAt: typeof entry?.expiresAt === "string" ? entry.expiresAt : (/* @__PURE__ */ new Date()).toISOString(),
          gifted: entry?.gifted === true,
          trialReminderSentAt: typeof entry?.trialReminderSentAt === "string" ? entry.trialReminderSentAt : null,
          trialExpiredAt: typeof entry?.trialExpiredAt === "string" ? entry.trialExpiredAt : null,
          disabled: entry?.disabled === true
        }
      ])
    );
    return {
      panelAdmins: Array.isArray(parsed.panelAdmins) ? parsed.panelAdmins.map(String) : [],
      bannedUserIds: Array.isArray(parsed.bannedUserIds) ? parsed.bannedUserIds.map(String) : [],
      groups,
      settings: {
        ...defaultState.settings,
        ...typeof parsed.settings === "object" && parsed.settings !== null ? parsed.settings : {},
        welcomeMessages: Array.isArray(parsed.settings?.welcomeMessages) ? parsed.settings?.welcomeMessages.map(String) : defaultState.settings.welcomeMessages,
        buttonLabels: typeof parsed.settings?.buttonLabels === "object" && parsed.settings?.buttonLabels !== null ? Object.fromEntries(
          Object.entries(parsed.settings.buttonLabels).map(([key, value]) => [key, String(value)])
        ) : structuredClone(defaultState.settings.buttonLabels)
      },
      promoSlides: Array.isArray(parsed.promoSlides) ? parsed.promoSlides.map((entry, index) => normalizePromoSlideEntry(entry, index)).filter((entry) => entry !== null) : [],
      broadcasts: Array.isArray(parsed.broadcasts) ? parsed.broadcasts : [],
      stars: {
        balance: typeof starsInput?.balance === "number" && Number.isFinite(starsInput.balance) ? Math.max(0, starsInput.balance) : defaultState.stars.balance,
        plans,
        groups: starsGroups
      },
      ownerSession: normalizeOwnerSession(parsed.ownerSession)
    };
  } catch (error) {
    logger.error("state failed to parse bot-state.json, falling back to defaults", { error });
    return structuredClone(defaultState);
  }
}
let state = readStateFromDisk();
let writeQueue = Promise.resolve();
async function withFileLock(task) {
  let handle = null;
  const lockPayload = `${process.pid}:${Date.now()}`;
  for (; ; ) {
    try {
      handle = await open(stateLockPath, "wx");
      await handle.writeFile(lockPayload, "utf8");
      break;
    } catch (error) {
      const err = error;
      if (err.code !== "EEXIST") {
        throw err;
      }
      try {
        const stats = await stat(stateLockPath);
        if (Date.now() - stats.mtimeMs > LOCK_STALE_THRESHOLD_MS) {
          await unlink(stateLockPath).catch(() => void 0);
          continue;
        }
      } catch {
        continue;
      }
      await delay(LOCK_RETRY_DELAY_MS);
    }
  }
  try {
    return await task();
  } finally {
    try {
      await handle?.close();
    } catch {
    }
    await unlink(stateLockPath).catch(() => void 0);
  }
}
function logDbWarning(context, error) {
  if (!databaseAvailable) {
    return;
  }
  logger.warn("database fallback", {
    context,
    error: error instanceof Error ? error.message : error
  });
}
async function syncGroupRecord(record) {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { upsertGroupFromState } = await import("../server/db/mutateRepository.js");
    await upsertGroupFromState({
      chatId: record.chatId,
      title: record.title,
      creditBalance: record.creditBalance,
      inviteLink: record.inviteLink,
      managed: record.managed
    });
  } catch (error) {
    logDbWarning("group sync failed", error);
  }
}
async function promotePanelAdminRecord(telegramId) {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { promotePanelAdmin } = await import("../server/db/mutateRepository.js");
    await promotePanelAdmin(telegramId);
  } catch (error) {
    logDbWarning("panel admin promotion failed", error);
  }
}
async function demotePanelAdminRecord(telegramId) {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { demotePanelAdmin } = await import("../server/db/mutateRepository.js");
    await demotePanelAdmin(telegramId);
  } catch (error) {
    logDbWarning("panel admin demotion failed", error);
  }
}
async function hydratePanelAdminsFromDb() {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { fetchPanelAdminsFromDb } = await import("../server/db/stateRepository.js");
    const admins = await fetchPanelAdminsFromDb();
    if (!admins.length) {
      return;
    }
    withState((draft) => {
      const merged = new Set(admins.map((id) => id.trim()).filter(Boolean));
      if (ownerTelegramId) {
        merged.add(ownerTelegramId);
      }
      draft.panelAdmins = Array.from(merged).sort((a, b) => a.localeCompare(b));
      return draft;
    });
  } catch (error) {
    logDbWarning("panel admin hydration failed", error);
  }
}
async function hydratePromoSlidesFromDb() {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { fetchPromoSlidesFromDb } = await import("../server/db/stateRepository.js");
    const slides = await fetchPromoSlidesFromDb();
    if (!slides.length) {
      return;
    }
    withState((draft) => {
      draft.promoSlides = slides.map((slide) => ({
        ...slide,
        analytics: slide.analytics ?? { ...EMPTY_PROMO_ANALYTICS }
      }));
      return draft;
    });
  } catch (error) {
    logDbWarning("promo slide hydration failed", error);
  }
}
async function hydratePanelBansFromDb() {
  if (!databaseAvailable) {
    return;
  }
  try {
    const { fetchPanelBansFromDb } = await import("../server/db/stateRepository.js");
    const bans = await fetchPanelBansFromDb();
    if (!bans.length) {
      return;
    }
    withState((draft) => {
      draft.bannedUserIds = Array.from(new Set(bans.map((id) => id.trim()).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b)
      );
      return draft;
    });
  } catch (error) {
    logDbWarning("panel ban hydration failed", error);
  }
}
async function recordStarsPurchaseTransaction(snapshot) {
  if (!databaseAvailable || !ownerTelegramId) {
    return;
  }
  try {
    const { completeStarTransaction, createPendingStarTransaction } = await import("../server/db/mutateRepository.js");
    let transactionId = snapshot.transactionId;
    if (!transactionId) {
      const pending = await createPendingStarTransaction({
        ownerTelegramId,
        groupChatId: snapshot.groupId,
        planId: snapshot.planId,
        gifted: snapshot.gifted,
        metadata: {
          source: "bot-state"
        }
      });
      transactionId = pending.transactionId;
    }
    await completeStarTransaction({
      transactionId,
      amountDelta: snapshot.amountDelta,
      planId: snapshot.planId,
      expiresAt: snapshot.expiresAt,
      gifted: snapshot.gifted
    });
  } catch (error) {
    logDbWarning("stars purchase sync failed", error);
  }
}
if (databaseAvailable) {
  void hydratePanelAdminsFromDb();
  void hydratePromoSlidesFromDb();
  void hydratePanelBansFromDb();
}
function persistState(next) {
  ensureDataDir();
  state = next;
  const payload = JSON.stringify(next, null, 2);
  writeQueue = writeQueue.then(
    () => withFileLock(async () => {
      const tempPath = `${statePath}.${process.pid}.${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
      await writeFile(tempPath, payload, "utf8");
      await rename(tempPath, statePath);
    })
  ).catch((error) => {
    logger.error("state failed to persist bot state", { error });
  });
}
function withState(mutator) {
  const draft = mutator(structuredClone(state));
  persistState(draft);
  return draft;
}
function getState() {
  return structuredClone(state);
}
function isPanelAdmin(userId) {
  return state.panelAdmins.includes(userId);
}
function addPanelAdmin(userId) {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    if (!draft.panelAdmins.includes(trimmed)) {
      draft.panelAdmins.push(trimmed);
      draft.panelAdmins.sort((a, b) => a.localeCompare(b));
      void promotePanelAdminRecord(trimmed);
    }
    return draft;
  });
}
function removePanelAdmin(userId) {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    draft.panelAdmins = draft.panelAdmins.filter((id) => id !== trimmed);
    void demotePanelAdminRecord(trimmed);
    return draft;
  });
}
function listPanelAdmins() {
  return [...state.panelAdmins];
}
function addBannedUser(userId) {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    if (!draft.bannedUserIds.includes(trimmed)) {
      draft.bannedUserIds.push(trimmed);
      draft.bannedUserIds.sort((a, b) => a.localeCompare(b));
      if (databaseAvailable) {
        void (async () => {
          try {
            const { addPanelBan } = await import("../server/db/mutateRepository.js");
            await addPanelBan(trimmed);
          } catch (error) {
            logDbWarning("panel ban persist failed", error);
          }
        })();
      }
    }
    return draft;
  });
}
function removeBannedUser(userId) {
  const trimmed = userId.trim();
  if (!trimmed) {
    return state;
  }
  return withState((draft) => {
    draft.bannedUserIds = draft.bannedUserIds.filter((id) => id !== trimmed);
    if (databaseAvailable) {
      void (async () => {
        try {
          const { removePanelBan } = await import("../server/db/mutateRepository.js");
          await removePanelBan(trimmed);
        } catch (error) {
          logDbWarning("panel ban removal failed", error);
        }
      })();
    }
    return draft;
  });
}
function listBannedUsers() {
  return [...state.bannedUserIds];
}
function upsertGroupInDraft(draft, record) {
  const id = record.chatId.trim();
  if (!id) {
    throw new Error("chatId is required");
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const existing = draft.groups[id];
  if (existing) {
    const nextCredit = typeof record.creditDelta === "number" ? Math.max(0, existing.creditBalance + record.creditDelta) : existing.creditBalance;
    const updated = {
      ...existing,
      title: record.title?.trim() || existing.title,
      creditBalance: nextCredit,
      updatedAt: now,
      lastAdjustmentNote: record.note ?? existing.lastAdjustmentNote,
      membersCount: typeof record.membersCount === "number" && Number.isFinite(record.membersCount) ? Math.max(0, record.membersCount) : existing.membersCount,
      inviteLink: record.inviteLink === void 0 ? existing.inviteLink : record.inviteLink && record.inviteLink.trim().length > 0 ? record.inviteLink.trim() : null,
      photoUrl: record.photoUrl === void 0 ? existing.photoUrl : record.photoUrl && record.photoUrl.trim().length > 0 ? record.photoUrl.trim() : null,
      managed: record.managed === void 0 ? existing.managed : record.managed,
      adminRestricted: record.adminRestricted === void 0 ? existing.adminRestricted : record.adminRestricted,
      adminWarningSentAt: record.adminWarningSentAt === void 0 ? existing.adminWarningSentAt : record.adminWarningSentAt ?? null
    };
    draft.groups[id] = updated;
    return updated;
  }
  const title = record.title?.trim() || `Group ${id}`;
  const creditBalance = Math.max(0, record.creditDelta ?? 0);
  const created = {
    chatId: id,
    title,
    creditBalance,
    createdAt: now,
    updatedAt: now,
    lastAdjustmentNote: record.note ?? null,
    membersCount: typeof record.membersCount === "number" && Number.isFinite(record.membersCount) ? Math.max(0, record.membersCount) : 0,
    inviteLink: record.inviteLink && record.inviteLink.trim().length > 0 ? record.inviteLink.trim() : null,
    photoUrl: record.photoUrl && record.photoUrl.trim().length > 0 ? record.photoUrl.trim() : null,
    managed: record.managed !== false,
    adminRestricted: record.adminRestricted ?? false,
    adminWarningSentAt: record.adminWarningSentAt ?? null
  };
  draft.groups[id] = created;
  return created;
}
function upsertGroup(record) {
  const id = record.chatId.trim();
  if (!id) {
    throw new Error("chatId is required");
  }
  let result = null;
  state = withState((draft) => {
    result = upsertGroupInDraft(draft, record);
    return draft;
  });
  if (!result) {
    throw new Error("Unable to upsert group");
  }
  void syncGroupRecord(result);
  return result;
}
function listGroups() {
  return Object.values(state.groups).sort((a, b) => a.chatId.localeCompare(b.chatId));
}
function markAdminPermission(chatId, hasPermission, options = {}) {
  const id = chatId.trim();
  if (!id) {
    return null;
  }
  let updated = null;
  state = withState((draft) => {
    const group = draft.groups[id];
    if (!group) {
      return draft;
    }
    const nowIso = (/* @__PURE__ */ new Date()).toISOString();
    const next = {
      ...group,
      adminRestricted: !hasPermission,
      updatedAt: nowIso
    };
    if (options.warningDate !== void 0) {
      next.adminWarningSentAt = options.warningDate ? options.warningDate.toISOString() : null;
    } else if (hasPermission) {
      next.adminWarningSentAt = null;
    } else if (!group.adminWarningSentAt) {
      next.adminWarningSentAt = nowIso;
    }
    draft.groups[id] = next;
    updated = next;
    return draft;
  });
  if (updated) {
    void syncGroupRecord(updated);
  }
  return updated;
}
function setPanelSettings(partial) {
  state = withState((draft) => {
    draft.settings = {
      ...draft.settings,
      ...partial
    };
    return draft;
  });
  return state.settings;
}
function getPanelSettings() {
  return structuredClone(state.settings);
}
function setWelcomeMessages(messages) {
  state = withState((draft) => {
    draft.settings.welcomeMessages = messages;
    return draft;
  });
  return state.settings;
}
function setButtonLabels(labels) {
  state = withState((draft) => {
    draft.settings.buttonLabels = labels;
    return draft;
  });
  return state.settings;
}
function getPromoSlides() {
  return [...state.promoSlides];
}
function readOwnerSessionState() {
  return structuredClone(state.ownerSession);
}
function writeOwnerSessionState(next) {
  const normalized = normalizeOwnerSession(next);
  withState((draft) => {
    draft.ownerSession = structuredClone(normalized);
    return draft;
  });
  return structuredClone(state.ownerSession);
}
function resetOwnerSessionState() {
  return writeOwnerSessionState({ state: "idle" });
}
function addPromoSlide(entry, options = {}) {
  const persist = options.persist ?? true;
  let normalizedEntry = null;
  state = withState((draft) => {
    const normalized = {
      ...entry,
      analytics: entry.analytics ?? { ...EMPTY_PROMO_ANALYTICS },
      position: typeof entry.position === "number" && Number.isFinite(entry.position) ? entry.position : draft.promoSlides.length
    };
    normalizedEntry = normalized;
    const filtered = draft.promoSlides.filter((slide) => slide.id !== normalized.id);
    filtered.push(normalized);
    filtered.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
    draft.promoSlides = filtered;
    return draft;
  });
  const snapshotSource = normalizedEntry ?? entry;
  if (persist && databaseAvailable) {
    void (async () => {
      try {
        const { upsertPromoSlide } = await import("../server/db/mutateRepository.js");
        await upsertPromoSlide({
          id: snapshotSource.id,
          title: snapshotSource.title ?? null,
          subtitle: snapshotSource.subtitle ?? null,
          description: snapshotSource.description ?? null,
          imageUrl: snapshotSource.imageUrl,
          thumbnailUrl: snapshotSource.thumbnailUrl ?? null,
          storageKey: snapshotSource.storageKey ?? null,
          originalFileId: snapshotSource.originalFileId ?? null,
          contentType: snapshotSource.contentType ?? null,
          fileSize: snapshotSource.fileSize ?? null,
          width: snapshotSource.width ?? null,
          height: snapshotSource.height ?? null,
          checksum: snapshotSource.checksum ?? null,
          accentColor: snapshotSource.accentColor ?? void 0,
          linkUrl: snapshotSource.linkUrl ?? null,
          ctaLabel: snapshotSource.ctaLabel ?? null,
          ctaLink: snapshotSource.ctaLink ?? null,
          position: snapshotSource.position,
          startsAt: snapshotSource.startsAt ? new Date(snapshotSource.startsAt) : null,
          endsAt: snapshotSource.endsAt ? new Date(snapshotSource.endsAt) : null,
          active: snapshotSource.active,
          abTestGroupId: snapshotSource.abTestGroupId ?? null,
          variant: snapshotSource.variant ?? null,
          createdBy: snapshotSource.createdBy ?? null,
          metadata: snapshotSource.metadata ?? {}
        });
      } catch (error) {
        logDbWarning("promo slide upsert failed", error);
      }
    })();
  }
  return state.promoSlides;
}
function removePromoSlide(id, options = {}) {
  const persist = options.persist ?? true;
  state = withState((draft) => {
    draft.promoSlides = draft.promoSlides.filter((slide) => slide.id !== id);
    return draft;
  });
  if (persist && databaseAvailable) {
    void (async () => {
      try {
        const { deletePromoSlide } = await import("../server/db/mutateRepository.js");
        await deletePromoSlide(id);
      } catch (error) {
        logDbWarning("promo slide deletion failed", error);
      }
    })();
  }
  return state.promoSlides;
}
function setPromoSlides(entries, options = {}) {
  state = withState((draft) => {
    const sorted = [...entries].map((entry, index) => ({
      ...entry,
      analytics: entry.analytics ?? { ...EMPTY_PROMO_ANALYTICS },
      position: typeof entry.position === "number" && Number.isFinite(entry.position) ? entry.position : index
    }));
    sorted.sort((a, b) => {
      if (a.position !== b.position) {
        return a.position - b.position;
      }
      return a.createdAt.localeCompare(b.createdAt);
    });
    draft.promoSlides = sorted;
    return draft;
  });
  if (options.persist && databaseAvailable) {
    void (async () => {
      try {
        const { upsertPromoSlide } = await import("../server/db/mutateRepository.js");
        for (const entry of entries) {
          await upsertPromoSlide({
            id: entry.id,
            title: entry.title ?? null,
            subtitle: entry.subtitle ?? null,
            description: entry.description ?? null,
            imageUrl: entry.imageUrl,
            thumbnailUrl: entry.thumbnailUrl ?? null,
            thumbnailStorageKey: entry.thumbnailStorageKey ?? null,
            storageKey: entry.storageKey ?? null,
            originalFileId: entry.originalFileId ?? null,
            contentType: entry.contentType ?? null,
            fileSize: entry.fileSize ?? null,
            width: entry.width ?? null,
            height: entry.height ?? null,
            checksum: entry.checksum ?? null,
            accentColor: entry.accentColor ?? void 0,
            linkUrl: entry.linkUrl ?? null,
            ctaLabel: entry.ctaLabel ?? null,
            ctaLink: entry.ctaLink ?? null,
            position: entry.position,
            startsAt: entry.startsAt ? new Date(entry.startsAt) : null,
            endsAt: entry.endsAt ? new Date(entry.endsAt) : null,
            active: entry.active,
            abTestGroupId: entry.abTestGroupId ?? null,
            variant: entry.variant ?? null,
            createdBy: entry.createdBy ?? null,
            metadata: entry.metadata ?? {}
          });
        }
      } catch (error) {
        logDbWarning("promo slide bulk persist failed", error);
      }
    })();
  }
  return state.promoSlides;
}
function recordBroadcast(message) {
  let broadcast = {
    id: `broadcast-${Date.now()}`,
    message,
    createdAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  state = withState((draft) => {
    draft.broadcasts.unshift(broadcast);
    draft.broadcasts = draft.broadcasts.slice(0, 50);
    return draft;
  });
  return broadcast;
}
function listBroadcasts() {
  return [...state.broadcasts];
}
const DAY_MS = 864e5;
function resolveStarsPlan(draft, planId) {
  const plan = draft.stars.plans.find((item) => item.id === planId);
  if (!plan) {
    throw new Error(`Stars plan ${planId} not found`);
  }
  return plan;
}
function getStarsState() {
  return structuredClone(state.stars);
}
function applyStarsPurchase(input) {
  let outcome = null;
  state = withState((draft) => {
    const plan = resolveStarsPlan(draft, input.planId);
    if (draft.stars.balance < plan.price) {
      throw new Error("Insufficient Stars balance");
    }
    const metadata = input.metadata ?? {};
    const managedFlag = metadata.managed !== void 0 ? metadata.managed : !input.gifted;
    const group = upsertGroupInDraft(draft, {
      chatId: input.groupId,
      title: metadata.title,
      membersCount: metadata.membersCount,
      inviteLink: metadata.inviteLink,
      photoUrl: metadata.photoUrl,
      managed: managedFlag
    });
    const nowMs = Date.now();
    const existing = draft.stars.groups[input.groupId];
    const baseMs = existing ? Math.max(new Date(existing.expiresAt).getTime(), nowMs) : nowMs;
    const expiresAt = new Date(baseMs + plan.days * DAY_MS).toISOString();
    draft.stars.groups[input.groupId] = {
      groupId: input.groupId,
      expiresAt,
      gifted: input.gifted,
      trialReminderSentAt: null,
      trialExpiredAt: null,
      disabled: false
    };
    draft.stars.balance = Math.max(0, draft.stars.balance - plan.price);
    outcome = {
      group,
      plan,
      expiresAt,
      daysAdded: plan.days,
      newBalance: draft.stars.balance,
      gifted: input.gifted
    };
    return draft;
  });
  if (!outcome) {
    throw new Error("Failed to apply Stars purchase");
  }
  void recordStarsPurchaseTransaction({
    transactionId: input.transactionId,
    groupId: outcome.group.chatId,
    planId: outcome.plan.id,
    amountDelta: -outcome.plan.price,
    expiresAt: outcome.expiresAt,
    gifted: input.gifted
  });
  return outcome;
}
function grantTrialForGroup(params) {
  const id = params.groupId.trim();
  if (!id) {
    throw new Error("groupId is required for trial assignment");
  }
  const days = Math.max(0, Math.floor(params.days));
  let outcome = null;
  state = withState((draft) => {
    const group = upsertGroupInDraft(draft, {
      chatId: id,
      title: params.title,
      membersCount: params.membersCount,
      inviteLink: params.inviteLink,
      photoUrl: params.photoUrl,
      managed: params.managed ?? true
    });
    if (days === 0) {
      const existing2 = draft.stars.groups[id];
      outcome = {
        group,
        expiresAt: existing2 ? existing2.expiresAt : (/* @__PURE__ */ new Date()).toISOString(),
        appliedDays: 0
      };
      return draft;
    }
    const existing = draft.stars.groups[id];
    if (existing) {
      draft.stars.groups[id] = {
        ...existing,
        disabled: false,
        trialExpiredAt: null
      };
      outcome = { group, expiresAt: existing.expiresAt, appliedDays: 0 };
      return draft;
    }
    const expiresAt = new Date(Date.now() + days * DAY_MS).toISOString();
    draft.stars.groups[id] = {
      groupId: id,
      expiresAt,
      gifted: true,
      trialReminderSentAt: null,
      trialExpiredAt: null,
      disabled: false
    };
    outcome = { group, expiresAt, appliedDays: days };
    return draft;
  });
  if (!outcome) {
    throw new Error("Failed to assign trial period");
  }
  void syncGroupRecord(outcome.group);
  return outcome;
}
function markTrialReminderSent(groupId, date) {
  const sentAt = date.toISOString();
  withState((draft) => {
    const entry = draft.stars.groups[groupId];
    if (!entry) {
      return draft;
    }
    draft.stars.groups[groupId] = {
      ...entry,
      trialReminderSentAt: sentAt
    };
    return draft;
  });
}
function markTrialExpired(groupId, date) {
  let managed = null;
  const expiredAt = date.toISOString();
  withState((draft) => {
    const entry = draft.stars.groups[groupId];
    if (!entry) {
      return draft;
    }
    draft.stars.groups[groupId] = {
      ...entry,
      disabled: true,
      trialExpiredAt: expiredAt
    };
    managed = upsertGroupInDraft(draft, {
      chatId: groupId,
      managed: false
    });
    return draft;
  });
  return managed;
}
function setStarsBalance(balance) {
  if (!Number.isFinite(balance) || balance < 0) {
    throw new Error("Stars balance must be a non-negative number");
  }
  state = withState((draft) => {
    draft.stars.balance = Math.floor(balance);
    return draft;
  });
  return state.stars;
}
function adjustStarsBalance(delta) {
  if (!Number.isFinite(delta)) {
    throw new Error("Stars balance delta must be a finite number");
  }
  state = withState((draft) => {
    const next = Math.floor(draft.stars.balance + delta);
    draft.stars.balance = Math.max(0, next);
    return draft;
  });
  return state.stars;
}
export {
  DEFAULT_ONBOARDING_MESSAGES,
  addBannedUser,
  addPanelAdmin,
  addPromoSlide,
  adjustStarsBalance,
  applyStarsPurchase,
  getPanelSettings,
  getPromoSlides,
  getStarsState,
  getState,
  grantTrialForGroup,
  isPanelAdmin,
  listBannedUsers,
  listBroadcasts,
  listGroups,
  listPanelAdmins,
  markAdminPermission,
  markTrialExpired,
  markTrialReminderSent,
  readOwnerSessionState,
  recordBroadcast,
  removeBannedUser,
  removePanelAdmin,
  removePromoSlide,
  resetOwnerSessionState,
  setButtonLabels,
  setPanelSettings,
  setPromoSlides,
  setStarsBalance,
  setWelcomeMessages,
  upsertGroup,
  writeOwnerSessionState
};
