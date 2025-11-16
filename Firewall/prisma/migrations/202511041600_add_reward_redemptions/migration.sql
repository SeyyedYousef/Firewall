-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateTable
CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "userProfileId" TEXT NOT NULL,
    "rewardId" TEXT NOT NULL,
    "cost" INTEGER NOT NULL DEFAULT 0,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    CONSTRAINT "RewardRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RewardRedemption_userProfileId_redeemedAt_idx" ON "RewardRedemption"("userProfileId", "redeemedAt");

-- AddForeignKey
ALTER TABLE "RewardRedemption"
  ADD CONSTRAINT "RewardRedemption_userProfileId_fkey"
  FOREIGN KEY ("userProfileId") REFERENCES "UserProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
