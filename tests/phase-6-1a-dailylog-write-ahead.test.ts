import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeDirectDailyLogMutation
} from '../src/utils/directMutationUtils.js';
import {
  getOfflineQueue,
  enqueueOfflineMutation,
  enqueueDurableDailyLogWriteAhead,
  verifyDurableQueueItemPersistence,
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

  // =========================================================================
  // CONTRACT 8: Storage Failure 1 - localStorage.setItem Throws
  // =========================================================================
  await t.test('localStorage.setItem throws during Write-Ahead persistence', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const origSetItem = (globalThis as any).window.localStorage.setItem;
    (globalThis as any).window.localStorage.setItem = () => {
      throw new Error('QuotaExceededError: DOM Exception 22');
    };

    try {
      const result = await executeDirectDailyLogMutation({
        updatedLog: baseLog,
        existingLog: baseLog,
        ownerId: userId,
        authToken: 'test_token_valid',
        activeCycleId: 'cycle_test_61a',
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'STORAGE_WRITE_FAILED');
      if (result.status === 'STORAGE_WRITE_FAILED') {
        assert.equal(result.reason, 'STORAGE_WRITE_FAILED');
        assert.ok(result.messageFa);
        assert.ok(!result.messageFa.includes('QuotaExceededError'), 'Must not leak raw exception to user-facing message');
        assert.ok(!result.messageFa.includes('test_token_valid'), 'Must not leak token');
      }
      assert.equal(fetchCalled, false, 'Fetch MUST NOT be called when storage persistence throws');
      assert.equal(getOfflineQueue(userId).length, 0, 'No item should be reported queued');
      assert.equal(getClientConflicts(userId).length, 0, 'No conflict should be generated');
    } finally {
      (globalThis as any).window.localStorage.setItem = origSetItem;
    }
  });

  // =========================================================================
  // CONTRACT 9: Storage Failure 2 - localStorage.setItem Silently Fails (Readback Null)
  // =========================================================================
  await t.test('localStorage.setItem silently fails or read-back returns null', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const origSetItem = (globalThis as any).window.localStorage.setItem;
    // Silent failure: setItem is a no-op, nothing is persisted to storageMock
    (globalThis as any).window.localStorage.setItem = () => {};

    try {
      const result = await executeDirectDailyLogMutation({
        updatedLog: baseLog,
        existingLog: baseLog,
        ownerId: userId,
        authToken: 'test_token_valid',
        activeCycleId: 'cycle_test_61a',
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'STORAGE_WRITE_FAILED');
      if (result.status === 'STORAGE_WRITE_FAILED') {
        assert.ok(
          result.reason === 'STORAGE_READBACK_NULL' || result.reason === 'STORAGE_WRITE_FAILED',
          `Expected STORAGE_READBACK_NULL or STORAGE_WRITE_FAILED, got ${result.reason}`
        );
      }
      assert.equal(fetchCalled, false, 'Fetch MUST NOT be called when read-back returns null');
      assert.equal(getClientConflicts(userId).length, 0);
    } finally {
      (globalThis as any).window.localStorage.setItem = origSetItem;
    }
  });

  // =========================================================================
  // CONTRACT 10: Storage Failure 3 - Read-back Returns Queue Without Expected Operation ID
  // =========================================================================
  await t.test('read-back returns a Queue without the expected operation ID', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const origSetItem = (globalThis as any).window.localStorage.setItem;
    // Corrupt write: write an item with an arbitrary mismatched ID
    (globalThis as any).window.localStorage.setItem = (key: string) => {
      storageMock[key] = JSON.stringify([
        {
          id: 'unrelated_stale_operation_999',
          ownerId: userId,
          type: 'UPDATE_LOG',
          payload: { date: baseLog.date }
        }
      ]);
    };

    try {
      const result = await executeDirectDailyLogMutation({
        updatedLog: baseLog,
        existingLog: baseLog,
        ownerId: userId,
        authToken: 'test_token_valid',
        activeCycleId: 'cycle_test_61a',
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'STORAGE_WRITE_FAILED');
      if (result.status === 'STORAGE_WRITE_FAILED') {
        assert.equal(result.reason, 'ITEM_NOT_FOUND_IN_STORAGE');
      }
      assert.equal(fetchCalled, false, 'Fetch MUST NOT be called when operation ID is missing');
      assert.equal(getClientConflicts(userId).length, 0);
    } finally {
      (globalThis as any).window.localStorage.setItem = origSetItem;
    }
  });

  // =========================================================================
  // CONTRACT 11: Storage Failure 4 - Read-back Item Has Mismatched Owner
  // =========================================================================
  await t.test('read-back item has a mismatched owner', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const origSetItem = (globalThis as any).window.localStorage.setItem;
    // Mutate ownerId to another owner
    (globalThis as any).window.localStorage.setItem = (key: string, val: string) => {
      try {
        const parsed = JSON.parse(val);
        const poisoned = parsed.map((item: any) => ({ ...item, ownerId: 'user_rogue_intruder' }));
        storageMock[key] = JSON.stringify(poisoned);
      } catch {
        storageMock[key] = val;
      }
    };

    try {
      const result = await executeDirectDailyLogMutation({
        updatedLog: baseLog,
        existingLog: baseLog,
        ownerId: userId,
        authToken: 'test_token_valid',
        activeCycleId: 'cycle_test_61a',
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'STORAGE_WRITE_FAILED');
      if (result.status === 'STORAGE_WRITE_FAILED') {
        assert.equal(result.reason, 'OWNER_MISMATCH');
      }
      assert.equal(fetchCalled, false, 'Fetch MUST NOT be called when owner mismatches');
      assert.equal(getClientConflicts(userId).length, 0);
    } finally {
      (globalThis as any).window.localStorage.setItem = origSetItem;
    }
  });

  // =========================================================================
  // CONTRACT 12: Storage Failure 5 - Read-back Item Has Mismatched Mutation Type
  // =========================================================================
  await t.test('read-back item has a mismatched mutation type', async () => {
    let fetchCalled = false;
    const mockFetch = (async () => {
      fetchCalled = true;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    const origSetItem = (globalThis as any).window.localStorage.setItem;
    // Mutate type to UPDATE_CYCLE instead of UPDATE_LOG
    (globalThis as any).window.localStorage.setItem = (key: string, val: string) => {
      try {
        const parsed = JSON.parse(val);
        const poisoned = parsed.map((item: any) => ({ ...item, type: 'UPDATE_CYCLE' }));
        storageMock[key] = JSON.stringify(poisoned);
      } catch {
        storageMock[key] = val;
      }
    };

    try {
      const result = await executeDirectDailyLogMutation({
        updatedLog: baseLog,
        existingLog: baseLog,
        ownerId: userId,
        authToken: 'test_token_valid',
        activeCycleId: 'cycle_test_61a',
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'STORAGE_WRITE_FAILED');
      if (result.status === 'STORAGE_WRITE_FAILED') {
        assert.equal(result.reason, 'MUTATION_TYPE_MISMATCH');
      }
      assert.equal(fetchCalled, false, 'Fetch MUST NOT be called when mutation type mismatches');
      assert.equal(getClientConflicts(userId).length, 0);
    } finally {
      (globalThis as any).window.localStorage.setItem = origSetItem;
    }
  });

  // =========================================================================
  // CONTRACT 13: Storage Failure Behavior Guarantees (Zero Fetch, No Conflict, Multi-Owner Isolation)
  // =========================================================================
  await t.test('Storage failure causes zero fetch calls, does not claim queued, and preserves other owner queues', async () => {
    const otherUser = 'user_other_account_protected';
    // Pre-populate other user's queue
    enqueueOfflineMutation(otherUser, {
      type: 'UPDATE_LOG',
      payload: { date: '1403-12-20', wakeUp: true }
    });
    assert.equal(getOfflineQueue(otherUser).length, 1, 'Other user queue must exist initially');

    let fetchCalls = 0;
    const mockFetch = (async () => {
      fetchCalls++;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as any;

    // Simulate storage failure for userId
    const origSetItem = (globalThis as any).window.localStorage.setItem;
    (globalThis as any).window.localStorage.setItem = () => {
      throw new Error('Storage write failed');
    };

    try {
      const result = await executeDirectDailyLogMutation({
        updatedLog: baseLog,
        existingLog: baseLog,
        ownerId: userId,
        authToken: 'test_token_valid',
        activeCycleId: 'cycle_test_61a',
        fetchFn: mockFetch
      });

      // 6. Storage failure causes zero fetch calls
      assert.equal(fetchCalls, 0, 'Must have exactly zero fetch calls on storage failure');

      // 7. Storage failure returns explicit typed failure result
      assert.equal(result.status, 'STORAGE_WRITE_FAILED');

      // 8. Storage failure does not claim mutation is queued
      assert.notEqual(result.status, 'QUEUED_OFFLINE');

      // 9. Storage failure does not create a conflict
      assert.equal(getClientConflicts(userId).length, 0, 'No conflict record should be recorded');

      // 10. Storage failure does not remove or modify another owner queue
      const otherQueue = getOfflineQueue(otherUser);
      assert.equal(otherQueue.length, 1, 'Other owner queue MUST remain intact');
      assert.equal(otherQueue[0].payload.date, '1403-12-20');
    } finally {
      (globalThis as any).window.localStorage.setItem = origSetItem;
      clearOfflineQueue(otherUser);
    }
  });

  // =========================================================================
  // CONTRACT 14: Successful Persistence Dispatches Exactly Once With Verified Queue Item ID
  // =========================================================================
  await t.test('successful persistence dispatches exactly one request with verified queue item ID', async () => {
    let fetchCalls = 0;
    let capturedBody: any = null;

    const mockFetch = (async (url: string, init: any) => {
      fetchCalls++;
      capturedBody = JSON.parse(init.body);
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

    // 11. Successful persistence dispatches exactly one request
    assert.equal(fetchCalls, 1, 'Successful persistence must dispatch exactly one network request');
    assert.equal(result.status, 'SUCCESS');

    if (result.status === 'SUCCESS') {
      // 12. Successful dispatch uses verified Queue Item ID as clientOperationId
      assert.ok(result.queueItemId, 'Result must contain queueItemId');
      assert.equal(capturedBody.clientOperationId, result.queueItemId);
    }
  });
});
