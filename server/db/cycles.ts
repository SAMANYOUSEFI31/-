import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBCycle,
  seedUserData
} from './base';

export async function getUserCycles(userId: string): Promise<DBCycle[]> {
  if (isPrismaAvailable && prisma) {
    try {
      const cycles = await prisma.cycle.findMany({
        where: { userId },
        orderBy: { startDate: 'asc' }
      });
      return cycles.map((c: any) => ({
        ...c,
        rules: Array.isArray(c.rules) ? c.rules : []
      }));
    } catch (e) {
      console.warn('[Database] Prisma getUserCycles failed, checking local store:', e);
    }
  }

  const cycles = memoryStore.cycles.filter(c => c.userId === userId);
  return cycles.sort((a, b) => a.startDate.localeCompare(b.startDate));
}

export async function getCycleById(userId: string, cycleId: string): Promise<DBCycle | null> {
  if (isPrismaAvailable && prisma) {
    try {
      const cycle = await prisma.cycle.findFirst({
        where: { id: cycleId, userId }
      });
      if (!cycle) return null;
      return {
        ...cycle,
        rules: Array.isArray(cycle.rules) ? cycle.rules : []
      };
    } catch (e) {
      console.warn('[Database] Prisma getCycleById failed, checking local store:', e);
    }
  }

  const cycle = memoryStore.cycles.find(c => c.id === cycleId && c.userId === userId);
  return cycle ? { ...cycle } : null;
}

export async function createCycle(
  userId: string,
  data: {
    title: string;
    startDate: string;
    endDate: string;
    targetTheme?: string | null;
    inheritedStreak?: number;
    rules?: string[];
  }
): Promise<DBCycle> {
  const now = new Date().toISOString();
  const newCycle: DBCycle = {
    id: `cycle-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    userId,
    title: data.title,
    startDate: data.startDate,
    endDate: data.endDate,
    targetTheme: data.targetTheme || null,
    inheritedStreak: data.inheritedStreak || 0,
    rules: data.rules || [],
    isArchived: false,
    reportRead: false,
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
          reportRead: newCycle.reportRead
        }
      });
      return {
        ...created,
        rules: Array.isArray(created.rules) ? created.rules : []
      };
    } catch (e) {
      console.warn('[Database] Prisma createCycle failed, saving to local store:', e);
    }
  }

  memoryStore.cycles.push(newCycle);
  saveLocalStore();
  return newCycle;
}

export async function updateCycle(
  userId: string,
  cycleId: string,
  data: Partial<Omit<DBCycle, 'id' | 'userId' | 'createdAt'>>
): Promise<DBCycle | null> {
  const now = new Date().toISOString();

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
    try {
      const existing = await prisma.cycle.findFirst({
        where: { id: cycleId, userId }
      });
      if (!existing) return null;

      const updated = await prisma.cycle.update({
        where: { id: cycleId },
        data: {
          ...safeData,
          updatedAt: new Date()
        }
      });
      return {
        ...updated,
        rules: Array.isArray(updated.rules) ? updated.rules : []
      };
    } catch (e) {
      console.warn('[Database] Prisma updateCycle failed, updating local store:', e);
    }
  }

  const idx = memoryStore.cycles.findIndex(c => c.id === cycleId && c.userId === userId);
  if (idx === -1) return null;

  const existing = memoryStore.cycles[idx];
  memoryStore.cycles[idx] = {
    ...existing,
    ...safeData,
    id: existing.id,
    userId: existing.userId,
    createdAt: existing.createdAt,
    updatedAt: now
  };

  saveLocalStore();
  return memoryStore.cycles[idx];
}

export async function archiveCycle(userId: string, cycleId: string): Promise<DBCycle | null> {
  return updateCycle(userId, cycleId, { isArchived: true });
}

export async function restoreCycle(userId: string, cycleId: string): Promise<DBCycle | null> {
  return updateCycle(userId, cycleId, { isArchived: false });
}

export async function deleteCycle(userId: string, cycleId: string): Promise<boolean> {
  if (isPrismaAvailable && prisma) {
    try {
      const existing = await prisma.cycle.findFirst({
        where: { id: cycleId, userId }
      });
      if (!existing) return false;

      await prisma.dailyLog.deleteMany({ where: { cycleId, userId } });
      await prisma.cycle.delete({ where: { id: cycleId } });
      return true;
    } catch (e) {
      console.warn('[Database] Prisma deleteCycle failed, deleting in local store:', e);
    }
  }

  const existingIdx = memoryStore.cycles.findIndex(c => c.id === cycleId && c.userId === userId);
  if (existingIdx === -1) return false;

  memoryStore.cycles.splice(existingIdx, 1);
  memoryStore.dailyLogs = memoryStore.dailyLogs.filter(l => !(l.cycleId === cycleId && l.userId === userId));
  saveLocalStore();
  return true;
}
