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
  PreconditionRequiredError,
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
  clearAllReplayLocks,
  parseSafeConflictDetails,
  recordClientConflict,
  getClientConflicts,
  clearClientConflicts,
  ALREADY_RECORDED,
  buildConflictIdentity,
  quarantineQueueItems
} from '../src/utils/offlineQueueUtils.js';
import {
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate,
  applyOptimisticCycleUpdate,
  rollbackOptimisticCycleUpdate,
  rollbackOptimisticCycleDelete,
  prepareDirectLogPayload,
  prepareDirectCyclePayload,
  verifyActiveAccount
} from '../src/utils/directMutationUtils.js';
import {
  updateCycleSchema,
  upsertDailyLogSchema,
  updateDailyLogSchema
} from '../server/utils/validation.js';
import { errorHandler } from '../server/middleware/security.js';

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
        assert.equal(err.serverState, undefined, 'Server state must NOT be leaked in ConcurrencyConflictError');
        return true;
      }
    );

    // Matching expectedRevision = 2 succeeds and increments to 3
    const updated2 = await updateCycle(userId, cycle.id, {
      title: 'چرخه با ویرایش دوم'
    }, 2);
    assert.equal(updated2?.revision, 3, 'Revision must be incremented to 3');

    // Missing expectedRevision must throw PreconditionRequiredError (428)
    await assert.rejects(
      async () => {
        await updateCycle(userId, cycle.id, { title: 'چرخه بدون شرط نسخه' });
      },
      (err: any) => {
        assert.ok(err instanceof PreconditionRequiredError, 'Missing expectedRevision must throw PreconditionRequiredError');
        assert.equal(err.code, 'PRECONDITION_REQUIRED');
        assert.equal(err.entityType, 'CYCLE');
        assert.equal(err.entityId, cycle.id);
        return true;
      }
    );
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
        assert.equal(err.serverState, undefined, 'serverState must not be exposed');
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
      assert.equal(err.serverState, undefined, 'serverState must not be leaked');
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
    // updateCycleSchema with expectedRevision
    const cycleParsed1 = updateCycleSchema.safeParse({
      title: 'تست اعتبارسنجی',
      expectedRevision: 5
    });
    assert.ok(cycleParsed1.success, 'updateCycleSchema must accept expectedRevision');
    if (cycleParsed1.success) {
      assert.equal(cycleParsed1.data.expectedRevision, 5);
    }

    // updateCycleSchema with legacy revision alias normalizes to expectedRevision
    const cycleParsed2 = updateCycleSchema.safeParse({
      title: 'تست اعتبارسنجی',
      revision: 5
    });
    assert.ok(cycleParsed2.success, 'updateCycleSchema must accept revision and normalize to expectedRevision');
    if (cycleParsed2.success) {
      assert.equal(cycleParsed2.data.expectedRevision, 5);
    }

    // Mismatched expectedRevision and revision is rejected
    const cycleParsedMismatched = updateCycleSchema.safeParse({
      title: 'تست اعتبارسنجی',
      expectedRevision: 5,
      revision: 6
    });
    assert.equal(cycleParsedMismatched.success, false, 'Mismatched revision and expectedRevision must fail validation');

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

  await t.test('9. Invalid expectedRevision Formats Trigger PreconditionRequiredError (428)', async () => {
    const cycle = await createCycle(userId, {
      title: 'چرخه تست پیش‌شرط',
      startDate: '2026-09-01',
      endDate: '2026-11-29'
    });

    // Zero revision
    await assert.rejects(
      async () => {
        await updateCycle(userId, cycle.id, { title: 'عنوان جدید' }, 0);
      },
      (err: any) => {
        assert.ok(err instanceof PreconditionRequiredError);
        assert.equal(err.code, 'PRECONDITION_REQUIRED');
        return true;
      }
    );

    // Negative revision
    await assert.rejects(
      async () => {
        await updateCycle(userId, cycle.id, { title: 'عنوان جدید' }, -5);
      },
      (err: any) => {
        assert.ok(err instanceof PreconditionRequiredError);
        return true;
      }
    );

    // Missing/undefined revision
    await assert.rejects(
      async () => {
        await updateCycle(userId, cycle.id, { title: 'عنوان جدید' }, undefined);
      },
      (err: any) => {
        assert.ok(err instanceof PreconditionRequiredError);
        assert.equal(err.code, 'PRECONDITION_REQUIRED');
        return true;
      }
    );

    // HTTP 428 classification check
    const preconditionClassification = classifyReplayResponse(428, 'UPDATE_CYCLE');
    assert.equal(preconditionClassification, 'PRECONDITION_REQUIRED', 'HTTP 428 must classify as PRECONDITION_REQUIRED');
  });

  await t.test('10. Cross-Tenant Concurrency and Isolation Under Concurrent Writes', async () => {
    const userA = 'user_tenant_alpha';
    const userB = 'user_tenant_beta';

    const cycleA = await createCycle(userA, {
      title: 'چرخه کاربر الف',
      startDate: '2026-09-01',
      endDate: '2026-11-29'
    });

    // User B attempts to mutate User A cycle with matching revision
    const updateAttempt = await updateCycle(userB, cycleA.id, {
      title: 'تلاش نفوذ کاربر ب'
    }, 1);
    assert.equal(updateAttempt, null, 'User B must not be able to mutate User A cycle');

    // User A cycle remains unchanged at revision 1
    const freshCycleA = await getCycleById(userA, cycleA.id);
    assert.equal(freshCycleA?.title, 'چرخه کاربر الف');
    assert.equal(freshCycleA?.revision, 1);
  });

  await t.test('11. HTTP Error Handler Strips serverState on 409 ConcurrencyConflictError', () => {
    let statusCode = 0;
    let jsonPayload: any = null;

    const mockRes: any = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(data: any) {
        jsonPayload = data;
        return this;
      }
    };

    const conflictErr = new ConcurrencyConflictError({
      entityType: 'CYCLE',
      entityId: 'cycle_test_409',
      currentRevision: 4,
      expectedRevision: 2
    });

    errorHandler(conflictErr, {} as any, mockRes, (() => {}) as any);

    assert.equal(statusCode, 409, 'Status code must be HTTP 409 Conflict');
    assert.equal(jsonPayload.code, 'CONFLICT');
    assert.equal(jsonPayload.entityType, 'CYCLE');
    assert.equal(jsonPayload.entityId, 'cycle_test_409');
    assert.equal(jsonPayload.currentRevision, 4);
    assert.equal(jsonPayload.expectedRevision, 2);
    assert.equal(jsonPayload.serverState, undefined, 'serverState must NOT be present in 409 response');
  });

  await t.test('12. Fallthrough Prevention on Concurrency Conflicts', async () => {
    // Mock a prisma client where updateMany returns count: 0 (conflict)
    const mockPrisma = {
      cycle: {
        findFirst: async () => ({
          id: 'cycle_prisma_1',
          userId,
          revision: 3,
          title: 'چرخه پایگاه اصلی',
          createdAt: new Date(),
          updatedAt: new Date()
        }),
        updateMany: async () => ({ count: 0 })
      }
    };

    setPrismaState(mockPrisma, true);

    // Populate memory store with different state
    memoryStore.cycles = [{
      id: 'cycle_prisma_1',
      userId,
      revision: 1,
      title: 'چرخه حافظه موقت',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z'
    }];

    // Must throw ConcurrencyConflictError and NOT silently fall through to memoryStore
    await assert.rejects(
      async () => {
        await updateCycle(userId, 'cycle_prisma_1', { title: 'ویرایش بدون فالبک' }, 1);
      },
      (err: any) => {
        assert.ok(err instanceof ConcurrencyConflictError);
        assert.equal(err.currentRevision, 3);
        assert.equal(err.expectedRevision, 1);
        return true;
      }
    );

    // Verify memory store was NOT mutated
    assert.equal(memoryStore.cycles[0].title, 'چرخه حافظه موقت');
    assert.equal(memoryStore.cycles[0].revision, 1);

    // Restore prisma state
    setPrismaState(null, false);
  });

  await t.test('13. Typed Safe Conflict Parsing & Redaction of ServerState / Tokens', async () => {
    const raw409Body = {
      code: 'CONFLICT',
      messageFa: 'این گزارش در دستگاه دیگری تغییر یافته است.',
      entityType: 'DAILY_LOG',
      entityId: '2026-09-02',
      currentRevision: 4,
      expectedRevision: 2,
      serverState: { secret: 'do_not_leak', token: 'eyJhbGci...' },
      authorization: 'Bearer secret_token'
    };

    const parsed = parseSafeConflictDetails(409, raw409Body, 'DAILY_LOG', '2026-09-02');
    assert.equal(parsed.conflictType, 'CONCURRENCY_CONFLICT');
    assert.equal(parsed.statusCode, 409);
    assert.equal(parsed.currentRevision, 4);
    assert.equal(parsed.expectedRevision, 2);
    assert.equal(parsed.entityType, 'DAILY_LOG');
    assert.equal(parsed.entityId, '2026-09-02');
    assert.ok(!('serverState' in parsed), 'serverState must not be present');
    assert.ok(!('authorization' in parsed), 'authorization must not be present');

    const recorded = recordClientConflict('user_alice_409', {
      mutationType: 'UPDATE_LOG',
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      conflictType: parsed.conflictType,
      statusCode: parsed.statusCode,
      currentRevision: parsed.currentRevision,
      expectedRevision: parsed.expectedRevision,
      messageFa: parsed.messageFa,
      clientPayload: {
        date: '2026-09-02',
        habits: { wakeUp: true },
        serverState: { malicious: true },
        token: 'secret_token_value'
      }
    });

    assert.equal(recorded.ownerId, 'user_alice_409');
    assert.equal(recorded.statusCode, 409);
    assert.equal(recorded.conflictType, 'CONCURRENCY_CONFLICT');
    assert.equal(recorded.clientPayload?.token, '[REDACTED]', 'Tokens in clientPayload must be redacted');
    assert.equal(recorded.clientPayload?.serverState, undefined, 'serverState in clientPayload must be removed');
  });

  await t.test('14. Account Scoping & Quarantine Isolation of Client Conflicts', async () => {
    clearQuarantine('user_alice_409');
    clearQuarantine('user_bob_409');

    recordClientConflict('user_alice_409', {
      mutationType: 'UPDATE_CYCLE',
      entityType: 'CYCLE',
      entityId: 'cycle_alice_1',
      statusCode: 409,
      expectedRevision: 1,
      currentRevision: 2,
      clientPayload: { id: 'cycle_alice_1', title: 'چرخه آلیس' }
    });

    recordClientConflict('user_bob_409', {
      mutationType: 'UPDATE_LOG',
      entityType: 'DAILY_LOG',
      entityId: '2026-09-03',
      statusCode: 428,
      clientPayload: { date: '2026-09-03', habits: {} }
    });

    const aliceConflicts = getClientConflicts('user_alice_409');
    assert.equal(aliceConflicts.length, 1);
    assert.equal(aliceConflicts[0].entityId, 'cycle_alice_1');
    assert.equal(aliceConflicts[0].ownerId, 'user_alice_409');
    assert.equal(aliceConflicts[0].statusCode, 409);

    const bobConflicts = getClientConflicts('user_bob_409');
    assert.equal(bobConflicts.length, 1);
    assert.equal(bobConflicts[0].entityId, '2026-09-03');
    assert.equal(bobConflicts[0].ownerId, 'user_bob_409');
    assert.equal(bobConflicts[0].statusCode, 428);

    // Verify User A cannot see User B conflicts
    assert.ok(!aliceConflicts.some(c => c.entityId === '2026-09-03'));
    assert.ok(!bobConflicts.some(c => c.entityId === 'cycle_alice_1'));

    // Clear Alice conflicts
    clearClientConflicts('user_alice_409');
    assert.equal(getClientConflicts('user_alice_409').length, 0);
    // Bob remains intact
    assert.equal(getClientConflicts('user_bob_409').length, 1);
  });

  await t.test('15. Direct Online Mutation 409/428 is NEVER Enqueued to Active Offline Queue', async () => {
    const directOwner = 'user_direct_conflict_test';
    // Active queue starts empty
    assert.equal(getOfflineQueue(directOwner).length, 0);

    // Simulate direct online mutation encountering 409
    const conflictData = parseSafeConflictDetails(409, {
      code: 'CONFLICT',
      messageFa: 'تعارض نسخه در چرخه',
      entityType: 'CYCLE',
      entityId: 'cycle_online_1',
      currentRevision: 3,
      expectedRevision: 1
    }, 'CYCLE', 'cycle_online_1');

    recordClientConflict(directOwner, {
      mutationType: 'UPDATE_CYCLE',
      entityType: conflictData.entityType,
      entityId: conflictData.entityId,
      conflictType: conflictData.conflictType,
      statusCode: conflictData.statusCode,
      currentRevision: conflictData.currentRevision,
      expectedRevision: conflictData.expectedRevision,
      messageFa: conflictData.messageFa,
      clientPayload: { id: 'cycle_online_1', title: 'تغییر همزمان' }
    });

    // Active offline queue must REMAIN EMPTY (no automated replay retry loops)
    assert.equal(getOfflineQueue(directOwner).length, 0, 'Active offline queue must remain empty on 409');

    // Quarantined items contain the conflict
    const conflicts = getClientConflicts(directOwner);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].statusCode, 409);
    assert.equal(conflicts[0].entityId, 'cycle_online_1');
  });

  await t.test('16. Replay 409 & 428 Routing Through recordClientConflict and Quarantine Isolation', async () => {
    const replayOwner = 'user_replay_conflict_test';
    const item1 = {
      id: 'mut_replay_409',
      ownerId: replayOwner,
      type: 'UPDATE_LOG' as const,
      payload: { date: '2026-09-04', habits: { wakeUp: true } },
      expectedRevision: 1,
      timestamp: Date.now()
    };

    saveOfflineQueue(replayOwner, [item1]);
    assert.equal(getOfflineQueue(replayOwner).length, 1);

    // Mock fetch returning 409 with safe payload
    const mockFetch = async () => ({
      status: 409,
      statusText: 'Conflict',
      ok: false,
      headers: new Headers({ 'Content-Type': 'application/json' }),
      json: async () => ({
        code: 'CONFLICT',
        messageFa: 'تعارض همزمانی در بازپخش',
        entityType: 'DAILY_LOG',
        entityId: '2026-09-04',
        currentRevision: 5,
        expectedRevision: 1
      }),
      clone: () => ({
        json: async () => ({
          code: 'CONFLICT',
          messageFa: 'تعارض همزمانی در بازپخش',
          entityType: 'DAILY_LOG',
          entityId: '2026-09-04',
          currentRevision: 5,
          expectedRevision: 1
        })
      })
    });

    const result = await replayAccountOfflineQueue({
      activeAccountId: replayOwner,
      authToken: 'token_test_123',
      fetchFn: mockFetch as any,
      respectBackoff: false
    });

    assert.equal(result.failedCount, 1);
    assert.equal(result.syncedCount, 0);

    // Active queue must have removed the item
    assert.equal(getOfflineQueue(replayOwner).length, 0, 'Replayed 409 item must be removed from active queue');

    // Quarantined conflict must be recorded
    const conflicts = getClientConflicts(replayOwner);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].statusCode, 409);
    assert.equal(conflicts[0].entityId, '2026-09-04');
    assert.equal(conflicts[0].currentRevision, 5);
  });

  await t.test('17. LocalStorage Privacy Verification: No raw 409/428 bodies, serverState or credentials in storage', async () => {
    const privOwner = 'user_priv_check_999';

    recordClientConflict(privOwner, {
      mutationType: 'UPDATE_PROFILE',
      entityType: 'USER_PROFILE',
      entityId: privOwner,
      statusCode: 409,
      messageFa: 'تعارض در پروفایل کاربر',
      clientPayload: {
        id: privOwner,
        name: 'کاربر تست',
        token: 'SHOULD_NEVER_EXIST_IN_STORAGE',
        password: 'SUPER_SECRET_PASSWORD',
        serverState: { leakedInternalData: 12345 }
      }
    });

    // Inspect all keys in localStorage
    for (const key of Object.keys(storageMock)) {
      const rawStored = storageMock[key];
      assert.ok(!rawStored.includes('SHOULD_NEVER_EXIST_IN_STORAGE'), `Storage key ${key} must not contain sensitive token`);
      assert.ok(!rawStored.includes('SUPER_SECRET_PASSWORD'), `Storage key ${key} must not contain password`);
      assert.ok(!rawStored.includes('leakedInternalData'), `Storage key ${key} must not contain serverState`);
    }
  });

  await t.test('18. Optimistic Delete Recovery Logic Verification', async () => {
    // Given an initial cycle and logs
    const initialCycle = {
      id: 'cycle_delete_target',
      title: 'چرخه هدف حذف',
      startDate: '2026-09-01',
      endDate: '2026-11-29',
      targetTheme: 'انضباط',
      revision: 2,
      isSynced: true
    };
    const initialLog = {
      date: '2026-09-01',
      cycleId: 'cycle_delete_target',
      habits: { wakeUp: true },
      revision: 1,
      isSynced: true
    };

    let localCycles = [initialCycle];
    let localLogs = [initialLog];
    let activeCycle = 'cycle_delete_target';

    // Step 1: Optimistic UI deletion
    const targetCycleBackup = initialCycle;
    const targetLogsBackup = [initialLog];
    const previousActiveCycleBackup = activeCycle;

    localCycles = localCycles.filter(c => c.id !== 'cycle_delete_target');
    localLogs = localLogs.filter(l => l.cycleId !== 'cycle_delete_target');
    activeCycle = '';

    assert.equal(localCycles.length, 0);
    assert.equal(localLogs.length, 0);

    // Step 2: Server responds with 409 Conflict (cycle was edited on another device, revision is now 3)
    const serverResponse = {
      status: 409,
      body: {
        code: 'CONFLICT',
        messageFa: 'حذف چرخه به دلیل تغییر در دستگاه دیگر رد شد.',
        entityType: 'CYCLE',
        entityId: 'cycle_delete_target',
        currentRevision: 3,
        expectedRevision: 2
      }
    };

    // Step 3: Handle conflict & rollback
    const parsed = parseSafeConflictDetails(serverResponse.status, serverResponse.body, 'CYCLE', 'cycle_delete_target');
    const recorded = recordClientConflict('user_optimistic_delete', {
      mutationType: 'DELETE_CYCLE',
      entityType: parsed.entityType,
      entityId: parsed.entityId,
      conflictType: parsed.conflictType,
      statusCode: parsed.statusCode,
      currentRevision: parsed.currentRevision,
      expectedRevision: parsed.expectedRevision,
      messageFa: parsed.messageFa
    });

    // Rollback optimistic delete
    if (!localCycles.some(c => c.id === 'cycle_delete_target') && targetCycleBackup) {
      localCycles = [...localCycles, targetCycleBackup];
      localLogs = [...localLogs, ...targetLogsBackup];
      if (previousActiveCycleBackup === 'cycle_delete_target') {
        activeCycle = 'cycle_delete_target';
      }
    }

    // Step 4: Verify recovery
    assert.equal(localCycles.length, 1, 'Cycle must be restored to local state upon 409 rejection');
    assert.equal(localCycles[0].id, 'cycle_delete_target');
    assert.equal(localLogs.length, 1, 'Associated logs must be restored upon 409 rejection');
    assert.equal(activeCycle, 'cycle_delete_target', 'Active cycle must be restored');
    assert.equal(recorded.statusCode, 409);
    assert.equal(recorded.currentRevision, 3);
  });

  await t.test('19. Structured Conflict Storage & Deduplication with ALREADY_RECORDED', async () => {
    clearQuarantine(userId);

    const input = {
      mutationType: 'UPDATE_LOG' as const,
      entityType: 'DAILY_LOG',
      entityId: '2026-09-05',
      conflictType: 'CONCURRENCY_CONFLICT' as const,
      statusCode: 409,
      expectedRevision: 1,
      currentRevision: 2,
      messageFa: 'تعارض همزمانی در ثبت گزارش روزانه',
      clientPayload: { cycleId: 'cycle_dedup_test', workout: true }
    };

    // First recording must return structured ClientConflictMetadata
    const recorded1 = recordClientConflict(userId, input);
    assert.notEqual(recorded1, ALREADY_RECORDED);
    assert.equal((recorded1 as any).recordKind, 'CLIENT_CONFLICT_RECORD');
    assert.equal((recorded1 as any).status, 'RECORDED');
    assert.equal((recorded1 as any).ownerId, userId);
    assert.equal((recorded1 as any).expectedRevision, 1);
    assert.equal((recorded1 as any).currentRevision, 2);
    assert.equal((recorded1 as any).entityType, 'DAILY_LOG');
    assert.equal((recorded1 as any).entityId, '2026-09-05');

    // Conflict list must contain exactly 1 entry
    const list1 = getClientConflicts(userId);
    assert.equal(list1.length, 1);
    assert.equal(list1[0].recordKind, 'CLIENT_CONFLICT_RECORD');

    // Repeated recording with identical identity must return ALREADY_RECORDED
    const recorded2 = recordClientConflict(userId, input);
    assert.equal(recorded2, ALREADY_RECORDED, 'Subsequent duplicate conflict must return ALREADY_RECORDED');

    // Conflict list must still have exactly 1 entry (no duplicate stored)
    const list2 = getClientConflicts(userId);
    assert.equal(list2.length, 1, 'Deduplication must prevent duplicate conflict entries in storage');
  });

  await t.test('20. Targeted Conflict Clearing Preserves Unrelated Quarantine Records', async () => {
    clearQuarantine(userId);

    // 1. Manually quarantine a non-conflict record (e.g. malformed syntax / validation failure)
    quarantineQueueItems(
      [{ id: 'malformed_payload_item', type: 'CUSTOM_MUTATION', classification: 'VALIDATION_FAILED', lastError: 'Schema validation error' }],
      'Schema error',
      userId
    );

    // 2. Record a structured conflict record
    recordClientConflict(userId, {
      mutationType: 'UPDATE_CYCLE',
      entityType: 'CYCLE',
      entityId: 'cycle_quarantine_test',
      conflictType: 'CONCURRENCY_CONFLICT',
      statusCode: 409,
      expectedRevision: 2,
      currentRevision: 4,
      messageFa: 'تعارض در چرخه'
    });

    // 3. Confirm both entries are present in raw quarantine
    const rawBefore = getQuarantinedItems(userId);
    assert.equal(rawBefore.length, 2, 'Must have 2 quarantine groups before targeted clear');

    // 4. Perform targeted clear
    clearClientConflicts(userId);

    // 5. Conflicts must be cleared, but validation failure must remain preserved
    const conflictsAfter = getClientConflicts(userId);
    assert.equal(conflictsAfter.length, 0, 'Client conflicts must be cleanly cleared');

    const rawAfter = getQuarantinedItems(userId);
    assert.equal(rawAfter.length, 1, 'Non-conflict quarantine group must remain untouched');
    assert.equal(rawAfter[0].items[0].id, 'malformed_payload_item');
    assert.equal(rawAfter[0].items[0].classification, 'VALIDATION_FAILED');
  });

  await t.test('21. Direct Mutation Helpers: Snapshot Capture, Optimistic isSynced: false, and Truthful Rollback', async () => {
    // A. Daily Log Direct Mutation Contract
    const initialLog: any = {
      date: '2026-09-05',
      cycleId: 'c1',
      habits: { wakeUp: true },
      revision: 2,
      isSynced: true
    };
    const logs = [initialLog];

    const updatedLog: any = {
      ...initialLog,
      habits: { wakeUp: true, gym: true }
    };

    // 1. applyOptimisticLogUpdate
    const { nextLogs, previousConfirmedSnapshot } = applyOptimisticLogUpdate(logs, updatedLog);
    assert.equal(nextLogs[0].isSynced, false, 'Optimistic log must be marked unsynced (isSynced: false)');
    assert.equal(nextLogs[0].habits.gym, true);
    assert.equal(previousConfirmedSnapshot?.isSynced, true, 'Snapshot must retain confirmed isSynced: true');
    assert.equal(previousConfirmedSnapshot?.habits.gym, undefined);

    // 2. rollbackOptimisticLogUpdate on HTTP 409
    const rolledBack = rollbackOptimisticLogUpdate(nextLogs, updatedLog.date, previousConfirmedSnapshot);
    assert.equal(rolledBack[0].isSynced, true, 'Rolled back log must be restored to confirmed isSynced: true');
    assert.equal(rolledBack[0].habits.gym, undefined, 'Optimistic changes must be rolled back');

    // 3. rollback when no previous snapshot exists (new log rejected)
    const newLog: any = { date: '2026-09-06', cycleId: 'c1', habits: { read: true } };
    const { nextLogs: logsWithNew } = applyOptimisticLogUpdate([], newLog);
    assert.equal(logsWithNew.length, 1);
    const rolledBackNew = rollbackOptimisticLogUpdate(logsWithNew, newLog.date, null);
    assert.equal(rolledBackNew.length, 0, 'Rejected new log without confirmed snapshot must be removed');

    // B. Payload Preparation & Revision Validation
    const { payload: validPayload, expectedRevision: validRev } = prepareDirectLogPayload(
      { date: '2026-09-05', cycleId: 'c1', revision: 5 } as any,
      initialLog,
      'c1'
    );
    assert.equal(validRev, 2, 'expectedRevision must strictly derive from existing confirmed entity');
    assert.equal(validPayload.expectedRevision, 2);

    const { payload: invalidPayload, expectedRevision: invalidRev } = prepareDirectCyclePayload(
      { id: 'c_test', title: 'New', revision: -1 } as any,
      null
    );
    assert.equal(invalidRev, undefined, 'Negative or invalid revision must produce undefined expectedRevision');
    assert.equal(invalidPayload.expectedRevision, undefined);
  });

  await t.test('22. Replay Chaining: Confirmed Revision Propagation to Chained Mutations', async () => {
    clearQuarantine(userId);
    saveOfflineQueue(userId, []);

    // Two mutations for the same cycle in the offline queue with distinct dedupKeys
    enqueueOfflineMutation(userId, {
      type: 'UPDATE_CYCLE',
      payload: { id: 'cycle_chain_1', title: 'عنوان گام اول' },
      expectedRevision: 1,
      dedupKey: 'chain_step_1'
    });

    enqueueOfflineMutation(userId, {
      type: 'UPDATE_CYCLE',
      payload: { id: 'cycle_chain_1', title: 'عنوان گام دوم' },
      expectedRevision: 1, // Initially stale expected revision before chaining
      dedupKey: 'chain_step_2'
    });

    const calls: any[] = [];
    const mockFetch = async (url: any, init: any) => {
      const body = JSON.parse(init.body);
      calls.push({ url, body });

      if (calls.length === 1) {
        // First mutation succeeds, server increments revision to 2
        return {
          status: 200,
          ok: true,
          json: async () => ({
            ok: true,
            cycle: { id: 'cycle_chain_1', title: 'عنوان گام اول', revision: 2, startDate: '2026-09-01', endDate: '2026-09-30' }
          })
        } as any;
      } else {
        // Second mutation in batch must receive chained expectedRevision: 2
        assert.equal(body.expectedRevision, 2, 'Second mutation in batch must use server-confirmed revision 2 from first mutation');
        return {
          status: 200,
          ok: true,
          json: async () => ({
            ok: true,
            cycle: { id: 'cycle_chain_1', title: 'عنوان گام دوم', revision: 3, startDate: '2026-09-01', endDate: '2026-09-30' }
          })
        } as any;
      }
    };

    const result = await replayAccountOfflineQueue({
      activeAccountId: userId,
      authToken: 'test_token',
      fetchFn: mockFetch
    });

    assert.equal(result.syncedCount, 2, 'Both mutations in batch should succeed via replay chaining');
    assert.equal(result.failedCount, 0);
    assert.equal(calls.length, 2);
  });

  await t.test('23. Asynchronous Account-Switch Protection on Direct Mutation Callbacks', async () => {
    // 1. Same active account verification succeeds
    assert.equal(verifyActiveAccount('user_123', 'user_123'), true);

    // 2. Switched to different user account fails
    assert.equal(verifyActiveAccount('user_456', 'user_123'), false);

    // 3. Switched to guest/null fails
    assert.equal(verifyActiveAccount(null, 'user_123'), false);
    assert.equal(verifyActiveAccount('__guest__', 'user_123'), false);

    // 4. Initial owner was null/guest fails
    assert.equal(verifyActiveAccount('user_123', null), false);
    assert.equal(verifyActiveAccount(null, null), false);
  });
});
