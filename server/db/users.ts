import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBUser,
  seedUserData
} from './base';
import {
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  isSuperAdminIdentifier,
  allowTestShortcuts
} from '../security';
import { normalizePhoneNumber } from '../utils/phone';

export function normalizeIdentifier(val: string): string {
  if (!val) return '';
  // Convert Persian/Arabic digits to English digits
  const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const arabicDigits = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  let res = val.trim().toLowerCase();
  for (let i = 0; i < 10; i++) {
    res = res.replace(new RegExp(persianDigits[i], 'g'), String(i));
    res = res.replace(new RegExp(arabicDigits[i], 'g'), String(i));
  }
  return res;
}

function mapPrismaUser(user: any): DBUser {
  if (!user) return user;
  return {
    ...user,
    vipSince: user.vipSince instanceof Date ? user.vipSince.toISOString() : user.vipSince,
    vipExpiresAt: user.vipExpiresAt instanceof Date ? user.vipExpiresAt.toISOString() : user.vipExpiresAt,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : user.createdAt,
    updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : user.updatedAt
  };
}

export async function findUserById(id: string): Promise<DBUser | null> {
  if (isPrismaAvailable && prisma) {
    try {
      const user = await prisma.user.findUnique({
        where: { id }
      });
      if (user) return mapPrismaUser(user);
    } catch (e) {
      console.warn('[Database] Prisma findUserById failed, falling back to local store:', e);
    }
  }

  const found = memoryStore.users.find(u => u.id === id);
  return found || null;
}

export async function findUserByPhoneNumber(phone: string): Promise<DBUser | null> {
  const canonicalPhone = normalizePhoneNumber(phone);
  if (!canonicalPhone) return null;

  if (isPrismaAvailable && prisma) {
    try {
      const user = await prisma.user.findFirst({
        where: { phoneNumber: canonicalPhone }
      });
      if (user) return mapPrismaUser(user);
    } catch (e) {
      console.warn('[Database] Prisma findUserByPhoneNumber failed, falling back to local store:', e);
    }
  }

  const found = memoryStore.users.find(u => {
    if (!u.phoneNumber) return false;
    const uPhoneNorm = normalizePhoneNumber(u.phoneNumber);
    return uPhoneNorm === canonicalPhone || u.phoneNumber === canonicalPhone;
  });

  return found || null;
}

export async function findUserByIdentifier(identifier: string): Promise<DBUser | null> {
  const canonicalPhone = normalizePhoneNumber(identifier);
  if (canonicalPhone) {
    const byPhone = await findUserByPhoneNumber(canonicalPhone);
    if (byPhone) return byPhone;
  }

  const normalized = normalizeIdentifier(identifier);
  
  if (isPrismaAvailable && prisma) {
    try {
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { email: { equals: normalized, mode: 'insensitive' } },
            { phoneNumber: normalized }
          ]
        }
      });
      if (user) return mapPrismaUser(user);
    } catch (e) {
      console.warn('[Database] Prisma findUserByIdentifier failed, falling back to local store:', e);
    }
  }

  const found = memoryStore.users.find(
    u => (u.email && u.email.toLowerCase() === normalized) || (u.phoneNumber && u.phoneNumber === normalized)
  );
  return found || null;
}

export async function createUser(data: {
  email?: string;
  phoneNumber?: string;
  name?: string;
  passwordHash?: string;
  tier?: string;
  isVip?: boolean;
  isAdmin?: boolean;
  withStarterCycle?: boolean;
}): Promise<DBUser> {
  const now = new Date().toISOString();
  const id = `user-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

  const cleanEmail = data.email ? normalizeIdentifier(data.email) : undefined;
  const cleanPhone = data.phoneNumber ? normalizeIdentifier(data.phoneNumber) : undefined;

  const isMasterAccount = isSuperAdminIdentifier(cleanEmail) || isSuperAdminIdentifier(cleanPhone);
  const isFirstUser = memoryStore.users.length === 0;
  const isAdmin = isMasterAccount ? true : (data.isAdmin !== undefined ? data.isAdmin : (allowTestShortcuts() ? isFirstUser : false));
  const isVip = isMasterAccount ? true : Boolean(data.isVip);

  const newUser: DBUser = {
    id: isMasterAccount ? 'admin-master-001' : id,
    email: cleanEmail || null,
    phoneNumber: cleanPhone || null,
    name: data.name || (cleanPhone ? `کاربر ${cleanPhone.slice(-4)}` : (cleanEmail ? cleanEmail.split('@')[0] : 'سامورایی دیسیپلین')),
    passwordHash: data.passwordHash || null,
    tier: isMasterAccount ? 'vip_samurai' : (data.tier || (isVip ? 'vip_samurai' : 'free')),
    isVip,
    isAdmin,
    nightOwlCutoffHour: 4,
    accentTheme: 'amber',
    vipSince: isVip ? now : null,
    vipExpiresAt: isVip ? new Date(Date.now() + 365 * 86400000).toISOString() : null,
    paymentRefId: null,
    createdAt: now,
    updatedAt: now
  };

  if (isPrismaAvailable && prisma) {
    try {
      const created = await prisma.user.create({
        data: {
          id: newUser.id,
          email: newUser.email,
          phoneNumber: newUser.phoneNumber,
          name: newUser.name,
          passwordHash: newUser.passwordHash,
          tier: newUser.tier,
          isVip: newUser.isVip,
          isAdmin: newUser.isAdmin,
          nightOwlCutoffHour: newUser.nightOwlCutoffHour,
          accentTheme: newUser.accentTheme,
          vipSince: newUser.vipSince ? new Date(newUser.vipSince) : null,
          vipExpiresAt: newUser.vipExpiresAt ? new Date(newUser.vipExpiresAt) : null,
          paymentRefId: newUser.paymentRefId
        }
      });
      return mapPrismaUser(created);
    } catch (e) {
      console.warn('[Database] Prisma createUser failed, saving to local store:', e);
    }
  }

  memoryStore.users.push(newUser);

  // Seed starter cycle and logs only if explicitly requested (e.g. initial demo setup)
  if (data.withStarterCycle) {
    const seed = seedUserData(newUser.id);
    memoryStore.cycles.push(seed.cycle);
    memoryStore.dailyLogs.push(...seed.logs);
  }

  saveLocalStore();
  return newUser;
}

export async function updateUser(
  id: string,
  data: Partial<Omit<DBUser, 'id' | 'createdAt'>>
): Promise<DBUser | null> {
  const now = new Date().toISOString();
  const idx = memoryStore.users.findIndex(u => u.id === id);
  const existingUser = idx !== -1 ? memoryStore.users[idx] : null;

  // Super Admin security shield: prevent revoking admin or VIP status
  const isMaster = existingUser && (isSuperAdminIdentifier(existingUser.phoneNumber) || isSuperAdminIdentifier(existingUser.email));
  const safeData: any = { ...data };
  if (isMaster) {
    safeData.isAdmin = true;
    safeData.isVip = true;
    safeData.tier = 'vip_samurai';
  }

  if (isPrismaAvailable && prisma) {
    try {
      const prismaUpdatePayload: any = { ...safeData, updatedAt: new Date() };
      if (prismaUpdatePayload.vipSince) {
        prismaUpdatePayload.vipSince = new Date(prismaUpdatePayload.vipSince);
      }
      if (prismaUpdatePayload.vipExpiresAt) {
        prismaUpdatePayload.vipExpiresAt = new Date(prismaUpdatePayload.vipExpiresAt);
      }

      const updated = await prisma.user.update({
        where: { id },
        data: prismaUpdatePayload
      });
      return mapPrismaUser(updated);
    } catch (e) {
      console.warn('[Database] Prisma updateUser failed, updating local store:', e);
    }
  }

  if (!existingUser) return null;

  memoryStore.users[idx] = {
    ...memoryStore.users[idx],
    ...safeData,
    updatedAt: now
  };

  saveLocalStore();
  return memoryStore.users[idx];
}

// -------------------------------------------------------------
// Admin Portal User Management
// -------------------------------------------------------------
export async function adminGetAllUsers(): Promise<DBUser[]> {
  if (isPrismaAvailable && prisma) {
    try {
      const list = await prisma.user.findMany({
        orderBy: { createdAt: 'desc' }
      });
      return list.map(mapPrismaUser);
    } catch (e) {
      console.warn('[Database] Prisma adminGetAllUsers failed, reading local store:', e);
    }
  }

  return [...memoryStore.users].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function adminUpdateUser(
  userId: string,
  data: {
    name?: string;
    isVip?: boolean;
    tier?: string;
    isAdmin?: boolean;
    vipExpiresAt?: string | null;
    daysExtension?: number;
  }
): Promise<DBUser | null> {
  const targetUser = await findUserById(userId);
  if (!targetUser) return null;

  // Super Admin security shield
  const isMaster = isSuperAdminIdentifier(targetUser.phoneNumber) || isSuperAdminIdentifier(targetUser.email);
  if (isMaster && (data.isAdmin === false || data.isVip === false)) {
    throw new Error('حساب مالک و فرمانده ارشد سیستم غیرقابل تنزل یا لغو دسترسی است.');
  }

  const nowStr = new Date().toISOString();
  const updatePayload: Partial<DBUser> = {
    ...data,
    updatedAt: nowStr
  };

  if (isMaster) {
    updatePayload.isAdmin = true;
    updatePayload.isVip = true;
    updatePayload.tier = 'vip_samurai';
  } else {
    if (data.isAdmin !== undefined) {
      updatePayload.isAdmin = data.isAdmin;
    }

    if (data.isVip !== undefined) {
      updatePayload.isVip = data.isVip;
      if (data.isVip) {
        updatePayload.tier = data.tier || 'vip_samurai';
        updatePayload.vipSince = targetUser.vipSince || nowStr;
        
        const currentExpiry = targetUser.vipExpiresAt ? new Date(targetUser.vipExpiresAt).getTime() : Date.now();
        const baseTime = currentExpiry > Date.now() ? currentExpiry : Date.now();
        const extDays = typeof data.daysExtension === 'number' && data.daysExtension > 0 ? data.daysExtension : 365;
        updatePayload.vipExpiresAt = new Date(baseTime + extDays * 86400000).toISOString();
      } else {
        updatePayload.tier = 'free';
        updatePayload.vipExpiresAt = null;
      }
    }
  }

  return updateUser(userId, updatePayload);
}

export async function adminCreateTestUser(data: {
  name: string;
  email?: string;
  phoneNumber?: string;
  identifier?: string;
  isVip?: boolean;
  tier?: string;
  isAdmin?: boolean;
}): Promise<DBUser> {
  const rawId = data.email || data.phoneNumber || data.identifier || '';
  const cleanId = normalizeIdentifier(rawId);
  const isEmail = cleanId.includes('@');

  const user = await createUser({
    name: data.name,
    email: data.email ? normalizeIdentifier(data.email) : (isEmail ? cleanId : undefined),
    phoneNumber: data.phoneNumber ? normalizeIdentifier(data.phoneNumber) : (!isEmail && cleanId ? cleanId : undefined),
    isVip: data.isVip,
    isAdmin: data.isAdmin,
    tier: data.tier || (data.isVip ? 'vip_samurai' : 'free')
  });

  return user;
}
