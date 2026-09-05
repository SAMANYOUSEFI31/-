import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  SyncOrchestrator,
  createSyncOrchestrator,
  SyncTrigger,
  SyncRequest,
  SyncRunOutcome
} from '../src/utils/syncOrchestrator.js';
import {
  reconcileBootState,
  ReconcileBootStateInput
} from '../src/utils/syncReconciliation.js';
import {
  SyncDiagnosticRecord,
  SyncDiagnosticSink,
  InMemoryDiagnosticSink,
  generateDiagnosticRunId,
  classifySafeError,
  classifyReplayFailureToSafeCategory,
  setSyncDiagnosticSink,
  resetSyncDiagnosticSink,
  getRecentDiagnosticRecords,
  clearDiagnosticRecords,
  MAX_DIAGNOSTIC_RECORDS
} from '../src/utils/syncDiagnostics.js';
import { ReplayOptions, ReplayResult } from '../src/utils/offlineQueueUtils.js';
import { OfflineQueueItem, Cycle, DailyLog, UserProfile } from '../src/types.js';

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

describe('Phase 4: Production-Safe Sync Observability and Diagnostics', () => {
  let testSink: InMemoryDiagnosticSink;
  let orchestrator: SyncOrchestrator;
  let activeAccount: string | null;
  let replayCalls: Array<{
    options: ReplayOptions;
    deferred: ReturnType<typeof createDeferred<ReplayResult>>;
  }>;

  beforeEach(() => {
    testSink = new InMemoryDiagnosticSink(100);
    setSyncDiagnosticSink(testSink);
    activeAccount = 'user-alpha';
    replayCalls = [];

    orchestrator = createSyncOrchestrator({
      currentActiveAccountResolver: () => activeAccount,
      isOnlineResolver: () => true,
      diagnosticSink: testSink,
      replayExecutor: (options: ReplayOptions) => {
        const deferred = createDeferred<ReplayResult>();
        replayCalls.push({ options, deferred });
        return deferred.promise;
      }
    });
  });

  describe('1. Correlation Identifier & Event Cardinality', () => {
    it('(a) One actual active run emits one RUN_STARTED event with opaque runId', async () => {
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-1'
      });

      assert.equal(replayCalls.length, 1);
      const records = testSink.getRecords();

      const requestedEvents = records.filter(r => r.eventType === 'RUN_REQUESTED');
      assert.equal(requestedEvents.length, 1, 'Emits RUN_REQUESTED for the incoming request');

      const startedEvents = records.filter(r => r.eventType === 'RUN_STARTED');
      assert.equal(startedEvents.length, 1, 'Emits exactly one RUN_STARTED for actual active run');
      assert.ok(startedEvents[0].runId, 'RUN_STARTED contains a runId');
      assert.match(startedEvents[0].runId!, /^sync_run_\d+_\d+_[a-z0-9]+$/, 'runId has opaque structured format');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      const outcome = await p1;

      assert.equal(outcome.status, 'COMPLETED');
      assert.equal(outcome.runId, startedEvents[0].runId, 'Outcome references the active runId');

      const completedEvents = testSink.getRecords().filter(r => r.eventType === 'RUN_COMPLETED');
      assert.equal(completedEvents.length, 1, 'Emits exactly one RUN_COMPLETED');
      assert.equal(completedEvents[0].runId, startedEvents[0].runId, 'RUN_COMPLETED shares identical runId');
      assert.equal(completedEvents[0].syncedCount, 1);
    });

    it('(b) Coalesced requests do not emit additional RUN_STARTED events', async () => {
      // Start active run
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-1'
      });

      assert.equal(replayCalls.length, 1);

      // Trigger 3 coalesced requests during the in-flight run
      const p2 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-2'
      });

      const p3 = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-3'
      });

      const p4 = orchestrator.requestSync({
        trigger: 'MANUAL_FORCE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-4',
        force: true
      });

      const intermediateRecords = testSink.getRecords();
      const startedBeforeTrailing = intermediateRecords.filter(r => r.eventType === 'RUN_STARTED');
      assert.equal(startedBeforeTrailing.length, 1, 'Still only one RUN_STARTED event while active run is in flight');

      const coalescedEvents = intermediateRecords.filter(r => r.eventType === 'RUN_COALESCED');
      assert.equal(coalescedEvents.length, 2, 'Two duplicate pending requests were recorded as RUN_COALESCED');

      // Resolve first run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 2 }));
      await p1;

      // Trailing run should start now
      assert.equal(replayCalls.length, 2, 'Trailing run automatically starts');

      const recordsAfterTrailingStart = testSink.getRecords();
      const startedEvents = recordsAfterTrailingStart.filter(r => r.eventType === 'RUN_STARTED');
      assert.equal(startedEvents.length, 2, 'Trailing run emitted its own RUN_STARTED event');
      assert.notEqual(startedEvents[0].runId, startedEvents[1].runId, 'Trailing run has a distinct runId');

      // Resolve trailing run
      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 3 }));
      const [out2, out3, out4] = await Promise.all([p2, p3, p4]);

      assert.equal(out2.status, 'COMPLETED');
      assert.equal(out3.status, 'COMPLETED');
      assert.equal(out4.status, 'COMPLETED');
      assert.equal(out2.runId, startedEvents[1].runId);
      assert.equal(out3.runId, startedEvents[1].runId);
      assert.equal(out4.runId, startedEvents[1].runId);
    });

    it('(c) A trailing run receives a distinct run ID when it actually starts', async () => {
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-1'
      });

      const p2 = orchestrator.requestSync({
        trigger: 'QUICK_LOGIN_SUCCESS',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-2'
      });

      // Finish first run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      const out1 = await p1;

      // Finish trailing run
      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 2 }));
      const out2 = await p2;

      assert.ok(out1.runId);
      assert.ok(out2.runId);
      assert.notEqual(out1.runId, out2.runId, 'Trailing run receives a completely distinct run ID');
    });

    it('(d) Trigger storms remain bounded to one active and one trailing run', async () => {
      const promises: Array<Promise<SyncRunOutcome>> = [];

      // Burst of 20 rapid triggers
      for (let i = 0; i < 20; i++) {
        promises.push(
          orchestrator.requestSync({
            trigger: i % 2 === 0 ? 'NETWORK_ONLINE' : 'AUTH_SUCCESS',
            targetOwnerId: 'user-alpha',
            targetToken: `token-burst-${i}`
          })
        );
      }

      assert.equal(replayCalls.length, 1, 'Only one active run is in flight');
      assert.equal(orchestrator.hasPendingTrailing(), true);

      // Resolve first run
      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      await promises[0];

      // Second run is executing now
      assert.equal(replayCalls.length, 2, 'Exactly one trailing run was dispatched');

      // Resolve second run
      replayCalls[1].deferred.resolve(createSampleReplayResult({ syncedCount: 5 }));
      const remainingOutcomes = await Promise.all(promises.slice(1));

      assert.equal(replayCalls.length, 2, 'Total replay calls strictly bounded to 2 despite 20 triggers');

      const startedEvents = testSink.getRecords().filter(r => r.eventType === 'RUN_STARTED');
      assert.equal(startedEvents.length, 2, 'Exactly 2 RUN_STARTED events for the entire 20-trigger storm');

      for (const outcome of remainingOutcomes) {
        assert.equal(outcome.status, 'COMPLETED');
      }
    });
  });

  describe('2. Truthful Outcome Categories & Stopping Reasons', () => {
    it('(e1) Offline outcome emits truthful RUN_SKIPPED with OFFLINE category', async () => {
      const offlineOrchestrator = createSyncOrchestrator({
        currentActiveAccountResolver: () => 'user-alpha',
        isOnlineResolver: () => false,
        diagnosticSink: testSink
      });

      const outcome = await offlineOrchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      assert.equal(outcome.status, 'SKIPPED_OFFLINE');

      const skipped = testSink.getRecords().find(r => r.eventType === 'RUN_SKIPPED');
      assert.ok(skipped);
      assert.equal(skipped.errorCategory, 'OFFLINE');
      assert.equal(skipped.safeReason, 'OFFLINE');
      assert.equal(skipped.outcomeStatus, 'SKIPPED_OFFLINE');
    });

    it('(e2) Anonymous or guest request emits truthful RUN_SKIPPED with AUTH category', async () => {
      const outcome = await orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: 'guest',
        targetToken: null
      });

      assert.equal(outcome.status, 'SKIPPED_GUEST_OR_ANONYMOUS');

      const skipped = testSink.getRecords().find(r => r.eventType === 'RUN_SKIPPED');
      assert.ok(skipped);
      assert.equal(skipped.errorCategory, 'AUTH');
      assert.equal(skipped.safeReason, 'GUEST_OR_ANONYMOUS');
    });

    it('(e3) Stale active run emits RUN_DISCARDED_STALE with ACCOUNT_CHANGE category', async () => {
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      // Switch active account while run is preparing / executing
      activeAccount = 'user-beta';

      // Complete execution
      replayCalls[0].deferred.resolve(createSampleReplayResult({
        syncedCount: 0,
        stoppedDueToAccountChange: true
      }));

      const outcome = await p1;
      assert.equal(outcome.status, 'DISCARDED_STALE');

      const discarded = testSink.getRecords().find(r => r.eventType === 'RUN_DISCARDED_STALE');
      assert.ok(discarded);
      assert.equal(discarded.errorCategory, 'ACCOUNT_CHANGE');
      assert.equal(discarded.safeReason, 'ACCOUNT_CHANGED');
    });

    it('(e4) Cancelled pending sync emits RUN_ABORTED', async () => {
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      const p2 = orchestrator.requestSync({
        trigger: 'BOOT_AUTH_VERIFIED',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha-pending'
      });

      // User logs out, canceling pending sync
      orchestrator.cancelPendingSync();

      const aborted = testSink.getRecords().find(r => r.eventType === 'RUN_ABORTED');
      assert.ok(aborted);
      assert.equal(aborted.outcomeStatus, 'ABORTED');
      assert.equal(aborted.safeReason, 'USER_ABORT');

      const out2 = await p2;
      assert.equal(out2.status, 'ABORTED');

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 1 }));
      await p1;
    });

    it('(e5) Failed replay execution emits RUN_FAILED with classified error category', async () => {
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      const networkErr = new TypeError('Failed to fetch from /api/cycles');
      replayCalls[0].deferred.reject(networkErr);

      const outcome = await p1;
      assert.equal(outcome.status, 'FAILED');

      const failed = testSink.getRecords().find(r => r.eventType === 'RUN_FAILED');
      assert.ok(failed);
      assert.equal(failed.errorCategory, 'NETWORK');
      assert.equal(failed.outcomeStatus, 'FAILED');
      assert.equal(failed.safeReason, 'ERROR');
    });

    it('(f) Lock loss emits LOCK_LOST and no successful-completion diagnostic', async () => {
      const p1 = orchestrator.requestSync({
        trigger: 'NETWORK_ONLINE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha'
      });

      replayCalls[0].deferred.resolve(createSampleReplayResult({
        syncedCount: 0,
        failedCount: 0,
        stoppedDueToLockLoss: true
      }));

      const outcome = await p1;
      assert.equal(outcome.stoppedDueToLockLoss, true);

      const records = testSink.getRecords();
      const lockLost = records.find(r => r.eventType === 'LOCK_LOST');
      assert.ok(lockLost, 'LOCK_LOST diagnostic is emitted');
      assert.equal(lockLost.errorCategory, 'LOCK_LOSS');
      assert.equal(lockLost.safeReason, 'LOCK_LOST');

      const completed = records.find(r => r.eventType === 'RUN_COMPLETED');
      assert.equal(completed, undefined, 'No successful-completion diagnostic is emitted on lock loss');
    });
  });

  describe('3. Diagnostic Sink Fault Tolerance & Ring Buffer Retention', () => {
    it('(g) Diagnostic sink failure does not change replay outcome or throw', async () => {
      const throwingSink: SyncDiagnosticSink = {
        record: () => {
          throw new Error('Database/Sink connection crashed!');
        }
      };

      const resilientOrchestrator = createSyncOrchestrator({
        currentActiveAccountResolver: () => 'user-alpha',
        isOnlineResolver: () => true,
        diagnosticSink: throwingSink,
        replayExecutor: async () => createSampleReplayResult({ syncedCount: 5 })
      });

      // Must complete successfully without throwing sink error into caller
      const outcome = await resilientOrchestrator.requestSync({
        trigger: 'MANUAL_FORCE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        force: true
      });

      assert.equal(outcome.status, 'COMPLETED');
      assert.equal(outcome.syncedCount, 5);
    });

    it('Enforces bounded in-memory FIFO retention without unbounded memory growth', () => {
      const boundedSink = new InMemoryDiagnosticSink(5);

      for (let i = 0; i < 10; i++) {
        boundedSink.record({
          eventType: 'RUN_REQUESTED',
          timestamp: i,
          itemCount: i
        });
      }

      const records = boundedSink.getRecords();
      assert.equal(records.length, 5, 'Ring buffer capped at maxRecords (5)');
      assert.equal(records[0].itemCount, 5, 'Oldest records (0-4) were discarded first');
      assert.equal(records[4].itemCount, 9, 'Newest record is at the tail');
    });
  });

  describe('4. Boot Reconciliation Diagnostics', () => {
    it('(k) Reconciliation diagnostics contain aggregate counts only', () => {
      const remoteCycles: Cycle[] = [
        {
          id: 'remote-cycle-1',
          title: 'Remote Master Cycle',
          startDate: '2026-09-01',
          endDate: '2026-11-29',
          targetTheme: 'Iron Will',
          isSynced: true
        }
      ];

      const remoteLogs: DailyLog[] = [
        {
          id: 'log-1',
          cycleId: 'remote-cycle-1',
          date: '2026-09-01',
          createdAt: '2026-09-01T00:00:00.000Z',
          wakeUp: true,
          workout: true,
          study: true,
          journal: true,
          hardTask: true,
          specialMission: false,
          isSynced: true
        }
      ];

      const pendingQueue: OfflineQueueItem[] = [
        {
          id: 'queue-1',
          ownerId: 'user-alpha',
          type: 'UPDATE_LOG',
          payload: {
            cycleId: 'remote-cycle-1',
            date: '2026-09-02',
            wakeUp: true,
            workout: false,
            study: true,
            journal: true,
            hardTask: true,
            specialMission: false
          },
          timestamp: Date.now()
        }
      ];

      const localCycles: Cycle[] = [...remoteCycles];
      const localLogs: DailyLog[] = [...remoteLogs];

      const result = reconcileBootState({
        authenticatedOwnerId: 'user-alpha',
        remoteCycles,
        remoteLogs,
        currentLocalState: {
          cycles: localCycles,
          logs: localLogs
        },
        pendingQueue,
        isDemoConsumed: false,
        diagnosticSink: testSink
      });

      assert.ok(result.cycles);
      assert.ok(result.logs);

      const records = testSink.getRecords();
      const reconEvent = records.find(r => r.eventType === 'RECONCILIATION_COMPLETED');
      assert.ok(reconEvent, 'RECONCILIATION_COMPLETED event is emitted');

      // Assert only approved aggregate numbers exist
      assert.equal(reconEvent.remoteCyclesCount, 1);
      assert.equal(reconEvent.remoteLogsCount, 1);
      assert.equal(reconEvent.pendingMutationsCount, 1);
      assert.equal(reconEvent.reconciledCyclesCount, 1);
      assert.equal(reconEvent.reconciledLogsCount, 2);
      assert.equal(typeof reconEvent.demoConsumedChanged, 'boolean');

      // Ensure no entity IDs or payloads were attached to the diagnostic record
      const serialized = JSON.stringify(reconEvent);
      assert.equal(serialized.includes('remote-cycle-1'), false);
      assert.equal(serialized.includes('Iron Will'), false);
      assert.equal(serialized.includes('2026-09-02'), false);
    });

    it('(l) Repeated reconciliation does not mutate the queue or input state', () => {
      const pendingQueue: OfflineQueueItem[] = [
        {
          id: 'queue-1',
          ownerId: 'user-alpha',
          type: 'CREATE_CYCLE',
          payload: {
            id: 'cycle-new-1',
            title: 'Cycle New',
            startDate: '2026-09-01',
            endDate: '2026-11-29',
            targetTheme: 'Focus'
          },
          timestamp: Date.now()
        }
      ];

      const originalQueueSnapshot = JSON.stringify(pendingQueue);

      const input: ReconcileBootStateInput = {
        authenticatedOwnerId: 'user-alpha',
        remoteCycles: [],
        remoteLogs: [],
        currentLocalState: {
          cycles: [],
          logs: []
        },
        pendingQueue,
        isDemoConsumed: false,
        diagnosticSink: testSink
      };

      reconcileBootState(input);
      reconcileBootState(input);

      assert.equal(JSON.stringify(pendingQueue), originalQueueSnapshot, 'Pending queue was not mutated');
    });

    it('(m) Instrumentation does not duplicate callbacks or success notifications', async () => {
      let itemSuccessCount = 0;
      let resultCallbackCount = 0;

      const customOrchestrator = createSyncOrchestrator({
        currentActiveAccountResolver: () => 'user-alpha',
        isOnlineResolver: () => true,
        diagnosticSink: testSink,
        replayExecutor: async (options) => {
          options.onItemSuccess?.({
            id: 'queue-item-1',
            ownerId: 'user-alpha',
            type: 'UPDATE_LOG',
            payload: { date: '2026-09-01' },
            timestamp: Date.now()
          });
          return createSampleReplayResult({ syncedCount: 1 });
        }
      });

      await customOrchestrator.requestSync({
        trigger: 'MANUAL_FORCE',
        targetOwnerId: 'user-alpha',
        targetToken: 'token-alpha',
        onItemSuccess: () => {
          itemSuccessCount++;
        },
        onResult: () => {
          resultCallbackCount++;
        }
      });

      assert.equal(itemSuccessCount, 1, 'onItemSuccess invoked exactly once');
      assert.equal(resultCallbackCount, 1, 'onResult invoked exactly once');
    });
  });

  describe('5. Privacy & Redaction Regression Proof', () => {
    it('(h, i, j & 9) Rigorous proof: NO tokens, owner IDs, phone numbers, emails, titles, notes, payloads or raw errors appear in serialized diagnostics', async () => {
      const SENSITIVE_TOKEN = 'secret-bearer-jwt-token-alpha-xyz-987654321';
      const SENSITIVE_OWNER_ID = 'user-sensitive-owner-guid-99999';
      const SENSITIVE_PHONE = '+989123456789';
      const SENSITIVE_EMAIL = 'confidential-samurai@example.com';
      const SENSITIVE_CYCLE_TITLE = 'Top Secret 90-Day Iron Fortress Cycle';
      const SENSITIVE_NOTE = 'Deep personal reflection note regarding mission and discipline';
      const SENSITIVE_PAYLOAD_VALUE = 'ultra-private-custom-mutation-field-data';

      // 1. Run SyncOrchestrator with sensitive credentials and parameters
      activeAccount = SENSITIVE_OWNER_ID;
      const p1 = orchestrator.requestSync({
        trigger: 'AUTH_SUCCESS',
        targetOwnerId: SENSITIVE_OWNER_ID,
        targetToken: SENSITIVE_TOKEN
      });

      replayCalls[0].deferred.resolve(createSampleReplayResult({ syncedCount: 3, failedCount: 0 }));
      await p1;

      // 2. Run Replay error with raw Error object
      const p2 = orchestrator.requestSync({
        trigger: 'MANUAL_FORCE',
        targetOwnerId: SENSITIVE_OWNER_ID,
        targetToken: SENSITIVE_TOKEN
      });

      const detailedError = new Error(`Internal network crash for user ${SENSITIVE_OWNER_ID} with token ${SENSITIVE_TOKEN}`);
      (detailedError as any).stack = `Error: at /server/secret/path.ts:123\nuser=${SENSITIVE_OWNER_ID}\nphone=${SENSITIVE_PHONE}`;
      replayCalls[1].deferred.reject(detailedError);
      await p2;

      // 3. Run Boot Reconciliation with rich personal content
      const sensitiveProfile: Partial<UserProfile> = {
        id: SENSITIVE_OWNER_ID,
        name: 'Sensitive User',
        email: SENSITIVE_EMAIL,
        phoneNumber: SENSITIVE_PHONE
      };

      const sensitiveCycles: Cycle[] = [
        {
          id: 'sensitive-cycle-1',
          title: SENSITIVE_CYCLE_TITLE,
          startDate: '2026-09-01',
          endDate: '2026-11-29',
          targetTheme: 'Extreme Secrecy',
          isSynced: true
        }
      ];

      const sensitiveLogs: DailyLog[] = [
        {
          id: 'log-sensitive-1',
          cycleId: 'sensitive-cycle-1',
          date: '2026-09-01',
          createdAt: '2026-09-01T00:00:00.000Z',
          wakeUp: true,
          workout: true,
          study: true,
          journal: true,
          hardTask: true,
          specialMission: false,
          notes: SENSITIVE_NOTE,
          isSynced: true
        }
      ];

      const sensitiveQueue: OfflineQueueItem[] = [
        {
          id: 'queue-sensitive-1',
          ownerId: SENSITIVE_OWNER_ID,
          type: 'UPDATE_LOG',
          payload: {
            cycleId: 'sensitive-cycle-1',
            date: '2026-09-02',
            wakeUp: true,
            workout: true,
            study: true,
            journal: true,
            hardTask: true,
            specialMission: false,
            notes: SENSITIVE_NOTE,
            customSecretField: SENSITIVE_PAYLOAD_VALUE
          },
          timestamp: Date.now()
        }
      ];

      reconcileBootState({
        authenticatedOwnerId: SENSITIVE_OWNER_ID,
        remoteCycles: sensitiveCycles,
        remoteLogs: sensitiveLogs,
        remoteUserProfile: sensitiveProfile,
        currentLocalState: {
          cycles: sensitiveCycles,
          logs: sensitiveLogs
        },
        pendingQueue: sensitiveQueue,
        isDemoConsumed: true,
        diagnosticSink: testSink
      });

      // 4. Capture all recorded diagnostics and serialize to JSON
      const allRecords = testSink.getRecords();
      assert.ok(allRecords.length >= 5, 'Multiple diagnostic records captured');

      const serializedDiagnostics = JSON.stringify(allRecords);

      // 5. Rigorous privacy assertions: verify NONE of the sensitive strings are present
      assert.equal(
        serializedDiagnostics.includes(SENSITIVE_TOKEN),
        false,
        'CRITICAL: Auth token must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes(SENSITIVE_OWNER_ID),
        false,
        'CRITICAL: Raw owner ID must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes(SENSITIVE_PHONE),
        false,
        'CRITICAL: Phone number must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes(SENSITIVE_EMAIL),
        false,
        'CRITICAL: Email address must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes(SENSITIVE_CYCLE_TITLE),
        false,
        'CRITICAL: Cycle title must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes(SENSITIVE_NOTE),
        false,
        'CRITICAL: User log note must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes(SENSITIVE_PAYLOAD_VALUE),
        false,
        'CRITICAL: Mutation payload value must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes('stack'),
        false,
        'CRITICAL: Error stack trace must NOT appear anywhere in serialized diagnostics'
      );

      assert.equal(
        serializedDiagnostics.includes('/server/secret/path.ts'),
        false,
        'CRITICAL: Error source paths must NOT appear anywhere in serialized diagnostics'
      );
    });
  });

  describe('6. Error Classifier Mapping Invariants', () => {
    it('Maps ReplayFailureClassification accurately into closed SafeSyncErrorCategory', () => {
      assert.equal(classifyReplayFailureToSafeCategory('AUTH_REQUIRED'), 'AUTH');
      assert.equal(classifyReplayFailureToSafeCategory('FORBIDDEN'), 'AUTH');
      assert.equal(classifyReplayFailureToSafeCategory('NETWORK_ERROR'), 'NETWORK');
      assert.equal(classifyReplayFailureToSafeCategory('RATE_LIMITED'), 'HTTP_RETRYABLE');
      assert.equal(classifyReplayFailureToSafeCategory('SERVER_RETRYABLE'), 'HTTP_RETRYABLE');
      assert.equal(classifyReplayFailureToSafeCategory('VALIDATION_ERROR'), 'HTTP_PERMANENT');
      assert.equal(classifyReplayFailureToSafeCategory('CONFLICT_DEFERRED'), 'HTTP_PERMANENT');
      assert.equal(classifyReplayFailureToSafeCategory('ENTITY_MISSING'), 'HTTP_PERMANENT');
      assert.equal(classifyReplayFailureToSafeCategory('UNKNOWN_MUTATION'), 'UNKNOWN');
    });

    it('Classifies runtime errors and statuses safely without serializing arbitrary strings', () => {
      assert.equal(classifySafeError(undefined, 'SKIPPED_OFFLINE'), 'OFFLINE');
      assert.equal(classifySafeError(undefined, 'SKIPPED_GUEST_OR_ANONYMOUS'), 'AUTH');
      assert.equal(classifySafeError(undefined, 'DISCARDED_STALE'), 'ACCOUNT_CHANGE');
      assert.equal(classifySafeError(new Error('Failed to fetch')), 'NETWORK');
      assert.equal(classifySafeError({ name: 'AbortError', message: 'The user aborted a request.' }), 'NETWORK');
      assert.equal(classifySafeError('Arbitrary runtime string error'), 'UNKNOWN');
    });
  });
});
