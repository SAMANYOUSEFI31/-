import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeDirectCreateCycleMutation,
  executeDirectUpdateCycleMutation,
  executeDirectDeleteCycleMutation,
  prepareDirectCyclePayload,
  prepareDirectDeleteCyclePayload,
  prepareDirectCreateCyclePayload
} from '../src/utils/directMutationUtils.js';
import {
  getOfflineQueue,
  enqueueOfflineMutation,
  enqueueDurableCycleWriteAhead,
  verifyDurableQueueItemPersistence,
  clearOfflineQueue,
  clearAllReplayLocks,
  resetRuntimeInFlightState,
  getClientConflicts,
  clearClientConflicts,
  markQueueItemInFlight,
  isQueueItemInFlight,
  replayAccountOfflineQueue
} from '../src/utils/offlineQueueUtils.js';
import { Cycle } from '../src/types.js';

test('Phase 6.1B Cycle Mutation Reliability & Lifecycle Contracts', async (t) => {
  const userId = 'user_phase6_1b_cycles';
  const storageMock: Record<string, string> = {};

  const origWindow = (globalThis as any).window;
  const origLocalStorage = (globalThis as any).localStorage;

  t.beforeEach(() => {
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
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true
      });
    } catch {
      // ignore
    }

    clearOfflineQueue(userId);
    clearClientConflicts(userId);
    clearAllReplayLocks();
    resetRuntimeInFlightState();
  });

  t.afterEach(() => {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', {
        value: true,
        configurable: true,
        writable: true
      });
    } catch {}
    clearOfflineQueue(userId);
    clearClientConflicts(userId);
    clearAllReplayLocks();
    resetRuntimeInFlightState();
  });

  t.after(() => {
    (globalThis as any).window = origWindow;
    (globalThis as any).localStorage = origLocalStorage;
  });

  const baseCycle: Cycle = {
    id: 'cycle_test_100',
    title: 'فصل استقامت',
    startDate: '1403-01-01',
    endDate: '1403-03-31',
    targetTheme: 'استقامت و تمرکز',
    inheritedStreak: 5,
    isArchived: false,
    reportRead: false,
    revision: 1,
    isSynced: true
  };

  // =========================================================================
  // SCENARIO 1: CREATE_CYCLE Offline Preservation
  // =========================================================================
  await t.test('Scenario 1: CREATE_CYCLE is durably queued offline when offline or fetch fails', async () => {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    } catch {}

    const newCycle: Cycle = {
      ...baseCycle,
      id: 'cycle_new_1',
      title: 'فصل جدید'
    };

    const result = await executeDirectCreateCycleMutation({
      newCycle,
      ownerId: userId,
      authToken: 'valid_token'
    });

    assert.equal(result.status, 'QUEUED_OFFLINE');
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'CREATE_CYCLE');
    assert.equal(queue[0].payload.id, 'cycle_new_1');
    assert.equal(typeof (queue[0].payload?.clientOperationId || queue[0].id), 'string');
  });

  // =========================================================================
  // SCENARIO 2: UPDATE_CYCLE Offline Preservation
  // =========================================================================
  await t.test('Scenario 2: UPDATE_CYCLE is durably queued offline when offline', async () => {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    } catch {}

    const updatedCycle: Cycle = {
      ...baseCycle,
      title: 'عنوان بروزرسانی‌شده',
      revision: 1
    };

    const result = await executeDirectUpdateCycleMutation({
      updatedCycle,
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token'
    });

    assert.equal(result.status, 'QUEUED_OFFLINE');
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'UPDATE_CYCLE');
    assert.equal(queue[0].payload.id, baseCycle.id);
    assert.equal(queue[0].expectedRevision, 1);
  });

  // =========================================================================
  // SCENARIO 3: DELETE_CYCLE Offline Preservation
  // =========================================================================
  await t.test('Scenario 3: DELETE_CYCLE is durably queued offline when offline', async () => {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    } catch {}

    const result = await executeDirectDeleteCycleMutation({
      cycleId: baseCycle.id,
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token'
    });

    assert.equal(result.status, 'QUEUED_OFFLINE');
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'DELETE_CYCLE');
    assert.equal(queue[0].payload.id, baseCycle.id);
    assert.equal(queue[0].expectedRevision, 1);
  });

  // =========================================================================
  // SCENARIO 4: Stable clientOperationId across network & write-ahead items
  // =========================================================================
  await t.test('Scenario 4: stable clientOperationId is preserved between write-ahead queue item and fetch body', async () => {
    let capturedBody: any = null;
    let queueOpIdDuringFetch: string | null = null;

    const mockFetch = (async (url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      const queue = getOfflineQueue(userId);
      if (queue.length > 0) {
        queueOpIdDuringFetch = queue[0].clientOperationId || queue[0].id;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cycle: {
            ...baseCycle,
            title: capturedBody.title,
            revision: 2
          }
        })
      };
    }) as any;

    const updatedCycle: Cycle = {
      ...baseCycle,
      title: 'عنوان جدید با آی‌دی پایدار',
      revision: 1
    };

    const result = await executeDirectUpdateCycleMutation({
      updatedCycle,
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'SUCCESS');
    assert.ok(capturedBody.clientOperationId, 'Body must have clientOperationId');
    assert.equal(capturedBody.clientOperationId, queueOpIdDuringFetch);
  });

  // =========================================================================
  // SCENARIO 5: Non-overwriting queue behavior for distinct cycles
  // =========================================================================
  await t.test('Scenario 5: distinct cycles do not overwrite each other in the queue', async () => {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    } catch {}

    const cycleA: Cycle = { ...baseCycle, id: 'cycle_A', title: 'فصل الف' };
    const cycleB: Cycle = { ...baseCycle, id: 'cycle_B', title: 'فصل ب' };

    await executeDirectCreateCycleMutation({
      newCycle: cycleA,
      ownerId: userId,
      authToken: 'valid_token'
    });

    await executeDirectCreateCycleMutation({
      newCycle: cycleB,
      ownerId: userId,
      authToken: 'valid_token'
    });

    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 2);
    assert.equal(queue[0].payload.id, 'cycle_A');
    assert.equal(queue[1].payload.id, 'cycle_B');
  });

  // =========================================================================
  // SCENARIO 6: Clean replacement/coalescing for same cycle updates
  // =========================================================================
  await t.test('Scenario 6: sequential updates for the same cycle coalesce in the write-ahead queue', async () => {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    } catch {}

    const update1: Cycle = { ...baseCycle, title: 'ویرایش اول' };
    const update2: Cycle = { ...baseCycle, title: 'ویرایش دوم' };

    await executeDirectUpdateCycleMutation({
      updatedCycle: update1,
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token'
    });

    await executeDirectUpdateCycleMutation({
      updatedCycle: update2,
      existingCycle: update1,
      ownerId: userId,
      authToken: 'valid_token'
    });

    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1, 'Should coalesce to 1 item');
    assert.equal(queue[0].payload.title, 'ویرایش دوم');
  });

  // =========================================================================
  // SCENARIO 7: 401/403 Non-Retryable Quarantine & Auth Handling
  // =========================================================================
  await t.test('Scenario 7: 401 returns AUTH_REQUIRED and keeps in queue, 403 quarantines', async () => {
    const mockFetch401 = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    })) as any;

    const result401 = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'تلاش ۴۰۱' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'expired_token',
      fetchFn: mockFetch401
    });

    assert.equal(result401.status, 'AUTH_REQUIRED');
    assert.equal(getOfflineQueue(userId).length, 1, '401 retains in queue for re-auth');

    clearOfflineQueue(userId);

    const mockFetch403 = (async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' })
    })) as any;

    const result403 = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'تلاش ۴۰۳' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'forbidden_token',
      fetchFn: mockFetch403
    });

    assert.equal(result403.status, 'FORBIDDEN');
    assert.equal(getOfflineQueue(userId).length, 0, '403 item is removed/quarantined from active queue');
  });

  // =========================================================================
  // SCENARIO 8: 409 Conflict Handling and Conflict Recording
  // =========================================================================
  await t.test('Scenario 8: 409 Conflict records conflict details and does not leave stale item in queue', async () => {
    const mockFetch409 = (async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Cycle concurrency conflict',
        conflictType: 'VERSION_MISMATCH',
        currentRevision: 3,
        expectedRevision: 1
      })
    })) as any;

    const result409 = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'تلاش ۴۰۹' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch409
    });

    assert.equal(result409.status, 'CONFLICT');
    if (result409.status === 'CONFLICT') {
      assert.equal(result409.conflictDetails.conflictType, 'CONCURRENCY_CONFLICT');
      assert.equal(result409.conflictDetails.currentRevision, 3);
    }

    const conflicts = getClientConflicts(userId);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].entityType, 'CYCLE');
    assert.equal(conflicts[0].statusCode, 409);
    assert.equal(getOfflineQueue(userId).length, 0);
  });

  // =========================================================================
  // SCENARIO 9: 428 Precondition Required Handling
  // =========================================================================
  await t.test('Scenario 9: 428 Precondition Required triggers conflict and quarantines', async () => {
    const mockFetch428 = (async () => ({
      ok: false,
      status: 428,
      json: async () => ({
        error: 'Precondition required',
        message: 'expectedRevision is required'
      })
    })) as any;

    const result428 = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'تلاش ۴۲۸' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch428
    });

    assert.equal(result428.status, 'CONFLICT');
    const conflicts = getClientConflicts(userId);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].statusCode, 428);
    assert.equal(getOfflineQueue(userId).length, 0);
  });

  // =========================================================================
  // SCENARIO 10: Account Switch Protection during In-Flight Mutation
  // =========================================================================
  await t.test('Scenario 10: Account switch during in-flight network call is safely aborted', async () => {
    const activeAccountRef = { current: userId };

    const mockFetch = (async () => {
      // User switches account while fetch is in-flight:
      activeAccountRef.current = 'different_user_switched';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cycle: { ...baseCycle, revision: 2 }
        })
      };
    }) as any;

    const result = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'تغییر همزمان با سوییچ' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      activeAccountRef,
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'ACCOUNT_SWITCHED');
  });

  // =========================================================================
  // SCENARIO 11: Local-only Guest Mutation Safety
  // =========================================================================
  await t.test('Scenario 11: Guest or unauthenticated mutation returns IGNORED_NO_AUTH_NO_QUEUE without network calls', async () => {
    let networkCalled = false;
    const mockFetch = (async () => {
      networkCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const result = await executeDirectCreateCycleMutation({
      newCycle: baseCycle,
      ownerId: undefined, // Guest
      authToken: null,
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'IGNORED_NO_AUTH_NO_QUEUE');
    assert.equal(networkCalled, false);
    assert.equal(getOfflineQueue(userId).length, 0);
  });

  // =========================================================================
  // SCENARIO 12: DELETE_CYCLE 404 Idempotency
  // =========================================================================
  await t.test('Scenario 12: DELETE_CYCLE receiving 404 from server is treated as successful sync', async () => {
    const mockFetch404 = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Cycle not found' })
    })) as any;

    const result = await executeDirectDeleteCycleMutation({
      cycleId: baseCycle.id,
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch404
    });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.is404Deleted, true);
    assert.equal(getOfflineQueue(userId).length, 0);
  });

  // =========================================================================
  // SCENARIO 13: Storage Quota / Write Failure Handling without False Success
  // =========================================================================
  await t.test('Scenario 13: Storage write failure aborts mutation truthfully with STORAGE_WRITE_FAILED', async () => {
    (globalThis as any).localStorage.setItem = () => {
      throw new Error('QuotaExceededError: storage is full');
    };

    let networkCalled = false;
    const mockFetch = (async () => {
      networkCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const result = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'تلاش با دیسک پر' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'STORAGE_WRITE_FAILED');
    assert.equal(networkCalled, false, 'Fetch MUST NOT be attempted if write-ahead persistence failed');
  });

  // =========================================================================
  // SCENARIO 14: Server Timeout / Network Failure Preservation in Queue
  // =========================================================================
  await t.test('Scenario 14: Network error / timeout leaves item securely preserved in queue', async () => {
    const mockFetchFail = (async () => {
      throw new TypeError('Failed to fetch');
    }) as any;

    const result = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'تلاش با قطعی شبکه' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetchFail
    });

    assert.equal(result.status, 'NETWORK_ERROR');
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'UPDATE_CYCLE');
    assert.equal(queue[0].payload.title, 'تلاش با قطعی شبکه');
  });

  // =========================================================================
  // SCENARIO 15: Server 5xx Retryable Retention
  // =========================================================================
  await t.test('Scenario 15: Server 500 / 503 retains mutation in queue for later replay', async () => {
    const mockFetch503 = (async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'Service Unavailable' })
    })) as any;

    const result = await executeDirectCreateCycleMutation({
      newCycle: { ...baseCycle, id: 'cycle_503' },
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch503
    });

    assert.equal(result.status, 'SERVER_RETRYABLE');
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'CREATE_CYCLE');
    assert.equal(queue[0].payload.id, 'cycle_503');
  });

  // =========================================================================
  // SCENARIO 16: Unconfirmed Cycle Mutation Verification Helper
  // =========================================================================
  await t.test('Scenario 16: Invalid success response (malformed body) leaves mutation unconfirmed', async () => {
    const mockFetchBadJson = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        cycle: null // Missing cycle payload
      })
    })) as any;

    const result = await executeDirectUpdateCycleMutation({
      updatedCycle: { ...baseCycle, title: 'پاسخ نامعتبر' },
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetchBadJson
    });

    assert.equal(result.status, 'INVALID_SUCCESS_RESPONSE');
    assert.equal(getOfflineQueue(userId).length, 1, 'Unconfirmed response preserves item in queue');
  });

  // =========================================================================
  // SCENARIO 17: Rapid UPDATE/UPDATE Race with In-Flight Protection
  // =========================================================================
  await t.test('Scenario 17: Rapid sequential updates while first is in-flight do not overwrite in-flight item; second is queued with revised expectedRevision', async () => {
    let resolveFirstFetch: (val: any) => void;
    const firstFetchPromise = new Promise((resolve) => {
      resolveFirstFetch = resolve;
    });

    let fetchCount = 0;
    const mockFetch = (async (url: string, init: any) => {
      fetchCount++;
      if (fetchCount === 1) {
        // Wait until triggered
        await firstFetchPromise;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            cycle: {
              ...baseCycle,
              title: 'ویرایش اول',
              revision: 2
            }
          })
        };
      }
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cycle: {
            ...baseCycle,
            title: body.title,
            revision: 3
          }
        })
      };
    }) as any;

    const update1: Cycle = { ...baseCycle, title: 'ویرایش اول', revision: 1 };
    const update2: Cycle = { ...baseCycle, title: 'ویرایش دوم', revision: 1 };

    // Launch first update (goes in-flight)
    const update1Promise = executeDirectUpdateCycleMutation({
      updatedCycle: update1,
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    // Let the first mutation write-ahead and mark in-flight
    await new Promise(r => setTimeout(r, 10));

    // Verify item 1 is in-flight
    const queueDuringFlight = getOfflineQueue(userId);
    assert.equal(queueDuringFlight.length, 1);
    const item1Id = queueDuringFlight[0].id;
    assert.equal(isQueueItemInFlight(userId, item1Id), true);

    // Launch second update while first is in-flight
    const update2Result = await executeDirectUpdateCycleMutation({
      updatedCycle: update2,
      existingCycle: update1,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    // Second update should be queued offline because it cannot dispatch concurrently
    assert.equal(update2Result.status, 'QUEUED_OFFLINE');

    // Verify queue now has TWO distinct items; item 1 was NOT mutated or overwritten
    const queueWithBoth = getOfflineQueue(userId);
    assert.equal(queueWithBoth.length, 2, 'Must contain 2 distinct items');
    assert.equal(queueWithBoth[0].id, item1Id, 'First item must retain original id');
    assert.equal(queueWithBoth[0].payload.title, 'ویرایش اول', 'First item payload must NOT be overwritten');
    assert.equal(queueWithBoth[1].payload.title, 'ویرایش دوم', 'Second item payload is separate');

    // Now resolve the first fetch
    resolveFirstFetch!({});
    const update1Result = await update1Promise;
    assert.equal(update1Result.status, 'SUCCESS');
    assert.equal(update1Result.hasNewerIntent, true, 'Must detect newer intent in queue');

    // Item 1 is removed from queue, item 2 remains and has expectedRevision updated to 2
    const queueAfterUpdate1 = getOfflineQueue(userId);
    assert.equal(queueAfterUpdate1.length, 1);
    assert.equal(queueAfterUpdate1[0].payload.title, 'ویرایش دوم');
    assert.equal(queueAfterUpdate1[0].expectedRevision, 2, 'Expected revision must be updated to 2');

    // Now replay the second item
    const replayResult = await replayAccountOfflineQueue({
      authToken: 'valid_token',
      activeAccountId: userId,
      force: true,
      fetchFn: mockFetch
    });

    assert.equal(replayResult.syncedCount, 1);
    assert.equal(getOfflineQueue(userId).length, 0);
  });

  // =========================================================================
  // SCENARIO 18: Third UPDATE Coalesces into Second Queue Item while First is In-Flight
  // =========================================================================
  await t.test('Scenario 18: Third update coalesces into non-in-flight second item while first remains in-flight', async () => {
    let resolveFirstFetch: (val: any) => void;
    const firstFetchPromise = new Promise((resolve) => {
      resolveFirstFetch = resolve;
    });

    const mockFetch = (async (url: string, init: any) => {
      await firstFetchPromise;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          cycle: {
            ...baseCycle,
            title: 'ویرایش اول',
            revision: 2
          }
        })
      };
    }) as any;

    const update1: Cycle = { ...baseCycle, title: 'ویرایش اول', revision: 1 };
    const update2: Cycle = { ...baseCycle, title: 'ویرایش دوم', revision: 1 };
    const update3: Cycle = { ...baseCycle, title: 'ویرایش سوم', revision: 1 };

    // Launch update 1
    const update1Promise = executeDirectUpdateCycleMutation({
      updatedCycle: update1,
      existingCycle: baseCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    await new Promise(r => setTimeout(r, 10));

    // Launch update 2 (enqueued)
    await executeDirectUpdateCycleMutation({
      updatedCycle: update2,
      existingCycle: update1,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    // Launch update 3 (should coalesce into item 2, NOT item 1)
    await executeDirectUpdateCycleMutation({
      updatedCycle: update3,
      existingCycle: update2,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 2, 'Queue must coalesce to exactly 2 items (in-flight item1 + merged item2/3)');
    assert.equal(queue[0].payload.title, 'ویرایش اول', 'In-flight item1 must remain unchanged');
    assert.equal(queue[1].payload.title, 'ویرایش سوم', 'Second item must be updated to update3 payload');

    resolveFirstFetch!({});
    await update1Promise;
  });

  // =========================================================================
  // SCENARIO 19: In-Flight CREATE_CYCLE Compaction Protection
  // =========================================================================
  await t.test('Scenario 19: In-flight CREATE_CYCLE is protected from compaction when duplicate create occurs', async () => {
    let resolveFetch: (val: any) => void;
    const fetchPromise = new Promise(resolve => { resolveFetch = resolve; });

    const mockFetch = (async () => {
      await fetchPromise;
      return {
        ok: true,
        status: 201,
        json: async () => ({
          cycle: { ...baseCycle, id: 'cycle_create_inflight', revision: 1 }
        })
      };
    }) as any;

    const newCycle: Cycle = { ...baseCycle, id: 'cycle_create_inflight', title: 'عنوان اولیه' };

    const create1Promise = executeDirectCreateCycleMutation({
      newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    await new Promise(r => setTimeout(r, 10));

    const queue1 = getOfflineQueue(userId);
    assert.equal(queue1.length, 1);
    const item1Id = queue1[0].id;
    assert.equal(isQueueItemInFlight(userId, item1Id), true);

    // Repeated create mutation while item 1 is in-flight
    const duplicateMutation = enqueueOfflineMutation(userId, {
      type: 'CREATE_CYCLE',
      payload: { ...newCycle, title: 'عنوان تکراری' },
      expectedRevision: undefined
    });

    const queue2 = getOfflineQueue(userId);
    // In-flight item 1 must NOT be overwritten!
    const inFlightItem = queue2.find(item => item.id === item1Id);
    assert.ok(inFlightItem, 'In-flight item must still exist');
    assert.equal(inFlightItem.payload.title, 'عنوان اولیه', 'In-flight payload must NOT be overwritten');

    resolveFetch!({});
    await create1Promise;
  });

  // =========================================================================
  // SCENARIO 20: Pending CREATE_CYCLE followed by DELETE_CYCLE (Offline Pruning)
  // =========================================================================
  await t.test('Scenario 20: Pending offline CREATE_CYCLE followed by DELETE_CYCLE before sync is pruned offline without network dispatch', async () => {
    try {
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true });
    } catch {}

    const newCycle: Cycle = { ...baseCycle, id: 'cycle_offline_prune_1' };

    // Create while offline
    await executeDirectCreateCycleMutation({
      newCycle,
      ownerId: userId,
      authToken: 'valid_token'
    });

    assert.equal(getOfflineQueue(userId).length, 1);

    // Delete while offline
    let networkCalled = false;
    const mockFetch = (async () => {
      networkCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const deleteResult = await executeDirectDeleteCycleMutation({
      cycleId: 'cycle_offline_prune_1',
      existingCycle: newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    assert.equal(deleteResult.status, 'SUCCESS');
    assert.equal(networkCalled, false, 'No network call should be made for pruned offline cycle');
    assert.equal(getOfflineQueue(userId).length, 0, 'Both CREATE and DELETE must be pruned');
  });

  // =========================================================================
  // SCENARIO 21: In-Flight CREATE_CYCLE followed by DELETE_CYCLE (Queued Behind)
  // =========================================================================
  await t.test('Scenario 21: DELETE_CYCLE during in-flight CREATE_CYCLE is not pruned and is queued safely behind CREATE_CYCLE', async () => {
    let resolveCreateFetch: (val: any) => void;
    const createFetchPromise = new Promise(resolve => { resolveCreateFetch = resolve; });

    let createFetchCalled = false;
    let deleteFetchCalled = false;

    const mockFetch = (async (url: string, init: any) => {
      if (init.method === 'POST') {
        createFetchCalled = true;
        await createFetchPromise;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            cycle: { ...baseCycle, id: 'cycle_inflight_del', revision: 1 }
          })
        };
      }
      if (init.method === 'DELETE') {
        deleteFetchCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const newCycle: Cycle = { ...baseCycle, id: 'cycle_inflight_del' };

    const createPromise = executeDirectCreateCycleMutation({
      newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    await new Promise(r => setTimeout(r, 10));
    assert.equal(createFetchCalled, true);

    // Issue delete while create is in-flight
    const deleteResult = await executeDirectDeleteCycleMutation({
      cycleId: 'cycle_inflight_del',
      existingCycle: newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    // Delete must be queued offline rather than dispatched immediately or pruned
    assert.equal(deleteResult.status, 'QUEUED_OFFLINE');
    assert.equal(deleteFetchCalled, false, 'Delete must NOT be dispatched while create is in flight');

    const queueDuringFlight = getOfflineQueue(userId);
    assert.equal(queueDuringFlight.length, 2);
    assert.equal(queueDuringFlight[0].type, 'CREATE_CYCLE');
    assert.equal(queueDuringFlight[1].type, 'DELETE_CYCLE');

    // Complete create
    resolveCreateFetch!({});
    const createResult = await createPromise;
    assert.equal(createResult.status, 'SUCCESS');
    assert.equal(createResult.hasNewerIntent, true);

    // Queue now has DELETE_CYCLE with expectedRevision: 1
    const queueAfterCreate = getOfflineQueue(userId);
    assert.equal(queueAfterCreate.length, 1);
    assert.equal(queueAfterCreate[0].type, 'DELETE_CYCLE');
    assert.equal(queueAfterCreate[0].expectedRevision, 1);

    // Replay queue to execute DELETE
    const replayResult = await replayAccountOfflineQueue({
      authToken: 'valid_token',
      activeAccountId: userId,
      force: true,
      fetchFn: mockFetch
    });

    assert.equal(replayResult.syncedCount, 1);
    assert.equal(deleteFetchCalled, true);
    assert.equal(getOfflineQueue(userId).length, 0);
  });

  // =========================================================================
  // SCENARIO 22: Ambiguous CREATE Delivery / Network Failure with Queued Delete
  // =========================================================================
  await t.test('Scenario 22: Network failure during in-flight CREATE leaves CREATE ahead of DELETE in queue', async () => {
    let createFetchCalled = false;
    let resolveCreateFetch: (val?: any) => void;
    const createFetchPromise = new Promise((resolve) => {
      resolveCreateFetch = resolve;
    });

    const mockFetch = (async (url: string, init: any) => {
      if (init.method === 'POST') {
        createFetchCalled = true;
        await createFetchPromise;
        throw new TypeError('Failed to fetch (network disconnected)');
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const newCycle: Cycle = { ...baseCycle, id: 'cycle_net_fail_del' };

    const createPromise = executeDirectCreateCycleMutation({
      newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    await new Promise(r => setTimeout(r, 10));

    await executeDirectDeleteCycleMutation({
      cycleId: 'cycle_net_fail_del',
      existingCycle: newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    resolveCreateFetch!();
    const createResult = await createPromise;
    assert.equal(createResult.status, 'NETWORK_ERROR');

    // Both remain in queue in strict FIFO dependency order
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 2);
    assert.equal(queue[0].type, 'CREATE_CYCLE');
    assert.equal(queue[1].type, 'DELETE_CYCLE');
  });

  // =========================================================================
  // SCENARIO 23: Definitive CREATE Failure (400) with Queued Delete
  // =========================================================================
  await t.test('Scenario 23: Definitive CREATE failure (400) quarantines CREATE; subsequent DELETE gets 404 and is removed idempotently', async () => {
    let resolveCreateFetch: (val: any) => void;
    const createFetchPromise = new Promise(resolve => { resolveCreateFetch = resolve; });

    const mockFetch = (async (url: string, init: any) => {
      if (init.method === 'POST') {
        await createFetchPromise;
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: 'Invalid cycle dates', messageFa: 'تاریخ شروع نامعتبر است' })
        };
      }
      if (init.method === 'DELETE') {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: 'Cycle not found' })
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const newCycle: Cycle = { ...baseCycle, id: 'cycle_400_del' };

    const createPromise = executeDirectCreateCycleMutation({
      newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    await new Promise(r => setTimeout(r, 10));

    await executeDirectDeleteCycleMutation({
      cycleId: 'cycle_400_del',
      existingCycle: newCycle,
      ownerId: userId,
      authToken: 'valid_token',
      fetchFn: mockFetch
    });

    resolveCreateFetch!({});
    const createResult = await createPromise;
    assert.equal(createResult.status, 'VALIDATION_ERROR');

    // CREATE was quarantined/removed; DELETE_CYCLE remains
    const queueBeforeReplay = getOfflineQueue(userId);
    assert.equal(queueBeforeReplay.length, 1);
    assert.equal(queueBeforeReplay[0].type, 'DELETE_CYCLE');

    // Replay DELETE_CYCLE against server (gets 404, treated as idempotent success)
    const replayResult = await replayAccountOfflineQueue({
      authToken: 'valid_token',
      activeAccountId: userId,
      force: true,
      fetchFn: mockFetch
    });

    assert.equal(replayResult.syncedCount, 1);
    assert.equal(getOfflineQueue(userId).length, 0);
  });

  // =========================================================================
  // SCENARIO 24: Deterministic Isolation & Zero State Leakage
  // =========================================================================
  await t.test('Scenario 24: Deterministic isolation guarantees clear queue and runtime in-flight state across test passes', async () => {
    assert.equal(getOfflineQueue(userId).length, 0);
    assert.equal(getClientConflicts(userId).length, 0);
  });
});

