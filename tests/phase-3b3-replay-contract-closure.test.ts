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
  resolveReplayTiming,
  REPLAY_LOCK_TIMEOUT_MS,
  REPLAY_LOCK_HEARTBEAT_INTERVAL_MS,
  ReplayTimingDependencies
} from '../src/utils/offlineQueueUtils.js';
import { OfflineQueueItem, ReplayFailureClassification } from '../src/types.js';

interface ScheduledInterval {
  id: number;
  callback: () => void;
  intervalMs: number;
  nextExecutionTime: number;
  executionCount: number;
}

/**
 * Deterministic in-memory test scheduler for simulated clock and interval timers.
 * Fully eliminates real elapsed-time sleeping (setTimeout) in tests.
 */
class DeterministicTestScheduler {
  private currentTime: number;
  private nextId: number = 1;
  private intervals = new Map<number, ScheduledInterval>();
  private totalInvocations: number = 0;

  constructor(initialTime: number = 1_000_000) {
    this.currentTime = initialTime;
  }

  now = (): number => {
    return this.currentTime;
  };

  setInterval = (callback: () => void, intervalMs: number): number => {
    const id = this.nextId++;
    this.intervals.set(id, {
      id,
      callback,
      intervalMs,
      nextExecutionTime: this.currentTime + intervalMs,
      executionCount: 0,
    });
    return id;
  };

  clearInterval = (handle: any): void => {
    const id = typeof handle === 'number' ? handle : Number(handle);
    this.intervals.delete(id);
  };

  advanceTime(deltaMs: number): void {
    if (deltaMs <= 0) return;
    const targetTime = this.currentTime + deltaMs;

    while (this.currentTime < targetTime) {
      let earliest: ScheduledInterval | null = null;
      for (const item of this.intervals.values()) {
        if (item.nextExecutionTime <= targetTime) {
          if (!earliest || item.nextExecutionTime < earliest.nextExecutionTime) {
            earliest = item;
          }
        }
      }

      if (!earliest) {
        this.currentTime = targetTime;
        break;
      }

      this.currentTime = earliest.nextExecutionTime;
      earliest.executionCount++;
      this.totalInvocations++;
      earliest.nextExecutionTime = this.currentTime + earliest.intervalMs;
      earliest.callback();
    }
  }

  getActiveIntervalCount(): number {
    return this.intervals.size;
  }

  getTotalInvocations(): number {
    return this.totalInvocations;
  }

  getTimingDependencies(): ReplayTimingDependencies {
    return {
      now: this.now,
      setInterval: this.setInterval,
      clearInterval: this.clearInterval,
    };
  }
}

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
      const scheduler = new DeterministicTestScheduler(1_000_000);
      const lockId = acquireReplayLock(testUser, 10000, scheduler.now);
      assert.ok(lockId);

      const verified = verifyReplayLock(testUser, lockId!, 10000, scheduler.now);
      assert.equal(verified, true, 'Lock must verify as owned');

      scheduler.advanceTime(2000);
      const renewed = renewReplayLock(testUser, lockId!, 10000, scheduler.now);
      assert.equal(renewed, true, 'Lock renewal must succeed');

      // Verify lock with wrong ID fails
      assert.equal(verifyReplayLock(testUser, 'wrong_id', 10000, scheduler.now), false);
      assert.equal(renewReplayLock(testUser, 'wrong_id', 10000, scheduler.now), false);

      releaseReplayLock(testUser, lockId!);
    });

    it('expired lease cannot be renewed by its former holder (exact boundary and past boundary)', () => {
      const scheduler = new DeterministicTestScheduler(1_000_000);
      const leaseTimeout = 10000;
      const lockId = acquireReplayLock(testUser, leaseTimeout, scheduler.now);
      assert.ok(lockId);

      // 1. Advance to just before boundary: 9999ms elapsed -> renewal must SUCCEED
      scheduler.advanceTime(9999);
      assert.equal(scheduler.now(), 1_009_999);
      const renewBeforeBoundary = renewReplayLock(testUser, lockId!, leaseTimeout, scheduler.now);
      assert.equal(renewBeforeBoundary, true, 'Renewal before boundary must succeed');
      // Lock timestamp in storage is now updated to 1_009_999

      // 2. Advance to EXACT boundary: exactly 10,000ms after the last renewal
      scheduler.advanceTime(10000);
      assert.equal(scheduler.now(), 1_019_999); // 1_019_999 - 1_009_999 = 10,000ms (exact boundary)
      const renewAtExactBoundary = renewReplayLock(testUser, lockId!, leaseTimeout, scheduler.now);
      assert.equal(renewAtExactBoundary, false, 'Renewal at exact timeout boundary must fail');

      // 3. Advance past the boundary: 5,000ms further
      scheduler.advanceTime(5000);
      assert.equal(scheduler.now(), 1_024_999);
      const renewPastBoundary = renewReplayLock(testUser, lockId!, leaseTimeout, scheduler.now);
      assert.equal(renewPastBoundary, false, 'Renewal past boundary must fail');

      // 4. Prove the expired holder cannot revive ownership
      assert.equal(verifyReplayLock(testUser, lockId!, leaseTimeout, scheduler.now), false, 'Expired lock must not verify');

      // 5. A new holder can now acquire the lease cleanly
      const newHolderLock = acquireReplayLock(testUser, leaseTimeout, scheduler.now);
      assert.ok(newHolderLock, 'New holder must be able to acquire lease after expiration');
      assert.notEqual(newHolderLock, lockId);

      releaseReplayLock(testUser, newHolderLock!);
    });

    it('stale lock holder cannot renew or release a newly acquired lease', () => {
      const scheduler = new DeterministicTestScheduler(1_000_000);
      const leaseTimeout = 10000;

      // Holder 1 acquires lock
      const lock1 = acquireReplayLock(testUser, leaseTimeout, scheduler.now);
      assert.ok(lock1);

      // Advance time past leaseTimeout so lock1 expires
      scheduler.advanceTime(12000);

      // Holder 2 acquires newly available lease
      const lock2 = acquireReplayLock(testUser, leaseTimeout, scheduler.now);
      assert.ok(lock2);
      assert.notEqual(lock1, lock2);

      // Holder 1 (stale) attempts to renew Holder 2's lease
      const staleRenew = renewReplayLock(testUser, lock1!, leaseTimeout, scheduler.now);
      assert.equal(staleRenew, false, 'Stale holder cannot renew newer lease');

      // Holder 1 (stale) attempts to release Holder 2's lease
      const staleRelease = releaseReplayLock(testUser, lock1!);
      assert.equal(staleRelease, false, 'Stale holder release must fail and not delete newer lease');

      // Prove Holder 2's lease remains intact and valid
      assert.equal(verifyReplayLock(testUser, lock2!, leaseTimeout, scheduler.now), true, 'Newer lease remains valid');

      // Holder 2 releases legitimately
      const validRelease = releaseReplayLock(testUser, lock2!);
      assert.equal(validRelease, true);
    });

    it('in-flight request running longer than original lease timeout keeps lease alive through heartbeat renewal and blocks second tab after original timeout', async () => {
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });

      const scheduler = new DeterministicTestScheduler(1_000_000);
      const effectiveLeaseTimeout = 10000;
      const effectiveHeartbeat = 3000;
      const lockKey = `bushido_replay_lock_${testUser}`;

      let resolveFetch!: (val: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      // 1. Begin replay with mocked fetch that remains unresolved
      const replayPromise = replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (() => fetchPromise) as any,
        leaseTimeoutMs: effectiveLeaseTimeout,
        heartbeatIntervalMs: effectiveHeartbeat,
        timing: scheduler.getTimingDependencies()
      });

      // 2. Record original lease timestamp
      assert.ok(storageMock[lockKey], 'Lease must be stored');
      const initialParsed = JSON.parse(storageMock[lockKey]);
      const initialTimestamp = initialParsed.timestamp;
      assert.equal(initialTimestamp, 1_000_000);
      assert.equal(scheduler.getActiveIntervalCount(), 1, 'Heartbeat interval must be active');

      // 3. Advance fake time through one or more heartbeat boundaries (at 3000ms)
      scheduler.advanceTime(4000);
      const afterHb1 = JSON.parse(storageMock[lockKey]);
      assert.equal(afterHb1.timestamp, 1_003_000, 'Heartbeat must have updated lease timestamp at 3000ms');

      // 4. Advance fake time beyond the original effective lease timeout (original boundary was 1_010_000)
      // Advancing 8000ms brings currentTime to 1_012_000 > 1_010_000.
      // Heartbeats fire at 6000ms (1_006_000), 9000ms (1_009_000), and 12000ms (1_012_000).
      scheduler.advanceTime(8000);
      assert.equal(scheduler.now(), 1_012_000);
      const afterHb2 = JSON.parse(storageMock[lockKey]);
      assert.equal(afterHb2.timestamp, 1_012_000);

      // 5. Attempt lease acquisition from a simulated second holder using same clock & lease timeout
      const secondHolderAttempt = acquireReplayLock(testUser, effectiveLeaseTimeout, scheduler.now);
      // 6. Prove the second holder cannot acquire the lease because heartbeat renewed it
      assert.equal(secondHolderAttempt, null, 'Second holder must not acquire lease because heartbeat kept it active');

      // 7. Resolve the mocked fetch successfully
      resolveFetch({ ok: true, status: 200, json: async () => ({}) });

      // 8. Prove the original replay completes successfully
      const res = await replayPromise;
      assert.equal(res.syncedCount, 1, 'Original replay must complete successfully');
      assert.equal(res.remainingQueueCount, 0, 'Item must be synced and removed');
      assert.equal(scheduler.getActiveIntervalCount(), 0, 'Heartbeat timer must be cleared');
    });

    it('second simulated tab cannot acquire account lease while in-flight heartbeat is active', async () => {
      clearOfflineQueue(testUser);
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });

      const scheduler = new DeterministicTestScheduler(1_000_000);
      let tab2AcquisitionAttempt: string | null = 'not_attempted';
      let resolveFetch!: (val: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      const replayPromise = replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: (() => {
          // Simulate Tab 2 attempting to acquire lease during Tab 1 in-flight fetch
          tab2AcquisitionAttempt = acquireReplayLock(testUser, 10000, scheduler.now);
          return fetchPromise;
        }) as any,
        leaseTimeoutMs: 10000,
        heartbeatIntervalMs: 3000,
        timing: scheduler.getTimingDependencies()
      });

      assert.equal(tab2AcquisitionAttempt, null, 'Second tab must not acquire lease while first tab holds it');

      resolveFetch({ ok: true, status: 200, json: async () => ({}) });
      const res = await replayPromise;
      assert.equal(res.syncedCount, 1);
      assert.equal(scheduler.getActiveIntervalCount(), 0);
    });

    it('in-flight successful-response takeover safety: suppresses queue removal, onItemSuccess, and stops replay', async () => {
      clearOfflineQueue(testUser);
      // Enqueue two items to prove replay does NOT continue to a second queued item
      const item1 = enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });
      const item2 = enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-02', workout: false }
      });

      const scheduler = new DeterministicTestScheduler(1_000_000);
      let onItemSuccessCount = 0;
      let resolveFetch!: (val: any) => void;
      const fetchPromise = new Promise((resolve) => {
        resolveFetch = resolve;
      });

      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return fetchPromise;
      };

      const replayPromise = replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: mockFetch as any,
        leaseTimeoutMs: 10000,
        heartbeatIntervalMs: 3000,
        timing: scheduler.getTimingDependencies(),
        onItemSuccess: () => {
          onItemSuccessCount++;
        }
      });

      // 1. Replay has started, fetch is in flight
      assert.equal(fetchCount, 1);
      assert.equal(scheduler.getActiveIntervalCount(), 1);

      // 2. Replace the stored lease with a valid newer foreign lease
      const lockKey = `bushido_replay_lock_${testUser}`;
      storageMock[lockKey] = JSON.stringify({
        lockId: 'lease_foreign_tab_takeover_999',
        timestamp: scheduler.now() + 50000
      });

      // 3. Trigger or advance scheduled heartbeat deterministically
      scheduler.advanceTime(3000);

      // 4. Resolve the original fetch as a successful HTTP response
      resolveFetch({ ok: true, status: 200, json: async () => ({}) });

      // 5. Await replay result
      const res = await replayPromise;

      // 6. Assertions
      assert.equal(res.stoppedDueToLockLoss, true, 'stoppedDueToLockLoss must be true');
      assert.equal(res.syncedCount, 0, 'syncedCount must remain 0');
      assert.equal(onItemSuccessCount, 0, 'onItemSuccess must not be called');
      assert.equal(fetchCount, 1, 'Replay must not continue to the second queued item');

      const remainingQueue = getOfflineQueue(testUser);
      assert.equal(remainingQueue.length, 2, 'Both queue items must remain in queue');
      assert.equal(remainingQueue[0].id, item1.id);
      assert.equal(remainingQueue[1].id, item2.id);
      assert.equal(scheduler.getActiveIntervalCount(), 0, 'Heartbeat timer must be cleaned up');
    });

    it('in-flight network-exception takeover safety: lock loss takes precedence over network error processing', async () => {
      clearOfflineQueue(testUser);
      const item1 = enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-01', workout: true }
      });
      const item2 = enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: { date: '1403-12-02', workout: false }
      });

      const scheduler = new DeterministicTestScheduler(1_000_000);
      let onItemSuccessCalled = false;
      let onItemFailureCalled = false;
      let rejectFetch!: (err: any) => void;
      const fetchPromise = new Promise((_, reject) => {
        rejectFetch = reject;
      });

      let fetchCount = 0;
      const mockFetch = async () => {
        fetchCount++;
        return fetchPromise;
      };

      const replayPromise = replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: mockFetch as any,
        leaseTimeoutMs: 10000,
        heartbeatIntervalMs: 3000,
        timing: scheduler.getTimingDependencies(),
        onItemSuccess: () => {
          onItemSuccessCalled = true;
        },
        onItemFailure: () => {
          onItemFailureCalled = true;
        }
      });

      assert.equal(fetchCount, 1);

      // 1. Replace the stored lease with a newer foreign lease
      const lockKey = `bushido_replay_lock_${testUser}`;
      storageMock[lockKey] = JSON.stringify({
        lockId: 'lease_foreign_takeover_network_test',
        timestamp: scheduler.now() + 50000
      });

      // 2. Advance heartbeat processing
      scheduler.advanceTime(3000);

      // 3. Reject the mocked fetch with a network exception
      rejectFetch(new Error('Simulated socket hangup during flight'));

      // 4. Await replay result
      const res = await replayPromise;

      // 5. Assertions
      assert.equal(res.stoppedDueToLockLoss, true, 'Lock loss must take precedence over network error');
      assert.equal(res.syncedCount, 0);
      assert.equal(onItemSuccessCalled, false, 'onItemSuccess must not be called');
      assert.equal(onItemFailureCalled, false, 'onItemFailure must not be emitted by stale holder');
      assert.equal(fetchCount, 1, 'Execution must not continue to next queue item');

      const remainingQueue = getOfflineQueue(testUser);
      assert.equal(remainingQueue.length, 2, 'Queue items must remain');
      assert.equal(remainingQueue[0].retryCount ?? 0, 0, 'retryCount must not be modified by stale holder');
      assert.equal(remainingQueue[0].nextRetryAt, undefined, 'nextRetryAt must not be modified by stale holder');
      assert.equal(scheduler.getActiveIntervalCount(), 0, 'Heartbeat interval must be cleaned up');
    });

    // --- Deterministic Timer Cleanup Across All 6 Terminal Paths ---
    describe('Deterministically proves timer cleanup across all terminal paths', () => {
      it('scenario 1: successful HTTP response cleans up timer handle and runs no post-settlement callbacks', async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const scheduler = new DeterministicTestScheduler(1_000_000);
        let resolveFetch!: (val: any) => void;
        const fetchPromise = new Promise(r => { resolveFetch = r; });

        const replayPromise = replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (() => fetchPromise) as any,
          timing: scheduler.getTimingDependencies()
        });

        // Advance 3500ms so heartbeat executes at least once
        scheduler.advanceTime(3500);
        assert.equal(scheduler.getActiveIntervalCount(), 1);
        const invocationsDuringFlight = scheduler.getTotalInvocations();
        assert.ok(invocationsDuringFlight >= 1);

        // Resolve fetch successfully
        resolveFetch({ ok: true, status: 200, json: async () => ({}) });
        const res = await replayPromise;
        assert.equal(res.syncedCount, 1);

        // Assert timer cleanup
        assert.equal(scheduler.getActiveIntervalCount(), 0, 'Active interval count must be 0 after settlement');
        const invocationsAtSettlement = scheduler.getTotalInvocations();

        // Advance fake time again by 20,000ms
        scheduler.advanceTime(20000);
        assert.equal(scheduler.getTotalInvocations(), invocationsAtSettlement, 'No heartbeat callback must run after settlement');
        assert.equal(scheduler.getActiveIntervalCount(), 0, 'No active interval remains');
      });

      it('scenario 2: retryable HTTP failure (500) cleans up timer handle and runs no post-settlement callbacks', async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const scheduler = new DeterministicTestScheduler(1_000_000);
        let resolveFetch!: (val: any) => void;
        const fetchPromise = new Promise(r => { resolveFetch = r; });

        const replayPromise = replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (() => fetchPromise) as any,
          timing: scheduler.getTimingDependencies()
        });

        scheduler.advanceTime(3500);
        assert.equal(scheduler.getActiveIntervalCount(), 1);

        // Resolve with 500 error
        resolveFetch({ ok: false, status: 500, statusText: 'Internal Server Error' });
        const res = await replayPromise;
        assert.equal(res.failedCount, 1);

        assert.equal(scheduler.getActiveIntervalCount(), 0, 'Active interval count must be 0 after settlement');
        const invocationsAtSettlement = scheduler.getTotalInvocations();

        scheduler.advanceTime(20000);
        assert.equal(scheduler.getTotalInvocations(), invocationsAtSettlement, 'No heartbeat callback must run after settlement');
        assert.equal(scheduler.getActiveIntervalCount(), 0, 'No active interval remains');
      });

      it('scenario 3: network exception cleans up timer handle and runs no post-settlement callbacks', async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const scheduler = new DeterministicTestScheduler(1_000_000);
        let rejectFetch!: (err: any) => void;
        const fetchPromise = new Promise((_, rej) => { rejectFetch = rej; });

        const replayPromise = replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (() => fetchPromise) as any,
          timing: scheduler.getTimingDependencies()
        });

        scheduler.advanceTime(3500);
        assert.equal(scheduler.getActiveIntervalCount(), 1);

        rejectFetch(new Error('Network failure: socket closed'));
        const res = await replayPromise;
        assert.equal(res.failedCount, 1);

        assert.equal(scheduler.getActiveIntervalCount(), 0, 'Active interval count must be 0 after settlement');
        const invocationsAtSettlement = scheduler.getTotalInvocations();

        scheduler.advanceTime(20000);
        assert.equal(scheduler.getTotalInvocations(), invocationsAtSettlement, 'No heartbeat callback must run after settlement');
        assert.equal(scheduler.getActiveIntervalCount(), 0, 'No active interval remains');
      });

      it('scenario 4: account change after in-flight request cleans up timer handle and runs no post-settlement callbacks', async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        let currentActiveUser = testUser;
        const scheduler = new DeterministicTestScheduler(1_000_000);
        let resolveFetch!: (val: any) => void;
        const fetchPromise = new Promise(r => { resolveFetch = r; });

        const replayPromise = replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          getCurrentActiveAccountId: () => currentActiveUser,
          fetchFn: (() => fetchPromise) as any,
          timing: scheduler.getTimingDependencies()
        });

        scheduler.advanceTime(3500);
        assert.equal(scheduler.getActiveIntervalCount(), 1);

        // Account changes during flight
        currentActiveUser = 'usr_another_account';
        resolveFetch({ ok: true, status: 200, json: async () => ({}) });

        const res = await replayPromise;
        assert.equal(res.stoppedDueToAccountChange, true);

        assert.equal(scheduler.getActiveIntervalCount(), 0, 'Active interval count must be 0 after settlement');
        const invocationsAtSettlement = scheduler.getTotalInvocations();

        scheduler.advanceTime(20000);
        assert.equal(scheduler.getTotalInvocations(), invocationsAtSettlement, 'No heartbeat callback must run after settlement');
        assert.equal(scheduler.getActiveIntervalCount(), 0, 'No active interval remains');
      });

      it('scenario 5: lock loss cleans up timer handle and runs no post-settlement callbacks', async () => {
        clearOfflineQueue(testUser);
        enqueueOfflineMutation(testUser, {
          type: 'UPDATE_LOG',
          payload: { date: '1403-12-01', workout: true }
        });

        const scheduler = new DeterministicTestScheduler(1_000_000);
        let resolveFetch!: (val: any) => void;
        const fetchPromise = new Promise(r => { resolveFetch = r; });

        const replayPromise = replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (() => fetchPromise) as any,
          timing: scheduler.getTimingDependencies()
        });

        assert.equal(scheduler.getActiveIntervalCount(), 1);

        // Foreign tab takes over the lock in storage
        const lockKey = `bushido_replay_lock_${testUser}`;
        storageMock[lockKey] = JSON.stringify({
          lockId: 'lease_takeover_cleanup_test',
          timestamp: scheduler.now() + 50000
        });

        // Advance fake time: heartbeat fires, renewReplayLock detects lockId mismatch and clears the heartbeatTimer!
        scheduler.advanceTime(3000);

        resolveFetch({ ok: true, status: 200, json: async () => ({}) });
        const res = await replayPromise;
        assert.equal(res.stoppedDueToLockLoss, true);

        assert.equal(scheduler.getActiveIntervalCount(), 0, 'Active interval count must be 0 after settlement');
        const invocationsAtSettlement = scheduler.getTotalInvocations();

        scheduler.advanceTime(20000);
        assert.equal(scheduler.getTotalInvocations(), invocationsAtSettlement, 'No heartbeat callback must run after settlement');
        assert.equal(scheduler.getActiveIntervalCount(), 0, 'No active interval remains');
      });

      it('scenario 6: normal replay completion (empty queue) leaves no open timer handles', async () => {
        clearOfflineQueue(testUser);
        const scheduler = new DeterministicTestScheduler(1_000_000);

        const res = await replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (async () => ({ ok: true, status: 200, json: async () => ({}) })) as any,
          timing: scheduler.getTimingDependencies()
        });

        assert.equal(res.syncedCount, 0);
        assert.equal(res.remainingQueueCount, 0);

        assert.equal(scheduler.getActiveIntervalCount(), 0, 'Active interval count must be 0 for empty queue completion');
        const invocationsAtSettlement = scheduler.getTotalInvocations();

        scheduler.advanceTime(20000);
        assert.equal(scheduler.getTotalInvocations(), invocationsAtSettlement, 'No heartbeat callback must run after settlement');
        assert.equal(scheduler.getActiveIntervalCount(), 0, 'No active interval remains');
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
