-- Enable required extension for gen_random_uuid
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create table for user profiles if it does not already exist
CREATE TABLE IF NOT EXISTS "UserProfile" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "telegramUserId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "totalXp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "lastCheckIn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserProfile_telegramUserId_key"
    ON "UserProfile"("telegramUserId");

CREATE INDEX IF NOT EXISTS "UserProfile_telegramUserId_idx"
    ON "UserProfile"("telegramUserId");

-- Create table for mission progress
CREATE TABLE IF NOT EXISTS "UserMission" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userProfileId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "xpEarned" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "UserMission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserMission_userProfileId_missionId_category_key"
    ON "UserMission"("userProfileId", "missionId", "category");

CREATE INDEX IF NOT EXISTS "UserMission_userProfileId_completedAt_idx"
    ON "UserMission"("userProfileId", "completedAt");

-- Create table for achievements
CREATE TABLE IF NOT EXISTS "UserAchievement" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userProfileId" TEXT NOT NULL,
    "achievementId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UserAchievement_userProfileId_achievementId_key"
    ON "UserAchievement"("userProfileId", "achievementId");

CREATE INDEX IF NOT EXISTS "UserAchievement_userProfileId_unlockedAt_idx"
    ON "UserAchievement"("userProfileId", "unlockedAt");

-- Ensure foreign keys to user profiles exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserMission_userProfileId_fkey'
  ) THEN
    ALTER TABLE "UserMission"
      ADD CONSTRAINT "UserMission_userProfileId_fkey"
      FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'UserAchievement_userProfileId_fkey'
  ) THEN
    ALTER TABLE "UserAchievement"
      ADD CONSTRAINT "UserAchievement_userProfileId_fkey"
      FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;