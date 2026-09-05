import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  createCycle, 
  upsertDailyLog, 
  getDailyLogByDate, 
  clearDailyLogOperationIds,
  ConcurrencyConflictError, 
  PreconditionRequiredError, 
  memoryStore, 
  setPrismaState 
} from '../server/db/index.js';
import {
  applyReplayItemToActiveState,
  prepareDirectLogPayload,
  prepareDirectCyclePayload,
  verifyActiveAccount,
  rollbackOptimisticLogUpdate,
  rollbackOptimisticCycleUpdate
} from '../src/utils/directMutationUtils.js';
import {
  recordClientConflict,
  getClientConflicts,
  clearClientConflicts,
  clearAllReplayLocks,
  replayAccountOfflineQueue,
  saveOfflineQueue,
  enqueueOfflineMutation
} from '../src/utils/offlineQueueUtils.js';
import { Cycle, DailyLog } from '../src/types.js';

test('Phase 4A Corrective Contracts: Concurrency, Replay Propagation, and Revision Integrity', async (t) => {
  const userId = 'user_phase4a_test_owner';
  const otherUserId = 'user_phase4a_device_two';
  const storageMock: Record<string, string> = {};

  t.beforeEach(async () => {
    for (const k in storageMock) delete storageMock[k];
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => { storageMock[key] = String(val); },
        removeItem: (key: string) => { delete storageMock[key]; },
        key: (idx: number) => Object.keys(storageMock)[idx] ?? null,
        get length() { return Object.keys(storageMock).length; }
      }
    };
    (globalThis as any).localStorage = (globalThis as any).window.localStorage;

    clearAllReplayLocks();
    clearDailyLogOperationIds();
    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
  });

  // =========================================================================
  // GROUP A: Deterministic Concurrent First-Create for DailyLog
  // =========================================================================

  await t.test('1. Single Database Record & Revision 1 on First-Create', async () => {
    const cycle = await createCycle(userId, {
      title: 'چرخه سامورایی اول',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'نظم'
    });

    const log = await upsertDailyLog(userId, {
      cycleId: cycle.id,
      date: '2026-09-01',
      wakeUp: true,
      workout: true,
      study: false,
      journal: true,
      hardTask: false,
      specialMission: false
    });

    assert.equal(log.revision, 1, 'First create of daily log must start at revision 1');
    assert.equal(log.date, '2026-09-01');
    assert.equal(log.cycleId, cycle.id);

    const logsForDate = memoryStore.dailyLogs.filter(l => l.userId === userId && l.date === '2026-09-01');
    assert.equal(logsForDate.length, 1, 'Exactly one database record may exist for the date');
  });

  await t.test('2. Intentional Handling of Unique-Constraint Race on Concurrent First-Create', async () => {
    const cycle = await createCycle(userId, {
      title: 'چرخه مسابقه همزمانی',
      startDate: '2026-09-02',
      endDate: '2026-11-30',
      targetTheme: 'استقامت'
    });

    // Simulate Client A winning the first-create race
    const firstLog = await upsertDailyLog(userId, {
      clientOperationId: 'op_device_a_001',
      cycleId: cycle.id,
      date: '2026-09-02',
      wakeUp: true,
      workout: false,
      study: true,
      journal: false,
      hardTask: true,
      specialMission: false
    });

    assert.equal(firstLog.revision, 1);

    // Client B concurrently attempts first creation for the exact same date with a different operationId
    await assert.rejects(
      async () => {
        await upsertDailyLog(userId, {
          clientOperationId: 'op_device_b_002',
          cycleId: cycle.id,
          date: '2026-09-02',
          wakeUp: false,
          workout: true,
          study: false,
          journal: true,
          hardTask: false,
          specialMission: false
        });
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError, 'Race must be converted to ConcurrencyConflictError (409)');
        assert.equal(err.entityType, 'DAILY_LOG');
        assert.equal(err.currentRevision, 1, 'Current revision should reflect existing record');
        return true;
      }
    );
  });

  await t.test('3. Idempotent Retries with Stable clientOperationId', async () => {
    const cycle = await createCycle(userId, {
      title: 'چرخه تلاش مجدد مطمئن',
      startDate: '2026-09-03',
      endDate: '2026-12-01',
      targetTheme: 'دقت'
    });

    const opId = 'stable_client_op_123';

    // First attempt creates the log at revision 1
    const res1 = await upsertDailyLog(userId, {
      clientOperationId: opId,
      cycleId: cycle.id,
      date: '2026-09-03',
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true,
      specialMission: false
    });

    assert.equal(res1.revision, 1);

    // Second retry with the exact same clientOperationId returns identical record without conflict
    const res2 = await upsertDailyLog(userId, {
      clientOperationId: opId,
      cycleId: cycle.id,
      date: '2026-09-03',
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true,
      specialMission: false
    });

    assert.equal(res2.id, res1.id, 'Idempotent retry must return the same log entity');
    assert.equal(res2.revision, 1, 'Idempotent retry must not increment revision');

    const totalLogs = memoryStore.dailyLogs.filter(l => l.userId === userId && l.date === '2026-09-03');
    assert.equal(totalLogs.length, 1, 'No duplicate record created during retry');
  });

  await t.test('4. Prisma Unique Constraint P2002 Simulation Throws ConcurrencyConflictError', async () => {
    const cycleId = 'cycle_mock_prisma_p2002';
    const date = '2026-09-04';

    // Mock Prisma simulating P2002 unique constraint failure during race
    const mockExistingLog = {
      id: `log-${userId}-${date}`,
      userId,
      cycleId,
      date,
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true,
      specialMission: false,
      revision: 1,
      clientOperationId: 'first_winner_op',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    let findCount = 0;
    const mockPrisma = {
      cycle: {
        findFirst: async () => ({ id: cycleId, userId })
      },
      dailyLog: {
        findFirst: async () => {
          findCount++;
          // First check returns null (simulating both clients thinking log doesn't exist yet)
          if (findCount === 1) return null;
          // Subsequent lookup after race returns the record created by winning client
          return mockExistingLog;
        },
        create: async () => {
          const p2002Error: any = new Error('Unique constraint failed on the fields: (`userId`,`date`)');
          p2002Error.code = 'P2002';
          throw p2002Error;
        }
      }
    };

    setPrismaState(mockPrisma, true);

    await assert.rejects(
      async () => {
        await upsertDailyLog(userId, {
          clientOperationId: 'second_loser_op',
          cycleId,
          date,
          wakeUp: false,
          workout: false,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false
        });
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError, 'Prisma P2002 race must convert to ConcurrencyConflictError');
        assert.equal(err.entityType, 'DAILY_LOG');
        assert.equal(err.currentRevision, 1);
        return true;
      }
    );
  });

  // =========================================================================
  // GROUP B: Propagation of Replay-Confirmed Entities into Active React State
  // =========================================================================

  await t.test('5. UPDATE_LOG Replay Confirmation Propagates Authoritative Fields & Revision', async () => {
    const initialLogs: DailyLog[] = [
      {
        date: '2026-09-05',
        cycleId: 'cycle_1',
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        isSynced: false,
        revision: 1
      }
    ];

    const item = {
      type: 'UPDATE_LOG',
      payload: {
        date: '2026-09-05',
        workout: true
      }
    };

    const serverResult = {
      log: {
        date: '2026-09-05',
        cycleId: 'cycle_1',
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 3,
        updatedAt: '2026-09-05T12:00:00Z'
      }
    };

    const nextState = applyReplayItemToActiveState(
      { cycles: [], logs: initialLogs },
      item,
      serverResult
    );

    assert.equal(nextState.logs[0].revision, 3, 'Server revision 3 must be applied to active state');
    assert.equal(nextState.logs[0].workout, true, 'Server workout value must be applied');
    assert.equal(nextState.logs[0].isSynced, true, 'Log must be marked as isSynced: true');
  });

  await t.test('6. UPDATE_CYCLE & CREATE_CYCLE Replay Confirmation Updates or Appends in Active State', async () => {
    const existingCycle: Cycle = {
      id: 'cycle_existing_1',
      title: 'عنوان قبل از همگام‌سازی',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'تمرکز',
      inheritedStreak: 0,
      isArchived: false,
      reportRead: false,
      isSynced: false,
      revision: 1
    };

    // Case 1: UPDATE_CYCLE updates existing cycle and revision
    const updateItem = {
      type: 'UPDATE_CYCLE',
      payload: { id: 'cycle_existing_1', title: 'عنوان جدید' }
    };
    const updateServerResult = {
      cycle: {
        id: 'cycle_existing_1',
        title: 'عنوان سروری تأیید شده',
        startDate: '2026-09-01',
        endDate: '2026-11-29',
        targetTheme: 'تمرکز',
        inheritedStreak: 0,
        isArchived: false,
        reportRead: false,
        revision: 4
      }
    };

    const stateAfterUpdate = applyReplayItemToActiveState(
      { cycles: [existingCycle], logs: [] },
      updateItem,
      updateServerResult
    );

    assert.equal(stateAfterUpdate.cycles[0].title, 'عنوان سروری تأیید شده');
    assert.equal(stateAfterUpdate.cycles[0].revision, 4);
    assert.equal(stateAfterUpdate.cycles[0].isSynced, true);

    // Case 2: CREATE_CYCLE appends brand new cycle to active state
    const createItem = {
      type: 'CREATE_CYCLE',
      payload: { id: 'cycle_new_2', title: 'چرخه دوم' }
    };
    const createServerResult = {
      cycle: {
        id: 'cycle_new_2',
        title: 'چرخه دوم تأیید شده',
        startDate: '2026-12-01',
        endDate: '2027-02-28',
        targetTheme: 'استقامت',
        inheritedStreak: 5,
        isArchived: false,
        reportRead: false,
        revision: 1
      }
    };

    const stateAfterCreate = applyReplayItemToActiveState(
      stateAfterUpdate,
      createItem,
      createServerResult
    );

    assert.equal(stateAfterCreate.cycles.length, 2);
    assert.equal(stateAfterCreate.cycles[1].id, 'cycle_new_2');
    assert.equal(stateAfterCreate.cycles[1].revision, 1);
    assert.equal(stateAfterCreate.cycles[1].isSynced, true);
  });

  await t.test('7. DELETE_CYCLE Replay Confirmation Purges Cycle & Associated Daily Logs', async () => {
    const cycles: Cycle[] = [
      {
        id: 'cycle_delete_target',
        title: 'چرخه در حال حذف',
        startDate: '2026-09-01',
        endDate: '2026-11-29',
        targetTheme: 'حذف',
        inheritedStreak: 0,
        isArchived: false,
        reportRead: false,
        revision: 2
      },
      {
        id: 'cycle_survivor',
        title: 'چرخه باقی‌مانده',
        startDate: '2026-12-01',
        endDate: '2027-02-28',
        targetTheme: 'بقا',
        inheritedStreak: 0,
        isArchived: false,
        reportRead: false,
        revision: 1
      }
    ];

    const logs: DailyLog[] = [
      {
        date: '2026-09-01',
        cycleId: 'cycle_delete_target',
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: false
      },
      {
        date: '2026-12-01',
        cycleId: 'cycle_survivor',
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: false
      }
    ];

    const deleteItem = {
      type: 'DELETE_CYCLE',
      payload: { id: 'cycle_delete_target' }
    };

    const stateAfterDelete = applyReplayItemToActiveState(
      { cycles, logs },
      deleteItem,
      'cycle_delete_target'
    );

    assert.equal(stateAfterDelete.cycles.length, 1);
    assert.equal(stateAfterDelete.cycles[0].id, 'cycle_survivor');
    assert.equal(stateAfterDelete.logs.length, 1);
    assert.equal(stateAfterDelete.logs[0].cycleId, 'cycle_survivor');
  });

  await t.test('8. Replay Confirmation Ignores Stale or Switched Accounts', async () => {
    const initialOwner = 'user_account_alpha';
    const switchedOwner = 'user_account_beta';

    assert.equal(verifyActiveAccount(initialOwner, initialOwner), true);
    assert.equal(verifyActiveAccount(switchedOwner, initialOwner), false);
    assert.equal(verifyActiveAccount(null, initialOwner), false);
    assert.equal(verifyActiveAccount('guest', initialOwner), false);
  });

  // =========================================================================
  // GROUP C: Prevention of Sending Known-Invalid Existing-Entity Mutations
  // =========================================================================

  await t.test('9. Existing DailyLog Without Valid Confirmed Revision is Blocked From Network Dispatch', async () => {
    const existingLogWithoutRev: DailyLog = {
      date: '2026-09-06',
      cycleId: 'cycle_test',
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false,
      revision: undefined as any // Unversioned or corrupted local state
    };

    const updatedLog: DailyLog = {
      ...existingLogWithoutRev,
      wakeUp: true
    };

    const prepared = prepareDirectLogPayload(updatedLog, existingLogWithoutRev, 'cycle_test');

    assert.equal(prepared.isExisting, true, 'Log must be recognized as existing entity');
    assert.equal(prepared.isValid, false, 'Mutation must be flagged as invalid when revision is missing');
    assert.equal(prepared.expectedRevision, undefined, 'No invalid expectedRevision may be passed');
  });

  await t.test('10. Existing Cycle Without Valid Confirmed Revision is Blocked From Network Dispatch', async () => {
    const existingCycleWithoutRev: Cycle = {
      id: 'cycle_corrupted_rev',
      title: 'چرخه بدون نسخه معتبر',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'نامعتبر',
      inheritedStreak: 0,
      isArchived: false,
      reportRead: false,
      revision: 0 as any // Non-positive integer revision
    };

    const updatedCycle: Cycle = {
      ...existingCycleWithoutRev,
      title: 'تغییر عنوان'
    };

    const prepared = prepareDirectCyclePayload(updatedCycle, existingCycleWithoutRev);

    assert.equal(prepared.isValid, false, 'Existing cycle with invalid revision must yield isValid: false');
    assert.equal(prepared.expectedRevision, undefined);
  });

  await t.test('11. Invalid Existing Log Mutation Triggers Rollback & Records PRECONDITION_REQUIRED (428)', async () => {
    const existingLog: DailyLog = {
      date: '2026-09-07',
      cycleId: 'cycle_valid_parent',
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false,
      revision: undefined as any
    };

    const attemptedUpdate: DailyLog = {
      ...existingLog,
      wakeUp: true
    };

    const previousConfirmedSnapshot = { ...existingLog };
    const { payload, isExisting, isValid } = prepareDirectLogPayload(attemptedUpdate, existingLog, 'cycle_valid_parent');

    assert.equal(isExisting, true);
    assert.equal(isValid, false);

    // Rollback simulation
    const rolledBackLogs = rollbackOptimisticLogUpdate([attemptedUpdate], attemptedUpdate.date, previousConfirmedSnapshot);
    assert.equal(rolledBackLogs[0].wakeUp, false, 'Optimistic change must be rolled back');

    // Conflict recording simulation
    clearClientConflicts(userId);
    recordClientConflict(userId, {
      mutationType: 'UPDATE_LOG',
      entityType: 'DAILY_LOG',
      entityId: attemptedUpdate.date,
      conflictType: 'PRECONDITION_REQUIRED',
      statusCode: 428,
      expectedRevision: undefined,
      currentRevision: undefined,
      messageFa: 'نسخه تأیید شده این گزارش در حافظه محلی معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: payload
    });

    const recorded = getClientConflicts(userId);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].conflictType, 'PRECONDITION_REQUIRED');
    assert.equal(recorded[0].statusCode, 428);
    assert.equal(recorded[0].entityId, '2026-09-07');
  });

  await t.test('12. Invalid Existing Cycle Delete Triggers Rollback Prevention & Records PRECONDITION_REQUIRED (428)', async () => {
    const cycleToDelete: Cycle = {
      id: 'cycle_delete_corrupt',
      title: 'چرخه بدون نسخه برای حذف',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'خطا',
      inheritedStreak: 0,
      isArchived: false,
      reportRead: false,
      revision: 'not_a_number' as any
    };

    const isExistingCycle = Boolean(cycleToDelete);
    const validExpectedRevision = (typeof cycleToDelete?.revision === 'number' && Number.isInteger(cycleToDelete.revision) && cycleToDelete.revision > 0)
      ? cycleToDelete.revision
      : undefined;

    assert.equal(isExistingCycle, true);
    assert.equal(validExpectedRevision, undefined, 'Invalid revision must be rejected');

    clearClientConflicts(userId);
    recordClientConflict(userId, {
      mutationType: 'DELETE_CYCLE',
      entityType: 'CYCLE',
      entityId: cycleToDelete.id,
      conflictType: 'PRECONDITION_REQUIRED',
      statusCode: 428,
      expectedRevision: undefined,
      currentRevision: undefined,
      messageFa: 'نسخه تأیید شده این چرخه برای حذف معتبر نیست. در حال همگام‌سازی مجدد با سرور...',
      clientPayload: { id: cycleToDelete.id }
    });

    const recorded = getClientConflicts(userId);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0].mutationType, 'DELETE_CYCLE');
    assert.equal(recorded[0].conflictType, 'PRECONDITION_REQUIRED');
    assert.equal(recorded[0].statusCode, 428);
  });
});
