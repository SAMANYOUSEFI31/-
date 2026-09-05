import {
  loadLocalStore,
  saveLocalStore,
  memoryStore,
  ensureDefaultAdminAndUsers,
  setPrismaState,
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

export let prisma: any = null;
export let isPrismaAvailable = false;
const isOnVercel = Boolean(process.env.VERCEL);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
        setPrismaState(null, false);
        if (attempt < 2) await wait(300);
      }
    }
  } else {
    console.log('[Database] Running in self-hosted persistent file/memory database mode.');
  }

  // Fallback to local memory / tmp file store if Prisma is not connected
  if (!isPrismaAvailable) {
    setPrismaState(null, false);
    try { loadLocalStore(); } catch {}
    if (allowTestShortcuts()) {
      ensureDefaultAdminAndUsers();
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

export {
  memoryStore,
  saveLocalStore,
  loadLocalStore,
  ensureDefaultAdminAndUsers,
  setPrismaState,
  ConcurrencyConflictError
} from './base.js';
export type { DBSubscriptionStatus, DBSubscription } from './base.js';

export * from './users.js';
export * from './cycles.js';
export * from './logs.js';
export * from './subscriptions.js';
export * from './otp.js';
export * from '../plans.js';
