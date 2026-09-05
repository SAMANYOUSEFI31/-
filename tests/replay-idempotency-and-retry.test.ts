import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  getScopedOfflineQueueKey,
  getOfflineQueue,
  saveOfflineQueue,
  clearOfflineQueue,
  enqueueOfflineMutation,
  removeReplayedQueueItems,
  recordQueueItemFailure,
  replayAccountOfflineQueue,
  migrateLegacyGlobalQueue,
  quarantineQueueItems,
  getQuarantinedItems,
  clearQuarantine,
  getScopedQuarantineKey,
  acquireReplayLock,
  releaseReplayLock,
  clearAllReplayLocks,
  MAX_REPLAY_RETRIES,
  REPLAY_LOCK_PREFIX
} from '../src/utils/offlineQueueUtils.js';
import { OfflineQueueItem } from '../src/types.js';
import { app } from '../server.js';
import { generateToken } from '../server/auth.js';
import {
  memoryStore,
  setPrismaState,
  getUserCycles,
  getCycleById,
  getUserDailyLogs,
  getDailyLogByDate,
  findUserById,
  createCycle,
  upsertDailyLog
} from '../server/db/index.js';

describe('Phase 3B.2: Replay Idempotency & Retry Safety Suite', () => {
  const storageMock: Record<string, string> = {};
  const ambUser = 'usr_ambiguous_tester';
  const ambToken = generateToken({
    userId: ambUser,
    phoneNumber: '09129998877',
    isVip: true,
    tier: 'VIP'
  });

  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      (server as any).closeAllConnections?.();
      server.unref?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(() => {
    // Clear storage mock
    for (const k in storageMock) delete storageMock[k];
    clearAllReplayLocks();

    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    if (!memoryStore.users.some(u => u.id === ambUser)) {
      memoryStore.users.push({
        id: ambUser,
        phoneNumber: '09129998877',
        email: 'ambiguous@bushido.local',
        name: 'Ambiguous Master',
        passwordHash: 'hashed_pwd',
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: false,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
    }

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
  // 1. INTERRUPTED REPLAY RESUMPTION & CONFIRMED ITEM IMMUNITY
  // ===========================================================================
  describe('1. Interrupted Replay Resumption', () => {
    it('does not re-execute confirmed mutations when replay is interrupted midway', async () => {
      const user = 'usr_resumption_01';
      const token = 'tok_resumption_01';

      // Enqueue 3 mutations
      const item1 = enqueueOfflineMutation(user, {
        type: 'CREATE_CYCLE',
        payload: { id: 'cyc_01', title: 'Cycle 1' }
      });
      const item2 = enqueueOfflineMutation(user, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cyc_01', date: '1403-12-01', workout: true }
      });
      const item3 = enqueueOfflineMutation(user, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Warrior Alpha' }
      });

      const callLog: string[] = [];

      // First run: item 1 succeeds, but then network fails on item 2
      const fetchRun1 = async (url: string, opts: any) => {
        callLog.push(`run1:${url}`);
        if (url === '/api/cycles') {
          return { ok: true, status: 200, json: async () => ({ id: 'cyc_01' }) };
        }
        if (url === '/api/logs') {
          throw new Error('Network timeout during item 2');
        }
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const res1 = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: fetchRun1 as any
      });

      assert.equal(res1.syncedCount, 1, 'First run should have synced item 1');
      assert.equal(res1.failedCount, 1, 'First run should fail on item 2');

      // Verify item 1 is removed from queue, item 2 and 3 remain
      const remainingAfterRun1 = getOfflineQueue(user);
      assert.equal(remainingAfterRun1.length, 2, 'Item 1 must be pruned from queue');
      assert.equal(remainingAfterRun1[0].id, item2.id, 'Next item in queue must be item 2');
      assert.equal(remainingAfterRun1[1].id, item3.id, 'Next item in queue must be item 3');

      // Second run: replay resumes. Item 1 MUST NOT be replayed!
      const fetchRun2 = async (url: string, opts: any) => {
        callLog.push(`run2:${url}`);
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const res2 = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        force: true,
        fetchFn: fetchRun2 as any
      });

      assert.equal(res2.syncedCount, 2, 'Second run should sync remaining 2 items');
      assert.equal(res2.remainingQueueCount, 0, 'Queue must be empty after full completion');

      // Verify call log: item 1 (/api/cycles) was called exactly once across both runs
      const cycleCalls = callLog.filter(c => c.includes('/api/cycles'));
      assert.equal(cycleCalls.length, 1, 'Confirmed item 1 must never be re-executed');
    });
  });

  // ===========================================================================
  // 2. RAPID ONLINE / OFFLINE FLAPPING & INTRA-TAB SERIALIZATION
  // ===========================================================================
  describe('2. Concurrent Trigger & Lock Serialization', () => {
    it('serializes concurrent replay calls so identical requests are not executed twice', async () => {
      const user = 'usr_flapping_02';
      const token = 'tok_flapping_02';

      enqueueOfflineMutation(user, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cyc_flap', date: '1403-12-05', study: true }
      });

      let netCalls = 0;
      const delayedFetch = async (url: string, opts: any) => {
        netCalls++;
        await new Promise(r => setTimeout(r, 25));
        return { ok: true, status: 200, json: async () => ({}) };
      };

      // Trigger two concurrent replays simultaneously (simulating rapid flapping / double event)
      const [resA, resB] = await Promise.all([
        replayAccountOfflineQueue({
          activeAccountId: user,
          authToken: token,
          fetchFn: delayedFetch as any
        }),
        replayAccountOfflineQueue({
          activeAccountId: user,
          authToken: token,
          fetchFn: delayedFetch as any
        })
      ]);

      assert.equal(netCalls, 1, 'Network call must only happen once for the queued item');
      const totalSynced = resA.syncedCount + resB.syncedCount;
      assert.equal(totalSynced, 1, 'Exactly one replay promise should count the synced item');
      assert.equal(getOfflineQueue(user).length, 0, 'Queue must be cleanly emptied');
    });

    it('ephemeral storage lock blocks overlapping tab execution while lock is fresh', async () => {
      const user = 'usr_cross_tab';
      // Simulate another tab acquiring active lock lease
      const acquired = acquireReplayLock(user);
      assert.ok(acquired, 'First lock acquisition should succeed and return lease string');
      assert.equal(typeof acquired, 'string');

      const secondAcquire = acquireReplayLock(user);
      assert.equal(secondAcquire, null, 'Second lock attempt while held must fail and return null');

      // Attempting to release with wrong lockId must fail and NOT delete active lock
      const staleRelease = releaseReplayLock(user, 'stale_expired_lock_id');
      assert.equal(staleRelease, false, 'Expired previous holder cannot release a newer holder lease');

      const stillHeld = acquireReplayLock(user);
      assert.equal(stillHeld, null, 'Lock must still be held after invalid release attempt');

      const correctRelease = releaseReplayLock(user, acquired!);
      assert.equal(correctRelease, true, 'Matching lockId release must succeed');

      const thirdAcquire = acquireReplayLock(user);
      assert.ok(thirdAcquire, 'Lock should be acquirable after legitimate release');
      releaseReplayLock(user, thirdAcquire!);
    });
  });

  // ===========================================================================
  // 3. CYCLE CREATION IDEMPOTENCY & COMPACTION
  // ===========================================================================
  describe('3. Cycle Creation Idempotency', () => {
    it('compacts duplicate offline CREATE_CYCLE mutations in place', () => {
      const user = 'usr_cycle_dedup';
      const cycleId = 'cyc_unique_101';

      const item1 = enqueueOfflineMutation(user, {
        type: 'CREATE_CYCLE',
        payload: { id: cycleId, title: 'Initial Offline Title' }
      });

      const queue1 = getOfflineQueue(user);
      assert.equal(queue1.length, 1);
      assert.equal(queue1[0].payload.title, 'Initial Offline Title');

      // Enqueue again with updated title before replaying
      const item2 = enqueueOfflineMutation(user, {
        type: 'CREATE_CYCLE',
        payload: { id: cycleId, title: 'Refined Offline Title', targetTheme: 'Iron Will' }
      });

      const queue2 = getOfflineQueue(user);
      assert.equal(queue2.length, 1, 'Queue must not contain duplicate CREATE_CYCLE entries');
      assert.equal(queue2[0].id, item1.id, 'Stable item id must be preserved');
      assert.equal(queue2[0].payload.title, 'Refined Offline Title');
      assert.equal(queue2[0].payload.targetTheme, 'Iron Will');
    });

    it('sends stable clientOperationId and id during CREATE_CYCLE replay', async () => {
      const user = 'usr_cycle_replay_idempotent';
      const token = 'tok_cycle_replay';
      const cycleId = 'cyc_stable_id';

      const item = enqueueOfflineMutation(user, {
        type: 'CREATE_CYCLE',
        payload: { id: cycleId, title: 'Stable Cycle' }
      });

      let receivedBody: any = null;
      const captureFetch = async (url: string, opts: any) => {
        receivedBody = JSON.parse(opts.body);
        return { ok: true, status: 201, json: async () => ({ id: cycleId }) };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: captureFetch as any
      });

      assert.equal(res.syncedCount, 1);
      assert.ok(receivedBody);
      assert.equal(receivedBody.id, cycleId);
      assert.equal(receivedBody.clientOperationId, item.id);
    });
  });

  // ===========================================================================
  // 4. DAILY LOG UPSERT IDEMPOTENCY & CLIENT OPERATION ID
  // ===========================================================================
  describe('4. Daily Log Upsert Idempotency', () => {
    it('compacts multiple UPDATE_LOG items for the same cycle and date', () => {
      const user = 'usr_log_compact';
      const cycleId = 'cyc_compaction';
      const date = '1403-12-10';

      enqueueOfflineMutation(user, {
        type: 'UPDATE_LOG',
        payload: { cycleId, date, workout: true, study: false }
      });

      assert.equal(getOfflineQueue(user).length, 1);

      enqueueOfflineMutation(user, {
        type: 'UPDATE_LOG',
        payload: { cycleId, date, workout: true, study: true, wakeUp: true }
      });

      const queue = getOfflineQueue(user);
      assert.equal(queue.length, 1, 'Must compact to single log item');
      assert.equal(queue[0].payload.workout, true);
      assert.equal(queue[0].payload.study, true);
      assert.equal(queue[0].payload.wakeUp, true);
    });

    it('attaches stable clientOperationId during UPDATE_LOG replay', async () => {
      const user = 'usr_log_replay';
      const token = 'tok_log_replay';

      const item = enqueueOfflineMutation(user, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cyc_log', date: '1403-12-11', journal: true }
      });

      let sentBody: any = null;
      const verifyFetch = async (url: string, opts: any) => {
        if (url === '/api/logs') {
          sentBody = JSON.parse(opts.body);
          return { ok: true, status: 200, json: async () => ({}) };
        }
        return { ok: false, status: 404 };
      };

      await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: verifyFetch as any
      });

      assert.ok(sentBody);
      assert.equal(sentBody.clientOperationId, item.id);
      assert.equal(sentBody.journal, true);
    });
  });

  // ===========================================================================
  // 5. RETRY LOGIC, POISON-PILL QUARANTINE & PRESERVATION
  // ===========================================================================
  describe('5. Retry Limits and Poison-Pill Quarantine', () => {
    it('quarantines permanent 400 Bad Request client errors immediately without retrying indefinitely', async () => {
      const user = 'usr_poison_pill';
      const token = 'tok_poison_pill';

      const badItem = enqueueOfflineMutation(user, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'A'.repeat(500) } // Exceeds 80 chars
      });

      const fetchReject = async (url: string, opts: any) => {
        return { ok: false, status: 400, statusText: 'Bad Request' };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: fetchReject as any
      });

      assert.equal(res.failedCount, 1);
      assert.equal(res.remainingQueueCount, 0, 'Poison pill must be removed from active queue');

      const quarantined = getQuarantinedItems(user);
      assert.equal(quarantined.length, 1, 'Bad request item must be quarantined in user partition');
      assert.equal(quarantined[0].items[0].id, badItem.id);
    });

    it('preserves valid mutations in active queue across repeated 500 / retryable errors without quarantining', async () => {
      const user = 'usr_max_retry_preserve';
      const token = 'tok_max_retry_preserve';

      const item = enqueueOfflineMutation(user, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Valid Persistent Name' }
      });

      const fetch500 = async () => ({ ok: false, status: 500, statusText: 'Internal Server Error' });

      // Run replay multiple times (even exceeding legacy 5-attempt limit)
      for (let i = 0; i < 7; i++) {
        const res = await replayAccountOfflineQueue({
          activeAccountId: user,
          authToken: token,
          force: true,
          fetchFn: fetch500 as any
        });
        assert.equal(res.failedCount, 1);
        assert.equal(res.syncedCount, 0);
      }

      // Valid mutation MUST remain in the active queue with retryCount and nextRetryAt metadata
      const activeQueue = getOfflineQueue(user);
      assert.equal(activeQueue.length, 1, 'Active queue must preserve valid mutations during server outages');
      assert.equal(activeQueue[0].id, item.id);
      assert.equal(activeQueue[0].retryCount, 7, 'Retry count must accurately track failure attempts');
      assert.ok(activeQueue[0].nextRetryAt && activeQueue[0].nextRetryAt > Date.now(), 'Exponential backoff timestamp must be set');
      assert.ok(activeQueue[0].lastError?.includes('500'), 'Last error message must be recorded');

      // Quarantine MUST remain completely empty
      const quarantined = getQuarantinedItems(user);
      assert.equal(quarantined.length, 0, 'Retryable 500 errors must never be quarantined or lost');
    });

    it('preserves mutations on 502, 503, 504, 408, 429 and network exceptions without loss', async () => {
      const user = 'usr_retryable_codes';
      const token = 'tok_retryable_codes';

      const statusCodes = [502, 503, 504, 408, 429];
      for (const code of statusCodes) {
        clearOfflineQueue(user);
        clearQuarantine(user);

        enqueueOfflineMutation(user, {
          type: 'UPDATE_PROFILE',
          payload: { name: `Name for ${code}` }
        });

        await replayAccountOfflineQueue({
          activeAccountId: user,
          authToken: token,
          fetchFn: (async () => ({ ok: false, status: code })) as any
        });

        assert.equal(getOfflineQueue(user).length, 1, `Mutation must be preserved on HTTP ${code}`);
        assert.equal(getQuarantinedItems(user).length, 0, `HTTP ${code} must not quarantine valid mutations`);
      }

      // Network Exception
      clearOfflineQueue(user);
      enqueueOfflineMutation(user, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Network Error Test' }
      });

      await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: (async () => { throw new Error('Fetch failed / connection reset'); }) as any
      });

      assert.equal(getOfflineQueue(user).length, 1, 'Mutation must be preserved on network exception');
      assert.equal(getQuarantinedItems(user).length, 0, 'Network exception must not quarantine');
    });

    it('respects backoff deferral when respectBackoff option is enabled', async () => {
      const user = 'usr_backoff_deferral';
      const token = 'tok_backoff_deferral';

      enqueueOfflineMutation(user, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Backoff Name' }
      });

      // Fail once on 503 to establish backoff timestamp in future
      await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: (async () => ({ ok: false, status: 503 })) as any
      });

      let netCalls = 0;
      const countingFetch = async () => {
        netCalls++;
        return { ok: true, status: 200, json: async () => ({}) };
      };

      // Second replay with respectBackoff: true must defer because backoff window is still active
      const resDeferred = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        respectBackoff: true,
        fetchFn: countingFetch as any
      });

      assert.equal(netCalls, 0, 'Should not issue network call while backoff is active');
      assert.equal(resDeferred.syncedCount, 0);
      assert.equal(getOfflineQueue(user).length, 1);

      // Force replay bypasses backoff when user or system requests immediate sync
      const resForced = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        force: true,
        fetchFn: countingFetch as any
      });

      assert.equal(netCalls, 1, 'Forced sync must execute immediately');
      assert.equal(resForced.syncedCount, 1);
      assert.equal(getOfflineQueue(user).length, 0);
    });

    it('quarantines corrupted UPDATE_CYCLE payload missing cycle id without throwing unhandled exceptions', async () => {
      const user = 'usr_corrupt_cycle';
      const token = 'tok_corrupt_cycle';

      enqueueOfflineMutation(user, {
        type: 'UPDATE_CYCLE',
        payload: { title: 'Missing Id' }
      });

      let netCalled = false;
      const fetchStub = async () => {
        netCalled = true;
        return { ok: true, status: 200 };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: fetchStub as any
      });

      assert.equal(netCalled, false, 'Should not issue network request for malformed payload');
      assert.equal(res.failedCount, 1);
      assert.equal(getOfflineQueue(user).length, 0);
      assert.equal(getQuarantinedItems(user).length, 1);
    });
  });

  // ===========================================================================
  // 6. DELETE_CYCLE IDEMPOTENCY & 404 RESILIENCY
  // ===========================================================================
  describe('6. DELETE_CYCLE Resiliency', () => {
    it('treats 404 Not Found on DELETE_CYCLE as confirmed success (already deleted)', async () => {
      const user = 'usr_del_404';
      const token = 'tok_del_404';
      const cycleId = 'cyc_already_gone';

      enqueueOfflineMutation(user, {
        type: 'DELETE_CYCLE',
        payload: { id: cycleId }
      });

      const fetch404 = async (url: string, opts: any) => {
        assert.equal(opts.method, 'DELETE');
        return { ok: false, status: 404 };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: user,
        authToken: token,
        fetchFn: fetch404 as any
      });

      assert.equal(res.syncedCount, 1, '404 on DELETE must be considered successfully resolved');
      assert.equal(res.failedCount, 0);
      assert.equal(getOfflineQueue(user).length, 0);
    });
  });

  // ===========================================================================
  // 7. ACCOUNT BOUNDARIES & GUEST IMMUNITY DURING REPLAY
  // ===========================================================================
  describe('7. Account Boundaries During Replay', () => {
    it('aborts replay immediately if account switch is detected between items', async () => {
      const userA = 'usr_switch_a';
      const userB = 'usr_switch_b';
      const token = 'tok_switch_a';

      enqueueOfflineMutation(userA, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'User A First' }
      });
      enqueueOfflineMutation(userA, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'User A Second' }
      });

      let currentActive = userA;
      let netCount = 0;

      const fetchWithSwitch = async (url: string, opts: any) => {
        netCount++;
        // Switch account to User B while first item finishes
        currentActive = userB;
        return { ok: true, status: 200, json: async () => ({}) };
      };

      const res = await replayAccountOfflineQueue({
        activeAccountId: userA,
        authToken: token,
        fetchFn: fetchWithSwitch as any,
        getCurrentActiveAccountId: () => currentActive
      });

      assert.equal(res.stoppedDueToAccountChange, true, 'Must flag stopped due to account switch');
      assert.equal(netCount, 1, 'Must not process second mutation after account switch');
    });

    it('guest mutations are never sent to server during replay', async () => {
      let netCalled = false;
      const fetchSpy = async () => {
        netCalled = true;
        return { ok: true, status: 200 };
      };

      enqueueOfflineMutation('guest', {
        type: 'CREATE_CYCLE',
        payload: { id: 'guest_cyc', title: 'Guest Cycle' }
      });

      const res = await replayAccountOfflineQueue({
        activeAccountId: 'guest',
        authToken: 'any_token',
        fetchFn: fetchSpy as any
      });

      assert.equal(netCalled, false, 'Server must never be called for guest queue');
      assert.equal(res.syncedCount, 0);
      assert.equal(res.remainingQueueCount, 1, 'Guest mutations remain safely in local guest partition');
    });
  });

  // ===========================================================================
  // 8. LEGACY MIGRATION IDEMPOTENCY
  // ===========================================================================
  describe('8. Legacy Migration Idempotency', () => {
    it('does not duplicate items when migrateLegacyGlobalQueue is invoked repeatedly', () => {
      const ownerId = 'usr_mig_idempotent';

      const legacyQueue = [
        {
          id: 'item_mig_1',
          ownerId,
          type: 'UPDATE_LOG',
          payload: { cycleId: 'cyc_mig', date: '1403-12-12', workout: true },
          dedupKey: 'UPDATE_LOG:cyc_mig:1403-12-12'
        }
      ];

      // Seed legacy storage
      storageMock['bushido_offline_queue'] = JSON.stringify(legacyQueue);

      const run1 = migrateLegacyGlobalQueue();
      assert.equal(run1.migratedCount, 1);

      const queueAfterRun1 = getOfflineQueue(ownerId);
      assert.equal(queueAfterRun1.length, 1);

      // Re-seed legacy storage with the same item
      storageMock['bushido_offline_queue'] = JSON.stringify(legacyQueue);

      const run2 = migrateLegacyGlobalQueue();
      assert.equal(run2.migratedCount, 0, 'Second run must skip already migrated item');

      const queueAfterRun2 = getOfflineQueue(ownerId);
      assert.equal(queueAfterRun2.length, 1, 'Queue must not duplicate the item');
    });
  });

  // ===========================================================================
  // 9. AMBIGUOUS SUCCESS & LIVE SERVER REPLAY DEDUPLICATION
  // ===========================================================================
  describe('9. Ambiguous Success & Live Server Deduplication', () => {
    it('CREATE_CYCLE: server success -> client dropped connection -> queue retry -> exactly 1 cycle with no duplicates', async () => {
      const cycleId = 'cyc_amb_create_01';
      clearOfflineQueue(ambUser);

      const item = enqueueOfflineMutation(ambUser, {
        type: 'CREATE_CYCLE',
        payload: {
          id: cycleId,
          title: 'Ambiguous Cycle',
          startDate: '1403-12-01',
          endDate: '1403-12-25',
          targetTheme: 'Bushido Iron'
        }
      });

      // Attempt 1: Call live HTTP server, but simulate client dropped connection before parsing response
      let serverHitCount = 0;
      const dropAfterServerFetch = async (endpoint: string, opts: any) => {
        serverHitCount++;
        const realRes = await fetch(`${baseUrl}${endpoint}`, opts);
        assert.ok(realRes.status === 200 || realRes.status === 201);
        // Simulate client network connection drop after server processed mutation
        throw new Error('ECONNRESET: Client dropped connection before receiving HTTP 200/201');
      };

      const res1 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        fetchFn: dropAfterServerFetch as any
      });

      assert.equal(res1.failedCount, 1);
      assert.equal(res1.syncedCount, 0);
      assert.equal(getOfflineQueue(ambUser).length, 1, 'Item must be preserved in queue on network drop');
      assert.equal(getOfflineQueue(ambUser)[0].retryCount, 1);

      // Verify that cycle already exists on server
      const cyclesMidway = await getUserCycles(ambUser);
      const createdMidway = cyclesMidway.filter(c => c.id === cycleId);
      assert.equal(createdMidway.length, 1, 'Server created the cycle during attempt 1');

      // Attempt 2: Queue retries the exact same mutation against live HTTP server
      const normalFetch = async (endpoint: string, opts: any) => {
        serverHitCount++;
        return fetch(`${baseUrl}${endpoint}`, opts);
      };

      const res2 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true,
        fetchFn: normalFetch as any
      });

      assert.equal(res2.syncedCount, 1, 'Retry attempt must succeed via server deduplication');
      assert.equal(res2.failedCount, 0);
      assert.equal(getOfflineQueue(ambUser).length, 0, 'Queue must be cleanly pruned after confirmed resolution');

      // Final State Verification: DB must contain exactly 1 cycle with matching fields
      const cyclesFinal = await getUserCycles(ambUser);
      const finalCycleList = cyclesFinal.filter(c => c.id === cycleId);
      assert.equal(finalCycleList.length, 1, 'Must not duplicate cycle record in database');
      assert.equal(finalCycleList[0].title, 'Ambiguous Cycle');
      assert.equal(finalCycleList[0].targetTheme, 'Bushido Iron');
      assert.equal(serverHitCount, 2, 'Live server was invoked exactly twice across the ambiguous sequence');
    });

    it('UPDATE_LOG: server success -> client dropped connection -> queue retry -> idempotent upsert without duplicates', async () => {
      const cycleId = 'cyc_amb_log_01';
      const logDate = '1403-12-05';
      clearOfflineQueue(ambUser);

      await createCycle(ambUser, {
        id: cycleId,
        title: 'Cycle for Log Test',
        startDate: '1403-12-01',
        endDate: '1403-12-25'
      });

      enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_LOG',
        expectedRevision: 1,
        payload: {
          cycleId,
          date: logDate,
          workout: true,
          study: true,
          journal: true,
          wakeUp: true,
          hardTask: false
        }
      });

      // Attempt 1: Call live server /api/logs, then simulate client abort
      const dropAfterLogFetch = async (endpoint: string, opts: any) => {
        const realRes = await fetch(`${baseUrl}${endpoint}`, opts);
        assert.equal(realRes.status, 200);
        throw new Error('Socket closed prematurely');
      };

      const res1 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        fetchFn: dropAfterLogFetch as any
      });

      assert.equal(res1.failedCount, 1);
      assert.equal(getOfflineQueue(ambUser).length, 1);

      // Attempt 2: Queue retries the exact same UPDATE_LOG mutation
      const liveLogFetch = async (endpoint: string, opts: any) => {
        return fetch(`${baseUrl}${endpoint}`, opts);
      };

      const res2 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true,
        fetchFn: liveLogFetch as any
      });

      assert.equal(res2.syncedCount, 1);
      assert.equal(getOfflineQueue(ambUser).length, 0);

      // Final State Verification: DB must contain exactly 1 dailyLog record for that date
      const logs = await getUserDailyLogs(ambUser);
      const matchingLogs = logs.filter(l => l.date === logDate);
      assert.equal(matchingLogs.length, 1, 'Exactly one daily log must exist for date');
      assert.equal(matchingLogs[0].workout, true);
      assert.equal(matchingLogs[0].study, true);
      assert.equal(matchingLogs[0].wakeUp, true);
    });

    it('UPDATE_CYCLE: server success -> client dropped connection -> queue retry -> correct updated cycle in place', async () => {
      const cycleId = 'cyc_amb_update_01';
      clearOfflineQueue(ambUser);

      await createCycle(ambUser, {
        id: cycleId,
        title: 'Original Initial Title',
        startDate: '1403-12-01',
        endDate: '1403-12-25'
      });

      enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_CYCLE',
        expectedRevision: 1,
        payload: {
          id: cycleId,
          title: 'Updated Master Title',
          targetTheme: 'Golden Armor'
        }
      });

      // Attempt 1: Fail client after server update
      const dropFetch = async (endpoint: string, opts: any) => {
        const realRes = await fetch(`${baseUrl}${endpoint}`, opts);
        assert.equal(realRes.status, 200);
        throw new Error('Client dropped connection');
      };

      await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        fetchFn: dropFetch as any
      });

      assert.equal(getOfflineQueue(ambUser).length, 1);

      // Attempt 2: Replay retry
      const liveFetch = async (endpoint: string, opts: any) => {
        return fetch(`${baseUrl}${endpoint}`, opts);
      };

      const res2 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true,
        fetchFn: liveFetch as any
      });

      // Active queue is drained (either synced or conflict deferred)
      assert.equal(getOfflineQueue(ambUser).length, 0);

      const cycle = await getCycleById(ambUser, cycleId);
      assert.ok(cycle);
      assert.equal(cycle.title, 'Updated Master Title');
      assert.equal(cycle.targetTheme, 'Golden Armor');
    });

    it('UPDATE_PROFILE: server success -> client dropped connection -> queue retry -> correct updated profile in place', async () => {
      clearOfflineQueue(ambUser);

      enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_PROFILE',
        payload: {
          name: 'Warrior Master Kenji',
          nightOwlCutoffHour: 4,
          accentTheme: 'emerald'
        }
      });

      // Attempt 1: Drop after server success
      const dropFetch = async (endpoint: string, opts: any) => {
        const realRes = await fetch(`${baseUrl}${endpoint}`, opts);
        assert.equal(realRes.status, 200);
        throw new Error('Client dropped connection');
      };

      await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        fetchFn: dropFetch as any
      });

      assert.equal(getOfflineQueue(ambUser).length, 1);

      // Attempt 2: Replay retry
      const liveFetch = async (endpoint: string, opts: any) => {
        return fetch(`${baseUrl}${endpoint}`, opts);
      };

      const res2 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true,
        fetchFn: liveFetch as any
      });

      assert.equal(res2.syncedCount, 1);
      assert.equal(getOfflineQueue(ambUser).length, 0);

      const userRecord = await findUserById(ambUser);
      assert.ok(userRecord);
      assert.equal(userRecord.name, 'Warrior Master Kenji');
      assert.equal(userRecord.nightOwlCutoffHour, 4);
      assert.equal(userRecord.accentTheme, 'emerald');
    });
  });

  // ===========================================================================
  // 10. SERVER-SIDE CLIENTOPERATIONID IDEMPOTENCY & CROSS-USER ISOLATION
  // ===========================================================================
  describe('10. Server-Side clientOperationId Idempotency & Cross-User Isolation', () => {
    const userBeta = 'usr_beta_tester';
    const betaToken = generateToken({
      userId: userBeta,
      phoneNumber: '09121112233',
      isVip: false,
      tier: 'FREE'
    });

    beforeEach(() => {
      if (!memoryStore.users.some(u => u.id === userBeta)) {
        memoryStore.users.push({
          id: userBeta,
          phoneNumber: '09121112233',
          email: 'beta@bushido.local',
          name: 'Beta Warrior',
          passwordHash: 'hashed_pwd_beta',
          tier: 'free',
          isVip: false,
          isAdmin: false,
          tokenVersion: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        });
      }
    });

    it('CREATE_CYCLE: clientOperationId deduplicates repeat requests and prevents cross-user collisions', async () => {
      const sharedOpId = 'op_cyc_shared_test_123';

      // 1. User A creates cycle with sharedOpId
      const resA1 = await fetch(`${baseUrl}/api/cycles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: sharedOpId,
          title: 'User A Idempotent Cycle',
          startDate: '1403-12-01',
          endDate: '1403-12-30'
        })
      });
      assert.equal(resA1.status, 200);
      const dataA1 = await resA1.json() as any;
      assert.ok(dataA1.cycle);
      const cycleIdA = dataA1.cycle.id;

      // 2. User A replays the EXACT SAME request with sharedOpId
      const resA2 = await fetch(`${baseUrl}/api/cycles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: sharedOpId,
          title: 'User A Idempotent Cycle',
          startDate: '1403-12-01',
          endDate: '1403-12-30'
        })
      });
      assert.equal(resA2.status, 200);
      const dataA2 = await resA2.json() as any;
      assert.equal(dataA2.deduplicated, true, 'Replay request must be marked deduplicated');
      assert.equal(dataA2.cycle.id, cycleIdA, 'Deduplicated cycle ID must match initial creation');

      // 3. User B sends request with identical sharedOpId
      const resB = await fetch(`${baseUrl}/api/cycles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${betaToken}`
        },
        body: JSON.stringify({
          clientOperationId: sharedOpId,
          title: 'User B Distinct Cycle',
          startDate: '1403-12-01',
          endDate: '1403-12-30'
        })
      });
      assert.equal(resB.status, 200, 'User B must not collide with User A despite identical clientOperationId');
      const dataB = await resB.json() as any;
      assert.notEqual(dataB.cycle.id, cycleIdA, 'User B cycle must have distinct ID scoped to User B');

      const cyclesA = await getUserCycles(ambUser);
      const cyclesB = await getUserCycles(userBeta);
      assert.equal(cyclesA.filter(c => c.title === 'User A Idempotent Cycle').length, 1, 'User A must have exactly 1 cycle');
      assert.equal(cyclesB.filter(c => c.title === 'User B Distinct Cycle').length, 1, 'User B must have exactly 1 cycle');
    });

    it('UPDATE_LOG: clientOperationId and composite key guarantee idempotent log updates without cross-user leakage', async () => {
      // First ensure parent cycles exist for both users
      const cycleA = await createCycle(ambUser, {
        title: 'Cycle for Log Test A',
        startDate: '1403-12-01',
        endDate: '1403-12-30'
      });
      const cycleB = await createCycle(userBeta, {
        title: 'Cycle for Log Test B',
        startDate: '1403-12-01',
        endDate: '1403-12-30'
      });

      const sharedLogOpId = 'op_log_shared_idempotency_99';
      const testDate = '1403-12-15';

      // 1. User A upserts daily log
      const resA1 = await fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: sharedLogOpId,
          cycleId: cycleA.id,
          date: testDate,
          workout: true,
          study: true
        })
      });
      assert.equal(resA1.status, 200);

      // 2. User A replays the update with known revision
      const resA2 = await fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: sharedLogOpId,
          cycleId: cycleA.id,
          date: testDate,
          workout: true,
          study: true,
          expectedRevision: 1
        })
      });
      assert.equal(resA2.status, 200);

      const logsA = await getUserDailyLogs(ambUser);
      const userALogsOnDate = logsA.filter(l => l.date === testDate);
      assert.equal(userALogsOnDate.length, 1, 'Replaying log upsert must never duplicate records for user');
      assert.equal(userALogsOnDate[0].workout, true);

      // 3. User B sends log with identical clientOperationId but workout: false
      const resB = await fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${betaToken}`
        },
        body: JSON.stringify({
          clientOperationId: sharedLogOpId,
          cycleId: cycleB.id,
          date: testDate,
          workout: false,
          study: false
        })
      });
      assert.equal(resB.status, 200);

      const logsB = await getUserDailyLogs(userBeta);
      const userBLogsOnDate = logsB.filter(l => l.date === testDate);
      assert.equal(userBLogsOnDate.length, 1);
      assert.equal(userBLogsOnDate[0].workout, false);

      // Verify User A's log was unaffected by User B's identical clientOperationId
      const refreshedLogA = await getDailyLogByDate(ambUser, testDate);
      assert.equal(refreshedLogA?.workout, true);
    });

    it('UPDATE_CYCLE: replay is idempotent and rejects cross-user cycle modification', async () => {
      const cycleA = await createCycle(ambUser, {
        title: 'Original Cycle A',
        startDate: '1403-12-01',
        endDate: '1403-12-30'
      });

      const updateOpId = 'op_cyc_update_safety_55';

      // 1. User A updates cycle
      const resA1 = await fetch(`${baseUrl}/api/cycles/${cycleA.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: updateOpId,
          title: 'Modified Title A',
          expectedRevision: 1
        })
      });
      assert.equal(resA1.status, 200);

      // 2. User A replays identical update with updated revision
      const resA2 = await fetch(`${baseUrl}/api/cycles/${cycleA.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: updateOpId,
          title: 'Modified Title A',
          expectedRevision: 2
        })
      });
      assert.equal(resA2.status, 200);

      const fetchedA = await getCycleById(ambUser, cycleA.id);
      assert.equal(fetchedA?.title, 'Modified Title A');

      // 3. User B attempts to modify User A's cycle using the same or different opId
      const resB = await fetch(`${baseUrl}/api/cycles/${cycleA.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${betaToken}`
        },
        body: JSON.stringify({
          clientOperationId: updateOpId,
          title: 'Hacked Title B',
          expectedRevision: 1
        })
      });
      assert.equal(resB.status, 404, 'User B must not be permitted to update User A cycle');
    });

    it('UPDATE_PROFILE: clientOperationId replay is idempotent and strictly user-scoped', async () => {
      const profOpId = 'op_prof_idempotent_88';

      // 1. User A updates profile
      const resA1 = await fetch(`${baseUrl}/api/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: profOpId,
          name: 'Ambiguous Master Prime',
          accentTheme: 'amber'
        })
      });
      assert.equal(resA1.status, 200);

      // 2. User A replays identical request
      const resA2 = await fetch(`${baseUrl}/api/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: profOpId,
          name: 'Ambiguous Master Prime',
          accentTheme: 'amber'
        })
      });
      assert.equal(resA2.status, 200);

      const userA = await findUserById(ambUser);
      assert.equal(userA?.name, 'Ambiguous Master Prime');
      assert.equal(userA?.accentTheme, 'amber');

      // 3. User B updates profile with identical clientOperationId
      const resB = await fetch(`${baseUrl}/api/user/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${betaToken}`
        },
        body: JSON.stringify({
          clientOperationId: profOpId,
          name: 'Beta Master Solo',
          accentTheme: 'cyan'
        })
      });
      assert.equal(resB.status, 200);

      const userB = await findUserById(userBeta);
      assert.equal(userB?.name, 'Beta Master Solo');
      assert.equal(userB?.accentTheme, 'cyan');

      // Confirm User A profile was not modified by User B request
      const userAAfter = await findUserById(ambUser);
      assert.equal(userAAfter?.name, 'Ambiguous Master Prime');
    });
  });
});
