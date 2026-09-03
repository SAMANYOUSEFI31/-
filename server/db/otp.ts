import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBOtpCode
} from './base.js';

function mapPrismaOtpCode(record: any): DBOtpCode {
  if (!record) return record;
  return {
    id: record.id,
    identifier: record.identifier,
    purpose: record.purpose || 'PHONE_REGISTRATION',
    codeHash: record.codeHash || '',
    expiresAt: record.expiresAt instanceof Date ? record.expiresAt.toISOString() : record.expiresAt,
    verified: Boolean(record.verified),
    attempts: record.attempts ?? 0,
    maxAttempts: record.maxAttempts ?? 5,
    lastSentAt: record.lastSentAt instanceof Date ? record.lastSentAt.toISOString() : (record.lastSentAt || record.createdAt),
    consumedAt: record.consumedAt instanceof Date ? record.consumedAt.toISOString() : (record.consumedAt || null),
    userId: record.userId || null,
    createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
    updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : (record.updatedAt || record.createdAt)
  };
}

/**
 * Finds active (unverified and unconsumed) OTP challenge
 */
export async function findActiveOtpChallenge(
  phoneNumber: string,
  purpose?: string
): Promise<DBOtpCode | null> {
  if (isPrismaAvailable && prisma) {
    try {
      const record = await prisma.otpCode.findFirst({
        where: {
          identifier: phoneNumber,
          ...(purpose ? { purpose } : {}),
          verified: false,
          consumedAt: null
        },
        orderBy: { createdAt: 'desc' }
      });
      if (record) return mapPrismaOtpCode(record);
    } catch (e) {
      console.warn('[Database] Prisma findActiveOtpChallenge failed, falling back to local store:', e);
    }
  }

  const found = memoryStore.otpCodes
    .filter(
      o =>
        o.identifier === phoneNumber &&
        (!purpose || o.purpose === purpose) &&
        !o.verified &&
        !o.consumedAt
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return found || null;
}

/**
 * Finds most recent OTP challenge for cooldown checks
 */
export async function findLatestOtpChallenge(
  phoneNumber: string,
  purpose: string
): Promise<DBOtpCode | null> {
  if (isPrismaAvailable && prisma) {
    try {
      const record = await prisma.otpCode.findFirst({
        where: {
          identifier: phoneNumber,
          purpose,
          verified: false,
          consumedAt: null
        },
        orderBy: { createdAt: 'desc' }
      });
      if (record) return mapPrismaOtpCode(record);
    } catch (e) {
      console.warn('[Database] Prisma findLatestOtpChallenge failed, falling back to local store:', e);
    }
  }

  const found = memoryStore.otpCodes
    .filter(
      o =>
        o.identifier === phoneNumber &&
        o.purpose === purpose &&
        !o.verified &&
        !o.consumedAt
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

  return found || null;
}

/**
 * Creates persistent OTP record (supersedes previous unverified challenges for same phone + purpose)
 */
export async function createOtpRecord(data: DBOtpCode): Promise<DBOtpCode> {
  if (isPrismaAvailable && prisma) {
    try {
      // Invalidate existing unverified challenges in Prisma
      await prisma.otpCode.updateMany({
        where: {
          identifier: data.identifier,
          purpose: data.purpose,
          verified: false
        },
        data: {
          verified: true,
          consumedAt: new Date()
        }
      });

      const created = await prisma.otpCode.create({
        data: {
          id: data.id,
          identifier: data.identifier,
          purpose: data.purpose,
          codeHash: data.codeHash,
          expiresAt: new Date(data.expiresAt),
          verified: false,
          attempts: data.attempts,
          maxAttempts: data.maxAttempts,
          lastSentAt: new Date(data.lastSentAt),
          userId: data.userId || null
        }
      });

      // Also mirror in local store for fallback safety
      memoryStore.otpCodes = memoryStore.otpCodes.filter(
        o => !(o.identifier === data.identifier && o.purpose === data.purpose && !o.verified)
      );
      memoryStore.otpCodes.push(data);
      saveLocalStore();

      return mapPrismaOtpCode(created);
    } catch (e) {
      console.warn('[Database] Prisma createOtpRecord failed, saving to local store:', e);
    }
  }

  // Fallback local memory & file store
  memoryStore.otpCodes = memoryStore.otpCodes.filter(
    o => !(o.identifier === data.identifier && o.purpose === data.purpose && !o.verified)
  );
  memoryStore.otpCodes.push(data);
  saveLocalStore();
  return data;
}

/**
 * Updates OTP challenge attempts or consumed status
 */
export async function updateOtpRecord(
  id: string,
  updates: Partial<DBOtpCode>
): Promise<DBOtpCode | null> {
  const now = new Date();
  if (isPrismaAvailable && prisma) {
    try {
      const prismaPayload: any = {};
      if (updates.attempts !== undefined) prismaPayload.attempts = updates.attempts;
      if (updates.verified !== undefined) prismaPayload.verified = updates.verified;
      if (updates.consumedAt !== undefined) {
        prismaPayload.consumedAt = updates.consumedAt ? new Date(updates.consumedAt) : null;
      }
      prismaPayload.updatedAt = now;

      const updated = await prisma.otpCode.update({
        where: { id },
        data: prismaPayload
      });

      // Mirror in local store
      const local = memoryStore.otpCodes.find(o => o.id === id);
      if (local) {
        Object.assign(local, updates, { updatedAt: now.toISOString() });
        saveLocalStore();
      }

      return mapPrismaOtpCode(updated);
    } catch (e) {
      console.warn('[Database] Prisma updateOtpRecord failed, updating local store:', e);
    }
  }

  const local = memoryStore.otpCodes.find(o => o.id === id);
  if (local) {
    Object.assign(local, updates, { updatedAt: now.toISOString() });
    saveLocalStore();
    return local;
  }
  return null;
}

/**
 * Deletes or invalidates OTP record (used on failed SMS dispatch to prevent stale cooldown/challenge)
 */
export async function removeOtpRecord(id: string): Promise<void> {
  if (isPrismaAvailable && prisma) {
    try {
      await prisma.otpCode.deleteMany({
        where: { id }
      });
    } catch (e) {
      console.warn('[Database] Prisma removeOtpRecord failed:', e);
    }
  }

  memoryStore.otpCodes = memoryStore.otpCodes.filter(o => o.id !== id);
  saveLocalStore();
}
