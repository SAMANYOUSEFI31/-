import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBSubscription,
  DBSubscriptionStatus,
  DBUser
} from './base.js';
import { findUserById } from './users.js';
import { getPlanById } from '../plans.js';
import { calculateRenewalExpiration } from '../payment/renewal.js';
import { validateStateTransition } from '../payment/transitions.js';

// -------------------------------------------------------------
// Helper Mappers
// -------------------------------------------------------------
export function mapPrismaSubscription(item: any): DBSubscription {
  return {
    id: item.id,
    userId: item.userId,
    planId: item.planId,
    amount: item.amount,
    authority: item.authority,
    refId: item.refId ?? null,
    cardPan: item.cardPan ?? null,
    status: (item.status ? String(item.status).toUpperCase() : 'PENDING') as DBSubscriptionStatus,
    description: item.description ?? null,
    expiresAt: item.expiresAt instanceof Date ? item.expiresAt.toISOString() : (item.expiresAt ?? null),
    createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : (item.createdAt ?? new Date().toISOString()),
    updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : (item.updatedAt ?? new Date().toISOString())
  };
}

export function mapPrismaUser(u: any): DBUser {
  return {
    id: u.id,
    name: u.name ?? null,
    email: u.email ?? null,
    phoneNumber: u.phoneNumber ?? null,
    passwordHash: u.passwordHash ?? null,
    tier: u.tier || 'free',
    isVip: Boolean(u.isVip),
    isAdmin: Boolean(u.isAdmin),
    tokenVersion: u.tokenVersion ?? 0,
    vipSince: u.vipSince instanceof Date ? u.vipSince.toISOString() : (u.vipSince ?? null),
    vipExpiresAt: u.vipExpiresAt instanceof Date ? u.vipExpiresAt.toISOString() : (u.vipExpiresAt ?? null),
    paymentRefId: u.paymentRefId ?? null,
    nightOwlCutoffHour: u.nightOwlCutoffHour ?? 4,
    accentTheme: u.accentTheme ?? 'amber',
    createdAt: u.createdAt instanceof Date ? u.createdAt.toISOString() : (u.createdAt ?? new Date().toISOString()),
    updatedAt: u.updatedAt instanceof Date ? u.updatedAt.toISOString() : (u.updatedAt ?? new Date().toISOString())
  };
}

// -------------------------------------------------------------
// Subscriptions & Payment Transactions (Phase 5A Core Authority)
// -------------------------------------------------------------

/**
 * Creates a new PENDING subscription record.
 * When Prisma is active, Prisma is the sole financial authority: failures propagate
 * and never silently fallback to memoryStore.
 */
export async function createSubscriptionRecord(data: {
  userId: string;
  planId: string;
  amount: number;
  authority: string;
  description?: string;
}): Promise<DBSubscription> {
  const now = new Date().toISOString();
  const newSub: DBSubscription = {
    id: `sub-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId: data.userId,
    planId: data.planId,
    amount: data.amount,
    authority: data.authority,
    refId: null,
    cardPan: null,
    status: 'PENDING',
    description: data.description || 'اشتراک ویژه سامورایی دیسیپلین',
    expiresAt: null,
    createdAt: now,
    updatedAt: now
  };

  if (isPrismaAvailable && prisma) {
    // Work Package 2: Prisma is the sole financial authority. Errors must propagate.
    const created = await prisma.subscription.create({
      data: {
        id: newSub.id,
        userId: newSub.userId,
        planId: newSub.planId,
        amount: newSub.amount,
        authority: newSub.authority,
        refId: newSub.refId,
        cardPan: newSub.cardPan,
        status: newSub.status,
        description: newSub.description,
        expiresAt: newSub.expiresAt ? new Date(newSub.expiresAt) : null
      }
    });
    return mapPrismaSubscription(created);
  }

  // Local fallback mode only
  memoryStore.subscriptions.push(newSub);
  saveLocalStore();
  return newSub;
}

/**
 * Completes a subscription and atomically activates VIP entitlement for the target user.
 * Phase 5A Work Package 4 & 5:
 * - Prisma path: completed in a single ACID transaction via prisma.$transaction.
 * - Idempotent: repeated verify returns confirmed result without re-extending VIP or duplicate side effects.
 * - Concurrency safe: only winning conditional transition applies side effects.
 * - Local fallback: atomic all-or-nothing rollback on any failure.
 */
export async function completeSubscription(
  authority: string,
  refId: string,
  cardPan: string,
  options?: { expectedUserId?: string }
): Promise<(DBSubscription & { user?: DBUser }) | null> {
  if (isPrismaAvailable && prisma) {
    // Work Package 2 & 4: Atomic completion in single database transaction
    return await prisma.$transaction(async (tx) => {
      const match = await tx.subscription.findUnique({
        where: { authority }
      });

      if (!match) {
        return null;
      }

      if (options?.expectedUserId && match.userId !== options.expectedUserId) {
        const err: any = new Error('شما دسترسی به تایید یا مشاهده تراکنش کاربر دیگری را ندارید.');
        err.code = 'FORBIDDEN';
        throw err;
      }

      const currentStatus = (match.status ? String(match.status).toUpperCase() : 'PENDING') as DBSubscriptionStatus;

      // Idempotency: SUCCESS is terminal; return authoritative record without duplicate extension
      if (currentStatus === 'SUCCESS') {
        const existingUser = await tx.user.findUnique({ where: { id: match.userId } });
        return {
          ...mapPrismaSubscription(match),
          user: existingUser ? mapPrismaUser(existingUser) : undefined
        };
      }

      // Terminal FAILED cannot become SUCCESS
      if (currentStatus === 'FAILED') {
        return null;
      }

      // Atomic conditional update: only transition if still PENDING
      const updateResult = await tx.subscription.updateMany({
        where: { authority, status: 'PENDING' },
        data: {
          status: 'SUCCESS',
          refId,
          cardPan,
          updatedAt: new Date()
        }
      });

      if (updateResult.count === 0) {
        // Concurrency loser: re-check and return authoritative result if winner finished
        const recheck = await tx.subscription.findUnique({ where: { authority } });
        if (recheck && String(recheck.status).toUpperCase() === 'SUCCESS') {
          const u = await tx.user.findUnique({ where: { id: recheck.userId } });
          return {
            ...mapPrismaSubscription(recheck),
            user: u ? mapPrismaUser(u) : undefined
          };
        }
        return null;
      }

      // Calculate authoritative renewal expiration (Work Package 9)
      const plan = getPlanById(match.planId);
      const durationDays = plan?.durationDays ?? (plan?.durationMonths ? plan.durationMonths * 30 : 365);
      const targetTier = plan?.tier || 'vip_samurai';

      const targetUser = await tx.user.findUnique({ where: { id: match.userId } });
      const now = new Date();
      const calculatedExpiresAt = calculateRenewalExpiration(targetUser?.vipExpiresAt, durationDays, now);

      // Persist calculated expiration on subscription
      const updatedSub = await tx.subscription.update({
        where: { authority },
        data: {
          expiresAt: calculatedExpiresAt
        }
      });

      // Atomically elevate user VIP in the same transaction
      const updatedUser = await tx.user.update({
        where: { id: match.userId },
        data: {
          isVip: true,
          tier: targetTier,
          vipSince: targetUser?.vipSince || now,
          vipExpiresAt: calculatedExpiresAt,
          paymentRefId: refId
        }
      });

      return {
        ...mapPrismaSubscription(updatedSub),
        user: mapPrismaUser(updatedUser)
      };
    });
  }

  // Local fallback mode (atomic all-or-nothing with snapshot rollback)
  const idx = memoryStore.subscriptions.findIndex(s => s.authority === authority);
  if (idx === -1) {
    return null;
  }

  const existing = memoryStore.subscriptions[idx];
  if (options?.expectedUserId && existing.userId !== options.expectedUserId) {
    const err: any = new Error('شما دسترسی به تایید یا مشاهده تراکنش کاربر دیگری را ندارید.');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const currentStatus = (existing.status ? String(existing.status).toUpperCase() : 'PENDING') as DBSubscriptionStatus;

  if (currentStatus === 'SUCCESS') {
    const u = memoryStore.users.find(u => u.id === existing.userId);
    return {
      ...existing,
      status: 'SUCCESS',
      user: u ? { ...u } : undefined
    };
  }

  if (currentStatus === 'FAILED') {
    return null;
  }

  const userIdx = memoryStore.users.findIndex(u => u.id === existing.userId);
  if (userIdx === -1) {
    return null;
  }

  const targetUser = memoryStore.users[userIdx];
  const plan = getPlanById(existing.planId);
  const durationDays = plan?.durationDays ?? (plan?.durationMonths ? plan.durationMonths * 30 : 365);
  const targetTier = plan?.tier || 'vip_samurai';
  const now = new Date();
  const calculatedExpiresAt = calculateRenewalExpiration(targetUser.vipExpiresAt, durationDays, now).toISOString();
  const nowStr = now.toISOString();

  // Snapshot for atomic rollback
  const subSnapshot = { ...memoryStore.subscriptions[idx] };
  const userSnapshot = { ...memoryStore.users[userIdx] };

  try {
    memoryStore.subscriptions[idx] = {
      ...existing,
      status: 'SUCCESS',
      refId,
      cardPan,
      expiresAt: calculatedExpiresAt,
      updatedAt: nowStr
    };

    memoryStore.users[userIdx] = {
      ...targetUser,
      isVip: true,
      tier: targetTier,
      vipSince: targetUser.vipSince || nowStr,
      vipExpiresAt: calculatedExpiresAt,
      paymentRefId: refId,
      updatedAt: nowStr
    };

    saveLocalStore();

    return {
      ...memoryStore.subscriptions[idx],
      user: memoryStore.users[userIdx]
    };
  } catch (error) {
    // Rollback snapshot on failure
    memoryStore.subscriptions[idx] = subSnapshot;
    memoryStore.users[userIdx] = userSnapshot;
    throw error;
  }
}

/**
 * Marks a subscription as FAILED.
 * Terminal idempotency: never downgrades a SUCCESS transaction to FAILED.
 * When Prisma is active, Prisma is the sole authority: failures propagate.
 */
export async function markSubscriptionFailed(
  authority: string,
  reason?: string
): Promise<DBSubscription | null> {
  if (isPrismaAvailable && prisma) {
    const match = await prisma.subscription.findUnique({
      where: { authority }
    });
    if (!match) {
      return null;
    }

    const status = (match.status ? String(match.status).toUpperCase() : 'PENDING') as DBSubscriptionStatus;
    if (status === 'SUCCESS') {
      // Terminal: cannot downgrade SUCCESS to FAILED
      return mapPrismaSubscription(match);
    }
    if (status === 'FAILED') {
      // Idempotent duplicate FAILED
      return mapPrismaSubscription(match);
    }

    const updated = await prisma.subscription.update({
      where: { authority },
      data: {
        status: 'FAILED',
        description: reason ? `[ناموفق] ${reason}` : match.description,
        updatedAt: new Date()
      }
    });
    return mapPrismaSubscription(updated);
  }

  // Local fallback mode
  const idx = memoryStore.subscriptions.findIndex(s => s.authority === authority);
  if (idx === -1) {
    return null;
  }
  const existing = memoryStore.subscriptions[idx];
  const status = (existing.status ? String(existing.status).toUpperCase() : 'PENDING') as DBSubscriptionStatus;
  if (status === 'SUCCESS') {
    return existing;
  }
  if (status === 'FAILED') {
    return existing;
  }

  memoryStore.subscriptions[idx] = {
    ...existing,
    status: 'FAILED',
    description: reason ? `[ناموفق] ${reason}` : existing.description,
    updatedAt: new Date().toISOString()
  };
  saveLocalStore();
  return memoryStore.subscriptions[idx];
}

/**
 * Finds a subscription by authority.
 * When Prisma is active, returns from Prisma or null if not found.
 * Never falls through to memoryStore.
 */
export async function findSubscriptionByAuthority(authority: string): Promise<DBSubscription | null> {
  if (isPrismaAvailable && prisma) {
    const match = await prisma.subscription.findUnique({
      where: { authority }
    });
    return match ? mapPrismaSubscription(match) : null;
  }

  const found = memoryStore.subscriptions.find(s => s.authority === authority);
  return found || null;
}

/**
 * Gets subscriptions belonging to a user.
 * When Prisma is active, queries Prisma directly. Failures propagate.
 */
export async function getUserSubscriptions(userId: string): Promise<DBSubscription[]> {
  if (isPrismaAvailable && prisma) {
    const subs = await prisma.subscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });
    return subs.map(mapPrismaSubscription);
  }

  return memoryStore.subscriptions
    .filter(s => s.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Admin: Get all subscriptions with enriched user details.
 */
export async function adminGetAllSubscriptions(): Promise<
  (DBSubscription & { userName?: string; userEmail?: string; userPhone?: string })[]
> {
  if (isPrismaAvailable && prisma) {
    const subs = await prisma.subscription.findMany({
      orderBy: { createdAt: 'desc' }
    });
    const userIds = Array.from(new Set(subs.map(s => s.userId)));
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } }
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    return subs.map(s => {
      const u = userMap.get(s.userId);
      return {
        ...mapPrismaSubscription(s),
        userName: u?.name || 'ناشناس',
        userEmail: u?.email || undefined,
        userPhone: u?.phoneNumber || undefined
      };
    });
  }

  const subs = [...memoryStore.subscriptions].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return Promise.all(
    subs.map(async s => {
      const u = await findUserById(s.userId);
      return {
        ...s,
        userName: u?.name || 'ناشناس',
        userEmail: u?.email || undefined,
        userPhone: u?.phoneNumber || undefined
      };
    })
  );
}

/**
 * Admin: Overview statistics.
 * Uses authoritative database counts and revenue calculations.
 */
export async function adminGetOverviewStats(): Promise<{
  totalUsers: number;
  vipUsers: number;
  activeToday: number;
  totalRevenueToman: number;
  totalLogs: number;
  activeCycles: number;
}> {
  const todayIso = new Date().toISOString().split('T')[0];

  if (isPrismaAvailable && prisma) {
    const [totalUsers, vipUsers, logsToday, completedSubs, totalLogs, activeCycles] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { isVip: true } }),
      prisma.dailyLog.findMany({ where: { date: todayIso }, select: { userId: true } }),
      prisma.subscription.findMany({ where: { status: 'SUCCESS' }, select: { amount: true } }),
      prisma.dailyLog.count(),
      prisma.cycle.count({ where: { isArchived: false } })
    ]);

    const activeUserIds = new Set(logsToday.map((l: any) => l.userId));
    const totalRevenueToman = completedSubs.reduce((acc: number, curr: any) => acc + (curr.amount || 0), 0);

    return {
      totalUsers,
      vipUsers,
      activeToday: activeUserIds.size,
      totalRevenueToman,
      totalLogs,
      activeCycles
    };
  }

  const users = memoryStore.users;
  const vipUsers = users.filter(u => u.isVip).length;
  const logsToday = memoryStore.dailyLogs.filter(l => l.date === todayIso);
  const activeUserIds = new Set(logsToday.map(l => l.userId));
  const completedSubs = memoryStore.subscriptions.filter(
    s => (s.status ? String(s.status).toUpperCase() : '') === 'SUCCESS'
  );
  const totalRevenueToman = completedSubs.reduce((acc, curr) => acc + (curr.amount || 0), 0);

  return {
    totalUsers: users.length,
    vipUsers,
    activeToday: activeUserIds.size,
    totalRevenueToman,
    totalLogs: memoryStore.dailyLogs.length,
    activeCycles: memoryStore.cycles.filter(c => !c.isArchived).length
  };
}
