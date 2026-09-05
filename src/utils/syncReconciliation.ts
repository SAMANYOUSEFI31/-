import { Cycle, DailyLog, UserProfile, OfflineQueueItem } from '../types';
import { resolveBackendSyncDecision } from './storageUtils';
import { normalizeQueueOwner, isGuestQueueOwner, isDevelopmentEnvironment } from './storageCore';
import {
  emitSyncDiagnostic,
  SyncDiagnosticSink,
  getSyncDiagnosticSink
} from './syncDiagnostics';

export interface ReconcileBootStateInput {
  authenticatedOwnerId?: string | null;
  remoteCycles: Cycle[] | null;
  remoteLogs: DailyLog[] | null;
  remoteUserProfile?: Partial<UserProfile> | null;
  currentLocalState: {
    cycles: Cycle[];
    logs: DailyLog[];
    userProfile?: UserProfile;
  };
  pendingQueue: OfflineQueueItem[];
  isDemoConsumed: boolean;
  diagnosticSink?: SyncDiagnosticSink;
}

export interface ReconciledBootState {
  cycles: Cycle[] | null;
  logs: DailyLog[] | null;
  userProfile: Partial<UserProfile> | null;
  shouldMarkDemoConsumed: boolean;
  nextActiveCycleId: string | null;
}

/**
 * Server-authoritative profile, entitlement, and identity fields that
 * CANNOT be overridden or elevated by pending client mutations.
 */
const IMMUTABLE_PROFILE_FIELDS = new Set([
  'id',
  'isAdmin',
  'isVip',
  'tier',
  'vipSince',
  'vipExpiresAt',
  'paymentRefId',
  'activeCycleLimit',
  'tokenVersion',
  'email',
  'phoneNumber',
  'createdAt',
  'updatedAt'
]);

/**
 * Internal invariant check helper for development and testing.
 * Logs diagnostics without altering production behavior or throwing in production.
 */
export function assertReconciliationInvariant(condition: boolean, message: string): void {
  if (!condition && isDevelopmentEnvironment()) {
    console.warn(`[ReconciliationInvariantViolation] ${message}`);
  }
}

/**
 * Safe Boot Reconciliation with Pending Offline Mutations (Phase 3C.2 & Phase 4).
 *
 * Pure, framework-neutral reconciliation that prevents authenticated boot hydration
 * from overwriting local optimistic state still represented in pending offline queues.
 * Instrumented with aggregate-only, privacy-safe diagnostics.
 *
 * Invariants:
 * 1. Server Authority Baseline: Remote server snapshot is the baseline for confirmed state.
 * 2. Scoped Ownership: Only mutations belonging strictly to authenticatedOwnerId are applied.
 *    Guest and other user mutations are ignored.
 * 3. Dependency Order: Pending mutations are applied in their exact chronological queue order.
 * 4. Truthful Sync State: All pending or modified items are marked `isSynced: false`.
 * 5. Privilege Immunity: Pending profile updates cannot elevate isAdmin, isVip, tier, etc.
 * 6. Idempotency: Repeated execution with identical inputs produces identical outputs without side effects.
 * 7. Privacy: Emits strictly aggregate counts without entity IDs, personal content, or payload details.
 */
export function reconcileBootState(input: ReconcileBootStateInput): ReconciledBootState {
  const {
    authenticatedOwnerId,
    remoteCycles,
    remoteLogs,
    remoteUserProfile,
    currentLocalState,
    pendingQueue,
    isDemoConsumed,
    diagnosticSink
  } = input;

  const sink = diagnosticSink || getSyncDiagnosticSink();

  // 1. Resolve baseline remote sync decision (preserves demo rules)
  const baselineDecision = resolveBackendSyncDecision({
    apiCycles: remoteCycles,
    apiLogs: remoteLogs,
    isDemoConsumed
  });

  let shouldMarkDemoConsumed = baselineDecision.shouldMarkDemoConsumed;
  let nextActiveCycleId = baselineDecision.nextActiveCycleId;

  // 2. Clone baseline cycles & logs to prevent in-place mutation of arguments
  let workingCycles: Cycle[] | null = baselineDecision.nextCycles !== null
    ? baselineDecision.nextCycles.map(c => ({ ...c }))
    : (currentLocalState.cycles ? currentLocalState.cycles.map(c => ({ ...c })) : null);

  let workingLogs: DailyLog[] | null = baselineDecision.nextLogs !== null
    ? baselineDecision.nextLogs.map(l => ({ ...l }))
    : (currentLocalState.logs ? currentLocalState.logs.map(l => ({ ...l })) : null);

  let workingProfile: Partial<UserProfile> | null = remoteUserProfile
    ? { ...(currentLocalState.userProfile || {}), ...remoteUserProfile }
    : (currentLocalState.userProfile ? { ...currentLocalState.userProfile } : null);

  // 3. Strict owner isolation: only authenticated accounts can reconcile pending mutations
  const normOwner = normalizeQueueOwner(authenticatedOwnerId);
  const isGuest = isGuestQueueOwner(normOwner);

  if (!normOwner || isGuest || !Array.isArray(pendingQueue) || pendingQueue.length === 0) {
    emitSyncDiagnostic({
      eventType: 'RECONCILIATION_COMPLETED',
      timestamp: Date.now(),
      remoteCyclesCount: Array.isArray(remoteCycles) ? remoteCycles.length : 0,
      remoteLogsCount: Array.isArray(remoteLogs) ? remoteLogs.length : 0,
      pendingMutationsCount: 0,
      reconciledCyclesCount: workingCycles ? workingCycles.length : 0,
      reconciledLogsCount: workingLogs ? workingLogs.length : 0,
      demoConsumedChanged: shouldMarkDemoConsumed !== isDemoConsumed
    }, sink);

    return {
      cycles: workingCycles,
      logs: workingLogs,
      userProfile: workingProfile,
      shouldMarkDemoConsumed,
      nextActiveCycleId
    };
  }

  // 4. Filter pending mutations strictly matching authenticated owner (no guest, no User B)
  const validMutations = pendingQueue.filter(item => {
    if (!item || typeof item !== 'object') return false;
    const itemOwner = normalizeQueueOwner(item.ownerId);
    return itemOwner === normOwner && !isGuestQueueOwner(itemOwner);
  });

  if (validMutations.length === 0) {
    emitSyncDiagnostic({
      eventType: 'RECONCILIATION_COMPLETED',
      timestamp: Date.now(),
      remoteCyclesCount: Array.isArray(remoteCycles) ? remoteCycles.length : 0,
      remoteLogsCount: Array.isArray(remoteLogs) ? remoteLogs.length : 0,
      pendingMutationsCount: 0,
      reconciledCyclesCount: workingCycles ? workingCycles.length : 0,
      reconciledLogsCount: workingLogs ? workingLogs.length : 0,
      demoConsumedChanged: shouldMarkDemoConsumed !== isDemoConsumed
    }, sink);

    return {
      cycles: workingCycles,
      logs: workingLogs,
      userProfile: workingProfile,
      shouldMarkDemoConsumed,
      nextActiveCycleId
    };
  }

  // Invariant 1: Authenticated owner is not guest when applying authenticated pending mutations
  assertReconciliationInvariant(!isGuest, 'Normalized authenticated owner must not be guest when applying pending mutations');

  // Invariant 2: Every accepted mutation belongs strictly to normalized authenticated owner
  for (const item of validMutations) {
    assertReconciliationInvariant(
      normalizeQueueOwner(item.ownerId) === normOwner,
      'Every accepted mutation must belong strictly to authenticated owner'
    );
  }

  // Ensure working arrays exist if mutations need to be overlaid
  if (workingCycles === null) {
    workingCycles = currentLocalState.cycles ? currentLocalState.cycles.map(c => ({ ...c })) : [];
  }
  if (workingLogs === null) {
    workingLogs = currentLocalState.logs ? currentLocalState.logs.map(l => ({ ...l })) : [];
  }

  // Track expected pending entities that MUST remain visible with isSynced: false
  const expectedPendingCycleIds = new Set<string>();
  const expectedPendingLogs = new Map<string, { date: string; cycleId?: string }>();
  const deletedCycleIds = new Set<string>();

  // 5. Apply pending mutations in strict queue dependency order
  for (const item of validMutations) {
    switch (item.type) {
      case 'CREATE_CYCLE': {
        const cyclePayload = item.payload;
        if (cyclePayload && typeof cyclePayload === 'object' && typeof cyclePayload.id === 'string') {
          shouldMarkDemoConsumed = true;
          const existingIdx = workingCycles.findIndex(c => c.id === cyclePayload.id);
          const cycleToAdd: Cycle = {
            ...cyclePayload,
            id: cyclePayload.id,
            isSynced: false
          };

          if (existingIdx >= 0) {
            // Prevent duplicate cycles if server already has the cycle with the same stable ID
            workingCycles[existingIdx] = {
              ...workingCycles[existingIdx],
              ...cycleToAdd
            };
          } else {
            workingCycles.push(cycleToAdd);
          }
          expectedPendingCycleIds.add(cyclePayload.id);
        }
        break;
      }

      case 'UPDATE_CYCLE': {
        const cyclePayload = item.payload;
        if (cyclePayload && typeof cyclePayload === 'object' && typeof cyclePayload.id === 'string') {
          const existingIdx = workingCycles.findIndex(c => c.id === cyclePayload.id);
          if (existingIdx >= 0) {
            workingCycles[existingIdx] = {
              ...workingCycles[existingIdx],
              ...cyclePayload,
              id: workingCycles[existingIdx].id, // preserve stable ID
              isSynced: false
            };
            expectedPendingCycleIds.add(cyclePayload.id);
          }
          // If target cycle cannot be found and no matching pending creation, do not invent confirmed cycle
        }
        break;
      }

      case 'DELETE_CYCLE': {
        const targetCycleId = typeof item.payload === 'string' ? item.payload : item.payload?.id;
        if (targetCycleId && typeof targetCycleId === 'string') {
          deletedCycleIds.add(targetCycleId);
          expectedPendingCycleIds.delete(targetCycleId);

          // Remove target cycle from visible reconciled state
          workingCycles = workingCycles.filter(c => c.id !== targetCycleId);
          // Remove or suppress associated logs from visible reconciled state
          workingLogs = workingLogs.filter(l => l.cycleId !== targetCycleId);

          // Remove any expected pending logs belonging to the deleted cycle
          for (const [key, entry] of Array.from(expectedPendingLogs.entries())) {
            if (entry.cycleId === targetCycleId) {
              expectedPendingLogs.delete(key);
            }
          }
        }
        break;
      }

      case 'UPDATE_LOG': {
        const logPayload = item.payload;
        if (logPayload && typeof logPayload === 'object' && typeof logPayload.date === 'string') {
          // If log belongs to a cycle that was deleted or doesn't exist, suppress it
          if (logPayload.cycleId && !workingCycles.some(c => c.id === logPayload.cycleId)) {
            break;
          }

          const existingIdx = workingLogs.findIndex(l => {
            if (logPayload.cycleId && l.cycleId) {
              return l.cycleId === logPayload.cycleId && l.date === logPayload.date;
            }
            return l.date === logPayload.date;
          });

          const logToApply: DailyLog = {
            ...logPayload,
            date: logPayload.date,
            isSynced: false
          };

          if (existingIdx >= 0) {
            workingLogs[existingIdx] = {
              ...workingLogs[existingIdx],
              ...logToApply
            };
          } else {
            workingLogs.push(logToApply);
          }

          const logKey = logPayload.cycleId
            ? `${logPayload.cycleId}::${logPayload.date}`
            : `__fallback__::${logPayload.date}`;
          expectedPendingLogs.set(logKey, { date: logPayload.date, cycleId: logPayload.cycleId });
        }
        break;
      }

      case 'UPDATE_PROFILE': {
        const profilePayload = item.payload;
        if (profilePayload && typeof profilePayload === 'object' && workingProfile) {
          const safePayload: Record<string, any> = {};
          for (const [key, val] of Object.entries(profilePayload)) {
            if (!IMMUTABLE_PROFILE_FIELDS.has(key) && val !== undefined) {
              safePayload[key] = val;
            }
          }
          workingProfile = {
            ...workingProfile,
            ...safePayload
          };
        }
        break;
      }

      default:
        // Ignore unrecognized mutation types safely
        break;
    }
  }

  // 6. Post-reconciliation Invariant Validations
  // Invariant 3: Final reconciled cycle collection does not contain duplicate cycle IDs
  if (workingCycles && workingCycles.length > 1) {
    const cycleIds = new Set<string>();
    let hasDuplicate = false;
    for (const cycle of workingCycles) {
      if (cycleIds.has(cycle.id)) {
        hasDuplicate = true;
        break;
      }
      cycleIds.add(cycle.id);
    }
    assertReconciliationInvariant(!hasDuplicate, 'Final reconciled cycle collection must not contain duplicate cycle IDs');
  }

  // Invariant 4 & 5: Deleted cycle and its logs do not remain visible
  if (deletedCycleIds.size > 0) {
    if (workingCycles && workingCycles.length > 0) {
      const hasDeletedCycle = workingCycles.some(c => deletedCycleIds.has(c.id));
      assertReconciliationInvariant(!hasDeletedCycle, 'Cycle removed through pending DELETE_CYCLE must not remain in final cycle collection');
    }

    if (workingLogs && workingLogs.length > 0) {
      const hasDeletedCycleLogs = workingLogs.some(l => l.cycleId && deletedCycleIds.has(l.cycleId));
      assertReconciliationInvariant(!hasDeletedCycleLogs, 'Logs belonging to cycle removed through pending DELETE_CYCLE must not remain in final log collection');
    }
  }

  // Invariant 6: Expected visible pending cycles must exist exactly once and retain isSynced: false
  if (workingCycles && expectedPendingCycleIds.size > 0) {
    for (const expectedCycleId of expectedPendingCycleIds) {
      const matchingCycles = workingCycles.filter(c => c.id === expectedCycleId);
      assertReconciliationInvariant(
        matchingCycles.length === 1,
        'Expected pending cycle must exist exactly once in reconciled cycles'
      );
      if (matchingCycles.length > 0) {
        assertReconciliationInvariant(
          matchingCycles[0].isSynced === false,
          'Expected pending cycle must retain isSynced: false'
        );
      }
    }
  }

  // Invariant 7: Expected visible pending logs must exist and retain isSynced: false
  if (workingLogs && expectedPendingLogs.size > 0) {
    for (const targetLog of expectedPendingLogs.values()) {
      const matchingLog = workingLogs.find(l => {
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
      if (matchingLog) {
        assertReconciliationInvariant(
          matchingLog.isSynced === false,
          'Expected pending log must retain isSynced: false'
        );
      }
    }
  }

  // 7. Resolve active cycle ID
  let resolvedActiveCycleId: string | null = null;
  if (workingCycles && workingCycles.length > 0) {
    if (nextActiveCycleId && workingCycles.some(c => c.id === nextActiveCycleId)) {
      resolvedActiveCycleId = nextActiveCycleId;
    } else {
      resolvedActiveCycleId = workingCycles[0].id;
    }
  }

  // Emit aggregate-only reconciliation completion diagnostic
  emitSyncDiagnostic({
    eventType: 'RECONCILIATION_COMPLETED',
    timestamp: Date.now(),
    remoteCyclesCount: Array.isArray(remoteCycles) ? remoteCycles.length : 0,
    remoteLogsCount: Array.isArray(remoteLogs) ? remoteLogs.length : 0,
    pendingMutationsCount: validMutations.length,
    reconciledCyclesCount: workingCycles ? workingCycles.length : 0,
    reconciledLogsCount: workingLogs ? workingLogs.length : 0,
    demoConsumedChanged: shouldMarkDemoConsumed !== isDemoConsumed
  }, sink);

  return {
    cycles: workingCycles,
    logs: workingLogs,
    userProfile: workingProfile,
    shouldMarkDemoConsumed,
    nextActiveCycleId: resolvedActiveCycleId
  };
}
