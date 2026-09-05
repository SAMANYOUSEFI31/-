import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  reconcileBootState,
  ReconcileBootStateInput,
  assertReconciliationInvariant
} from '../src/utils/syncReconciliation.js';
import { Cycle, DailyLog, UserProfile, OfflineQueueItem } from '../src/types.js';

function createSampleCycle(overrides: Partial<Cycle> = {}): Cycle {
  return {
    id: 'cycle-1',
    title: 'Bushido Master Cycle',
    status: 'ACTIVE',
    startDate: '1403-01-01',
    endDate: '1403-02-01',
    targetDays: 30,
    habitGoals: [{ key: 'prayer', targetCount: 30, titleFa: 'نماز اول وقت' }],
    isSynced: true,
    ...overrides
  };
}

function createSampleLog(overrides: Partial<DailyLog> = {}): DailyLog {
  return {
    date: '1403-01-01',
    completedHabitIds: ['prayer'],
    cycleId: 'cycle-1',
    isSynced: true,
    ...overrides
  };
}

function createSampleProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'user-alpha',
    name: 'Samurai Alpha',
    tier: 'free',
    isVip: false,
    isAdmin: false,
    activeCycleLimit: 1,
    accentTheme: 'amber',
    nightOwlCutoffHour: 4,
    ...overrides
  };
}

describe('Phase 3C.2: Safe Boot Reconciliation with Pending Offline Mutations', () => {
  describe('1. Individual Mutation Reconciliations', () => {
    it('(a) Remote log plus pending UPDATE_LOG overlays pending fields onto matching remote log with isSynced=false', () => {
      const serverLog = createSampleLog({
        date: '1403-01-01',
        completedHabitIds: ['prayer'],
        note: 'Server old note',
        isSynced: true
      });
      const pendingLogMutation: OfflineQueueItem = {
        id: 'mut-log-1',
        ownerId: 'user-alpha',
        type: 'UPDATE_LOG',
        payload: {
          date: '1403-01-01',
          cycleId: 'cycle-1',
          completedHabitIds: ['prayer', 'quran', 'exercise'],
          note: 'Optimistic new note'
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [createSampleCycle({ id: 'cycle-1' })],
        remoteLogs: [serverLog],
        currentLocalState: {
          cycles: [createSampleCycle({ id: 'cycle-1' })],
          logs: [serverLog]
        },
        pendingQueue: [pendingLogMutation],
        isDemoConsumed: true
      });

      assert.ok(result.logs !== null);
      assert.equal(result.logs.length, 1);
      const reconciled = result.logs[0];
      assert.equal(reconciled.date, '1403-01-01');
      assert.deepEqual(reconciled.completedHabitIds, ['prayer', 'quran', 'exercise']);
      assert.equal(reconciled.note, 'Optimistic new note');
      assert.equal(reconciled.isSynced, false, 'Pending updated log must remain isSynced=false');
    });

    it('(b) Missing remote log plus pending UPDATE_LOG appends the pending log with isSynced=false', () => {
      const pendingLogMutation: OfflineQueueItem = {
        id: 'mut-log-2',
        ownerId: 'user-alpha',
        type: 'UPDATE_LOG',
        payload: {
          date: '1403-01-02',
          cycleId: 'cycle-1',
          completedHabitIds: ['fasting'],
          note: 'Created offline during disconnection'
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [createSampleCycle({ id: 'cycle-1' })],
        remoteLogs: [], // server snapshot has no logs yet
        currentLocalState: {
          cycles: [createSampleCycle({ id: 'cycle-1' })],
          logs: []
        },
        pendingQueue: [pendingLogMutation],
        isDemoConsumed: true
      });

      assert.ok(result.logs !== null);
      assert.equal(result.logs.length, 1);
      assert.equal(result.logs[0].date, '1403-01-02');
      assert.deepEqual(result.logs[0].completedHabitIds, ['fasting']);
      assert.equal(result.logs[0].isSynced, false);
    });

    it('(c) Missing remote cycle plus pending CREATE_CYCLE retains client-created cycle with isSynced=false', () => {
      const pendingCreateMutation: OfflineQueueItem = {
        id: 'mut-create-1',
        ownerId: 'user-alpha',
        type: 'CREATE_CYCLE',
        payload: {
          id: 'client-cycle-999',
          title: 'Offline Created Cycle',
          status: 'ACTIVE',
          startDate: '1403-02-01',
          endDate: '1403-03-01',
          targetDays: 30,
          habitGoals: []
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [], // server empty
        remoteLogs: [],
        currentLocalState: {
          cycles: [],
          logs: []
        },
        pendingQueue: [pendingCreateMutation],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'client-cycle-999');
      assert.equal(result.cycles[0].title, 'Offline Created Cycle');
      assert.equal(result.cycles[0].isSynced, false);
      assert.equal(result.shouldMarkDemoConsumed, true);
      assert.equal(result.nextActiveCycleId, 'client-cycle-999');
    });

    it('(d) Remote cycle plus pending CREATE_CYCLE with the same stable ID avoids duplicates and preserves isSynced=false', () => {
      const serverCycle = createSampleCycle({
        id: 'stable-cycle-1',
        title: 'Server Title',
        isSynced: true
      });
      const pendingCreateMutation: OfflineQueueItem = {
        id: 'mut-create-2',
        ownerId: 'user-alpha',
        type: 'CREATE_CYCLE',
        payload: {
          id: 'stable-cycle-1',
          title: 'Client Updated Creation',
          status: 'ACTIVE',
          startDate: '1403-01-01',
          endDate: '1403-02-01',
          targetDays: 30,
          habitGoals: []
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [serverCycle],
        remoteLogs: [],
        currentLocalState: {
          cycles: [serverCycle],
          logs: []
        },
        pendingQueue: [pendingCreateMutation],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.equal(result.cycles.length, 1, 'Must not duplicate cycle with same stable ID');
      assert.equal(result.cycles[0].id, 'stable-cycle-1');
      assert.equal(result.cycles[0].title, 'Client Updated Creation');
      assert.equal(result.cycles[0].isSynced, false);
    });

    it('(e) Remote cycle plus pending UPDATE_CYCLE overlays updated fields onto remote cycle with isSynced=false', () => {
      const serverCycle = createSampleCycle({
        id: 'cycle-1',
        title: 'Original Server Title',
        rules: ['Rule 1'],
        isSynced: true
      });
      const pendingUpdateMutation: OfflineQueueItem = {
        id: 'mut-update-cycle-1',
        ownerId: 'user-alpha',
        type: 'UPDATE_CYCLE',
        payload: {
          id: 'cycle-1',
          title: 'Modified Title in Disconnection',
          rules: ['Rule 1', 'Rule 2']
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [serverCycle],
        remoteLogs: [],
        currentLocalState: {
          cycles: [serverCycle],
          logs: []
        },
        pendingQueue: [pendingUpdateMutation],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'cycle-1');
      assert.equal(result.cycles[0].title, 'Modified Title in Disconnection');
      assert.deepEqual(result.cycles[0].rules, ['Rule 1', 'Rule 2']);
      assert.equal(result.cycles[0].isSynced, false);
    });

    it('(f) Remote cycle plus pending DELETE_CYCLE removes the cycle from visible reconciled state', () => {
      const serverCycle1 = createSampleCycle({ id: 'cycle-keep', title: 'Keep Me' });
      const serverCycle2 = createSampleCycle({ id: 'cycle-delete', title: 'Delete Me' });

      const pendingDeleteMutation: OfflineQueueItem = {
        id: 'mut-del-1',
        ownerId: 'user-alpha',
        type: 'DELETE_CYCLE',
        payload: { id: 'cycle-delete' },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [serverCycle1, serverCycle2],
        remoteLogs: [],
        currentLocalState: {
          cycles: [serverCycle1, serverCycle2],
          logs: []
        },
        pendingQueue: [pendingDeleteMutation],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'cycle-keep');
      assert.equal(result.nextActiveCycleId, 'cycle-keep');
    });

    it('(g) Pending DELETE_CYCLE suppresses associated remote logs from visible reconciled state', () => {
      const serverCycle = createSampleCycle({ id: 'cycle-delete', title: 'Delete Me' });
      const serverLog1 = createSampleLog({ date: '1403-01-01', cycleId: 'cycle-delete' });
      const serverLog2 = createSampleLog({ date: '1403-01-02', cycleId: 'cycle-delete' });
      const otherLog = createSampleLog({ date: '1403-01-03', cycleId: 'other-cycle' });

      const pendingDeleteMutation: OfflineQueueItem = {
        id: 'mut-del-logs',
        ownerId: 'user-alpha',
        type: 'DELETE_CYCLE',
        payload: { id: 'cycle-delete' },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [serverCycle, createSampleCycle({ id: 'other-cycle' })],
        remoteLogs: [serverLog1, serverLog2, otherLog],
        currentLocalState: {
          cycles: [serverCycle, createSampleCycle({ id: 'other-cycle' })],
          logs: [serverLog1, serverLog2, otherLog]
        },
        pendingQueue: [pendingDeleteMutation],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.ok(result.logs !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'other-cycle');
      assert.equal(result.logs.length, 1);
      assert.equal(result.logs[0].cycleId, 'other-cycle');
    });
  });

  describe('2. Mutation Sequences & Dependency Order', () => {
    it('(h) CREATE_CYCLE followed by UPDATE_CYCLE applies in sequence and produces updated pending cycle', () => {
      const queue: OfflineQueueItem[] = [
        {
          id: 'mut-seq-1',
          ownerId: 'user-alpha',
          type: 'CREATE_CYCLE',
          payload: {
            id: 'seq-cycle-1',
            title: 'Initial Title',
            status: 'ACTIVE',
            startDate: '1403-01-01',
            endDate: '1403-02-01',
            targetDays: 30,
            habitGoals: []
          },
          timestamp: 1000
        },
        {
          id: 'mut-seq-2',
          ownerId: 'user-alpha',
          type: 'UPDATE_CYCLE',
          payload: {
            id: 'seq-cycle-1',
            title: 'Updated After Creation'
          },
          timestamp: 2000
        }
      ];

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        currentLocalState: { cycles: [], logs: [] },
        pendingQueue: queue,
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'seq-cycle-1');
      assert.equal(result.cycles[0].title, 'Updated After Creation');
      assert.equal(result.cycles[0].isSynced, false);
    });

    it('(i) CREATE_CYCLE followed by UPDATE_LOG retains both created cycle and new log as isSynced=false', () => {
      const queue: OfflineQueueItem[] = [
        {
          id: 'mut-seq-c1',
          ownerId: 'user-alpha',
          type: 'CREATE_CYCLE',
          payload: {
            id: 'seq-cycle-2',
            title: 'Sequential Cycle',
            status: 'ACTIVE',
            startDate: '1403-01-01',
            endDate: '1403-02-01',
            targetDays: 30,
            habitGoals: []
          },
          timestamp: 1000
        },
        {
          id: 'mut-seq-l1',
          ownerId: 'user-alpha',
          type: 'UPDATE_LOG',
          payload: {
            date: '1403-01-01',
            cycleId: 'seq-cycle-2',
            completedHabitIds: ['prayer'],
            note: 'First day log'
          },
          timestamp: 2000
        }
      ];

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        currentLocalState: { cycles: [], logs: [] },
        pendingQueue: queue,
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.ok(result.logs !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'seq-cycle-2');
      assert.equal(result.cycles[0].isSynced, false);
      assert.equal(result.logs.length, 1);
      assert.equal(result.logs[0].cycleId, 'seq-cycle-2');
      assert.equal(result.logs[0].isSynced, false);
    });

    it('(j) UPDATE_CYCLE followed by DELETE_CYCLE cleanly suppresses the cycle and any associated logs', () => {
      const serverCycle = createSampleCycle({ id: 'doomed-cycle', title: 'Server Title' });
      const serverLog = createSampleLog({ date: '1403-01-01', cycleId: 'doomed-cycle' });

      const queue: OfflineQueueItem[] = [
        {
          id: 'mut-up-doomed',
          ownerId: 'user-alpha',
          type: 'UPDATE_CYCLE',
          payload: { id: 'doomed-cycle', title: 'Modified Before Deletion' },
          timestamp: 1000
        },
        {
          id: 'mut-del-doomed',
          ownerId: 'user-alpha',
          type: 'DELETE_CYCLE',
          payload: { id: 'doomed-cycle' },
          timestamp: 2000
        }
      ];

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [serverCycle],
        remoteLogs: [serverLog],
        currentLocalState: { cycles: [serverCycle], logs: [serverLog] },
        pendingQueue: queue,
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.ok(result.logs !== null);
      assert.equal(result.cycles.length, 0, 'Cycle must be deleted from reconciled state');
      assert.equal(result.logs.length, 0, 'Associated logs must be suppressed');
    });
  });

  describe('3. Profile Reconciliation & Privilege Immunity', () => {
    it('(k) Pending UPDATE_PROFILE preserves ordinary user fields (name, accentTheme) but cannot elevate isAdmin, isVip, tier, or payment fields', () => {
      const serverProfile = createSampleProfile({
        id: 'user-alpha',
        name: 'Original Server Name',
        tier: 'free',
        isVip: false,
        isAdmin: false,
        activeCycleLimit: 1,
        accentTheme: 'amber'
      });

      const maliciousOrStaleQueueItem: OfflineQueueItem = {
        id: 'mut-prof-1',
        ownerId: 'user-alpha',
        type: 'UPDATE_PROFILE',
        payload: {
          name: 'Updated Local Name',
          accentTheme: 'emerald',
          nightOwlCutoffHour: 5,
          // Privileged and server-authoritative fields attempting escalation
          isAdmin: true,
          isVip: true,
          tier: 'vip_samurai',
          activeCycleLimit: 999,
          paymentRefId: 'fake-payment-ref',
          vipSince: '2026-01-01',
          vipExpiresAt: '2099-01-01'
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        remoteUserProfile: serverProfile,
        currentLocalState: {
          cycles: [],
          logs: [],
          userProfile: serverProfile
        },
        pendingQueue: [maliciousOrStaleQueueItem],
        isDemoConsumed: true
      });

      assert.ok(result.userProfile !== null);
      // Allowed user-customizable fields are updated
      assert.equal(result.userProfile.name, 'Updated Local Name');
      assert.equal(result.userProfile.accentTheme, 'emerald');
      assert.equal(result.userProfile.nightOwlCutoffHour, 5);

      // Privileged fields MUST remain strictly server-authoritative
      assert.equal(result.userProfile.isAdmin, false, 'isAdmin cannot be elevated by pending mutation');
      assert.equal(result.userProfile.isVip, false, 'isVip cannot be elevated by pending mutation');
      assert.equal(result.userProfile.tier, 'free', 'tier cannot be elevated by pending mutation');
      assert.equal(result.userProfile.activeCycleLimit, 1, 'activeCycleLimit cannot be elevated by pending mutation');
      assert.equal(result.userProfile.paymentRefId, undefined);
      assert.equal(result.userProfile.vipSince, undefined);
      assert.equal(result.userProfile.vipExpiresAt, undefined);
    });
  });

  describe('4. Owner Isolation & Boundary Integrity', () => {
    it('(l) User A pending queue cannot affect User B reconciliation', () => {
      const userBCycle = createSampleCycle({ id: 'user-b-cycle', title: 'User B Cycle' });
      const userAQueueItem: OfflineQueueItem = {
        id: 'mut-user-a',
        ownerId: 'user-a',
        type: 'CREATE_CYCLE',
        payload: {
          id: 'user-a-leaked-cycle',
          title: 'User A Secret Cycle',
          status: 'ACTIVE',
          startDate: '1403-01-01',
          endDate: '1403-02-01',
          targetDays: 30,
          habitGoals: []
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-b',
        remoteCycles: [userBCycle],
        remoteLogs: [],
        currentLocalState: {
          cycles: [userBCycle],
          logs: []
        },
        pendingQueue: [userAQueueItem],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'user-b-cycle');
      assert.ok(!result.cycles.some(c => c.id === 'user-a-leaked-cycle'), 'User A mutation must NOT leak into User B state');
    });

    it('(m) Guest mutations cannot affect authenticated user reconciliation', () => {
      const authCycle = createSampleCycle({ id: 'auth-cycle', title: 'Auth Cycle' });
      const guestQueueItem: OfflineQueueItem = {
        id: 'mut-guest',
        ownerId: 'guest',
        type: 'CREATE_CYCLE',
        payload: {
          id: 'guest-cycle',
          title: 'Guest Temporary Cycle',
          status: 'ACTIVE',
          startDate: '1403-01-01',
          endDate: '1403-02-01',
          targetDays: 30,
          habitGoals: []
        },
        timestamp: Date.now()
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [authCycle],
        remoteLogs: [],
        currentLocalState: {
          cycles: [authCycle],
          logs: []
        },
        pendingQueue: [guestQueueItem],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      assert.equal(result.cycles.length, 1);
      assert.equal(result.cycles[0].id, 'auth-cycle');
      assert.ok(!result.cycles.some(c => c.id === 'guest-cycle'), 'Guest mutation must NOT enter authenticated user state');
    });
  });

  describe('5. Purity, Idempotency & Demo State Invariants', () => {
    it('(n) Repeated reconciliation with identical inputs is idempotent and produces deep-equal output', () => {
      const input: ReconcileBootStateInput = {
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [createSampleCycle({ id: 'c1', title: 'Server C1' })],
        remoteLogs: [createSampleLog({ date: '1403-01-01', cycleId: 'c1' })],
        remoteUserProfile: createSampleProfile({ id: 'user-alpha', name: 'Server Name' }),
        currentLocalState: {
          cycles: [createSampleCycle({ id: 'c1', title: 'Server C1' })],
          logs: [createSampleLog({ date: '1403-01-01', cycleId: 'c1' })],
          userProfile: createSampleProfile({ id: 'user-alpha', name: 'Server Name' })
        },
        pendingQueue: [
          {
            id: 'm1',
            ownerId: 'user-alpha',
            type: 'UPDATE_CYCLE',
            payload: { id: 'c1', title: 'Pending C1' },
            timestamp: 1000
          },
          {
            id: 'm2',
            ownerId: 'user-alpha',
            type: 'UPDATE_LOG',
            payload: { date: '1403-01-01', cycleId: 'c1', note: 'Pending Note' },
            timestamp: 2000
          }
        ],
        isDemoConsumed: true
      };

      const run1 = reconcileBootState(input);
      const run2 = reconcileBootState(input);
      const run3 = reconcileBootState(input);

      assert.deepEqual(run1, run2, 'Run 1 and Run 2 must be deeply equal');
      assert.deepEqual(run2, run3, 'Run 2 and Run 3 must be deeply equal');
    });

    it('(o) Pending items remain isSynced=false while untouched server items retain confirmed state', () => {
      const untouchedServerCycle = createSampleCycle({ id: 'c-server', isSynced: true });
      const modifiedServerCycle = createSampleCycle({ id: 'c-mod', isSynced: true });

      const pendingUpdate: OfflineQueueItem = {
        id: 'm-up',
        ownerId: 'user-alpha',
        type: 'UPDATE_CYCLE',
        payload: { id: 'c-mod', title: 'Modified' },
        timestamp: 1000
      };

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [untouchedServerCycle, modifiedServerCycle],
        remoteLogs: [],
        currentLocalState: { cycles: [untouchedServerCycle, modifiedServerCycle], logs: [] },
        pendingQueue: [pendingUpdate],
        isDemoConsumed: true
      });

      assert.ok(result.cycles !== null);
      const untouched = result.cycles.find(c => c.id === 'c-server');
      const modified = result.cycles.find(c => c.id === 'c-mod');

      assert.equal(untouched?.isSynced, true, 'Untouched server cycle retains isSynced=true');
      assert.equal(modified?.isSynced, false, 'Pending modified cycle is marked isSynced=false');
    });

    it('(p) Queue contents and local state inputs are not mutated by reconciliation', () => {
      const originalQueue: OfflineQueueItem[] = [
        {
          id: 'm-immutable',
          ownerId: 'user-alpha',
          type: 'CREATE_CYCLE',
          payload: { id: 'c-new', title: 'New Cycle' },
          timestamp: 1000
        }
      ];
      const queueSnapshot = JSON.stringify(originalQueue);

      const localCycles = [createSampleCycle({ id: 'c-orig' })];
      const localCyclesSnapshot = JSON.stringify(localCycles);

      reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        currentLocalState: { cycles: localCycles, logs: [] },
        pendingQueue: originalQueue,
        isDemoConsumed: true
      });

      assert.equal(JSON.stringify(originalQueue), queueSnapshot, 'pendingQueue array and objects must remain untouched');
      assert.equal(JSON.stringify(localCycles), localCyclesSnapshot, 'currentLocalState must remain untouched');
    });

    it('(q) Empty server response preserves or clears demo state according to existing demo-consumed rules', () => {
      const demoCycles = [createSampleCycle({ id: 'demo-cycle-1', title: 'چک‌پوینت مقدماتی' })];
      const demoLogs = [createSampleLog({ date: '1403-01-01', cycleId: 'demo-cycle-1' })];

      // 1. Unconsumed demo + empty server API => Preserves local demo state (cycles/logs null in decision, kept from local)
      const unconsumedResult = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        currentLocalState: { cycles: demoCycles, logs: demoLogs },
        pendingQueue: [],
        isDemoConsumed: false
      });

      assert.deepEqual(unconsumedResult.cycles, demoCycles, 'Preserves demo cycles when isDemoConsumed=false');
      assert.deepEqual(unconsumedResult.logs, demoLogs, 'Preserves demo logs when isDemoConsumed=false');
      assert.equal(unconsumedResult.shouldMarkDemoConsumed, false);

      // 2. Consumed demo + empty server API => Empty arrays (never resurrects demo)
      const consumedResult = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        currentLocalState: { cycles: demoCycles, logs: demoLogs },
        pendingQueue: [],
        isDemoConsumed: true
      });

      assert.deepEqual(consumedResult.cycles, [], 'Clears demo cycles when isDemoConsumed=true');
      assert.deepEqual(consumedResult.logs, [], 'Clears demo logs when isDemoConsumed=true');
    });
  });

  describe('6. Production App Wiring & Source Contract Invariants', () => {
    it('App.tsx loads active owner queue, reconciles boot state, revalidates active account, and routes replay through SyncOrchestrator', () => {
      const appContent = fs.readFileSync('src/App.tsx', 'utf-8');

      // 1. App.tsx imports and calls reconcileBootState
      assert.ok(
        appContent.includes('reconcileBootState'),
        'App.tsx must import and invoke reconcileBootState'
      );

      // 2. App.tsx loads only the active owner offline queue
      assert.ok(
        appContent.includes('getOfflineQueue('),
        'App.tsx must load offline queue via getOfflineQueue for active owner'
      );

      // 3. Revalidates active ownership before committing state
      assert.ok(
        appContent.includes('currentActiveOwner !== normalizeQueueOwner(activeUserId)'),
        'App.tsx must revalidate active ownership before committing state'
      );

      // 4. Commits reconciled cycles and logs
      assert.ok(
        appContent.includes('reconciledCycles') && appContent.includes('reconciledLogs'),
        'App.tsx must commit reconciled cycles and logs'
      );

      // 5. Replay starts after verified auth identity via bindBootAuthAndRequestSync
      assert.ok(
        appContent.includes('bindBootAuthAndRequestSync'),
        'App.tsx routes boot replay through bindBootAuthAndRequestSync'
      );

      // 6. Direct replayAccountOfflineQueue invocation is NOT present in executable code
      const strippedApp = appContent.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      assert.equal(
        strippedApp.match(/\breplayAccountOfflineQueue\s*\(/),
        null,
        'App.tsx must not directly call replayAccountOfflineQueue'
      );
    });
  });

  describe('7. Reconciliation Invariant Assertions & Diagnostics Validation', () => {
    it('(r) reconcileBootState executes all invariant checks and does not emit warnings on valid input', () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        const result = reconcileBootState({
          authenticatedOwnerId: 'user-alpha',
          remoteCycles: [createSampleCycle({ id: 'c1' })],
          remoteLogs: [createSampleLog({ date: '1403-01-01', cycleId: 'c1' })],
          currentLocalState: {
            cycles: [createSampleCycle({ id: 'c1' })],
            logs: [createSampleLog({ date: '1403-01-01', cycleId: 'c1' })]
          },
          pendingQueue: [
            {
              id: 'm1',
              ownerId: 'user-alpha',
              type: 'UPDATE_LOG',
              payload: { date: '1403-01-01', cycleId: 'c1', note: 'Reconciled note' },
              timestamp: 1000
            }
          ],
          isDemoConsumed: true
        });

        assert.ok(result.logs !== null);
        assert.equal(result.logs[0].isSynced, false);
        const invariantWarnings = warnings.filter(w => w.includes('[ReconciliationInvariantViolation]'));
        assert.equal(invariantWarnings.length, 0, 'Valid reconciliation must not produce any invariant violations');
      } finally {
        console.warn = originalWarn;
      }
    });

    it('(s) assertReconciliationInvariant emits sanitized diagnostic in development and suppresses in production', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        // Development mode: invariant failure emits sanitized warning
        process.env.NODE_ENV = 'development';
        warnings.length = 0;
        
        assertReconciliationInvariant(true, 'Test passed invariant');
        assert.equal(warnings.length, 0);

        assertReconciliationInvariant(false, 'Test failed invariant');
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0], '[ReconciliationInvariantViolation] Test failed invariant');

        // Verify diagnostic contains no sensitive payload, tokens, or stack trace
        assert.ok(!warnings[0].includes('Bearer'));
        assert.ok(!warnings[0].includes('token'));
        assert.ok(!warnings[0].includes('password'));
        assert.ok(!warnings[0].includes('Error:'));

        // Production mode: invariant failure is strictly silenced
        process.env.NODE_ENV = 'production';
        warnings.length = 0;
        assertReconciliationInvariant(false, 'Production test failure');
        assert.equal(warnings.length, 0, 'Production mode must not emit invariant warning');
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('(t) assertReconciliationInvariant does not require a global process object and executes safely', () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };
      const originalProcess = (globalThis as any).process;

      try {
        // Simulate browser environment where global process is completely undefined
        (globalThis as any).process = undefined;

        assert.doesNotThrow(() => {
          assertReconciliationInvariant(true, 'Should not throw when true');
          assertReconciliationInvariant(false, 'Should not throw when false without process');
        });
      } finally {
        (globalThis as any).process = originalProcess;
        console.warn = originalWarn;
      }
    });

    it('(u) non-vacuous pending cycle check validates expected pending cycles exist and retain isSynced: false', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';

        // Valid pending CREATE_CYCLE creates cycle and asserts isSynced: false without warnings
        const result = reconcileBootState({
          authenticatedOwnerId: 'user-alpha',
          remoteCycles: [],
          remoteLogs: [],
          currentLocalState: { cycles: [], logs: [] },
          pendingQueue: [
            {
              id: 'm-create-1',
              ownerId: 'user-alpha',
              type: 'CREATE_CYCLE',
              payload: { id: 'c-new', title: 'New Cycle', status: 'ACTIVE' },
              timestamp: 1000
            }
          ],
          isDemoConsumed: true
        });

        assert.equal(result.cycles?.length, 1);
        assert.equal(result.cycles?.[0]?.id, 'c-new');
        assert.equal(result.cycles?.[0]?.isSynced, false);
        const invariantWarnings = warnings.filter(w => w.includes('[ReconciliationInvariantViolation]'));
        assert.equal(invariantWarnings.length, 0, 'Expected pending cycle was created with isSynced: false and produced 0 warnings');
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('(v) non-vacuous pending log check validates expected pending logs exist and retain isSynced: false', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';

        const result = reconcileBootState({
          authenticatedOwnerId: 'user-alpha',
          remoteCycles: [createSampleCycle({ id: 'c-alpha' })],
          remoteLogs: [createSampleLog({ date: '1403-01-01', cycleId: 'c-alpha', isSynced: true })],
          currentLocalState: {
            cycles: [createSampleCycle({ id: 'c-alpha' })],
            logs: [createSampleLog({ date: '1403-01-01', cycleId: 'c-alpha', isSynced: true })]
          },
          pendingQueue: [
            {
              id: 'm-update-log',
              ownerId: 'user-alpha',
              type: 'UPDATE_LOG',
              payload: { date: '1403-01-01', cycleId: 'c-alpha', note: 'Updated note' },
              timestamp: 1000
            }
          ],
          isDemoConsumed: true
        });

        assert.equal(result.logs?.length, 1);
        assert.equal(result.logs?.[0]?.note, 'Updated note');
        assert.equal(result.logs?.[0]?.isSynced, false);
        const invariantWarnings = warnings.filter(w => w.includes('[ReconciliationInvariantViolation]'));
        assert.equal(invariantWarnings.length, 0, 'Expected pending log was overlaid with isSynced: false and produced 0 warnings');
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('(w) same-date logs belonging to different cycles are identified using cycleId-plus-date identity', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';

        // Two cycles: c1 and c2, both having a log on date '1403-01-01'
        const c1 = createSampleCycle({ id: 'c1', title: 'Cycle 1' });
        const c2 = createSampleCycle({ id: 'c2', title: 'Cycle 2' });
        const logC1 = createSampleLog({ date: '1403-01-01', cycleId: 'c1', note: 'Log Cycle 1', isSynced: true });
        const logC2 = createSampleLog({ date: '1403-01-01', cycleId: 'c2', note: 'Log Cycle 2', isSynced: true });

        const result = reconcileBootState({
          authenticatedOwnerId: 'user-alpha',
          remoteCycles: [c1, c2],
          remoteLogs: [logC1, logC2],
          currentLocalState: {
            cycles: [c1, c2],
            logs: [logC1, logC2]
          },
          pendingQueue: [
            {
              id: 'm-log-c2',
              ownerId: 'user-alpha',
              type: 'UPDATE_LOG',
              payload: { date: '1403-01-01', cycleId: 'c2', note: 'Updated Log Cycle 2' },
              timestamp: 1000
            }
          ],
          isDemoConsumed: true
        });

        assert.equal(result.logs?.length, 2);
        const reconciledLogC1 = result.logs?.find(l => l.cycleId === 'c1' && l.date === '1403-01-01');
        const reconciledLogC2 = result.logs?.find(l => l.cycleId === 'c2' && l.date === '1403-01-01');

        assert.ok(reconciledLogC1);
        assert.ok(reconciledLogC2);

        // logC1 must remain confirmed (isSynced: true)
        assert.equal(reconciledLogC1?.note, 'Log Cycle 1');
        assert.equal(reconciledLogC1?.isSynced, true);

        // logC2 must be updated (isSynced: false)
        assert.equal(reconciledLogC2?.note, 'Updated Log Cycle 2');
        assert.equal(reconciledLogC2?.isSynced, false);

        const invariantWarnings = warnings.filter(w => w.includes('[ReconciliationInvariantViolation]'));
        assert.equal(invariantWarnings.length, 0, 'No invariant warnings emitted for multi-cycle same-date logs');
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('(x) legitimately suppressed mutations (deleted cycles, orphaned logs, malformed mutations) produce zero false warnings', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';

        const result = reconcileBootState({
          authenticatedOwnerId: 'user-alpha',
          remoteCycles: [createSampleCycle({ id: 'c-to-delete' })],
          remoteLogs: [createSampleLog({ date: '1403-01-01', cycleId: 'c-to-delete' })],
          currentLocalState: {
            cycles: [createSampleCycle({ id: 'c-to-delete' })],
            logs: [createSampleLog({ date: '1403-01-01', cycleId: 'c-to-delete' })]
          },
          pendingQueue: [
            // 1. Pending CREATE followed by DELETE
            {
              id: 'm-temp-create',
              ownerId: 'user-alpha',
              type: 'CREATE_CYCLE',
              payload: { id: 'c-temp', title: 'Temporary Cycle', status: 'ACTIVE' },
              timestamp: 1000
            },
            {
              id: 'm-temp-delete',
              ownerId: 'user-alpha',
              type: 'DELETE_CYCLE',
              payload: 'c-temp',
              timestamp: 1100
            },
            // 2. Delete existing remote cycle
            {
              id: 'm-delete-existing',
              ownerId: 'user-alpha',
              type: 'DELETE_CYCLE',
              payload: 'c-to-delete',
              timestamp: 1200
            },
            // 3. Update log for deleted cycle (should be suppressed without warning)
            {
              id: 'm-update-deleted-log',
              ownerId: 'user-alpha',
              type: 'UPDATE_LOG',
              payload: { date: '1403-01-01', cycleId: 'c-to-delete', note: 'Orphaned note' },
              timestamp: 1300
            },
            // 4. Update log for non-existent cycle (should be suppressed without warning)
            {
              id: 'm-update-nonexistent-log',
              ownerId: 'user-alpha',
              type: 'UPDATE_LOG',
              payload: { date: '1403-01-01', cycleId: 'c-nonexistent', note: 'Unavailable cycle note' },
              timestamp: 1400
            },
            // 5. Malformed mutation item
            {
              id: 'm-malformed',
              ownerId: 'user-alpha',
              type: 'CREATE_CYCLE',
              payload: null as any,
              timestamp: 1500
            }
          ],
          isDemoConsumed: true
        });

        // Visible cycles should be empty since c-to-delete and c-temp were both deleted
        assert.equal(result.cycles?.length, 0);
        assert.equal(result.logs?.length, 0);

        const invariantWarnings = warnings.filter(w => w.includes('[ReconciliationInvariantViolation]'));
        assert.equal(invariantWarnings.length, 0, 'Legitimately suppressed mutations must produce 0 false warnings');
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('(y) missing expected pending cycle is detected rather than passing through an empty-array every() result', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';

        // Direct test of non-vacuous assertion logic:
        const expectedPendingCycleIds = new Set(['c-missing-1']);
        const emptyWorkingCycles: any[] = [];

        for (const expectedCycleId of expectedPendingCycleIds) {
          const matchingCycles = emptyWorkingCycles.filter(c => c.id === expectedCycleId);
          assertReconciliationInvariant(
            matchingCycles.length === 1,
            'Expected pending cycle must exist exactly once in reconciled cycles'
          );
        }

        assert.equal(warnings.length, 1);
        assert.equal(
          warnings[0],
          '[ReconciliationInvariantViolation] Expected pending cycle must exist exactly once in reconciled cycles'
        );
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('(z) missing expected pending log is detected by invariant rather than passing vacuously', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';

        const expectedPendingLogs = new Map([
          ['c-alpha::1403-01-01', { date: '1403-01-01', cycleId: 'c-alpha' }]
        ]);
        const emptyWorkingLogs: any[] = [];

        for (const targetLog of expectedPendingLogs.values()) {
          const matchingLog = emptyWorkingLogs.find(l => {
            if (targetLog.cycleId && l.cycleId) {
              return l.cycleId === targetLog.cycleId && l.date === targetLog.date;
            }
            return l.date === targetLog.date;
          });

          const exists = Boolean(matchingLog);
          assertReconciliationInvariant(
            exists,
            'Expected pending log must exist in reconciled logs'
          );
        }

        assert.equal(warnings.length, 1);
        assert.equal(
          warnings[0],
          '[ReconciliationInvariantViolation] Expected pending log must exist in reconciled logs'
        );
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });

    it('(aa) valid standard reconciliation produces zero invariant warnings', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';

        const result = reconcileBootState({
          authenticatedOwnerId: 'user-standard',
          remoteCycles: [createSampleCycle({ id: 'c-std-1', title: 'Standard Cycle' })],
          remoteLogs: [createSampleLog({ date: '1403-02-01', cycleId: 'c-std-1', note: 'Standard Note', isSynced: true })],
          remoteUserProfile: { name: 'Warrior Alpha', theme: 'amber' },
          currentLocalState: {
            cycles: [createSampleCycle({ id: 'c-std-1' })],
            logs: [createSampleLog({ date: '1403-02-01', cycleId: 'c-std-1' })],
            userProfile: { id: 'user-standard', name: 'Warrior Alpha', isVip: false } as any
          },
          pendingQueue: [],
          isDemoConsumed: true
        });

        assert.equal(result.cycles?.length, 1);
        assert.equal(result.logs?.length, 1);
        assert.equal(result.userProfile?.name, 'Warrior Alpha');

        const invariantWarnings = warnings.filter(w => w.includes('[ReconciliationInvariantViolation]'));
        assert.equal(invariantWarnings.length, 0, 'Zero invariant warnings emitted for valid standard reconciliation');
      } finally {
        console.warn = originalWarn;
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});

