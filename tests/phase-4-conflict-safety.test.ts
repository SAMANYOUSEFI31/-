import test from 'node:test';
import assert from 'node:assert/strict';
import { 
  createCycle, 
  getCycleById, 
  updateCycle, 
  deleteCycle, 
  upsertDailyLog, 
  getDailyLogByDate, 
  updateDailyLog, 
  deleteDailyLog,
  ConcurrencyConflictError,
  memoryStore,
  setPrismaState
} from '../server/db/index.js';
import {
  classifyReplayResponse,
  enqueueOfflineMutation,
  getOfflineQueue,
  getQuarantinedItems,
  clearQuarantine,
  replayAccountOfflineQueue,
  saveOfflineQueue,
  clearAllReplayLocks
} from '../src/utils/offlineQueueUtils.js';
import {
  updateCycleSchema,
  upsertDailyLogSchema,
  updateDailyLogSchema
} from '../server/utils/validation.js';

test('Phase 4: Multi-device Conflict Safety & Optimistic Concurrency', async (t) => {
  const userId = 'user_conflict_test_101';
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
    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
  });

  await t.test('1. Monotonic Revision Initialization & Conditional Updates on Cycles', async () => {
    // A newly created cycle starts at revision = 1
    const cycle = await createCycle(userId, {
      title: 'چرخه آزمایشی تعارض',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'تمرکز مطلق'
    });

    assert.equal(cycle.revision, 1, 'Initial cycle revision must be 1');

    // Matching expectedRevision = 1 succeeds and increments to 2
    const updated1 = await updateCycle(userId, cycle.id, {
      title: 'چرخه با ویرایش اول'
    }, 1);

    assert.ok(updated1, 'Update with matching revision should succeed');
    assert.equal(updated1.revision, 2, 'Revision must be incremented to 2');

    // Stale expectedRevision = 1 must be rejected with ConcurrencyConflictError (409)
    await assert.rejects(
      async () => {
        await updateCycle(userId, cycle.id, { title: 'ویرایش با نسخه قدیمی' }, 1);
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError, 'Error must be ConcurrencyConflictError');
        assert.equal(err.code, 'CONFLICT');
        assert.equal(err.entityType, 'CYCLE');
        assert.equal(err.entityId, cycle.id);
        assert.equal(err.expectedRevision, 1);
        assert.equal(err.currentRevision, 2);
        assert.ok(err.serverState, 'Server state must be included in conflict error');
        assert.equal(err.serverState.revision, 2);
        return true;
      }
    );

    // Matching expectedRevision = 2 succeeds and increments to 3
    const updated2 = await updateCycle(userId, cycle.id, {
      title: 'چرخه با ویرایش دوم'
    }, 2);
    assert.equal(updated2?.revision, 3, 'Revision must be incremented to 3');

    // Unconditional update (no expectedRevision supplied) succeeds and increments to 4
    const updated3 = await updateCycle(userId, cycle.id, {
      title: 'چرخه بدون شرط نسخه'
    });
    assert.equal(updated3?.revision, 4, 'Unconditional update must increment revision');
  });

  await t.test('2. Atomic Conditional Deletions on Cycles', async () => {
    const cycle = await createCycle(userId, {
      title: 'چرخه حذف مشروط',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'تست حذف'
    });
    assert.equal(cycle.revision, 1);

    // Stale expectedRevision = 99 must fail with ConcurrencyConflictError
    await assert.rejects(
      async () => {
        await deleteCycle(userId, cycle.id, 99);
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError);
        assert.equal(err.expectedRevision, 99);
        assert.equal(err.currentRevision, 1);
        return true;
      }
    );

    // Cycle still exists
    const stillThere = await getCycleById(userId, cycle.id);
    assert.ok(stillThere, 'Cycle must not be deleted if expectedRevision did not match');

    // Correct expectedRevision = 1 deletes successfully
    const deleted = await deleteCycle(userId, cycle.id, 1);
    assert.equal(deleted, true, 'Delete with matching expectedRevision must succeed');

    const gone = await getCycleById(userId, cycle.id);
    assert.equal(gone, null, 'Cycle must be deleted');
  });

  await t.test('3. Monotonic Revision & Concurrency on Daily Logs', async () => {
    const cycle = await createCycle(userId, {
      title: 'چرخه گزارش‌ها',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'تست گزارش'
    });

    // Create log via upsertDailyLog -> starts with revision = 1
    const log1 = await upsertDailyLog(userId, {
      cycleId: cycle.id,
      date: '2026-09-05',
      wakeUp: true,
      workout: true,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false
    });

    assert.equal(log1.revision, 1, 'Newly inserted log must have revision = 1');

    // Update log with matching expectedRevision = 1 succeeds -> revision = 2
    const log2 = await upsertDailyLog(userId, {
      cycleId: cycle.id,
      date: '2026-09-05',
      study: true
    }, 1);

    assert.equal(log2.revision, 2, 'Updated log revision must be 2');
    assert.equal(log2.study, true);

    // Stale expectedRevision = 1 fails with ConcurrencyConflictError
    await assert.rejects(
      async () => {
        await upsertDailyLog(userId, {
          cycleId: cycle.id,
          date: '2026-09-05',
          journal: true
        }, 1);
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError);
        assert.equal(err.entityType, 'DAILY_LOG');
        assert.equal(err.expectedRevision, 1);
        assert.equal(err.currentRevision, 2);
        assert.equal(err.serverState.revision, 2);
        return true;
      }
    );

    // Conditional updateDailyLog by ID with stale expectedRevision fails
    await assert.rejects(
      async () => {
        await updateDailyLog(userId, log1.id, { workout: false }, 1);
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError);
        assert.equal(err.expectedRevision, 1);
        assert.equal(err.currentRevision, 2);
        return true;
      }
    );

    // Conditional updateDailyLog by ID with matching expectedRevision = 2 succeeds
    const log3 = await updateDailyLog(userId, log1.id, { workout: false }, 2);
    assert.equal(log3?.revision, 3, 'Log revision must advance to 3');
    assert.equal(log3?.workout, false);

    // Conditional delete with stale expectedRevision = 1 fails
    await assert.rejects(
      async () => {
        await deleteDailyLog(userId, log1.id, 1);
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError);
        return true;
      }
    );

    // Conditional delete with matching expectedRevision = 3 succeeds
    const deleted = await deleteDailyLog(userId, log1.id, 3);
    assert.equal(deleted, true);

    const logLookup = await getDailyLogByDate(userId, '2026-09-05');
    assert.equal(logLookup, null, 'Deleted log must no longer exist');
  });

  await t.test('4. Two-Device Race Simulation: First-committer wins, second receives 409', async () => {
    // Device 1 and Device 2 both load Cycle A at revision = 1
    const cycle = await createCycle(userId, {
      title: 'چرخه مسابقه همزمانی',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'مسابقه'
    });
    assert.equal(cycle.revision, 1);

    // Device 1 submits mutation first with expectedRevision = 1
    const dev1Result = await updateCycle(userId, cycle.id, {
      title: 'عنوان ویرایش‌شده توسط دستگاه ۱'
    }, 1);
    assert.equal(dev1Result?.revision, 2);
    assert.equal(dev1Result?.title, 'عنوان ویرایش‌شده توسط دستگاه ۱');

    // Device 2 submits mutation with expectedRevision = 1 (stale, unaware of Device 1)
    let conflictCaught = false;
    try {
      await updateCycle(userId, cycle.id, {
        title: 'عنوان بازنویسی‌شده توسط دستگاه ۲'
      }, 1);
    } catch (err: any) {
      conflictCaught = true;
      assert.ok(err instanceof ConcurrencyConflictError);
      assert.equal(err.currentRevision, 2);
      assert.equal(err.expectedRevision, 1);
      assert.equal(err.serverState.title, 'عنوان ویرایش‌شده توسط دستگاه ۱');
    }
    assert.equal(conflictCaught, true, 'Device 2 must be rejected with ConcurrencyConflictError');

    // Verify Device 1 change was NOT overwritten
    const current = await getCycleById(userId, cycle.id);
    assert.equal(current?.title, 'عنوان ویرایش‌شده توسط دستگاه ۱');
    assert.equal(current?.revision, 2);
  });

  await t.test('5. Replay Classification & Quarantine on HTTP 409 Conflict', async () => {
    const classification = classifyReplayResponse(409, 'UPDATE_LOG');
    assert.equal(classification, 'CONFLICT_DEFERRED', 'HTTP 409 must classify as CONFLICT_DEFERRED');

    const cycleClassification = classifyReplayResponse(409, 'UPDATE_CYCLE');
    assert.equal(cycleClassification, 'CONFLICT_DEFERRED', 'HTTP 409 must classify as CONFLICT_DEFERRED');
  });

  await t.test('6. Replay Loop Isolates and Quarantines 409 Conflict without Infinite Loop', async () => {
    clearQuarantine(userId);
    saveOfflineQueue(userId, []);

    // Enqueue an offline update with stale expectedRevision
    const queuedItem = enqueueOfflineMutation(userId, {
      type: 'UPDATE_LOG',
      payload: {
        cycleId: 'cycle_100',
        date: '2026-09-05',
        workout: true
      },
      expectedRevision: 1
    });

    assert.equal(queuedItem.expectedRevision, 1, 'Queue item must preserve expectedRevision');

    // Mock fetch that simulates a 409 conflict from server
    let fetchCalled = 0;
    const mockFetch = async (url: any, init: any) => {
      fetchCalled++;
      const body = JSON.parse(init.body);
      assert.equal(body.expectedRevision, 1, 'Fetch body must carry expectedRevision');

      return {
        status: 409,
        ok: false,
        json: async () => ({
          code: 'CONFLICT',
          messageFa: 'این گزارش در دستگاه دیگری به‌روزرسانی شده است.',
          currentRevision: 3,
          expectedRevision: 1,
          entityType: 'DailyLog',
          entityId: 'log_123'
        }),
        clone() { return this; }
      } as any;
    };

    let failureItem: any = null;
    let failureErr: any = null;

    const result = await replayAccountOfflineQueue({
      activeAccountId: userId,
      authToken: 'test_token',
      fetchFn: mockFetch,
      onItemFailure: (item, err) => {
        failureItem = item;
        failureErr = err;
      }
    });

    assert.equal(fetchCalled, 1, 'Fetch should be called exactly once');
    assert.equal(result.failedCount, 1, 'Item should be counted as failed');
    assert.equal(result.remainingQueueCount, 0, 'Conflict item must be removed from active queue');

    // Active queue must be empty (item not retrying infinitely)
    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 0, 'Active queue must not retain deferred conflict item');

    // Quarantine must contain the CONFLICT_DEFERRED item with conflict details
    const quarantined = getQuarantinedItems(userId);
    assert.equal(quarantined.length, 1, 'Quarantine must contain the conflicted item entry');
    assert.equal(quarantined[0].items[0].classification, 'CONFLICT_DEFERRED');
    assert.ok(quarantined[0].items[0].lastError?.includes('تعارض') || quarantined[0].items[0].lastError?.includes('به‌روزرسانی'));
  });

  await t.test('7. Validation Schemas Accept revision and expectedRevision', () => {
    // updateCycleSchema
    const cycleParsed = updateCycleSchema.safeParse({
      title: 'تست اعتبارسنجی',
      expectedRevision: 5,
      revision: 5
    });
    assert.ok(cycleParsed.success, 'updateCycleSchema must accept expectedRevision and revision');
    if (cycleParsed.success) {
      assert.equal(cycleParsed.data.expectedRevision, 5);
      assert.equal(cycleParsed.data.revision, 5);
    }

    // upsertDailyLogSchema
    const logParsed = upsertDailyLogSchema.safeParse({
      date: '2026-09-05',
      cycleId: 'cycle_test',
      wakeUp: true,
      expectedRevision: 2
    });
    assert.ok(logParsed.success, 'upsertDailyLogSchema must accept expectedRevision');
    if (logParsed.success) {
      assert.equal(logParsed.data.expectedRevision, 2);
    }

    // updateDailyLogSchema
    const logUpdateParsed = updateDailyLogSchema.safeParse({
      workout: true,
      expectedRevision: 3
    });
    assert.ok(logUpdateParsed.success, 'updateDailyLogSchema must accept expectedRevision');
    if (logUpdateParsed.success) {
      assert.equal(logUpdateParsed.data.expectedRevision, 3);
    }
  });

  await t.test('8. Create Cycle Idempotency is Preserved', async () => {
    const cycle1 = await createCycle(userId, {
      id: 'cycle_idempotent_1',
      title: 'چرخه پایدار تکرارپذیر',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'پایداری',
      clientOperationId: 'op_idemp_1001'
    });

    assert.equal(cycle1.id, 'cycle_idempotent_1');
    assert.equal(cycle1.revision, 1);

    // Replay with identical clientOperationId returns identical cycle
    const cycle2 = await createCycle(userId, {
      id: 'cycle_idempotent_1',
      title: 'چرخه پایدار تکرارپذیر',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'پایداری',
      clientOperationId: 'op_idemp_1001'
    });

    assert.equal(cycle2.id, cycle1.id);
    assert.equal(cycle2.revision, 1, 'Idempotent replay must not mutate or duplicate revision');
  });
});
