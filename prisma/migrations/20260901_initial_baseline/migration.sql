-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('FREE', 'VIP', 'ADMIN');

-- CreateEnum
CREATE TYPE "UserTier" AS ENUM ('FREE', 'VIP', 'MASTER');

-- CreateEnum
CREATE TYPE "DayStatus" AS ENUM ('STANDARD', 'FROZEN', 'BURNED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phoneNumber" TEXT,
    "name" TEXT,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'FREE',
    "tier" TEXT NOT NULL DEFAULT 'ronin_free',
    "isVip" BOOLEAN NOT NULL DEFAULT false,
    "vipSince" TIMESTAMP(3),
    "vipExpiresAt" TIMESTAMP(3),
    "paymentRefId" TEXT,
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "nightOwlCutoffHour" INTEGER NOT NULL DEFAULT 4,
    "accentTheme" TEXT NOT NULL DEFAULT 'amber',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cycle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT NOT NULL,
    "targetTheme" TEXT,
    "inheritedStreak" INTEGER NOT NULL DEFAULT 0,
    "rules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "reportRead" BOOLEAN NOT NULL DEFAULT false,
    "verdict" JSONB,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "status" "DayStatus" NOT NULL DEFAULT 'STANDARD',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "wakeUp" BOOLEAN NOT NULL DEFAULT false,
    "workout" BOOLEAN NOT NULL DEFAULT false,
    "study" BOOLEAN NOT NULL DEFAULT false,
    "journal" BOOLEAN NOT NULL DEFAULT false,
    "hardTask" BOOLEAN NOT NULL DEFAULT false,
    "specialMission" BOOLEAN NOT NULL DEFAULT false,
    "failureReason" TEXT,
    "failureTime" TEXT,
    "autopsyNotes" TEXT,
    "countermeasure" TEXT,
    "aiFeedback" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'PHONE_REGISTRATION',
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "lastSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "authority" TEXT NOT NULL,
    "refId" TEXT,
    "cardPan" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'PENDING',
    "description" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_phoneNumber_idx" ON "User"("phoneNumber");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isVip_idx" ON "User"("isVip");

-- CreateIndex
CREATE INDEX "Cycle_userId_idx" ON "Cycle"("userId");

-- CreateIndex
CREATE INDEX "Cycle_userId_isArchived_idx" ON "Cycle"("userId", "isArchived");

-- CreateIndex
CREATE INDEX "Cycle_userId_startDate_idx" ON "Cycle"("userId", "startDate");

-- CreateIndex
CREATE INDEX "Cycle_id_userId_revision_idx" ON "Cycle"("id", "userId", "revision");

-- CreateIndex
CREATE INDEX "DailyLog_userId_idx" ON "DailyLog"("userId");

-- CreateIndex
CREATE INDEX "DailyLog_cycleId_idx" ON "DailyLog"("cycleId");

-- CreateIndex
CREATE INDEX "DailyLog_userId_date_idx" ON "DailyLog"("userId", "date");

-- CreateIndex
CREATE INDEX "DailyLog_userId_cycleId_idx" ON "DailyLog"("userId", "cycleId");

-- CreateIndex
CREATE INDEX "DailyLog_id_userId_revision_idx" ON "DailyLog"("id", "userId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_cycleId_date_key" ON "DailyLog"("cycleId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "DailyLog_userId_date_key" ON "DailyLog"("userId", "date");

-- CreateIndex
CREATE INDEX "OtpCode_identifier_idx" ON "OtpCode"("identifier");

-- CreateIndex
CREATE INDEX "OtpCode_identifier_verified_idx" ON "OtpCode"("identifier", "verified");

-- CreateIndex
CREATE INDEX "OtpCode_identifier_purpose_idx" ON "OtpCode"("identifier", "purpose");

-- CreateIndex
CREATE INDEX "OtpCode_identifier_purpose_verified_idx" ON "OtpCode"("identifier", "purpose", "verified");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_authority_key" ON "Subscription"("authority");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_authority_idx" ON "Subscription"("authority");

-- CreateIndex
CREATE INDEX "Subscription_userId_status_idx" ON "Subscription"("userId", "status");

-- AddForeignKey
ALTER TABLE "Cycle" ADD CONSTRAINT "Cycle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyLog" ADD CONSTRAINT "DailyLog_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "Cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

