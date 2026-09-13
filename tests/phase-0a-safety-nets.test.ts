/**
 * TEST_NOTES:
 * - How to run:
 *   - Isolated: npx tsx --test tests/phase-0a-safety-nets.test.ts
 *   - Full suite: npm test
 *   - Type check: npm run lint
 * - Critical Invariants for Onboarding & Future Refactors:
 *   1. Optimistic Updates & Rollback:
 *      - applyOptimisticLogUpdate captures complete pre-mutation snapshot and sets isSynced: false.
 *      - rollbackOptimisticLogUpdate with snapshot cleanly restores original flags and resets isSynced: true.
 *      - Rollback with null snapshot purges newly inserted/virtual entries.
 *   2. In-Flight Mutation Protection:
 *      - performVisibilityRefetch MUST return SKIPPED_IN_FLIGHT whenever hasInFlightMutations() or coordinator isInFlight() is true to prevent race conditions.
 *   3. Reconciliation Safety (safeMergeReconciledLogs & safeMergeReconciledCycles):
 *      - Local pending unconfirmed entities (isSynced: false) MUST NOT be clobbered by older or equal remote records.
 *      - Remote records win ONLY if they have a strictly higher OCC revision (incomingRev > localRev).
 *   4. Seed & Demo Preservation:
 *      - createInitialSystemState supplies a labeled sample cycle ("نمونه") + 25 logs for initial onboarding.
 *      - resolveBackendSyncDecision preserves demo state before consumption (isDemoConsumed: false), but returns empty arrays once consumed (isDemoConsumed: true) to permanently prevent demo resurrection.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate,
  safeMergeReconciledLogs,
  safeMergeReconciledCycles,
  prepareExistingEntityRevision
} from '../src/utils/directMutationUtils.js';
import {
  markQueueItemInFlight,
  isQueueItemInFlight,
  clearOfflineQueue
} from '../src/utils/offlineQueueUtils.js';
import {
  performVisibilityRefetch
} from '../src/utils/visibilitySyncUtils.js';
import {
  createInitialSystemState
} from '../src/data/initialData.js';
import {
  getScopedDemoConsumedKey,
  resolveBackendSyncDecision
} from '../src/utils/storageUtils.js';
import { DailyLog, Cycle } from '../src/types.js';

describe('Phase 0A: Sync, Habit, Visibility & Seed Safety-Net Suite', () => {
  const testOwner = 'usr_phase0a_test_owner';
  const otherOwner = 'usr_phase0a_other_owner';
  const testToken = 'valid_mock_jwt_token_for_visibility';
  const storageMock: Record<string, string> = {};

  beforeEach(() => {
    for (const key in storageMock) {
      delete storageMock[key];
    }
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => {
          storageMock[key] = String(val);
        },
        removeItem: (key: string) => {
          delete storageMock[key];
        }
      }
    };
    clearOfflineQueue(testOwner);
    clearOfflineQueue(otherOwner);
  });

  describe('1. Habit Toggle Optimistic Path & In-Flight Invariants', () => {
    it('applies optimistic log update on existing log and rollback cleanly restores previous flags and isSynced: true', () => {
      const initialLog: DailyLog = {
        id: 'log-2026-09-10',
        cycleId: 'cycle-1',
        date: '2026-09-10',
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        notes: 'صبحگاهی آرام',
        revision: 2,
        isSynced: true,
        createdAt: '2026-09-10T05:30:00Z'
      };

      const initialLogs: DailyLog[] = [initialLog];

      // Optimistic update: toggle workout and hardTask to true, change notes
      const optimisticPayload: DailyLog = {
        ...initialLog,
        workout: true,
        hardTask: true,
        notes: 'تمرین سنگین و تسلط کامل'
      };

      const { nextLogs, previousConfirmedSnapshot } = applyOptimisticLogUpdate(
        initialLogs,
        optimisticPayload
      );

      // Verify optimistic state
      assert.equal(nextLogs.length, 1);
      assert.equal(nextLogs[0].workout, true);
      assert.equal(nextLogs[0].hardTask, true);
      assert.equal(nextLogs[0].notes, 'تمرین سنگین و تسلط کامل');
      assert.equal(nextLogs[0].isSynced, false, 'Optimistic log must be marked isSynced: false');

      // Verify captured snapshot preserves exact pre-mutation state
      assert.ok(previousConfirmedSnapshot !== null);
      assert.equal(previousConfirmedSnapshot.workout, false);
      assert.equal(previousConfirmedSnapshot.hardTask, false);
      assert.equal(previousConfirmedSnapshot.notes, 'صبحگاهی آرام');
      assert.equal(previousConfirmedSnapshot.revision, 2);

      // Rollback upon rejection (e.g. HTTP 409 or 428)
      const rolledBackLogs = rollbackOptimisticLogUpdate(
        nextLogs,
        '2026-09-10',
        previousConfirmedSnapshot
      );

      assert.equal(rolledBackLogs.length, 1);
      assert.equal(rolledBackLogs[0].workout, false, 'Rollback must restore workout: false');
      assert.equal(rolledBackLogs[0].hardTask, false, 'Rollback must restore hardTask: false');
      assert.equal(rolledBackLogs[0].notes, 'صبحگاهی آرام', 'Rollback must restore original notes');
      assert.equal(rolledBackLogs[0].revision, 2, 'Rollback must restore original revision');
      assert.equal(rolledBackLogs[0].isSynced, true, 'Rollback must re-assert isSynced: true');
    });

    it('applies optimistic insert for a brand-new or virtual log, and rollback with null snapshot removes it', () => {
      const initialLogs: DailyLog[] = [];

      const virtualLog: any = {
        id: 'virtual-log-2026-09-11',
        cycleId: 'cycle-1',
        date: '2026-09-11',
        isVirtual: true,
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false
      };

      const { nextLogs, previousConfirmedSnapshot } = applyOptimisticLogUpdate(
        initialLogs,
        virtualLog
      );

      assert.equal(nextLogs.length, 1);
      assert.equal(nextLogs[0].id, 'log-2026-09-11', 'Virtual ID prefix must be canonicalized');
      assert.equal(nextLogs[0].isSynced, false);
      assert.equal((nextLogs[0] as any).isVirtual, undefined, 'isVirtual flag must be stripped');
      assert.equal(previousConfirmedSnapshot, null, 'Snapshot must be null for new unrecorded log');

      // Rollback with null snapshot
      const rolledBackLogs = rollbackOptimisticLogUpdate(nextLogs, '2026-09-11', null);
      assert.equal(rolledBackLogs.length, 0, 'Rollback with null snapshot must purge the rejected log');
    });

    it('enforces in-flight queue item tracking invariants across owner partitions', () => {
      const op1Id = 'queue_op_1';
      const op2Id = 'queue_op_2';

      assert.equal(isQueueItemInFlight(testOwner, op1Id), false);
      assert.equal(isQueueItemInFlight(otherOwner, op1Id), false);

      // Mark op1 in flight for testOwner
      markQueueItemInFlight(testOwner, op1Id, true);
      assert.equal(isQueueItemInFlight(testOwner, op1Id), true);
      assert.equal(isQueueItemInFlight(otherOwner, op1Id), false, 'In-flight status must be partitioned by owner');
      assert.equal(isQueueItemInFlight(testOwner, op2Id), false);

      // Mark op1 not in flight
      markQueueItemInFlight(testOwner, op1Id, false);
      assert.equal(isQueueItemInFlight(testOwner, op1Id), false);

      // Clear partition
      markQueueItemInFlight(testOwner, op1Id, true);
      markQueueItemInFlight(otherOwner, op2Id, true);
      clearOfflineQueue(testOwner);
      assert.equal(isQueueItemInFlight(testOwner, op1Id), false, 'clearOfflineQueue must clean in-flight markers');
      assert.equal(isQueueItemInFlight(otherOwner, op2Id), true, 'Other owner in-flight markers must be preserved');
    });

    it('prepareExistingEntityRevision strictly validates OCC revisions for existing vs virtual entities', () => {
      const virtualCheck = prepareExistingEntityRevision({ isVirtual: true });
      assert.equal(virtualCheck.isExisting, false);
      assert.equal(virtualCheck.isValidForMutation, true);

      const nullCheck = prepareExistingEntityRevision(null);
      assert.equal(nullCheck.isExisting, false);
      assert.equal(nullCheck.isValidForMutation, true);

      const validExisting = prepareExistingEntityRevision({ revision: 4 });
      assert.equal(validExisting.isExisting, true);
      assert.equal(validExisting.expectedRevision, 4);
      assert.equal(validExisting.isValidForMutation, true);

      const invalidExistingZero = prepareExistingEntityRevision({ revision: 0 });
      assert.equal(invalidExistingZero.isExisting, true);
      assert.equal(invalidExistingZero.isValidForMutation, false);

      const invalidExistingNegative = prepareExistingEntityRevision({ revision: -1 });
      assert.equal(invalidExistingNegative.isExisting, true);
      assert.equal(invalidExistingNegative.isValidForMutation, false);
    });
  });

  describe('2. Visibility / In-Flight Synchronization Guards', () => {
    it('returns SKIPPED_IN_FLIGHT when hasInFlightMutations returns true even if isInFlight is false', async () => {
      let fetchCalled = false;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testOwner,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        checkDocumentVisibility: () => true,
        isOnlineResolver: () => true,
        getLastPullTimestamp: () => 0,
        hasInFlightMutations: () => true,
        isInFlight: () => false,
        customFetch: async () => {
          fetchCalled = true;
          return { ok: true, json: async () => [] } as any;
        }
      });

      assert.equal(outcome.status, 'SKIPPED_IN_FLIGHT');
      assert.equal(outcome.ownerId, testOwner);
      assert.equal(fetchCalled, false, 'Fetch must not be triggered when local mutations are in flight');
    });

    it('returns SKIPPED_IN_FLIGHT when isInFlight coordinator returns true', async () => {
      let fetchCalled = false;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testOwner,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        checkDocumentVisibility: () => true,
        isOnlineResolver: () => true,
        getLastPullTimestamp: () => 0,
        hasInFlightMutations: () => false,
        isInFlight: () => true,
        customFetch: async () => {
          fetchCalled = true;
          return { ok: true, json: async () => [] } as any;
        }
      });

      assert.equal(outcome.status, 'SKIPPED_IN_FLIGHT');
      assert.equal(outcome.ownerId, testOwner);
      assert.equal(fetchCalled, false, 'Fetch must not be triggered when refetch is already in flight');
    });

    it('proceeds to fetch and reconciles when neither hasInFlightMutations nor isInFlight is true', async () => {
      let fetchCallCount = 0;
      let appliedState: any = null;

      const mockRemoteCycle: Cycle = {
        id: 'cycle-cloud-1',
        title: 'چرخه ابری همگام‌شده',
        startDate: '2026-09-01',
        endDate: '2026-11-29',
        targetTheme: 'انضباط ابری',
        rules: [],
        isArchived: false,
        reportRead: false,
        inheritedStreak: 0,
        revision: 1
      };

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testOwner,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: (reconciled) => {
          appliedState = reconciled;
        },
        checkDocumentVisibility: () => true,
        isOnlineResolver: () => true,
        getLastPullTimestamp: () => 0,
        hasInFlightMutations: () => false,
        isInFlight: () => false,
        customFetch: async (url: string) => {
          fetchCallCount++;
          if (url.includes('/api/cycles')) {
            return { ok: true, json: async () => [mockRemoteCycle] } as any;
          }
          if (url.includes('/api/logs')) {
            return { ok: true, json: async () => [] } as any;
          }
          return { ok: true, json: async () => [] } as any;
        }
      });

      assert.equal(outcome.status, 'FETCHED');
      assert.equal(outcome.ownerId, testOwner);
      assert.equal(fetchCallCount, 2, 'Must fetch both /api/cycles and /api/logs');
      assert.ok(appliedState !== null);
      assert.equal(appliedState.cycles.length, 1);
      assert.equal(appliedState.cycles[0].id, 'cycle-cloud-1');
    });
  });

  describe('3. safeMergeReconciledLogs & safeMergeReconciledCycles Protection Rules', () => {
    it('protects local pending log (isSynced: false) from being clobbered by older or equal remote log', () => {
      const date = '2026-09-12';
      const localPendingLog: DailyLog = {
        id: 'log-2026-09-12',
        cycleId: 'cycle-1',
        date,
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: false,
        notes: 'تغییر محلی ارسال‌نشده',
        revision: 2,
        isSynced: false
      };

      const olderRemoteLog: DailyLog = {
        id: 'log-2026-09-12',
        cycleId: 'cycle-1',
        date,
        wakeUp: false,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        notes: 'یادداشت قدیمی سرور',
        revision: 1, // Older revision
        isSynced: true
      };

      const merged = safeMergeReconciledLogs([localPendingLog], [olderRemoteLog]);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].date, date);
      assert.equal(merged[0].wakeUp, true, 'Local pending wakeUp must NOT be clobbered');
      assert.equal(merged[0].workout, true, 'Local pending workout must NOT be clobbered');
      assert.equal(merged[0].study, true, 'Local pending study must NOT be clobbered');
      assert.equal(merged[0].notes, 'تغییر محلی ارسال‌نشده');
      assert.equal(merged[0].isSynced, false, 'Pending status isSynced: false must be preserved');

      // Also verify equal revision (incomingRev === localRev) does not clobber local unconfirmed edit
      const equalRemoteLog: DailyLog = {
        ...olderRemoteLog,
        revision: 2
      };

      const mergedEqual = safeMergeReconciledLogs([localPendingLog], [equalRemoteLog]);
      assert.equal(mergedEqual[0].wakeUp, true);
      assert.equal(mergedEqual[0].isSynced, false);
    });

    it('preserves local pending log (isSynced: false) when date is completely missing from incoming remote logs', () => {
      const localPendingLog: DailyLog = {
        id: 'log-2026-09-13',
        cycleId: 'cycle-1',
        date: '2026-09-13',
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1,
        isSynced: false
      };

      const incomingRemoteLogs: DailyLog[] = [
        {
          id: 'log-2026-09-10',
          cycleId: 'cycle-1',
          date: '2026-09-10',
          wakeUp: true,
          workout: true,
          study: true,
          journal: true,
          hardTask: true,
          specialMission: false,
          revision: 1,
          isSynced: true
        }
      ];

      const merged = safeMergeReconciledLogs([localPendingLog], incomingRemoteLogs);

      assert.equal(merged.length, 2);
      const pendingFound = merged.find(l => l.date === '2026-09-13');
      assert.ok(pendingFound);
      assert.equal(pendingFound?.wakeUp, true);
      assert.equal(pendingFound?.isSynced, false, 'Local unconfirmed log missing on server must be preserved');
    });

    it('allows incoming server log to win when server log is confirmed with strictly higher revision (server OCC advance)', () => {
      const date = '2026-09-12';
      const localStaleLog: DailyLog = {
        id: 'log-2026-09-12',
        cycleId: 'cycle-1',
        date,
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1,
        isSynced: false
      };

      const advancedServerLog: DailyLog = {
        id: 'log-2026-09-12',
        cycleId: 'cycle-1',
        date,
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: true,
        notes: 'تایید سرور با نسخه بالاتر از دستگاه دیگر',
        revision: 3, // Strictly higher revision than local (3 > 1)
        isSynced: true
      };

      const merged = safeMergeReconciledLogs([localStaleLog], [advancedServerLog]);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].revision, 3);
      assert.equal(merged[0].workout, true);
      assert.equal(merged[0].study, true);
      assert.equal(merged[0].journal, true);
      assert.equal(merged[0].notes, 'تایید سرور با نسخه بالاتر از دستگاه دیگر');
      assert.equal(merged[0].isSynced, true, 'Server advanced OCC log must win and remain isSynced: true');
    });

    it('safeMergeReconciledCycles protects local pending cycle unless server cycle has strictly higher revision', () => {
      const cycleId = 'cycle-occ-test';
      const localPendingCycle: Cycle = {
        id: cycleId,
        title: 'عنوان محلی در انتظار همگام‌سازی',
        startDate: '2026-09-01',
        endDate: '2026-11-29',
        targetTheme: 'انضباط محلی',
        rules: ['قانون محلی'],
        isArchived: false,
        reportRead: false,
        inheritedStreak: 0,
        revision: 1,
        isSynced: false
      };

      const olderRemoteCycle: Cycle = {
        id: cycleId,
        title: 'عنوان قدیمی سرور',
        startDate: '2026-09-01',
        endDate: '2026-11-29',
        targetTheme: 'تم قدیمی',
        rules: [],
        isArchived: false,
        reportRead: false,
        inheritedStreak: 0,
        revision: 1,
        isSynced: true
      };

      // Case A: Equal or lower revision does not clobber local pending cycle
      const mergedPending = safeMergeReconciledCycles([localPendingCycle], [olderRemoteCycle]);
      assert.equal(mergedPending.length, 1);
      assert.equal(mergedPending[0].title, 'عنوان محلی در انتظار همگام‌سازی');
      assert.equal(mergedPending[0].isSynced, false);

      // Case B: Higher revision server cycle wins
      const advancedServerCycle: Cycle = {
        ...olderRemoteCycle,
        title: 'عنوان به‌روزشده با نسخه بالاتر در سرور',
        revision: 2,
        isSynced: true
      };

      const mergedAdvanced = safeMergeReconciledCycles([localPendingCycle], [advancedServerCycle]);
      assert.equal(mergedAdvanced.length, 1);
      assert.equal(mergedAdvanced[0].title, 'عنوان به‌روزشده با نسخه بالاتر در سرور');
      assert.equal(mergedAdvanced[0].isSynced, true);
    });
  });

  describe('4. Demo / Seed Creation & Scoped Demo Consumption Contract', () => {
    it('createInitialSystemState generates labeled sample cycle containing "(نمونه)" and exactly 25 logs', () => {
      const state = createInitialSystemState();

      // Sample cycle label assertion
      assert.equal(state.cycles.length, 1);
      assert.equal(state.cycles[0].id, 'cycle-1');
      assert.ok(
        state.cycles[0].title.includes('نمونه'),
        'Initial cycle title must clearly identify itself as sample/demo'
      );

      // 25 logs assertion: exactly 24 past days + today in progress
      assert.equal(state.logs.length, 25, 'Must generate exactly 25 logs (24 past days + today)');

      // Today log assertion
      const todayLog = state.logs[state.logs.length - 1];
      assert.equal(todayLog.journal, false, 'Today log must reflect an in-progress battle day');

      // Settings and profile integrity
      assert.ok(state.settings.allTimeMaxStreak >= 0);
      assert.ok(state.settings.allTimeMaxScore >= 0);
      assert.equal(state.settings.nightOwlCutoffHour, 4);
      assert.ok(state.userProfile.name.length > 0);
    });

    it('getScopedDemoConsumedKey generates account-partitioned storage keys for guest vs authenticated accounts', () => {
      const guestKey = getScopedDemoConsumedKey(null);
      assert.equal(guestKey, 'bushido_demo_consumed_guest');

      const guestExplicitKey = getScopedDemoConsumedKey('');
      assert.equal(guestExplicitKey, 'bushido_demo_consumed_guest');

      const userKey = getScopedDemoConsumedKey('user_samurai_77');
      assert.equal(userKey, 'bushido_demo_consumed_user_user_samurai_77');
    });

    it('resolveBackendSyncDecision: when isDemoConsumed is false, empty API cycles/logs preserves local demo state (returns null)', () => {
      const decision = resolveBackendSyncDecision({
        apiCycles: [],
        apiLogs: [],
        isDemoConsumed: false
      });

      assert.equal(decision.nextCycles, null, 'Must return null for nextCycles to preserve local demo seed');
      assert.equal(decision.nextLogs, null, 'Must return null for nextLogs to preserve local demo logs');
      assert.equal(decision.shouldMarkDemoConsumed, false);
      assert.equal(decision.nextActiveCycleId, null);
    });

    it('resolveBackendSyncDecision: after demo consumed key is set (isDemoConsumed: true), empty API response returns empty arrays to prevent demo resurrection', () => {
      const decision = resolveBackendSyncDecision({
        apiCycles: [],
        apiLogs: [],
        isDemoConsumed: true
      });

      assert.deepEqual(decision.nextCycles, [], 'Must return empty array for cycles when demo is consumed');
      assert.deepEqual(decision.nextLogs, [], 'Must return empty array for logs when demo is consumed');
      assert.equal(decision.shouldMarkDemoConsumed, false);
    });

    it('resolveBackendSyncDecision: when server returns real data, marks demo consumed and adopts remote data', () => {
      const serverCycles: Cycle[] = [
        {
          id: 'cycle-real-user-1',
          title: 'چرخه واقعی کاربر',
          startDate: '2026-09-01',
          endDate: '2026-11-29',
          targetTheme: 'هدف واقعی',
          rules: [],
          isArchived: false,
          reportRead: false,
          inheritedStreak: 0,
          revision: 1
        }
      ];

      const serverLogs: DailyLog[] = [
        {
          id: 'log-2026-09-01',
          cycleId: 'cycle-real-user-1',
          date: '2026-09-01',
          wakeUp: true,
          workout: true,
          study: true,
          journal: true,
          hardTask: true,
          specialMission: false,
          revision: 1,
          isSynced: true
        }
      ];

      const decision = resolveBackendSyncDecision({
        apiCycles: serverCycles,
        apiLogs: serverLogs,
        isDemoConsumed: false
      });

      assert.equal(decision.shouldMarkDemoConsumed, true, 'Must mark demo as consumed when real server data arrives');
      assert.equal(decision.nextActiveCycleId, 'cycle-real-user-1');
      assert.equal(decision.nextCycles?.length, 1);
      assert.equal(decision.nextCycles?.[0].id, 'cycle-real-user-1');
      assert.equal(decision.nextLogs?.length, 1);
      assert.equal(decision.nextLogs?.[0].id, 'log-2026-09-01');
    });
  });
});
