import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SyncOrchestrator,
  createSyncOrchestrator,
  SyncTrigger,
  SyncRequest,
  SyncRunOutcome,
  bindBootAuthAndRequestSync,
  assertSyncInvariant
} from '../src/utils/syncOrchestrator.js';
import { ReplayOptions, ReplayResult } from '../src/utils/offlineQueueUtils.js';
import { OfflineQueueItem } from '../src/types.js';

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

describe('Phase 3C.1: Single Sync Orchestrator and Trigger Ownership', () => {
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

  describe('1. Concurrency, Serialization & Overlap Elimination', () => {
    it('(a) Two simultaneous requests do not execute overlapping replay runs', async () => {
      // Trigger request 1
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-1'
      });

      assert.equal(replayCalls.length, 1, 'First request immediately starts an active run');
      assert.equal(orchestrator.isRunActive(), true, 'Orchestrator marks run as active');

      // Trigger request 2 while request 1 is still in flight
      const p2 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-2'
      });

      // Assert NO overlapping second replay call occurred
      assert.equal(replayCalls.length, 1, 'Second request must not start an overlapping replay run');
      assert.equal(orchestrator.hasPendingTrailing(), true, 'Second request is retained as pending trailing run');

      // Resolve first run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 2 }));
      const outcome1 = await p1;

      assert.equal(outcome1.status, 'COMPLETED');
      assert.equal(outcome1.syncedCount, 2);

      // Now the trailing run should have automatically started
      assert.equal(replayCalls.length, 2, 'Trailing run is dispatched after first run completes');
      assert.equal(replayCalls[1].options.authToken, 'token-alpha-2', 'Trailing run uses its own token snapshot');

      // Resolve second run
      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      const outcome2 = await p2;

      assert.equal(outcome2.status, 'COMPLETED');
      assert.equal(outcome2.syncedCount, 1);
      assert.equal(orchestrator.isRunActive(), false, 'Orchestrator clears active run once all settle');
      assert.equal(orchestrator.hasPendingTrailing(), false, 'No pending trailing run remains');
    });

    it('(b) Equivalent same-owner trigger bursts are coalesced', async () => {
      // Start active run
      const pActive = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      assert.equal(replayCalls.length, 1);

      // Fire a burst of multiple same-owner triggers
      const pBurst1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });
      const pBurst2 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });
      const pBurst3 = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      assert.equal(replayCalls.length, 1, 'Burst does not start any overlapping runs');
      const trailingInfo = orchestrator.getPendingTrailing();
      assert.ok(trailingInfo, 'Single pending trailing run exists');
      assert.equal(trailingInfo?.ownerId, 'user-alpha');
      // Triggers are retained as a deduplicated set
      assert.ok(trailingInfo?.triggers.includes('NETWORK_ONLINE'));
      assert.ok(trailingInfo?.triggers.includes('BOOT_AUTH_VERIFIED'));
      assert.ok(trailingInfo?.triggers.includes('AUTH_SUCCESS'));

      // Finish active run
      replayCalls[0].deferred.resolve(createSampleReplayResult());
      await pActive;

      // Trailing run starts
      assert.equal(replayCalls.length, 2, 'Exactly one trailing run was started for the entire burst');

      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 3 }));
      const [res1, res2, res3] = await Promise.all([pBurst1, pBurst2, pBurst3]);

      assert.equal(res1.status, 'COMPLETED');
      assert.equal(res2.status, 'COMPLETED');
      assert.equal(res3.status, 'COMPLETED');
      assert.equal(res1.syncedCount, 3);
      assert.equal(res2.syncedCount, 3);
      assert.equal(res3.syncedCount, 3);
    });

    it('(c) & (d) Triggers during active run produce at most ONE trailing run, not an unbounded sequence', async () => {
      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // 10 triggers arrive during active run
      const promises: Promise<SyncRunOutcome>[] = [];
      for (let i = 0; i < 10; i++) {
        promises.push(
          orchestrator.requestSync({
            trigger: 'NETWORK_ONLINE',
            targetOwnerId: 'user-alpha',
            targetToken: 'token-alpha'
          })
        );
      }

      assert.equal(replayCalls.length, 1, 'Only the active run is in flight');

      // Settle active run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      await pActive;

      // Settle trailing run
      assert.equal(replayCalls.length, 2, 'Only ONE trailing run was spawned for all 10 triggers');
      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 5 }));

      const results = await Promise.all(promises);
      for (const res of results) {
        assert.equal(res.status, 'COMPLETED');
        assert.equal(res.syncedCount, 5);
      }

      // Verify no further runs are spawned
      assert.equal(replayCalls.length, 2, 'Total replay calls strictly capped at 2 (1 active + 1 trailing)');
      assert.equal(orchestrator.isRunActive(), false);
      assert.equal(orchestrator.hasPendingTrailing(), false);
    });

    it('(e) force=true dominates force=false for a coalesced same-owner trailing request', async () => {
      const pActive = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        force: false
      });

      // First trailing request: force=false
      const pTrailing1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        force: false
      });
      assert.equal(orchestrator.getPendingTrailing()?.force, false);

      // Second trailing request: MANUAL_FORCE (force=true)
      const pTrailing2 = orchestrator.requestSync({
        trigger: 'MANUAL_FORCE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        force: true
      });
      assert.equal(orchestrator.getPendingTrailing()?.force, true, 'force=true dominates pending trailing state');

      // Third trailing request: force=false
      const pTrailing3 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        force: false
      });
      assert.equal(orchestrator.getPendingTrailing()?.force, true, 'force=true continues to dominate');

      // Settle active run
      replayCalls[0].deferred.resolve(createSampleReplayResult());
      await pActive;

      // Check options of dispatched trailing run
      assert.equal(replayCalls.length, 2);
      assert.equal(replayCalls[1].options.force, true, 'Dispatched trailing run executed with force=true');
      assert.equal(replayCalls[1].options.respectBackoff, false, 'Backoff disabled when force is true');

      replayCalls[1].deferred.resolve(createSampleReplayResult());
      await Promise.all([pTrailing1, pTrailing2, pTrailing3]);
    });

    it('(f) Coalesced requests during active run invoke stable item-success and result callbacks only once', async () => {
      let itemSuccessInvocations = 0;
      let resultInvocations = 0;

      // Stable App-equivalent callbacks
      const stableItemSuccess = (_item: OfflineQueueItem) => {
        itemSuccessInvocations++;
      };
      const stableResult = (outcome: SyncRunOutcome) => {
        if (outcome.status === 'COMPLETED' && outcome.syncedCount > 0) {
          resultInvocations++;
        }
      };

      // Start initial active run (deferred)
      const pInitial = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-initial',
        onItemSuccess: stableItemSuccess,
        onResult: stableResult
      });

      assert.equal(replayCalls.length, 1, 'Initial run started');
      assert.equal(orchestrator.isRunActive(), true);

      // Burst 3 coalesced requests during active run with the exact same stable callbacks
      // Request 1: force=false
      const pBurst1 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-burst-1',
        force: false,
        onItemSuccess: stableItemSuccess,
        onResult: stableResult
      });

      // Request 2: force=true (should dominate)
      const pBurst2 = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-burst-2',
        force: true,
        onItemSuccess: stableItemSuccess,
        onResult: stableResult
      });

      // Request 3: force=false
      const pBurst3 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-burst-3',
        force: false,
        onItemSuccess: stableItemSuccess,
        onResult: stableResult
      });

      assert.equal(replayCalls.length, 1, 'Burst requests do not start parallel runs');
      assert.equal(orchestrator.hasPendingTrailing(), true);

      // Complete initial run (0 items replayed)
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 0 }));
      const initialOutcome = await pInitial;
      assert.equal(initialOutcome.status, 'COMPLETED');
      assert.equal(resultInvocations, 0, 'No toast when syncedCount is 0');

      // Now the trailing run begins
      assert.equal(replayCalls.length, 2, 'Exactly one trailing replay run created');
      const trailingCall = replayCalls[1];
      assert.equal(trailingCall.options.force, true, 'force=true dominates force=false');
      assert.equal(trailingCall.options.authToken, 'token-burst-3', 'Newest token used');

      // Simulate replaying 1 item in the trailing run
      const dummyItem: OfflineQueueItem = {
        id: 'mutation-1',
        type: 'UPDATE_LOG',
        payload: { date: '1403-01-01', completedHabitIds: ['h1'] },
        timestamp: Date.now(),
        retryCount: 0,
        ownerId: 'user-alpha'
      };

      trailingCall.options.onItemSuccess?.(dummyItem);
      assert.equal(
        itemSuccessInvocations,
        1,
        'Item-success callback invoked exactly once despite 3 coalesced trigger requests'
      );

      // Resolve trailing run with syncedCount: 1
      trailingCall.deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));

      const [out1, out2, out3] = await Promise.all([pBurst1, pBurst2, pBurst3]);

      // All callers received outcome
      assert.equal(out1.status, 'COMPLETED');
      assert.equal(out2.status, 'COMPLETED');
      assert.equal(out3.status, 'COMPLETED');
      assert.equal(out1.syncedCount, 1);
      assert.equal(out2.syncedCount, 1);
      assert.equal(out3.syncedCount, 1);

      // Result callback invoked only once
      assert.equal(
        resultInvocations,
        1,
        'Success notification callback invoked exactly once for the completed trailing run'
      );

      // Trigger metadata deduplicated
      const sortedTriggers = [...out1.triggers].sort();
      assert.deepEqual(
        sortedTriggers,
        ['AUTH_SUCCESS', 'BOOT_AUTH_VERIFIED', 'NETWORK_ONLINE'],
        'Triggers set deduplicates repeat triggers (NETWORK_ONLINE appeared twice, stored once)'
      );
    });
  });

  describe('2. Account Transitions & Identity Partition Isolation', () => {
    it('(f) A pending User A request is discarded after switching to User B', async () => {
      // User A starts active run
      const pActiveA = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // User A enqueues a trailing request
      const pTrailingA = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });
      assert.equal(orchestrator.getPendingTrailing()?.ownerId, 'user-alpha');

      // Account transition occurs while User A run is still active: User B signs in!
      activeAccount = 'user-beta';
      const pTrailingB = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-beta',
        targetToken: 'token-beta'
      });

      // The pending User A request must be discarded immediately
      const outcomeA = await pTrailingA;
      assert.equal(outcomeA.status, 'DISCARDED_STALE');
      assert.equal(outcomeA.stoppedDueToAccountChange, true);
      assert.equal(outcomeA.ownerId, 'user-alpha');

      // The pending trailing slot is now owned by User B
      assert.equal(orchestrator.getPendingTrailing()?.ownerId, 'user-beta');

      // Finish active User A run (note: replay itself notes account change)
      replayCalls[0].deferred.resolve(createSampleReplayResult({
        syncedCount: 0,
        stoppedDueToAccountChange: true
      }));
      await pActiveA;

      // Trailing run for User B starts
      assert.equal(replayCalls.length, 2);
      assert.equal(replayCalls[1].options.activeAccountId, 'user-beta');
      assert.equal(replayCalls[1].options.authToken, 'token-beta');

      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 2 }));
      const outcomeB = await pTrailingB;
      assert.equal(outcomeB.status, 'COMPLETED');
      assert.equal(outcomeB.syncedCount, 2);
      assert.equal(outcomeB.ownerId, 'user-beta');
    });

    it('(g) A valid User B request becomes the trailing run after an active User A run settles', async () => {
      // Active run for User A
      const pActiveA = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // Switch to User B
      activeAccount = 'user-beta';
      const pTrailingB = orchestrator.requestSync({
        trigger: 'QUICK_LOGIN_SUCCESS',
        targetOwnerId: 'user-beta',
        targetToken: 'token-beta'
      });

      // Settle User A
      replayCalls[0].deferred.resolve(createSampleReplayResult({ stoppedDueToAccountChange: true }));
      await pActiveA;

      // Trailing run executes for User B
      assert.equal(replayCalls.length, 2);
      assert.equal(replayCalls[1].options.activeAccountId, 'user-beta');

      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 4 }));
      const outcomeB = await pTrailingB;
      assert.equal(outcomeB.status, 'COMPLETED');
      assert.equal(outcomeB.syncedCount, 4);
    });

    it('(h) Owner and token snapshots are never mixed across requests', async () => {
      // User A
      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-secure'
      });

      assert.equal(replayCalls[0].options.activeAccountId, 'user-alpha');
      assert.equal(replayCalls[0].options.authToken, 'token-alpha-secure');

      // User B
      activeAccount = 'user-beta';
      const pB = orchestrator.requestSync({
        trigger: 'IMPERSONATION_START',
        targetOwnerId: 'user-beta',
        targetToken: 'token-beta-secure'
      });

      replayCalls[0].deferred.resolve(createSampleReplayResult({ stoppedDueToAccountChange: true }));
      await pActive;

      // Assert User B received User B's token, never User A's token
      assert.equal(replayCalls[1].options.activeAccountId, 'user-beta');
      assert.equal(replayCalls[1].options.authToken, 'token-beta-secure');

      replayCalls[1].deferred.resolve(createSampleReplayResult());
      await pB;
    });

    it('(i) Logout or an absent active authenticated account suppresses a pending replay', async () => {
      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // Queue trailing
      const pTrailing = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // User logs out (active account becomes null or guest, cancelPendingSync called)
      activeAccount = null;
      orchestrator.cancelPendingSync();

      const trailingOutcome = await pTrailing;
      assert.equal(trailingOutcome.status, 'ABORTED');
      assert.equal(trailingOutcome.stoppedDueToAccountChange, true);

      // Complete active run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ stoppedDueToAccountChange: true }));
      await pActive;

      // No trailing run is executed
      assert.equal(replayCalls.length, 1, 'No trailing replay run is executed after logout');
      assert.equal(orchestrator.isRunActive(), false);
      assert.equal(orchestrator.hasPendingTrailing(), false);
    });

    it('(j) A stale run cannot emit visible item success or a success notification after an account transition', async () => {
      let visibleItemSyncCount = 0;
      let visibleResultNotificationCount = 0;

      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        onItemSuccess: (_item: OfflineQueueItem) => {
          visibleItemSyncCount++;
        },
        onResult: (_outcome: SyncRunOutcome) => {
          visibleResultNotificationCount++;
        }
      });

      assert.equal(replayCalls.length, 1);

      // Account transition happens during replay!
      activeAccount = 'user-beta';

      // Simulate replay attempting to invoke onItemSuccess
      const sampleItem: OfflineQueueItem = {
        id: 'item-1',
        ownerId: 'user-alpha',
        type: 'UPDATE_LOG',
        payload: { date: '2026-09-04' },
        timestamp: Date.now()
      };
      replayCalls[0].options.onItemSuccess?.(sampleItem);

      // Assert visible item success was suppressed!
      assert.equal(
        visibleItemSyncCount,
        0,
        'Visible item state update must be suppressed when active account changes'
      );

      // Replay finishes, reporting synced items
      replayCalls[0].deferred.resolve(createSampleReplayResult({
        syncedCount: 3,
        stoppedDueToAccountChange: true
      }));

      const outcome = await pActive;
      assert.equal(outcome.status, 'DISCARDED_STALE');
      assert.equal(outcome.stoppedDueToAccountChange, true);
      assert.equal(
        visibleResultNotificationCount,
        0,
        'Visible result toast notification must not fire for a stale run'
      );
    });
  });

  describe('3. Resilience, Error Release & Sensitive Payload Redaction', () => {
    it('(k) Errors or rejected replay promises release active-run ownership and do not permanently block later requests', async () => {
      // First run rejects with an unexpected error
      const p1 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      assert.equal(orchestrator.isRunActive(), true);
      replayCalls[0].deferred.reject(new Error('Network catastrophic failure'));

      const outcome1 = await p1;
      assert.equal(outcome1.status, 'FAILED');
      assert.ok(outcome1.error);
      assert.equal(orchestrator.isRunActive(), false, 'Active run flag is released after failure');

      // Subsequent valid request succeeds cleanly
      const p2 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      assert.equal(replayCalls.length, 2, 'Subsequent request is permitted and runs');
      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));

      const outcome2 = await p2;
      assert.equal(outcome2.status, 'COMPLETED');
      assert.equal(outcome2.syncedCount, 1);
    });

    it('(l) Trigger metadata does not retain authentication tokens or mutation payloads', async () => {
      const pActive = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'SUPER_SECRET_BEARER_TOKEN_12345'
      });

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      const outcome = await pActive;

      const serialized = JSON.stringify(outcome);
      assert.ok(!serialized.includes('SUPER_SECRET_BEARER_TOKEN_12345'), 'Bearer token must not leak in outcome');
      assert.deepEqual(outcome.triggers, ['AUTH_SUCCESS'], 'Outcome only contains closed trigger name');
    });

    it('Offline mode returns SKIPPED_OFFLINE without calling replayExecutor', async () => {
      const offlineOrchestrator = createSyncOrchestrator({
        currentActiveAccountResolver: () => 'user-alpha',
        isOnlineResolver: () => false,
        replayExecutor: async () => {
          throw new Error('Should not be called offline');
        }
      });

      const outcome = await offlineOrchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      assert.equal(outcome.status, 'SKIPPED_OFFLINE');
      assert.equal(outcome.syncedCount, 0);
    });

    it('Guest or tokenless requests return SKIPPED_GUEST_OR_ANONYMOUS without calling replayExecutor', async () => {
      let callCount = 0;
      const testOrch = createSyncOrchestrator({
        currentActiveAccountResolver: () => 'guest',
        isOnlineResolver: () => true,
        replayExecutor: async (opts) => {
          callCount++;
          return createSampleReplayResult();
        }
      });

      // Test guest
      const resGuest = await testOrch.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'guest',
        targetToken: 'token-123'
      });
      assert.equal(resGuest.status, 'SKIPPED_GUEST_OR_ANONYMOUS');
      assert.equal(callCount, 0);

      // Test missing token
      const resTokenless = await testOrch.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: ''
      });
      assert.equal(resTokenless.status, 'SKIPPED_GUEST_OR_ANONYMOUS');
      assert.equal(callCount, 0);
    });
  });

  describe('4. Production Wiring & App.tsx Source-Contract Invariants', () => {
    it('App.tsx routes all 6 verified triggers through requestSync orchestrator gateway', () => {
      const appContent = fs.readFileSync('src/App.tsx', 'utf-8');

      // 1. All 6 triggers exist as closed vocabulary in App.tsx
      assert.ok(
        appContent.includes("requestSync('NETWORK_ONLINE')"),
        'App.tsx routes browser online through requestSync(NETWORK_ONLINE)'
      );
      assert.ok(
        appContent.includes("requestSync('BOOT_AUTH_VERIFIED'") || appContent.includes('bindBootAuthAndRequestSync'),
        'App.tsx routes boot auth verified through bindBootAuthAndRequestSync / requestSync(BOOT_AUTH_VERIFIED)'
      );
      assert.ok(
        appContent.includes("requestSync('AUTH_SUCCESS'"),
        'App.tsx routes handleAuthSuccess through requestSync(AUTH_SUCCESS)'
      );
      assert.ok(
        appContent.includes("requestSync('QUICK_LOGIN_SUCCESS'"),
        'App.tsx routes handleQuickLogin through requestSync(QUICK_LOGIN_SUCCESS)'
      );
      assert.ok(
        appContent.includes("requestSync('IMPERSONATION_START'"),
        'App.tsx routes handleImpersonateUser through requestSync(IMPERSONATION_START)'
      );
      assert.ok(
        appContent.includes("requestSync('IMPERSONATION_EXIT'"),
        'App.tsx routes handleExitImpersonation through requestSync(IMPERSONATION_EXIT)'
      );

      // 2. Direct replayAccountOfflineQueue invocation / import / return / alias is NOT present in executable code
      // Strip comments so references inside comments do not cause false positives
      const strippedAppContent = appContent
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      // Direct import
      const directImportMatch = strippedAppContent.match(/\bimport\s+[^;]*\breplayAccountOfflineQueue\b[^;]*;/);
      assert.equal(
        directImportMatch,
        null,
        'App.tsx must not import replayAccountOfflineQueue directly'
      );

      // Alias import
      const aliasImportMatch = strippedAppContent.match(/\breplayAccountOfflineQueue\s+as\s+\w+/);
      assert.equal(
        aliasImportMatch,
        null,
        'App.tsx must not alias replayAccountOfflineQueue import'
      );

      // Direct invocation with or without await
      const directInvocationMatch = strippedAppContent.match(/\breplayAccountOfflineQueue\s*\(/);
      assert.equal(
        directInvocationMatch,
        null,
        'App.tsx must not call replayAccountOfflineQueue directly (with or without await)'
      );

      // Direct return
      const directReturnMatch = strippedAppContent.match(/\breturn\s+[^;]*\breplayAccountOfflineQueue\b/);
      assert.equal(
        directReturnMatch,
        null,
        'App.tsx must not return a direct replay call'
      );

      // 3. syncOrchestrator is instantiated via createSyncOrchestrator
      assert.ok(
        appContent.includes('createSyncOrchestrator'),
        'App.tsx instantiates orchestrator via createSyncOrchestrator'
      );

      // 4. Logout cancels pending orchestrator sync
      assert.ok(
        appContent.includes('syncOrchestrator.cancelPendingSync()'),
        'App.tsx cancels pending sync on logout'
      );

      // 5. Obsolete syncOfflineDataToServer wrapper is removed
      assert.ok(
        !appContent.includes('syncOfflineDataToServer'),
        'App.tsx must not declare or retain obsolete syncOfflineDataToServer wrapper'
      );

      // 6. Verified boot binding helper is imported and used
      assert.ok(
        appContent.includes('bindBootAuthAndRequestSync'),
        'App.tsx imports and uses bindBootAuthAndRequestSync for verified boot binding'
      );
    });
  });

  describe('5. BOOT_AUTH_VERIFIED Identity Binding & Account Transition Safety', () => {
    it('(a, c, d) Cold authenticated boot with initially null activeAccountRef binds verified identity and requests replay successfully', async () => {
      const activeAccountRef = { current: null as string | null };
      const authTokenRef = { current: null as string | null };
      let localActiveAccount: string | null = null;
      let executorOptions: ReplayOptions | null = null;

      const testOrch = createSyncOrchestrator({
        currentActiveAccountResolver: () => activeAccountRef.current,
        isOnlineResolver: () => true,
        replayExecutor: async (options) => {
          executorOptions = options;
          return createSampleReplayResult({ syncedCount: 3 });
        }
      });

      const bootPromise = bindBootAuthAndRequestSync({
        verifiedUserId: 'cold-user-1',
        verifiedToken: 'cold-token-jwt',
        activeAccountRef,
        authTokenRef,
        setActiveAccountId: (id) => { localActiveAccount = id; },
        requestSync: (trigger, owner, token, force) => testOrch.requestSync({
          trigger,
          targetOwnerId: owner,
          targetToken: token,
          force,
          currentActiveAccountResolver: () => activeAccountRef.current
        })
      });

      // Synchronous binding before replay execution
      assert.equal(activeAccountRef.current, 'cold-user-1', 'activeAccountRef is bound to verified user ID');
      assert.equal(authTokenRef.current, 'cold-token-jwt', 'authTokenRef is bound to verified token');
      assert.equal(localActiveAccount, 'cold-user-1', 'Local active account pointer is synchronized');

      const outcome = await bootPromise;
      assert.equal(outcome.status, 'COMPLETED', 'Legitimate boot request is not incorrectly returned as DISCARDED_STALE');
      assert.equal(outcome.syncedCount, 3);
      assert.equal(outcome.ownerId, 'cold-user-1');
      assert.ok(executorOptions !== null);
      assert.equal((executorOptions as ReplayOptions).activeAccountId, 'cold-user-1', 'Executor receives exact verified owner');
      assert.equal((executorOptions as ReplayOptions).authToken, 'cold-token-jwt', 'Executor receives exact corresponding token');
    });

    it('(b) Automatic quick-login boot binds returned user ID and token before BOOT_AUTH_VERIFIED request', async () => {
      // Starts in guest state
      const activeAccountRef = { current: 'guest' as string | null };
      const authTokenRef = { current: null as string | null };
      let localActiveAccount = 'guest';
      let executorOptions: ReplayOptions | null = null;

      const testOrch = createSyncOrchestrator({
        currentActiveAccountResolver: () => activeAccountRef.current,
        isOnlineResolver: () => true,
        replayExecutor: async (options) => {
          executorOptions = options;
          return createSampleReplayResult({ syncedCount: 2 });
        }
      });

      // Auto quick-login response data
      const quickLoginData = {
        user: { id: 'admin-auto-login-42' },
        token: 'token-auto-login-42'
      };

      const bootPromise = bindBootAuthAndRequestSync({
        verifiedUserId: quickLoginData.user.id,
        verifiedToken: quickLoginData.token,
        activeAccountRef,
        authTokenRef,
        setActiveAccountId: (id) => { localActiveAccount = id || 'guest'; },
        requestSync: (trigger, owner, token, force) => testOrch.requestSync({
          trigger,
          targetOwnerId: owner,
          targetToken: token,
          force,
          currentActiveAccountResolver: () => activeAccountRef.current
        })
      });

      assert.equal(activeAccountRef.current, 'admin-auto-login-42');
      assert.equal(authTokenRef.current, 'token-auto-login-42');
      assert.equal(localActiveAccount, 'admin-auto-login-42');

      const outcome = await bootPromise;
      assert.equal(outcome.status, 'COMPLETED');
      assert.equal(outcome.syncedCount, 2);
      assert.equal((executorOptions as unknown as ReplayOptions).activeAccountId, 'admin-auto-login-42');
      assert.equal((executorOptions as unknown as ReplayOptions).authToken, 'token-auto-login-42');
    });

    it('(e) If account changes before replay begins or completes, stale success remains suppressed', async () => {
      const activeAccountRef = { current: null as string | null };
      const authTokenRef = { current: null as string | null };
      let itemSuccessInvocations = 0;
      let resultInvocations = 0;
      const replayDeferred = createDeferred<ReplayResult>();

      const testOrch = createSyncOrchestrator({
        currentActiveAccountResolver: () => activeAccountRef.current,
        isOnlineResolver: () => true,
        replayExecutor: () => replayDeferred.promise
      });

      const bootPromise = bindBootAuthAndRequestSync({
        verifiedUserId: 'user-original',
        verifiedToken: 'token-original',
        activeAccountRef,
        authTokenRef,
        requestSync: (trigger, owner, token, force) => testOrch.requestSync({
          trigger,
          targetOwnerId: owner,
          targetToken: token,
          force,
          currentActiveAccountResolver: () => activeAccountRef.current,
          onItemSuccess: () => { itemSuccessInvocations++; },
          onResult: (outcome) => {
            if (outcome.status === 'COMPLETED') {
              resultInvocations++;
            }
          }
        })
      });

      assert.equal(testOrch.isRunActive(), true);

      // While replay is in flight, user switches account (e.g. impersonation or logout)
      activeAccountRef.current = 'user-switched';
      authTokenRef.current = 'token-switched';

      // Settle replay for user-original
      replayDeferred.resolve(createSampleReplayResult({ syncedCount: 1 }));

      const outcome = await bootPromise;
      assert.equal(outcome.status, 'DISCARDED_STALE', 'Outcome marked DISCARDED_STALE');
      assert.equal(outcome.stoppedDueToAccountChange, true, 'stoppedDueToAccountChange is true');
      assert.equal(itemSuccessInvocations, 0, 'Item-success callback is suppressed');
      assert.equal(resultInvocations, 0, 'Result notification callback is suppressed');
    });
  });

  describe('8. Sync Orchestrator Invariant Assertions & Diagnostics', () => {
    it('(a) assertSyncInvariant does not require global process object and executes safely in browser environment', () => {
      const originalWarn = console.warn;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };
      const originalProcess = (globalThis as any).process;

      try {
        (globalThis as any).process = undefined;

        assert.doesNotThrow(() => {
          assertSyncInvariant(true, 'Test no process true');
          assertSyncInvariant(false, 'Test no process false');
        });
      } finally {
        (globalThis as any).process = originalProcess;
        console.warn = originalWarn;
      }
    });

    it('(b) assertSyncInvariant emits sanitized diagnostic in development and is silenced in production', () => {
      const originalWarn = console.warn;
      const originalEnv = process.env.NODE_ENV;
      const warnings: string[] = [];
      console.warn = (msg: string) => { warnings.push(msg); };

      try {
        process.env.NODE_ENV = 'development';
        warnings.length = 0;

        assertSyncInvariant(true, 'Condition satisfied');
        assert.equal(warnings.length, 0);

        assertSyncInvariant(false, 'Active run ownerId must be a non-guest, non-empty user ID');
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0], '[SyncInvariantViolation] Active run ownerId must be a non-guest, non-empty user ID');

        // Check diagnostic contains no sensitive information
        assert.ok(!warnings[0].includes('token'));
        assert.ok(!warnings[0].includes('Bearer'));

        process.env.NODE_ENV = 'production';
        warnings.length = 0;
        assertSyncInvariant(false, 'Production invariant failure');
        assert.equal(warnings.length, 0, 'Production must silence warnings');
      } finally {
        process.env.NODE_ENV = originalEnv;
        console.warn = originalWarn;
      }
    });
  });
});
