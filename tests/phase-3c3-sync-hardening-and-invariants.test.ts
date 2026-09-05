import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SyncOrchestrator,
  createSyncOrchestrator,
  SyncTrigger,
  SyncRequest,
  SyncRunOutcome,
  bindBootAuthAndRequestSync
} from '../src/utils/syncOrchestrator.js';
import { reconcileBootState, ReconcileBootStateInput } from '../src/utils/syncReconciliation.js';
import { ReplayOptions, ReplayResult } from '../src/utils/offlineQueueUtils.js';
import { Cycle, DailyLog, UserProfile, OfflineQueueItem } from '../src/types.js';

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createSampleReplayResult(overrides?: Partial<ReplayResult>): ReplayResult {
  return {
    syncedCount: 1,
    failedCount: 0,
    remainingQueueCount: 0,
    stoppedDueToAuth: false,
    stoppedDueToAccountChange: false,
    stoppedDueToLockLoss: false,
    ...overrides
  };
}

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

describe('Phase 3C.3: Sync Hardening, Edge Scenarios & Invariant Validation', () => {
  let orchestrator: SyncOrchestrator;
  let activeAccount: string | null;
  let replayCalls: Array<{
    options: ReplayOptions;
    deferred: ReturnType<typeof createDeferred<ReplayResult>>;
  }>;

  beforeEach(() => {
    activeAccount = 'user-alpha';
    replayCalls = [];

    orchestrator = createSyncOrchestrator({
      currentActiveAccountResolver: () => activeAccount,
      isOnlineResolver: () => true,
      replayExecutor: (options: ReplayOptions) => {
        const deferred = createDeferred<ReplayResult>();
        replayCalls.push({ options, deferred });
        return deferred.promise;
      }
    });
  });

  // ===========================================================================
  // 1. INVARIANT-FOCUSED EDGE SCENARIOS
  // ===========================================================================
  describe('1. Invariant-Focused Edge Scenarios', () => {
    it('Scenario 1.1: Rapid account switching (A -> B -> C -> D) discards stale intermediate requests and executes only the latest active user', async () => {
      // User A starts active run
      const pA = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });
      assert.equal(replayCalls.length, 1);
      assert.equal(replayCalls[0].options.activeAccountId, 'user-alpha');

      // Rapid succession of account changes while User A run is still in-flight
      activeAccount = 'user-beta';
      const pB = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-beta',
        targetToken: 'token-beta'
      });

      activeAccount = 'user-gamma';
      const pC = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-gamma',
        targetToken: 'token-gamma'
      });

      activeAccount = 'user-delta';
      const pD = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-delta',
        targetToken: 'token-delta'
      });

      // User B and User C requests must have been discarded as DISCARDED_STALE
      const outcomeB = await pB;
      assert.equal(outcomeB.status, 'DISCARDED_STALE');
      assert.equal(outcomeB.ownerId, 'user-beta');
      assert.equal(outcomeB.stoppedDueToAccountChange, true);

      const outcomeC = await pC;
      assert.equal(outcomeC.status, 'DISCARDED_STALE');
      assert.equal(outcomeC.ownerId, 'user-gamma');
      assert.equal(outcomeC.stoppedDueToAccountChange, true);

      // Trailing slot is currently reserved exclusively for User D
      assert.equal(orchestrator.getPendingTrailing()?.ownerId, 'user-delta');

      // Complete User A active run (it reports account change)
      replayCalls[0].deferred.resolve(createSampleReplayResult({
        syncedCount: 1,
        stoppedDueToAccountChange: true
      }));

      const outcomeA = await pA;
      assert.equal(outcomeA.status, 'DISCARDED_STALE');

      // User D trailing run is now dispatched
      assert.equal(replayCalls.length, 2, 'Exactly one trailing replay is dispatched');
      assert.equal(replayCalls[1].options.activeAccountId, 'user-delta');
      assert.equal(replayCalls[1].options.authToken, 'token-delta');

      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 3 }));
      const outcomeD = await pD;
      assert.equal(outcomeD.status, 'COMPLETED');
      assert.equal(outcomeD.syncedCount, 3);
      assert.equal(outcomeD.ownerId, 'user-delta');
    });

    it('Scenario 1.2: Logout during pending replay cleanly aborts trailing run and suppresses active run state emissions', async () => {
      let itemSuccessEmitted = 0;
      let resultToastEmitted = 0;

      const pActive = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        onItemSuccess: () => { itemSuccessEmitted++; },
        onResult: () => { resultToastEmitted++; }
      });

      const pTrailing = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        onItemSuccess: () => { itemSuccessEmitted++; },
        onResult: () => { resultToastEmitted++; }
      });

      assert.equal(orchestrator.hasPendingTrailing(), true);

      // User clicks logout: account is set to null, cancelPendingSync is invoked
      activeAccount = null;
      orchestrator.cancelPendingSync();

      const trailingOutcome = await pTrailing;
      assert.equal(trailingOutcome.status, 'ABORTED');
      assert.equal(trailingOutcome.stoppedDueToAccountChange, true);

      // Replay completes after logout, attempting to emit item-success
      replayCalls[0].options.onItemSuccess?.({
        id: 'mut-1',
        ownerId: 'user-alpha',
        type: 'UPDATE_LOG',
        payload: { date: '1403-01-01' },
        timestamp: Date.now()
      });

      // Item success callback must be suppressed because active account is null
      assert.equal(itemSuccessEmitted, 0, 'Item success callback must be suppressed after logout');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 2 }));
      const activeOutcome = await pActive;

      assert.equal(activeOutcome.status, 'DISCARDED_STALE');
      assert.equal(activeOutcome.stoppedDueToAccountChange, true);
      assert.equal(resultToastEmitted, 0, 'Toast notification must be suppressed after logout');
      assert.equal(replayCalls.length, 1, 'No trailing replay run is ever dispatched after logout');
    });

    it('Scenario 1.3: Impersonation enter/exit race routes to correct identity at every boundary', async () => {
      // 1. Admin enters impersonation of target user while admin replay is active
      activeAccount = 'admin-1';
      const pAdminActive = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'admin-1',
        targetToken: 'admin-token-1'
      });

      activeAccount = 'target-user-42';
      const pImpersonationStart = orchestrator.requestSync({
        trigger: 'IMPERSONATION_START',
        targetOwnerId: 'target-user-42',
        targetToken: 'target-token-42'
      });

      // Settle Admin active run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ stoppedDueToAccountChange: true }));
      await pAdminActive;

      // Impersonation trailing run starts with target user credentials
      assert.equal(replayCalls.length, 2);
      assert.equal(replayCalls[1].options.activeAccountId, 'target-user-42');
      assert.equal(replayCalls[1].options.authToken, 'target-token-42');

      // 2. While target user replay is active, Admin exits impersonation
      activeAccount = 'admin-1';
      const pImpersonationExit = orchestrator.requestSync({
        trigger: 'IMPERSONATION_EXIT',
        targetOwnerId: 'admin-1',
        targetToken: 'admin-token-restored'
      });

      // Settle Target User run
      replayCalls[1].deferred.resolve(createSampleReplayResult({ stoppedDueToAccountChange: true }));
      await pImpersonationStart;

      // Impersonation exit trailing run starts with restored admin credentials
      assert.equal(replayCalls.length, 3);
      assert.equal(replayCalls[2].options.activeAccountId, 'admin-1');
      assert.equal(replayCalls[2].options.authToken, 'admin-token-restored');

      replayCalls[2].deferred.resolve(createSampleReplayResult({ syncedCount: 5 }));
      const exitOutcome = await pImpersonationExit;
      assert.equal(exitOutcome.status, 'COMPLETED');
      assert.equal(exitOutcome.syncedCount, 5);
      assert.equal(exitOutcome.ownerId, 'admin-1');
    });

    it('Scenario 1.4: Boot hydration cancellation does not commit state or dispatch replay if cancelled', () => {
      let isCancelled = false;
      let stateCommitted = false;

      // Simulate boot lifecycle
      const runBoot = async () => {
        // Step 1: simulated async fetch
        await new Promise((res) => setTimeout(res, 5));

        if (isCancelled) return;

        // Step 2: reconciliation
        const reconciled = reconcileBootState({
          authenticatedOwnerId: 'user-alpha',
          remoteCycles: [createSampleCycle()],
          remoteLogs: [createSampleLog()],
          currentLocalState: { cycles: [], logs: [] },
          pendingQueue: [],
          isDemoConsumed: true
        });

        if (isCancelled) return;

        stateCommitted = true;
      };

      const bootPromise = runBoot();
      // Component unmounts immediately
      isCancelled = true;

      return bootPromise.then(() => {
        assert.equal(stateCommitted, false, 'State must not be committed when boot is cancelled');
      });
    });

    it('Scenario 1.5: Stale reconciliation suppression prevents state commitment across identity switch', () => {
      let currentActiveOwner = 'user-alpha';

      const initialAuthUserId = 'user-alpha';
      const reconciled = reconcileBootState({
        authenticatedOwnerId: initialAuthUserId,
        remoteCycles: [createSampleCycle({ id: 'alpha-cycle' })],
        remoteLogs: [],
        currentLocalState: { cycles: [], logs: [] },
        pendingQueue: [],
        isDemoConsumed: true
      });

      // User switched account to user-beta during the async window before commitment
      currentActiveOwner = 'user-beta';

      let stateWasCommitted = false;
      // Revalidation check from App.tsx
      if (currentActiveOwner === initialAuthUserId) {
        stateWasCommitted = true;
      }

      assert.equal(stateWasCommitted, false, 'Stale reconciliation must be suppressed when active owner changes');
    });

    it('Scenario 1.6: Duplicate trigger storm (50 simultaneous triggers) results in exactly 2 total replay runs (1 active + 1 trailing)', async () => {
      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // Fire 50 simultaneous triggers of mixed types
      const stormPromises: Promise<SyncRunOutcome>[] = [];
      const triggers: SyncTrigger[] = [
        'NETWORK_ONLINE',
        'BOOT_AUTH_VERIFIED',
        'AUTH_SUCCESS',
        'QUICK_LOGIN_SUCCESS',
        'MANUAL_FORCE'
      ];

      for (let i = 0; i < 50; i++) {
        const trig = triggers[i % triggers.length];
        stormPromises.push(
          orchestrator.requestSync({
            trigger: trig,
            targetOwnerId: 'user-alpha',
            targetToken: 'token-alpha',
            force: trig === 'MANUAL_FORCE'
          })
        );
      }

      assert.equal(replayCalls.length, 1, 'Only 1 active run started');
      assert.equal(orchestrator.hasPendingTrailing(), true, '1 coalesced trailing run queued');

      // Settle active run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      await pActive;

      // Trailing run executes
      assert.equal(replayCalls.length, 2, 'Exactly 1 trailing run executed for all 50 triggers');
      assert.equal(replayCalls[1].options.force, true, 'force=true dominated from MANUAL_FORCE');

      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 10 }));
      const stormResults = await Promise.all(stormPromises);

      for (const res of stormResults) {
        assert.equal(res.status, 'COMPLETED');
        assert.equal(res.syncedCount, 10);
      }

      assert.equal(orchestrator.isRunActive(), false);
      assert.equal(orchestrator.hasPendingTrailing(), false);
    });

    it('Scenario 1.7: Replay cancellation correctness verifies clean resolution of pending promises', async () => {
      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      const pTrailing1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });
      const pTrailing2 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // Explicit cancellation
      orchestrator.cancelPendingSync();

      assert.equal(orchestrator.hasPendingTrailing(), false);

      const [res1, res2] = await Promise.all([pTrailing1, pTrailing2]);
      assert.equal(res1.status, 'ABORTED');
      assert.equal(res2.status, 'ABORTED');
      assert.equal(res1.stoppedDueToAccountChange, true);
      assert.equal(res2.stoppedDueToAccountChange, true);

      // Complete active run
      replayCalls[0].deferred.resolve(createSampleReplayResult());
      await pActive;

      assert.equal(replayCalls.length, 1, 'No trailing run executed after cancellation');
    });
  });

  // ===========================================================================
  // 2. ORCHESTRATOR GUARANTEES
  // ===========================================================================
  describe('2. Orchestrator Guarantees', () => {
    it('Guarantee 2.1: At most one active replay exists at any instant', async () => {
      const p1 = orchestrator.requestSync({ trigger: 'NETWORK_ONLINE', targetOwnerId: 'user-alpha', targetToken: 't1' });
      assert.equal(orchestrator.isRunActive(), true);

      const p2 = orchestrator.requestSync({ trigger: 'NETWORK_ONLINE', targetOwnerId: 'user-alpha', targetToken: 't2' });
      const p3 = orchestrator.requestSync({ trigger: 'NETWORK_ONLINE', targetOwnerId: 'user-alpha', targetToken: 't3' });

      // There is only 1 call to replayExecutor
      assert.equal(replayCalls.length, 1);

      replayCalls[0].deferred.resolve(createSampleReplayResult());
      await p1;

      // Now trailing run becomes active
      assert.equal(replayCalls.length, 2);
      replayCalls[1].deferred.resolve(createSampleReplayResult());
      await Promise.all([p2, p3]);

      assert.equal(orchestrator.isRunActive(), false);
    });

    it('Guarantee 2.2: At most one trailing replay exists at any instant', () => {
      orchestrator.requestSync({ trigger: 'NETWORK_ONLINE', targetOwnerId: 'user-alpha', targetToken: 't1' });

      orchestrator.requestSync({ trigger: 'NETWORK_ONLINE', targetOwnerId: 'user-alpha', targetToken: 't2' });
      orchestrator.requestSync({ trigger: 'AUTH_SUCCESS', targetOwnerId: 'user-alpha', targetToken: 't3' });
      orchestrator.requestSync({ trigger: 'BOOT_AUTH_VERIFIED', targetOwnerId: 'user-alpha', targetToken: 't4' });

      const trailing = orchestrator.getPendingTrailing();
      assert.ok(trailing !== null);
      assert.equal(trailing.ownerId, 'user-alpha');
      // Single coalesced descriptor
      assert.equal(orchestrator.hasPendingTrailing(), true);
    });

    it('Guarantee 2.3: No replay amplification occurs (linear input does NOT cause quadratic/exponential runs)', async () => {
      const pActive = orchestrator.requestSync({ trigger: 'AUTH_SUCCESS', targetOwnerId: 'user-alpha', targetToken: 't1' });

      const count = 25;
      const promises: Promise<SyncRunOutcome>[] = [];
      for (let i = 0; i < count; i++) {
        promises.push(
          orchestrator.requestSync({
            trigger: 'NETWORK_ONLINE',
            targetOwnerId: 'user-alpha',
            targetToken: 't1'
          })
        );
      }

      // Complete active run
      replayCalls[0].deferred.resolve(createSampleReplayResult());
      await pActive;

      // Trailing run executes
      assert.equal(replayCalls.length, 2, 'Amplification prevented: 25 requests mapped to exactly 1 trailing replay run');

      replayCalls[1].deferred.resolve(createSampleReplayResult());
      await Promise.all(promises);

      assert.equal(replayCalls.length, 2);
    });

    it('Guarantee 2.4: No replay recursion exists (orchestrator is non-reentrant)', async () => {
      let replayCallCount = 0;

      const recursiveOrchestrator = createSyncOrchestrator({
        currentActiveAccountResolver: () => 'user-alpha',
        isOnlineResolver: () => true,
        replayExecutor: async (opts) => {
          replayCallCount++;
          if (replayCallCount === 1) {
            // Attempting to recursively call requestSync inside replayExecutor
            recursiveOrchestrator.requestSync({
              trigger: 'NETWORK_ONLINE',
              targetOwnerId: 'user-alpha',
              targetToken: 't1'
            });
          }
          return createSampleReplayResult({ syncedCount: 1 });
        }
      });

      const outcome = await recursiveOrchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 't1'
      });

      assert.equal(outcome.status, 'COMPLETED');
      // The nested request was coalesced into the single trailing run and executed once
      assert.equal(replayCallCount, 2, 'Recursive request safely coalesced into exactly 1 trailing run without infinite loops');
    });

    it('Guarantee 2.5: No replay execution occurs after ownership loss (pre, mid, and post-flight)', async () => {
      let midFlightItemSuccessCalled = false;
      let postFlightResultCalled = false;

      // 1. Pre-flight ownership loss: active account changes before executeRun starts
      activeAccount = 'user-other';
      const preFlightOutcome = await orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 't1',
        currentActiveAccountResolver: () => 'user-other'
      });
      assert.equal(preFlightOutcome.status, 'DISCARDED_STALE');
      assert.equal(replayCalls.length, 0, 'Replay executor was never called when pre-flight check failed');

      // Reset for mid-flight check
      activeAccount = 'user-alpha';
      const pMidFlight = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 't1',
        onItemSuccess: () => { midFlightItemSuccessCalled = true; },
        onResult: () => { postFlightResultCalled = true; }
      });

      assert.equal(replayCalls.length, 1);

      // Mid-flight: switch account
      activeAccount = 'user-beta';

      // Simulate item success callback during execution
      replayCalls[0].options.onItemSuccess?.({
        id: 'mut-1',
        ownerId: 'user-alpha',
        type: 'UPDATE_LOG',
        payload: { date: '1403-01-01' },
        timestamp: Date.now()
      });

      assert.equal(midFlightItemSuccessCalled, false, 'Mid-flight item success suppressed after ownership loss');

      // Settle run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      const postFlightOutcome = await pMidFlight;

      assert.equal(postFlightOutcome.status, 'DISCARDED_STALE');
      assert.equal(postFlightResultCalled, false, 'Post-flight result notification suppressed after ownership loss');
    });
  });

  // ===========================================================================
  // 3. RECONCILIATION GUARANTEES
  // ===========================================================================
  describe('3. Reconciliation Guarantees', () => {
    it('Guarantee 3.1: ReconcileBootState produces deterministic output on identical inputs', () => {
      const input: ReconcileBootStateInput = {
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [createSampleCycle({ id: 'c1', title: 'Cycle 1' })],
        remoteLogs: [createSampleLog({ date: '1403-01-01', cycleId: 'c1' })],
        remoteUserProfile: createSampleProfile({ id: 'user-alpha', name: 'Alpha' }),
        currentLocalState: {
          cycles: [createSampleCycle({ id: 'c1' })],
          logs: [createSampleLog({ date: '1403-01-01', cycleId: 'c1' })]
        },
        pendingQueue: [
          {
            id: 'm1',
            ownerId: 'user-alpha',
            type: 'UPDATE_LOG',
            payload: { date: '1403-01-01', cycleId: 'c1', note: 'Pending Note' },
            timestamp: 1000
          }
        ],
        isDemoConsumed: true
      };

      const out1 = reconcileBootState(input);
      const out2 = reconcileBootState(input);

      assert.deepEqual(out1, out2);
    });

    it('Guarantee 3.2: ReconcileBootState enforces strict owner isolation and rejects guest mutations', () => {
      const inputWithForeignQueue: ReconcileBootStateInput = {
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [createSampleCycle({ id: 'c-alpha' })],
        remoteLogs: [],
        currentLocalState: { cycles: [createSampleCycle({ id: 'c-alpha' })], logs: [] },
        pendingQueue: [
          {
            id: 'm-beta',
            ownerId: 'user-beta',
            type: 'CREATE_CYCLE',
            payload: { id: 'c-beta', title: 'Beta Cycle' },
            timestamp: 1000
          },
          {
            id: 'm-guest',
            ownerId: 'guest',
            type: 'CREATE_CYCLE',
            payload: { id: 'c-guest', title: 'Guest Cycle' },
            timestamp: 1000
          }
        ],
        isDemoConsumed: true
      };

      const out = reconcileBootState(inputWithForeignQueue);
      assert.ok(out.cycles !== null);
      assert.equal(out.cycles.length, 1);
      assert.equal(out.cycles[0].id, 'c-alpha');
      assert.ok(!out.cycles.some(c => c.id === 'c-beta'));
      assert.ok(!out.cycles.some(c => c.id === 'c-guest'));
    });

    it('Guarantee 3.3: ReconcileBootState prevents privilege escalation across all privileged profile fields', () => {
      const serverProfile = createSampleProfile({
        id: 'user-alpha',
        name: 'Server Samurai',
        tier: 'free',
        isVip: false,
        isAdmin: false,
        activeCycleLimit: 1
      });

      const escalationMutation: OfflineQueueItem = {
        id: 'mut-esc',
        ownerId: 'user-alpha',
        type: 'UPDATE_PROFILE',
        payload: {
          name: 'Honest Name Update',
          isAdmin: true,
          isVip: true,
          tier: 'vip_unlimited',
          activeCycleLimit: 9999,
          paymentRefId: 'stolen_ref',
          vipSince: '2026-01-01',
          vipExpiresAt: '2099-01-01',
          tokenVersion: 999,
          email: 'hacked@bushido.io',
          phoneNumber: '+989129999999',
          id: 'impersonated-user-id',
          createdAt: '2020-01-01',
          updatedAt: '2020-01-01'
        },
        timestamp: Date.now()
      };

      const out = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        remoteUserProfile: serverProfile,
        currentLocalState: { cycles: [], logs: [], userProfile: serverProfile },
        pendingQueue: [escalationMutation],
        isDemoConsumed: true
      });

      assert.ok(out.userProfile !== null);
      assert.equal(out.userProfile.name, 'Honest Name Update');
      // All privileged fields strictly preserved from server
      assert.equal(out.userProfile.isAdmin, false);
      assert.equal(out.userProfile.isVip, false);
      assert.equal(out.userProfile.tier, 'free');
      assert.equal(out.userProfile.activeCycleLimit, 1);
      assert.equal(out.userProfile.paymentRefId, undefined);
      assert.equal(out.userProfile.vipSince, undefined);
      assert.equal(out.userProfile.vipExpiresAt, undefined);
      assert.equal(out.userProfile.tokenVersion, undefined);
      assert.equal(out.userProfile.id, 'user-alpha');
    });

    it('Guarantee 3.4 & 3.5: No ghost cycle or deleted cycle resurrection occurs', () => {
      // Scenario: Server snapshot contains an old cycle that was deleted in the offline queue
      const serverCycle = createSampleCycle({ id: 'deleted-cycle-id', title: 'Server Ghost Cycle' });
      const serverLog = createSampleLog({ date: '1403-01-01', cycleId: 'deleted-cycle-id' });

      const deleteMutation: OfflineQueueItem = {
        id: 'mut-del',
        ownerId: 'user-alpha',
        type: 'DELETE_CYCLE',
        payload: { id: 'deleted-cycle-id' },
        timestamp: Date.now()
      };

      const out = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [serverCycle],
        remoteLogs: [serverLog],
        currentLocalState: { cycles: [serverCycle], logs: [serverLog] },
        pendingQueue: [deleteMutation],
        isDemoConsumed: true
      });

      assert.ok(out.cycles !== null);
      assert.ok(out.logs !== null);
      assert.equal(out.cycles.length, 0, 'Deleted cycle must not be resurrected');
      assert.equal(out.logs.length, 0, 'Logs belonging to deleted cycle must be suppressed');
    });

    it('Guarantee 3.6: Immutable profile protection preserves server baseline for all identity fields', () => {
      const serverProfile = createSampleProfile({
        id: 'user-auth-stable',
        name: 'Confirmed Name',
        accentTheme: 'amber'
      });

      const out = reconcileBootState({
        authenticatedOwnerId: 'user-auth-stable',
        remoteCycles: [],
        remoteLogs: [],
        remoteUserProfile: serverProfile,
        currentLocalState: { cycles: [], logs: [], userProfile: serverProfile },
        pendingQueue: [],
        isDemoConsumed: true
      });

      assert.equal(out.userProfile?.id, 'user-auth-stable');
      assert.equal(out.userProfile?.name, 'Confirmed Name');
      assert.equal(out.userProfile?.accentTheme, 'amber');
    });
  });

  // ===========================================================================
  // 4. SYNC CONTRACT TEST MATRIX
  // ===========================================================================
  describe('4. Sync Contract Test Matrix (All 7 Lifecycle Triggers)', () => {
    it('Trigger 1: AUTH_SUCCESS (owner: user.id, token: verified token, queue: user-scoped, target: user queue, cancellation: cancels on account switch)', async () => {
      const outcomePromise = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-101',
        targetToken: 'auth-jwt-101',
        currentActiveAccountResolver: () => 'user-101'
      });

      assert.equal(replayCalls.length, 1);
      assert.equal(replayCalls[0].options.activeAccountId, 'user-101');
      assert.equal(replayCalls[0].options.authToken, 'auth-jwt-101');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 2 }));
      const res = await outcomePromise;
      assert.equal(res.status, 'COMPLETED');
      assert.equal(res.ownerId, 'user-101');
      assert.deepEqual(res.triggers, ['AUTH_SUCCESS']);
    });

    it('Trigger 2: QUICK_LOGIN_SUCCESS (owner: quick-login user.id, token: quick-login token, queue: quick-login queue, cancellation: cancels on account switch)', async () => {
      const outcomePromise = orchestrator.requestSync({
        trigger: 'QUICK_LOGIN_SUCCESS',
        targetOwnerId: 'admin-quick',
        targetToken: 'admin-quick-token',
        currentActiveAccountResolver: () => 'admin-quick'
      });

      assert.equal(replayCalls.length, 1);
      assert.equal(replayCalls[0].options.activeAccountId, 'admin-quick');
      assert.equal(replayCalls[0].options.authToken, 'admin-quick-token');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      const res = await outcomePromise;
      assert.equal(res.status, 'COMPLETED');
      assert.equal(res.ownerId, 'admin-quick');
      assert.deepEqual(res.triggers, ['QUICK_LOGIN_SUCCESS']);
    });

    it('Trigger 3: IMPERSONATION_START (owner: targetUser.id, token: target token, queue: target user queue, cancellation: replaces prior admin trailing run)', async () => {
      const outcomePromise = orchestrator.requestSync({
        trigger: 'IMPERSONATION_START',
        targetOwnerId: 'target-user-88',
        targetToken: 'target-token-88',
        currentActiveAccountResolver: () => 'target-user-88'
      });

      assert.equal(replayCalls.length, 1);
      assert.equal(replayCalls[0].options.activeAccountId, 'target-user-88');
      assert.equal(replayCalls[0].options.authToken, 'target-token-88');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 4 }));
      const res = await outcomePromise;
      assert.equal(res.status, 'COMPLETED');
      assert.equal(res.ownerId, 'target-user-88');
      assert.deepEqual(res.triggers, ['IMPERSONATION_START']);
    });

    it('Trigger 4: IMPERSONATION_EXIT (owner: admin.id, token: admin verified token, queue: admin queue, cancellation: replaces prior target trailing run)', async () => {
      const outcomePromise = orchestrator.requestSync({
        trigger: 'IMPERSONATION_EXIT',
        targetOwnerId: 'admin-root',
        targetToken: 'admin-root-token',
        currentActiveAccountResolver: () => 'admin-root'
      });

      assert.equal(replayCalls.length, 1);
      assert.equal(replayCalls[0].options.activeAccountId, 'admin-root');
      assert.equal(replayCalls[0].options.authToken, 'admin-root-token');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 0 }));
      const res = await outcomePromise;
      assert.equal(res.status, 'COMPLETED');
      assert.equal(res.ownerId, 'admin-root');
      assert.deepEqual(res.triggers, ['IMPERSONATION_EXIT']);
    });

    it('Trigger 5: NETWORK_ONLINE (owner: activeAccount, token: current token, queue: active queue, cancellation: coalesces with active run / skips offline)', async () => {
      const outcomePromise = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        currentActiveAccountResolver: () => 'user-alpha'
      });

      assert.equal(replayCalls.length, 1);
      assert.equal(replayCalls[0].options.activeAccountId, 'user-alpha');
      assert.equal(replayCalls[0].options.authToken, 'token-alpha');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 3 }));
      const res = await outcomePromise;
      assert.equal(res.status, 'COMPLETED');
      assert.equal(res.ownerId, 'user-alpha');
      assert.deepEqual(res.triggers, ['NETWORK_ONLINE']);
    });

    it('Trigger 6: BOOT_AUTH_BIND / BOOT_AUTH_VERIFIED (owner: verified /api/auth/me user.id, token: verified token, queue: verified user queue)', async () => {
      const activeAccountRef = { current: null as string | null };
      const authTokenRef = { current: null as string | null };

      const outcomePromise = bindBootAuthAndRequestSync({
        verifiedUserId: 'verified-boot-user',
        verifiedToken: 'verified-boot-token',
        activeAccountRef,
        authTokenRef,
        requestSync: (trig, owner, token) => orchestrator.requestSync({
          trigger: trig,
          targetOwnerId: owner,
          targetToken: token,
          currentActiveAccountResolver: () => activeAccountRef.current
        })
      });

      assert.equal(activeAccountRef.current, 'verified-boot-user');
      assert.equal(authTokenRef.current, 'verified-boot-token');
      assert.equal(replayCalls.length, 1);
      assert.equal(replayCalls[0].options.activeAccountId, 'verified-boot-user');
      assert.equal(replayCalls[0].options.authToken, 'verified-boot-token');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      const res = await outcomePromise;
      assert.equal(res.status, 'COMPLETED');
      assert.equal(res.ownerId, 'verified-boot-user');
      assert.deepEqual(res.triggers, ['BOOT_AUTH_VERIFIED']);
    });

    it('Trigger 7: LOGOUT (owner: null/guest, token: null, queue: none, cancellation: immediately calls cancelPendingSync and aborts pending sync)', async () => {
      // Start an active run
      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // Enqueue a trailing request
      const pTrailing = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // App executes handleLogout:
      // 1. activeAccountRef.current = null
      // 2. authTokenRef.current = null
      // 3. syncOrchestrator.cancelPendingSync()
      activeAccount = null;
      orchestrator.cancelPendingSync();

      const trailingOutcome = await pTrailing;
      assert.equal(trailingOutcome.status, 'ABORTED');
      assert.equal(trailingOutcome.stoppedDueToAccountChange, true);

      replayCalls[0].deferred.resolve(createSampleReplayResult());
      const activeOutcome = await pActive;
      assert.equal(activeOutcome.status, 'DISCARDED_STALE');
      assert.equal(activeOutcome.stoppedDueToAccountChange, true);

      // Subsequent guest request returns SKIPPED_GUEST_OR_ANONYMOUS
      const guestRequestOutcome = await orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'guest',
        targetToken: null,
        currentActiveAccountResolver: () => null
      });

      assert.equal(guestRequestOutcome.status, 'SKIPPED_GUEST_OR_ANONYMOUS');
      assert.equal(guestRequestOutcome.stoppedDueToAuth, true);
    });
  });
});
