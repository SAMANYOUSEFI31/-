import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBDailyLog
} from './base';

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

  return logs.sort((a, b) => a.date.localeCompare(b.date));
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
        createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
        updatedAt: log.updatedAt instanceof Date ? log.updatedAt.toISOString() : log.updatedAt
      };
    } catch (e) {
      console.warn('[Database] Prisma getDailyLogById failed, checking local store:', e);
    }
  }

  const log = memoryStore.dailyLogs.find(l => l.id === logId && l.userId === userId);
  return log ? { ...log } : null;
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
        createdAt: log.createdAt instanceof Date ? log.createdAt.toISOString() : log.createdAt,
        updatedAt: log.updatedAt instanceof Date ? log.updatedAt.toISOString() : log.updatedAt
      };
    } catch (e) {
      console.warn('[Database] Prisma getDailyLogByDate failed, checking local store:', e);
    }
  }

  const log = memoryStore.dailyLogs.find(l => l.date === date && l.userId === userId);
  return log ? { ...log } : null;
}

export async function upsertDailyLog(
  userId: string,
  data: {
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
  }
): Promise<DBDailyLog> {
  const now = new Date().toISOString();

  // -------------------------------------------------------------------------
  // RULE 4 & 5 & 8 & 9: Strict Parent Cycle Ownership Verification
  // A user cannot create or upsert a DailyLog referencing another user's cycle.
  // -------------------------------------------------------------------------
  if (isPrismaAvailable && prisma) {
    try {
      const parentCycle = await prisma.cycle.findFirst({
        where: { id: data.cycleId, userId }
      });

      if (!parentCycle) {
        const err: any = new Error('Cycle not found or does not belong to the authenticated user');
        err.code = 'CYCLE_NOT_FOUND';
        throw err;
      }

      const upserted = await prisma.dailyLog.upsert({
        where: {
          userId_date: {
            userId,
            date: data.date
          }
        },
        update: {
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
          updatedAt: new Date()
        },
        create: {
          id: `log-${userId}-${data.date}`,
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
          notes: data.notes || null
        }
      });
      return {
        ...upserted,
        createdAt: upserted.createdAt instanceof Date ? upserted.createdAt.toISOString() : upserted.createdAt,
        updatedAt: upserted.updatedAt instanceof Date ? upserted.updatedAt.toISOString() : upserted.updatedAt
      };
    } catch (e: any) {
      if (e?.code === 'CYCLE_NOT_FOUND') {
        throw e;
      }
      console.warn('[Database] Prisma upsertDailyLog failed, falling back to local store:', e);
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
    memoryStore.dailyLogs[existingIdx] = {
      ...existing,
      ...cleanLogData,
      id: existing.id,
      userId: existing.userId,
      createdAt: existing.createdAt,
      updatedAt: now
    };
    saveLocalStore();
    return memoryStore.dailyLogs[existingIdx];
  } else {
    const newLog: DBDailyLog = {
      id: `log-${userId}-${data.date}`,
      userId,
      ...cleanLogData,
      createdAt: now,
      updatedAt: now
    };
    memoryStore.dailyLogs.push(newLog);
    saveLocalStore();
    return newLog;
  }
}

export async function deleteDailyLog(userId: string, logId: string): Promise<boolean> {
  if (isPrismaAvailable && prisma) {
    try {
      const existing = await prisma.dailyLog.findFirst({
        where: { id: logId, userId }
      });
      if (!existing) return false;

      await prisma.dailyLog.delete({ where: { id: logId } });
      return true;
    } catch (e) {
      console.warn('[Database] Prisma deleteDailyLog failed, deleting in local store:', e);
    }
  }

  const existingIdx = memoryStore.dailyLogs.findIndex(l => l.id === logId && l.userId === userId);
  if (existingIdx === -1) return false;

  memoryStore.dailyLogs.splice(existingIdx, 1);
  saveLocalStore();
  return true;
}

export async function deleteDailyLogByDate(userId: string, date: string): Promise<boolean> {
  if (isPrismaAvailable && prisma) {
    try {
      const existing = await prisma.dailyLog.findFirst({
        where: { date, userId }
      });
      if (!existing) return false;

      await prisma.dailyLog.delete({ where: { id: existing.id } });
      return true;
    } catch (e) {
      console.warn('[Database] Prisma deleteDailyLogByDate failed, deleting in local store:', e);
    }
  }

  const existingIdx = memoryStore.dailyLogs.findIndex(l => l.date === date && l.userId === userId);
  if (existingIdx === -1) return false;

  memoryStore.dailyLogs.splice(existingIdx, 1);
  saveLocalStore();
  return true;
}
