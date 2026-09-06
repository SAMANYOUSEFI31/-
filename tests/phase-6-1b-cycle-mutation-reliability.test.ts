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
  clearClientConflicts
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
});
