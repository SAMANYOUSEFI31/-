import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  clearAllReplayLocks,
  enqueueOfflineMutation,
  replayAccountOfflineQueue,
  getOfflineQueue
} from '../src/utils/offlineQueueUtils.js';
import { app } from '../server.js';
import { generateToken } from '../server/auth.js';
import {
  memoryStore,
  setPrismaState,
  createCycle,
  upsertDailyLog,
  ConcurrencyConflictError
} from '../server/db/index.js';

describe('Phase 4 Final Acceptance', () => {
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
  const ambToken = generateToken({ userId: ambUser, phoneNumber: '09129998877', isVip: true, tier: 'VIP' });
  const betaToken = generateToken({ userId: userBeta, phoneNumber: '09129998888', isVip: true, tier: 'VIP' });

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
    memoryStore.cycles.length = 0;
    memoryStore.dailyLogs.length = 0;
    memoryStore.users = [{
      id: ambUser, phoneNumber: '09129998877', email: 'test@local', name: 'Test',
      passwordHash: '', tier: 'vip', isVip: true, isAdmin: false, tokenVersion: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    },
    {
      id: userBeta, phoneNumber: '09129998888', email: 'beta@local', name: 'Beta',
      passwordHash: '', tier: 'vip', isVip: true, isAdmin: false, tokenVersion: 0,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setPrismaState(null, false);
    clearAllReplayLocks();
    for (const k in storageMock) delete storageMock[k];
    memoryStore.cycles.length = 0;
    memoryStore.dailyLogs.length = 0;
  });

  it('A. Same-operation ambiguous retry (committed-update scenario)', async () => {
    const cycle = await createCycle(ambUser, { title: 'Test Cycle', startDate: '2026-09-01', endDate: '2026-09-30' });
    
    // 1. Initial DailyLog created at revision 1
    const createRes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({
        cycleId: cycle.id,
        date: '2026-09-05',
        workout: true,
        study: false,
        notes: 'initial create',
        clientOperationId: 'op_create_1'
      })
    });
    assert.equal(createRes.status, 200);
    const createBody = await createRes.json() as any;
    assert.equal(createBody.log.revision, 1);
    assert.equal(createBody.log.study, false);

    // 2. Submit op-1 as an update with expectedRevision 1 -> changes authoritative record to revision 2
    const op1 = 'op_update_committed_1';
    const updateRes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({
        cycleId: cycle.id,
        date: '2026-09-05',
        workout: true,
        study: true,
        notes: 'updated by op-1',
        clientOperationId: op1,
        expectedRevision: 1
      })
    });
    assert.equal(updateRes.status, 200);
    const updateBody = await updateRes.json() as any;
    assert.equal(updateBody.log.revision, 2, 'op-1 changes authoritative record to revision 2');
    assert.equal(updateBody.log.study, true);
    assert.equal(updateBody.log.notes, 'updated by op-1');

    // 3. Server response lost; retry exact same op-1 with expectedRevision 1
    const retryRes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({
        cycleId: cycle.id,
        date: '2026-09-05',
        workout: false,
        study: false,
        notes: 'tampered second payload attempt',
        clientOperationId: op1,
        expectedRevision: 1
      })
    });
    assert.equal(retryRes.status, 200, 'Idempotent retry succeeds without 409 conflict');
    const retryBody = await retryRes.json() as any;
    assert.equal(retryBody.log.revision, 2, 'Response is still revision 2; no second increment occurred');
    assert.equal(retryBody.log.study, true, 'Original op-1 payload preserved');
    assert.equal(retryBody.log.notes, 'updated by op-1', 'Payload was not applied a second time');

    // 4. Confirm exactly one authoritative DailyLog exists
    const logs = memoryStore.dailyLogs.filter(l => l.userId === ambUser && l.date === '2026-09-05');
    assert.equal(logs.length, 1, 'Exactly one authoritative DailyLog exists');
    assert.equal(logs[0].revision, 2);
    assert.equal(logs[0].notes, 'updated by op-1');
  });

  it('A2. Same-operation first-create ambiguous retry', async () => {
    const cycle = await createCycle(ambUser, { title: 'First Create Cycle', startDate: '2026-09-01', endDate: '2026-09-30' });
    const opId = 'op_create_retry_1';

    const res1 = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ cycleId: cycle.id, date: '2026-09-08', workout: true, clientOperationId: opId })
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json() as any;
    assert.equal(body1.log.revision, 1);

    const res2 = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ cycleId: cycle.id, date: '2026-09-08', workout: true, clientOperationId: opId })
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json() as any;
    assert.equal(body2.log.revision, 1, 'No second increment on create retry');

    const logs = memoryStore.dailyLogs.filter(l => l.userId === ambUser && l.date === '2026-09-08');
    assert.equal(logs.length, 1, 'Exactly one record exists after first-create retry');
  });

  it('B. Different-operation stale retry', async () => {
    const cycle = await createCycle(ambUser, { title: 'Test Cycle 2', startDate: '2026-09-01', endDate: '2026-09-30' });
    const opId1 = 'op_diff_1';
    const opId2 = 'op_diff_2';
    
    // Setup revision 2 (by executing a second mutation with a new opId)
    await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ cycleId: cycle.id, date: '2026-09-06', workout: true, clientOperationId: opId1 })
    });
    
    await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ cycleId: cycle.id, date: '2026-09-06', workout: false, study: true, clientOperationId: 'op_diff_1_b', expectedRevision: 1 })
    });

    const res3 = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ cycleId: cycle.id, date: '2026-09-06', study: false, clientOperationId: opId2, expectedRevision: 1 })
    });
    assert.equal(res3.status, 409, 'typed CONFLICT is returned');
    const body3 = await res3.json() as any;
    assert.equal(body3.code, 'CONFLICT');
    assert.equal(body3.currentRevision, 2);
  });

  it('C. Cross-owner isolation', async () => {
    const cycleA = await createCycle(ambUser, { title: 'Test Cycle A', startDate: '2026-09-01', endDate: '2026-09-30' });
    const cycleB = await createCycle(userBeta, { title: 'Test Cycle B', startDate: '2026-09-01', endDate: '2026-09-30' });
    const sharedOpId = 'op_shared_cross';

    const resA = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ cycleId: cycleA.id, date: '2026-09-07', workout: true, clientOperationId: sharedOpId })
    });
    assert.equal(resA.status, 200);

    const resB = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${betaToken}` },
      body: JSON.stringify({ cycleId: cycleB.id, date: '2026-09-07', workout: false, study: true, clientOperationId: sharedOpId })
    });
    assert.equal(resB.status, 200);
    const bodyB = await resB.json() as any;
    assert.equal(bodyB.log.workout, false, 'Does not resolve to first owner daily log');
  });

  describe('D. Prisma Adapter Mock Coverage (Concurrent P2002 & Authority)', () => {
    it('A. Same-operation P2002 race (Prisma adapter mock)', async () => {
      const opId = 'op_p2002_same';
      const cycleId = 'cyc_prisma_mock_1';
      const date = '2026-09-15';
      const racedRecord = {
        id: `log-${ambUser}-${date}`,
        userId: ambUser,
        cycleId,
        date,
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        failureReason: null,
        failureTime: null,
        autopsyNotes: null,
        countermeasure: null,
        aiFeedback: null,
        notes: null,
        lastClientOperationId: opId,
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let findFirstCalls = 0;
      const mockPrisma = {
        cycle: {
          findFirst: async () => ({ id: cycleId, userId: ambUser })
        },
        dailyLog: {
          findFirst: async () => {
            findFirstCalls++;
            // 1st call: initial existence check returns null
            if (findFirstCalls === 1) return null;
            // 2nd call: lookup after P2002 race returns racedRecord with matching lastClientOperationId
            return racedRecord;
          },
          create: async () => {
            const err: any = new Error('Unique constraint failed on the fields: (`userId`,`date`)');
            err.code = 'P2002';
            throw err;
          }
        }
      };

      setPrismaState(mockPrisma, true);
      try {
        const memoryBefore = memoryStore.dailyLogs.length;
        const result = await upsertDailyLog(ambUser, {
          cycleId,
          date,
          wakeUp: true,
          workout: true,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          clientOperationId: opId
        });

        assert.equal(result.id, racedRecord.id);
        assert.equal(result.revision, 1);
        assert.equal(result.lastClientOperationId, opId);
        assert.equal(memoryStore.dailyLogs.length, memoryBefore, 'No memory fallback mutation occurs');
      } finally {
        setPrismaState(null, false);
      }
    });

    it('B. Different-operation P2002 race (Prisma adapter mock)', async () => {
      const cycleId = 'cyc_prisma_mock_2';
      const date = '2026-09-16';
      const racedRecord = {
        id: `log-${ambUser}-${date}`,
        userId: ambUser,
        cycleId,
        date,
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        failureReason: null,
        failureTime: null,
        autopsyNotes: null,
        countermeasure: null,
        aiFeedback: null,
        notes: null,
        lastClientOperationId: 'other_winner_op',
        revision: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      let findFirstCalls = 0;
      const mockPrisma = {
        cycle: {
          findFirst: async () => ({ id: cycleId, userId: ambUser })
        },
        dailyLog: {
          findFirst: async () => {
            findFirstCalls++;
            if (findFirstCalls === 1) return null;
            return racedRecord;
          },
          create: async () => {
            const err: any = new Error('Unique constraint failed on the fields: (`userId`,`date`)');
            err.code = 'P2002';
            throw err;
          }
        }
      };

      setPrismaState(mockPrisma, true);
      try {
        const memoryBefore = memoryStore.dailyLogs.length;
        await assert.rejects(
          async () => {
            await upsertDailyLog(ambUser, {
              cycleId,
              date,
              wakeUp: false,
              workout: false,
              study: true,
              journal: false,
              hardTask: false,
              specialMission: false,
              clientOperationId: 'my_loser_op'
            });
          },
          (err: any) => {
            assert.ok(err instanceof ConcurrencyConflictError || err.code === 'CONFLICT');
            assert.equal(err.entityType, 'DAILY_LOG');
            assert.equal(err.currentRevision, 1);
            return true;
          }
        );
        assert.equal(memoryStore.dailyLogs.length, memoryBefore, 'No memory fallback mutation occurs');
      } finally {
        setPrismaState(null, false);
      }
    });

    it('C. Prisma authority: affected Prisma errors must not silently convert to memoryStore success', async () => {
      const cycleId = 'cyc_prisma_mock_3';
      const date = '2026-09-17';
      const mockPrisma = {
        cycle: {
          findFirst: async () => ({ id: cycleId, userId: ambUser })
        },
        dailyLog: {
          findFirst: async () => null,
          create: async () => {
            const dbError: any = new Error('Database connection pool exhausted');
            dbError.code = 'P1001';
            throw dbError;
          }
        }
      };

      setPrismaState(mockPrisma, true);
      try {
        const memoryBefore = memoryStore.dailyLogs.length;
        await assert.rejects(
          async () => {
            await upsertDailyLog(ambUser, {
              cycleId,
              date,
              wakeUp: true,
              workout: true,
              study: false,
              journal: false,
              hardTask: false,
              specialMission: false,
              clientOperationId: 'op_db_fail'
            });
          },
          (err: any) => {
            assert.equal(err.code, 'P1001');
            return true;
          }
        );
        assert.equal(memoryStore.dailyLogs.length, memoryBefore, 'Must not silently mutate memoryStore on Prisma error');
      } finally {
        setPrismaState(null, false);
      }
    });
  });

  it('E. Invalid successful replay response: preserves queue item with INVALID_SUCCESS_RESPONSE without removing or applying data', async () => {
    const date = '2026-09-20';
    const cycleId = 'cyc_test_replay_malformed';

    const testItem = enqueueOfflineMutation(ambUser, {
      type: 'UPDATE_LOG',
      payload: {
        cycleId,
        date,
        workout: true,
        study: true,
        revision: 1
      }
    });

    let onItemSuccessCalled = false;

    // Simulate fetch returning HTTP 200 with an identity-mismatched or malformed body
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({
        success: true,
        log: {
          date: '2026-09-99', // Mismatched date fails isValidLogResponse check
          cycleId,
          revision: 2,
          wakeUp: true,
          workout: true,
          study: true,
          journal: true,
          hardTask: true,
          specialMission: false
        }
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    };

    try {
      const replayResult = await replayAccountOfflineQueue({
        activeAccountId: ambUser,
        authToken: ambToken,
        force: true,
        onItemSuccess: () => {
          onItemSuccessCalled = true;
        }
      });

      // 1. Queue item is not removed as successful
      const queue = getOfflineQueue(ambUser);
      assert.equal(queue.length, 1, 'Queue item must remain recoverable in queue');
      assert.equal(queue[0].id, testItem.id);

      // 2. syncedCount is not incremented
      assert.equal(replayResult.syncedCount, 0, 'syncedCount must not be incremented');

      // 3. onItemSuccess is not called
      assert.equal(onItemSuccessCalled, false, 'onItemSuccess must not be called');

      // 4. Classification becomes INVALID_SUCCESS_RESPONSE
      assert.equal(queue[0].classification, 'INVALID_SUCCESS_RESPONSE');

      // 5. retryCount and bounded backoff are updated
      assert.equal(queue[0].retryCount, 1, 'retryCount must be incremented');
      assert.ok(queue[0].nextRetryAt && queue[0].nextRetryAt > Date.now(), 'Bounded backoff must be recorded');

      // 6. Invalid server data is not applied to confirmed local storage
      const confirmedLogs = localStorage.getItem(`bushido_daily_logs_${ambUser}`);
      assert.equal(confirmedLogs, null, 'Invalid server data must not be stored in confirmed local storage');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('F. HTTP 428 Precondition Required for missing expectedRevision', async () => {
    const cycle = await createCycle(ambUser, { title: 'Test Cycle F', startDate: '2026-09-01', endDate: '2026-09-30' });
    const res1 = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ cycleId: cycle.id, date: '2026-09-10', workout: true, clientOperationId: 'opF' })
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json() as any;

    const res2 = await fetch(`${baseUrl}/api/logs/${body1.log.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ambToken}` },
      body: JSON.stringify({ workout: false })
    });
    assert.equal(res2.status, 428, 'Returns HTTP 428 Precondition Required when expectedRevision is missing');
  });
});

