import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getScopedOfflineQueueKey,
  getOfflineQueue,
  saveOfflineQueue,
  clearOfflineQueue,
  enqueueOfflineMutation,
  removeReplayedQueueItems,
  recordQueueItemFailure,
  replayAccountOfflineQueue,
  quarantineQueueItems,
  getQuarantinedItems,
  clearQuarantine,
  acquireReplayLock,
  renewReplayLock,
  verifyReplayLock,
  releaseReplayLock,
  clearAllReplayLocks,
  classifyReplayResponse,
  sanitizePayloadForQuarantine,
  sanitizeErrorMessage,
  calculateReplayBackoffMs,
  MAX_REPLAY_BACKOFF_MS,
  INITIAL_REPLAY_BACKOFF_MS,
  MAX_SANITIZATION_DEPTH,
  resolveReplayLockTimeout,
  resolveHeartbeatInterval,
  REPLAY_LOCK_TIMEOUT_MS,
  REPLAY_LOCK_HEARTBEAT_INTERVAL_MS
} from '../src/utils/offlineQueueUtils.js';
import { OfflineQueueItem, ReplayFailureClassification } from '../src/types.js';

describe('Phase 3B.3: Replay Contract Final Closure Suite', () => {
  const storageMock: Record<string, string> = {};
  const testUser = 'usr_3b3_closure_tester';
  const testToken = 'tok_3b3_closure_token';

  beforeEach(() => {
    for (const k in storageMock) delete storageMock[k];
    clearAllReplayLocks();

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
  });

  // ===========================================================================
  // 1. BACKOFF ENFORCEMENT & DEFERRAL CONTRACT
  // ===========================================================================
  describe('1. Backoff Enforcement & Deferral Contract', () => {
    it('calculates bounded exponential backoff with jitter and records nextRetryAt', () => {
      const b1 = calculateReplayBackoffMs(1);
      assert.ok(b1 >= INITIAL_REPLAY_BACKOFF_MS, 'Backoff 1 >= initial backoff');
      assert.ok(b1 <= INITIAL_REPLAY_BACKOFF_MS + 1000, 'Backoff 1 <= initial + jitter');

      const b2 = calculateReplayBackoffMs(2);
      assert.ok(b2 >= 4000, 'Backoff 2 >= 4000ms');

      const bMax = calculateReplayBackoffMs(15);
      assert.ok(bMax <= MAX_REPLAY_BACKOFF_MS, 'Backoff must never exceed max cap (30000ms)');

      clearOfflineQueue(testUser);
      const item = enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-15' }
      });

      const now = Date.now();
      recordQueueItemFailure(testUser, item.id, 'HTTP 503 Service Unavailable', b1, 'SERVER_RETRYABLE');
      const updatedQueue = getOfflineQueue(testUser);
      assert.equal(updatedQueue[0].retryCount, 1);
      assert.equal(updatedQueue[0].classification, 'SERVER_RETRYABLE');
      assert.ok(updatedQueue[0].nextRetryAt && updatedQueue[0].nextRetryAt >= now);
    });

    it('active replay loop defers requests when nextRetryAt is in the future unless force is true', async () => {
      clearOfflineQueue(testUser);

      // Create item scheduled 10 seconds in future
      const futureTime = Date.now() + 10000;
      const queuedItem = enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-16', workout: true }
      });

      // Manually set backoff in storage
      const queue = getOfflineQueue(testUser);
      queue[0].nextRetryAt = futureTime;
      queue[0].retryCount = 2;
      saveOfflineQueue(testUser, queue);

      let netCalls = 0;
      const countingFetch = async () => {
        netCalls++;
        return { ok: true, status: 200, json: async () => ({}) };
      };

      // Default run (respectBackoff: true): must defer without making network calls
      const resDeferred = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        respectBackoff: true,
        fetchFn: countingFetch as any
      });

      assert.equal(netCalls, 0, 'Network call must not occur while backoff is active');
      assert.equal(resDeferred.syncedCount, 0);
      assert.equal(getOfflineQueue(testUser).length, 1, 'Item remains in queue');

      // Forced run (force: true): immediately executes
      const resForced = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        force: true,
        fetchFn: countingFetch as any
      });

      assert.equal(netCalls, 1, 'Forced sync must bypass backoff and execute network call');
      assert.equal(resForced.syncedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 0, 'Item successfully pruned');
    });
  });

  // ===========================================================================
  // 2. HTTP RESPONSE CLASSIFICATION MATRIX
  // ===========================================================================
  describe('2. HTTP Response Classification Matrix', () => {
    it('classifies 200, 201, 204 as SUCCESS', () => {
      assert.equal(classifyReplayResponse(200, 'UPDATE_LOG'), 'SUCCESS');
      assert.equal(classifyReplayResponse(201, 'CREATE_CYCLE'), 'SUCCESS');
      assert.equal(classifyReplayResponse(204, 'DELETE_CYCLE'), 'SUCCESS');
    });

    it('classifies 401 as AUTH_REQUIRED and defers without quarantine', async () => {
      assert.equal(classifyReplayResponse(401, 'UPDATE_PROFILE'), 'AUTH_REQUIRED');

      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Unauthorized User' }
      });

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (async () => ({ ok: false, status: 401, statusText: 'Unauthorized' })) as any
      });

      assert.equal(res.failedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 1, '401 items must remain in active queue for token renewal');
      assert.equal(getQuarantinedItems(testUser).length, 0, '401 must not be quarantined');
    });

    it('classifies 403 as FORBIDDEN and quarantines', async () => {
      assert.equal(classifyReplayResponse(403, 'UPDATE_PROFILE'), 'FORBIDDEN');

      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Forbidden Op' }
      });

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (async () => ({ ok: false, status: 403, statusText: 'Forbidden' })) as any
      });

      assert.equal(res.failedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 0, '403 item must be removed from active queue');
      assert.equal(getQuarantinedItems(testUser).length, 1, '403 item must be quarantined');
    });

    it('classifies 400 and 422 as VALIDATION_ERROR and quarantines immediately', async () => {
      assert.equal(classifyReplayResponse(400, 'UPDATE_CYCLE'), 'VALIDATION_ERROR');
      assert.equal(classifyReplayResponse(422, 'UPDATE_CYCLE'), 'VALIDATION_ERROR');

      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'cyc_invalid', title: 'Invalid' }
      });

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (async () => ({ ok: false, status: 400, statusText: 'Validation Failed' })) as any
      });

      assert.equal(res.failedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 0);
      assert.equal(getQuarantinedItems(testUser).length, 1);
    });

    it('classifies 404 on DELETE_CYCLE as SUCCESS and other 404s as ENTITY_MISSING', async () => {
      assert.equal(classifyReplayResponse(404, 'DELETE_CYCLE'), 'SUCCESS');
      assert.equal(classifyReplayResponse(404, 'UPDATE_CYCLE'), 'ENTITY_MISSING');

      // Test DELETE_CYCLE 404 is success
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'DELETE_CYCLE',
        payload: { id: 'cyc_already_deleted' }
      });

      const resDelete = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (async () => ({ ok: false, status: 404 })) as any
      });
      assert.equal(resDelete.syncedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 0);
      assert.equal(getQuarantinedItems(testUser).length, 0);

      // Test UPDATE_CYCLE 404 is quarantined as missing entity
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'cyc_non_existent', title: 'Ghost' }
      });

      const resUpdate = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (async () => ({ ok: false, status: 404 })) as any
      });
      assert.equal(resUpdate.failedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 0);
      assert.equal(getQuarantinedItems(testUser).length, 1);
    });

    it('classifies 408, 429, 500, 502, 503, 504 as retryable and preserves in active queue', async () => {
      const retryCodes = [408, 429, 500, 502, 503, 504];

      for (const code of retryCodes) {
        clearOfflineQueue(testUser);
        clearQuarantine(testUser);

        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-17', workout: true }
        });

        const res = await replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          force: true,
          fetchFn: (async () => ({ ok: false, status: code, statusText: `Error ${code}` })) as any
        });

        assert.equal(res.failedCount, 1);
        assert.equal(getOfflineQueue(testUser).length, 1, `HTTP ${code} must preserve queue item`);
        assert.equal(getQuarantinedItems(testUser).length, 0, `HTTP ${code} must not quarantine`);
      }
    });

    it('classifies 409 Conflict as CONFLICT_DEFERRED and isolates to quarantine', async () => {
      clearOfflineQueue(testUser);
      clearQuarantine(testUser);

      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'cyc_conflict', title: 'Conflict Cycle' }
      });

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (async () => ({ ok: false, status: 409, statusText: 'Conflict' })) as any
      });

      assert.equal(res.failedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 0, '409 Conflict item removed from active queue');
      const quarantined = getQuarantinedItems(testUser);
      assert.equal(quarantined.length, 1);
      assert.equal(quarantined[0].items[0].classification, 'CONFLICT_DEFERRED');
    });
  });

  // ===========================================================================
  // 3. UNKNOWN MUTATION TYPE SAFETY
  // ===========================================================================
  describe('3. Unknown Mutation Type Safety', () => {
    it('quarantines unknown mutation types immediately without issuing network requests', async () => {
      clearOfflineQueue(testUser);

      // Enqueue an unknown/unsupported mutation type
      const unknownItem = enqueueOfflineMutation(testUser, {
        type: 'UNKNOWN_FUTURE_MUTATION' as any,
        payload: { customData: 'foo' }
      });

      let netCalled = false;
      const fetchSpy = async () => {
        netCalled = true;
        return { ok: true, status: 200 };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: fetchSpy as any
      });

      assert.equal(netCalled, false, 'Network call must never be made for unknown mutations');
      assert.equal(res.failedCount, 1);
      assert.equal(getOfflineQueue(testUser).length, 0, 'Unknown item removed from active queue');

      const quarantined = getQuarantinedItems(testUser);
      assert.equal(quarantined.length, 1);
      assert.equal(quarantined[0].items[0].type as any, 'UNKNOWN_FUTURE_MUTATION');
      assert.ok(quarantined[0].reason.includes('UNKNOWN_MUTATION'));
    });
  });

  // ===========================================================================
  // 4. CROSS-TAB LEASE & CAS LOCK SAFETY, IN-FLIGHT HEARTBEAT & BOUNDARIES
  // ===========================================================================
  describe('4. Cross-Tab Lease & CAS Lock Safety & In-Flight Heartbeat', () => {
    it('renews replay lock while held and prevents expiration', () => {
      const lockId = acquireReplayLock(testUser);
      assert.ok(lockId);

      const verified = verifyReplayLock(testUser, lockId!);
      assert.equal(verified, true, 'Lock must verify as owned');

      const renewed = renewReplayLock(testUser, lockId!);
      assert.equal(renewed, true, 'Lock renewal must succeed');

      // Verify lock with wrong ID fails
      assert.equal(verifyReplayLock(testUser, 'wrong_id'), false);
      assert.equal(renewReplayLock(testUser, 'wrong_id'), false);

      releaseReplayLock(testUser, lockId!);
    });

    it('expired lease cannot be renewed by its former holder', () => {
      const lockId = acquireReplayLock(testUser);
      assert.ok(lockId);

      // Force expiration in storage
      const lockKey = `bushido_replay_lock_${testUser}`;
      storageMock[lockKey] = JSON.stringify({
        lockId,
        timestamp: Date.now() - 15000 // 15 seconds ago > 10s timeout
      });

      const renewed = renewReplayLock(testUser, lockId!);
      assert.equal(renewed, false, 'Expired lease cannot be renewed by former holder');
    });

    it('stale lock holder cannot renew or release a newly acquired lease', () => {
      const lock1 = acquireReplayLock(testUser);
      assert.ok(lock1);

      // Release legitimate lock
      releaseReplayLock(testUser, lock1!);

      // Tab 2 acquires lock
      const lock2 = acquireReplayLock(testUser);
      assert.ok(lock2);

      // Tab 1 tries to renew with stale lock1
      const staleRenew = renewReplayLock(testUser, lock1!);
      assert.equal(staleRenew, false, 'Stale holder cannot renew newer lease');

      // Tab 1 tries to release with its stale lock1
      const staleRelease = releaseReplayLock(testUser, lock1!);
      assert.equal(staleRelease, false, 'Stale lock release must fail');

      // Verify Tab 2 still owns the lock intact
      assert.equal(verifyReplayLock(testUser, lock2!), true);
      releaseReplayLock(testUser, lock2!);
    });

    it('in-flight request running longer than original lease timeout keeps lease alive through heartbeat renewal and blocks second tab after original timeout', async () => {
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });

      const effectiveLeaseTimeout = 80;
      const effectiveHeartbeat = 20;

      let tab2AcquisitionAttemptAfterTimeout: string | null = 'not_attempted';
      let observedTimestamps: number[] = [];
      const lockKey = `bushido_replay_lock_${testUser}`;

      const slowFetch = async () => {
        // Record initial timestamp
        const initialParsed = JSON.parse(storageMock[lockKey]);
        const startTs = initialParsed.timestamp;
        observedTimestamps.push(startTs);

        // In-flight request duration (125ms) > effective lease timeout (80ms)
        // Wait 95ms so the original 80ms lease timeout boundary has strictly passed
        await new Promise(r => setTimeout(r, 95));

        // Simulated Tab 2 attempts to acquire the lease with the same lease timeout
        tab2AcquisitionAttemptAfterTimeout = acquireReplayLock(testUser, effectiveLeaseTimeout);

        const currentParsed = JSON.parse(storageMock[lockKey]);
        observedTimestamps.push(currentParsed.timestamp);

        // Finish remainder of in-flight slow request
        await new Promise(r => setTimeout(r, 30));

        return { ok: true, status: 200, json: async () => ({}) };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: slowFetch as any,
        leaseTimeoutMs: effectiveLeaseTimeout,
        heartbeatIntervalMs: effectiveHeartbeat
      });

      assert.equal(res.syncedCount, 1, 'Tab 1 must complete its request successfully');
      assert.equal(tab2AcquisitionAttemptAfterTimeout, null, 'Second tab must fail to acquire lease after original 80ms timeout because heartbeat renewed it');
      assert.ok(observedTimestamps.length >= 2);
      assert.ok(observedTimestamps[1] > observedTimestamps[0], 'Heartbeat must have advanced lease timestamp during in-flight request');
    });

    it('second simulated tab cannot acquire account lease while in-flight heartbeat is active', async () => {
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });

      let tab2AcquisitionAttempt: string | null = 'not_attempted';

      const slowFetch = async () => {
        await new Promise(r => setTimeout(r, 40));
        // Simulate Tab 2 attempting to acquire lease during Tab 1 in-flight fetch
        tab2AcquisitionAttempt = acquireReplayLock(testUser);
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: slowFetch as any,
        heartbeatIntervalMs: 10
      });

      assert.equal(res.syncedCount, 1);
      assert.equal(tab2AcquisitionAttempt, null, 'Second tab must not acquire lease while heartbeat is active');
    });

    // --- Strict Timer Cleanup Proofs (Success, Network Error, HTTP Error, Lock Loss) ---
    const runTimerTrackingTest = async (testAction: (spy: { getPostCompletionInvocations: () => number }) => Promise<void>) => {
      const activeIntervalIds = new Set<any>();
      let postCompletionInvocations = 0;
      let isReplayFinished = false;

      const origSetInterval = globalThis.setInterval;
      const origClearInterval = globalThis.clearInterval;

      globalThis.setInterval = ((fn: Function, ms?: number, ...args: any[]) => {
        const id = origSetInterval((...callArgs: any[]) => {
          if (isReplayFinished) {
            postCompletionInvocations++;
          }
          return fn(...callArgs);
        }, ms, ...args);
        activeIntervalIds.add(id);
        return id;
      }) as any;

      globalThis.clearInterval = ((id: any) => {
        activeIntervalIds.delete(id);
        return origClearInterval(id);
      }) as any;

      try {
        await testAction({
          getPostCompletionInvocations: () => postCompletionInvocations
        });
        isReplayFinished = true;

        assert.equal(activeIntervalIds.size, 0, 'All interval timer handles must be cleared');
        // Wait 45ms to ensure no orphaned heartbeat callback fires after completion
        await new Promise(r => setTimeout(r, 45));
        assert.equal(postCompletionInvocations, 0, 'No heartbeat callback must fire after completion');
      } finally {
        isReplayFinished = true;
        for (const id of activeIntervalIds) {
          origClearInterval(id);
        }
        globalThis.setInterval = origSetInterval;
        globalThis.clearInterval = origClearInterval;
      }
    };

    it('heartbeat callback terminates and cleans up timer on successful response', async () => {
      await runTimerTrackingTest(async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const res = await replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (async () => {
            await new Promise(r => setTimeout(r, 25));
            return { ok: true, status: 200, json: async () => ({}) };
          }) as any,
          leaseTimeoutMs: 100,
          heartbeatIntervalMs: 10
        });

        assert.equal(res.syncedCount, 1);
        const lockKey = `bushido_replay_lock_${testUser}`;
        assert.equal(storageMock[lockKey], undefined, 'Lease must be cleanly released upon replay completion');
      });
    });

    it('heartbeat callback terminates and cleans up timer on network exception', async () => {
      await runTimerTrackingTest(async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const res = await replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (async () => {
            await new Promise(r => setTimeout(r, 25));
            throw new Error('Simulated network connection drop');
          }) as any,
          leaseTimeoutMs: 100,
          heartbeatIntervalMs: 10
        });

        assert.equal(res.failedCount, 1);
        const lockKey = `bushido_replay_lock_${testUser}`;
        assert.equal(storageMock[lockKey], undefined, 'Lease must be released after network error');
      });
    });

    it('heartbeat callback terminates and cleans up timer on HTTP failure (500)', async () => {
      await runTimerTrackingTest(async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const res = await replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (async () => {
            await new Promise(r => setTimeout(r, 25));
            return { ok: false, status: 500, statusText: 'Internal Server Error' };
          }) as any,
          leaseTimeoutMs: 100,
          heartbeatIntervalMs: 10
        });

        assert.equal(res.failedCount, 1);
        const lockKey = `bushido_replay_lock_${testUser}`;
        assert.equal(storageMock[lockKey], undefined, 'Lease must be released after HTTP failure');
      });
    });

    it('heartbeat callback terminates and cleans up timer on lock loss', async () => {
      await runTimerTrackingTest(async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const res = await replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (async () => {
            await new Promise(r => setTimeout(r, 15));
            // External tab steals lock in storage
            const stealKey = `bushido_replay_lock_${testUser}`;
            storageMock[stealKey] = JSON.stringify({
              lockId: 'foreign_tab_takeover',
              timestamp: Date.now() + 60000,
              ownerId: testUser
            });
            await new Promise(r => setTimeout(r, 25));
            return { ok: true, status: 200, json: async () => ({}) };
          }) as any,
          leaseTimeoutMs: 100,
          heartbeatIntervalMs: 10
        });

        assert.equal(res.stoppedDueToLockLoss, true, 'Must report stoppedDueToLockLoss');
      });
    });

    // --- Boundary Tests: Heartbeat & Lease Interval Validations ---
    it('normalizes heartbeat interval equal to lease timeout to strictly below timeout', () => {
      const leaseTimeout = 100;
      const normalized = resolveHeartbeatInterval(100, leaseTimeout);
      assert.ok(normalized < leaseTimeout, 'Heartbeat must be strictly below lease timeout');
      assert.ok(normalized >= 5, 'Heartbeat must be at least min bound');
    });

    it('normalizes heartbeat interval greater than lease timeout to strictly below timeout', () => {
      const leaseTimeout = 100;
      const normalized = resolveHeartbeatInterval(250, leaseTimeout);
      assert.ok(normalized < leaseTimeout, 'Heartbeat must be strictly below lease timeout');
      assert.ok(normalized >= 5, 'Heartbeat must be at least min bound');
    });

    it('normalizes zero, negative, NaN, and Infinity heartbeat configurations safely', () => {
      const leaseTimeout = 1000;
      const zeroVal = resolveHeartbeatInterval(0, leaseTimeout);
      const negVal = resolveHeartbeatInterval(-50, leaseTimeout);
      const nanVal = resolveHeartbeatInterval(NaN, leaseTimeout);
      const infVal = resolveHeartbeatInterval(Infinity, leaseTimeout);

      for (const val of [zeroVal, negVal, nanVal, infVal]) {
        assert.ok(Number.isInteger(val), 'Must be an integer');
        assert.ok(val >= 5, 'Must be >= 5ms min bound');
        assert.ok(val < leaseTimeout, 'Must be strictly < lease timeout');
      }
    });

    it('normalizes zero, negative, NaN, Infinity, and fractional lease timeouts safely', () => {
      assert.equal(resolveReplayLockTimeout(0), REPLAY_LOCK_TIMEOUT_MS);
      assert.equal(resolveReplayLockTimeout(-200), REPLAY_LOCK_TIMEOUT_MS);
      assert.equal(resolveReplayLockTimeout(NaN), REPLAY_LOCK_TIMEOUT_MS);
      assert.equal(resolveReplayLockTimeout(Infinity), REPLAY_LOCK_TIMEOUT_MS);
      assert.equal(resolveReplayLockTimeout(85.7), 85, 'Fractional timeout must be floored to integer');
    });

    it('expired lease cannot be renewed when time elapsed exceeds custom timeout', async () => {
      const shortTimeout = 50;
      const lockId = acquireReplayLock(testUser, shortTimeout);
      assert.ok(lockId);

      await new Promise(r => setTimeout(r, 70));

      const renewed = renewReplayLock(testUser, lockId!, shortTimeout);
      assert.equal(renewed, false, 'Expired lease must fail renewal with custom timeout');
    });

    it('lock takeover during an in-flight successful response aborts without mutating queue', async () => {
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });

      let onItemSuccessCalled = false;

      const stealLockFetch = async () => {
        await new Promise(r => setTimeout(r, 15));
        const stealKey = `bushido_replay_lock_${testUser}`;
        storageMock[stealKey] = JSON.stringify({
          lockId: 'foreign_tab_lock',
          timestamp: Date.now() + 60000,
          ownerId: testUser
        });
        await new Promise(r => setTimeout(r, 15));
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: stealLockFetch as any,
        leaseTimeoutMs: 100,
        heartbeatIntervalMs: 10,
        onItemSuccess: () => {
          onItemSuccessCalled = true;
        }
      });

      assert.equal(res.stoppedDueToLockLoss, true);
      assert.equal(onItemSuccessCalled, false, 'onItemSuccess must not be called when lock was stolen');
      assert.equal(res.remainingQueueCount, 1, 'Queue item must remain in queue');
      assert.equal(getOfflineQueue(testUser).length, 1);
    });

    it('lock takeover during an in-flight network exception preserves queue and aborts via lock loss', async () => {
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });

      let onItemFailureCalled = false;

      const stealAndFailFetch = async () => {
        await new Promise(r => setTimeout(r, 15));
        const stealKey = `bushido_replay_lock_${testUser}`;
        storageMock[stealKey] = JSON.stringify({
          lockId: 'foreign_tab_lock',
          timestamp: Date.now() + 60000,
          ownerId: testUser
        });
        await new Promise(r => setTimeout(r, 15));
        throw new Error('Simulated network disconnect');
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: stealAndFailFetch as any,
        leaseTimeoutMs: 100,
        heartbeatIntervalMs: 10,
        onItemFailure: () => {
          onItemFailureCalled = true;
        }
      });

      assert.equal(res.stoppedDueToLockLoss, true, 'Must prioritize lock loss over network error');
      assert.equal(onItemFailureCalled, false, 'onItemFailure must not be called when lock is lost');
      assert.equal(res.remainingQueueCount, 1, 'Queue item must remain safely in queue');
    });
  });

  // ===========================================================================
  // 5. DEEP SANITIZATION & RAW ERROR REDACTION
  // ===========================================================================
  describe('5. Deep Sanitization & Raw Error Redaction', () => {
    it('bounds recursion depth on deeply nested or cyclic payloads', () => {
      const cyclicObj: any = { a: 1, nested: { b: 2 } };
      cyclicObj.nested.loop = cyclicObj;

      const sanitized = sanitizePayloadForQuarantine(cyclicObj);
      assert.ok(sanitized);
      assert.equal(sanitized.a, 1);
      assert.equal(sanitized.nested.b, 2);
      assert.equal(sanitized.nested.loop, '[CIRCULAR]');
    });

    it('redacts tokens, passwords, bearer credentials from raw error messages and payloads', () => {
      const rawError = 'Error: Bearer eyJhbGciOiJIUzI1NiJ9.secret failed with password=SuperSecretPassword123 & token=my_secret_token';
      const sanitized = sanitizeErrorMessage(rawError);

      assert.ok(!sanitized.includes('SuperSecretPassword123'), 'Password must be redacted');
      assert.ok(!sanitized.includes('my_secret_token'), 'Token must be redacted');
      assert.ok(sanitized.includes('[REDACTED]'), 'Redaction placeholder must be present');

      const sensitivePayload = {
        password: 'plain_password',
        authToken: 'secret_token_val',
        authorization: 'Bearer 12345',
        phoneNumber: '09123456789',
        publicNote: 'Warrior Note'
      };

      const sanitizedPayload = sanitizePayloadForQuarantine(sensitivePayload);
      assert.equal(sanitizedPayload.password, '[REDACTED]');
      assert.equal(sanitizedPayload.authToken, '[REDACTED]');
      assert.equal(sanitizedPayload.authorization, '[REDACTED]');
      assert.equal(sanitizedPayload.publicNote, 'Warrior Note');
    });

    it('safely handles corrupted raw queue strings in storage without crashing', () => {
      const scopedKey = getScopedOfflineQueueKey(testUser);
      storageMock[scopedKey] = '{ invalid json :::';

      // getOfflineQueue must return empty array safely
      const queue = getOfflineQueue(testUser);
      assert.deepEqual(queue, []);
    });
  });
});
