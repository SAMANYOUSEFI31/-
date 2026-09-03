/**
 * Storage Core Module
 * 
 * Dependency-neutral module for safe local storage wrappers,
 * key constants, account normalization, and ownership guards.
 * Breaks circular dependencies between storageUtils and offlineQueueUtils.
 */

export const STORAGE_KEY = 'bushido_discipline_os_v1';
export const LEGACY_STORAGE_KEY = 'bushido_discipline_os_v1';
export const STORAGE_PREFIX = 'bushido_state_';
export const DEMO_CONSUMED_KEY = 'bushido_demo_consumed_v1';
export const LEGACY_DEMO_CONSUMED_KEY = 'bushido_demo_consumed_v1';
export const DEMO_CONSUMED_PREFIX = 'bushido_demo_consumed_';
export const TOKEN_KEY = 'bushido_auth_token';
export const ACTIVE_ACCOUNT_KEY = 'bushido_active_account_id';
export const GUEST_USER_ID = '__guest__';
export const GUEST_QUEUE_OWNER = 'guest';
export const OFFLINE_QUEUE_PREFIX = 'bushido_offline_queue_';
export const LEGACY_OFFLINE_QUEUE_KEY = 'bushido_offline_queue';

/**
 * Normalizes an account identifier to a stable, canonical ownership key.
 * Only stable unique user IDs are accepted (e.g. 'admin-master-001', 'usr_...', UUID).
 * Returns null for anonymous/guest sessions, empty strings, or undefined.
 */
export function normalizeUserId(userId?: string | null): string | null {
  if (!userId || typeof userId !== 'string') return null;
  const trimmed = userId.trim();
  if (trimmed === '' || trimmed === GUEST_USER_ID || trimmed === 'null' || trimmed === 'undefined') {
    return null;
  }
  return trimmed;
}

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
 * Generates an account-scoped storage key for system state.
 * Guarantees partition separation between guest and authenticated accounts.
 */
export function getScopedStorageKey(userId?: string | null): string {
  const normId = normalizeUserId(userId);
  return normId ? `${STORAGE_PREFIX}user_${normId}` : `${STORAGE_PREFIX}guest`;
}

/**
 * Generates an account-scoped storage key for the demo consumption flag.
 */
export function getScopedDemoConsumedKey(userId?: string | null): string {
  const normId = normalizeUserId(userId);
  return normId ? `${DEMO_CONSUMED_PREFIX}user_${normId}` : `${DEMO_CONSUMED_PREFIX}guest`;
}

/**
 * Generates an account-scoped storage key for the offline queue.
 */
export function getScopedOfflineQueueKey(ownerId?: string | null): string {
  const norm = normalizeQueueOwner(ownerId);
  return norm === GUEST_QUEUE_OWNER
    ? `${OFFLINE_QUEUE_PREFIX}guest`
    : `${OFFLINE_QUEUE_PREFIX}user_${norm}`;
}

/**
 * Reusable Ownership & Auth Guard for Offline Mutations.
 * 
 * Determines whether a mutation MUST be placed into the local offline queue
 * rather than sent directly to the server:
 * 1. Offline network status (navigator.onLine === false)
 * 2. Missing auth token (!authToken)
 * 3. Guest/anonymous session (owner is guest)
 * 
 * Both App.tsx (authoritative runtime) and BushidoContext.tsx MUST use this exact guard
 * so behavior is strictly unified across all entry points.
 */
export interface MutationQueueGuardResult {
  canSendToServer: boolean;
  shouldQueue: boolean;
}

export function shouldQueueOfflineMutation(
  options: { ownerId?: string | null; authToken?: string | null }
): MutationQueueGuardResult;
export function shouldQueueOfflineMutation(
  ownerId?: string | null,
  authToken?: string | null
): boolean;
export function shouldQueueOfflineMutation(
  firstArg?: string | null | { ownerId?: string | null; authToken?: string | null },
  secondArg?: string | null
): boolean | MutationQueueGuardResult {
  let ownerId: string | null | undefined;
  let authToken: string | null | undefined;
  const isObjectCall = Boolean(firstArg && typeof firstArg === 'object');

  if (isObjectCall) {
    const opts = firstArg as { ownerId?: string | null; authToken?: string | null };
    ownerId = opts.ownerId;
    authToken = opts.authToken;
  } else {
    ownerId = firstArg as string | null | undefined;
    authToken = secondArg;
  }

  const isGuest = isGuestQueueOwner(ownerId);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const hasToken = Boolean(authToken && authToken.trim().length > 0);

  if (isObjectCall) {
    if (isGuest || !hasToken) {
      return { canSendToServer: false, shouldQueue: false };
    }
    if (isOffline) {
      return { canSendToServer: false, shouldQueue: true };
    }
    return { canSendToServer: true, shouldQueue: false };
  }

  // Positional boolean return (legacy / simple check)
  if (isOffline) {
    return true;
  }
  if (!hasToken || isGuest) {
    return true;
  }
  return false;
}

/**
 * Exception-safe wrapper for localStorage.getItem to prevent crashes in private/incognito mode or headless tests
 */
export function safeGetLocalStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage.getItem(key);
  } catch (e) {
    console.warn(`[Bushido Storage] safeGetLocalStorage failed for key "${key}":`, e);
    return null;
  }
}

/**
 * Exception-safe wrapper for localStorage.setItem
 */
export function safeSetLocalStorage(key: string, value: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`[Bushido Storage] safeSetLocalStorage failed for key "${key}":`, e);
    return false;
  }
}

/**
 * Exception-safe wrapper for localStorage.removeItem
 */
export function safeRemoveLocalStorage(key: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    window.localStorage.removeItem(key);
    return true;
  } catch (e) {
    console.warn(`[Bushido Storage] safeRemoveLocalStorage failed for key "${key}":`, e);
    return false;
  }
}

/**
 * Exception-safe wrapper for sessionStorage.getItem
 */
export function safeGetSessionStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage.getItem(key);
  } catch (e) {
    console.warn(`[Bushido Storage] safeGetSessionStorage failed for key "${key}":`, e);
    return null;
  }
}

/**
 * Exception-safe wrapper for sessionStorage.setItem
 */
export function safeSetSessionStorage(key: string, value: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    window.sessionStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn(`[Bushido Storage] safeSetSessionStorage failed for key "${key}":`, e);
    return false;
  }
}

/**
 * Exception-safe wrapper for sessionStorage.removeItem
 */
export function safeRemoveSessionStorage(key: string): boolean {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return false;
    window.sessionStorage.removeItem(key);
    return true;
  } catch (e) {
    console.warn(`[Bushido Storage] safeRemoveSessionStorage failed for key "${key}":`, e);
    return false;
  }
}
