import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  clearAllReplayLocks,
  enqueueOfflineMutation,
  replayAccountOfflineQueue,
  getOfflineQueue,
  saveOfflineQueue,
  getQuarantinedItems
} from '../src/utils/offlineQueueUtils.js';
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
  createCycle
} from '../server/db/index.js';

describe('Phase 3B.2: Replay Idempotency & Retry Safety Suite', () => {
  const storageMock: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => storageMock[key] ?? null,
    setItem: (key: string, val: string) => { storageMock[key] = String(val); },
    removeItem: (key: string) => { delete storageMock[key]; },
    clear: () => { for (const k in storageMock) delete storageMock[k]; },
    get length() { return Object.keys(storageMock).length; },
    key: (i: number) => Object.keys(storageMock)[i] ?? null
  };

  const ambUser = 'usr_ambiguous_tester';
  const userBeta = 'usr_beta_tester';
  
  const ambToken = generateToken({
    userId: ambUser,
    phoneNumber: '09129998877',
    isVip: true,
    tier: 'VIP'
  });

  const betaToken = generateToken({
    userId: userBeta,
    phoneNumber: '09129998888',
    isVip: true,
    tier: 'VIP'
  });

  let server: http.Server;
  let baseUrl = '';
  const originalFetch = globalThis.fetch;

  before(async () => {
    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).window = { localStorage: mockLocalStorage };

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
    globalThis.fetch = originalFetch;
    if (server) {
      (server as any).closeAllConnections?.();
      server.unref?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(() => {
    for (const k in storageMock) delete storageMock[k];
    clearAllReplayLocks();

    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.users = [
      {
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
      },
      {
        id: userBeta,
        phoneNumber: '09129998888',
        email: 'beta@bushido.local',
        name: 'Beta Master',
        passwordHash: 'hashed_pwd_beta',
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: false,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setPrismaState(null, false);
    clearAllReplayLocks();
    for (const k in storageMock) delete storageMock[k];
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
  });

  describe('Idempotency logic', () => {
    it('CREATE_CYCLE: replay idempotency based on clientOperationId', async () => {
      const sharedOpId = 'op_cyc_shared_idempotency_77';

      // 1. User A creates cycle
      const resA1 = await fetch(`${baseUrl}/api/cycles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ambToken}`
        },
        body: JSON.stringify({
          clientOperationId: sharedOpId,
          title: 'User A Idempotent Cycle',
          startDate: '2025-12-01',
          endDate: '2025-12-30'
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
          startDate: '2025-12-01',
          endDate: '2025-12-30'
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
          startDate: '2025-12-01',
          endDate: '2025-12-30'
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
      const cycleA = await createCycle(ambUser, {
        title: 'Cycle for Log Test A',
        startDate: '2025-12-01',
        endDate: '2025-12-30'
      });
      const cycleB = await createCycle(userBeta, {
        title: 'Cycle for Log Test B',
        startDate: '2025-12-01',
        endDate: '2025-12-30'
      });

      const sharedLogOpId = 'op_log_shared_idempotency_99';
      const testDate = '2025-12-15';

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

      const refreshedLogA = await getDailyLogByDate(ambUser, testDate);
      assert.equal(refreshedLogA?.workout, true);
    });

    it('UPDATE_CYCLE: replay is idempotent and rejects cross-user cycle modification', async () => {
      const cycleA = await createCycle(ambUser, {
        title: 'Original Cycle A',
        startDate: '2025-12-01',
        endDate: '2025-12-30'
      });

      const updateOpId = 'op_cyc_update_safety_55';

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

      const userAAfter = await findUserById(ambUser);
      assert.equal(userAAfter?.name, 'Ambiguous Master Prime');
    });
  });

  describe('Replay contracts & resilient queue execution', () => {
    it('interrupted replay resumption: incomplete queue resumes from next item in subsequent replay run', async () => {
      const cycle = await createCycle(ambUser, { title: 'Resume Cycle', startDate: '2026-09-01', endDate: '2026-09-30' });
      const item1 = enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_LOG',
        payload: { cycleId: cycle.id, date: '2026-09-01', workout: true, revision: 1 }
      });
      const item2 = enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_LOG',
        payload: { cycleId: cycle.id, date: '2026-09-02', workout: true, revision: 1 }
      });

      assert.equal(getOfflineQueue(ambUser).length, 2);

      let fetchCallCount = 0;
      globalThis.fetch = async (url: any, opts: any) => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          return new Response(JSON.stringify({
            success: true,
            log: {
              id: 'log-resume-1',
              date: '2026-09-01',
              cycleId: cycle.id,
              revision: 2,
              wakeUp: false,
              workout: true,
              study: false,
              journal: false,
              hardTask: false,
              specialMission: false
            }
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        } else {
          throw new Error('Connection reset by peer during replay');
        }
      };

      const run1 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true
      });

      assert.equal(run1.syncedCount, 1);
      assert.equal(run1.failedCount, 1);
      const remainingAfterRun1 = getOfflineQueue(ambUser);
      assert.equal(remainingAfterRun1.length, 1);
      assert.equal(remainingAfterRun1[0].id, item2.id, 'Item 2 remains in queue after interrupted run');

      // Second replay run: network recovered, resumes cleanly for Item 2
      globalThis.fetch = async () => {
        return new Response(JSON.stringify({
          success: true,
          log: {
            id: 'log-resume-2',
            date: '2026-09-02',
            cycleId: cycle.id,
            revision: 2,
            wakeUp: false,
            workout: true,
            study: false,
            journal: false,
            hardTask: false,
            specialMission: false
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const run2 = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true
      });

      assert.equal(run2.syncedCount, 1);
      assert.equal(run2.failedCount, 0);
      assert.equal(getOfflineQueue(ambUser).length, 0, 'Queue is completely drained after successful resumption');
    });

    it('confirmed-item immunity: confirmed items are immune to replay distortion and not reverted', async () => {
      const cycle = await createCycle(ambUser, { title: 'Immunity Cycle', startDate: '2026-09-01', endDate: '2026-09-30' });
      // Enqueue two operations for the same date: item 1 at revision 2, item 2 with stale revision 1
      enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_LOG',
        payload: { cycleId: cycle.id, date: '2026-09-03', workout: true, revision: 2 }
      });

      let requestedRevisions: number[] = [];
      globalThis.fetch = async (url: any, opts: any) => {
        const body = JSON.parse(opts.body);
        requestedRevisions.push(body.expectedRevision);
        return new Response(JSON.stringify({
          success: true,
          log: {
            id: 'log-imm-1',
            date: '2026-09-03',
            cycleId: cycle.id,
            revision: 3,
            wakeUp: false,
            workout: true,
            study: false,
            journal: false,
            hardTask: false,
            specialMission: false
          }
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true
      });

      assert.equal(result.syncedCount, 1);
      assert.equal(requestedRevisions.length, 1);
      assert.equal(requestedRevisions[0], 2);
      assert.equal(getOfflineQueue(ambUser).length, 0);
    });

    it('queue removal only after validated success: queue item is retained if request fails or response is not validated', async () => {
      const cycle = await createCycle(ambUser, { title: 'Retention Cycle', startDate: '2026-09-01', endDate: '2026-09-30' });
      const item = enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_LOG',
        payload: { cycleId: cycle.id, date: '2026-09-04', workout: true, revision: 1 }
      });

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({
          success: false,
          error: 'Internal server failure'
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true
      });

      assert.equal(result.syncedCount, 0);
      assert.equal(result.failedCount, 1);
      const queue = getOfflineQueue(ambUser);
      assert.equal(queue.length, 1, 'Queue item must not be removed on server 500');
      assert.equal(queue[0].id, item.id);
    });

    it('retryable failure queue preservation: 500 error preserves queue item with updated retryCount and backoff', async () => {
      const cycle = await createCycle(ambUser, { title: 'Retryable Cycle', startDate: '2026-09-01', endDate: '2026-09-30' });
      const item = enqueueOfflineMutation(ambUser, {
        type: 'UPDATE_LOG',
        payload: { cycleId: cycle.id, date: '2026-09-05', workout: true, revision: 1 }
      });

      globalThis.fetch = async () => {
        return new Response(JSON.stringify({ error: 'Gateway timeout' }), {
          status: 504,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true
      });

      const queue = getOfflineQueue(ambUser);
      assert.equal(queue.length, 1);
      assert.equal(queue[0].retryCount, 1, 'retryCount incremented');
      assert.equal(queue[0].classification, 'SERVER_RETRYABLE');
      assert.ok(queue[0].nextRetryAt && queue[0].nextRetryAt > Date.now(), 'Bounded backoff timestamp set');
    });

    it('unknown mutation safety: unknown mutation type is quarantined with UNKNOWN_MUTATION and removed from active queue', async () => {
      const unknownItem = {
        id: 'queue_unknown_test_99',
        ownerId: ambUser,
        type: 'UNRECOGNIZED_CUSTOM_TYPE' as any,
        payload: { data: 'test' },
        timestamp: Date.now(),
        retryCount: 0
      };
      saveOfflineQueue(ambUser, [unknownItem]);

      let errorReported: any = null;
      let networkCalled = false;
      globalThis.fetch = async () => {
        networkCalled = true;
        return new Response('{}', { status: 200 });
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true,
        onItemFailure: (item, err) => {
          errorReported = err;
        }
      });

      assert.equal(networkCalled, false, 'No network call should be made for unknown mutation');
      assert.equal(result.syncedCount, 0);
      assert.equal(result.failedCount, 1);
      assert.equal(getOfflineQueue(ambUser).length, 0, 'Unknown mutation must be removed from active queue');

      const quarantined = getQuarantinedItems(ambUser);
      assert.equal(quarantined.length, 1, 'Item is safely preserved in quarantine');
      assert.equal(quarantined[0].items[0].id, unknownItem.id);
      assert.equal(quarantined[0].items[0].classification, 'UNKNOWN_MUTATION');
      assert.ok(errorReported?.message?.includes('Unknown mutation type'));
    });
  });
});
