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
  resetRuntimeInFlightState,
  replayAccountOfflineQueue,
  getQuarantinedItems,
  clearQuarantine,
  getClientConflicts,
  clearClientConflicts
} from '../src/utils/offlineQueueUtils.js';
import { DailyLog } from '../src/types.js';

test('Phase 6.1A Corrective Pass: Stale inFlight Recovery and Direct HTTP Classification Matrix', async (suite) => {
  const userId = 'user_phase6_1a_corrective';
  const storageMock: Record<string, string> = {};

  const origWindow = (globalThis as any).window;
  const origLocalStorage = (globalThis as any).localStorage;

  suite.beforeEach(() => {
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
    clearQuarantine(userId);
    clearClientConflicts(userId);
    clearAllReplayLocks();
    resetRuntimeInFlightState();
  });

  suite.afterEach(() => {
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
    clearQuarantine(userId);
    clearClientConflicts(userId);
    clearAllReplayLocks();
    resetRuntimeInFlightState();
  });

  suite.after(() => {
    (globalThis as any).window = origWindow;
    (globalThis as any).localStorage = origLocalStorage;
  });

  const baseLog: DailyLog = {
    id: 'log_corrective_1',
    date: '1403-12-15',
    createdAt: new Date().toISOString(),
    cycleId: 'cycle_test_61a',
    completedHabitIds: ['habit_1', 'habit_2'],
    isSynced: false,
    revision: 2,
    wakeUp: true,
    workout: true,
    study: false,
    journal: true,
    hardTask: false,
    specialMission: false
  };

  // =========================================================================
  // SUITE 1: Stale inFlight Recovery Tests
  // =========================================================================

  await suite.test('normalizes persisted inFlight true to false on queue load while preserving identity and payload', () => {
    const queueKey = `bushido_offline_queue_user_${userId}`;
    const seededItem = {
      id: 'queue_stale_item_001',
      ownerId: userId,
      type: 'UPDATE_LOG',
      payload: {
        date: '1403-12-15',
        completedHabitIds: ['habit_1', 'habit_2'],
        clientOperationId: 'queue_stale_item_001',
        expectedRevision: 2
      },
      timestamp: 1700000000000,
      retryCount: 1,
      expectedRevision: 2,
      inFlight: true,
      dedupKey: 'log:cycle_test_61a:1403-12-15'
    };

    (globalThis as any).localStorage.setItem(queueKey, JSON.stringify([seededItem]));

    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, 'queue_stale_item_001');
    assert.equal(queue[0].inFlight, false);
    assert.equal(queue[0].expectedRevision, 2);
    assert.equal(queue[0].payload.clientOperationId, 'queue_stale_item_001');
    assert.deepEqual(queue[0].payload.completedHabitIds, ['habit_1', 'habit_2']);

    const persistedRaw = (globalThis as any).localStorage.getItem(queueKey);
    const persistedParsed = JSON.parse(persistedRaw!);
    assert.equal(persistedParsed[0].inFlight, false);
  });

  await suite.test('allows stale in-flight item to be replayed successfully by replay loop', async () => {
    const queueKey = `bushido_offline_queue_user_${userId}`;
    const seededItem = {
      id: 'queue_stale_replay_002',
      ownerId: userId,
      type: 'UPDATE_LOG',
      payload: {
        date: '1403-12-15',
        completedHabitIds: ['habit_1'],
        clientOperationId: 'queue_stale_replay_002',
        expectedRevision: 2
      },
      timestamp: 1700000000000,
      retryCount: 0,
      expectedRevision: 2,
      inFlight: true,
      dedupKey: 'log:cycle_test_61a:1403-12-15'
    };

    (globalThis as any).localStorage.setItem(queueKey, JSON.stringify([seededItem]));

    let dispatchedClientOpId = '';
    const mockFetch = (async (_url: string, init: any) => {
      const body = JSON.parse(init.body);
      dispatchedClientOpId = body.clientOperationId;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          log: {
            ...baseLog,
            revision: 3,
            completedHabitIds: ['habit_1']
          }
        })
      };
    }) as any;

    const replayResult = await replayAccountOfflineQueue({
      activeAccountId: userId,
      authToken: 'token_valid_corrective',
      fetchFn: mockFetch
    });

    assert.equal(replayResult.syncedCount, 1);
    assert.equal(replayResult.failedCount, 0);
    assert.equal(dispatchedClientOpId, 'queue_stale_replay_002');

    const remainingQueue = getOfflineQueue(userId);
    assert.equal(remainingQueue.length, 0);
  });

  await suite.test('compacts stale in-flight item in place when subsequent mutation arrives', () => {
    const queueKey = `bushido_offline_queue_user_${userId}`;
    const seededItem = {
      id: 'queue_stale_compact_003',
      ownerId: userId,
      type: 'UPDATE_LOG',
      payload: {
        date: '1403-12-15',
        cycleId: 'cycle_test_61a',
        completedHabitIds: ['habit_1'],
        clientOperationId: 'queue_stale_compact_003',
        expectedRevision: 2
      },
      timestamp: 1700000000000,
      retryCount: 1,
      expectedRevision: 2,
      inFlight: true,
      dedupKey: 'log:cycle_test_61a:1403-12-15'
    };

    (globalThis as any).localStorage.setItem(queueKey, JSON.stringify([seededItem]));

    const updatedItem = enqueueOfflineMutation(userId, {
      type: 'UPDATE_LOG',
      payload: {
        date: '1403-12-15',
        cycleId: 'cycle_test_61a',
        completedHabitIds: ['habit_1', 'habit_2', 'habit_3'],
        expectedRevision: 3
      },
      expectedRevision: 3
    });

    assert.equal(updatedItem.id, 'queue_stale_compact_003');
    assert.equal(updatedItem.payload.clientOperationId, 'queue_stale_compact_003');
    assert.deepEqual(updatedItem.payload.completedHabitIds, ['habit_1', 'habit_2', 'habit_3']);
    assert.equal(updatedItem.expectedRevision, 3);
    assert.equal(updatedItem.inFlight, false);

    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, 'queue_stale_compact_003');
  });

  await suite.test('preserves retryCount, nextRetryAt backoff, and failure classification when recovering stale in-flight item', () => {
    const queueKey = `bushido_offline_queue_user_${userId}`;
    const futureRetryAt = Date.now() + 15000;
    const seededItem = {
      id: 'queue_stale_meta_004',
      ownerId: userId,
      type: 'UPDATE_LOG',
      payload: {
        date: '1403-12-15',
        completedHabitIds: ['habit_1'],
        clientOperationId: 'queue_stale_meta_004'
      },
      timestamp: 1700000000000,
      retryCount: 3,
      nextRetryAt: futureRetryAt,
      lastError: 'Server returned HTTP 503',
      classification: 'SERVER_RETRYABLE',
      inFlight: true,
      dedupKey: 'log:cycle_test_61a:1403-12-15'
    };

    (globalThis as any).localStorage.setItem(queueKey, JSON.stringify([seededItem]));

    const queue = getOfflineQueue(userId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].id, 'queue_stale_meta_004');
    assert.equal(queue[0].inFlight, false);
    assert.equal(queue[0].retryCount, 3);
    assert.equal(queue[0].nextRetryAt, futureRetryAt);
    assert.equal(queue[0].classification, 'SERVER_RETRYABLE');
    assert.equal(queue[0].lastError, 'Server returned HTTP 503');
  });

  // =========================================================================
  // SUITE 2: Direct HTTP Classification Matrix Tests
  // =========================================================================

  await suite.test('HTTP 400 validation error quarantines item and removes from active queue', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid payload structure' })
    })) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'token_valid_corrective',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'VALIDATION_ERROR');
    assert.equal(result.statusCode, 400);

    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 0);

    const quarantined = getQuarantinedItems(userId);
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].items[0].id, result.queueItemId);
  });

  await suite.test('HTTP 401 unauthorized preserves mutation in active queue with zero backoff for re-auth', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 401,
      json: async () => ({ error: 'Unauthorized' })
    })) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'token_expired_corrective',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'AUTH_REQUIRED');
    assert.equal(result.statusCode, 401);

    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 1);
    assert.equal(activeQueue[0].id, result.queueItemId);
    assert.equal(activeQueue[0].inFlight, false);
    assert.equal(activeQueue[0].classification, 'AUTH_REQUIRED');
    assert.equal(activeQueue[0].nextRetryAt, undefined);

    const quarantined = getQuarantinedItems(userId);
    assert.equal(quarantined.length, 0);
  });

  await suite.test('HTTP 403 forbidden quarantines item and removes from active queue', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 403,
      json: async () => ({ error: 'Forbidden' })
    })) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'token_valid_corrective',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'FORBIDDEN');
    assert.equal(result.statusCode, 403);

    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 0);

    const quarantined = getQuarantinedItems(userId);
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].items[0].id, result.queueItemId);
  });

  await suite.test('HTTP 404 entity missing quarantines UPDATE_LOG and removes from active queue', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Cycle or Log target not found' })
    })) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'token_valid_corrective',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'ENTITY_MISSING');
    assert.equal(result.statusCode, 404);

    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 0);

    const quarantined = getQuarantinedItems(userId);
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].items[0].id, result.queueItemId);
  });

  await suite.test('HTTP 409 conflict removes from active queue and logs client conflict record', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'Revision mismatch',
        currentRevision: 5,
        expectedRevision: 2
      })
    })) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'token_valid_corrective',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'CONFLICT');
    assert.equal(result.statusCode, 409);

    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 0);

    const conflicts = getClientConflicts(userId);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].conflictType, 'CONCURRENCY_CONFLICT');
    assert.equal(conflicts[0].currentRevision, 5);
  });

  await suite.test('HTTP 428 precondition required removes from active queue and logs client conflict record', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 428,
      json: async () => ({
        error: 'Precondition Required: expectedRevision header missing or non-positive'
      })
    })) as any;

    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'token_valid_corrective',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'CONFLICT');
    assert.equal(result.statusCode, 428);

    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 0);

    const conflicts = getClientConflicts(userId);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].conflictType, 'PRECONDITION_REQUIRED');
  });

  await suite.test('HTTP 429 rate limited preserves mutation in active queue with exponential backoff', async () => {
    const mockFetch = (async () => ({
      ok: false,
      status: 429,
      json: async () => ({ error: 'Too Many Requests' })
    })) as any;

    const beforeTime = Date.now();
    const result = await executeDirectDailyLogMutation({
      updatedLog: baseLog,
      existingLog: baseLog,
      ownerId: userId,
      authToken: 'token_valid_corrective',
      activeCycleId: 'cycle_test_61a',
      fetchFn: mockFetch
    });

    assert.equal(result.status, 'RATE_LIMITED');
    assert.equal(result.statusCode, 429);
    assert.equal(result.retryCount, 1);
    assert.ok((result.nextRetryAt ?? 0) >= beforeTime);

    const activeQueue = getOfflineQueue(userId);
    assert.equal(activeQueue.length, 1);
    assert.equal(activeQueue[0].id, result.queueItemId);
    assert.equal(activeQueue[0].inFlight, false);
    assert.equal(activeQueue[0].classification, 'RATE_LIMITED');
    assert.equal(activeQueue[0].retryCount, 1);
    assert.ok((activeQueue[0].nextRetryAt ?? 0) >= beforeTime);

    const quarantined = getQuarantinedItems(userId);
    assert.equal(quarantined.length, 0);
  });

  await suite.test('HTTP 500/502/503/408 server retryable preserves mutation in active queue with backoff', async () => {
    for (const status of [500, 502, 503, 408]) {
      clearOfflineQueue(userId);
      clearQuarantine(userId);

      const mockFetch = (async () => ({
        ok: false,
        status,
        json: async () => ({ error: `Server error ${status}` })
      })) as any;

      const beforeTime = Date.now();
      const result = await executeDirectDailyLogMutation({
        updatedLog: baseLog,
        existingLog: baseLog,
        ownerId: userId,
        authToken: 'token_valid_corrective',
        activeCycleId: 'cycle_test_61a',
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'SERVER_RETRYABLE');
      assert.equal(result.statusCode, status);
      assert.equal(result.retryCount, 1);
      assert.ok((result.nextRetryAt ?? 0) >= beforeTime);

      const activeQueue = getOfflineQueue(userId);
      assert.equal(activeQueue.length, 1);
      assert.equal(activeQueue[0].id, result.queueItemId);
      assert.equal(activeQueue[0].inFlight, false);
      assert.equal(activeQueue[0].classification, 'SERVER_RETRYABLE');

      const quarantined = getQuarantinedItems(userId);
      assert.equal(quarantined.length, 0);
    }
  });
});
