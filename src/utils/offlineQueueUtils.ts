import { OfflineMutationType, OfflineQueueItem, ReplayFailureClassification } from '../types';
import { 
  normalizeUserId, 
  normalizeQueueOwner,
  isGuestQueueOwner,
  getScopedOfflineQueueKey,
  safeGetLocalStorage, 
  safeSetLocalStorage, 
  safeRemoveLocalStorage,
  GUEST_QUEUE_OWNER,
  OFFLINE_QUEUE_PREFIX,
  LEGACY_OFFLINE_QUEUE_KEY
} from './storageCore';

export {
  normalizeQueueOwner,
  isGuestQueueOwner,
  getScopedOfflineQueueKey,
  GUEST_QUEUE_OWNER,
  OFFLINE_QUEUE_PREFIX,
  LEGACY_OFFLINE_QUEUE_KEY
};

/**
 * =============================================================================
 * PHASE 3B.3: REPLAY CONTRACT & CONCURRENCY COORDINATION SPECIFICATION
 * =============================================================================
 *
 * 1. Best-Effort Ephemeral Leases (localStorage Across Tabs / Workers):
 *    - The localStorage lease mechanism (`acquireReplayLock`, `verifyReplayLock`, `renewReplayLock`, `releaseReplayLock`)
 *      provides best-effort mutual exclusion across browser tabs and web workers within the same origin.
 *    - Because Web Storage (`localStorage`) lacks hardware-level atomic Compare-And-Swap (CAS) primitives
 *      or distributed consensus guarantees, write-then-readback verification and millisecond timestamp leases
 *      minimize race windows.
 *    - localStorage leases are strictly an advisory optimization to reduce superfluous redundant network requests;
 *      they are NOT guaranteed distributed locks and must NEVER be relied upon as the sole line of defense.
 *
 * 2. Risk of Browser Timer Throttling:
 *    - Modern browsers aggressively throttle timers (`setInterval`, `setTimeout`) in inactive, background,
 *      or minimized tabs, as well as on mobile devices under operating system power-saving policies.
 *    - Timer throttling can delay heartbeat renewal executions past the effective lease timeout boundary,
 *      allowing another foreground tab to legitimately assume lease ownership and initiate replay.
 *    - The client-side replay loop handles this gracefully via dual verification (in-flight heartbeat failure
 *      detection and post-fetch CAS lease verification): if a lease is expired or assumed by another tab,
 *      the current replay loop halts immediately (`stoppedDueToLockLoss: true`), does NOT mutate queue state,
 *      and does NOT emit `onItemSuccess`.
 *
 * 3. Role of Heartbeats in Bridging Lease Duration and Request Duration:
 *    - To protect against abandoned leases caused by crashed tabs, closed windows, or killed worker threads,
 *      the lease timeout (`leaseTimeoutMs`, production default 10,000ms) is intentionally bounded.
 *    - Individual high-latency HTTP requests, heavy payloads, or poor cellular connections may take significantly
 *      longer to execute than the lease duration.
 *    - Periodic in-flight heartbeats (`heartbeatIntervalMs`, strictly configured below lease timeout) execute
 *      during active network fetch operations to refresh the lease timestamp in `localStorage`.
 *    - This bridges the gap between short lease expiration windows and arbitrarily long in-flight network requests,
 *      holding the lease active as long as the requesting tab remains responsive and network execution continues.
 *    - Once the request completes (success, network error, HTTP error, or detected lock loss), the heartbeat
 *      interval is synchronously and deterministically cleared in `finally` blocks, preventing resource or handle leaks.
 *
 * 4. Mandatory Server-Side Idempotency:
 *    - Because client leases are best-effort, ambiguous network delivery (e.g. client connection drops after the server
 *      commits a mutation, or concurrent replays across two tabs) can cause at-least-once delivery duplicates.
 *    - Therefore, server-side idempotency remains MANDATORY and AUTHORITATIVE:
 *      * Every replayable mutation includes a stable `clientOperationId` (derived deterministically from `item.id`).
 *      * Cycles enforce server-authoritative deduplication on `clientOperationId` scoped strictly to `userId`.
 *      * Daily logs enforce composite unique constraints on `(userId, date)`.
 *      * User profiles enforce atomic updates scoped strictly to the authenticated `userId`.
 *    - Server-side deduplication guarantees that replaying an operation multiple times produces identical state
 *      without duplicating records or leaking mutations across distinct users.
 * =============================================================================
 */

export const OFFLINE_QUARANTINE_PREFIX = 'bushido_quarantine_';
export const LEGACY_AMBIGUOUS_QUARANTINE_KEY = 'bushido_quarantine_legacy_ambiguous';
export const LEGACY_OFFLINE_QUARANTINE_KEY = 'bushido_offline_queue_quarantine';
export const OFFLINE_QUARANTINE_KEY = 'bushido_offline_queue_quarantine';

export const MAX_REPLAY_RETRIES = 5;
export const REPLAY_LOCK_PREFIX = 'bushido_replay_lock_';
export const REPLAY_LOCK_TIMEOUT_MS = 10000;
export const REPLAY_LOCK_HEARTBEAT_INTERVAL_MS = 3000;

export const MIN_REPLAY_LOCK_TIMEOUT_MS = 20;
export const MIN_REPLAY_LOCK_HEARTBEAT_INTERVAL_MS = 5;

/**
 * Normalizes and validates the replay lease timeout.
 * - Preserves REPLAY_LOCK_TIMEOUT_MS = 10000 as the production default.
 * - Rejects/normalizes NaN, Infinity, negative, zero, fractional, and non-number values safely.
 * - Enforces MIN_REPLAY_LOCK_TIMEOUT_MS.
 */
export function resolveReplayLockTimeout(timeoutMs?: unknown): number {
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isFinite(timeoutMs) ||
    Number.isNaN(timeoutMs) ||
    timeoutMs <= 0
  ) {
    return REPLAY_LOCK_TIMEOUT_MS;
  }
  const floored = Math.floor(timeoutMs);
  return Math.max(MIN_REPLAY_LOCK_TIMEOUT_MS, floored);
}

/**
 * Normalizes and validates the replay heartbeat interval.
 * - Heartbeat interval must remain strictly below the effective lease timeout.
 * - Rejects/normalizes NaN, Infinity, negative, zero, fractional, and non-number values safely.
 * - Clamps to MIN_REPLAY_LOCK_HEARTBEAT_INTERVAL_MS to prevent tight-loop timer storms.
 */
export function resolveHeartbeatInterval(intervalMs?: unknown, effectiveLeaseTimeoutMs?: number): number {
  const leaseTimeout = resolveReplayLockTimeout(effectiveLeaseTimeoutMs);

  let interval: number;
  if (
    typeof intervalMs !== 'number' ||
    !Number.isFinite(intervalMs) ||
    Number.isNaN(intervalMs) ||
    intervalMs <= 0
  ) {
    if (leaseTimeout === REPLAY_LOCK_TIMEOUT_MS) {
      interval = REPLAY_LOCK_HEARTBEAT_INTERVAL_MS;
    } else {
      interval = Math.max(MIN_REPLAY_LOCK_HEARTBEAT_INTERVAL_MS, Math.floor(leaseTimeout / 3));
    }
  } else {
    interval = Math.floor(intervalMs);
  }

  // Prevent tight-loop timer storms
  interval = Math.max(MIN_REPLAY_LOCK_HEARTBEAT_INTERVAL_MS, interval);

  // Heartbeat interval must remain strictly below the effective lease timeout
  if (interval >= leaseTimeout) {
    interval = Math.max(MIN_REPLAY_LOCK_HEARTBEAT_INTERVAL_MS, Math.floor(leaseTimeout / 2));
    if (interval >= leaseTimeout) {
      interval = Math.max(1, leaseTimeout - 1);
    }
  }

  return interval;
}

export const INITIAL_REPLAY_BACKOFF_MS = 2000;
export const MAX_REPLAY_BACKOFF_MS = 30000;
export const MAX_SANITIZATION_DEPTH = 5;

/**
 * Computes bounded exponential backoff with randomized jitter to prevent thundering herd.
 */
export function calculateReplayBackoffMs(retryCount: number): number {
  const safeCount = Math.max(1, retryCount);
  const base = INITIAL_REPLAY_BACKOFF_MS * Math.pow(2, Math.min(safeCount - 1, 4));
  const jitter = Math.floor(Math.random() * 1000);
  return Math.min(MAX_REPLAY_BACKOFF_MS, base + jitter);
}

// In-flight replay promise tracker per account to prevent intra-tab concurrent replays
const inFlightReplayPromises = new Map<string, Promise<ReplayResult>>();

export interface ReplayTimingDependencies {
  now?: () => number;
  setInterval?: (callback: () => void, intervalMs: number) => any;
  clearInterval?: (handle: any) => void;
}

export interface ResolvedReplayTiming {
  now: () => number;
  setInterval: (callback: () => void, intervalMs: number) => any;
  clearInterval: (handle: any) => void;
  leaseTimeoutMs: number;
  heartbeatIntervalMs: number;
}

/**
 * Resolves a single consistent timing contract per replay execution.
 * When no timing dependency is supplied, production defaults are strictly preserved:
 * Date.now, globalThis.setInterval, globalThis.clearInterval,
 * REPLAY_LOCK_TIMEOUT_MS (10000), and REPLAY_LOCK_HEARTBEAT_INTERVAL_MS (3000).
 */
export function resolveReplayTiming(options?: {
  leaseTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  lockTiming?: ReplayLockTimingConfig;
  timing?: ReplayTimingDependencies;
}): ResolvedReplayTiming {
  const rawLease = options?.lockTiming?.leaseTimeoutMs ?? options?.leaseTimeoutMs;
  const rawHb = options?.lockTiming?.heartbeatIntervalMs ?? options?.heartbeatIntervalMs;
  const leaseTimeoutMs = resolveReplayLockTimeout(rawLease);
  const heartbeatIntervalMs = resolveHeartbeatInterval(rawHb, leaseTimeoutMs);

  const now = options?.timing?.now ?? (() => Date.now());
  const customSetInterval = options?.timing?.setInterval ?? ((cb, ms) => globalThis.setInterval(cb, ms));
  const customClearInterval = options?.timing?.clearInterval ?? ((h) => globalThis.clearInterval(h));

  return {
    now,
    setInterval: customSetInterval,
    clearInterval: customClearInterval,
    leaseTimeoutMs,
    heartbeatIntervalMs
  };
}

/**
 * Acquires a cross-tab ephemeral storage lease for replay execution.
 * Returns the acquired unique lockId string on success, or null on failure/contention.
 */
export function acquireReplayLock(
  owner: string, 
  timeoutMs?: number,
  clockOrTiming?: (() => number) | { now?: () => number }
): string | null {
  const normOwner = normalizeQueueOwner(owner);
  const lockKey = `${REPLAY_LOCK_PREFIX}${normOwner}`;
  const effectiveTimeout = resolveReplayLockTimeout(timeoutMs);
  const getNow = typeof clockOrTiming === 'function' 
    ? clockOrTiming 
    : (clockOrTiming?.now ?? (() => Date.now()));
  const now = getNow();
  const existingRaw = safeGetLocalStorage(lockKey);
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed && typeof parsed.timestamp === 'number' && (now - parsed.timestamp) < effectiveTimeout) {
        return null;
      }
    } catch {
      // Corrupted lock payload, overwrite safely
    }
  }

  const lockId = `lease_${now}_${Math.random().toString(36).substring(2, 10)}`;
  safeSetLocalStorage(lockKey, JSON.stringify({ lockId, timestamp: now }));

  // Read-back verification (CAS check): Verify that the stored lockId still belongs to this caller
  const readBackRaw = safeGetLocalStorage(lockKey);
  if (readBackRaw) {
    try {
      const readBack = JSON.parse(readBackRaw);
      if (readBack?.lockId === lockId) {
        return lockId;
      }
    } catch {}
  }

  return null;
}

/**
 * Verifies that the cross-tab lease is currently active and belongs to the given lockId.
 */
export function verifyReplayLock(
  owner: string, 
  lockId: string, 
  timeoutMs?: number,
  clockOrTiming?: (() => number) | { now?: () => number }
): boolean {
  if (!lockId) return false;
  const normOwner = normalizeQueueOwner(owner);
  const lockKey = `${REPLAY_LOCK_PREFIX}${normOwner}`;
  const effectiveTimeout = resolveReplayLockTimeout(timeoutMs);
  const raw = safeGetLocalStorage(lockKey);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const getNow = typeof clockOrTiming === 'function' 
      ? clockOrTiming 
      : (clockOrTiming?.now ?? (() => Date.now()));
    const now = getNow();
    if (parsed?.lockId === lockId && typeof parsed.timestamp === 'number' && (now - parsed.timestamp) < effectiveTimeout) {
      return true;
    }
  } catch {}
  return false;
}

/**
 * Renews the cross-tab lease timestamp for the current lockId holder.
 * Only the active holder can renew. Returns false if ownership was lost or expired.
 */
export function renewReplayLock(
  owner: string, 
  lockId: string, 
  timeoutMs?: number,
  clockOrTiming?: (() => number) | { now?: () => number }
): boolean {
  if (!lockId) return false;
  const normOwner = normalizeQueueOwner(owner);
  const lockKey = `${REPLAY_LOCK_PREFIX}${normOwner}`;
  const effectiveTimeout = resolveReplayLockTimeout(timeoutMs);
  const raw = safeGetLocalStorage(lockKey);
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw);
    const getNow = typeof clockOrTiming === 'function' 
      ? clockOrTiming 
      : (clockOrTiming?.now ?? (() => Date.now()));
    const now = getNow();
    if (parsed?.lockId !== lockId) {
      // Lock has been taken over by another tab/holder
      return false;
    }
    if (typeof parsed.timestamp !== 'number' || (now - parsed.timestamp) >= effectiveTimeout) {
      // Lease already expired; cannot revive an expired lease
      return false;
    }
    // Update timestamp
    safeSetLocalStorage(lockKey, JSON.stringify({ lockId, timestamp: now }));
    const verifyRaw = safeGetLocalStorage(lockKey);
    if (verifyRaw) {
      const verifyParsed = JSON.parse(verifyRaw);
      return verifyParsed?.lockId === lockId;
    }
  } catch {}
  return false;
}

/**
 * Releases the cross-tab ephemeral storage lock for an account.
 * When lockId is supplied, verifies that the stored lock belongs to this holder,
 * ensuring an expired previous holder cannot delete a newer holder's lock.
 */
export function releaseReplayLock(owner: string, lockId?: string): boolean {
  const normOwner = normalizeQueueOwner(owner);
  const lockKey = `${REPLAY_LOCK_PREFIX}${normOwner}`;
  
  if (lockId) {
    const raw = safeGetLocalStorage(lockKey);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.lockId && parsed.lockId !== lockId) {
          // Stored lock belongs to a newer/different holder; do NOT delete
          return false;
        }
      } catch {}
    }
  }

  safeRemoveLocalStorage(lockKey);
  return true;
}

/**
 * Clears all active replay locks and in-flight promises (used during test teardown or hard reset).
 */
export function clearAllReplayLocks(): void {
  inFlightReplayPromises.clear();
  try {
    if (typeof localStorage !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(REPLAY_LOCK_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const k of keysToRemove) {
        safeRemoveLocalStorage(k);
      }
    }
  } catch {}
}

/**
 * Classifies replay HTTP status codes and mutation types into explicit outcome categories.
 */
export function classifyReplayResponse(
  status: number,
  mutationType: OfflineMutationType | string
): ReplayFailureClassification {
  if (status >= 200 && status < 300) {
    return 'SUCCESS';
  }
  if (status === 404) {
    return mutationType === 'DELETE_CYCLE' ? 'SUCCESS' : 'ENTITY_MISSING';
  }
  if (status === 401) {
    return 'AUTH_REQUIRED';
  }
  if (status === 403) {
    return 'FORBIDDEN';
  }
  if (status === 400 || status === 422) {
    return 'VALIDATION_ERROR';
  }
  if (status === 409) {
    return 'CONFLICT_DEFERRED';
  }
  if (status === 428) {
    return 'PRECONDITION_REQUIRED';
  }
  if (status === 429) {
    return 'RATE_LIMITED';
  }
  if (status === 408 || (status >= 500 && status <= 599)) {
    return 'SERVER_RETRYABLE';
  }
  return 'VALIDATION_ERROR';
}

/**
 * Generates an account-scoped storage key for quarantined queue items.
 * Guarantees sensitive payloads from different users are never intermingled.
 */
export function getScopedQuarantineKey(ownerId?: string | null): string {
  const norm = normalizeQueueOwner(ownerId);
  return norm === GUEST_QUEUE_OWNER
    ? `${OFFLINE_QUARANTINE_PREFIX}guest`
    : `${OFFLINE_QUARANTINE_PREFIX}user_${norm}`;
}

export interface EnqueueMutationInput {
  type: OfflineMutationType;
  payload: any;
  dedupKey?: string;
  expectedRevision?: number;
}

/**
 * Builds a deterministic deduplication and compaction key for a mutation.
 */
export function buildDedupKey(ownerId: string, mutation: EnqueueMutationInput): string {
  if (mutation.dedupKey) return mutation.dedupKey;

  switch (mutation.type) {
    case 'UPDATE_LOG': {
      const cycleId = mutation.payload?.cycleId || 'default';
      const date = mutation.payload?.date || 'unknown';
      return `log:${cycleId}:${date}`;
    }
    case 'UPDATE_CYCLE': {
      const id = mutation.payload?.id || 'unknown';
      return `cycle:update:${id}`;
    }
    case 'CREATE_CYCLE': {
      const id = mutation.payload?.id || 'unknown';
      return `cycle:create:${id}`;
    }
    case 'DELETE_CYCLE': {
      const id = typeof mutation.payload === 'string' ? mutation.payload : mutation.payload?.id || 'unknown';
      return `cycle:delete:${id}`;
    }
    case 'UPDATE_PROFILE': {
      return `profile:${ownerId}`;
    }
    case 'UPDATE_SETTINGS': {
      return `settings:${ownerId}`;
    }
    default: {
      return `${mutation.type}:${JSON.stringify(mutation.payload)}`;
    }
  }
}

/**
 * Loads the account-scoped offline queue for a specific owner.
 * Strictly verifies embedded item owner matches expected owner, quarantining any mismatched items.
 */
export function getOfflineQueue(ownerId?: string | null): OfflineQueueItem[] {
  const expectedOwner = normalizeQueueOwner(ownerId);
  const key = getScopedOfflineQueueKey(expectedOwner);
  const raw = safeGetLocalStorage(key);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.warn(`[Offline Queue] Corrupted non-array queue data for owner ${expectedOwner}`);
      return [];
    }

    const validItems: OfflineQueueItem[] = [];
    const mismatchedItems: OfflineQueueItem[] = [];

    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        typeof item.id === 'string' &&
        typeof item.type === 'string' &&
        item.payload !== undefined
      ) {
        const itemOwner = normalizeQueueOwner(item.ownerId);
        if (itemOwner === expectedOwner) {
          validItems.push({
            ...item,
            ownerId: expectedOwner,
            timestamp: typeof item.timestamp === 'number' ? item.timestamp : Date.now()
          });
        } else {
          mismatchedItems.push(item);
        }
      }
    }

    // Quarantine any embedded owner mismatches found inside this scoped key and clean partition
    if (mismatchedItems.length > 0) {
      quarantineQueueItems(mismatchedItems, `Embedded owner mismatch in ${key} (expected ${expectedOwner})`);
      saveOfflineQueue(expectedOwner, validItems);
    }

    return validItems;
  } catch (err) {
    console.warn(`[Offline Queue] Failed to parse offline queue JSON for owner ${expectedOwner}:`, err);
    return [];
  }
}

/**
 * Persists an account-scoped offline queue to storage.
 */
export function saveOfflineQueue(ownerId: string | null | undefined, queue: OfflineQueueItem[]): void {
  const normOwner = normalizeQueueOwner(ownerId);
  const key = getScopedOfflineQueueKey(normOwner);

  const cleanItems = queue.filter(item => {
    return (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      normalizeQueueOwner(item.ownerId) === normOwner
    );
  });

  if (cleanItems.length === 0) {
    safeRemoveLocalStorage(key);
  } else {
    safeSetLocalStorage(key, JSON.stringify(cleanItems));
  }
}

/**
 * Appends or compacts an offline mutation in the owner's scoped queue.
 */
export function enqueueOfflineMutation(
  ownerId: string | null | undefined, 
  mutation: EnqueueMutationInput
): OfflineQueueItem {
  const normOwner = normalizeQueueOwner(ownerId);
  const currentQueue = getOfflineQueue(normOwner);
  const dedupKey = buildDedupKey(normOwner, mutation);
  const expectedRev = mutation.expectedRevision ?? (typeof mutation.payload === 'object' ? (mutation.payload?.expectedRevision ?? mutation.payload?.revision) : undefined);

  const newItem: OfflineQueueItem = {
    id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    ownerId: normOwner,
    type: mutation.type,
    payload: mutation.payload,
    timestamp: Date.now(),
    retryCount: 0,
    dedupKey,
    ...(typeof expectedRev === 'number' && Number.isInteger(expectedRev) && expectedRev > 0 ? { expectedRevision: expectedRev } : {})
  };

  // Compaction & Dependency Ordering Rules:

  // Rule 1: UPDATE_LOG compaction (keep latest log payload for same cycle/date)
  if (mutation.type === 'UPDATE_LOG') {
    const existingIdx = currentQueue.findIndex(
      item => item.type === 'UPDATE_LOG' && item.dedupKey === dedupKey
    );
    if (existingIdx >= 0) {
      const mergedRev = expectedRev ?? currentQueue[existingIdx].expectedRevision;
      const updatedItem: OfflineQueueItem = {
        ...currentQueue[existingIdx],
        payload: mutation.payload,
        timestamp: Date.now(),
        retryCount: 0,
        ...(typeof mergedRev === 'number' && Number.isInteger(mergedRev) && mergedRev > 0 ? { expectedRevision: mergedRev } : {})
      };
      currentQueue[existingIdx] = updatedItem;
      saveOfflineQueue(normOwner, currentQueue);
      return updatedItem;
    }
  }

  // Rule 1b: CREATE_CYCLE compaction (prevent duplicate CREATE_CYCLE items for same cycle)
  if (mutation.type === 'CREATE_CYCLE') {
    const cycleId = mutation.payload?.id;
    const existingIdx = currentQueue.findIndex(
      item => item.type === 'CREATE_CYCLE' && (
        item.dedupKey === dedupKey ||
        (cycleId && item.payload?.id === cycleId)
      )
    );
    if (existingIdx >= 0) {
      const updatedItem: OfflineQueueItem = {
        ...currentQueue[existingIdx],
        payload: {
          ...currentQueue[existingIdx].payload,
          ...mutation.payload
        },
        timestamp: Date.now(),
        retryCount: 0
      };
      currentQueue[existingIdx] = updatedItem;
      saveOfflineQueue(normOwner, currentQueue);
      return updatedItem;
    }
  }

  // Rule 2: UPDATE_CYCLE (preserve dependency ordering after CREATE_CYCLE, compact repeated updates)
  if (mutation.type === 'UPDATE_CYCLE') {
    const existingUpdateIdx = currentQueue.findIndex(
      item => item.type === 'UPDATE_CYCLE' && item.dedupKey === dedupKey
    );
    if (existingUpdateIdx >= 0) {
      const mergedRev = expectedRev ?? currentQueue[existingUpdateIdx].expectedRevision;
      const updatedItem: OfflineQueueItem = {
        ...currentQueue[existingUpdateIdx],
        payload: mutation.payload,
        timestamp: Date.now(),
        retryCount: 0,
        ...(typeof mergedRev === 'number' && Number.isInteger(mergedRev) && mergedRev > 0 ? { expectedRevision: mergedRev } : {})
      };
      currentQueue[existingUpdateIdx] = updatedItem;
      saveOfflineQueue(normOwner, currentQueue);
      return updatedItem;
    }
  }

  // Rule 2b: If cycle is already pending deletion, drop subsequent updates to prevent revived ghost mutations
  if (mutation.type === 'UPDATE_CYCLE' || mutation.type === 'UPDATE_LOG') {
    const targetCycleId = mutation.type === 'UPDATE_CYCLE' 
      ? (typeof mutation.payload === 'string' ? mutation.payload : mutation.payload?.id)
      : mutation.payload?.cycleId;
    if (targetCycleId) {
      const hasPendingDelete = currentQueue.some(item =>
        item.type === 'DELETE_CYCLE' &&
        (typeof item.payload === 'string' ? item.payload : item.payload?.id) === targetCycleId
      );
      if (hasPendingDelete) {
        return newItem;
      }
    }
  }

  // Rule 3: CREATE_CYCLE followed by DELETE_CYCLE before sync
  if (mutation.type === 'DELETE_CYCLE') {
    const targetCycleId = typeof mutation.payload === 'string' ? mutation.payload : mutation.payload?.id;
    const pendingCreateIdx = currentQueue.findIndex(
      item => item.type === 'CREATE_CYCLE' && item.payload?.id === targetCycleId
    );

    if (pendingCreateIdx >= 0) {
      // The cycle was created offline and deleted offline before ever reaching the server.
      // Prune the pending CREATE_CYCLE and any pending UPDATE_CYCLE or UPDATE_LOG for this cycle.
      const prunedQueue = currentQueue.filter(item => {
        if (item.type === 'CREATE_CYCLE' && item.payload?.id === targetCycleId) return false;
        if (item.type === 'UPDATE_CYCLE' && item.payload?.id === targetCycleId) return false;
        if (item.type === 'UPDATE_LOG' && item.payload?.cycleId === targetCycleId) return false;
        return true;
      });
      saveOfflineQueue(normOwner, prunedQueue);
      return newItem;
    }

    // If deleting a cycle that may exist on server:
    // Prune any pending offline updates for this cycle, then enqueue DELETE_CYCLE
    const filteredQueue = currentQueue.filter(item => {
      if (item.type === 'UPDATE_CYCLE' && item.payload?.id === targetCycleId) return false;
      if (item.type === 'UPDATE_LOG' && item.payload?.cycleId === targetCycleId) return false;
      if (item.type === 'DELETE_CYCLE' && (
        item.dedupKey === dedupKey ||
        (typeof item.payload === 'string' ? item.payload : item.payload?.id) === targetCycleId
      )) return false;
      return true;
    });
    filteredQueue.push(newItem);
    saveOfflineQueue(normOwner, filteredQueue);
    return newItem;
  }

  // Rule 4: UPDATE_PROFILE / UPDATE_SETTINGS compaction
  if (mutation.type === 'UPDATE_PROFILE' || mutation.type === 'UPDATE_SETTINGS') {
    const existingIdx = currentQueue.findIndex(
      item => item.type === mutation.type && item.dedupKey === dedupKey
    );
    if (existingIdx >= 0) {
      const updatedItem: OfflineQueueItem = {
        ...currentQueue[existingIdx],
        payload: mutation.payload,
        timestamp: Date.now(),
        retryCount: 0
      };
      currentQueue[existingIdx] = updatedItem;
      saveOfflineQueue(normOwner, currentQueue);
      return updatedItem;
    }
  }

  // Default: Append new item
  currentQueue.push(newItem);
  saveOfflineQueue(normOwner, currentQueue);
  return newItem;
}

/**
 * Removes successfully replayed items from a specific owner's offline queue.
 */
export function removeReplayedQueueItems(
  ownerId: string | null | undefined, 
  itemIds: string[]
): void {
  if (!itemIds || itemIds.length === 0) return;
  const normOwner = normalizeQueueOwner(ownerId);
  const currentQueue = getOfflineQueue(normOwner);
  const idSet = new Set(itemIds);
  const remainingQueue = currentQueue.filter(item => !idSet.has(item.id));
  saveOfflineQueue(normOwner, remainingQueue);
}

/**
 * Redacts sensitive credentials (tokens, passwords, OTPs, auth headers) from error messages
 * and limits string length to prevent storage exhaustion in audit ledgers.
 */
export function sanitizeErrorMessage(msg: string): string {
  if (!msg || typeof msg !== 'string') return '';
  const clamped = msg.slice(0, 500);
  return clamped
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]')
    .replace(/(token|password|authtoken|secret|otp|authorization)\s*[:=]\s*([^\s&,;]+)/gi, '$1=[REDACTED]')
    .replace(/"(token|password|authtoken|secret|otp|authorization)":\s*"[^"]+"/gi, '"$1":"[REDACTED]"');
}

/**
 * Records retry count increment, last error, classification, and optional exponential backoff on a failed queue item.
 */
export function recordQueueItemFailure(
  ownerId: string | null | undefined,
  itemId: string,
  errorMsg: string,
  backoffMs = 0,
  classification?: ReplayFailureClassification
): void {
  const normOwner = normalizeQueueOwner(ownerId);
  const currentQueue = getOfflineQueue(normOwner);
  const idx = currentQueue.findIndex(item => item.id === itemId);
  if (idx >= 0) {
    const nextRetryCount = (currentQueue[idx].retryCount || 0) + 1;
    currentQueue[idx] = {
      ...currentQueue[idx],
      retryCount: nextRetryCount,
      lastError: sanitizeErrorMessage(errorMsg),
      classification: classification || currentQueue[idx].classification,
      nextRetryAt: backoffMs > 0 ? Date.now() + backoffMs : undefined
    };
    saveOfflineQueue(normOwner, currentQueue);
  }
}

/**
 * Clears only a specific owner's offline queue partition.
 */
export function clearOfflineQueue(ownerId?: string | null): void {
  const key = getScopedOfflineQueueKey(ownerId);
  safeRemoveLocalStorage(key);
}

const SENSITIVE_KEYS = new Set([
  'token', 'authtoken', 'password', 'otp', 'code', 'authorization',
  'cookie', 'secret', 'hash', 'bearer', 'refreshtoken', 'accesstoken', 'authheader'
]);

/**
 * Redacts sensitive credentials (tokens, passwords, OTPs, auth headers) from payloads
 * before storing them in quarantine records. Never returns unexamined original structures past recursion limits.
 */
export function sanitizePayloadCredentials(val: any, depth = 0, seen = new WeakSet()): any {
  if (val === null || val === undefined) return val;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
  if (depth > MAX_SANITIZATION_DEPTH) {
    return Array.isArray(val) ? ['[TRUNCATED_ARRAY]'] : { _truncated: true };
  }
  if (typeof val === 'object') {
    if (seen.has(val)) {
      return '[CIRCULAR]';
    }
    seen.add(val);
    if (Array.isArray(val)) {
      return val.map(item => sanitizePayloadCredentials(item, depth + 1, seen));
    }
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      const lower = k.toLowerCase().replace(/[-_]/g, '');
      if (
        SENSITIVE_KEYS.has(lower) || 
        lower.includes('token') || 
        lower.includes('password') || 
        lower.includes('secret') ||
        lower.includes('authheader') ||
        lower.includes('otp')
      ) {
        cleaned[k] = '[REDACTED]';
      } else {
        cleaned[k] = sanitizePayloadCredentials(v, depth + 1, seen);
      }
    }
    return cleaned;
  }
  return val;
}

export const sanitizePayloadForQuarantine = sanitizePayloadCredentials;

export interface QuarantineAuditItem {
  id: string | null;
  ownerId: string;
  type: string;
  timestamp: number;
  dedupKey?: string;
  retryCount: number;
  lastError?: string;
  classification?: ReplayFailureClassification;
  hasPayload: boolean;
}

/**
 * Creates safe metadata for the global quarantine audit ledger without duplicating
 * complete private mutation payloads across multiple user accounts.
 */
export function toSafeQuarantineAuditItem(item: any): QuarantineAuditItem {
  return {
    id: typeof item?.id === 'string' ? item.id : null,
    ownerId: normalizeQueueOwner(item?.ownerId),
    type: typeof item?.type === 'string' ? item.type : 'UNKNOWN',
    timestamp: typeof item?.timestamp === 'number' ? item.timestamp : Date.now(),
    dedupKey: typeof item?.dedupKey === 'string' ? item.dedupKey : undefined,
    retryCount: typeof item?.retryCount === 'number' ? item.retryCount : 0,
    lastError: typeof item?.lastError === 'string' ? sanitizeErrorMessage(item.lastError) : undefined,
    classification: typeof item?.classification === 'string' ? item.classification : undefined,
    hasPayload: item?.payload !== undefined
  };
}

/**
 * Quarantines items to prevent data loss while keeping active partitions clean and isolated.
 * - Sensitive mutation payloads are sanitized and stored in the target owner's partition key.
 * - Ambiguous or unverifiable items are routed to the ambiguous legacy quarantine partition.
 * - The global compatibility ledger contains ONLY safe metadata without duplicating private payloads.
 */
export function quarantineQueueItems(items: any[], reason: string, defaultOwnerId?: string | null): void {
  if (!items || items.length === 0) return;
  try {
    // 1. Sanitize items to strip sensitive credentials (tokens, passwords, OTPs, auth headers)
    const sanitizedItems = items.map(item => {
      if (item && typeof item === 'object') {
        return {
          ...item,
          payload: item.payload !== undefined ? sanitizePayloadCredentials(item.payload) : undefined
        };
      }
      return item;
    });

    const ownerGroups: Record<string, any[]> = {};
    const ambiguousItems: any[] = [];

    for (const item of sanitizedItems) {
      const explicitOwner = defaultOwnerId !== undefined ? defaultOwnerId : item?.ownerId;
      const normalized = normalizeUserId(explicitOwner);
      if (normalized) {
        if (!ownerGroups[normalized]) ownerGroups[normalized] = [];
        ownerGroups[normalized].push(item);
      } else if (explicitOwner === GUEST_QUEUE_OWNER) {
        if (!ownerGroups[GUEST_QUEUE_OWNER]) ownerGroups[GUEST_QUEUE_OWNER] = [];
        ownerGroups[GUEST_QUEUE_OWNER].push(item);
      } else {
        ambiguousItems.push(item);
      }
    }

    // Write owner-scoped quarantines (preserves the account's own payload in its own isolated partition)
    for (const [owner, groupItems] of Object.entries(ownerGroups)) {
      const key = getScopedQuarantineKey(owner);
      const raw = safeGetLocalStorage(key);
      const existing = raw ? JSON.parse(raw) : [];
      existing.push({
        quarantinedAt: new Date().toISOString(),
        ownerId: owner,
        reason,
        items: groupItems
      });
      safeSetLocalStorage(key, JSON.stringify(existing));
    }

    // Write ambiguous quarantine for items without verified owner
    if (ambiguousItems.length > 0) {
      const raw = safeGetLocalStorage(LEGACY_AMBIGUOUS_QUARANTINE_KEY);
      const existing = raw ? JSON.parse(raw) : [];
      existing.push({
        quarantinedAt: new Date().toISOString(),
        reason,
        items: ambiguousItems
      });
      safeSetLocalStorage(LEGACY_AMBIGUOUS_QUARANTINE_KEY, JSON.stringify(existing));
    }

    // Write global quarantine ledger for auditing and backwards compatibility:
    // IMPORTANT: Storing safe audit metadata ONLY. Complete private mutation payloads from
    // different users are NEVER copied or aggregated into this shared global ledger.
    const globalRaw = safeGetLocalStorage(OFFLINE_QUARANTINE_KEY);
    const globalExisting = globalRaw ? JSON.parse(globalRaw) : [];
    globalExisting.push({
      quarantinedAt: new Date().toISOString(),
      ownerId: defaultOwnerId ? normalizeQueueOwner(defaultOwnerId) : (items[0]?.ownerId ? normalizeQueueOwner(items[0]?.ownerId) : null),
      reason,
      itemCount: items.length,
      items: items.map(toSafeQuarantineAuditItem)
    });
    safeSetLocalStorage(OFFLINE_QUARANTINE_KEY, JSON.stringify(globalExisting));
  } catch (err) {
    console.warn('[Offline Queue] Failed to write quarantine:', err);
  }
}

/**
 * Preserves unparseable or corrupted raw string data in quarantine before clearing storage keys.
 * Full raw string is sanitized to strip tokens/passwords and preserved ONLY in ambiguous quarantine partition;
 * global audit ledger records safe metadata (length, timestamp, parse error) without storing arbitrary raw strings.
 */
export function quarantineCorruptedRawData(raw: string, reason: string, error?: any): void {
  try {
    const sanitizedRaw = typeof raw === 'string' ? sanitizeErrorMessage(raw) : raw;
    const entry = {
      quarantinedAt: new Date().toISOString(),
      reason,
      rawCorruptedData: sanitizedRaw,
      parseError: error ? String(error) : undefined
    };

    const existingAmbiguousRaw = safeGetLocalStorage(LEGACY_AMBIGUOUS_QUARANTINE_KEY);
    const existingAmbiguous = existingAmbiguousRaw ? JSON.parse(existingAmbiguousRaw) : [];
    existingAmbiguous.push(entry);
    safeSetLocalStorage(LEGACY_AMBIGUOUS_QUARANTINE_KEY, JSON.stringify(existingAmbiguous));

    // In global compatibility ledger, preserve only safe metadata (length, timestamp, reason, parseError)
    const globalEntry = {
      quarantinedAt: new Date().toISOString(),
      reason,
      rawLength: typeof raw === 'string' ? raw.length : 0,
      parseError: error ? String(error) : undefined
    };
    const existingGlobalRaw = safeGetLocalStorage(OFFLINE_QUARANTINE_KEY);
    const existingGlobal = existingGlobalRaw ? JSON.parse(existingGlobalRaw) : [];
    existingGlobal.push(globalEntry);
    safeSetLocalStorage(OFFLINE_QUARANTINE_KEY, JSON.stringify(existingGlobal));
  } catch (err) {
    console.warn('[Offline Queue] Failed to quarantine corrupted raw data:', err);
  }
}

/**
 * Returns quarantined items for a specific owner, or ambiguous legacy items if no owner specified.
 */
export function getQuarantinedItems(ownerId?: string | null): any[] {
  try {
    if (ownerId !== undefined && ownerId !== null) {
      const key = getScopedQuarantineKey(ownerId);
      const raw = safeGetLocalStorage(key);
      return raw ? JSON.parse(raw) : [];
    }
    const raw = safeGetLocalStorage(OFFLINE_QUARANTINE_KEY) || safeGetLocalStorage(LEGACY_AMBIGUOUS_QUARANTINE_KEY) || safeGetLocalStorage(LEGACY_OFFLINE_QUARANTINE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clears the quarantine storage partition for a specific owner, or legacy ambiguous quarantine.
 */
export function clearQuarantine(ownerId?: string | null): void {
  if (ownerId !== undefined && ownerId !== null) {
    safeRemoveLocalStorage(getScopedQuarantineKey(ownerId));
  } else {
    safeRemoveLocalStorage(LEGACY_AMBIGUOUS_QUARANTINE_KEY);
    safeRemoveLocalStorage(LEGACY_OFFLINE_QUARANTINE_KEY);
    safeRemoveLocalStorage(OFFLINE_QUARANTINE_KEY);
  }
}

/**
 * Migrates legacy global offline queue ('bushido_offline_queue') into account-scoped queues.
 * - Items with verifiable ownerId are safely routed to that owner's partition.
 * - Items with no ownerId or ambiguous structure are quarantined in LEGACY_AMBIGUOUS_QUARANTINE_KEY.
 * - Corrupted raw data is preserved in quarantine BEFORE removing the legacy key.
 * - Quarantined items are NEVER automatically replayed.
 */
export function migrateLegacyGlobalQueue(): { migratedCount: number; quarantinedCount: number } {
  const raw = safeGetLocalStorage(LEGACY_OFFLINE_QUEUE_KEY);
  if (!raw) return { migratedCount: 0, quarantinedCount: 0 };

  let migratedCount = 0;
  let quarantinedCount = 0;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      safeRemoveLocalStorage(LEGACY_OFFLINE_QUEUE_KEY);
      return { migratedCount: 0, quarantinedCount: 0 };
    }

    const unassignedItems: any[] = [];

    for (const item of parsed) {
      if (
        item &&
        typeof item === 'object' &&
        item.type &&
        item.payload &&
        item.ownerId &&
        typeof item.ownerId === 'string' &&
        normalizeUserId(item.ownerId)
      ) {
        const owner = normalizeQueueOwner(item.ownerId);
        const existingQueue = getOfflineQueue(owner);
        const itemDedupKey = item.dedupKey || buildDedupKey(owner, { type: item.type, payload: item.payload, dedupKey: item.dedupKey });
        if (existingQueue.some(q => (item.id && q.id === item.id) || (q.dedupKey && q.dedupKey === itemDedupKey))) {
          // Item with same ID or dedupKey already exists in owner queue, skip duplicate migration
          continue;
        }
        enqueueOfflineMutation(owner, {
          type: item.type,
          payload: item.payload,
          dedupKey: itemDedupKey
        });
        migratedCount++;
      } else {
        unassignedItems.push(item);
        quarantinedCount++;
      }
    }

    if (unassignedItems.length > 0) {
      quarantineQueueItems(unassignedItems, 'Ambiguous legacy global offline queue items without verified ownerId');
    }

    safeRemoveLocalStorage(LEGACY_OFFLINE_QUEUE_KEY);
  } catch (err) {
    console.warn('[Offline Queue] Failed during legacy migration, preserving raw data in quarantine:', err);
    quarantineCorruptedRawData(raw, 'Corrupted legacy raw data encountered during migration', err);
    safeRemoveLocalStorage(LEGACY_OFFLINE_QUEUE_KEY);
  }

  return { migratedCount, quarantinedCount };
}

export interface ReplayLockTimingConfig {
  leaseTimeoutMs?: number;
  heartbeatIntervalMs?: number;
}

export interface ReplayOptions {
  activeAccountId: string | null;
  authToken: string | null;
  fetchImpl?: typeof fetch;
  fetchFn?: typeof fetch;
  force?: boolean;
  respectBackoff?: boolean;
  heartbeatIntervalMs?: number;
  leaseTimeoutMs?: number;
  lockTiming?: ReplayLockTimingConfig;
  timing?: ReplayTimingDependencies;
  onItemSuccess?: (item: OfflineQueueItem) => void;
  onItemFailure?: (item: OfflineQueueItem, error: any) => void;
  getCurrentActiveAccountId?: () => string | null;
}

export interface ReplayResult {
  syncedCount: number;
  failedCount: number;
  stoppedDueToAuth: boolean;
  stoppedDueToAccountChange: boolean;
  stoppedDueToLockLoss?: boolean;
  remainingQueueCount: number;
}

/**
 * Replays queued offline mutations safely for the verified active account.
 * Guarantees:
 * 1. Guest state never replays mutations to the server.
 * 2. Authenticated user mutations are only replayed with a valid auth token.
 * 3. Never replays User A mutations while User B, Guest, Admin, or an impersonated user is active.
 * 4. Intra-tab mutex & cross-tab lock lease prevent duplicate concurrent replays.
 * 5. Verifies active account hasn't changed before and after each network request.
 * 6. 401 stops replay immediately while preserving items in the owner's queue.
 * 7. 403 stops replay and safely quarantines the item with FORBIDDEN classification.
 * 8. Only confirmed successful items (or quarantined non-retryable poison pills) are removed from the active queue.
 * 9. Re-verifies fresh item existence and compacted payloads before each network invocation.
 * 10. Retryable errors (network, 5xx, 408, 429) are preserved indefinitely with exponential backoff and never quarantined.
 * 11. Lease ownership is verified before and after each network request; lost leases halt replay safely without stale commits.
 * 12. Unknown mutations perform NO network requests and are quarantined immediately.
 */
export async function replayAccountOfflineQueue(options: ReplayOptions): Promise<ReplayResult> {
  const initialOwner = normalizeQueueOwner(options.activeAccountId);

  // 1. Guest Isolation: Guest mutations are strictly local and cannot be replayed to server
  if (isGuestQueueOwner(initialOwner)) {
    return {
      syncedCount: 0,
      failedCount: 0,
      stoppedDueToAuth: false,
      stoppedDueToAccountChange: false,
      remainingQueueCount: getOfflineQueue(GUEST_QUEUE_OWNER).length
    };
  }

  // 2. Authentication Enforcement: Authenticated queue requires valid, non-empty auth token
  if (!options.authToken || typeof options.authToken !== 'string' || options.authToken.trim().length === 0) {
    return {
      syncedCount: 0,
      failedCount: 0,
      stoppedDueToAuth: true,
      stoppedDueToAccountChange: false,
      remainingQueueCount: getOfflineQueue(initialOwner).length
    };
  }

  // 3. Concurrency Protection (Intra-tab): Await any active replay for this owner
  const inFlight = inFlightReplayPromises.get(initialOwner);
  if (inFlight) {
    return inFlight.then(() => {
      if (options.getCurrentActiveAccountId) {
        const currentAcc = normalizeQueueOwner(options.getCurrentActiveAccountId());
        if (currentAcc !== initialOwner) {
          return {
            syncedCount: 0,
            failedCount: 0,
            stoppedDueToAuth: false,
            stoppedDueToAccountChange: true,
            remainingQueueCount: getOfflineQueue(initialOwner).length
          };
        }
      }
      const remainingQueue = getOfflineQueue(initialOwner);
      if (remainingQueue.length === 0) {
        return {
          syncedCount: 0,
          failedCount: 0,
          stoppedDueToAuth: false,
          stoppedDueToAccountChange: false,
          remainingQueueCount: 0
        };
      }
      return replayAccountOfflineQueue(options);
    });
  }

  const timing = resolveReplayTiming({
    leaseTimeoutMs: options.leaseTimeoutMs,
    heartbeatIntervalMs: options.heartbeatIntervalMs,
    lockTiming: options.lockTiming,
    timing: options.timing
  });

  // 4. Concurrency Protection (Inter-tab): Acquire cross-tab storage lease
  const lockId = acquireReplayLock(initialOwner, timing.leaseTimeoutMs, timing.now);
  if (!lockId) {
    return {
      syncedCount: 0,
      failedCount: 0,
      stoppedDueToAuth: false,
      stoppedDueToAccountChange: false,
      remainingQueueCount: getOfflineQueue(initialOwner).length
    };
  }

  const effectiveOptions: ReplayOptions = {
    ...options,
    respectBackoff: options.respectBackoff !== undefined ? options.respectBackoff : true
  };

  const runReplay = async (): Promise<ReplayResult> => {
    try {
      return await executeReplayLoop(
        effectiveOptions,
        initialOwner,
        lockId,
        timing
      );
    } finally {
      releaseReplayLock(initialOwner, lockId);
      inFlightReplayPromises.delete(initialOwner);
    }
  };

  const replayPromise = runReplay();
  inFlightReplayPromises.set(initialOwner, replayPromise);
  return replayPromise;
}

async function executeReplayLoop(
  options: ReplayOptions, 
  initialOwner: string,
  lockId?: string | null,
  timingOrLeaseTimeout?: ResolvedReplayTiming | number,
  heartbeatIntervalMs?: number
): Promise<ReplayResult> {
  const timing: ResolvedReplayTiming = typeof timingOrLeaseTimeout === 'object' && timingOrLeaseTimeout !== null && 'now' in timingOrLeaseTimeout
    ? timingOrLeaseTimeout
    : resolveReplayTiming({
        leaseTimeoutMs: typeof timingOrLeaseTimeout === 'number' ? timingOrLeaseTimeout : options.leaseTimeoutMs,
        heartbeatIntervalMs: heartbeatIntervalMs ?? options.heartbeatIntervalMs,
        lockTiming: options.lockTiming,
        timing: options.timing
      });

  const fetchFn = options.fetchImpl || options.fetchFn || (typeof fetch !== 'undefined' ? fetch : undefined);
  if (!fetchFn) {
    return {
      syncedCount: 0,
      failedCount: 0,
      stoppedDueToAuth: false,
      stoppedDueToAccountChange: false,
      remainingQueueCount: getOfflineQueue(initialOwner).length
    };
  }

  const initialQueue = getOfflineQueue(initialOwner);
  let syncedCount = 0;
  let failedCount = 0;

  for (const queueItem of initialQueue) {
    // 1. Freshness check: Verify that the item has not been removed, compacted, or already synced
    const currentQueue = getOfflineQueue(initialOwner);
    const item = currentQueue.find(q => q.id === queueItem.id);
    if (!item) {
      // Item was already synced, compacted, or pruned
      continue;
    }

    // 1b. Deferral check: If respectBackoff is enabled and item is in exponential backoff window, defer safely
    if (options.respectBackoff && item.nextRetryAt && timing.now() < item.nextRetryAt && !options.force) {
      break;
    }

    // 2. Pre-flight Account Switch Check
    if (options.getCurrentActiveAccountId) {
      const currentAcc = normalizeQueueOwner(options.getCurrentActiveAccountId());
      if (currentAcc !== initialOwner) {
        return {
          syncedCount,
          failedCount,
          stoppedDueToAuth: false,
          stoppedDueToAccountChange: true,
          remainingQueueCount: getOfflineQueue(initialOwner).length
        };
      }
    }

    // 3. Embedded Ownership Verification
    if (normalizeQueueOwner(item.ownerId) !== initialOwner) {
      console.warn(`[Offline Replay] Embedded owner mismatch: item owner ${item.ownerId} != replay owner ${initialOwner}`);
      quarantineQueueItems([item], `Embedded owner mismatch during replay: item owner ${item.ownerId} != replay owner ${initialOwner}`, initialOwner);
      removeReplayedQueueItems(initialOwner, [item.id]);
      continue;
    }

    // 4. Pre-request Lease Ownership & Heartbeat Renewal Check
    if (lockId && !renewReplayLock(initialOwner, lockId, timing.leaseTimeoutMs, timing.now)) {
      return {
        syncedCount,
        failedCount,
        stoppedDueToAuth: false,
        stoppedDueToAccountChange: false,
        stoppedDueToLockLoss: true,
        remainingQueueCount: getOfflineQueue(initialOwner).length
      };
    }

    try {
      let endpoint = '';
      let method = 'POST';
      let body: any = item.payload;

      switch (item.type) {
        case 'UPDATE_LOG': {
          endpoint = '/api/logs';
          method = 'POST';
          const expectedRev = item.expectedRevision ?? item.payload?.expectedRevision ?? item.payload?.revision;
          body = {
            ...item.payload,
            clientOperationId: item.id,
            ...(typeof expectedRev === 'number' && Number.isInteger(expectedRev) && expectedRev > 0 ? { expectedRevision: expectedRev } : {})
          };
          break;
        }
        case 'UPDATE_CYCLE': {
          const cycleId = item.payload?.id;
          if (!cycleId) {
            quarantineQueueItems([item], 'Missing cycle id in UPDATE_CYCLE payload', initialOwner);
            removeReplayedQueueItems(initialOwner, [item.id]);
            failedCount++;
            continue;
          }
          endpoint = `/api/cycles/${cycleId}`;
          method = 'PUT';
          const expectedRev = item.expectedRevision ?? item.payload?.expectedRevision ?? item.payload?.revision;
          body = {
            ...item.payload,
            clientOperationId: item.id,
            ...(typeof expectedRev === 'number' && Number.isInteger(expectedRev) && expectedRev > 0 ? { expectedRevision: expectedRev } : {})
          };
          break;
        }
        case 'CREATE_CYCLE': {
          endpoint = '/api/cycles';
          method = 'POST';
          // At-Least-Once replay contract with deterministic idempotency:
          // Stable operation ID (item.id) and cycle ID survive across all retries.
          const cycleId = item.payload?.id || item.id;
          body = {
            ...item.payload,
            id: cycleId,
            clientOperationId: item.id
          };
          break;
        }
        case 'DELETE_CYCLE': {
          const cycleId = typeof item.payload === 'string' ? item.payload : item.payload?.id;
          if (!cycleId) {
            quarantineQueueItems([item], 'Missing cycle id in DELETE_CYCLE payload', initialOwner);
            removeReplayedQueueItems(initialOwner, [item.id]);
            failedCount++;
            continue;
          }
          const expectedRev = item.expectedRevision ?? (typeof item.payload === 'object' ? (item.payload?.expectedRevision ?? item.payload?.revision) : undefined);
          endpoint = `/api/cycles/${cycleId}${typeof expectedRev === 'number' && Number.isInteger(expectedRev) && expectedRev > 0 ? `?expectedRevision=${expectedRev}` : ''}`;
          method = 'DELETE';
          body = undefined;
          break;
        }
        case 'UPDATE_PROFILE': {
          endpoint = '/api/user/profile';
          method = 'PUT';
          body = {
            ...item.payload,
            clientOperationId: item.id
          };
          break;
        }
        case 'UPDATE_SETTINGS': {
          // SystemSettings are declared local-only client preferences (records/central engine).
          // Profile settings (nightOwlCutoffHour, accentTheme) are synced via UPDATE_PROFILE.
          // Safely resolve and remove from queue without calling the server.
          removeReplayedQueueItems(initialOwner, [item.id]);
          syncedCount++;
          continue;
        }
        default: {
          // Section C: Unknown Mutation Safety
          // Unknown mutations MUST NEVER call arbitrary endpoints and MUST NOT loop forever in active queue.
          quarantineQueueItems([{ ...item, classification: 'UNKNOWN_MUTATION' }], `UNKNOWN_MUTATION: Unknown mutation type: ${(item as any).type}`, initialOwner);
          removeReplayedQueueItems(initialOwner, [item.id]);
          failedCount++;
          options.onItemFailure?.(item, new Error(`Unknown mutation type: ${(item as any).type}`));
          continue;
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.authToken}`
      };

      let res: any;
      let networkErrorOccurred = false;
      let caughtNetworkErr: any = null;
      let leaseLostDuringFlight = false;
      let heartbeatTimer: any = null;

      if (lockId) {
        heartbeatTimer = timing.setInterval(() => {
          const renewed = renewReplayLock(initialOwner, lockId, timing.leaseTimeoutMs, timing.now);
          if (!renewed) {
            leaseLostDuringFlight = true;
            if (heartbeatTimer !== null) {
              timing.clearInterval(heartbeatTimer);
              heartbeatTimer = null;
            }
          }
        }, timing.heartbeatIntervalMs);
      }

      try {
        res = await fetchFn(endpoint, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      } catch (networkErr: any) {
        networkErrorOccurred = true;
        caughtNetworkErr = networkErr;
      } finally {
        if (heartbeatTimer !== null) {
          timing.clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      }

      // In-flight Lease Ownership Verification:
      // If heartbeat failed during network execution or lease was lost/expired, abort safely
      if (lockId && (leaseLostDuringFlight || !verifyReplayLock(initialOwner, lockId, timing.leaseTimeoutMs, timing.now))) {
        return {
          syncedCount,
          failedCount,
          stoppedDueToAuth: false,
          stoppedDueToAccountChange: false,
          stoppedDueToLockLoss: true,
          remainingQueueCount: getOfflineQueue(initialOwner).length
        };
      }

      if (networkErrorOccurred) {
        failedCount++;
        const errMsg = caughtNetworkErr?.message || String(caughtNetworkErr);
        const nextRetryCount = (item.retryCount || 0) + 1;
        const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.min(nextRetryCount, 5)));
        recordQueueItemFailure(initialOwner, item.id, errMsg, backoffMs, 'NETWORK_ERROR');
        options.onItemFailure?.(item, caughtNetworkErr);
        // Fail-fast on network error: stop replay run to preserve downstream retry budgets and avoid tight loops
        break;
      }

      // Explicit Replay Failure Classification Contract
      const classification = classifyReplayResponse(res.status, item.type);

      // Branch 1: SUCCESS (2xx or DELETE_CYCLE 404)
      if (classification === 'SUCCESS') {
        // Post-fetch Account Switch Verification before committing success
        if (options.getCurrentActiveAccountId) {
          const currentAcc = normalizeQueueOwner(options.getCurrentActiveAccountId());
          if (currentAcc !== initialOwner) {
            return {
              syncedCount,
              failedCount,
              stoppedDueToAuth: false,
              stoppedDueToAccountChange: true,
              remainingQueueCount: getOfflineQueue(initialOwner).length
            };
          }
        }

        // Post-fetch Lease Ownership Verification:
        // Ensure this tab still holds the active lease before removing from queue and committing success
        if (lockId && !verifyReplayLock(initialOwner, lockId, timing.leaseTimeoutMs, timing.now)) {
          return {
            syncedCount,
            failedCount,
            stoppedDueToAuth: false,
            stoppedDueToAccountChange: false,
            stoppedDueToLockLoss: true,
            remainingQueueCount: getOfflineQueue(initialOwner).length
          };
        }

        removeReplayedQueueItems(initialOwner, [item.id]);
        options.onItemSuccess?.(item);
        syncedCount++;
        continue;
      }

      // Branch 2: AUTH_REQUIRED (401) -> Stops replay immediately, preserves unresolved item in queue
      if (classification === 'AUTH_REQUIRED') {
        failedCount++;
        recordQueueItemFailure(initialOwner, item.id, 'HTTP 401 Unauthorized', 0, 'AUTH_REQUIRED');
        return {
          syncedCount,
          failedCount,
          stoppedDueToAuth: true,
          stoppedDueToAccountChange: false,
          remainingQueueCount: getOfflineQueue(initialOwner).length
        };
      }

      // Branch 3: FORBIDDEN (403) -> Stops replay, marks item as action-required/quarantine
      if (classification === 'FORBIDDEN') {
        quarantineQueueItems([{ ...item, classification: 'FORBIDDEN' }], 'HTTP 403 Forbidden - permission denied', initialOwner);
        removeReplayedQueueItems(initialOwner, [item.id]);
        failedCount++;
        options.onItemFailure?.(item, new Error('HTTP 403 Forbidden'));
        return {
          syncedCount,
          failedCount,
          stoppedDueToAuth: true,
          stoppedDueToAccountChange: false,
          remainingQueueCount: getOfflineQueue(initialOwner).length
        };
      }

      // Branch 4: CONFLICT_DEFERRED (409) -> Exclude from later automatic replay, quarantine for resolution
      if (classification === 'CONFLICT_DEFERRED') {
        let conflictDetails: any = null;
        try {
          if (typeof res?.clone === 'function') {
            conflictDetails = await res.clone().json();
          } else if (typeof res?.json === 'function') {
            conflictDetails = await res.json();
          }
        } catch {}

        const quarantinedItem: OfflineQueueItem = {
          ...item,
          classification: 'CONFLICT_DEFERRED',
          lastError: conflictDetails?.messageFa || 'این آیتم در دستگاه دیگری به‌روزرسانی شده و دارای تعارض همزمانی است.'
        };

        quarantineQueueItems([quarantinedItem], 'HTTP 409 Conflict - mutation deferred for manual/reconciliation resolution', initialOwner);
        removeReplayedQueueItems(initialOwner, [item.id]);
        failedCount++;
        options.onItemFailure?.(quarantinedItem, new Error('HTTP 409 Conflict'));
        continue;
      }

      // Branch 4b: PRECONDITION_REQUIRED (428) -> Missing/invalid expectedRevision quarantined immediately
      if (classification === 'PRECONDITION_REQUIRED') {
        let preconditionDetails: any = null;
        try {
          if (typeof res?.clone === 'function') {
            preconditionDetails = await res.clone().json();
          } else if (typeof res?.json === 'function') {
            preconditionDetails = await res.json();
          }
        } catch {}

        const quarantinedItem: OfflineQueueItem = {
          ...item,
          classification: 'PRECONDITION_REQUIRED',
          lastError: preconditionDetails?.messageFa || 'عملیات به دلیل عدم ارسال نسخه مورد انتظار (HTTP 428) متوقف شد.'
        };

        quarantineQueueItems([quarantinedItem], 'HTTP 428 Precondition Required - missing or invalid expectedRevision', initialOwner);
        removeReplayedQueueItems(initialOwner, [item.id]);
        failedCount++;
        options.onItemFailure?.(quarantinedItem, new Error('HTTP 428 Precondition Required'));
        continue;
      }

      // Branch 5: VALIDATION_ERROR (400, 422) -> Non-retryable validation failures quarantined immediately
      if (classification === 'VALIDATION_ERROR') {
        quarantineQueueItems([{ ...item, classification: 'VALIDATION_ERROR' }], `HTTP ${res.status} Validation Error`, initialOwner);
        removeReplayedQueueItems(initialOwner, [item.id]);
        failedCount++;
        options.onItemFailure?.(item, new Error(`HTTP ${res.status} Validation Error`));
        continue;
      }

      // Branch 6: ENTITY_MISSING (non-delete 404) -> Target missing, non-retryable
      if (classification === 'ENTITY_MISSING') {
        quarantineQueueItems([{ ...item, classification: 'ENTITY_MISSING' }], `HTTP 404 Entity Missing for ${item.type}`, initialOwner);
        removeReplayedQueueItems(initialOwner, [item.id]);
        failedCount++;
        options.onItemFailure?.(item, new Error(`HTTP 404 Entity Missing`));
        continue;
      }

      // Branch 7: RATE_LIMITED (429) & SERVER_RETRYABLE (408, 5xx) -> Preserved with exponential backoff
      if (classification === 'RATE_LIMITED' || classification === 'SERVER_RETRYABLE') {
        failedCount++;
        const errMsg = `Server returned HTTP ${res.status} (${classification})`;
        const nextRetryCount = (item.retryCount || 0) + 1;
        const backoffMs = calculateReplayBackoffMs(nextRetryCount);
        recordQueueItemFailure(initialOwner, item.id, errMsg, backoffMs, classification);
        options.onItemFailure?.(item, new Error(errMsg));
        // Stop current replay run on server/gateway failure to prevent hammering
        break;
      }

      // Fallback: Permanent unknown error
      failedCount++;
      const errMsg = `Server returned unhandled HTTP ${res.status}`;
      quarantineQueueItems([item], errMsg, initialOwner);
      removeReplayedQueueItems(initialOwner, [item.id]);
      options.onItemFailure?.(item, new Error(errMsg));
    } catch (generalErr: any) {
      failedCount++;
      const errMsg = generalErr?.message || String(generalErr);
      const nextRetryCount = (item.retryCount || 0) + 1;
      const backoffMs = calculateReplayBackoffMs(nextRetryCount);
      recordQueueItemFailure(initialOwner, item.id, errMsg, backoffMs, 'NETWORK_ERROR');
      options.onItemFailure?.(item, generalErr);
      break;
    }
  }

  return {
    syncedCount,
    failedCount,
    stoppedDueToAuth: false,
    stoppedDueToAccountChange: false,
    remainingQueueCount: getOfflineQueue(initialOwner).length
  };
}
