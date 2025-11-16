-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Group" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "telegramChatId" TEXT NOT NULL,
    "inviteLink" TEXT,
    "language" TEXT,
    "status" TEXT NOT NULL,
    "creditBalance" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "ownerId" TEXT,
    "banSettings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Group_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GroupAdmin" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GroupAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirewallRule" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "pattern" TEXT,
    "action" TEXT,
    "severity" INTEGER NOT NULL DEFAULT 1,
    "schedule" JSONB,
    "metadata" JSONB,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "matchAllConditions" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB,
    "actions" JSONB,
    "escalation" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FirewallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleAudit" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "ruleId" TEXT,
    "offenderId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RuleAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModerationAction" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "severity" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModerationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipEvent" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StarsWallet" (
    "id" TEXT NOT NULL,
    "groupId" TEXT,
    "ownerId" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'stars',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StarsWallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StarTransaction" (
    "id" TEXT NOT NULL,
    "walletId" TEXT NOT NULL,
    "groupId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "reference" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "externalId" TEXT,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "StarTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Giveaway" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT,
    "groupId" TEXT,
    "fundingTransactionId" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "seed" TEXT NOT NULL,
    "planId" TEXT,
    "prizeDays" INTEGER NOT NULL,
    "winnersCount" INTEGER NOT NULL,
    "pricePerWinner" INTEGER NOT NULL,
    "totalCost" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "validation" JSONB,
    "refundPolicy" JSONB,
    "requirements" JSONB,
    "analytics" JSONB,
    "minParticipants" INTEGER NOT NULL DEFAULT 0,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Giveaway_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayParticipant" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "userId" TEXT,
    "telegramId" TEXT NOT NULL,
    "username" TEXT,
    "displayName" TEXT,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'validated',
    "accountAgeDays" INTEGER,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "sourceIp" TEXT,
    "metadata" JSONB,

    CONSTRAINT "GiveawayParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GiveawayWinner" (
    "id" TEXT NOT NULL,
    "giveawayId" TEXT NOT NULL,
    "participantId" TEXT,
    "telegramId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "metadata" JSONB,

    CONSTRAINT "GiveawayWinner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoSlide" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "subtitle" TEXT,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "thumbnailStorageKey" TEXT,
    "storageKey" TEXT,
    "originalFileId" TEXT,
    "contentType" TEXT,
    "fileSize" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "checksum" TEXT,
    "linkUrl" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "accentColor" TEXT DEFAULT '#0f172a',
    "ctaLabel" TEXT,
    "ctaLink" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "abTestGroupId" TEXT,
    "variant" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "totalViewDurationMs" BIGINT NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "analytics" JSONB,
    "metadata" JSONB,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoSlide_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoSlideAnalytics" (
    "id" TEXT NOT NULL,
    "slideId" TEXT NOT NULL,
    "bucket" TIMESTAMP(3) NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "totalViewDurationMs" BIGINT NOT NULL DEFAULT 0,
    "bounces" INTEGER NOT NULL DEFAULT 0,
    "segment" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromoSlideAnalytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PanelBan" (
    "id" TEXT NOT NULL,
    "telegramId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "PanelBan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_telegramId_key" ON "User"("telegramId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "Group_telegramChatId_key" ON "Group"("telegramChatId");

-- CreateIndex
CREATE INDEX "Group_ownerId_idx" ON "Group"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "GroupAdmin_groupId_userId_key" ON "GroupAdmin"("groupId", "userId");

-- CreateIndex
CREATE INDEX "FirewallRule_groupId_idx" ON "FirewallRule"("groupId");

-- CreateIndex
CREATE INDEX "RuleAudit_groupId_createdAt_idx" ON "RuleAudit"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "ModerationAction_groupId_createdAt_idx" ON "ModerationAction"("groupId", "createdAt");

-- CreateIndex
CREATE INDEX "MembershipEvent_groupId_createdAt_idx" ON "MembershipEvent"("groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "StarsWallet_groupId_key" ON "StarsWallet"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "StarsWallet_ownerId_key" ON "StarsWallet"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "StarTransaction_reference_key" ON "StarTransaction"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "StarTransaction_externalId_key" ON "StarTransaction"("externalId");

-- CreateIndex
CREATE INDEX "StarTransaction_walletId_createdAt_idx" ON "StarTransaction"("walletId", "createdAt");

-- CreateIndex
CREATE INDEX "StarTransaction_status_createdAt_idx" ON "StarTransaction"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Giveaway_ownerId_idx" ON "Giveaway"("ownerId");

-- CreateIndex
CREATE INDEX "Giveaway_groupId_idx" ON "Giveaway"("groupId");

-- CreateIndex
CREATE INDEX "Giveaway_status_endsAt_idx" ON "Giveaway"("status", "endsAt");

-- CreateIndex
CREATE INDEX "GiveawayParticipant_giveawayId_status_idx" ON "GiveawayParticipant"("giveawayId", "status");

-- CreateIndex
CREATE INDEX "GiveawayParticipant_giveawayId_sourceIp_idx" ON "GiveawayParticipant"("giveawayId", "sourceIp");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayParticipant_giveawayId_telegramId_key" ON "GiveawayParticipant"("giveawayId", "telegramId");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayWinner_code_key" ON "GiveawayWinner"("code");

-- CreateIndex
CREATE INDEX "GiveawayWinner_giveawayId_idx" ON "GiveawayWinner"("giveawayId");

-- CreateIndex
CREATE UNIQUE INDEX "GiveawayWinner_participantId_key" ON "GiveawayWinner"("participantId");

-- CreateIndex
CREATE UNIQUE INDEX "BotSetting_key_key" ON "BotSetting"("key");

-- CreateIndex
CREATE INDEX "PromoSlide_active_startsAt_endsAt_idx" ON "PromoSlide"("active", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "PromoSlide_abTestGroupId_idx" ON "PromoSlide"("abTestGroupId");

-- CreateIndex
CREATE INDEX "PromoSlideAnalytics_bucket_idx" ON "PromoSlideAnalytics"("bucket");

-- CreateIndex
CREATE UNIQUE INDEX "PromoSlideAnalytics_slideId_bucket_segment_key" ON "PromoSlideAnalytics"("slideId", "bucket", "segment");

-- CreateIndex
CREATE INDEX "Report_groupId_createdAt_idx" ON "Report"("groupId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PanelBan_telegramId_key" ON "PanelBan"("telegramId");

-- CreateIndex
CREATE INDEX "PanelBan_telegramId_idx" ON "PanelBan"("telegramId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAdmin" ADD CONSTRAINT "GroupAdmin_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GroupAdmin" ADD CONSTRAINT "GroupAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirewallRule" ADD CONSTRAINT "FirewallRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleAudit" ADD CONSTRAINT "RuleAudit_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleAudit" ADD CONSTRAINT "RuleAudit_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "FirewallRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipEvent" ADD CONSTRAINT "MembershipEvent_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarsWallet" ADD CONSTRAINT "StarsWallet_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarsWallet" ADD CONSTRAINT "StarsWallet_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarTransaction" ADD CONSTRAINT "StarTransaction_walletId_fkey" FOREIGN KEY ("walletId") REFERENCES "StarsWallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarTransaction" ADD CONSTRAINT "StarTransaction_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StarTransaction" ADD CONSTRAINT "StarTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Giveaway" ADD CONSTRAINT "Giveaway_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Giveaway" ADD CONSTRAINT "Giveaway_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Giveaway" ADD CONSTRAINT "Giveaway_fundingTransactionId_fkey" FOREIGN KEY ("fundingTransactionId") REFERENCES "StarTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayParticipant" ADD CONSTRAINT "GiveawayParticipant_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayParticipant" ADD CONSTRAINT "GiveawayParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayWinner" ADD CONSTRAINT "GiveawayWinner_giveawayId_fkey" FOREIGN KEY ("giveawayId") REFERENCES "Giveaway"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GiveawayWinner" ADD CONSTRAINT "GiveawayWinner_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "GiveawayParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoSlideAnalytics" ADD CONSTRAINT "PromoSlideAnalytics_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "PromoSlide"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;

