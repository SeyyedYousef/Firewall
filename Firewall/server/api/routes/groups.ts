import { Router } from "express";
import { requireTelegramInitData } from "../middleware/telegramInit.js";
import { requireAuthentication, requirePanelAdmin } from "../middleware/acl.js";
import {
  buildManagedGroups,
  loadGroupsSnapshot,
  computeDashboardInsights,
  searchGroupRecords,
  buildGroupAnalyticsSnapshot,
} from "../../services/dashboardService.js";
import {
  listModerationActionsFromDb,
  listMembershipEventsFromDb,
} from "../../db/stateRepository.js";
import {
  GroupNotFoundError,
  loadBanSettingsByChatId,
  saveBanSettingsByChatId,
  loadGeneralSettingsByChatId,
  saveGeneralSettingsByChatId,
  loadSilenceSettingsByChatId,
  saveSilenceSettingsByChatId,
  loadMandatoryMembershipSettingsByChatId,
  saveMandatoryMembershipSettingsByChatId,
  loadCustomTextSettingsByChatId,
  saveCustomTextSettingsByChatId,
  loadLimitSettingsByChatId,
  saveGroupCountLimitSettingsByChatId,
} from "../../db/groupSettingsRepository.js";
import { logger } from "../../utils/logger.js";
import { loadGroupDetailByChatId } from "../../services/dashboardService.js";

type GroupsRouterOptions = {
  telegram?: any;
};

export function createGroupsRouter(options: GroupsRouterOptions = {}): Router {
  const router = Router();

  router.use(requireTelegramInitData());

  // Main groups endpoint - accessible to all authenticated users
  router.get("/", requireAuthentication(), async (req, res) => {
    try {
      const auth = req.telegramAuth ?? null;
      const privileges = req.panelPrivileges ?? null;
      const includeAll = Boolean(privileges?.isPanelAdmin);
      
      logger.info("Loading groups for dashboard", {
        userId: auth?.userId,
        includeAll,
        isPanelAdmin: Boolean(privileges?.isPanelAdmin)
      });
      
      const records = await loadGroupsSnapshot(auth?.userId ?? null, { includeAll });
      const [payload, insights] = await Promise.all([
        buildManagedGroups(records),
        computeDashboardInsights(records),
      ]);
      
      logger.info("Successfully loaded groups", {
        userId: auth?.userId,
        groupCount: payload.length,
        recordCount: records.length
      });
      
      res.json({ groups: payload, insights });
    } catch (error) {
      logger.error("Failed to load groups for dashboard", { error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: "Failed to load groups" });
    }
  });

  // Group detail endpoint - accessible to group owners and admins
  router.get("/:groupId", requireAuthentication(), async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    
    const auth = req.telegramAuth ?? null;
    const privileges = req.panelPrivileges ?? null;
    
    // Check if user has access to this group
    if (!privileges?.isPanelAdmin && auth?.userId) {
      try {
        const records = await loadGroupsSnapshot(auth.userId, { includeAll: false });
        const hasAccess = records.some(record => record.chatId === groupId);
        
        logger.info("Group access check", { 
          userId: auth.userId, 
          groupId, 
          hasAccess, 
          recordCount: records.length,
          isPanelAdmin: Boolean(privileges?.isPanelAdmin)
        });
        
        if (!hasAccess) {
          res.status(403).json({ error: "You don't have access to this group" });
          return;
        }
      } catch (error) {
        logger.error("Failed to load groups for access check", { userId: auth.userId, groupId, error });
        res.status(500).json({ error: "Failed to verify group access" });
        return;
      }
    }
    
    try {
      logger.info("Loading group detail", { 
        groupId, 
        userId: auth?.userId,
        databaseAvailable: process.env.DATABASE_URL ? true : false
      });
      
      const detail = await loadGroupDetailByChatId(groupId, auth?.userId);
      logger.info("Successfully loaded group detail", { 
        groupId, 
        title: detail.group?.title,
        metricsType: detail.metrics ? 'loaded' : 'fallback'
      });
      res.json(detail);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        logger.warn("Group not found", { groupId });
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to load group detail", { groupId, error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: "Failed to load group detail" });
    }
  });

  // Group analytics endpoint - accessible to group owners and admins
  router.get("/:groupId/analytics", requireAuthentication(), async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    
    const auth = req.telegramAuth ?? null;
    const privileges = req.panelPrivileges ?? null;
    
    // Check if user has access to this group
    if (!privileges?.isPanelAdmin && auth?.userId) {
      try {
        const records = await loadGroupsSnapshot(auth.userId, { includeAll: false });
        const hasAccess = records.some(record => record.chatId === groupId);
        
        logger.info("Group analytics access check", { 
          userId: auth.userId, 
          groupId, 
          hasAccess, 
          recordCount: records.length,
          isPanelAdmin: Boolean(privileges?.isPanelAdmin)
        });
        
        if (!hasAccess) {
          res.status(403).json({ error: "You don't have access to this group's analytics" });
          return;
        }
      } catch (error) {
        logger.error("Failed to load groups for analytics access check", { userId: auth.userId, groupId, error });
        res.status(500).json({ error: "Failed to verify group access" });
        return;
      }
    }
    
    try {
      logger.info("Loading group analytics", { 
        groupId, 
        userId: auth?.userId,
        databaseAvailable: Boolean(process.env.DATABASE_URL)
      });
      
      // Test if we can load the group first
      const records = await loadGroupsSnapshot(auth?.userId ?? null, { includeAll: true });
      const record = records.find(r => r.chatId === groupId);
      
      if (!record) {
        logger.warn("Group record not found for analytics", { 
          groupId, 
          availableGroups: records.map(r => r.chatId).slice(0, 5)
        });
        res.status(404).json({ error: "Group not found" });
        return;
      }
      
      logger.info("Found group record for analytics", {
        groupId,
        groupTitle: record.title,
        groupManaged: record.managed
      });
      
      const snapshot = await buildGroupAnalyticsSnapshot(groupId);
      logger.info("Successfully loaded group analytics", { 
        groupId, 
        dataPoints: snapshot.members?.length || 0,
        messagesSeriesCount: snapshot.messages?.length || 0
      });
      res.json(snapshot);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        logger.warn("Group not found for analytics", { groupId });
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to build group analytics snapshot", { groupId, error: error instanceof Error ? error.message : error });
      res.status(500).json({ error: "Failed to load analytics data" });
    }
  });

  // All other endpoints require panel admin access
  router.use(requirePanelAdmin());

  router.get("/search", async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q : "";
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 20;
    const auth = req.telegramAuth ?? null;
    const privileges = req.panelPrivileges ?? null;
    const includeAll = Boolean(privileges?.isPanelAdmin);
    const results = await searchGroupRecords(query, limit, {
      userId: auth?.userId ?? null,
      includeAll,
    });
    res.json({ query, results });
  });


  router.get("/:chatId/moderation-actions", async (req, res) => {
    const chatId = req.params.chatId;
    if (!chatId) {
      res.status(400).json({ error: "chatId is required" });
      return;
    }
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 100;
    const actions = await listModerationActionsFromDb(chatId, limit);
    res.json({ chatId, actions });
  });

  router.get("/:chatId/membership-events", async (req, res) => {
    const chatId = req.params.chatId;
    if (!chatId) {
      res.status(400).json({ error: "chatId is required" });
      return;
    }
    const limit = Number.isFinite(Number(req.query.limit)) ? Number(req.query.limit) : 100;
    const events = await listMembershipEventsFromDb(chatId, limit);
    res.json({ chatId, events });
  });

  router.get("/:groupId/settings/bans", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    try {
      const settings = await loadBanSettingsByChatId(groupId);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to load group ban settings", { groupId, error });
      res.status(500).json({ error: "Failed to load group ban settings" });
    }
  });

  router.put("/:groupId/settings/bans", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Ban settings payload must be an object" });
      return;
    }
    try {
      const settings = await saveBanSettingsByChatId(groupId, req.body);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to save group ban settings", { groupId, error });
      res.status(500).json({ error: "Failed to save group ban settings" });
    }
  });

  router.get("/:groupId/settings/general", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    try {
      const settings = await loadGeneralSettingsByChatId(groupId);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to load group general settings", { groupId, error });
      res.status(500).json({ error: "Failed to load group general settings" });
    }
  });

  router.put("/:groupId/settings/general", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "General settings payload must be an object" });
      return;
    }
    try {
      const settings = await saveGeneralSettingsByChatId(groupId, req.body);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to save group general settings", { groupId, error });
      res.status(500).json({ error: "Failed to save group general settings" });
    }
  });

  router.get("/:groupId/settings/silence", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    try {
      const settings = await loadSilenceSettingsByChatId(groupId);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to load group silence settings", { groupId, error });
      res.status(500).json({ error: "Failed to load group silence settings" });
    }
  });

  router.put("/:groupId/settings/silence", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Silence settings payload must be an object" });
      return;
    }
    try {
      const settings = await saveSilenceSettingsByChatId(groupId, req.body);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to save group silence settings", { groupId, error });
      res.status(500).json({ error: "Failed to save group silence settings" });
    }

  });

  router.get("/:groupId/settings/mandatory", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    try {
      const settings = await loadMandatoryMembershipSettingsByChatId(groupId);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to load group mandatory settings", { groupId, error });
      res.status(500).json({ error: "Failed to load group mandatory settings" });
    }
  });

  router.put("/:groupId/settings/mandatory", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Mandatory settings payload must be an object" });
      return;
    }
    try {
      const settings = await saveMandatoryMembershipSettingsByChatId(groupId, req.body);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to save group mandatory settings", { groupId, error });
      res.status(500).json({ error: "Failed to save group mandatory settings" });
    }
  });

  router.get("/:groupId/settings/custom-texts", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    try {
      const settings = await loadCustomTextSettingsByChatId(groupId);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to load group custom text settings", { groupId, error });
      res.status(500).json({ error: "Failed to load group custom text settings" });
    }
  });

  router.put("/:groupId/settings/custom-texts", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Custom text settings payload must be an object" });
      return;
    }
    try {
      const settings = await saveCustomTextSettingsByChatId(groupId, req.body);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to save group custom text settings", { groupId, error });
      res.status(500).json({ error: "Failed to save group custom text settings" });
    }
  });

  router.get("/:groupId/settings/limits", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    try {
      const settings = await loadLimitSettingsByChatId(groupId);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to load group limit settings", { groupId, error });
      res.status(500).json({ error: "Failed to load group limit settings" });
    }
  });

  router.put("/:groupId/settings/limits", async (req, res) => {
    const groupId = req.params.groupId;
    if (!groupId) {
      res.status(400).json({ error: "groupId is required" });
      return;
    }
    if (!req.body || typeof req.body !== "object") {
      res.status(400).json({ error: "Limit settings payload must be an object" });
      return;
    }
    try {
      const settings = await saveGroupCountLimitSettingsByChatId(groupId, req.body);
      res.json(settings);
    } catch (error) {
      if (error instanceof GroupNotFoundError) {
        res.status(404).json({ error: "Group not found" });
        return;
      }
      logger.error("failed to save group limit settings", { groupId, error });
      res.status(500).json({ error: "Failed to save group limit settings" });
    }
  });

  router.post("/migrate-owners", async (req, res) => {
    const privileges = req.panelPrivileges ?? null;
    if (!privileges?.isPanelAdmin) {
      res.status(403).json({ error: "Only panel admins can run migrations" });
      return;
    }

    if (!options.telegram) {
      res.status(503).json({ error: "Telegram bot instance not available" });
      return;
    }

    try {
      const { setMissingGroupOwners } = await import("../../db/migrations/setMissingGroupOwners.js");
      await setMissingGroupOwners(options.telegram);
      res.json({ success: true, message: "Migration completed successfully" });
    } catch (error) {
      logger.error("failed to run owner migration", { error });
      res.status(500).json({ error: "Migration failed" });
    }
  });

  return router;
}
