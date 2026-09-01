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

  let logs = memoryStore.dailyLogs.filter(l => l.userId === userId);
  if (cycleId) {
    logs = logs.filter(l => l.cycleId === cycleId);
  }

  return logs.sort((a, b) => a.date.localeCompare(b.date));
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

  if (isPrismaAvailable && prisma) {
    try {
      const upserted = await prisma.dailyLog.upsert({
        where: {
          userId_date: {
            userId,
            date: data.date
          }
        },
        update: {
          cycleId: data.cycleId,
          wakeUp: data.wakeUp,
          workout: data.workout,
          study: data.study,
          journal: data.journal,
          hardTask: data.hardTask,
          specialMission: data.specialMission,
          failureReason: data.failureReason,
          failureTime: data.failureTime,
          autopsyNotes: data.autopsyNotes,
          countermeasure: data.countermeasure,
          aiFeedback: data.aiFeedback,
          notes: data.notes,
          updatedAt: new Date()
        },
        create: {
          id: `log-${userId}-${data.date}`,
          userId,
          cycleId: data.cycleId,
          date: data.date,
          wakeUp: data.wakeUp,
          workout: data.workout,
          study: data.study,
          journal: data.journal,
          hardTask: data.hardTask,
          specialMission: data.specialMission,
          failureReason: data.failureReason,
          failureTime: data.failureTime,
          autopsyNotes: data.autopsyNotes,
          countermeasure: data.countermeasure,
          aiFeedback: data.aiFeedback,
          notes: data.notes
        }
      });
      return {
        ...upserted,
        createdAt: upserted.createdAt instanceof Date ? upserted.createdAt.toISOString() : upserted.createdAt,
        updatedAt: upserted.updatedAt instanceof Date ? upserted.updatedAt.toISOString() : upserted.updatedAt
      };
    } catch (e) {
      console.warn('[Database] Prisma upsertDailyLog failed, falling back to local store:', e);
    }
  }

  const existingIdx = memoryStore.dailyLogs.findIndex(
    l => l.userId === userId && l.date === data.date
  );

  if (existingIdx >= 0) {
    memoryStore.dailyLogs[existingIdx] = {
      ...memoryStore.dailyLogs[existingIdx],
      ...data,
      updatedAt: now
    };
    saveLocalStore();
    return memoryStore.dailyLogs[existingIdx];
  } else {
    const newLog: DBDailyLog = {
      id: `log-${userId}-${data.date}`,
      userId,
      ...data,
      createdAt: now,
      updatedAt: now
    };
    memoryStore.dailyLogs.push(newLog);
    saveLocalStore();
    return newLog;
  }
}
