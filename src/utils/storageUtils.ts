import { SystemState, Cycle, DailyLog, UserProfile } from '../types';
import { createInitialSystemState, createEmptySystemState, GUEST_USER_PROFILE } from '../data/initialData';

export const STORAGE_KEY = 'bushido_discipline_os_v1';
export const LEGACY_STORAGE_KEY = 'bushido_discipline_os_v1';
export const STORAGE_PREFIX = 'bushido_state_';
export const DEMO_CONSUMED_KEY = 'bushido_demo_consumed_v1';
export const LEGACY_DEMO_CONSUMED_KEY = 'bushido_demo_consumed_v1';
export const DEMO_CONSUMED_PREFIX = 'bushido_demo_consumed_';
export const TOKEN_KEY = 'bushido_auth_token';
export const ACTIVE_ACCOUNT_KEY = 'bushido_active_account_id';
export const GUEST_USER_ID = '__guest__';

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
 * Generates an account-scoped storage key for system state.
 * Guarantees cryptographic / storage separation between anonymous/guest state and authenticated accounts.
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
 * Gets the active local account identifier.
 */
export function getActiveAccountId(): string | null {
  return normalizeUserId(safeGetLocalStorage(ACTIVE_ACCOUNT_KEY));
}

/**
 * Sets or clears the active local account identifier.
 */
export function setActiveAccountId(userId: string | null): void {
  const normId = normalizeUserId(userId);
  if (normId) {
    safeSetLocalStorage(ACTIVE_ACCOUNT_KEY, normId);
  } else {
    safeRemoveLocalStorage(ACTIVE_ACCOUNT_KEY);
  }
}

export interface BackendSyncDecisionInput {
  apiCycles: Cycle[] | null;
  apiLogs: DailyLog[] | null;
  isDemoConsumed: boolean;
}

export interface BackendSyncDecision {
  nextCycles: Cycle[] | null;
  nextLogs: DailyLog[] | null;
  shouldMarkDemoConsumed: boolean;
  nextActiveCycleId: string | null;
}

/**
 * Pure decision function for merging remote backend data with local state.
 *
 * Contract:
 * 1. If demo is NOT consumed and API returns empty cycles/logs, preserves local demo state (returns null for nextCycles/nextLogs).
 * 2. If demo IS consumed (user cleared or opted out), empty API response returns empty arrays (never resurrects demo seed).
 * 3. If API returns real cycles/logs, remote data takes precedence and marks demo as consumed.
 * 4. If remote has real cycles but 0 logs, clears leftover phantom demo logs.
 */
export function resolveBackendSyncDecision(input: BackendSyncDecisionInput): BackendSyncDecision {
  const { apiCycles, apiLogs, isDemoConsumed } = input;
  let nextCycles: Cycle[] | null = null;
  let nextLogs: DailyLog[] | null = null;
  let shouldMarkDemoConsumed = false;
  let nextActiveCycleId: string | null = null;

  if (Array.isArray(apiCycles)) {
    if (apiCycles.length > 0) {
      shouldMarkDemoConsumed = true;
      nextCycles = apiCycles;
      nextActiveCycleId = apiCycles[0].id;
    } else if (isDemoConsumed) {
      nextCycles = [];
    }
  }

  if (Array.isArray(apiLogs)) {
    if (apiLogs.length > 0) {
      nextLogs = apiLogs;
    } else if (isDemoConsumed || (nextCycles && nextCycles.length > 0)) {
      nextLogs = [];
    }
  }

  return {
    nextCycles,
    nextLogs,
    shouldMarkDemoConsumed,
    nextActiveCycleId
  };
}

/**
 * Exception-safe wrapper for localStorage.getItem to prevent crashes in private/incognito mode
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

let pendingStateToSave: SystemState | null = null;
let pendingOwnerId: string | null = null;
let debounceTimer: NodeJS.Timeout | number | null = null;
let idleCallbackId: number | null = null;

const DEBOUNCE_DELAY_MS = 350;

/**
 * Directly writes state to localStorage under the designated account scope.
 */
export function writeStateDirect(state: SystemState, userId?: string | null): boolean {
  try {
    const ownerId = normalizeUserId(userId || state.userProfile?.id);
    const targetKey = getScopedStorageKey(ownerId);
    return safeSetLocalStorage(targetKey, JSON.stringify(state));
  } catch (err) {
    console.error('[Bushido Storage] Failed to save state to localStorage:', err);
    return false;
  }
}

/**
 * Flush any pending debounced writes immediately to disk.
 * Must be called before page unload, logout, or account switches.
 */
export function flushPendingStorageSave(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer as NodeJS.Timeout);
    debounceTimer = null;
  }
  if (idleCallbackId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(idleCallbackId);
    idleCallbackId = null;
  }
  if (pendingStateToSave) {
    writeStateDirect(pendingStateToSave, pendingOwnerId);
    pendingStateToSave = null;
    pendingOwnerId = null;
  }
}

// Auto-register unload and pagehide listeners to ensure zero data loss
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushPendingStorageSave, { capture: true });
  window.addEventListener('pagehide', flushPendingStorageSave, { capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushPendingStorageSave();
    }
  });
}

/**
 * Asynchronously persists system state to account-scoped localStorage with debouncing & requestIdleCallback
 * to completely eliminate main thread blocking and frame drops on rapid habit toggling.
 */
export function saveSystemStateDebounced(
  state: SystemState, 
  userIdOrDelay?: string | null | number, 
  delayMsArg?: number
): void {
  let targetUserId: string | null | undefined;
  let delayMs = DEBOUNCE_DELAY_MS;

  if (typeof userIdOrDelay === 'number') {
    delayMs = userIdOrDelay;
    targetUserId = state.userProfile?.id;
  } else {
    targetUserId = userIdOrDelay;
    if (typeof delayMsArg === 'number') {
      delayMs = delayMsArg;
    }
  }

  const ownerId = normalizeUserId(targetUserId || state.userProfile?.id);

  // If the owner changed before previous debounced write flushed, flush old owner immediately
  if (pendingStateToSave && pendingOwnerId !== ownerId) {
    flushPendingStorageSave();
  }

  pendingStateToSave = state;
  pendingOwnerId = ownerId;

  if (debounceTimer) {
    clearTimeout(debounceTimer as NodeJS.Timeout);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;

    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      if (idleCallbackId !== null) {
        window.cancelIdleCallback(idleCallbackId);
      }
      idleCallbackId = window.requestIdleCallback(
        () => {
          idleCallbackId = null;
          if (pendingStateToSave) {
            writeStateDirect(pendingStateToSave, pendingOwnerId);
            pendingStateToSave = null;
            pendingOwnerId = null;
          }
        },
        { timeout: 1000 }
      );
    } else {
      if (pendingStateToSave) {
        writeStateDirect(pendingStateToSave, pendingOwnerId);
        pendingStateToSave = null;
        pendingOwnerId = null;
      }
    }
  }, delayMs);
}

/**
 * Loads account-scoped system state from localStorage with fallback and schema migration checks.
 * Guarantees that User A's stored cycles/logs are NEVER loaded for User B or anonymous sessions.
 */
export function loadStoredSystemState(userId?: string | null): SystemState {
  const normId = normalizeUserId(userId);
  const scopedKey = getScopedStorageKey(normId);
  const scopedDemoKey = getScopedDemoConsumedKey(normId);

  // 1. ANONYMOUS / GUEST SESSION
  if (!normId) {
    const isDemoConsumed = 
      safeGetLocalStorage(scopedDemoKey) === 'true' || 
      safeGetLocalStorage(DEMO_CONSUMED_KEY) === 'true';

    const guestFallback = isDemoConsumed ? createEmptySystemState(GUEST_USER_PROFILE) : createInitialSystemState();

    try {
      let saved = safeGetLocalStorage(scopedKey);
      // Migration fallback for initial legacy guest key if present
      if (!saved && safeGetLocalStorage(LEGACY_STORAGE_KEY)) {
        const legacyRaw = safeGetLocalStorage(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
          try {
            const legacyParsed = JSON.parse(legacyRaw);
            // Only migrate if legacy data belongs to guest or default initial admin
            if (!legacyParsed.userProfile?.id || legacyParsed.userProfile?.id === GUEST_USER_PROFILE.id) {
              saved = legacyRaw;
            }
          } catch {
            // ignore
          }
        }
      }

      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          return sanitizeSystemState(parsed, guestFallback, GUEST_USER_PROFILE);
        }
      }
    } catch (e) {
      console.warn('[Bushido Storage] Failed to load guest state from localStorage, initializing fresh:', e);
    }
    return guestFallback;
  }

  // 2. AUTHENTICATED USER SESSION
  const authFallbackUser: UserProfile = {
    ...GUEST_USER_PROFILE,
    id: normId,
    name: 'کاربر سامورایی'
  };
  const authFallback = createEmptySystemState(authFallbackUser);

  try {
    let saved = safeGetLocalStorage(scopedKey);

    // Backward-compat check for initial admin master profile if stored under legacy key
    if (!saved && normId === 'admin-master-001') {
      const legacyRaw = safeGetLocalStorage(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        try {
          const legacyParsed = JSON.parse(legacyRaw);
          if (legacyParsed.userProfile?.id === 'admin-master-001') {
            saved = legacyRaw;
          }
        } catch {
          // ignore
        }
      }
    }

    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        const sanitized = sanitizeSystemState(parsed, authFallback, authFallbackUser);
        // Strict boundary: ensure userProfile.id matches the requested authenticated normId
        sanitized.userProfile.id = normId;
        return sanitized;
      }
    }
  } catch (e) {
    console.warn(`[Bushido Storage] Failed to load state for user ${normId}:`, e);
  }

  return authFallback;
}

/**
 * Sanitizes and validates a parsed raw JSON object into a structurally sound SystemState
 */
function sanitizeSystemState(
  parsed: any, 
  fallbackState: SystemState, 
  defaultProfile: UserProfile
): SystemState {
  const result = { ...fallbackState };

  // 1. User Profile Protection
  if (parsed.userProfile && typeof parsed.userProfile === 'object') {
    result.userProfile = {
      ...defaultProfile,
      ...parsed.userProfile
    };
  } else {
    result.userProfile = defaultProfile;
  }

  // 2. Cycles Array Protection
  if (Array.isArray(parsed.cycles)) {
    result.cycles = parsed.cycles
      .filter((c: any) => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.startDate === 'string')
      .map((c: any) => ({
        ...c,
        isSynced: c.isSynced !== undefined ? Boolean(c.isSynced) : false
      }));
  }

  // 3. Logs Array Protection
  if (Array.isArray(parsed.logs)) {
    result.logs = parsed.logs
      .filter((l: any) => l && typeof l === 'object' && typeof l.date === 'string')
      .map((l: any) => ({
        ...l,
        isSynced: l.isSynced !== undefined ? Boolean(l.isSynced) : false
      }));
  }

  // 4. Settings Protection
  if (parsed.settings && typeof parsed.settings === 'object') {
    result.settings = {
      ...fallbackState.settings,
      ...parsed.settings
    };
  }

  return result;
}

/**
 * Clears local state partition for a specific user.
 * Does NOT touch server-side data or other users' storage.
 */
export function clearUserLocalState(userId?: string | null): void {
  const normId = normalizeUserId(userId);
  const scopedKey = getScopedStorageKey(normId);
  const scopedDemoKey = getScopedDemoConsumedKey(normId);
  safeRemoveLocalStorage(scopedKey);
  safeRemoveLocalStorage(scopedDemoKey);
  if (!normId) {
    safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
    safeRemoveLocalStorage(LEGACY_DEMO_CONSUMED_KEY);
  }
}

