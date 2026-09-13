import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate,
  safeMergeReconciledLogs,
  safeMergeReconciledCycles,
  executeDirectDailyLogMutation
} from '../src/utils/directMutationUtils.js';
import {
  saveOfflineQueue,
  getOfflineQueue,
  enqueueDurableDailyLogWriteAhead
} from '../src/utils/offlineQueueUtils.js';
import {
  performVisibilityRefetch,
  defaultVisibilityCoordinator
} from '../src/utils/visibilitySyncUtils.js';
import { DailyLog, Cycle } from '../src/types.js';

describe('Phase 2A: Habit Tick Stability & Visibility Hardening', () => {
  const mockStorage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
    removeItem: (key: string) => { delete mockStorage[key]; },
    clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
    get length() { return Object.keys(mockStorage).length; },
    key: (i: number) => Object.keys(mockStorage)[i] ?? null
  };

  const testUser = 'usr_phase2a_test_user';
  const testToken = 'mock_jwt_token_phase2a';
  const targetDate = '1403-06-25';
  const cycleId = 'cycle_phase2a_active';

  beforeEach(() => {
    mockLocalStorage.clear();
    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).window = { localStorage: mockLocalStorage };
    defaultVisibilityCoordinator.reset();
    saveOfflineQueue(testUser, []);
  });

  describe('1. Optimistic Habit Toggle Success Path & Rapid Succession', () => {
    it('applies optimistic habit toggle instantaneously with isSynced: false and captures snapshot', () => {
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

      const tap1Log: DailyLog = {
        ...initialLogs[0],
        workout: true
      };

      const { nextLogs, previousConfirmedSnapshot } = applyOptimisticLogUpdate(initialLogs, tap1Log);

      assert.equal(nextLogs.length, 1);
      assert.equal(nextLogs[0].workout, true, 'Optimistic workout must be true');
      assert.equal(nextLogs[0].isSynced, false, 'Optimistic update must be marked isSynced: false');
      assert.ok(previousConfirmedSnapshot !== null);
      assert.equal(previousConfirmedSnapshot.workout, false);
      assert.equal(previousConfirmedSnapshot.isSynced, true);
    });

    it('preserves successive rapid habit toggles on the same date without losing preceding taps', () => {
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

      // Tap 1: workout
      const { nextLogs: logsAfterTap1 } = applyOptimisticLogUpdate(initialLogs, {
        ...initialLogs[0],
        workout: true
      });

      // Tap 2: study (built on logsAfterTap1)
      const { nextLogs: logsAfterTap2 } = applyOptimisticLogUpdate(logsAfterTap1, {
        ...logsAfterTap1[0],
        study: true
      });

      // Tap 3: specialMission (built on logsAfterTap2)
      const { nextLogs: logsAfterTap3 } = applyOptimisticLogUpdate(logsAfterTap2, {
        ...logsAfterTap2[0],
        specialMission: true
      });

      assert.equal(logsAfterTap3[0].workout, true);
      assert.equal(logsAfterTap3[0].study, true);
      assert.equal(logsAfterTap3[0].specialMission, true);
      assert.equal(logsAfterTap3[0].wakeUp, false);
      assert.equal(logsAfterTap3[0].isSynced, false);
    });
  });

  describe('2. SafeMerge & Visibility Refetch Protection of Pending Mutations', () => {
    it('safeMergeReconciledLogs strictly protects local pending isSynced: false logs against remote server snapshots', () => {
      const localCurrentLogs: DailyLog[] = [
        {
          id: 'log-1',
          cycleId,
          date: targetDate,
          wakeUp: true,
          workout: true, // User optimistically checked workout
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          revision: 1,
          isSynced: false // Pending mutation
        }
      ];

      // Incoming remote server snapshot from visibility refetch has older/un-toggled state
      const incomingRemoteLogs: DailyLog[] = [
        {
          id: 'log-1',
          cycleId,
          date: targetDate,
          wakeUp: true,
          workout: false, // Server does not have workout checked yet
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          revision: 2, // Server advanced revision from another operation
          isSynced: true
        }
      ];

      const merged = safeMergeReconciledLogs(localCurrentLogs, incomingRemoteLogs);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].workout, true, 'Local pending workout: true must not be clobbered by remote refetch');
      assert.equal(merged[0].isSynced, false, 'Pending state must retain isSynced: false');
      assert.equal(merged[0].revision, 2, 'Should adopt latest server revision for next OCC mutation');
    });

    it('safeMergeReconciledCycles strictly protects local pending isSynced: false cycles', () => {
      const localCycles: Cycle[] = [
        {
          id: cycleId,
          title: 'Updated Title Optimistic',
          startDate: '1403-06-01',
          endDate: '1403-07-10',
          durationDays: 40,
          status: 'ACTIVE',
          userId: testUser,
          revision: 1,
          isSynced: false
        }
      ];

      const incomingCycles: Cycle[] = [
        {
          id: cycleId,
          title: 'Old Title On Server',
          startDate: '1403-06-01',
          endDate: '1403-07-10',
          durationDays: 40,
          status: 'ACTIVE',
          userId: testUser,
          revision: 2,
          isSynced: true
        }
      ];

      const merged = safeMergeReconciledCycles(localCycles, incomingCycles);

      assert.equal(merged.length, 1);
      assert.equal(merged[0].title, 'Updated Title Optimistic', 'Pending cycle title must be preserved');
      assert.equal(merged[0].isSynced, false);
    });

    it('performVisibilityRefetch is skipped with SKIPPED_IN_FLIGHT when in-flight mutations exist', async () => {
      let pullTimestamp = 0;
      let fetchCalled = false;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        getLastPullTimestamp: () => pullTimestamp,
        setLastPullTimestamp: (ts) => { pullTimestamp = ts; },
        hasInFlightMutations: () => true, // Simulating in-flight habit mutation
        customFetch: async () => {
          fetchCalled = true;
          return { ok: true, json: async () => [] } as any;
        }
      });

      assert.equal(outcome.status, 'SKIPPED_IN_FLIGHT');
      assert.equal(fetchCalled, false, 'Fetch must not be triggered when mutations are in-flight');
    });
  });

  describe('3. Truthful Rollback on Hard API Failures', () => {
    it('rolls back optimistic log update to previous confirmed snapshot on hard failure', () => {
      const confirmedSnapshot: DailyLog = {
        id: 'log-1',
        cycleId,
        date: targetDate,
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1,
        isSynced: true
      };

      const optimisticLogs: DailyLog[] = [
        {
          ...confirmedSnapshot,
          workout: true,
          isSynced: false
        }
      ];

      const rolledBack = rollbackOptimisticLogUpdate(optimisticLogs, targetDate, confirmedSnapshot);

      assert.equal(rolledBack.length, 1);
      assert.equal(rolledBack[0].workout, false, 'Workout must be restored to false');
      assert.equal(rolledBack[0].isSynced, true, 'Restored log must be marked isSynced: true');
      assert.equal(rolledBack[0].revision, 1);
    });

    it('removes optimistic log on rollback if no previous confirmed snapshot existed (new log)', () => {
      const optimisticLogs: DailyLog[] = [
        {
          id: 'log-new',
          cycleId,
          date: '1403-06-26',
          wakeUp: true,
          workout: true,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false,
          isSynced: false
        }
      ];

      const rolledBack = rollbackOptimisticLogUpdate(optimisticLogs, '1403-06-26', null);

      assert.equal(rolledBack.length, 0, 'New unconfirmed log must be removed if no prior snapshot');
    });

    it('executeDirectDailyLogMutation handles HTTP 403 Forbidden with truthful failure status', async () => {
      const logToMutate: DailyLog = {
        id: 'log-1',
        cycleId,
        date: targetDate,
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1
      };

      const mockFetch = async () => ({
        ok: false,
        status: 403,
        json: async () => ({ error: 'Forbidden' })
      }) as any;

      const result = await executeDirectDailyLogMutation({
        updatedLog: logToMutate,
        existingLog: logToMutate,
        ownerId: testUser,
        authToken: testToken,
        activeCycleId: cycleId,
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'FORBIDDEN');
      if (result.status === 'FORBIDDEN') {
        assert.equal(result.statusCode, 403);
      }
    });

    it('executeDirectDailyLogMutation handles HTTP 404 Entity Missing with truthful failure status', async () => {
      const logToMutate: DailyLog = {
        id: 'log-1',
        cycleId,
        date: targetDate,
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1
      };

      const mockFetch = async () => ({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not Found' })
      }) as any;

      const result = await executeDirectDailyLogMutation({
        updatedLog: logToMutate,
        existingLog: logToMutate,
        ownerId: testUser,
        authToken: testToken,
        activeCycleId: cycleId,
        fetchFn: mockFetch
      });

      assert.equal(result.status, 'ENTITY_MISSING');
      if (result.status === 'ENTITY_MISSING') {
        assert.equal(result.statusCode, 404);
      }
    });
  });

  describe('4. Preservation of Demo Consumed & Empty State Invariants', () => {
    it('does not mark demo consumed during unauthenticated or empty visibility refetches', async () => {
      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => 'guest',
        getCurrentAuthToken: () => null,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        getLastPullTimestamp: () => 0
      });

      assert.equal(outcome.status, 'SKIPPED_UNAUTHENTICATED');
    });
  });
});
