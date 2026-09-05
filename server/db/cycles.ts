import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBCycle,
  seedUserData,
  ConcurrencyConflictError,
  PreconditionRequiredError
} from './base.js';

export async function getUserCycles(userId: string): Promise<DBCycle[]> {
  if (isPrismaAvailable && prisma) {
    const cycles = await prisma.cycle.findMany({
      where: { userId },
      orderBy: { startDate: 'asc' }
    });
    return cycles.map((c: any) => ({
      ...c,
      revision: c.revision ?? 1,
      rules: Array.isArray(c.rules) ? c.rules : []
    }));
  }

  const cycles = memoryStore.cycles.filter(c => c.userId === userId);
  return cycles
    .map(c => ({ ...c, revision: c.revision ?? 1 }))
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function getCycleById(userId: string, cycleId: string): Promise<DBCycle | null> {
  if (isPrismaAvailable && prisma) {
    const cycle = await prisma.cycle.findFirst({
      where: { id: cycleId, userId }
    });
    if (!cycle) return null;
    return {
      ...cycle,
      revision: cycle.revision ?? 1,
      rules: Array.isArray(cycle.rules) ? cycle.rules : []
    };
  }

  const cycle = memoryStore.cycles.find(c => c.id === cycleId && c.userId === userId);
  return cycle ? { ...cycle, revision: cycle.revision ?? 1 } : null;
}

export async function createCycle(
  userId: string,
  data: {
    id?: string;
    clientOperationId?: string;
    title: string;
    startDate: string;
    endDate: string;
    targetTheme?: string | null;
    inheritedStreak?: number;
    rules?: string[];
  }
): Promise<DBCycle> {
  const targetId = data.id || (data.clientOperationId ? `cyc_${userId}_${data.clientOperationId}` : undefined);
  if (targetId) {
    if (isPrismaAvailable && prisma) {
      const globalCycle = await prisma.cycle.findUnique({
        where: { id: targetId }
      });
      if (globalCycle) {
        if (globalCycle.userId === userId) {
          return {
            ...globalCycle,
            revision: globalCycle.revision ?? 1,
            rules: Array.isArray(globalCycle.rules) ? globalCycle.rules : []
          };
        }
        const err: any = new Error('Cycle ID collision: ID already belongs to another user');
        err.code = 'CYCLE_ID_COLLISION';
        throw err;
      }
    } else {
      const globalStoreCycle = memoryStore.cycles.find(c => c.id === targetId);
      if (globalStoreCycle) {
        if (globalStoreCycle.userId === userId) {
          return { ...globalStoreCycle, revision: globalStoreCycle.revision ?? 1 };
        }
        const err: any = new Error('Cycle ID collision: ID already belongs to another user');
        err.code = 'CYCLE_ID_COLLISION';
        throw err;
      }
    }
  }

  const now = new Date().toISOString();
  const newCycle: DBCycle = {
    id: targetId || `cycle-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId,
    title: data.title,
    startDate: data.startDate,
    endDate: data.endDate,
    targetTheme: data.targetTheme || null,
    inheritedStreak: data.inheritedStreak || 0,
    rules: data.rules || [],
    isArchived: false,
    reportRead: false,
    revision: 1,
    createdAt: now,
    updatedAt: now
  };

  if (isPrismaAvailable && prisma) {
    try {
      const created = await prisma.cycle.create({
        data: {
          id: newCycle.id,
          userId: newCycle.userId,
          title: newCycle.title,
          startDate: newCycle.startDate,
          endDate: newCycle.endDate,
          targetTheme: newCycle.targetTheme,
          inheritedStreak: newCycle.inheritedStreak,
          rules: newCycle.rules,
          isArchived: newCycle.isArchived,
          reportRead: newCycle.reportRead,
          revision: 1
        }
      });
      return {
        ...created,
        revision: created.revision ?? 1,
        rules: Array.isArray(created.rules) ? created.rules : []
      };
    } catch (e: any) {
      if (e?.code === 'P2002') {
        const err: any = new Error('Cycle ID collision: ID already exists');
        err.code = 'CYCLE_ID_COLLISION';
        throw err;
      }
      throw e;
    }
  }

  memoryStore.cycles.push(newCycle);
  saveLocalStore();
  return newCycle;
}

export async function updateCycle(
  userId: string,
  cycleId: string,
  data: Partial<Omit<DBCycle, 'id' | 'userId' | 'createdAt'>>,
  expectedRevision?: number
): Promise<DBCycle | null> {
  const now = new Date().toISOString();

  // Enforce mandatory expectedRevision for optimistic concurrency
  if (expectedRevision === undefined || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
    throw new PreconditionRequiredError({
      entityType: 'CYCLE',
      entityId: cycleId
    });
  }

  // Explicitly sanitize update payload to prevent foreign userId or immutable field mutations
  const safeData: any = {};
  if (typeof data.title === 'string') safeData.title = data.title;
  if (typeof data.startDate === 'string') safeData.startDate = data.startDate;
  if (typeof data.endDate === 'string') safeData.endDate = data.endDate;
  if (data.targetTheme !== undefined) safeData.targetTheme = data.targetTheme;
  if (typeof data.inheritedStreak === 'number') safeData.inheritedStreak = data.inheritedStreak;
  if (Array.isArray(data.rules)) safeData.rules = data.rules;
  if (typeof data.isArchived === 'boolean') safeData.isArchived = data.isArchived;
  if (typeof data.reportRead === 'boolean') safeData.reportRead = data.reportRead;
  if (data.verdict !== undefined) safeData.verdict = data.verdict;

  if (isPrismaAvailable && prisma) {
    const existing = await prisma.cycle.findFirst({
      where: { id: cycleId, userId }
    });
    if (!existing) return null;

    const result = await prisma.cycle.updateMany({
      where: {
        id: cycleId,
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
      const current = await prisma.cycle.findFirst({
        where: { id: cycleId, userId }
      });
      throw new ConcurrencyConflictError({
        entityType: 'CYCLE',
        entityId: cycleId,
        currentRevision: current ? (current.revision ?? 1) : (existing.revision ?? 1),
        expectedRevision
      });
    }

    const updated = await prisma.cycle.findFirst({
      where: { id: cycleId, userId }
    });
    if (!updated) return null;
    return {
      ...updated,
      revision: updated.revision ?? 1,
      rules: Array.isArray(updated.rules) ? updated.rules : []
    };
  }

  const idx = memoryStore.cycles.findIndex(c => c.id === cycleId && c.userId === userId);
  if (idx === -1) return null;

  const existing = memoryStore.cycles[idx];
  const currentRev = existing.revision ?? 1;

  if (currentRev !== expectedRevision) {
    throw new ConcurrencyConflictError({
      entityType: 'CYCLE',
      entityId: cycleId,
      currentRevision: currentRev,
      expectedRevision
    });
  }

  const nextRev = currentRev + 1;
  memoryStore.cycles[idx] = {
    ...existing,
    ...safeData,
    revision: nextRev,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    updatedAt: now
  };

  saveLocalStore();
  return memoryStore.cycles[idx];
}

export async function archiveCycle(userId: string, cycleId: string, expectedRevision?: number): Promise<DBCycle | null> {
  return updateCycle(userId, cycleId, { isArchived: true }, expectedRevision);
}

export async function restoreCycle(userId: string, cycleId: string, expectedRevision?: number): Promise<DBCycle | null> {
  return updateCycle(userId, cycleId, { isArchived: false }, expectedRevision);
}

export async function deleteCycle(userId: string, cycleId: string, expectedRevision?: number): Promise<boolean> {
  if (expectedRevision === undefined || typeof expectedRevision !== 'number' || !Number.isInteger(expectedRevision) || expectedRevision <= 0) {
    throw new PreconditionRequiredError({
      entityType: 'CYCLE',
      entityId: cycleId
    });
  }

  if (isPrismaAvailable && prisma) {
    return await prisma.$transaction(async (tx: any) => {
      const existing = await tx.cycle.findFirst({
        where: { id: cycleId, userId }
      });
      if (!existing) return false;

      const result = await tx.cycle.deleteMany({
        where: {
          id: cycleId,
          userId,
          revision: expectedRevision
        }
      });

      if (result.count === 0) {
        const current = await tx.cycle.findFirst({
          where: { id: cycleId, userId }
        });
        throw new ConcurrencyConflictError({
          entityType: 'CYCLE',
          entityId: cycleId,
          currentRevision: current ? (current.revision ?? 1) : (existing.revision ?? 1),
          expectedRevision
        });
      }

      await tx.dailyLog.deleteMany({ where: { cycleId, userId } });
      return true;
    });
  }

  const existingIdx = memoryStore.cycles.findIndex(c => c.id === cycleId && c.userId === userId);
  if (existingIdx === -1) return false;

  const existing = memoryStore.cycles[existingIdx];
  const currentRev = existing.revision ?? 1;

  if (currentRev !== expectedRevision) {
    throw new ConcurrencyConflictError({
      entityType: 'CYCLE',
      entityId: cycleId,
      currentRevision: currentRev,
      expectedRevision
    });
  }

  memoryStore.cycles.splice(existingIdx, 1);
  memoryStore.dailyLogs = memoryStore.dailyLogs.filter(l => !(l.cycleId === cycleId && l.userId === userId));
  saveLocalStore();
  return true;
}
