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
        return { ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; };
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
