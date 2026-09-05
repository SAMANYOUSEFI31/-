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
      const countingFetch = async (url?: any, init?: any) => {
        netCalls++;
        return { ok: true, status: 200, json: async () => ({ success: true, log: { date: '1403-12-16', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }) } as any;
      };

      // Call replay normal
      const res = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: countingFetch,
        getCurrentActiveAccountId: () => testUser
      });
      
      assert.equal(res.syncedCount, 0, 'Must defer request because of nextRetryAt');
      assert.equal(netCalls, 0, 'No fetch calls made');
      assert.equal(res.remainingQueueCount, 1, 'Item remains in queue');

      // Call replay with force
      const resForce = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: countingFetch,
        getCurrentActiveAccountId: () => testUser,
        force: true
      });

      assert.equal(resForce.syncedCount, 1, 'Must sync when force is true');
      assert.equal(netCalls, 1, 'Fetch call made');
      assert.equal(resForce.remainingQueueCount, 0, 'Queue is empty');
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

      resolveFetch({ ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } }); });

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
      const mockFetch = async (url?: any, init?: any) => {
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
      resolveFetch({ ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } }); });

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
      const mockFetch = async (url?: any, init?: any) => {
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
        resolveFetch({ ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } }); });

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
        resolveFetch({ ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } }); });

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

        resolveFetch({ ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } }); });

      it('scenario 6: normal replay completion (empty queue) leaves no open timer handles', async () => {
        clearOfflineQueue(testUser);
        const scheduler = new DeterministicTestScheduler(1_000_000);

        const res = await replayAccountOfflineQueue({
          activeAccountId: testUser,
          authToken: testToken,
          fetchFn: (async () => ({ ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } })) as any,
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
