import type { NextFunction, Request, Response } from "express";
import { fetchPanelAdminsFromDb, userCanManageGroup, userManagesAnyGroup } from "../../db/stateRepository.js";
import { listPanelAdmins } from "../../../bot/state.js";
import { logger } from "../../utils/logger.js";

const ownerTelegramId = process.env.BOT_OWNER_ID?.trim() ?? null;
const databaseAvailable = Boolean(process.env.DATABASE_URL);

async function loadPanelAdmins(): Promise<Set<string>> {
  const admins = new Set<string>();
  if (ownerTelegramId) {
    admins.add(ownerTelegramId);
  }

  try {
    const records = await fetchPanelAdminsFromDb();
    records.forEach((id) => admins.add(id));
  } catch {
    // Fall back silently; the in-memory list is better than rejecting outright.
    listPanelAdmins().forEach((id) => admins.add(id));
  }

  return admins;
}

export type PanelPrivileges = {
  isPanelAdmin: boolean;
  hasGroupAccess: boolean;
};

export async function resolvePanelPrivileges(userId: string): Promise<PanelPrivileges> {
  const admins = await loadPanelAdmins();
  const isPanelAdmin = admins.has(userId);
  let hasGroupAccess = isPanelAdmin;

  if (!hasGroupAccess && databaseAvailable) {
    try {
      hasGroupAccess = await userManagesAnyGroup(userId);
    } catch (error) {
      logger.warn("failed to evaluate group management access", { userId, error });
    }
  }

  return {
    isPanelAdmin,
    hasGroupAccess,
  };
}

export async function ensurePanelAccess(userId: string): Promise<boolean> {
  const privileges = await resolvePanelPrivileges(userId);
  return privileges.isPanelAdmin || privileges.hasGroupAccess;
}

declare module "express-serve-static-core" {
  interface Request {
    panelPrivileges?: PanelPrivileges;
  }
}

function resolveTargetChatId(req: Request): string | null {
  const paramsGroupId = typeof req.params?.groupId === "string" ? req.params.groupId.trim() : "";
  if (paramsGroupId.length > 0) {
    return paramsGroupId;
  }
  const paramsChatId = typeof req.params?.chatId === "string" ? req.params.chatId.trim() : "";
  if (paramsChatId.length > 0) {
    return paramsChatId;
  }
  const queryGroupId = typeof req.query?.groupId === "string" ? req.query.groupId.trim() : "";
  if (queryGroupId.length > 0) {
    return queryGroupId;
  }
  return null;
}

export function requireAuthentication() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.telegramAuth;
    if (!auth) {
      res.status(401).json({ error: "Missing Telegram authentication context" });
      return;
    }
    const privileges = await resolvePanelPrivileges(auth.userId);
    req.panelPrivileges = privileges;
    next();
  };
}

export function requirePanelAdmin() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.telegramAuth;
    if (!auth) {
      res.status(401).json({ error: "Missing Telegram authentication context" });
      return;
    }
    const privileges = await resolvePanelPrivileges(auth.userId);
    if (!privileges.isPanelAdmin && !privileges.hasGroupAccess) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    req.panelPrivileges = privileges;
    if (!privileges.isPanelAdmin && databaseAvailable) {
      const targetChatId = resolveTargetChatId(req);
      if (targetChatId) {
        try {
          const allowed = await userCanManageGroup(auth.userId, targetChatId);
          if (!allowed) {
            res.status(403).json({ error: "You no longer have access to manage this group" });
            return;
          }
        } catch (error) {
          logger.error("failed to evaluate group-level permissions", { userId: auth.userId, targetChatId, error });
          res.status(500).json({ error: "Failed to evaluate group permissions" });
          return;
        }
      }
    }
    next();
  };
}

export function requireOwnerAccess() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const auth = req.telegramAuth;
    if (!auth) {
      res.status(401).json({ error: "Missing Telegram authentication context" });
      return;
    }
    
    // Only bot owner can access
    if (auth.userId !== ownerTelegramId) {
      res.status(403).json({ error: "Owner access required" });
      return;
    }
    
    next();
  };
}
