import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBSubscription,
  DBOtpCode
} from './base';
import { findUserById, updateUser } from './users';

// -------------------------------------------------------------
// OTP Codes
// -------------------------------------------------------------
export async function saveOtpCode(
  identifier: string,
  code: string,
  userId?: string
): Promise<DBOtpCode> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60000).toISOString(); // 10 minutes valid
  const normalized = identifier.trim().toLowerCase();

  const otp: DBOtpCode = {
    id: `otp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    identifier: normalized,
    code,
    expiresAt,
    verified: false,
    userId: userId || null,
    createdAt: now.toISOString()
  };

  if (isPrismaAvailable && prisma) {
    try {
      return await prisma.otpCode.create({
        data: otp
      });
    } catch (e) {
      console.warn('[Database] Prisma saveOtpCode failed, saving to local store:', e);
    }
  }

  // Invalidate previous OTPs for this identifier
  memoryStore.otpCodes = memoryStore.otpCodes.filter(o => o.identifier !== normalized);
  memoryStore.otpCodes.push(otp);
  saveLocalStore();
  return otp;
}

export async function verifyOtpCode(identifier: string, code: string): Promise<DBOtpCode | null> {
  const normalized = identifier.trim().toLowerCase();
  const nowStr = new Date().toISOString();

  if (isPrismaAvailable && prisma) {
    try {
      const match = await prisma.otpCode.findFirst({
        where: {
          identifier: normalized,
          code,
          verified: false,
          expiresAt: { gt: nowStr }
        }
      });
      if (match) {
        await prisma.otpCode.update({
          where: { id: match.id },
          data: { verified: true }
        });
        return match;
      }
    } catch (e) {
      console.warn('[Database] Prisma verifyOtpCode failed, checking local store:', e);
    }
  }

  const match = memoryStore.otpCodes.find(
    o => o.identifier === normalized && o.code === code && !o.verified && o.expiresAt > nowStr
  );

  if (match) {
    match.verified = true;
    saveLocalStore();
    return match;
  }

  return null;
}

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
  const nextYearStr = new Date(Date.now() + 365 * 86400000).toISOString();

  let sub: DBSubscription | null = null;

  if (isPrismaAvailable && prisma) {
    try {
      const match = await prisma.subscription.findUnique({
        where: { authority }
      });
      if (match) {
        sub = await prisma.subscription.update({
          where: { authority },
          data: {
            status: 'COMPLETED',
            refId,
            cardPan,
            expiresAt: nextYearStr,
            updatedAt: nowStr
          }
        });
      }
    } catch (e) {
      console.warn('[Database] Prisma completeSubscription failed, updating local store:', e);
    }
  }

  if (!sub) {
    const idx = memoryStore.subscriptions.findIndex(s => s.authority === authority);
    if (idx !== -1) {
      memoryStore.subscriptions[idx] = {
        ...memoryStore.subscriptions[idx],
        status: 'COMPLETED',
        refId,
        cardPan,
        expiresAt: nextYearStr,
        updatedAt: nowStr
      };
      saveLocalStore();
      sub = memoryStore.subscriptions[idx];
    }
  }

  if (sub) {
    // Elevate target user to VIP
    await updateUser(sub.userId, {
      isVip: true,
      tier: 'vip_samurai',
      vipSince: nowStr,
      vipExpiresAt: nextYearStr,
      paymentRefId: refId
    });
  }

  return sub;
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
        prisma.subscription.findMany({ where: { status: 'COMPLETED' }, select: { amount: true } }),
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
  const completedSubs = memoryStore.subscriptions.filter(s => s.status === 'COMPLETED');
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
