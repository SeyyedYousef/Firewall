-- Add new columns to UserMission for cycle tracking and verification.
ALTER TABLE "UserMission"
  ADD COLUMN     "cycleKey" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN     "verificationState" TEXT NOT NULL DEFAULT 'verified',
  ADD COLUMN     "verificationReason" TEXT;

-- Update existing rows to have explicit defaults (defensive for future default removal).
UPDATE "UserMission"
SET
  "cycleKey" = COALESCE(NULLIF(TRIM("cycleKey"), ''), 'legacy'),
  "verificationState" = COALESCE(NULLIF(TRIM("verificationState"), ''), 'verified')
WHERE 1 = 1;

-- Replace unique constraint to include cycle key.
ALTER TABLE "UserMission"
  DROP CONSTRAINT IF EXISTS "UserMission_userProfileId_missionId_category_key";

CREATE UNIQUE INDEX IF NOT EXISTS "UserMission_userProfileId_missionId_category_cycleKey_key"
  ON "UserMission"("userProfileId", "missionId", "category", "cycleKey");

-- Refresh supporting indexes.
DROP INDEX IF EXISTS "UserMission_userProfileId_category_cycleKey_idx";
DROP INDEX IF EXISTS "UserMission_userProfileId_completedAt_idx";

CREATE INDEX "UserMission_userProfileId_category_cycleKey_idx"
  ON "UserMission"("userProfileId", "category", "cycleKey");

CREATE INDEX "UserMission_userProfileId_completedAt_idx"
  ON "UserMission"("userProfileId", "completedAt");

-- MissionCycle records hold the canonical reset windows per category.
CREATE TABLE IF NOT EXISTS "MissionCycle" (
  "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "category"    TEXT NOT NULL,
  "cycleKey"    TEXT NOT NULL,
  "windowStart" TIMESTAMP WITH TIME ZONE NOT NULL,
  "windowEnd"   TIMESTAMP WITH TIME ZONE NOT NULL,
  "resetAt"     TIMESTAMP WITH TIME ZONE NOT NULL,
  "createdAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "updatedAt"   TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "MissionCycle_category_key"
  ON "MissionCycle"("category");

CREATE UNIQUE INDEX IF NOT EXISTS "MissionCycle_category_cycleKey_key"
  ON "MissionCycle"("category", "cycleKey");

CREATE INDEX IF NOT EXISTS "MissionCycle_cycleKey_idx"
  ON "MissionCycle"("cycleKey");

-- MissionEvent captures mission state transitions for audit.
CREATE TABLE IF NOT EXISTS "MissionEvent" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "userProfileId" TEXT,
  "missionId"     TEXT NOT NULL,
  "category"      TEXT NOT NULL,
  "cycleKey"      TEXT NOT NULL,
  "state"         TEXT NOT NULL,
  "payload"       JSONB,
  "occurredAt"    TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT "MissionEvent_userProfileId_fkey"
    FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "MissionEvent_missionId_category_cycleKey_idx"
  ON "MissionEvent"("missionId", "category", "cycleKey");

CREATE INDEX IF NOT EXISTS "MissionEvent_userProfileId_occurredAt_idx"
  ON "MissionEvent"("userProfileId", "occurredAt");

-- CreditRedemptionCode issues one-time credit codes.
CREATE TABLE IF NOT EXISTS "CreditRedemptionCode" (
  "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "codeHash"          TEXT NOT NULL UNIQUE,
  "valueDays"         INTEGER NOT NULL,
  "issuedToProfileId" TEXT NOT NULL,
  "issuedAt"          TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "redeemedAt"        TIMESTAMP WITH TIME ZONE,
  "redeemedGroupId"   TEXT,
  "status"            TEXT NOT NULL DEFAULT 'active',
  "metadata"          JSONB,
  CONSTRAINT "CreditRedemptionCode_issuedToProfileId_fkey"
    FOREIGN KEY ("issuedToProfileId") REFERENCES "UserProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CreditRedemptionCode_redeemedGroupId_fkey"
    FOREIGN KEY ("redeemedGroupId") REFERENCES "Group"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CreditRedemptionCode_issuedToProfileId_status_idx"
  ON "CreditRedemptionCode"("issuedToProfileId", "status");

CREATE INDEX IF NOT EXISTS "CreditRedemptionCode_redeemedGroupId_idx"
  ON "CreditRedemptionCode"("redeemedGroupId");

-- UserBadge tracks badge ownership.
CREATE TABLE IF NOT EXISTS "UserBadge" (
  "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "userProfileId" TEXT NOT NULL,
  "badgeId"       TEXT NOT NULL,
  "awardedAt"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "metadata"      JSONB,
  CONSTRAINT "UserBadge_userProfileId_fkey"
    FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserBadge_userProfileId_badgeId_key"
  ON "UserBadge"("userProfileId", "badgeId");

CREATE INDEX IF NOT EXISTS "UserBadge_userProfileId_awardedAt_idx"
  ON "UserBadge"("userProfileId", "awardedAt");
