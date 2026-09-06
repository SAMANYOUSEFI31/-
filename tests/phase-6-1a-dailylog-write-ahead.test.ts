import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeDirectDailyLogMutation
} from '../src/utils/directMutationUtils.js';
import {
  getOfflineQueue,
  enqueueOfflineMutation,
  clearOfflineQueue,
  clearAllReplayLocks,
  resetRuntimeInFlightState
} from '../src/utils/offlineQueueUtils.js';
import { getClientConflicts, clearClientConflicts } from '../src/utils/offlineQueueUtils.js';
import { DailyLog } from '../src/types.js';

test('Phase 6.1A DailyLog Write-Ahead Durability & Lifecycle Contracts', async (t) => {
  const userId = 'user_phase6_1a_durability';
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

  const baseLog: DailyLog = {
    id: 'log_test_1',
    date: '1403-12-15',
    createdAt: new Date().toISOString(),
    cycleId: 'cycle_test_61a',
    completedHabitIds: ['habit_1', 'habit_2'],
    isSynced: false,
    revision: 1,
    wakeUp: true,
    workout: true,
    study: false,
    journal: true,
    hardTask: false,
    specialMission: false
  };

  // =========================================================================
  // CONTRACT 1: Durable Write-Ahead Enqueue BEFORE Any Network Dispatch
  // =========================================================================
  await t.test('enqueues mutation durably into owner queue before network request is sent', async () => {
    let networkDispatched = false;
    let queuePresentDuringFetch = false;

    const mockFetch = (async (url: string, init: any) => {
      networkDispatched = true;
      const currentQueue = getOfflineQueue(userId);
      queuePresentDuringFetch = currentQueue.length === 1 && currentQueue[0].type === 'UPDATE_LOG';
      return {
        ok: true,
        status: 200,
        json: async () => ({
          log: {
            ...baseLog,
            revision: 2,
            isSynced: true
          }
        })
      };
    }) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'test_token_valid',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(networkDispatched, true);
    assert.equal(queuePresentDuringFetch, true, 'Queue item MUST be present in storage before fetch completes');
    assert.equal(result.status, 'SUCCESS');
    assert.equal(getOfflineQueue(userId).length, 0, 'Confirmed item removed after verified success');
  });

  // =========================================================================
  // CONTRACT 2: Operation Identity & Contract Parity (clientOperationId == queueItem.id)
  // =========================================================================
  await t.test('request body carries clientOperationId identical to the write-ahead queue item id', async () => {
    let capturedBody: any = null;

    const mockFetch = (async (url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          log: {
            ...baseLog,
            revision: 2
          }
        })
      };
    }) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'test_token_valid',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'SUCCESS');
    if (result.status === 'SUCCESS') {
      assert.ok(result.queueItemId, 'Returned queueItemId must exist');
      assert.equal(capturedBody.clientOperationId, result.queueItemId, 'clientOperationId must equal queueItemId');
      assert.equal(capturedBody.expectedRevision, 1, 'expectedRevision must match existing log revision');
    }
  });

  // =========================================================================
  // CONTRACT 3: In-Flight Protection Against Premature Compaction/Overwrites
  // =========================================================================
  await t.test('in-flight item is not overwritten or mutated by rapid subsequent local edits', async () => {
    let releaseFetch: () => void = () => {};
    const fetchHoldPromise = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });

    const mockFetch = (async () => {
      await fetchHoldPromise;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          log: {
            ...baseLog,
            revision: 2
          }
        })
      };
    }) as any;

    // Start first mutation (which will wait on mockFetch)
    const mutationPromise = executeDirectDailyLogMutation({
      updatedLog: { ...baseLog, completedHabitIds: ['habit_1'] },
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'test_token_valid',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    // Give asynchronous tick to allow enqueue and fetch start
    await new Promise(r => setTimeout(r, 10));

    // Verify initial item is in flight
    const queueDuringFlight = getOfflineQueue(userId);
    assert.equal(queueDuringFlight.length, 1);
    assert.equal(queueDuringFlight[0].inFlight, true);
    const initialItemId = queueDuringFlight[0].id;

    // Simulate rapid second local edit while first is in-flight
    const newerLog: DailyLog = {
      ...baseLog,
      completedHabitIds: ['habit_1', 'habit_2', 'habit_3']
    };
    enqueueOfflineMutation(userId, {
      type: 'UPDATE_LOG',
      payload: newerLog,
      expectedRevision: 1
    });

    // Verify queue now preserves the second edit separately rather than overwriting in-flight item
    const queueAfterSecondEdit = getOfflineQueue(userId);
    assert.equal(queueAfterSecondEdit.length, 2, 'In-flight item must NOT be overwritten by rapid subsequent edit');
    assert.equal(queueAfterSecondEdit[0].id, initialItemId);
    assert.equal(queueAfterSecondEdit[0].inFlight, true);
    assert.equal(queueAfterSecondEdit[1].inFlight, false);

    // Release first fetch
    releaseFetch();
    const result = await mutationPromise;

    assert.equal(result.status, 'SUCCESS');
    if (result.status === 'SUCCESS') {
      assert.equal(result.hasNewerIntent, true, 'hasNewerIntent must be true when newer edit was queued during in-flight');
    }

    // After success, ONLY the first item is removed, and the second item has updated expectedRevision
    const remainingQueue = getOfflineQueue(userId);
    assert.equal(remainingQueue.length, 1, 'Only the confirmed in-flight item must be removed');
    assert.notEqual(remainingQueue[0].id, initialItemId);
    assert.equal(remainingQueue[0].expectedRevision, 2, 'Newer item must be upgraded to server revision 2');
  });

  // =========================================================================
  // CONTRACT 4: Response Validation & Malformed Success Response Safety
  // =========================================================================
  await t.test('malformed 200 response leaves mutation in queue with retry backoff', async () => {
    const mockFetch = (async () => {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          log: {
            date: 'wrong-date-9999', // Date mismatch!
            revision: 5
          }
        })
      };
    }) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'test_token_valid',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'INVALID_SUCCESS_RESPONSE');
    const queueAfter = getOfflineQueue(userId);
    assert.equal(queueAfter.length, 1, 'Mutation MUST NOT be deleted upon malformed server response');
    assert.equal(queueAfter[0].inFlight, false, 'inFlight flag must be reset');
    assert.equal(queueAfter[0].retryCount, 1);
    assert.equal(queueAfter[0].classification, 'INVALID_SUCCESS_RESPONSE');
  });

  // =========================================================================
  // CONTRACT 5: Concurrency Conflict (409/428) Removes Rejected Item & Records Conflict
  // =========================================================================
  await t.test('concurrency conflict (409) removes rejected item from queue to avoid replay loop', async () => {
    const mockFetch = (async () => {
      return {
        ok: false,
        status: 409,
        json: async () => ({
          error: 'CONCURRENCY_CONFLICT',
          messageFa: 'گزارش توسط دستگاه دیگری تغییر یافته است',
          currentRevision: 3,
          expectedRevision: 1,
          entityType: 'DAILY_LOG',
          entityId: baseLog.date
        })
      };
    }) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'test_token_valid',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'CONFLICT');
    if (result.status === 'CONFLICT') {
      assert.equal(result.statusCode, 409);
      assert.equal(result.conflictDetails.currentRevision, 3);
    }

    assert.equal(getOfflineQueue(userId).length, 0, 'Rejected item must be removed from queue so it does not loop');
    const conflicts = getClientConflicts(userId);
    assert.equal(conflicts.length, 1, 'Conflict must be durably recorded in client conflict store');
    assert.equal(conflicts[0].conflictType, 'CONCURRENCY_CONFLICT');
  });

  // =========================================================================
  // CONTRACT 6: Network Interruption / 5xx Preserves Item in Write-Ahead Queue
  // =========================================================================
  await t.test('network error preserves item in offline queue without creating duplicates', async () => {
    const mockFetch = (async () => {
      throw new Error('Failed to fetch: net::ERR_CONNECTION_REFUSED');
    }) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'test_token_valid',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'NETWORK_ERROR');
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1, 'Item MUST remain in the queue');
    assert.equal(queue[0].retryCount, 1);
    assert.equal(queue[0].inFlight, false, 'inFlight flag must be reset');
    assert.ok(queue[0].nextRetryAt, 'Exponential backoff timestamp must be set');
  });

  // =========================================================================
  // CONTRACT 7: Offline Guard (navigator.onLine === false) Stops Before Dispatch
  // =========================================================================
  await t.test('offline guard enqueues mutation and skips network dispatch completely', async () => {
    Object.defineProperty(globalThis.navigator, 'onLine', {
      value: false,
      configurable: true,
      writable: true
    });
    let fetchCalled = false;

    const mockFetch = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'test_token_valid',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'QUEUED_OFFLINE');
    assert.equal(fetchCalled, false, 'Network request MUST NOT be made when offline');
    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].type, 'UPDATE_LOG');
  });
});
