import { OfflineMutationType, OfflineQueueItem } from '../types';
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

export const OFFLINE_QUARANTINE_PREFIX = 'bushido_quarantine_';
export const LEGACY_AMBIGUOUS_QUARANTINE_KEY = 'bushido_quarantine_legacy_ambiguous';
export const LEGACY_OFFLINE_QUARANTINE_KEY = 'bushido_offline_queue_quarantine';
export const OFFLINE_QUARANTINE_KEY = 'bushido_offline_queue_quarantine';

export const MAX_REPLAY_RETRIES = 5;
export const REPLAY_LOCK_PREFIX = 'bushido_replay_lock_';
export const REPLAY_LOCK_TIMEOUT_MS = 10000;

// In-flight replay promise tracker per account to prevent intra-tab concurrent replays
const inFlightReplayPromises = new Map<string, Promise<ReplayResult>>();

/**
 * Acquires a cross-tab ephemeral storage lease for replay execution.
 * Returns the acquired unique lockId string on success, or null on failure/contention.
 */
export function acquireReplayLock(owner: string): string | null {
  const normOwner = normalizeQueueOwner(owner);
  const lockKey = `${REPLAY_LOCK_PREFIX}${normOwner}`;
  const now = Date.now();
  const existingRaw = safeGetLocalStorage(lockKey);
  if (existingRaw) {
    try {
      const parsed = JSON.parse(existingRaw);
      if (parsed && typeof parsed.timestamp === 'number' && (now - parsed.timestamp) < REPLAY_LOCK_TIMEOUT_MS) {
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
 * Records retry count increment, last error, and optional exponential backoff on a failed queue item.
 */
export function recordQueueItemFailure(
  ownerId: string | null | undefined,
  itemId: string,
  errorMsg: string,
  backoffMs = 0
): void {
  const normOwner = normalizeQueueOwner(ownerId);
  const currentQueue = getOfflineQueue(normOwner);
  const idx = currentQueue.findIndex(item => item.id === itemId);
  if (idx >= 0) {
    const nextRetryCount = (currentQueue[idx].retryCount || 0) + 1;
    currentQueue[idx] = {
      ...currentQueue[idx],
      retryCount: nextRetryCount,
      lastError: errorMsg,
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
 * before storing them in quarantine records.
 */
export function sanitizePayloadCredentials(val: any, depth = 0): any {
  if (depth > 5 || val === null || val === undefined) return val;
  if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') return val;
  if (Array.isArray(val)) {
    return val.map(item => sanitizePayloadCredentials(item, depth + 1));
  }
  if (typeof val === 'object') {
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
        cleaned[k] = sanitizePayloadCredentials(v, depth + 1);
      }
    }
    return cleaned;
  }
  return val;
}

export interface QuarantineAuditItem {
  id: string | null;
  ownerId: string;
  type: string;
  timestamp: number;
  dedupKey?: string;
  retryCount: number;
  lastError?: string;
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
    lastError: typeof item?.lastError === 'string' ? item.lastError : undefined,
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
 * Full raw string is preserved ONLY in ambiguous quarantine partition; global audit ledger
 * records safe metadata (length, timestamp, parse error) without storing arbitrary raw strings.
 */
export function quarantineCorruptedRawData(raw: string, reason: string, error?: any): void {
  try {
    const entry = {
      quarantinedAt: new Date().toISOString(),
      reason,
      rawCorruptedData: raw,
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

export interface ReplayOptions {
  activeAccountId: string | null;
  authToken: string | null;
  fetchImpl?: typeof fetch;
  fetchFn?: typeof fetch;
  force?: boolean;
  respectBackoff?: boolean;
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
 * 4. Intra-tab mutex & cross-tab lock lease prevent duplicate concurrent replays.
 * 5. Verifies active account hasn't changed before and after each network request.
 * 6. 401/403 stops replay immediately while preserving items in the owner's queue.
 * 7. Only confirmed successful items (or quarantined non-retryable poison pills) are removed from the queue.
 * 8. Re-verifies fresh item existence and compacted payloads before each network invocation.
 * 9. Retryable errors (network, 5xx, 408, 429) are preserved indefinitely with exponential backoff and never quarantined.
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

  // 4. Concurrency Protection (Inter-tab): Acquire cross-tab storage lease
  const lockId = acquireReplayLock(initialOwner);
  if (!lockId) {
    return {
      syncedCount: 0,
      failedCount: 0,
      stoppedDueToAuth: false,
      stoppedDueToAccountChange: false,
      remainingQueueCount: getOfflineQueue(initialOwner).length
    };
  }

  const runReplay = async (): Promise<ReplayResult> => {
    try {
      return await executeReplayLoop(options, initialOwner);
    } finally {
      releaseReplayLock(initialOwner, lockId);
      inFlightReplayPromises.delete(initialOwner);
    }
  };

  const replayPromise = runReplay();
  inFlightReplayPromises.set(initialOwner, replayPromise);
  return replayPromise;
}

async function executeReplayLoop(options: ReplayOptions, initialOwner: string): Promise<ReplayResult> {
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
    if (options.respectBackoff && item.nextRetryAt && Date.now() < item.nextRetryAt && !options.force) {
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

    try {
      let endpoint = '';
      let method = 'POST';
      let body: any = item.payload;

      switch (item.type) {
        case 'UPDATE_LOG': {
          endpoint = '/api/logs';
          method = 'POST';
          body = {
            ...item.payload,
            clientOperationId: item.id
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
          body = {
            ...item.payload,
            clientOperationId: item.id
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
          endpoint = `/api/cycles/${cycleId}`;
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
          continue;
        }
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${options.authToken}`
      };

      let res: any;
      try {
        res = await fetchFn(endpoint, {
          method,
          headers,
          body: body !== undefined ? JSON.stringify(body) : undefined
        });
      } catch (networkErr: any) {
        failedCount++;
        const errMsg = networkErr?.message || String(networkErr);
        const nextRetryCount = (item.retryCount || 0) + 1;
        const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.min(nextRetryCount, 5)));
        recordQueueItemFailure(initialOwner, item.id, errMsg, backoffMs);
        options.onItemFailure?.(item, networkErr);
        // Fail-fast on network error: stop replay run to preserve downstream retry budgets and avoid tight loops
        break;
      }

      // 4. Auth Failure (401 / 403)
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
        // 5. Post-fetch Account Switch Verification before committing success
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

        // Retryable server and rate-limit errors (5xx, 408, 429)
        // Must NEVER automatically quarantine valid mutations regardless of retry count!
        const isRetryable = res.status === 408 || res.status === 429 || (res.status >= 500 && res.status <= 599);

        if (isRetryable) {
          const nextRetryCount = (item.retryCount || 0) + 1;
          const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.min(nextRetryCount, 5)));
          recordQueueItemFailure(initialOwner, item.id, errMsg, backoffMs);
          options.onItemFailure?.(item, new Error(errMsg));
          // Stop replay run on server/gateway failure to avoid hammering during outage
          break;
        }

        // Permanent client rejections (400 schema validation, 422, 409 collision, 404 non-existent resource for updates)
        // Quarantine to prevent permanently blocking the queue
        quarantineQueueItems([item], `Permanent server rejection (${res.status}): ${errMsg}`, initialOwner);
        removeReplayedQueueItems(initialOwner, [item.id]);
        options.onItemFailure?.(item, new Error(errMsg));
      }
    } catch (generalErr: any) {
      failedCount++;
      const errMsg = generalErr?.message || String(generalErr);
      const nextRetryCount = (item.retryCount || 0) + 1;
      const backoffMs = Math.min(30000, 1000 * Math.pow(2, Math.min(nextRetryCount, 5)));
      recordQueueItemFailure(initialOwner, item.id, errMsg, backoffMs);
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
