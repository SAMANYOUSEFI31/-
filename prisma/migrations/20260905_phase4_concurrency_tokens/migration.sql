-- Non-destructive forward-only migration for Phase 4: Multi-device Conflict Safety
-- Adds opaque concurrency tokens (monotonic integer revisions) to Cycle and DailyLog models
-- Defaults all existing and new records safely to 1

-- 1. Add revision column to Cycle (defaults existing records to 1)
ALTER TABLE "Cycle" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

-- 2. Add revision column to DailyLog (defaults existing records to 1)
ALTER TABLE "DailyLog" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 1;

-- 3. Composite performance indexes for conditional concurrency updates
CREATE INDEX IF NOT EXISTS "Cycle_id_userId_revision_idx" ON "Cycle"("id", "userId", "revision");
CREATE INDEX IF NOT EXISTS "DailyLog_id_userId_revision_idx" ON "DailyLog"("id", "userId", "revision");
