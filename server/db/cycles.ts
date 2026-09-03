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

export async function createCycle(
  userId: string,
  data: {
    title: string;
    startDate: string;
    endDate: string;
    targetTheme?: string;
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

  if (isPrismaAvailable && prisma) {
    try {
      const existing = await prisma.cycle.findFirst({
        where: { id: cycleId, userId }
      });
      if (!existing) return null;

      const updated = await prisma.cycle.update({
        where: { id: cycleId },
        data: {
          ...data,
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

  memoryStore.cycles[idx] = {
    ...memoryStore.cycles[idx],
    ...data,
    updatedAt: now
  };

  saveLocalStore();
  return memoryStore.cycles[idx];
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

  const initialCycleCount = memoryStore.cycles.length;
  memoryStore.cycles = memoryStore.cycles.filter(c => !(c.id === cycleId && c.userId === userId));
  memoryStore.dailyLogs = memoryStore.dailyLogs.filter(l => !(l.cycleId === cycleId && l.userId === userId));

  if (memoryStore.cycles.length < initialCycleCount) {
    saveLocalStore();
    return true;
  }
  return false;
}
