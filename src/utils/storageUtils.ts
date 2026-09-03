import { SystemState, Cycle, DailyLog, UserProfile } from '../types';
import { createInitialSystemState, createEmptySystemState, GUEST_USER_PROFILE } from '../data/initialData';
import { clearOfflineQueue } from './offlineQueueUtils';

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
    const ownerId = normalizeUserId(userId ?? state.userProfile?.id);
    const targetKey = getScopedStorageKey(ownerId);
    // Ensure the saved payload's userProfile.id aligns with the scoped owner to prevent mismatched state rejection
    const stateToSave = ownerId && state.userProfile && state.userProfile.id !== ownerId
      ? { ...state, userProfile: { ...state.userProfile, id: ownerId } }
      : state;
    return safeSetLocalStorage(targetKey, JSON.stringify(stateToSave));
  } catch (err) {
    console.error('[Bushido Storage] Failed to save state to localStorage:', err);
    return false;
  }
}

export function cancelPendingStorageSave(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer as NodeJS.Timeout);
    debounceTimer = null;
  }
  if (idleCallbackId !== null && typeof window !== 'undefined' && 'cancelIdleCallback' in window) {
    window.cancelIdleCallback(idleCallbackId);
    idleCallbackId = null;
  }
  pendingStateToSave = null;
  pendingOwnerId = null;
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
  if (typeof window.addEventListener === 'function') {
    window.addEventListener('beforeunload', flushPendingStorageSave, { capture: true });
    window.addEventListener('pagehide', flushPendingStorageSave, { capture: true });
  }
  if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushPendingStorageSave();
      }
    });
  }
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

    const guestFallback = isDemoConsumed ? createEmptySystemState(GUEST_USER_PROFILE) : createInitialSystemState(GUEST_USER_PROFILE);

    try {
      let saved = safeGetLocalStorage(scopedKey);
      // Migration fallback for initial legacy guest key if present
      if (!saved && safeGetLocalStorage(LEGACY_STORAGE_KEY)) {
        const legacyRaw = safeGetLocalStorage(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
          try {
            const legacyParsed = JSON.parse(legacyRaw);
            // Only migrate if legacy data belongs to guest
            if (!legacyParsed.userProfile?.id || legacyParsed.userProfile?.id === GUEST_USER_PROFILE.id) {
              saved = legacyRaw;
            }
          } catch {
            // ignore
          }
        }
      }

      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (parsed && typeof parsed === 'object') {
            const sanitized = sanitizeSystemState(parsed, guestFallback, GUEST_USER_PROFILE);
            sanitized.userProfile.id = GUEST_USER_PROFILE.id;
            return sanitized;
          }
        } catch {
          console.warn('[Bushido Storage] Corrupted JSON in guest partition, falling back safely');
          return guestFallback;
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
          // ignore corrupted legacy JSON
        }
      }
    }

    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') {
          // Strict boundary: A mismatched userProfile.id in stored JSON must never transfer Cycles or DailyLogs into another authenticated account
          if (parsed.userProfile?.id && parsed.userProfile.id !== normId && parsed.userProfile.id !== GUEST_USER_PROFILE.id) {
            console.warn(`[Bushido Storage] Rejecting mismatched user state (expected ${normId}, found ${parsed.userProfile.id})`);
            return authFallback;
          }
          const sanitized = sanitizeSystemState(parsed, authFallback, authFallbackUser);
          // Strict boundary: ensure userProfile.id matches the requested authenticated normId
          sanitized.userProfile.id = normId;
          return sanitized;
        }
      } catch {
        console.warn(`[Bushido Storage] Corrupted JSON in user partition (${normId}), falling back safely`);
        return authFallback;
      }
    }
  } catch (e) {
    console.warn(`[Bushido Storage] Failed to load state for user ${normId}:`, e);
  }

  return authFallback;
}

export interface AccountTransitionOptions {
  currentSystemState?: SystemState | null;
  targetUserId: string | null;
  targetUserProfile?: Partial<UserProfile> | null;
}

export interface AccountTransitionResult {
  nextState: SystemState;
  nextActiveCycleId: string;
}

/**
 * Pure transition helper for login, logout, account-switching, and impersonation.
 * Guarantees:
 * 1. Cancels pending debounced writes and deterministically writes the outgoing state once.
 * 2. Updates the active local account pointer.
 * 3. Loads the target account's scoped state from localStorage without cross-contamination.
 * 4. Overlays authenticated profile data onto the loaded state.
 */
export function transitionAccountState(options: AccountTransitionOptions): AccountTransitionResult {
  const { currentSystemState, targetUserId, targetUserProfile } = options;

  // 1. Deterministic persistence of outgoing account state (persisted exactly once)
  if (currentSystemState) {
    cancelPendingStorageSave();
    const outgoingOwnerId = normalizeUserId(currentSystemState.userProfile?.id);
    writeStateDirect(currentSystemState, outgoingOwnerId);
  } else {
    flushPendingStorageSave();
  }

  // 2. Set the active account pointer
  const normTargetId = normalizeUserId(targetUserId);
  setActiveAccountId(normTargetId);

  // 3. Load target user's partition
  const loadedState = loadStoredSystemState(normTargetId);

  // 4. Overlay targetUserProfile if provided
  if (targetUserProfile) {
    loadedState.userProfile = {
      ...loadedState.userProfile,
      ...targetUserProfile,
      id: normTargetId || loadedState.userProfile.id
    };
  }

  const nextActiveCycleId = loadedState.cycles[0]?.id || 'cycle-1';

  return {
    nextState: loadedState,
    nextActiveCycleId
  };
}

/**
 * Resets the system state for a given user or guest to initial Bushido values.
 * Immediately purges pending debounced writes and writes the fresh state to storage.
 */
export function resetAccountState(currentUserProfile?: UserProfile | null): { freshState: SystemState; activeCycleId: string } {
  const ownerId = normalizeUserId(currentUserProfile?.id);
  const scopedDemoKey = getScopedDemoConsumedKey(ownerId);

  // 1. Cancel any pending un-reset debounced writes so they cannot overwrite the reset
  cancelPendingStorageSave();

  // 2. Clear demo-consumed state and scoped offline queue
  safeRemoveLocalStorage(scopedDemoKey);
  clearOfflineQueue(ownerId);
  if (!ownerId) {
    safeRemoveLocalStorage(LEGACY_DEMO_CONSUMED_KEY);
    safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
    clearOfflineQueue(null);
  }

  // 3. Create fresh initial state
  const freshState = ownerId
    ? createInitialSystemState({ ...GUEST_USER_PROFILE, id: ownerId, name: currentUserProfile?.name || 'کاربر سامورایی' })
    : createInitialSystemState(currentUserProfile || GUEST_USER_PROFILE);

  // 4. Directly persist fresh state under the designated owner
  writeStateDirect(freshState, ownerId);

  const activeCycleId = freshState.cycles[0]?.id || 'cycle-1';
  return { freshState, activeCycleId };
}

export interface ImportStateResult {
  success: boolean;
  state?: SystemState;
  activeCycleId?: string;
  errorMessage?: string;
}

/**
 * Validates, sanitizes, and imports system state from a JSON string under the active user's ownership.
 * Guarantees that:
 * 1. Imported data is scoped strictly to the current active user (overwriting/correcting userProfile.id).
 * 2. Mismatched userProfile.id in imported JSON is neutralized and bound to the current user (or guest).
 * 3. Scoped demo-consumed flag is marked true so demo seed is not resurrected.
 * 4. Stale pending debounced writes are canceled and imported state is written to storage.
 */
export function importAccountState(dataStr: string, currentUserId?: string | null): ImportStateResult {
  try {
    const parsed = JSON.parse(dataStr);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Array.isArray(parsed.cycles) ||
      !Array.isArray(parsed.logs) ||
      !parsed.settings ||
      typeof parsed.settings !== 'object'
    ) {
      return { success: false, errorMessage: 'فرمت فایل پشتیبان معتبر نیست.' };
    }

    const ownerId = normalizeUserId(currentUserId);

    // Mismatched userProfile.id in imported JSON must never transfer ownership or leak across accounts
    if (!parsed.userProfile || typeof parsed.userProfile !== 'object') {
      parsed.userProfile = ownerId
        ? { ...GUEST_USER_PROFILE, id: ownerId, name: 'کاربر سامورایی' }
        : createInitialSystemState().userProfile;
    } else if (ownerId) {
      parsed.userProfile.id = ownerId;
    } else {
      parsed.userProfile.id = GUEST_USER_PROFILE.id;
    }

    parsed.cycles = parsed.cycles
      .filter((c: any) => c && typeof c === 'object' && typeof c.id === 'string' && typeof c.startDate === 'string')
      .map((c: any) => ({
        ...c,
        isSynced: c.isSynced !== undefined ? Boolean(c.isSynced) : false
      }));

    parsed.logs = parsed.logs
      .filter((l: any) => l && typeof l === 'object' && typeof l.date === 'string')
      .map((l: any) => ({
        ...l,
        isSynced: l.isSynced !== undefined ? Boolean(l.isSynced) : false
      }));

    if (parsed.cycles.length === 0) {
      return { success: false, errorMessage: 'حداقل یک نبرد در فایل پشتیبان الزامی است.' };
    }

    // Cancel any pending debounced writes and persist the imported state directly
    cancelPendingStorageSave();
    const scopedDemoKey = getScopedDemoConsumedKey(ownerId);
    safeSetLocalStorage(scopedDemoKey, 'true');
    writeStateDirect(parsed, ownerId);

    const activeCycleId = parsed.cycles[0].id;
    return {
      success: true,
      state: parsed as SystemState,
      activeCycleId
    };
  } catch {
    return { success: false, errorMessage: 'خطا در تجزیه فایل JSON.' };
  }
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
  clearOfflineQueue(normId);
  if (!normId) {
    safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
    safeRemoveLocalStorage(LEGACY_DEMO_CONSUMED_KEY);
    clearOfflineQueue(null);
  }
}

export * from './offlineQueueUtils';

