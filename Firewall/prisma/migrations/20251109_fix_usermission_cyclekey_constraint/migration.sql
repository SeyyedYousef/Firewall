-- Ensure the UserMission unique constraint includes cycleKey so recurring missions can be
-- completed in multiple cycles without violating the legacy (profileId, missionId, category) key.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'UserMission_userProfileId_missionId_category_key'
      AND table_name = 'UserMission'
  ) THEN
    ALTER TABLE "UserMission"
      DROP CONSTRAINT "UserMission_userProfileId_missionId_category_key";
  END IF;
END
$$;

-- Drop any leftover index that might have been created without cycle key.
DROP INDEX IF EXISTS "UserMission_userProfileId_missionId_category_key";

-- Re-create the intended unique index with cycle key included.
DROP INDEX IF EXISTS "UserMission_userProfileId_missionId_category_cycleKey_key";
CREATE UNIQUE INDEX "UserMission_userProfileId_missionId_category_cycleKey_key"
  ON "UserMission"("userProfileId", "missionId", "category", "cycleKey");
