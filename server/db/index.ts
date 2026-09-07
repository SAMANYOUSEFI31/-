import {
  loadLocalStore as baseLoadLocalStore,
  saveLocalStore as baseSaveLocalStore,
  memoryStore,
  ensureDefaultAdminAndUsers as baseEnsureDefaultAdminAndUsers,
  setPrismaState as baseSetPrismaState,
  harmonizeDatabaseEnv
} from './base.js';
import {
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  SUPER_ADMIN_NAME,
  hashPassword,
  allowTestShortcuts,
  isProduction
} from '../security.js';

import * as usersModule from './users.js';
import * as cyclesModule from './cycles.js';
import * as logsModule from './logs.js';
import * as subsModule from './subscriptions.js';
import * as otpModule from './otp.js';

export let prisma: any = null;
export let isPrismaAvailable = false;
const isOnVercel = Boolean(process.env.VERCEL);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function setPrismaState(client: any, available: boolean): void {
  prisma = client;
  isPrismaAvailable = available;
  baseSetPrismaState(client, available);
}

/**
 * Validates whether authoritative database persistence is ready.
 * In production: strictly requires connected PostgreSQL Prisma instance.
 * In dev/test: local file / memory persistence is acceptable.
 */
export function isDatabaseReady(): boolean {
  if (isProduction()) {
    return Boolean(isPrismaAvailable && prisma);
  }
  return true;
}

/**
 * Asserts that database persistence is available in the current environment.
 * Throws sanitized 503 SERVICE_UNAVAILABLE error in production if Prisma is down.
 */
export function assertPersistenceAvailable(operationName?: string): void {
  if (isProduction() && (!isPrismaAvailable || !prisma)) {
    const err: any = new Error(
      `Database persistence unavailable in production${operationName ? ` (${operationName})` : ''}. Authoritative PostgreSQL datasource required.`
    );
    err.code = 'SERVICE_UNAVAILABLE';
    err.statusCode = 503;
    throw err;
  }
}

export async function ensurePrismaAdmin(): Promise<void> {
  if (!isPrismaAvailable || !prisma) return;
  if (!SUPER_ADMIN_PASS || String(SUPER_ADMIN_PASS).trim().length < 8) return;

  try {
    const adminHashedPass = hashPassword(SUPER_ADMIN_PASS);
    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { id: 'admin-master-001' },
          ...(SUPER_ADMIN_PHONE ? [{ phoneNumber: SUPER_ADMIN_PHONE }] : []),
          ...(SUPER_ADMIN_EMAIL ? [{ email: SUPER_ADMIN_EMAIL }] : [])
        ]
      }
    });

    const now = new Date();
    const nextYear = new Date(Date.now() + 365 * 86400000);

    if (!existing) {
      await prisma.user.create({
        data: {
          id: 'admin-master-001',
          email: SUPER_ADMIN_EMAIL || null,
          phoneNumber: SUPER_ADMIN_PHONE || null,
          name: SUPER_ADMIN_NAME,
          passwordHash: adminHashedPass,
          tier: 'vip_samurai',
          isVip: true,
          isAdmin: true,
          nightOwlCutoffHour: 4,
          accentTheme: 'amber',
          vipSince: now,
          vipExpiresAt: nextYear,
          paymentRefId: 'REF-ADMIN-MASTER-001'
        }
      });
      console.log('[Database] Seeded Super Admin user in PostgreSQL datasource.');
    } else {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash: adminHashedPass,
          isAdmin: true,
          isVip: true,
          tier: 'vip_samurai',
          name: SUPER_ADMIN_NAME,
          vipExpiresAt: existing.vipExpiresAt || nextYear
        }
      });
    }
  } catch (err: any) {
    console.warn('[Database] ensurePrismaAdmin notice:', err?.message || err);
  }
}

export async function initializeDatabase(): Promise<void> {
  const dbConnectionString = harmonizeDatabaseEnv();

  const isLocalhost =
    !!dbConnectionString &&
    (dbConnectionString.includes('localhost') || dbConnectionString.includes('127.0.0.1'));

  // On Vercel / serverless, never attempt to connect to localhost Postgres
  if (dbConnectionString && !(isOnVercel && isLocalhost)) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const mod = await import('@prisma/client');
        prisma = new mod.PrismaClient({
          log: ['error', 'warn']
        });
        await prisma.$connect();
        isPrismaAvailable = true;
        setPrismaState(prisma, true);
        console.log('[Database] PostgreSQL connected via Prisma datasource.');
        
        // Ensure master admin is configured in PostgreSQL
        await ensurePrismaAdmin();
        break;
      } catch (err: any) {
        console.warn(`[Database] Prisma connection attempt ${attempt} notice:`, err?.message || err);
        if (prisma) {
          try { await prisma.$disconnect(); } catch {}
          prisma = null;
        }
        isPrismaAvailable = false;
        setPrismaState(null, false);
        if (attempt < 2) await wait(300);
      }
    }
  } else {
    if (!isProduction()) {
      console.log('[Database] Running in self-hosted persistent file/memory database mode.');
    }
  }

  // Fallback handling
  if (!isPrismaAvailable) {
    setPrismaState(null, false);
    if (isProduction()) {
      // In production: NEVER silently fall back to memory or local JSON storage.
      throw new Error('Production database initialization failed: PostgreSQL datasource required.');
    }
    try { baseLoadLocalStore(); } catch {}
    if (allowTestShortcuts()) {
      baseEnsureDefaultAdminAndUsers();
    }
  }
}

export async function closeDatabase(): Promise<void> {
  if (prisma) {
    try { await prisma.$disconnect(); } catch {}
    prisma = null;
    isPrismaAvailable = false;
    setPrismaState(null, false);
  }
}

// Local store persistence with production protection
export function saveLocalStore(): void {
  if (isProduction()) {
    return;
  }
  return baseSaveLocalStore();
}

export function loadLocalStore() {
  if (isProduction() && !isPrismaAvailable) {
    return {
      users: [],
      cycles: [],
      dailyLogs: [],
      otpCodes: [],
      subscriptions: []
    };
  }
  return baseLoadLocalStore();
}

export function ensureDefaultAdminAndUsers(): void {
  if (isProduction()) {
    return;
  }
  return baseEnsureDefaultAdminAndUsers();
}

export {
  memoryStore,
  ConcurrencyConflictError,
  PreconditionRequiredError
} from './base.js';
export type { DBSubscriptionStatus, DBSubscription } from './base.js';

// Wrapped database operations ensuring production fail-closed persistence
export const normalizeIdentifier = usersModule.normalizeIdentifier;

export async function findUserById(...args: Parameters<typeof usersModule.findUserById>) {
  assertPersistenceAvailable('findUserById');
  return usersModule.findUserById(...args);
}

export async function findUserByPhoneNumber(...args: Parameters<typeof usersModule.findUserByPhoneNumber>) {
  assertPersistenceAvailable('findUserByPhoneNumber');
  return usersModule.findUserByPhoneNumber(...args);
}

export async function findUserByIdentifier(...args: Parameters<typeof usersModule.findUserByIdentifier>) {
  assertPersistenceAvailable('findUserByIdentifier');
  return usersModule.findUserByIdentifier(...args);
}

export async function createUser(...args: Parameters<typeof usersModule.createUser>) {
  assertPersistenceAvailable('createUser');
  return usersModule.createUser(...args);
}

export async function updateUser(...args: Parameters<typeof usersModule.updateUser>) {
  assertPersistenceAvailable('updateUser');
  return usersModule.updateUser(...args);
}

export async function deleteUser(...args: Parameters<typeof usersModule.deleteUser>) {
  assertPersistenceAvailable('deleteUser');
  return usersModule.deleteUser(...args);
}

export async function adminGetAllUsers(...args: Parameters<typeof usersModule.adminGetAllUsers>) {
  assertPersistenceAvailable('adminGetAllUsers');
  return usersModule.adminGetAllUsers(...args);
}

export async function adminUpdateUser(...args: Parameters<typeof usersModule.adminUpdateUser>) {
  assertPersistenceAvailable('adminUpdateUser');
  return usersModule.adminUpdateUser(...args);
}

export async function adminCreateTestUser(...args: Parameters<typeof usersModule.adminCreateTestUser>) {
  assertPersistenceAvailable('adminCreateTestUser');
  return usersModule.adminCreateTestUser(...args);
}

// Cycles
export async function getUserCycles(...args: Parameters<typeof cyclesModule.getUserCycles>) {
  assertPersistenceAvailable('getUserCycles');
  return cyclesModule.getUserCycles(...args);
}

export async function getCycleById(...args: Parameters<typeof cyclesModule.getCycleById>) {
  assertPersistenceAvailable('getCycleById');
  return cyclesModule.getCycleById(...args);
}

export async function createCycle(...args: Parameters<typeof cyclesModule.createCycle>) {
  assertPersistenceAvailable('createCycle');
  return cyclesModule.createCycle(...args);
}

export async function updateCycle(...args: Parameters<typeof cyclesModule.updateCycle>) {
  assertPersistenceAvailable('updateCycle');
  return cyclesModule.updateCycle(...args);
}

export async function archiveCycle(...args: Parameters<typeof cyclesModule.archiveCycle>) {
  assertPersistenceAvailable('archiveCycle');
  return cyclesModule.archiveCycle(...args);
}

export async function restoreCycle(...args: Parameters<typeof cyclesModule.restoreCycle>) {
  assertPersistenceAvailable('restoreCycle');
  return cyclesModule.restoreCycle(...args);
}

export async function deleteCycle(...args: Parameters<typeof cyclesModule.deleteCycle>) {
  assertPersistenceAvailable('deleteCycle');
  return cyclesModule.deleteCycle(...args);
}

// Logs
export async function getUserDailyLogs(...args: Parameters<typeof logsModule.getUserDailyLogs>) {
  assertPersistenceAvailable('getUserDailyLogs');
  return logsModule.getUserDailyLogs(...args);
}

export async function getDailyLogById(...args: Parameters<typeof logsModule.getDailyLogById>) {
  assertPersistenceAvailable('getDailyLogById');
  return logsModule.getDailyLogById(...args);
}

export async function getDailyLogByDate(...args: Parameters<typeof logsModule.getDailyLogByDate>) {
  assertPersistenceAvailable('getDailyLogByDate');
  return logsModule.getDailyLogByDate(...args);
}

export async function upsertDailyLog(...args: Parameters<typeof logsModule.upsertDailyLog>) {
  assertPersistenceAvailable('upsertDailyLog');
  return logsModule.upsertDailyLog(...args);
}

export async function updateDailyLog(...args: Parameters<typeof logsModule.updateDailyLog>) {
  assertPersistenceAvailable('updateDailyLog');
  return logsModule.updateDailyLog(...args);
}

export async function deleteDailyLog(...args: Parameters<typeof logsModule.deleteDailyLog>) {
  assertPersistenceAvailable('deleteDailyLog');
  return logsModule.deleteDailyLog(...args);
}

export async function deleteDailyLogByDate(...args: Parameters<typeof logsModule.deleteDailyLogByDate>) {
  assertPersistenceAvailable('deleteDailyLogByDate');
  return logsModule.deleteDailyLogByDate(...args);
}

export const clearDailyLogOperationIds = logsModule.clearDailyLogOperationIds;

// Subscriptions
export const mapPrismaSubscription = subsModule.mapPrismaSubscription;

export async function createSubscriptionRecord(...args: Parameters<typeof subsModule.createSubscriptionRecord>) {
  assertPersistenceAvailable('createSubscriptionRecord');
  return subsModule.createSubscriptionRecord(...args);
}

export async function completeSubscription(...args: Parameters<typeof subsModule.completeSubscription>) {
  assertPersistenceAvailable('completeSubscription');
  return subsModule.completeSubscription(...args);
}

export async function markSubscriptionFailed(...args: Parameters<typeof subsModule.markSubscriptionFailed>) {
  assertPersistenceAvailable('markSubscriptionFailed');
  return subsModule.markSubscriptionFailed(...args);
}

export async function findSubscriptionByAuthority(...args: Parameters<typeof subsModule.findSubscriptionByAuthority>) {
  assertPersistenceAvailable('findSubscriptionByAuthority');
  return subsModule.findSubscriptionByAuthority(...args);
}

export async function getUserSubscriptions(...args: Parameters<typeof subsModule.getUserSubscriptions>) {
  assertPersistenceAvailable('getUserSubscriptions');
  return subsModule.getUserSubscriptions(...args);
}

export async function adminGetAllSubscriptions(...args: Parameters<typeof subsModule.adminGetAllSubscriptions>) {
  assertPersistenceAvailable('adminGetAllSubscriptions');
  return subsModule.adminGetAllSubscriptions(...args);
}

export async function adminGetOverviewStats(...args: Parameters<typeof subsModule.adminGetOverviewStats>) {
  assertPersistenceAvailable('adminGetOverviewStats');
  return subsModule.adminGetOverviewStats(...args);
}

// OTP
export async function findActiveOtpChallenge(...args: Parameters<typeof otpModule.findActiveOtpChallenge>) {
  assertPersistenceAvailable('findActiveOtpChallenge');
  return otpModule.findActiveOtpChallenge(...args);
}

export async function findLatestOtpChallenge(...args: Parameters<typeof otpModule.findLatestOtpChallenge>) {
  assertPersistenceAvailable('findLatestOtpChallenge');
  return otpModule.findLatestOtpChallenge(...args);
}

export async function createOtpRecord(...args: Parameters<typeof otpModule.createOtpRecord>) {
  assertPersistenceAvailable('createOtpRecord');
  return otpModule.createOtpRecord(...args);
}

export async function updateOtpRecord(...args: Parameters<typeof otpModule.updateOtpRecord>) {
  assertPersistenceAvailable('updateOtpRecord');
  return otpModule.updateOtpRecord(...args);
}

export async function removeOtpRecord(...args: Parameters<typeof otpModule.removeOtpRecord>) {
  assertPersistenceAvailable('removeOtpRecord');
  return otpModule.removeOtpRecord(...args);
}

export * from '../plans.js';
