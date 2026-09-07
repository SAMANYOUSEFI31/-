import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  clearAllReplayLocks,
  enqueueOfflineMutation,
  replayAccountOfflineQueue,
  getOfflineQueue,
  saveOfflineQueue,
  getQuarantinedItems,
  clearQuarantine,
  recordClientConflict,
  getClientConflicts,
  clearClientConflicts,
  ALREADY_RECORDED,
  parseSafeConflictDetails,
  classifyReplayResponse
} from '../src/utils/offlineQueueUtils.js';
import {
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate,
  applyOptimisticCycleUpdate,
  rollbackOptimisticCycleUpdate,
  prepareDirectLogPayload,
  prepareDirectCyclePayload,
  verifyActiveAccount
} from '../src/utils/directMutationUtils.js';
import { reconcileBootState } from '../src/utils/syncReconciliation.js';
import { app } from '../server.js';
import { generateToken } from '../server/auth.js';
import {
  memoryStore,
  setPrismaState,
  createCycle,
  getCycleById,
  updateCycle,
  getUserCycles,
  upsertDailyLog,
  getUserDailyLogs,
  getDailyLogByDate,
  updateDailyLog,
  deleteDailyLog,
  deleteCycle,
  ConcurrencyConflictError,
  PreconditionRequiredError
} from '../server/db/index.js';

describe('Phase 6.2: Multi-Device Reliability and Convergence Hardening', () => {
  const storageMock: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => storageMock[key] ?? null,
    setItem: (key: string, val: string) => { storageMock[key] = String(val); },
    removeItem: (key: string) => { delete storageMock[key]; },
    clear: () => { for (const k in storageMock) delete storageMock[k]; },
    get length() { return Object.keys(storageMock).length; },
    key: (i: number) => Object.keys(storageMock)[i] ?? null
  };

  const userAlpha = 'usr_device_alpha_62';
  const userBeta = 'usr_device_beta_62';

  const tokenAlpha = generateToken({
    userId: userAlpha,
    phoneNumber: '09121112233',
    isVip: true,
    tier: 'VIP',
    isAdmin: false
  });

  const tokenBeta = generateToken({
    userId: userBeta,
    phoneNumber: '09124445566',
    isVip: true,
    tier: 'VIP',
    isAdmin: false
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
        id: userAlpha,
        phoneNumber: '09121112233',
        email: 'alpha@bushido.local',
        name: 'Alpha Device User',
        passwordHash: 'hashed_pwd_alpha',
        tier: 'vip',
        isVip: true,
        isAdmin: false,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: userBeta,
        phoneNumber: '09124445566',
        email: 'beta@bushido.local',
        name: 'Beta Device User',
        passwordHash: 'hashed_pwd_beta',
        tier: 'vip',
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

  // =========================================================================
  // SCENARIO 1: Concurrent DailyLog updates
  // =========================================================================
  it('Scenario 1: Concurrent DailyLog updates - First committer wins, second receives 409', async () => {
    const cycle = await createCycle(userAlpha, {
      title: 'Battlefield Cycle 1',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    // Create log with revision = 1
    const createRes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        cycleId: cycle.id,
        date: '2026-09-06',
        wakeUp: true,
        workout: false
      })
    });
    assert.equal(createRes.status, 200);
    const createdLog = (await createRes.json() as any).log;
    assert.equal(createdLog.revision, 1);

    // Device A sends update with expectedRevision = 1 -> succeeds, increments to 2
    const devARes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        cycleId: cycle.id,
        date: '2026-09-06',
        workout: true,
        expectedRevision: 1
      })
    });
    assert.equal(devARes.status, 200);
    const devALog = (await devARes.json() as any).log;
    assert.equal(devALog.revision, 2);
    assert.equal(devALog.workout, true);

    // Device B sends stale update with expectedRevision = 1 -> rejected with HTTP 409 Conflict
    const devBRes = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        cycleId: cycle.id,
        date: '2026-09-06',
        study: true,
        expectedRevision: 1
      })
    });
    assert.equal(devBRes.status, 409);
    const devBError = await devBRes.json() as any;
    assert.equal(devBError.code, 'CONFLICT');
    assert.equal(devBError.currentRevision, 2);
    assert.equal(devBError.expectedRevision, 1);

    // Device A's authoritative state is preserved intact
    const finalLog = await getDailyLogByDate(userAlpha, '2026-09-06');
    assert.equal(finalLog?.revision, 2);
    assert.equal(finalLog?.workout, true);
    assert.equal(finalLog?.study, false);
  });

  // =========================================================================
  // SCENARIO 2: Concurrent Cycle updates
  // =========================================================================
  it('Scenario 2: Concurrent Cycle updates - Stale overlapping updates cannot overwrite each other', async () => {
    const cycle = await createCycle(userAlpha, {
      title: 'Initial Cycle Title',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    assert.equal(cycle.revision, 1);

    // Device A updates title with expectedRevision = 1
    const updateARes = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        title: 'Title Updated By Device A',
        expectedRevision: 1
      })
    });
    assert.equal(updateARes.status, 200);
    const cycleA = (await updateARes.json() as any).cycle;
    assert.equal(cycleA.revision, 2);
    assert.equal(cycleA.title, 'Title Updated By Device A');

    // Device B sends stale update with expectedRevision = 1
    const updateBRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        title: 'Title Overwritten By Device B',
        expectedRevision: 1
      })
    });
    assert.equal(updateBRes.status, 409);

    // Authoritative cycle on server remains Device A's title with revision 2
    const currentCycle = await getCycleById(userAlpha, cycle.id);
    assert.equal(currentCycle?.revision, 2);
    assert.equal(currentCycle?.title, 'Title Updated By Device A');
  });

  // =========================================================================
  // SCENARIO 3: Offline versus online race
  // =========================================================================
  it('Scenario 3: Offline versus online race - Stale replay becomes controlled conflict rather than silent loss', async () => {
    const cycle = await createCycle(userAlpha, {
      title: 'Sync Race Cycle',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    const initialLog = await upsertDailyLog(userAlpha, {
      cycleId: cycle.id,
      date: '2026-09-06',
      wakeUp: true
    });
    assert.equal(initialLog.revision, 1);

    // Device A queues an offline mutation while at expectedRevision = 1
    enqueueOfflineMutation(userAlpha, {
      type: 'UPDATE_LOG',
      payload: {
        cycleId: cycle.id,
        date: '2026-09-06',
        hardTask: true
      },
      expectedRevision: 1
    });

    // Meanwhile, Device B updates the log online to revision 2
    await upsertDailyLog(userAlpha, {
      cycleId: cycle.id,
      date: '2026-09-06',
      workout: true
    }, 1);

    const remoteState = await getDailyLogByDate(userAlpha, '2026-09-06');
    assert.equal(remoteState?.revision, 2);
    assert.equal(remoteState?.workout, true);

    // Device A comes online and replays its queue against the server
    const replayResult = await replayAccountOfflineQueue({
      activeAccountId: userAlpha,
      authToken: tokenAlpha,
      fetchFn: (url: string | URL | Request, opts?: any) => fetch(`${baseUrl}${url}`, opts)
    });

    assert.equal(replayResult.failedCount, 1);
    assert.equal(replayResult.syncedCount, 0);
    assert.equal(replayResult.remainingQueueCount, 0);

    // The stale mutation was safely quarantined and recorded as a conflict, not silently lost
    const conflicts = getClientConflicts(userAlpha);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].statusCode, 409);
    assert.equal(conflicts[0].entityType, 'DAILY_LOG');
    assert.equal(conflicts[0].entityId, '2026-09-06');
    assert.equal(conflicts[0].currentRevision, 2);
    assert.equal(conflicts[0].expectedRevision, 1);

    // The remote server state was not overwritten
    const preservedLog = await getDailyLogByDate(userAlpha, '2026-09-06');
    assert.equal(preservedLog?.revision, 2);
    assert.equal(preservedLog?.workout, true);
    assert.equal(preservedLog?.hardTask, false);
  });

  // =========================================================================
  // SCENARIO 4: Duplicate delivery idempotency
  // =========================================================================
  it('Scenario 4: Duplicate delivery idempotency - Same clientOperationId delivered multiple times preserves authoritative result', async () => {
    const cycleOpId = 'op_cyc_dup_test_01';

    // 1. Initial CREATE_CYCLE delivery
    const res1 = await fetch(`${baseUrl}/api/cycles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        clientOperationId: cycleOpId,
        title: 'Idempotent Cycle',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      })
    });
    assert.equal(res1.status, 200);
    const body1 = await res1.json() as any;
    const cycleId = body1.cycle.id;
    assert.equal(body1.cycle.revision, 1);

    // 2. Duplicate CREATE_CYCLE delivery
    const res2 = await fetch(`${baseUrl}/api/cycles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        clientOperationId: cycleOpId,
        title: 'Idempotent Cycle',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      })
    });
    assert.equal(res2.status, 200);
    const body2 = await res2.json() as any;
    assert.equal(body2.cycle.id, cycleId);
    assert.equal(body2.cycle.revision, 1);

    // 3. DailyLog UPDATE with clientOperationId
    const logOpId = 'op_log_dup_test_01';
    const logRes1 = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        cycleId,
        date: '2026-09-07',
        study: true,
        clientOperationId: logOpId
      })
    });
    assert.equal(logRes1.status, 200);
    const logBody1 = await logRes1.json() as any;
    assert.equal(logBody1.log.revision, 1);

    // 4. Duplicate DailyLog delivery with same clientOperationId
    const logRes2 = await fetch(`${baseUrl}/api/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        cycleId,
        date: '2026-09-07',
        study: true,
        clientOperationId: logOpId
      })
    });
    assert.equal(logRes2.status, 200);
    const logBody2 = await logRes2.json() as any;
    assert.equal(logBody2.log.revision, 1, 'Duplicate delivery returns existing log without second increment');
  });

  // =========================================================================
  // SCENARIO 5: Out-of-order delivery
  // =========================================================================
  it('Scenario 5: Out-of-order delivery - Older mutation arriving after newer revision cannot overwrite', async () => {
    const cycle = await createCycle(userAlpha, {
      title: 'Reorder Test Cycle',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    // Revision advances to 2, then 3
    await updateCycle(userAlpha, cycle.id, { title: 'Revision 2 Title' }, 1);
    const rev3 = await updateCycle(userAlpha, cycle.id, { title: 'Revision 3 Title' }, 2);
    assert.equal(rev3?.revision, 3);

    // An out-of-order request carrying expectedRevision = 1 arrives
    const outOfOrderRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        title: 'Stale Revision 1 Overwrite Attempt',
        expectedRevision: 1
      })
    });
    assert.equal(outOfOrderRes.status, 409);

    const finalCycle = await getCycleById(userAlpha, cycle.id);
    assert.equal(finalCycle?.revision, 3);
    assert.equal(finalCycle?.title, 'Revision 3 Title');
  });

  // =========================================================================
  // SCENARIO 6: Conflict persistence & privacy redaction
  // =========================================================================
  it('Scenario 6: Conflict persistence - Records survive, scoped by owner, redacting secrets', () => {
    clearClientConflicts(userAlpha);

    const recorded = recordClientConflict(userAlpha, {
      mutationType: 'UPDATE_LOG',
      entityType: 'DAILY_LOG',
      entityId: '2026-09-08',
      conflictType: 'CONCURRENCY_CONFLICT',
      statusCode: 409,
      expectedRevision: 1,
      currentRevision: 3,
      messageFa: 'تعارض همزمانی در ثبت گزارش',
      clientPayload: {
        date: '2026-09-08',
        workout: true,
        token: 'ey_super_secret_jwt_token',
        password: 'cleartext_password_123',
        serverState: { internalConfig: 'confidential' }
      }
    });

    assert.notEqual(recorded, ALREADY_RECORDED);
    const conflicts = getClientConflicts(userAlpha);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].ownerId, userAlpha);
    assert.equal(conflicts[0].statusCode, 409);
    assert.equal(conflicts[0].expectedRevision, 1);
    assert.equal(conflicts[0].currentRevision, 3);

    // Verify redactions
    const payload = conflicts[0].clientPayload;
    assert.equal(payload.token, '[REDACTED]');
    assert.equal(payload.password, '[REDACTED]');
    assert.equal(payload.serverState, undefined);
  });

  // =========================================================================
  // SCENARIO 7: Conflict deduplication
  // =========================================================================
  it('Scenario 7: Conflict deduplication - Repeated recording of same conflict yields ALREADY_RECORDED', () => {
    clearClientConflicts(userAlpha);

    const conflictInput = {
      mutationType: 'UPDATE_CYCLE' as const,
      entityType: 'CYCLE',
      entityId: 'cyc_dedup_01',
      conflictType: 'CONCURRENCY_CONFLICT' as const,
      statusCode: 409 as const,
      expectedRevision: 2,
      currentRevision: 4,
      messageFa: 'تعارض چرخه'
    };

    const first = recordClientConflict(userAlpha, conflictInput);
    assert.notEqual(first, ALREADY_RECORDED);

    const second = recordClientConflict(userAlpha, conflictInput);
    assert.equal(second, ALREADY_RECORDED);

    const third = recordClientConflict(userAlpha, conflictInput);
    assert.equal(third, ALREADY_RECORDED);

    const list = getClientConflicts(userAlpha);
    assert.equal(list.length, 1, 'Conflict list must strictly contain only 1 record');
  });

  // =========================================================================
  // SCENARIO 8: Replay termination & loop prevention
  // =========================================================================
  it('Scenario 8: Replay termination - Non-retryable 409 conflict leaves active queue and enters quarantine', async () => {
    clearQuarantine(userAlpha);
    saveOfflineQueue(userAlpha, []);

    enqueueOfflineMutation(userAlpha, {
      type: 'UPDATE_LOG',
      payload: {
        date: '2026-09-09',
        workout: true
      },
      expectedRevision: 1
    });

    assert.equal(getOfflineQueue(userAlpha).length, 1);

    // Replay against a mock fetch returning 409
    const mockFetch = async () => ({
      status: 409,
      ok: false,
      json: async () => ({
        code: 'CONFLICT',
        messageFa: 'گزارش در دستگاه دیگر به‌روز شده است.',
        currentRevision: 4,
        expectedRevision: 1,
        entityType: 'DAILY_LOG',
        entityId: '2026-09-09'
      }),
      clone() { return this; }
    });

    const result = await replayAccountOfflineQueue({
      activeAccountId: userAlpha,
      authToken: tokenAlpha,
      fetchFn: mockFetch as any
    });

    assert.equal(result.failedCount, 1);
    assert.equal(result.remainingQueueCount, 0);

    // Active queue MUST be empty to prevent infinite replay loops
    assert.equal(getOfflineQueue(userAlpha).length, 0);

    // Quarantined items contain the item
    const quarantined = getQuarantinedItems(userAlpha);
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].items[0].classification, 'CONFLICT_DEFERRED');
  });

  // =========================================================================
  // SCENARIO 9: Account isolation under multi-device concurrency
  // =========================================================================
  it('Scenario 9: Account isolation - User Alpha operations cannot affect User Beta cycles, logs, or conflicts', async () => {
    clearClientConflicts(userAlpha);
    clearClientConflicts(userBeta);

    const cycleAlpha = await createCycle(userAlpha, {
      title: 'Alpha Private Cycle',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    // User Beta attempts to mutate User Alpha cycle
    const crossRes = await fetch(`${baseUrl}/api/cycles/${cycleAlpha.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenBeta}` },
      body: JSON.stringify({
        title: 'Hacked Title',
        expectedRevision: 1
      })
    });
    assert.equal(crossRes.status, 404, 'User Beta cannot find or mutate User Alpha cycle');

    // Record conflict for User Alpha
    recordClientConflict(userAlpha, {
      mutationType: 'UPDATE_CYCLE',
      entityType: 'CYCLE',
      entityId: cycleAlpha.id,
      statusCode: 409
    });

    // User Beta conflicts remain empty
    assert.equal(getClientConflicts(userBeta).length, 0);
    assert.equal(getClientConflicts(userAlpha).length, 1);
  });

  // =========================================================================
  // SCENARIO 10: Restart survivability & in-flight state recovery
  // =========================================================================
  it('Scenario 10: Restart survivability - Queue and conflict metadata recover after in-memory state reset', () => {
    clearClientConflicts(userAlpha);
    saveOfflineQueue(userAlpha, []);

    // 1. Enqueue item and record conflict
    enqueueOfflineMutation(userAlpha, {
      type: 'UPDATE_LOG',
      payload: { date: '2026-09-10', study: true },
      expectedRevision: 1
    });

    recordClientConflict(userAlpha, {
      mutationType: 'UPDATE_CYCLE',
      entityType: 'CYCLE',
      entityId: 'cycle_persist_01',
      statusCode: 409,
      expectedRevision: 1,
      currentRevision: 2
    });

    assert.equal(getOfflineQueue(userAlpha).length, 1);
    assert.equal(getClientConflicts(userAlpha).length, 1);

    // 2. Simulate runtime restart / clear in-flight memory locks
    clearAllReplayLocks();

    // 3. Re-read from storage
    const recoveredQueue = getOfflineQueue(userAlpha);
    assert.equal(recoveredQueue.length, 1);
    assert.equal(recoveredQueue[0].type, 'UPDATE_LOG');
    assert.equal(recoveredQueue[0].payload.date, '2026-09-10');

    const recoveredConflicts = getClientConflicts(userAlpha);
    assert.equal(recoveredConflicts.length, 1);
    assert.equal(recoveredConflicts[0].entityId, 'cycle_persist_01');
    assert.equal(recoveredConflicts[0].currentRevision, 2);
  });

  // =========================================================================
  // SCENARIO 11: Server authority enforcement
  // =========================================================================
  it('Scenario 11: Server authority - Client cannot forge revision or elevate privileges in profile', async () => {
    // Attempt to update profile with elevation fields
    const profileRes = await fetch(`${baseUrl}/api/auth/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
      body: JSON.stringify({
        name: 'Honest Warrior',
        isAdmin: true,
        isVip: true,
        tier: 'SUPER_ADMIN_CUSTOM'
      })
    });
    assert.equal(profileRes.status, 200);
    const updatedUser = (await profileRes.json() as any).user;
    assert.equal(updatedUser.name, 'Honest Warrior');
    assert.equal(updatedUser.isAdmin, false, 'Server authority strips client isAdmin elevation');
    assert.equal(updatedUser.tier, 'vip', 'Server authority preserves authoritative tier');
  });

  // =========================================================================
  // SCENARIO 12: Client convergence
  // =========================================================================
  it('Scenario 12: Client convergence - Reconcile boot state cleanly synchronizes client with authoritative server state', () => {
    const remoteCycles = [
      {
        id: 'cycle_conv_1',
        userId: userAlpha,
        title: 'Server Confirmed Cycle',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        targetTheme: 'انضباط',
        isSynced: true,
        revision: 3
      }
    ];

    const remoteLogs = [
      {
        id: 'log_conv_1',
        userId: userAlpha,
        cycleId: 'cycle_conv_1',
        date: '2026-09-05',
        habits: { wakeUp: true },
        isSynced: true,
        revision: 2
      }
    ];

    // Client has an optimistic pending mutation for a different date
    const pendingQueue = [
      {
        id: 'mut_pending_1',
        ownerId: userAlpha,
        type: 'UPDATE_LOG' as const,
        payload: {
          cycleId: 'cycle_conv_1',
          date: '2026-09-06',
          study: true
        },
        expectedRevision: 1,
        timestamp: Date.now()
      }
    ];

    const reconciled = reconcileBootState({
      authenticatedOwnerId: userAlpha,
      remoteCycles: remoteCycles as any,
      remoteLogs: remoteLogs as any,
      remoteUserProfile: { name: 'Alpha User', tier: 'vip' as const },
      currentLocalState: {
        cycles: [],
        logs: []
      },
      pendingQueue,
      isDemoConsumed: true
    });

    // 1. Remote confirmed cycle is retained
    assert.equal(reconciled.cycles?.length, 1);
    assert.equal(reconciled.cycles?.[0].id, 'cycle_conv_1');
    assert.equal(reconciled.cycles?.[0].isSynced, true);

    // 2. Both remote confirmed log and pending local log are converged
    assert.equal(reconciled.logs?.length, 2);

    const confirmedLog = reconciled.logs?.find(l => l.date === '2026-09-05');
    assert.ok(confirmedLog);
    assert.equal(confirmedLog?.isSynced, true, 'Server-confirmed log retains isSynced: true');

    const pendingLog = reconciled.logs?.find(l => l.date === '2026-09-06');
    assert.ok(pendingLog);
    assert.equal(pendingLog?.isSynced, false, 'Pending mutation overlay retains isSynced: false');
    assert.equal(pendingLog?.study, true);
  });
});
