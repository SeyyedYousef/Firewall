-- Fix for missing preferences column in UserProfile table
-- Run this SQL directly on your database or use: npx prisma db execute --file ./fix-database.sql

ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "preferences" JSONB;

-- Create index for better performance
CREATE INDEX IF NOT EXISTS "UserProfile_preferences_idx" ON "UserProfile" USING GIN ("preferences");
