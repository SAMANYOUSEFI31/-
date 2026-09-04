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

describe('Phase 3B.2: Replay Idempotency & Retry Safety Suite', () => {
  const storageMock: Record<string, string> = {};

  beforeEach(() => {
    // Clear storage mock
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
      // Simulate another tab already holding active lock
      const acquired = acquireReplayLock(user);
      assert.equal(acquired, true, 'First lock acquisition should succeed');

      const secondAcquire = acquireReplayLock(user);
      assert.equal(secondAcquire, false, 'Second lock attempt while held must fail');

      releaseReplayLock(user);
      const thirdAcquire = acquireReplayLock(user);
      assert.equal(thirdAcquire, true, 'Lock should be acquirable after release');
      releaseReplayLock(user);
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

    it('quarantines items that exceed MAX_REPLAY_RETRIES on repeated 500 errors', async () => {
      const user = 'usr_max_retry';
      const token = 'tok_max_retry';

      enqueueOfflineMutation(user, {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Valid Name' }
      });

      const fetch500 = async () => ({ ok: false, status: 500 });

      // Run replay MAX_REPLAY_RETRIES times
      for (let i = 0; i < MAX_REPLAY_RETRIES; i++) {
        await replayAccountOfflineQueue({
          activeAccountId: user,
          authToken: token,
          fetchFn: fetch500 as any
        });
      }

      // After 5 retries, the item must be quarantined and queue emptied
      assert.equal(getOfflineQueue(user).length, 0, 'Active queue must be emptied after max retries');
      const quarantined = getQuarantinedItems(user);
      assert.equal(quarantined.length, 1, 'Exceeded retry item must be safely quarantined');
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
});
