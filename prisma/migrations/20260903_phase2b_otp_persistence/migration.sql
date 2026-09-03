-- Non-destructive forward-only migration for Phase 2B: Phone-First Authentication Foundation
-- Adds tokenVersion for server-authoritative session invalidation on password reset
-- Extends OtpCode with full persistent challenge fields (codeHash, purpose, attempts, cooldown, consumedAt)
-- Relaxes legacy NOT NULL constraint on "code" column to ensure modern codeHash-only inserts succeed

-- 1. User tokenVersion (defaults existing and new users safely to 0)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- 2. OtpCode persistent challenge attributes
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'PHONE_REGISTRATION';
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "codeHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "consumedAt" TIMESTAMP(3);
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Legacy OtpCode "code" column compatibility:
-- Drop NOT NULL constraint on legacy "code" column if it exists so inserts without plaintext code succeed
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_name = 'OtpCode' AND column_name = 'code'
    ) THEN
        ALTER TABLE "OtpCode" ALTER COLUMN "code" DROP NOT NULL;
    END IF;
END $$;

-- 4. Safely invalidate any pre-migration active OTP records (mark verified and consumed)
-- Old plaintext OTP values are never hashed or reused; users request a fresh challenge
UPDATE "OtpCode"
SET "verified" = true,
    "consumedAt" = COALESCE("consumedAt", CURRENT_TIMESTAMP)
WHERE "codeHash" = '' OR "codeHash" IS NULL;

-- 5. Composite performance & lookup indexes
CREATE INDEX IF NOT EXISTS "OtpCode_identifier_purpose_idx" ON "OtpCode"("identifier", "purpose");
CREATE INDEX IF NOT EXISTS "OtpCode_identifier_purpose_verified_idx" ON "OtpCode"("identifier", "purpose", "verified");

