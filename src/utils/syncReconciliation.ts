import { Cycle, DailyLog, UserProfile, OfflineQueueItem } from '../types';
import { resolveBackendSyncDecision } from './storageUtils';
import { normalizeQueueOwner, isGuestQueueOwner } from './storageCore';

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
function assertReconciliationInvariant(condition: boolean, message: string): void {
  if (!condition && process.env.NODE_ENV !== 'production') {
    console.warn(`[ReconciliationInvariantViolation] ${message}`);
  }
}

/**
 * Safe Boot Reconciliation with Pending Offline Mutations (Phase 3C.2).
 *
 * Pure, framework-neutral reconciliation that prevents authenticated boot hydration
 * from overwriting local optimistic state still represented in pending offline queues.
 *
 * Invariants:
 * 1. Server Authority Baseline: Remote server snapshot is the baseline for confirmed state.
 * 2. Scoped Ownership: Only mutations belonging strictly to authenticatedOwnerId are applied.
 *    Guest and other user mutations are ignored.
 * 3. Dependency Order: Pending mutations are applied in their exact chronological queue order.
 * 4. Truthful Sync State: All pending or modified items are marked `isSynced: false`.
 * 5. Privilege Immunity: Pending profile updates cannot elevate isAdmin, isVip, tier, etc.
 * 6. Idempotency: Repeated execution with identical inputs produces identical outputs without side effects.
 */
export function reconcileBootState(input: ReconcileBootStateInput): ReconciledBootState {
  const {
    authenticatedOwnerId,
    remoteCycles,
    remoteLogs,
    remoteUserProfile,
    currentLocalState,
    pendingQueue,
    isDemoConsumed
  } = input;

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
    return {
      cycles: workingCycles,
      logs: workingLogs,
      userProfile: workingProfile,
      shouldMarkDemoConsumed,
      nextActiveCycleId
    };
  }

  // Ensure working arrays exist if mutations need to be overlaid
  if (workingCycles === null) {
    workingCycles = currentLocalState.cycles ? currentLocalState.cycles.map(c => ({ ...c })) : [];
  }
  if (workingLogs === null) {
    workingLogs = currentLocalState.logs ? currentLocalState.logs.map(l => ({ ...l })) : [];
  }

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
          }
          // If target cycle cannot be found and no matching pending creation, do not invent confirmed cycle
        }
        break;
      }

      case 'DELETE_CYCLE': {
        const targetCycleId = typeof item.payload === 'string' ? item.payload : item.payload?.id;
        if (targetCycleId && typeof targetCycleId === 'string') {
          // Remove target cycle from visible reconciled state
          workingCycles = workingCycles.filter(c => c.id !== targetCycleId);
          // Remove or suppress associated logs from visible reconciled state
          workingLogs = workingLogs.filter(l => l.cycleId !== targetCycleId);
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

  // 6. Resolve active cycle ID
  let resolvedActiveCycleId: string | null = null;
  if (workingCycles && workingCycles.length > 0) {
    if (nextActiveCycleId && workingCycles.some(c => c.id === nextActiveCycleId)) {
      resolvedActiveCycleId = nextActiveCycleId;
    } else {
      resolvedActiveCycleId = workingCycles[0].id;
    }
  }

  return {
    cycles: workingCycles,
    logs: workingLogs,
    userProfile: workingProfile,
    shouldMarkDemoConsumed,
    nextActiveCycleId: resolvedActiveCycleId
  };
}
