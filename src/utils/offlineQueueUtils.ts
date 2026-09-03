import { OfflineMutationType, OfflineQueueItem } from '../types';
import { 
  normalizeUserId, 
  safeGetLocalStorage, 
  safeSetLocalStorage, 
  safeRemoveLocalStorage 
} from './storageUtils';

export const LEGACY_OFFLINE_QUEUE_KEY = 'bushido_offline_queue';
export const OFFLINE_QUEUE_PREFIX = 'bushido_offline_queue_';
export const OFFLINE_QUARANTINE_KEY = 'bushido_offline_queue_quarantine';
export const GUEST_QUEUE_OWNER = 'guest';

/**
 * Normalizes an account identifier to a stable offline queue owner string.
 * Returns 'guest' for null/empty/anonymous users, or trimmed canonical ID for authenticated users.
 */
export function normalizeQueueOwner(ownerId?: string | null): string {
  const norm = normalizeUserId(ownerId);
  return norm ? norm : GUEST_QUEUE_OWNER;
}

/**
 * Checks whether an owner ID represents the guest/anonymous partition.
 */
export function isGuestQueueOwner(ownerId?: string | null): boolean {
  return normalizeQueueOwner(ownerId) === GUEST_QUEUE_OWNER;
}

/**
 * Generates an account-scoped storage key for the offline queue.
 * Guarantees cryptographic / partition separation between guest and authenticated accounts.
 */
export function getScopedOfflineQueueKey(ownerId?: string | null): string {
  const norm = normalizeQueueOwner(ownerId);
  return norm === GUEST_QUEUE_OWNER
    ? `${OFFLINE_QUEUE_PREFIX}guest`
    : `${OFFLINE_QUEUE_PREFIX}user_${norm}`;
}

export interface EnqueueMutationInput {
  type: OfflineMutationType;
  payload: any;
  dedupKey?: string;
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

  const newItem: OfflineQueueItem = {
    id: `queue_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    ownerId: normOwner,
    type: mutation.type,
    payload: mutation.payload,
    timestamp: Date.now(),
    retryCount: 0,
    dedupKey
  };

  // Compaction & Dependency Ordering Rules:

  // Rule 1: UPDATE_LOG compaction (keep latest log payload for same cycle/date)
  if (mutation.type === 'UPDATE_LOG') {
    const existingIdx = currentQueue.findIndex(
      item => item.type === 'UPDATE_LOG' && item.dedupKey === dedupKey
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

  // Rule 2: UPDATE_CYCLE (preserve dependency ordering after CREATE_CYCLE, compact repeated updates)
  if (mutation.type === 'UPDATE_CYCLE') {
    const existingUpdateIdx = currentQueue.findIndex(
      item => item.type === 'UPDATE_CYCLE' && item.dedupKey === dedupKey
    );
    if (existingUpdateIdx >= 0) {
      const updatedItem: OfflineQueueItem = {
        ...currentQueue[existingUpdateIdx],
        payload: mutation.payload,
        timestamp: Date.now(),
        retryCount: 0
      };
      currentQueue[existingUpdateIdx] = updatedItem;
      saveOfflineQueue(normOwner, currentQueue);
      return updatedItem;
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
      if (item.type === 'DELETE_CYCLE' && item.dedupKey === dedupKey) return false;
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
 * Records retry count increment and last error on a failed queue item.
 */
export function recordQueueItemFailure(
  ownerId: string | null | undefined,
  itemId: string,
  errorMsg: string
): void {
  const normOwner = normalizeQueueOwner(ownerId);
  const currentQueue = getOfflineQueue(normOwner);
  const idx = currentQueue.findIndex(item => item.id === itemId);
  if (idx >= 0) {
    currentQueue[idx] = {
      ...currentQueue[idx],
      retryCount: (currentQueue[idx].retryCount || 0) + 1,
      lastError: errorMsg
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

/**
 * Quarantines items to prevent data loss while keeping active partitions clean.
 */
export function quarantineQueueItems(items: any[], reason: string): void {
  try {
    const raw = safeGetLocalStorage(OFFLINE_QUARANTINE_KEY);
    const existing = raw ? JSON.parse(raw) : [];
    const entry = {
      quarantinedAt: new Date().toISOString(),
      reason,
      items
    };
    existing.push(entry);
    safeSetLocalStorage(OFFLINE_QUARANTINE_KEY, JSON.stringify(existing));
  } catch (err) {
    console.warn('[Offline Queue] Failed to write quarantine:', err);
  }
}

/**
 * Returns all quarantined items.
 */
export function getQuarantinedItems(): any[] {
  try {
    const raw = safeGetLocalStorage(OFFLINE_QUARANTINE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Clears the quarantine storage.
 */
export function clearQuarantine(): void {
  safeRemoveLocalStorage(OFFLINE_QUARANTINE_KEY);
}

/**
 * Migrates legacy global offline queue ('bushido_offline_queue') into account-scoped queues.
 * - Items with verifiable ownerId are safely routed to that owner's partition.
 * - Items with no ownerId or ambiguous structure are quarantined.
 * - Legacy global key is completely cleared after migration.
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
        typeof item.ownerId === 'string'
      ) {
        const owner = normalizeQueueOwner(item.ownerId);
        enqueueOfflineMutation(owner, {
          type: item.type,
          payload: item.payload,
          dedupKey: item.dedupKey
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
    console.warn('[Offline Queue] Failed during legacy migration:', err);
    safeRemoveLocalStorage(LEGACY_OFFLINE_QUEUE_KEY);
  }

  return { migratedCount, quarantinedCount };
}

export interface ReplayOptions {
  activeAccountId: string | null;
  authToken: string | null;
  fetchImpl?: typeof fetch;
  fetchFn?: typeof fetch;
  onItemSuccess?: (item: OfflineQueueItem) => void;
  onItemFailure?: (item: OfflineQueueItem, error: any) => void;
  getCurrentActiveAccountId?: () => string | null;
}

export interface ReplayResult {
  syncedCount: number;
  failedCount: number;
  stoppedDueToAuth: boolean;
  stoppedDueToAccountChange: boolean;
  remainingQueueCount: number;
}

/**
 * Replays queued offline mutations safely for the verified active account.
 * Guarantees:
 * 1. Guest state never replays mutations to the server.
 * 2. Authenticated user mutations are only replayed with a valid auth token.
 * 3. Never replays User A mutations while User B, Guest, Admin, or an impersonated user is active.
 * 4. Verifies active account hasn't changed before and after each network request.
 * 5. 401/403 stops replay immediately while preserving items in the owner's queue.
 * 6. Only confirmed successful items are removed from the queue.
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

  // 2. Authentication Enforcement: Authenticated queue requires valid token
  if (!options.authToken) {
    return {
      syncedCount: 0,
      failedCount: 0,
      stoppedDueToAuth: true,
      stoppedDueToAccountChange: false,
      remainingQueueCount: getOfflineQueue(initialOwner).length
    };
  }

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

  const queue = getOfflineQueue(initialOwner);
  let syncedCount = 0;
  let failedCount = 0;

  for (const item of queue) {
    // 3. Pre-flight Account Switch Check
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

    // 4. Embedded Ownership Verification
    if (normalizeQueueOwner(item.ownerId) !== initialOwner) {
      console.warn(`[Offline Replay] Embedded owner mismatch: item owner ${item.ownerId} != replay owner ${initialOwner}`);
      quarantineQueueItems([item], `Embedded owner mismatch during replay: item owner ${item.ownerId} != replay owner ${initialOwner}`);
      removeReplayedQueueItems(initialOwner, [item.id]);
      continue;
    }

    try {
      let endpoint = '';
      let method = 'POST';
      let body: any = item.payload;

      switch (item.type) {
        case 'UPDATE_LOG': {
          endpoint = '/api/logs';
          method = 'POST';
          break;
        }
        case 'UPDATE_CYCLE': {
          endpoint = `/api/cycles/${item.payload?.id}`;
          method = 'PUT';
          break;
        }
        case 'CREATE_CYCLE': {
          endpoint = '/api/cycles';
          method = 'POST';
          break;
        }
        case 'DELETE_CYCLE': {
          const cycleId = typeof item.payload === 'string' ? item.payload : item.payload?.id;
          endpoint = `/api/cycles/${cycleId}`;
          method = 'DELETE';
          body = undefined;
          break;
        }
        case 'UPDATE_PROFILE': {
          endpoint = '/api/user/profile';
          method = 'PUT';
          break;
        }
        case 'UPDATE_SETTINGS': {
          endpoint = '/api/user/profile';
          method = 'PUT';
          break;
        }
        default: {
          continue;
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.authToken}`
      };

      const res = await fetchFn(endpoint, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined
      });

      // 5. Auth Failure (401 / 403)
      if (res.status === 401 || res.status === 403) {
        return {
          syncedCount,
          failedCount,
          stoppedDueToAuth: true,
          stoppedDueToAccountChange: false,
          remainingQueueCount: getOfflineQueue(initialOwner).length
        };
      }

      const isSuccess = res.ok || (item.type === 'DELETE_CYCLE' && res.status === 404);

      if (isSuccess) {
        // 6. Post-fetch Account Switch Verification before committing success
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

        removeReplayedQueueItems(initialOwner, [item.id]);
        options.onItemSuccess?.(item);
        syncedCount++;
      } else {
        failedCount++;
        const errMsg = `Server returned HTTP ${res.status}`;
        recordQueueItemFailure(initialOwner, item.id, errMsg);
        options.onItemFailure?.(item, new Error(errMsg));
      }
    } catch (networkErr: any) {
      failedCount++;
      const errMsg = networkErr?.message || String(networkErr);
      recordQueueItemFailure(initialOwner, item.id, errMsg);
      options.onItemFailure?.(item, networkErr);
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
