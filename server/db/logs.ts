import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBDailyLog,
  ConcurrencyConflictError,
  PreconditionRequiredError
} from './base.js';

export async function getUserDailyLogs(userId: string, cycleId?: string): Promise<DBDailyLog[]> {
  if (isPrismaAvailable && prisma) {
    try {
      if (cycleId) {
        // Enforce parent cycle ownership before returning logs
        const parentCycle = await prisma.cycle.findFirst({
          where: { id: cycleId, userId }
        });
        if (!parentCycle) {
          return [];
        }
      }

      const logs = await prisma.dailyLog.findMany({
        where: {
          userId,
          ...(cycleId ? { cycleId } : {})
        },
        orderBy: { date: 'asc' }
      });
      return logs.map((l: any) => ({
        ...l,
        revision: l.revision ?? 1,
        createdAt: l.createdAt instanceof Date ? l.createdAt.toISOString() : l.createdAt,
        updatedAt: l.updatedAt instanceof Date ? l.updatedAt.toISOString() : l.updatedAt
      }));
    } catch (e) {
      console.warn('[Database] Prisma getUserDailyLogs failed, checking local store:', e);
    }
  }

  if (cycleId) {
    // Enforce parent cycle ownership in fallback store
    const parentCycle = memoryStore.cycles.find(c => c.id === cycleId && c.userId === userId);
    if (!parentCycle) {
      return [];
    }
  }

  let logs = memoryStore.dailyLogs.filter(l => l.userId === userId);
  if (cycleId) {
    logs = logs.filter(l => l.cycleId === cycleId);
  }

  return logs
    .map(l => ({ ...l, revision: l.revision ?? 1 }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

export async function getDailyLogById(userId: string, logId: string): Promise<DBDailyLog | null> {
  if (isPrismaAvailable && prisma) {
    try {
      const log = await prisma.dailyLog.findFirst({
        where: { id: logId, userId }
      });
      if (!log) return null;
      return {
        ...log,
        revision: log.revision ?? 1,
        createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
        updatedAt: log.updatedAt instanceof Date ? log.updatedAt.toISOString() : log.updatedAt
      };
    } catch (e) {
      console.warn('[Database] Prisma getDailyLogById failed, checking local store:', e);
    }
  }

  const log = memoryStore.dailyLogs.find(l => l.id === logId && l.userId === userId);
  return log ? { ...log, revision: log.revision ?? 1 } : null;
}

export async function getDailyLogByDate(userId: string, date: string): Promise<DBDailyLog | null> {
  if (isPrismaAvailable && prisma) {
    try {
      const log = await prisma.dailyLog.findFirst({
        where: { date, userId }
      });
      if (!log) return null;
      return {
        ...log,
        revision: log.revision ?? 1,
        createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
        updatedAt: log.updatedAt instanceof Date ? log.updatedAt.toISOString() : log.updatedAt
      };
    } catch (e) {
      console.warn('[Database] Prisma getDailyLogByDate failed, checking local store:', e);
    }
  }

  const log = memoryStore.dailyLogs.find(l => l.date === date && l.userId === userId);
  return log ? { ...log, revision: log.revision ?? 1 } : null;
}

// Tracks clientOperationId for daily logs: key = `${userId}:${date}` -> clientOperationId
const logOperationIdMap = new Map<string, string>();

export function clearDailyLogOperationIds() {
  logOperationIdMap.clear();
}

export async function upsertDailyLog(
  userId: string,
  data: {
    id?: string;
    clientOperationId?: string;
    cycleId: string;
    date: string;
    wakeUp: boolean;
    workout: boolean;
    study: boolean;
    journal: boolean;
    hardTask: boolean;
    specialMission: boolean;
    failureReason?: string | null;
    failureTime?: string | null;
    autopsyNotes?: string | null;
    countermeasure?: string | null;
    aiFeedback?: string | null;
    notes?: string | null;
  },
  expectedRevision?: number
): Promise<DBDailyLog> {
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // RULE 4 & 5 & 8 & 9: Strict Parent Cycle Ownership Verification
  // A user cannot create or upsert a DailyLog referencing another user's cycle.
  // -------------------------------------------------------------------------
  if (isPrismaAvailable && prisma) {
    const parentCycle = await prisma.cycle.findFirst({
      where: { id: data.cycleId, userId }
    });

    if (!parentCycle) {
      const err: any = new Error('Cycle not found or does not belong to the authenticated user');
      err.code = 'CYCLE_NOT_FOUND';
      throw err;
    }

    const existing = await prisma.dailyLog.findFirst({
      where: { userId, date: data.date }
    });

    if (existing) {
      const opKey = `${userId}:${data.date}`;
      const lastOpId = logOperationIdMap.get(opKey) || (existing as any).clientOperationId;

      // Idempotent retry: if clientOperationId matches the operation that created or updated this log
      if (data.clientOperationId && lastOpId === data.clientOperationId && (expectedRevision === undefined || expectedRevision === existing.revision)) {
        return {
          ...existing,
          revision: existing.revision ?? 1,
          createdAt: existing.createdAt instanceof Date ? existing.createdAt.toISOString() : existing.createdAt,
          updatedAt: existing.updatedAt instanceof Date ? existing.updatedAt.toISOString() : existing.updatedAt
        };
      }

      // First-create collision: client sent clientOperationId with undefined expectedRevision, but log already exists
      if (data.clientOperationId && expectedRevision === undefined) {
        throw new ConcurrencyConflictError({
          entityType: 'DAILY_LOG',
          entityId: existing.id,
          currentRevision: existing.revision ?? 1,
          expectedRevision: 0,
          message: 'گزارش این روز همزمان توسط دستگاه دیگری ایجاد شده است.'
        });
      }

      if (expectedRevision === undefined || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
        throw new PreconditionRequiredError({
          entityType: 'DAILY_LOG',
          entityId: existing.id
        });
      }

      const result = await prisma.dailyLog.updateMany({
        where: {
          id: existing.id,
          userId,
          revision: expectedRevision
        },
        data: {
          cycleId: data.cycleId,
          wakeUp: Boolean(data.wakeUp),
          workout: Boolean(data.workout),
          study: Boolean(data.study),
          journal: Boolean(data.journal),
          hardTask: Boolean(data.hardTask),
          specialMission: Boolean(data.specialMission),
          failureReason: data.failureReason || null,
          failureTime: data.failureTime || null,
          autopsyNotes: data.autopsyNotes || null,
          countermeasure: data.countermeasure || null,
          aiFeedback: data.aiFeedback || null,
          notes: data.notes || null,
          revision: { increment: 1 },
          updatedAt: new Date()
        }
      });

      if (result.count === 0) {
        const current = await prisma.dailyLog.findFirst({
          where: { id: existing.id, userId }
        });
        throw new ConcurrencyConflictError({
          entityType: 'DAILY_LOG',
          entityId: existing.id,
          currentRevision: current ? (current.revision ?? 1) : (existing.revision ?? 1),
          expectedRevision
        });
      }

      if (data.clientOperationId) {
        logOperationIdMap.set(opKey, data.clientOperationId);
      }

      const updated = await prisma.dailyLog.findFirst({
        where: { id: existing.id, userId }
      });
      return {
        ...updated!,
        revision: updated!.revision ?? 1,
        createdAt: updated!.createdAt instanceof Date ? updated!.createdAt.toISOString() : updated!.createdAt,
        updatedAt: updated!.updatedAt instanceof Date ? updated!.updatedAt.toISOString() : updated!.updatedAt
      };
    } else {
      // First create attempt: exactly one database record created, starts at revision 1
      try {
        const created = await prisma.dailyLog.create({
          data: {
            id: data.id || `log-${userId}-${data.date}`,
            userId,
            cycleId: data.cycleId,
            date: data.date,
            wakeUp: Boolean(data.wakeUp),
            workout: Boolean(data.workout),
            study: Boolean(data.study),
            journal: Boolean(data.journal),
            hardTask: Boolean(data.hardTask),
            specialMission: Boolean(data.specialMission),
            failureReason: data.failureReason || null,
            failureTime: data.failureTime || null,
            autopsyNotes: data.autopsyNotes || null,
            countermeasure: data.countermeasure || null,
            aiFeedback: data.aiFeedback || null,
            notes: data.notes || null,
            revision: 1
          }
        });
        const opKey = `${userId}:${data.date}`;
        if (data.clientOperationId) {
          logOperationIdMap.set(opKey, data.clientOperationId);
        }
        return {
          ...created,
          revision: created.revision ?? 1,
          createdAt: created.createdAt instanceof Date ? created.createdAt.toISOString() : created.createdAt,
          updatedAt: created.updatedAt instanceof Date ? created.updatedAt.toISOString() : created.updatedAt
        };
      } catch (e: any) {
        // Handle concurrent first-create unique constraint race condition intentionally
        if (e?.code === 'P2002' || e?.message?.includes('Unique constraint failed') || e?.message?.includes('P2002')) {
          const raced = await prisma.dailyLog.findFirst({
            where: { userId, date: data.date }
          });
          if (raced) {
            const opKey = `${userId}:${data.date}`;
            const lastOpId = logOperationIdMap.get(opKey) || (raced as any).clientOperationId;
            if (data.clientOperationId && lastOpId === data.clientOperationId) {
              return {
                ...raced,
                revision: raced.revision ?? 1,
                createdAt: raced.createdAt instanceof Date ? raced.createdAt.toISOString() : raced.createdAt,
                updatedAt: raced.updatedAt instanceof Date ? raced.updatedAt.toISOString() : raced.updatedAt
              };
            }
            throw new ConcurrencyConflictError({
              entityType: 'DAILY_LOG',
              entityId: raced.id,
              currentRevision: raced.revision ?? 1,
              expectedRevision: expectedRevision ?? 0,
              message: 'گزارش این روز همزمان توسط دستگاه دیگری ایجاد شده است.'
            });
          }
        }
        throw e;
      }
    }
  }

  // Fallback Store: Validate parent Cycle ownership
  const parentCycle = memoryStore.cycles.find(c => c.id === data.cycleId && c.userId === userId);
  if (!parentCycle) {
    const err: any = new Error('Cycle not found or does not belong to the authenticated user');
    err.code = 'CYCLE_NOT_FOUND';
    throw err;
  }

  const existingIdx = memoryStore.dailyLogs.findIndex(
    l => l.userId === userId && l.date === data.date
  );

  const cleanLogData = {
    cycleId: data.cycleId,
    date: data.date,
    clientOperationId: data.clientOperationId || null,
    wakeUp: Boolean(data.wakeUp),
    workout: Boolean(data.workout),
    study: Boolean(data.study),
    journal: Boolean(data.journal),
    hardTask: Boolean(data.hardTask),
    specialMission: Boolean(data.specialMission),
    failureReason: data.failureReason || null,
    failureTime: data.failureTime || null,
    autopsyNotes: data.autopsyNotes || null,
    countermeasure: data.countermeasure || null,
    aiFeedback: data.aiFeedback || null,
    notes: data.notes || null
  };

  if (existingIdx >= 0) {
    const existing = memoryStore.dailyLogs[existingIdx];
    const currentRev = existing.revision ?? 1;

    // Idempotent retry: if clientOperationId matches existing operation
    if (data.clientOperationId && existing.clientOperationId === data.clientOperationId && (expectedRevision === undefined || expectedRevision === currentRev)) {
      return existing;
    }

    // First-create collision: client sent clientOperationId with undefined expectedRevision, but log already exists
    if (data.clientOperationId && expectedRevision === undefined) {
      throw new ConcurrencyConflictError({
        entityType: 'DAILY_LOG',
        entityId: existing.id,
        currentRevision: currentRev,
        expectedRevision: 0,
        message: 'گزارش این روز همزمان توسط دستگاه دیگری ایجاد شده است.'
      });
    }

    if (expectedRevision === undefined || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
      throw new PreconditionRequiredError({
        entityType: 'DAILY_LOG',
        entityId: existing.id
      });
    }

    if (currentRev !== expectedRevision) {
      throw new ConcurrencyConflictError({
        entityType: 'DAILY_LOG',
        entityId: existing.id,
        currentRevision: currentRev,
        expectedRevision
      });
    }

    const nextRev = currentRev + 1;
    memoryStore.dailyLogs[existingIdx] = {
      ...existing,
      ...cleanLogData,
      revision: nextRev,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: now
    };
    saveLocalStore();
    return memoryStore.dailyLogs[existingIdx];
  } else {
    // Check if targetId or unique constraint collision exists in memoryStore
    const targetId = data.id || `log-${userId}-${data.date}`;
    const idCollided = memoryStore.dailyLogs.find(l => l.id === targetId || (l.userId === userId && l.date === data.date));
    if (idCollided) {
      if (data.clientOperationId && idCollided.clientOperationId === data.clientOperationId) {
        return idCollided;
      }
      throw new ConcurrencyConflictError({
        entityType: 'DAILY_LOG',
        entityId: idCollided.id,
        currentRevision: idCollided.revision ?? 1,
        expectedRevision: expectedRevision ?? 0,
        message: 'گزارش این روز همزمان توسط دستگاه دیگری ایجاد شده است.'
      });
    }

    const newLog: DBDailyLog = {
      id: targetId,
      userId,
      ...cleanLogData,
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    memoryStore.dailyLogs.push(newLog);
    saveLocalStore();
    return newLog;
  }
}

export async function updateDailyLog(
  userId: string,
  logId: string,
  data: Partial<Omit<DBDailyLog, 'id' | 'userId' | 'createdAt'>>,
  expectedRevision?: number
): Promise<DBDailyLog | null> {
  const now = new Date().toISOString();

  // Enforce mandatory expectedRevision for optimistic concurrency
  if (expectedRevision === undefined || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
    throw new PreconditionRequiredError({
      entityType: 'DAILY_LOG',
      entityId: logId
    });
  }

  // Validate and sanitize update fields to prevent immutable field overrides
  const safeData: any = {};
  if (typeof data.wakeUp === 'boolean') safeData.wakeUp = data.wakeUp;
  if (typeof data.workout === 'boolean') safeData.workout = data.workout;
  if (typeof data.study === 'boolean') safeData.study = data.study;
  if (typeof data.journal === 'boolean') safeData.journal = data.journal;
  if (typeof data.hardTask === 'boolean') safeData.hardTask = data.hardTask;
  if (typeof data.specialMission === 'boolean') safeData.specialMission = data.specialMission;
  if (data.failureReason !== undefined) safeData.failureReason = data.failureReason;
  if (data.failureTime !== undefined) safeData.failureTime = data.failureTime;
  if (data.autopsyNotes !== undefined) safeData.autopsyNotes = data.autopsyNotes;
  if (data.countermeasure !== undefined) safeData.countermeasure = data.countermeasure;
  if (data.aiFeedback !== undefined) safeData.aiFeedback = data.aiFeedback;
  if (data.notes !== undefined) safeData.notes = data.notes;

  if (isPrismaAvailable && prisma) {
    const existing = await prisma.dailyLog.findFirst({
      where: { id: logId, userId }
    });
    if (!existing) return null;

    // If cycleId is being moved/updated, verify that target cycle also belongs to the authenticated user
    if (data.cycleId && data.cycleId !== existing.cycleId) {
      const parentCycle = await prisma.cycle.findFirst({
        where: { id: data.cycleId, userId }
      });
      if (!parentCycle) {
        const err: any = new Error('Cycle not found or does not belong to the authenticated user');
        err.code = 'CYCLE_NOT_FOUND';
        throw err;
      }
      safeData.cycleId = data.cycleId;
    }

    const result = await prisma.dailyLog.updateMany({
      where: {
        id: logId,
        userId,
        revision: expectedRevision
      },
      data: {
        ...safeData,
        revision: { increment: 1 },
        updatedAt: new Date()
      }
    });

    if (result.count === 0) {
      const current = await prisma.dailyLog.findFirst({
        where: { id: logId, userId }
      });
      throw new ConcurrencyConflictError({
        entityType: 'DAILY_LOG',
        entityId: logId,
        currentRevision: current ? (current.revision ?? 1) : (existing.revision ?? 1),
        expectedRevision
      });
    }

    const updated = await prisma.dailyLog.findFirst({
      where: { id: logId, userId }
    });
    if (!updated) return null;
    return {
      ...updated,
      revision: updated.revision ?? 1,
      createdAt: updated.createdAt instanceof Date ? updated.createdAt.toISOString() : updated.createdAt,
      updatedAt: updated.updatedAt instanceof Date ? updated.updatedAt.toISOString() : updated.updatedAt
    };
  }

  const existingIdx = memoryStore.dailyLogs.findIndex(l => l.id === logId && l.userId === userId);
  if (existingIdx === -1) return null;

  const existing = memoryStore.dailyLogs[existingIdx];

  // If cycleId is being moved/updated, verify that target cycle also belongs to the authenticated user
  if (data.cycleId && data.cycleId !== existing.cycleId) {
    const parentCycle = memoryStore.cycles.find(c => c.id === data.cycleId && c.userId === userId);
    if (!parentCycle) {
      const err: any = new Error('Cycle not found or does not belong to the authenticated user');
      err.code = 'CYCLE_NOT_FOUND';
      throw err;
    }
    safeData.cycleId = data.cycleId;
  }

  const currentRev = existing.revision ?? 1;
  if (currentRev !== expectedRevision) {
    throw new ConcurrencyConflictError({
      entityType: 'DAILY_LOG',
      entityId: logId,
      currentRevision: currentRev,
      expectedRevision
    });
  }

  const nextRev = currentRev + 1;
  memoryStore.dailyLogs[existingIdx] = {
    ...existing,
    ...safeData,
    revision: nextRev,
    id: existing.id,
    userId: existing.userId,
    date: existing.date,
    createdAt: existing.createdAt,
    updatedAt: now
  };
  saveLocalStore();
  return memoryStore.dailyLogs[existingIdx];
}

export async function deleteDailyLog(userId: string, logId: string, expectedRevision?: number): Promise<boolean> {
  if (expectedRevision === undefined || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
    throw new PreconditionRequiredError({
      entityType: 'DAILY_LOG',
      entityId: logId
    });
  }

  if (isPrismaAvailable && prisma) {
    const existing = await prisma.dailyLog.findFirst({
      where: { id: logId, userId }
    });
    if (!existing) return false;

    const result = await prisma.dailyLog.deleteMany({
      where: {
        id: logId,
        userId,
        revision: expectedRevision
      }
    });

    if (result.count === 0) {
      const current = await prisma.dailyLog.findFirst({
        where: { id: logId, userId }
      });
      throw new ConcurrencyConflictError({
        entityType: 'DAILY_LOG',
        entityId: logId,
        currentRevision: current ? (current.revision ?? 1) : (existing.revision ?? 1),
        expectedRevision
      });
    }
    return true;
  }

  const existingIdx = memoryStore.dailyLogs.findIndex(l => l.id === logId && l.userId === userId);
  if (existingIdx === -1) return false;

  const existing = memoryStore.dailyLogs[existingIdx];
  const currentRev = existing.revision ?? 1;

  if (currentRev !== expectedRevision) {
    throw new ConcurrencyConflictError({
      entityType: 'DAILY_LOG',
      entityId: logId,
      currentRevision: currentRev,
      expectedRevision
    });
  }

  memoryStore.dailyLogs.splice(existingIdx, 1);
  saveLocalStore();
  return true;
}

export async function deleteDailyLogByDate(userId: string, date: string, expectedRevision?: number): Promise<boolean> {
  if (expectedRevision === undefined || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
    throw new PreconditionRequiredError({
      entityType: 'DAILY_LOG'
    });
  }

  if (isPrismaAvailable && prisma) {
    const existing = await prisma.dailyLog.findFirst({
      where: { date, userId }
    });
    if (!existing) return false;

    const result = await prisma.dailyLog.deleteMany({
      where: {
        id: existing.id,
        userId,
        revision: expectedRevision
      }
    });

    if (result.count === 0) {
      const current = await prisma.dailyLog.findFirst({
        where: { id: existing.id, userId }
      });
      throw new ConcurrencyConflictError({
        entityType: 'DAILY_LOG',
        entityId: existing.id,
        currentRevision: current ? (current.revision ?? 1) : (existing.revision ?? 1),
        expectedRevision
      });
    }
    return true;
  }

  const existingIdx = memoryStore.dailyLogs.findIndex(l => l.date === date && l.userId === userId);
  if (existingIdx === -1) return false;

  const existing = memoryStore.dailyLogs[existingIdx];
  const currentRev = existing.revision ?? 1;

  if (currentRev !== expectedRevision) {
    throw new ConcurrencyConflictError({
      entityType: 'DAILY_LOG',
      entityId: existing.id,
      currentRevision: currentRev,
      expectedRevision
    });
  }

  memoryStore.dailyLogs.splice(existingIdx, 1);
  saveLocalStore();
  return true;
}
