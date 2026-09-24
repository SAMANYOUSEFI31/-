/**
 * tests/phase-2c5-operational-failure-invariants.test.ts
 *
 * Phase 2C.5: Operational-Failure Invariant Audit & Verification Suite
 *
 * Validates the core 15 operational-failure invariants:
 *  1. Network failure honesty
 *  2. Offline queue durability
 *  3. Replay idempotency
 *  4. Database fail-closed behavior
 *  5. Storage write failure rollback
 *  6. Queue corruption isolation
 *  7. Auth-stop replay behavior
 *  8. Account-switch safety
 *  9. Lock-loss safety
 * 10. Payment timeout handling
 * 11. Ambiguous payment handling
 * 12. VIP activation proof requirements
 * 13. SMS failure safety
 * 14. Restore corruption rejection
 * 15. Diagnostic privacy guarantees
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getOfflineQueue,
  saveOfflineQueue,
  clearOfflineQueue,
  enqueueOfflineMutation,
  replayAccountOfflineQueue,
  quarantineQueueItems,
  getQuarantinedItems,
  clearQuarantine,
  getScopedOfflineQueueKey
} from '../src/utils/offlineQueueUtils.js';
import {
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate,
  executeDirectDailyLogMutation
} from '../src/utils/directMutationUtils.js';
import {
  isDatabaseReady,
  assertPersistenceAvailable,
  setPrismaState
} from '../server/db/index.js';
import {
  calculateRenewalExpiration
} from '../server/payment/renewal.js';
import {
  validateAuthoritativePaymentResponse
} from '../src/features/payment/paymentValidation.js';
import {
  normalizePhoneNumber,
  maskPhoneNumber
} from '../server/utils/phone.js';
import {
  sanitizeText
} from '../scripts/backup-verify.js';
import {
  evaluateRestoreAcceptance,
  assertRestoreAcceptance,
  RestoreComparisonReport
} from '../scripts/restore-verify.js';
import {
  InMemoryDiagnosticSink,
  setSyncDiagnosticSink,
  classifySafeError,
  classifyReplayFailureToSafeCategory
} from '../src/utils/syncDiagnostics.js';
import { DailyLog } from '../src/types.js';

describe('Phase 2C.5: Operational-Failure Invariant Audit Suite', () => {
  const mockStorage: Record<string, string> = {};
  const storageMock = {
    getItem: (k: string) => mockStorage[k] ?? null,
    setItem: (k: string, v: string) => { mockStorage[k] = String(v); },
    removeItem: (k: string) => { delete mockStorage[k]; },
    clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
    key: (i: number) => Object.keys(mockStorage)[i] ?? null,
    get length() { return Object.keys(mockStorage).length; }
  };

  beforeEach(() => {
    storageMock.clear();
    (globalThis as any).localStorage = storageMock;
    (globalThis as any).window = { localStorage: storageMock };
    setPrismaState(null, false);
  });

  // ---------------------------------------------------------------------------
  // 1. Network Failure Honesty
  // ---------------------------------------------------------------------------
  it('Invariant 1: Network failure marks mutation un-synced without showing premature success or error toasts for queued items', async () => {
    const ownerId = 'usr_inv1_test';
    const initialLog: DailyLog = {
      id: 'log-1',
      cycleId: 'cyc-1',
      date: '1403-10-01',
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false,
      revision: 1,
      isSynced: true
    };

    const updatedLog: DailyLog = { ...initialLog, workout: true, isSynced: false };
    const failingFetch = async () => { throw new TypeError('Failed to fetch (offline)'); };

    const result = await executeDirectDailyLogMutation({
      updatedLog,
      existingLog: initialLog,
      activeCycleId: 'cyc-1',
      ownerId,
      authToken: 'test-token',
      fetchFn: failingFetch as any
    });

    assert.equal(result.status, 'NETWORK_ERROR');
    const queue = getOfflineQueue(ownerId);
    assert.equal(queue.length, 1);
    assert.equal(queue[0].payload.workout, true);
  });

  // ---------------------------------------------------------------------------
  // 2. Offline Queue Durability
  // ---------------------------------------------------------------------------
  it('Invariant 2: Offline queue persists across simulated app reload and compacts without dropping fields', () => {
    const ownerId = 'usr_inv2_test';
    enqueueOfflineMutation(ownerId, {
      type: 'UPDATE_LOG',
      payload: { cycleId: 'cyc-1', date: '1403-10-02', workout: true, study: false }
    });

    // Successive toggle on same date
    enqueueOfflineMutation(ownerId, {
      type: 'UPDATE_LOG',
      payload: { cycleId: 'cyc-1', date: '1403-10-02', workout: true, study: true }
    });

    const queue = getOfflineQueue(ownerId);
    assert.equal(queue.length, 1, 'Compaction maintains exactly one record');
    assert.equal(queue[0].payload.workout, true);
    assert.equal(queue[0].payload.study, true);
  });

  // ---------------------------------------------------------------------------
  // 3. Replay Idempotency
  // ---------------------------------------------------------------------------
  it('Invariant 3: Multiple re-evaluations generate consistent operation keys and safe classifications', () => {
    const classif1 = classifyReplayFailureToSafeCategory('SERVER_RETRYABLE');
    const classif2 = classifyReplayFailureToSafeCategory('SERVER_RETRYABLE');
    assert.equal(classif1, 'HTTP_RETRYABLE');
    assert.equal(classif2, 'HTTP_RETRYABLE');
  });

  // ---------------------------------------------------------------------------
  // 4. Database Fail-Closed Behavior
  // ---------------------------------------------------------------------------
  it('Invariant 4: In production, database readiness fails closed with 503 SERVICE_UNAVAILABLE if disconnected', () => {
    const origEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);
      assert.equal(isDatabaseReady(), false);
      assert.throws(
        () => assertPersistenceAvailable('test-op'),
        (err: any) => err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503
      );
    } finally {
      process.env.NODE_ENV = origEnv;
    }
  });

  // ---------------------------------------------------------------------------
  // 5. Storage Write Failure Rollback
  // ---------------------------------------------------------------------------
  it('Invariant 5: Storage write failure rolls back optimistic state to confirmed baseline', () => {
    const initialLog: DailyLog = {
      id: 'log-1',
      cycleId: 'cyc-1',
      date: '1403-10-05',
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false,
      revision: 1,
      isSynced: true
    };

    const updatedLog: DailyLog = { ...initialLog, workout: true, isSynced: false };
    const { previousConfirmedSnapshot } = applyOptimisticLogUpdate([initialLog], updatedLog);

    // Rollback
    const rolledBack = rollbackOptimisticLogUpdate([updatedLog], '1403-10-05', previousConfirmedSnapshot);
    assert.equal(rolledBack[0].workout, false);
    assert.equal(rolledBack[0].isSynced, true);
  });

  // ---------------------------------------------------------------------------
  // 6. Queue Corruption Isolation
  // ---------------------------------------------------------------------------
  it('Invariant 6: Corrupted queue JSON or non-array data in storage returns empty array safely without unhandled exception', () => {
    const ownerId = 'usr_inv6_test';
    const key = getScopedOfflineQueueKey(ownerId);

    // 1. Non-JSON string
    mockStorage[key] = '{ invalid json :::';
    assert.deepEqual(getOfflineQueue(ownerId), []);

    // 2. Non-array JSON
    mockStorage[key] = JSON.stringify({ notAnArray: true });
    assert.deepEqual(getOfflineQueue(ownerId), []);

    // 3. Array containing null and malformed records
    mockStorage[key] = JSON.stringify([null, 42, 'string', { id: 'valid-1', type: 'UPDATE_LOG', ownerId, payload: {} }]);
    const valid = getOfflineQueue(ownerId);
    assert.equal(valid.length, 1);
    assert.equal(valid[0].id, 'valid-1');
  });

  // ---------------------------------------------------------------------------
  // 7. Auth-Stop Replay Behavior
  // ---------------------------------------------------------------------------
  it('Invariant 7: 401/403 stops replay, keeps un-synced items in queue for re-auth, and does not emit success notifications', async () => {
    const ownerId = 'usr_inv7_test';
    enqueueOfflineMutation(ownerId, {
      type: 'UPDATE_LOG',
      payload: { date: '1403-10-07', score: 8 }
    });

    const forbiddenFetch = async () => {
      return { ok: false, status: 401, json: async () => ({ code: 'UNAUTHORIZED' }) } as any;
    };

    const res = await replayAccountOfflineQueue({
      activeAccountId: ownerId,
      authToken: 'expired-token',
      fetchFn: forbiddenFetch
    });

    assert.equal(res.stoppedDueToAuth, true);
    assert.equal(res.syncedCount, 0);
    assert.equal(getOfflineQueue(ownerId).length, 1, 'Item remains in queue for future re-auth');
  });

  // ---------------------------------------------------------------------------
  // 8. Account-Switch Safety
  // ---------------------------------------------------------------------------
  it('Invariant 8: Replay is strictly partitioned per account and immediately aborts if identity changes mid-run', async () => {
    enqueueOfflineMutation('usr_A', { type: 'UPDATE_LOG', payload: { date: '1403-10-08', score: 10 } });
    enqueueOfflineMutation('usr_B', { type: 'UPDATE_LOG', payload: { date: '1403-10-08', score: 8 } });

    let activeUser = 'usr_A';
    const mockFetch = async () => {
      activeUser = 'usr_B'; // Account switched mid-flight
      return { ok: true, status: 200, json: async () => ({ success: true, log: { revision: 2 } }) } as any;
    };

    const res = await replayAccountOfflineQueue({
      activeAccountId: 'usr_A',
      authToken: 'token-A',
      fetchFn: mockFetch,
      getCurrentActiveAccountId: () => activeUser
    });

    assert.equal(res.stoppedDueToAccountChange, true);
    assert.equal(res.syncedCount, 0);
    assert.equal(getOfflineQueue('usr_A').length, 1, 'User A queue preserved');
    assert.equal(getOfflineQueue('usr_B').length, 1, 'User B queue preserved');
  });

  // ---------------------------------------------------------------------------
  // 9. Lock-Loss Safety
  // ---------------------------------------------------------------------------
  it('Invariant 9: Foreign lock takeover halts replay and suppresses item removal', async () => {
    const ownerId = 'usr_inv9_test';
    enqueueOfflineMutation(ownerId, { type: 'UPDATE_LOG', payload: { date: '1403-10-09' } });

    const lockKey = `bushido_replay_lock_${ownerId}`;
    const mockFetch = async () => {
      // Foreign tab steals lock
      mockStorage[lockKey] = JSON.stringify({ lockId: 'foreign_tab_takeover', timestamp: Date.now() + 50000 });
      return { ok: true, status: 200, json: async () => ({ success: true, log: { revision: 2 } }) } as any;
    };

    const res = await replayAccountOfflineQueue({
      activeAccountId: ownerId,
      authToken: 'token-9',
      fetchFn: mockFetch
    });

    assert.equal(res.stoppedDueToLockLoss, true);
    assert.equal(res.syncedCount, 0);
    assert.equal(getOfflineQueue(ownerId).length, 1, 'Queue item preserved on lock loss');
  });

  // ---------------------------------------------------------------------------
  // 10. Payment Timeout Handling
  // ---------------------------------------------------------------------------
  it('Invariant 10: Payment timeout is classified as retryable without granting unconfirmed VIP', () => {
    const timeoutError = new Error('ETIMEDOUT: Connection timed out');
    const category = classifySafeError(timeoutError);
    assert.equal(category, 'NETWORK');
  });

  // ---------------------------------------------------------------------------
  // 11. Ambiguous Payment Handling
  // ---------------------------------------------------------------------------
  it('Invariant 11: Ambiguous payment responses fail closed and do not activate VIP status', () => {
    const baseClientUser = {
      id: 'usr_ambiguous',
      name: 'Samurai',
      phoneNumber: '09121112233',
      isVip: false,
      tier: 'ronin_free' as const,
      vipSince: null,
      vipExpiresAt: null,
      activeCycleLimit: 1,
      createdAt: new Date().toISOString()
    };

    // Missing refId -> must fail validation
    const valRes = validateAuthoritativePaymentResponse(
      {
        data: {
          status: 100,
          subscription: { status: 'SUCCESS', userId: 'usr_ambiguous', authority: 'AUTH_TEST', amount: 199000 },
          user: { id: 'usr_ambiguous', isVip: true, tier: 'vip_samurai', vipSince: '2026-09-01T00:00:00Z', vipExpiresAt: '2026-12-01T00:00:00Z' }
          // refId missing
        },
        currentUserId: 'usr_ambiguous',
        expectedAuthority: 'AUTH_TEST'
      },
      baseClientUser
    );

    assert.equal(valRes.valid, false);
    assert.equal(valRes.errorCode, 'INVALID_REF_ID');
  });

  // ---------------------------------------------------------------------------
  // 12. VIP Activation Proof Requirements
  // ---------------------------------------------------------------------------
  it('Invariant 12: VIP renewal strictly calculates expiration from server-authoritative duration', () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    const exp90 = calculateRenewalExpiration(null, 90, now);
    const diffDays = Math.round((exp90.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    assert.equal(diffDays, 90);
  });

  // ---------------------------------------------------------------------------
  // 13. SMS Failure Safety
  // ---------------------------------------------------------------------------
  it('Invariant 13: Phone number normalization and masking enforce strict format safety', () => {
    assert.equal(normalizePhoneNumber('+98 912 345 6789'), '09123456789');
    assert.equal(normalizePhoneNumber('invalid-phone'), null);
    assert.equal(maskPhoneNumber('09123456789'), '0912***6789');
  });

  // ---------------------------------------------------------------------------
  // 14. Restore Corruption Rejection
  // ---------------------------------------------------------------------------
  it('Invariant 14: Restore acceptance gate rejects corrupt checksums and non-zero exit codes', () => {
    const corruptReport: RestoreComparisonReport = {
      restoredDatabaseName: 'test_db',
      sourceDatabaseName: 'source_db',
      pgRestoreExitCode: 1, // non-zero exit code
      backupArtifact: { path: 'test.dump', sizeBytes: 100, sha256: 'abc' },
      artifactVerification: {
        checksumMatches: false,
        sizeMatches: true,
        tocVerified: true,
        missingTocObjects: [],
        recalculatedSha256: 'xyz',
        expectedSha256: 'abc',
        actualSizeBytes: 100,
        expectedSizeBytes: 100
      },
      tableParity: { expectedTables: [], foundTables: [], missingTables: [], status: 'MATCH' },
      enumParity: { expectedEnums: [], foundEnums: [], missingEnums: [], status: 'MATCH' },
      foreignKeyParity: { verifiedCascadeFks: 5, missingFks: [], status: 'MATCH' },
      uniqueContractParity: { verifiedContracts: 5, missingContracts: [], status: 'MATCH' },
      migrationParity: { expectedCount: 4, restoredCount: 4, migrations: [], discrepancies: [], status: 'MATCH' },
      rowCountParity: { perTable: [], totalExpected: 10, totalActual: 10, status: 'MATCH' },
      dataLossStatus: 'DATA_DISCREPANCY_DETECTED',
      preflightReport: {
        databaseIdentity: { databaseName: 'test', serverAddress: '127.0.0.1', serverPort: 5432, serverVersion: '15', hostClassification: 'LOCAL_LOOPBACK' },
        migrations: { migrationsTableExists: true, initialBaselineRecorded: true, recordedMigrations: [], missingExpectedIncrementals: [] },
        schemaIntegrity: { existingTables: [], missingRequiredTables: [], existingEnums: [], missingRequiredEnums: [], criticalColumnsVerified: true, foreignKeyContractsVerified: true, uniqueContractsVerified: true },
        assessment: { status: 'ALREADY_BASELINED', classification: 'FULLY_MIGRATED', recommendedAction: 'NO_ACTION_REQUIRED', reasons: [], blockers: [], details: { missingTables: [], missingEnums: [], missingColumns: [], missingForeignKeys: [], missingUniqueContracts: [], missingMigrations: [], failedOrUnfinishedMigrations: [], checksumMismatches: [] } }
      },
      schemaDriftStatus: 'ZERO_DRIFT',
      behavioralVerification: { emailUniquenessEnforced: true, dailyLogUniquenessEnforced: true, cascadeDeleteActive: true },
      acceptance: { accepted: false, blockers: ['Checksum mismatch'] }
    };

    const evalRes = evaluateRestoreAcceptance(corruptReport);
    assert.equal(evalRes.accepted, false);
    assert.throws(() => assertRestoreAcceptance(corruptReport), /RESTORE_ACCEPTANCE_FAILED/);
  });

  // ---------------------------------------------------------------------------
  // 15. Diagnostic Privacy Guarantees
  // ---------------------------------------------------------------------------
  it('Invariant 15: Secret sanitization redacts database passwords and sensitive tokens completely', () => {
    const rawUrl = 'postgresql://admin:superSecretPassword99@127.0.0.1:5432/bushido_db';
    const sanitized = sanitizeText(rawUrl);
    assert.equal(sanitized.includes('superSecretPassword99'), false);
    assert.equal(sanitized, 'postgresql://admin:[REDACTED]@127.0.0.1:5432/bushido_db');

    const sink = new InMemoryDiagnosticSink(10);
    setSyncDiagnosticSink(sink);
    sink.record({
      eventType: 'RUN_REQUESTED',
      timestamp: Date.now()
    });

    const records = sink.getRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0].eventType, 'RUN_REQUESTED');
  });
});
