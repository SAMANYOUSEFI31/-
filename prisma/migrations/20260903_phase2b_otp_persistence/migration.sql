-- Non-destructive migration for Phase 2B: Phone-First Authentication Foundation
-- Adds tokenVersion for server-authoritative session invalidation on password reset
-- Extends OtpCode with full persistent challenge fields (codeHash, purpose, attempts, cooldown, consumedAt)

-- 1. User tokenVersion
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;

-- 2. OtpCode persistent challenge attributes
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "purpose" TEXT NOT NULL DEFAULT 'PHONE_REGISTRATION';
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "codeHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "consumedAt" TIMESTAMP(3);
ALTER TABLE "OtpCode" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 3. Composite performance & lookup indexes
CREATE INDEX IF NOT EXISTS "OtpCode_identifier_purpose_idx" ON "OtpCode"("identifier", "purpose");
CREATE INDEX IF NOT EXISTS "OtpCode_identifier_purpose_verified_idx" ON "OtpCode"("identifier", "purpose", "verified");
