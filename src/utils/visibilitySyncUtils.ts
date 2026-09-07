/**
 * Visibility-Based Remote Refetch Utilities for Bushido Discipline OS
 *
 * Remote pull on visibility is for multi-device catch-up, not realtime.
 *
 * Principles & Invariants:
 * 1. Catch-up on Resume: When the app returns to visibility (hidden -> visible or window focus),
 *    pull authoritative cycles and logs so changes made on a second device are reflected.
 * 2. Throttle Guard: Do not refetch if the last successful remote pull was within the throttle
 *    window (DEFAULT_VISIBILITY_REFETCH_THROTTLE_MS = 25000ms).
 * 3. Preconditions: Pull only when online, user is authenticated, and active account is stable.
 * 4. Coalescing: Debounce visibilitychange and focus events to eliminate duplicate fetches.
 * 5. Single In-Flight: Prevent overlapping or stacked concurrent visibility requests.
 * 6. Account Switch Protection: If active account transitions mid-flight, discard stale payload.
 * 7. Offline Queue Preservation: Reconcile through reconcileBootState to guarantee pending
 *    offline mutations for the active user are preserved with isSynced: false.
 * 8. Soft-Fail: Network errors fail gracefully without crashing UI or logging out the user.
 */

import { Cycle, DailyLog, UserProfile } from '../types';
import { normalizeQueueOwner, isGuestQueueOwner } from './storageCore';
import { getOfflineQueue } from './offlineQueueUtils';
import { getScopedDemoConsumedKey, safeGetLocalStorage, safeSetLocalStorage } from './storageUtils';
import { reconcileBootState, ReconciledBootState } from './syncReconciliation';
import { emitSyncDiagnostic, SyncDiagnosticSink, getSyncDiagnosticSink } from './syncDiagnostics';

export const DEFAULT_VISIBILITY_REFETCH_THROTTLE_MS = 25000;
export const DEFAULT_VISIBILITY_DEBOUNCE_MS = 250;

export type VisibilityRefetchStatus =
  | 'FETCHED'
  | 'SKIPPED_OFFLINE'
  | 'SKIPPED_UNAUTHENTICATED'
  | 'SKIPPED_THROTTLED'
  | 'SKIPPED_IN_FLIGHT'
  | 'SKIPPED_HIDDEN'
  | 'DISCARDED_STALE'
  | 'FAILED';

export interface VisibilityRefetchOutcome {
  status: VisibilityRefetchStatus;
  ownerId?: string | null;
  fetchedCyclesCount?: number;
  fetchedLogsCount?: number;
  reconciledCyclesCount?: number;
  reconciledLogsCount?: number;
  error?: unknown;
}

export interface VisibilityRefetchOptions {
  getCurrentActiveOwnerId: () => string | null;
  getCurrentAuthToken: () => string | null;
  getCurrentLocalState: () => {
    cycles: Cycle[];
    logs: DailyLog[];
    userProfile?: UserProfile;
  };
  onApplyReconciledState: (reconciled: ReconciledBootState, targetOwnerId: string) => void;
  requestSyncReplay?: (targetOwnerId: string, targetToken: string) => Promise<unknown>;
  isOnlineResolver?: () => boolean;
  throttleMs?: number;
  customFetch?: typeof fetch;
  diagnosticSink?: SyncDiagnosticSink;
  getLastPullTimestamp?: () => number;
  setLastPullTimestamp?: (ts: number) => void;
  isInFlight?: () => boolean;
  setIsInFlight?: (inFlight: boolean) => void;
  checkDocumentVisibility?: () => boolean;
}

/**
 * Module-level fallback coordinator state when component-level refs are not supplied.
 */
class VisibilityCoordinatorState {
  private lastPullTimestamp = 0;
  private inFlight = false;

  public getLastPull(): number {
    return this.lastPullTimestamp;
  }

  public setLastPull(ts: number): void {
    this.lastPullTimestamp = ts;
  }

  public isInFlight(): boolean {
    return this.inFlight;
  }

  public setInFlight(val: boolean): void {
    this.inFlight = val;
  }

  public reset(): void {
    this.lastPullTimestamp = 0;
    this.inFlight = false;
  }
}

export const defaultVisibilityCoordinator = new VisibilityCoordinatorState();

/**
 * Executes a principled, throttled remote pull of cycles and logs upon app visibility.
 * Reconciles authoritative server data with local state and active offline queues.
 */
export async function performVisibilityRefetch(
  options: VisibilityRefetchOptions
): Promise<VisibilityRefetchOutcome> {
  const sink = options.diagnosticSink || getSyncDiagnosticSink();

  // 1. Visibility check (skip if explicitly hidden)
  const isVisible = options.checkDocumentVisibility
    ? options.checkDocumentVisibility()
    : typeof document === 'undefined' || document.visibilityState !== 'hidden';

  if (!isVisible) {
    return { status: 'SKIPPED_HIDDEN' };
  }

  // 2. Online check
  const isOnline = options.isOnlineResolver
    ? options.isOnlineResolver()
    : typeof navigator === 'undefined' || typeof navigator.onLine !== 'boolean' || navigator.onLine;

  if (!isOnline) {
    return { status: 'SKIPPED_OFFLINE' };
  }

  // 3. Identity and authentication check
  const rawOwnerId = options.getCurrentActiveOwnerId();
  const rawToken = options.getCurrentAuthToken();

  if (
    !rawOwnerId ||
    isGuestQueueOwner(rawOwnerId) ||
    !rawToken ||
    typeof rawToken !== 'string' ||
    rawToken.trim().length === 0
  ) {
    return {
      status: 'SKIPPED_UNAUTHENTICATED',
      ownerId: rawOwnerId ? normalizeQueueOwner(rawOwnerId) : null
    };
  }

  const snapshotOwnerId = normalizeQueueOwner(rawOwnerId);
  const snapshotToken = rawToken.trim();

  // 4. In-flight check
  const checkInFlight = options.isInFlight
    ? options.isInFlight()
    : defaultVisibilityCoordinator.isInFlight();

  if (checkInFlight) {
    return {
      status: 'SKIPPED_IN_FLIGHT',
      ownerId: snapshotOwnerId
    };
  }

  // 5. Throttle check
  const now = Date.now();
  const lastPull = options.getLastPullTimestamp
    ? options.getLastPullTimestamp()
    : defaultVisibilityCoordinator.getLastPull();
  const throttleMs = options.throttleMs ?? DEFAULT_VISIBILITY_REFETCH_THROTTLE_MS;

  if (lastPull > 0 && now - lastPull < throttleMs) {
    return {
      status: 'SKIPPED_THROTTLED',
      ownerId: snapshotOwnerId
    };
  }

  // Set in-flight status
  if (options.setIsInFlight) {
    options.setIsInFlight(true);
  } else {
    defaultVisibilityCoordinator.setInFlight(true);
  }

  try {
    const fetchFn = options.customFetch || fetch;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${snapshotToken}`
    };

    // Parallel fetch of cycles and logs
    const [cyclesRes, logsRes] = await Promise.all([
      fetchFn('/api/cycles', { headers }).catch((err) => ({
        ok: false,
        status: 0,
        json: async () => null,
        error: err
      })),
      fetchFn('/api/logs', { headers }).catch((err) => ({
        ok: false,
        status: 0,
        json: async () => null,
        error: err
      }))
    ]);

    let apiCycles: Cycle[] | null = null;
    if (cyclesRes && cyclesRes.ok) {
      const cyclesData = await cyclesRes.json();
      const cyclesList = Array.isArray(cyclesData) ? cyclesData : (cyclesData?.cycles || []);
      if (Array.isArray(cyclesList)) {
        apiCycles = cyclesList;
      }
    }

    let apiLogs: DailyLog[] | null = null;
    if (logsRes && logsRes.ok) {
      const logsData = await logsRes.json();
      const logsList = Array.isArray(logsData) ? logsData : (logsData?.logs || []);
      if (Array.isArray(logsList)) {
        apiLogs = logsList;
      }
    }

    // If both requests completely failed, soft-fail without throwing
    if ((!cyclesRes || !cyclesRes.ok) && (!logsRes || !logsRes.ok)) {
      return {
        status: 'FAILED',
        ownerId: snapshotOwnerId,
        error: 'Both cycles and logs endpoints failed during visibility refetch'
      };
    }

    // 6. Account switch validation before applying state
    const currentOwnerBeforeReconciliation = normalizeQueueOwner(options.getCurrentActiveOwnerId());
    if (currentOwnerBeforeReconciliation !== snapshotOwnerId || isGuestQueueOwner(currentOwnerBeforeReconciliation)) {
      emitSyncDiagnostic({
        eventType: 'RECONCILIATION_DISCARDED_STALE',
        timestamp: Date.now(),
        outcomeStatus: 'DISCARDED_STALE',
        errorCategory: 'ACCOUNT_CHANGE',
        safeReason: 'ACCOUNT_CHANGED'
      }, sink);
      return {
        status: 'DISCARDED_STALE',
        ownerId: snapshotOwnerId
      };
    }

    // Load active owner's offline queue and demo status
    const ownerQueue = getOfflineQueue(snapshotOwnerId);
    const scopedDemoKey = getScopedDemoConsumedKey(snapshotOwnerId);
    const isDemoConsumed = safeGetLocalStorage(scopedDemoKey) === 'true';
    const localState = options.getCurrentLocalState();

    // Reconcile server snapshot with pending offline mutations
    const reconciled = reconcileBootState({
      authenticatedOwnerId: snapshotOwnerId,
      remoteCycles: apiCycles,
      remoteLogs: apiLogs,
      remoteUserProfile: localState.userProfile,
      currentLocalState: {
        cycles: localState.cycles,
        logs: localState.logs,
        userProfile: localState.userProfile
      },
      pendingQueue: ownerQueue,
      isDemoConsumed,
      diagnosticSink: sink
    });

    // Final account switch revalidation
    const currentOwnerAfterReconciliation = normalizeQueueOwner(options.getCurrentActiveOwnerId());
    if (currentOwnerAfterReconciliation !== snapshotOwnerId || isGuestQueueOwner(currentOwnerAfterReconciliation)) {
      emitSyncDiagnostic({
        eventType: 'RECONCILIATION_DISCARDED_STALE',
        timestamp: Date.now(),
        outcomeStatus: 'DISCARDED_STALE',
        errorCategory: 'ACCOUNT_CHANGE',
        safeReason: 'ACCOUNT_CHANGED'
      }, sink);
      return {
        status: 'DISCARDED_STALE',
        ownerId: snapshotOwnerId
      };
    }

    if (reconciled.shouldMarkDemoConsumed) {
      safeSetLocalStorage(scopedDemoKey, 'true');
    }

    // Apply reconciled updates to state
    options.onApplyReconciledState(reconciled, snapshotOwnerId);

    // Record successful pull timestamp
    const finishTimestamp = Date.now();
    if (options.setLastPullTimestamp) {
      options.setLastPullTimestamp(finishTimestamp);
    } else {
      defaultVisibilityCoordinator.setLastPull(finishTimestamp);
    }

    // Optional: if pending offline mutations exist, request replay via orchestrator
    if (options.requestSyncReplay && ownerQueue.length > 0) {
      options.requestSyncReplay(snapshotOwnerId, snapshotToken).catch((err) => {
        console.warn('[VisibilitySync] Background queue replay warning:', err);
      });
    }

    return {
      status: 'FETCHED',
      ownerId: snapshotOwnerId,
      fetchedCyclesCount: apiCycles?.length ?? 0,
      fetchedLogsCount: apiLogs?.length ?? 0,
      reconciledCyclesCount: reconciled.cycles?.length ?? 0,
      reconciledLogsCount: reconciled.logs?.length ?? 0
    };
  } catch (err) {
    console.warn('[VisibilitySync] Soft-failure during visibility refetch:', err);
    return {
      status: 'FAILED',
      ownerId: snapshotOwnerId,
      error: err
    };
  } finally {
    if (options.setIsInFlight) {
      options.setIsInFlight(false);
    } else {
      defaultVisibilityCoordinator.setInFlight(false);
    }
  }
}

export interface SetupVisibilityListenersOptions {
  onTriggerRefetch: () => void | Promise<unknown>;
  debounceMs?: number;
}

/**
 * Registers debounced and coalesced listeners for visibilitychange and window focus.
 * Returns a cleanup teardown function to safely remove all event listeners and timers.
 */
export function setupVisibilityRefetchListeners(
  options: SetupVisibilityListenersOptions
): () => void {
  const { onTriggerRefetch, debounceMs = DEFAULT_VISIBILITY_DEBOUNCE_MS } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const scheduleRefetch = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      return;
    }
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = null;
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void onTriggerRefetch();
      }
    }, debounceMs);
  };

  const handleVisibilityChange = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      scheduleRefetch();
    }
  };

  const handleFocus = () => {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      scheduleRefetch();
    }
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleFocus);
  }

  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('focus', handleFocus);
    }
  };
}
