-- CreateTable: TabchiRecord for cross-group spam bot tracking
CREATE TABLE "TabchiRecord" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "username" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "detectionType" TEXT NOT NULL,
    "confidence" INTEGER NOT NULL DEFAULT 50,
    "groupsAffected" INTEGER NOT NULL DEFAULT 1,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedBy" TEXT,
    "metadata" JSONB,

    CONSTRAINT "TabchiRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable: TabchiWhitelist for users that should never be flagged
CREATE TABLE "TabchiWhitelist" (
    "id" TEXT NOT NULL,
    "telegramUserId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "groupId" TEXT,
    "reason" TEXT,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TabchiWhitelist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TabchiRecord_telegramUserId_key" ON "TabchiRecord"("telegramUserId");
CREATE INDEX "TabchiRecord_detectedAt_idx" ON "TabchiRecord"("detectedAt");
CREATE INDEX "TabchiRecord_confidence_idx" ON "TabchiRecord"("confidence");
CREATE INDEX "TabchiRecord_removedAt_idx" ON "TabchiRecord"("removedAt");

CREATE UNIQUE INDEX "TabchiWhitelist_telegramUserId_key" ON "TabchiWhitelist"("telegramUserId");
CREATE INDEX "TabchiWhitelist_telegramUserId_idx" ON "TabchiWhitelist"("telegramUserId");
CREATE INDEX "TabchiWhitelist_groupId_idx" ON "TabchiWhitelist"("groupId");
