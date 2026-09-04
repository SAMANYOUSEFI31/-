import { OfflineQueueItem } from '../types';
import {
  replayAccountOfflineQueue,
  ReplayOptions,
  ReplayResult,
  normalizeQueueOwner,
  isGuestQueueOwner
} from './offlineQueueUtils';

/**
 * =============================================================================
 * PHASE 3C.1: SINGLE SYNC ORCHESTRATOR AND TRIGGER OWNERSHIP
 * =============================================================================
 *
 * Closed vocabulary of supported sync trigger sources:
 * - BOOT_AUTH_VERIFIED: Initial boot/auth hydration after verified /api/auth/me
 * - NETWORK_ONLINE: Browser network online event
 * - AUTH_SUCCESS: User logged in via credentials / SMS OTP
 * - QUICK_LOGIN_SUCCESS: Developer / admin quick-login completed
 * - IMPERSONATION_START: Admin began impersonating another user
 * - IMPERSONATION_EXIT: Admin successfully restored original admin identity
 * - MANUAL_FORCE: Explicit developer or diagnostic forced replay
 */
export type SyncTrigger =
  | 'BOOT_AUTH_VERIFIED'
  | 'NETWORK_ONLINE'
  | 'AUTH_SUCCESS'
  | 'QUICK_LOGIN_SUCCESS'
  | 'IMPERSONATION_START'
  | 'IMPERSONATION_EXIT'
  | 'MANUAL_FORCE';

export type SyncRunStatus =
  | 'COMPLETED'
  | 'SKIPPED_OFFLINE'
  | 'SKIPPED_GUEST_OR_ANONYMOUS'
  | 'DISCARDED_STALE'
  | 'ABORTED'
  | 'FAILED';

export interface SyncRunOutcome {
  ownerId: string;
  triggers: SyncTrigger[];
  syncedCount: number;
  failedCount: number;
  remainingQueueCount: number;
  stoppedDueToAuth: boolean;
  stoppedDueToAccountChange: boolean;
  stoppedDueToLockLoss: boolean;
  status: SyncRunStatus;
  error?: unknown;
}

export interface SyncRequest {
  trigger: SyncTrigger;
  targetOwnerId?: string | null;
  targetToken?: string | null;
  force?: boolean;
  currentActiveAccountResolver?: () => string | null;
  replayExecutor?: (options: ReplayOptions) => Promise<ReplayResult>;
  isOnlineResolver?: () => boolean;
  onItemSuccess?: (item: OfflineQueueItem) => void;
  onResult?: (outcome: SyncRunOutcome) => void;
}

export interface SyncOrchestratorConfig {
  currentActiveAccountResolver?: () => string | null;
  replayExecutor?: (options: ReplayOptions) => Promise<ReplayResult>;
  isOnlineResolver?: () => boolean;
  defaultItemSuccessCallback?: (item: OfflineQueueItem) => void;
  defaultResultCallback?: (outcome: SyncRunOutcome) => void;
}

interface ActiveRunState {
  ownerId: string;
  token: string;
  force: boolean;
  triggers: Set<SyncTrigger>;
  currentActiveAccountResolver: () => string | null;
  replayExecutor: (options: ReplayOptions) => Promise<ReplayResult>;
  itemSuccessCallbacks: Set<(item: OfflineQueueItem) => void>;
  resultCallbacks: Set<(outcome: SyncRunOutcome) => void>;
  promise: Promise<SyncRunOutcome>;
}

interface PendingTrailingState {
  ownerId: string;
  token: string;
  force: boolean;
  triggers: Set<SyncTrigger>;
  currentActiveAccountResolver: () => string | null;
  replayExecutor: (options: ReplayOptions) => Promise<ReplayResult>;
  itemSuccessCallbacks: Set<(item: OfflineQueueItem) => void>;
  resultCallbacks: Set<(outcome: SyncRunOutcome) => void>;
  deferredResolvers: Array<(outcome: SyncRunOutcome) => void>;
}

/**
 * Single client-side Sync Orchestrator for Bushido Discipline OS.
 * Serves as the sole application-level gateway for requesting offline queue replay.
 */
export class SyncOrchestrator {
  private config: SyncOrchestratorConfig;
  private activeRun: ActiveRunState | null = null;
  private pendingTrailing: PendingTrailingState | null = null;

  constructor(config?: SyncOrchestratorConfig) {
    this.config = config || {};
  }

  public isRunActive(): boolean {
    return this.activeRun !== null;
  }

  public hasPendingTrailing(): boolean {
    return this.pendingTrailing !== null;
  }

  public getActiveRun(): { ownerId: string; force: boolean; triggers: SyncTrigger[] } | null {
    if (!this.activeRun) return null;
    return {
      ownerId: this.activeRun.ownerId,
      force: this.activeRun.force,
      triggers: Array.from(this.activeRun.triggers)
    };
  }

  public getPendingTrailing(): { ownerId: string; force: boolean; triggers: SyncTrigger[] } | null {
    if (!this.pendingTrailing) return null;
    return {
      ownerId: this.pendingTrailing.ownerId,
      force: this.pendingTrailing.force,
      triggers: Array.from(this.pendingTrailing.triggers)
    };
  }

  private isOnline(request?: SyncRequest): boolean {
    if (request?.isOnlineResolver) {
      return request.isOnlineResolver();
    }
    if (this.config.isOnlineResolver) {
      return this.config.isOnlineResolver();
    }
    if (typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean') {
      return navigator.onLine;
    }
    return true;
  }

  /**
   * Request synchronization through the single orchestrator gateway.
   */
  public async requestSync(request: SyncRequest): Promise<SyncRunOutcome> {
    const activeResolver =
      request.currentActiveAccountResolver ||
      this.config.currentActiveAccountResolver ||
      (() => null);

    const rawOwner =
      request.targetOwnerId !== undefined
        ? request.targetOwnerId
        : activeResolver();

    const rawToken = request.targetToken;
    const isForce = Boolean(request.force || request.trigger === 'MANUAL_FORCE');
    const replayExecutor =
      request.replayExecutor ||
      this.config.replayExecutor ||
      replayAccountOfflineQueue;

    // 1. Online check
    if (!this.isOnline(request)) {
      const normOwner = rawOwner ? normalizeQueueOwner(rawOwner) : '';
      return {
        ownerId: normOwner,
        triggers: [request.trigger],
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: false,
        stoppedDueToLockLoss: false,
        status: 'SKIPPED_OFFLINE'
      };
    }

    // 2. Identity and token snapshot validation:
    // Replay requires an authenticated user ID and non-empty token
    if (
      !rawOwner ||
      isGuestQueueOwner(rawOwner) ||
      !rawToken ||
      typeof rawToken !== 'string' ||
      rawToken.trim().length === 0
    ) {
      const normOwner = rawOwner ? normalizeQueueOwner(rawOwner) : '';
      return {
        ownerId: normOwner,
        triggers: [request.trigger],
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: true,
        stoppedDueToAccountChange: false,
        stoppedDueToLockLoss: false,
        status: 'SKIPPED_GUEST_OR_ANONYMOUS'
      };
    }

    const normOwner = normalizeQueueOwner(rawOwner);

    // 3. Active run check:
    // If an active run is in progress, coalesce or retain as the single pending trailing request
    const itemCbs = new Set<(item: OfflineQueueItem) => void>();
    if (this.config.defaultItemSuccessCallback) {
      itemCbs.add(this.config.defaultItemSuccessCallback);
    }
    if (request.onItemSuccess) {
      itemCbs.add(request.onItemSuccess);
    }

    const resCbs = new Set<(outcome: SyncRunOutcome) => void>();
    if (this.config.defaultResultCallback) {
      resCbs.add(this.config.defaultResultCallback);
    }
    if (request.onResult) {
      resCbs.add(request.onResult);
    }

    if (this.activeRun !== null) {
      if (this.pendingTrailing === null) {
        let resolver!: (outcome: SyncRunOutcome) => void;
        const promise = new Promise<SyncRunOutcome>((res) => {
          resolver = res;
        });

        this.pendingTrailing = {
          ownerId: normOwner,
          token: rawToken,
          force: isForce,
          triggers: new Set([request.trigger]),
          currentActiveAccountResolver: activeResolver,
          replayExecutor,
          itemSuccessCallbacks: itemCbs,
          resultCallbacks: resCbs,
          deferredResolvers: [resolver]
        };

        return promise;
      }

      // Existing pending trailing request:
      if (this.pendingTrailing.ownerId === normOwner) {
        // Coalesce same-owner requests:
        // - force=true dominates force=false
        // - newer token snapshot replaces older snapshot
        // - trigger metadata is added to deduplicated set
        this.pendingTrailing.force = this.pendingTrailing.force || isForce;
        this.pendingTrailing.token = rawToken;
        this.pendingTrailing.triggers.add(request.trigger);
        if (request.onItemSuccess) {
          this.pendingTrailing.itemSuccessCallbacks.add(request.onItemSuccess);
        }
        if (request.onResult) {
          this.pendingTrailing.resultCallbacks.add(request.onResult);
        }

        return new Promise<SyncRunOutcome>((res) => {
          this.pendingTrailing?.deferredResolvers.push(res);
        });
      } else {
        // Different owner: account transition occurred during active run!
        // Discard previous owner's pending trailing request
        const oldPending = this.pendingTrailing;
        const discardedOutcome: SyncRunOutcome = {
          ownerId: oldPending.ownerId,
          triggers: Array.from(oldPending.triggers),
          syncedCount: 0,
          failedCount: 0,
          remainingQueueCount: 0,
          stoppedDueToAuth: false,
          stoppedDueToAccountChange: true,
          stoppedDueToLockLoss: false,
          status: 'DISCARDED_STALE'
        };
        for (const res of oldPending.deferredResolvers) {
          res(discardedOutcome);
        }

        // Install new owner's request as the single pending trailing request
        let resolver!: (outcome: SyncRunOutcome) => void;
        const promise = new Promise<SyncRunOutcome>((res) => {
          resolver = res;
        });

        this.pendingTrailing = {
          ownerId: normOwner,
          token: rawToken,
          force: isForce,
          triggers: new Set([request.trigger]),
          currentActiveAccountResolver: activeResolver,
          replayExecutor,
          itemSuccessCallbacks: itemCbs,
          resultCallbacks: resCbs,
          deferredResolvers: [resolver]
        };

        return promise;
      }
    }

    // 4. No active run: start immediately
    return this.startActiveRun({
      ownerId: normOwner,
      token: rawToken,
      force: isForce,
      triggers: new Set([request.trigger]),
      currentActiveAccountResolver: activeResolver,
      replayExecutor,
      itemSuccessCallbacks: itemCbs,
      resultCallbacks: resCbs
    });
  }

  private startActiveRun(runSpec: {
    ownerId: string;
    token: string;
    force: boolean;
    triggers: Set<SyncTrigger>;
    currentActiveAccountResolver: () => string | null;
    replayExecutor: (options: ReplayOptions) => Promise<ReplayResult>;
    itemSuccessCallbacks: Set<(item: OfflineQueueItem) => void>;
    resultCallbacks: Set<(outcome: SyncRunOutcome) => void>;
  }): Promise<SyncRunOutcome> {
    const promise = this.executeRun(runSpec).finally(() => {
      this.activeRun = null;
      this.scheduleTrailingRunIfNeeded();
    });

    this.activeRun = {
      ownerId: runSpec.ownerId,
      token: runSpec.token,
      force: runSpec.force,
      triggers: runSpec.triggers,
      currentActiveAccountResolver: runSpec.currentActiveAccountResolver,
      replayExecutor: runSpec.replayExecutor,
      itemSuccessCallbacks: runSpec.itemSuccessCallbacks,
      resultCallbacks: runSpec.resultCallbacks,
      promise
    };

    return promise;
  }

  private async executeRun(runSpec: {
    ownerId: string;
    token: string;
    force: boolean;
    triggers: Set<SyncTrigger>;
    currentActiveAccountResolver: () => string | null;
    replayExecutor: (options: ReplayOptions) => Promise<ReplayResult>;
    itemSuccessCallbacks: Set<(item: OfflineQueueItem) => void>;
    resultCallbacks: Set<(outcome: SyncRunOutcome) => void>;
  }): Promise<SyncRunOutcome> {
    // Identity revalidation before starting execution
    const currentActiveBefore = normalizeQueueOwner(runSpec.currentActiveAccountResolver());
    if (currentActiveBefore !== runSpec.ownerId || isGuestQueueOwner(currentActiveBefore)) {
      return {
        ownerId: runSpec.ownerId,
        triggers: Array.from(runSpec.triggers),
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: true,
        stoppedDueToLockLoss: false,
        status: 'DISCARDED_STALE'
      };
    }

    // Wrapped item success callback:
    // Confirm active account still matches run owner before applying visible state update
    const wrappedOnItemSuccess = (item: OfflineQueueItem) => {
      const activeNow = normalizeQueueOwner(runSpec.currentActiveAccountResolver());
      if (activeNow === runSpec.ownerId && !isGuestQueueOwner(activeNow)) {
        for (const cb of runSpec.itemSuccessCallbacks) {
          try {
            cb(item);
          } catch (err) {
            console.error('[SyncOrchestrator] Error in onItemSuccess callback:', err);
          }
        }
      }
    };

    try {
      const replayResult = await runSpec.replayExecutor({
        activeAccountId: runSpec.ownerId,
        authToken: runSpec.token,
        force: runSpec.force,
        respectBackoff: !runSpec.force,
        getCurrentActiveAccountId: () => runSpec.currentActiveAccountResolver(),
        onItemSuccess: wrappedOnItemSuccess
      });

      // Identity revalidation after replay execution finishes
      const currentActiveAfter = normalizeQueueOwner(runSpec.currentActiveAccountResolver());
      const isStillActiveOwner =
        currentActiveAfter === runSpec.ownerId && !isGuestQueueOwner(currentActiveAfter);

      const stoppedDueToAccountChange =
        replayResult.stoppedDueToAccountChange || !isStillActiveOwner;

      const outcome: SyncRunOutcome = {
        ownerId: runSpec.ownerId,
        triggers: Array.from(runSpec.triggers),
        syncedCount: replayResult.syncedCount,
        failedCount: replayResult.failedCount,
        remainingQueueCount: replayResult.remainingQueueCount,
        stoppedDueToAuth: replayResult.stoppedDueToAuth,
        stoppedDueToAccountChange,
        stoppedDueToLockLoss: Boolean(replayResult.stoppedDueToLockLoss),
        status: stoppedDueToAccountChange ? 'DISCARDED_STALE' : 'COMPLETED'
      };

      // Safe result notification:
      // Only invoke when account still matches and run was not invalidated
      if (
        isStillActiveOwner &&
        !outcome.stoppedDueToAccountChange &&
        !outcome.stoppedDueToLockLoss &&
        !outcome.stoppedDueToAuth
      ) {
        for (const cb of runSpec.resultCallbacks) {
          try {
            cb(outcome);
          } catch (err) {
            console.error('[SyncOrchestrator] Error in onResult callback:', err);
          }
        }
      }

      return outcome;
    } catch (error) {
      const outcome: SyncRunOutcome = {
        ownerId: runSpec.ownerId,
        triggers: Array.from(runSpec.triggers),
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: false,
        stoppedDueToLockLoss: false,
        status: 'FAILED',
        error
      };
      return outcome;
    }
  }

  private scheduleTrailingRunIfNeeded(): void {
    if (!this.pendingTrailing) {
      return;
    }

    const pending = this.pendingTrailing;
    this.pendingTrailing = null;

    // Revalidate pending request against CURRENT active account:
    const currentActive = normalizeQueueOwner(pending.currentActiveAccountResolver());

    // 1. If active account is missing or guest, discard
    if (!currentActive || isGuestQueueOwner(currentActive)) {
      const discardedOutcome: SyncRunOutcome = {
        ownerId: pending.ownerId,
        triggers: Array.from(pending.triggers),
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: true,
        stoppedDueToLockLoss: false,
        status: 'DISCARDED_STALE'
      };
      for (const res of pending.deferredResolvers) {
        res(discardedOutcome);
      }
      return;
    }

    // 2. If pending owner does not match current active account, discard
    if (pending.ownerId !== currentActive) {
      const discardedOutcome: SyncRunOutcome = {
        ownerId: pending.ownerId,
        triggers: Array.from(pending.triggers),
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: true,
        stoppedDueToLockLoss: false,
        status: 'DISCARDED_STALE'
      };
      for (const res of pending.deferredResolvers) {
        res(discardedOutcome);
      }
      return;
    }

    // 3. Online check
    if (!this.isOnline()) {
      const offlineOutcome: SyncRunOutcome = {
        ownerId: pending.ownerId,
        triggers: Array.from(pending.triggers),
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: false,
        stoppedDueToLockLoss: false,
        status: 'SKIPPED_OFFLINE'
      };
      for (const res of pending.deferredResolvers) {
        res(offlineOutcome);
      }
      return;
    }

    // 4. Start trailing run and pipe outcome to deferredResolvers
    const runPromise = this.startActiveRun({
      ownerId: pending.ownerId,
      token: pending.token,
      force: pending.force,
      triggers: pending.triggers,
      currentActiveAccountResolver: pending.currentActiveAccountResolver,
      replayExecutor: pending.replayExecutor,
      itemSuccessCallbacks: pending.itemSuccessCallbacks,
      resultCallbacks: pending.resultCallbacks
    });

    runPromise
      .then((outcome) => {
        for (const res of pending.deferredResolvers) {
          res(outcome);
        }
      })
      .catch((err) => {
        const failOutcome: SyncRunOutcome = {
          ownerId: pending.ownerId,
          triggers: Array.from(pending.triggers),
          syncedCount: 0,
          failedCount: 0,
          remainingQueueCount: 0,
          stoppedDueToAuth: false,
          stoppedDueToAccountChange: false,
          stoppedDueToLockLoss: false,
          status: 'FAILED',
          error: err
        };
        for (const res of pending.deferredResolvers) {
          res(failOutcome);
        }
      });
  }

  /**
   * Cancels any pending trailing sync request (e.g. on user logout).
   */
  public cancelPendingSync(): void {
    if (this.pendingTrailing) {
      const pending = this.pendingTrailing;
      this.pendingTrailing = null;
      const outcome: SyncRunOutcome = {
        ownerId: pending.ownerId,
        triggers: Array.from(pending.triggers),
        syncedCount: 0,
        failedCount: 0,
        remainingQueueCount: 0,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: true,
        stoppedDueToLockLoss: false,
        status: 'ABORTED'
      };
      for (const res of pending.deferredResolvers) {
        res(outcome);
      }
    }
  }

  /**
   * Resets orchestrator state (used in testing or app teardown).
   */
  public reset(): void {
    this.cancelPendingSync();
    this.activeRun = null;
  }
}

/**
 * Creates an isolated SyncOrchestrator instance.
 */
export function createSyncOrchestrator(config?: SyncOrchestratorConfig): SyncOrchestrator {
  return new SyncOrchestrator(config);
}

/**
 * Parameters for binding verified boot identity to runtime refs and dispatching BOOT_AUTH_VERIFIED sync.
 */
export interface BootAuthIdentityBindingParams {
  verifiedUserId: string;
  verifiedToken: string;
  activeAccountRef: { current: string | null };
  authTokenRef: { current: string | null };
  setActiveAccountId?: (id: string | null) => void;
  requestSync: (
    trigger: SyncTrigger,
    targetOwnerId?: string | null,
    targetToken?: string | null,
    force?: boolean
  ) => Promise<SyncRunOutcome>;
}

/**
 * Pure identity-binding helper for authenticated boot and quick-login.
 * Ensures activeAccountRef, authTokenRef, and local storage pointer are bound
 * synchronously to the verified user before requesting BOOT_AUTH_VERIFIED synchronization.
 */
export function bindBootAuthAndRequestSync({
  verifiedUserId,
  verifiedToken,
  activeAccountRef,
  authTokenRef,
  setActiveAccountId,
  requestSync
}: BootAuthIdentityBindingParams): Promise<SyncRunOutcome> {
  activeAccountRef.current = verifiedUserId;
  authTokenRef.current = verifiedToken;
  if (setActiveAccountId) {
    setActiveAccountId(verifiedUserId);
  }
  return requestSync('BOOT_AUTH_VERIFIED', verifiedUserId, verifiedToken);
}

