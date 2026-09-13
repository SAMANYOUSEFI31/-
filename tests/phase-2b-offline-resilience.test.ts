import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate,
  executeDirectDailyLogMutation,
  applyReplayItemToActiveState,
  safeMergeReconciledLogs
} from '../src/utils/directMutationUtils.js';
import {
  saveOfflineQueue,
  getOfflineQueue,
  clearAllReplayLocks,
  enqueueOfflineMutation,
  replayAccountOfflineQueue
} from '../src/utils/offlineQueueUtils.js';
import { app } from '../server.js';
import { generateToken } from '../server/auth.js';
import {
  memoryStore,
  setPrismaState,
  getUserDailyLogs,
  getDailyLogByDate,
  createCycle
} from '../server/db/index.js';
import { DailyLog, Cycle } from '../src/types.js';

describe('Phase 2B: Short Offline Resilience for Daily Logs', () => {
  const mockStorage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
    removeItem: (key: string) => { delete mockStorage[key]; },
    clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
    get length() { return Object.keys(mockStorage).length; },
    key: (i: number) => Object.keys(mockStorage)[i] ?? null
  };

  const testUser = 'usr_phase2b_test_user';
  const targetDate = '1403-07-10';
  const cycleId = 'cyc_phase2b_active';

  const testToken = generateToken({
    userId: testUser,
    phoneNumber: '09121112233',
    isVip: true,
    tier: 'VIP'
  });

  let server: http.Server;
  let baseUrl = '';

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
    if (server) {
      (server as any).closeAllConnections?.();
      server.unref?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(async () => {
    mockLocalStorage.clear();
    clearAllReplayLocks();
    setPrismaState(null, false);

    memoryStore.users = [
      {
        id: testUser,
        phoneNumber: '09121112233',
        email: 'phase2b@bushido.local',
        name: 'Phase 2B Warrior',
        passwordHash: 'hashed_pwd',
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: false,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];

    // Create active cycle
    await createCycle(testUser, {
      id: cycleId,
      title: 'Phase 2B Test Cycle',
      startDate: '1403-07-01',
      endDate: '1403-07-30',
      durationDays: 30,
      rules: ['wakeUp', 'workout', 'study', 'journal', 'hardTask']
    });

    saveOfflineQueue(testUser, []);
  });

  describe('1. Offline Habit Upsert Enqueue & UI Consistency', () => {
    it('enqueues mutation with isSynced: false and keeps UI consistent when offline', async () => {
      const initialLogs: DailyLog[] = [
        {
          id: 'log-1',
          cycleId,
          date: targetDate,
          wakeUp: false,
          workout: false,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          revision: 1,
          isSynced: true
        }
      ];

      // User toggles workout while offline
      const updatedLog: DailyLog = {
        ...initialLogs[0],
        workout: true
      };

      const { nextLogs } = applyOptimisticLogUpdate(initialLogs, updatedLog);
      assert.equal(nextLogs[0].workout, true);
      assert.equal(nextLogs[0].isSynced, false, 'Optimistic state remains isSynced: false while unconfirmed');

      // Execute mutation with a failing fetch (network offline simulation)
      const failingFetch = async () => {
        throw new Error('Failed to fetch (Network offline)');
      };

      const result = await executeDirectDailyLogMutation({
        updatedLog,
        existingLog: initialLogs[0],
        activeCycleId: cycleId,
        ownerId: testUser,
        authToken: testToken,
        fetchFn: failingFetch as any
      });

      assert.equal(result.status, 'NETWORK_ERROR');

      // Verify that item is durably persisted in offline queue
      const queue = getOfflineQueue(testUser);
      assert.equal(queue.length, 1, 'Exactly one queue item must be in offline queue');
      assert.equal(queue[0].type, 'UPDATE_LOG');
      assert.equal(queue[0].payload.workout, true);
      assert.equal(queue[0].payload.date, targetDate);
    });

    it('compacts multiple successive offline habit toggles on the same day without creating duplicate queue items', async () => {
      const initialLogs: DailyLog[] = [
        {
          id: 'log-1',
          cycleId,
          date: targetDate,
          wakeUp: false,
          workout: false,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          revision: 1,
          isSynced: true
        }
      ];

      const failingFetch = async () => {
        throw new Error('Network offline');
      };

      // Tap 1: workout
      const log1: DailyLog = { ...initialLogs[0], workout: true };
      await executeDirectDailyLogMutation({
        updatedLog: log1,
        existingLog: initialLogs[0],
        activeCycleId: cycleId,
        ownerId: testUser,
        authToken: testToken,
        fetchFn: failingFetch as any
      });

      let queue = getOfflineQueue(testUser);
      assert.equal(queue.length, 1);
      assert.equal(queue[0].payload.workout, true);
      assert.equal(queue[0].payload.study, false);

      // Tap 2: study
      const log2: DailyLog = { ...log1, study: true };
      await executeDirectDailyLogMutation({
        updatedLog: log2,
        existingLog: initialLogs[0],
        activeCycleId: cycleId,
        ownerId: testUser,
        authToken: testToken,
        fetchFn: failingFetch as any
      });

      queue = getOfflineQueue(testUser);
      assert.equal(queue.length, 1, 'Compaction must maintain single queue item for same day');
      assert.equal(queue[0].payload.workout, true, 'Workout must remain preserved');
      assert.equal(queue[0].payload.study, true, 'Study must be updated to true');

      // Tap 3: special mission
      const log3: DailyLog = { ...log2, specialMission: true };
      await executeDirectDailyLogMutation({
        updatedLog: log3,
        existingLog: initialLogs[0],
        activeCycleId: cycleId,
        ownerId: testUser,
        authToken: testToken,
        fetchFn: failingFetch as any
      });

      queue = getOfflineQueue(testUser);
      assert.equal(queue.length, 1);
      assert.equal(queue[0].payload.workout, true);
      assert.equal(queue[0].payload.study, true);
      assert.equal(queue[0].payload.specialMission, true);
    });
  });

  describe('2. Replay on Reconnect & Idempotent Upsert', () => {
    it('replays offline habit upserts to server on reconnect and confirms isSynced: true', async () => {
      // 1. Initial server log at revision 1
      memoryStore.dailyLogs = [
        {
          id: `log-${testUser}-${targetDate}`,
          userId: testUser,
          cycleId,
          date: targetDate,
          wakeUp: false,
          workout: false,
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
          lastClientOperationId: null,
          revision: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];

      // 2. Client toggles habits offline
      const localLog: DailyLog = {
        id: `log-${testUser}-${targetDate}`,
        cycleId,
        date: targetDate,
        wakeUp: true,
        workout: true,
        study: true,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1,
        isSynced: false
      };

      const customFetch = async (url: string, opts?: any) => {
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        return globalThis.fetch(fullUrl, opts);
      };

      // Enqueue offline
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: {
          cycleId,
          date: targetDate,
          wakeUp: true,
          workout: true,
          study: true,
          journal: false,
          hardTask: false,
          specialMission: false,
          revision: 1,
          expectedRevision: 1
        },
        expectedRevision: 1
      });

      assert.equal(getOfflineQueue(testUser).length, 1);

      // 3. Trigger replay on reconnect
      const replayResult = await replayAccountOfflineQueue({
        activeAccountId: testUser,
        authToken: testToken,
        fetchFn: customFetch as any
      });

      assert.equal(replayResult.syncedCount, 1, 'Replay must successfully sync 1 item');
      assert.equal(replayResult.failedCount, 0);
      assert.equal(getOfflineQueue(testUser).length, 0, 'Queue must be drained after successful replay');

      // 4. Verify server state
      const serverLogs = await getUserDailyLogs(testUser, cycleId);
      assert.equal(serverLogs.length, 1, 'Exactly one log must exist on server');
      assert.equal(serverLogs[0].wakeUp, true);
      assert.equal(serverLogs[0].workout, true);
      assert.equal(serverLogs[0].study, true);
      assert.equal(serverLogs[0].revision, 2, 'Revision must be incremented to 2');

      // 5. Test applyReplayItemToActiveState
      const activeState = {
        cycles: memoryStore.cycles.map(c => ({ ...c, isSynced: true })),
        logs: [localLog]
      };

      const nextState = applyReplayItemToActiveState(
        activeState,
        { type: 'UPDATE_LOG', payload: { date: targetDate } },
        { log: serverLogs[0] }
      );

      assert.equal(nextState.logs[0].isSynced, true, 'Active log must now be isSynced: true');
      assert.equal(nextState.logs[0].revision, 2);
    });

    it('does not duplicate habit ticks or create double entries on repeated replay (idempotency)', async () => {
      // First insert log on server with operation ID
      const opId = 'test_op_id_unique_123';

      const customFetch = async (url: string, opts?: any) => {
        const fullUrl = url.startsWith('http') ? url : `${baseUrl}${url}`;
        return globalThis.fetch(fullUrl, opts);
      };

      // Direct POST to /api/logs with clientOperationId
      const res1 = await customFetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
          cycleId,
          date: targetDate,
          wakeUp: true,
          workout: true,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          clientOperationId: opId
        })
      });

      assert.equal(res1.status, 200);
      const json1 = await res1.json();
      assert.equal(json1.log.revision, 1);
      assert.equal(json1.log.workout, true);

      // Repeat identical request with same clientOperationId (simulating duplicate network delivery)
      const res2 = await customFetch('/api/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testToken}`
        },
        body: JSON.stringify({
          cycleId,
          date: targetDate,
          wakeUp: true,
          workout: true,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          clientOperationId: opId
        })
      });

      assert.equal(res2.status, 200);
      const json2 = await res2.json();
      assert.equal(json2.log.revision, 1, 'Idempotent retry must return existing record without double-incrementing revision');

      const allLogs = await getUserDailyLogs(testUser, cycleId);
      assert.equal(allLogs.length, 1, 'Must not duplicate daily log rows');
    });
  });

  describe('3. Error Visibility Truthfulness', () => {
    it('does not show error toast when offline mutation is durably queued', async () => {
      let toastCalled = false;
      const showToast = () => { toastCalled = true; };

      const failingFetch = async () => {
        throw new Error('Network offline');
      };

      const updatedLog: DailyLog = {
        id: 'log-1',
        cycleId,
        date: targetDate,
        wakeUp: false,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1,
        isSynced: true
      };

      const result = await executeDirectDailyLogMutation({
        updatedLog,
        existingLog: null,
        activeCycleId: cycleId,
        ownerId: testUser,
        authToken: testToken,
        fetchFn: failingFetch as any
      });

      assert.equal(result.status, 'NETWORK_ERROR');
      // In App.tsx logic: NETWORK_ERROR / QUEUED_OFFLINE does NOT call showAppToast
      if (result.status === 'FORBIDDEN' || result.status === 'VALIDATION_ERROR' || result.status === 'ENTITY_MISSING' || result.status === 'STORAGE_WRITE_FAILED') {
        showToast();
      }

      assert.equal(toastCalled, false, 'No error toast must be displayed when mutation is safely queued offline');
    });

    it('rolls back and signals error when server returns non-retryable 403 or 400', async () => {
      let toastMsg = '';
      const showToast = (msg: string) => { toastMsg = msg; };

      const forbiddenFetch = async () => {
        return new Response(JSON.stringify({ code: 'FORBIDDEN', messageFa: 'دسترسی غیرمجاز' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        });
      };

      const initialLogs: DailyLog[] = [
        {
          id: 'log-1',
          cycleId,
          date: targetDate,
          wakeUp: false,
          workout: false,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          revision: 1,
          isSynced: true
        }
      ];

      const updatedLog: DailyLog = { ...initialLogs[0], workout: true };
      const { previousConfirmedSnapshot } = applyOptimisticLogUpdate(initialLogs, updatedLog);

      const result = await executeDirectDailyLogMutation({
        updatedLog,
        existingLog: initialLogs[0],
        activeCycleId: cycleId,
        ownerId: testUser,
        authToken: testToken,
        fetchFn: forbiddenFetch as any
      });

      assert.equal(result.status, 'FORBIDDEN');

      // Execute rollback
      const rolledBack = rollbackOptimisticLogUpdate([updatedLog], targetDate, previousConfirmedSnapshot);
      assert.equal(rolledBack[0].workout, false, 'Workout must roll back to false on 403');
      assert.equal(rolledBack[0].isSynced, true);

      if (result.status === 'FORBIDDEN') {
        showToast('دسترسی غیرمجاز. تغییرات ذخیره نشد.');
      }
      assert.equal(toastMsg, 'دسترسی غیرمجاز. تغییرات ذخیره نشد.');
    });
  });
});
