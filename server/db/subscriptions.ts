import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBSubscription
} from './base.js';
import { findUserById, updateUser } from './users.js';
import { getPlanById } from '../plans.js';

// -------------------------------------------------------------
// Subscriptions & Payment Transactions
// -------------------------------------------------------------
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
    try {
      return await prisma.subscription.create({
        data: newSub
      });
    } catch (e) {
      console.warn('[Database] Prisma createSubscriptionRecord failed, saving to local store:', e);
    }
  }

  memoryStore.subscriptions.push(newSub);
  saveLocalStore();
  return newSub;
}

export async function completeSubscription(
  authority: string,
  refId: string,
  cardPan: string
): Promise<DBSubscription | null> {
  const nowStr = new Date().toISOString();

  let sub: DBSubscription | null = null;
  let isNewlyCompleted = false;

  if (isPrismaAvailable && prisma) {
    try {
      const match = await prisma.subscription.findUnique({
        where: { authority }
      });
      if (match) {
        if (match.status === 'SUCCESS') {
          // Idempotent: return existing record without mutating or re-activating VIP
          return {
            id: match.id,
            userId: match.userId,
            planId: match.planId,
            amount: match.amount,
            authority: match.authority,
            refId: match.refId,
            cardPan: match.cardPan,
            status: 'SUCCESS',
            description: match.description,
            expiresAt: match.expiresAt ? match.expiresAt.toISOString() : null,
            createdAt: match.createdAt.toISOString(),
            updatedAt: match.updatedAt.toISOString()
          };
        }
        if (match.status === 'FAILED') {
          // Terminal: FAILED transactions cannot transition to SUCCESS
          return null;
        }

        const plan = getPlanById(match.planId);
        const durationDays = plan?.durationDays ?? (plan?.durationMonths ? plan.durationMonths * 30 : 365);
        const calculatedExpiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();

        sub = await prisma.subscription.update({
          where: { authority },
          data: {
            status: 'SUCCESS',
            refId,
            cardPan,
            expiresAt: calculatedExpiresAt,
            updatedAt: nowStr
          }
        });
        isNewlyCompleted = true;
      }
    } catch (e) {
      console.warn('[Database] Prisma completeSubscription failed, updating local store:', e);
    }
  }

  if (!sub && !isNewlyCompleted) {
    const idx = memoryStore.subscriptions.findIndex(s => s.authority === authority);
    if (idx !== -1) {
      const existing = memoryStore.subscriptions[idx];
      if (existing.status === 'SUCCESS') {
        // Idempotent: return existing record without mutating or re-activating VIP
        return existing;
      }
      if (existing.status === 'FAILED') {
        // Terminal: FAILED transactions cannot transition to SUCCESS
        return null;
      }

      const plan = getPlanById(existing.planId);
      const durationDays = plan?.durationDays ?? (plan?.durationMonths ? plan.durationMonths * 30 : 365);
      const calculatedExpiresAt = new Date(Date.now() + durationDays * 86400000).toISOString();

      memoryStore.subscriptions[idx] = {
        ...existing,
        status: 'SUCCESS',
        refId,
        cardPan,
        expiresAt: calculatedExpiresAt,
        updatedAt: nowStr
      };
      saveLocalStore();
      sub = memoryStore.subscriptions[idx];
      isNewlyCompleted = true;
    }
  }

  if (sub && isNewlyCompleted) {
    const plan = getPlanById(sub.planId);
    const durationDays = plan?.durationDays ?? (plan?.durationMonths ? plan.durationMonths * 30 : 365);
    const calculatedExpiresAt = sub.expiresAt || new Date(Date.now() + durationDays * 86400000).toISOString();
    const targetTier = plan?.tier || 'vip_samurai';

    // Elevate target user to VIP strictly on first transition
    await updateUser(sub.userId, {
      isVip: true,
      tier: targetTier,
      vipSince: nowStr,
      vipExpiresAt: calculatedExpiresAt,
      paymentRefId: refId
    });
  }

  return sub;
}

export async function markSubscriptionFailed(
  authority: string,
  reason?: string
): Promise<DBSubscription | null> {
  const nowStr = new Date().toISOString();
  let sub: DBSubscription | null = null;

  if (isPrismaAvailable && prisma) {
    try {
      const match = await prisma.subscription.findUnique({
        where: { authority }
      });
      if (match) {
        // Terminal idempotency: never downgrade a SUCCESS transaction to FAILED
        if (match.status === 'SUCCESS') {
          return {
            id: match.id,
            userId: match.userId,
            planId: match.planId,
            amount: match.amount,
            authority: match.authority,
            refId: match.refId,
            cardPan: match.cardPan,
            status: 'SUCCESS',
            description: match.description,
            expiresAt: match.expiresAt ? match.expiresAt.toISOString() : null,
            createdAt: match.createdAt.toISOString(),
            updatedAt: match.updatedAt.toISOString()
          };
        }
        sub = await prisma.subscription.update({
          where: { authority },
          data: {
            status: 'FAILED',
            description: reason ? `[ناموفق] ${reason}` : match.description,
            updatedAt: nowStr
          }
        });
      }
    } catch (e) {
      console.warn('[Database] Prisma markSubscriptionFailed failed, updating local store:', e);
    }
  }

  if (!sub) {
    const idx = memoryStore.subscriptions.findIndex(s => s.authority === authority);
    if (idx !== -1) {
      const existing = memoryStore.subscriptions[idx];
      // Terminal idempotency: never downgrade a SUCCESS transaction to FAILED
      if (existing.status === 'SUCCESS') {
        return existing;
      }
      memoryStore.subscriptions[idx] = {
        ...existing,
        status: 'FAILED',
        description: reason ? `[ناموفق] ${reason}` : existing.description,
        updatedAt: nowStr
      };
      saveLocalStore();
      sub = memoryStore.subscriptions[idx];
    }
  }

  return sub;
}

export async function findSubscriptionByAuthority(authority: string): Promise<DBSubscription | null> {
  if (isPrismaAvailable && prisma) {
    try {
      const match = await prisma.subscription.findUnique({
        where: { authority }
      });
      if (match) {
        return {
          id: match.id,
          userId: match.userId,
          planId: match.planId,
          amount: match.amount,
          authority: match.authority,
          refId: match.refId,
          cardPan: match.cardPan,
          status: match.status,
          description: match.description,
          expiresAt: match.expiresAt ? match.expiresAt.toISOString() : null,
          createdAt: match.createdAt.toISOString(),
          updatedAt: match.updatedAt.toISOString()
        };
      }
      return null;
    } catch (e) {
      console.warn('[Database] Prisma findSubscriptionByAuthority failed, reading local store:', e);
    }
  }

  const found = memoryStore.subscriptions.find(s => s.authority === authority);
  return found || null;
}

export async function getUserSubscriptions(userId: string): Promise<DBSubscription[]> {
  let subs: DBSubscription[] = [];

  if (isPrismaAvailable && prisma) {
    try {
      subs = await prisma.subscription.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' }
      });
      return subs;
    } catch (e) {
      console.warn('[Database] Prisma getUserSubscriptions failed, reading local store:', e);
    }
  }

  subs = memoryStore.subscriptions
    .filter(s => s.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return subs;
}

export async function adminGetAllSubscriptions(): Promise<
  (DBSubscription & { userName?: string; userEmail?: string; userPhone?: string })[]
> {
  let subs: DBSubscription[] = [];

  if (isPrismaAvailable && prisma) {
    try {
      subs = await prisma.subscription.findMany({
        orderBy: { createdAt: 'desc' }
      });
    } catch (e) {
      console.warn('[Database] Prisma adminGetAllSubscriptions failed, reading local store:', e);
    }
  }

  if (subs.length === 0) {
    subs = [...memoryStore.subscriptions].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  const enriched = await Promise.all(
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

  return enriched;
}

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
    try {
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
    } catch (e) {
      console.warn('[Database] Prisma adminGetOverviewStats failed, calculating from local store:', e);
    }
  }

  const users = memoryStore.users;
  const vipUsers = users.filter(u => u.isVip).length;
  const logsToday = memoryStore.dailyLogs.filter(l => l.date === todayIso);
  const activeUserIds = new Set(logsToday.map(l => l.userId));
  const completedSubs = memoryStore.subscriptions.filter(s => s.status === 'SUCCESS');
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
