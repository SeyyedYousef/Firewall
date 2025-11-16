-- Add preferences column to UserProfile table
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "preferences" JSONB;

-- Create index for preferences queries
CREATE INDEX IF NOT EXISTS "UserProfile_preferences_idx" ON "UserProfile" USING GIN ("preferences");
