import { SystemState, Cycle, DailyLog, UserProfile, SystemSettings, AccentTheme } from '../types';
import { createInitialSystemState, createEmptySystemState, GUEST_USER_PROFILE } from '../data/initialData';
import { clearOfflineQueue } from './offlineQueueUtils';
import {
  safeGetLocalStorage,
  safeSetLocalStorage,
  safeRemoveLocalStorage,
  safeGetSessionStorage,
  safeSetSessionStorage,
  safeRemoveSessionStorage,
  ACTIVE_ACCOUNT_KEY,
  STORAGE_KEY,
  LEGACY_STORAGE_KEY,
  DEMO_CONSUMED_KEY,
  LEGACY_DEMO_CONSUMED_KEY,
  normalizeUserId,
  getScopedStorageKey,
  getScopedDemoConsumedKey,
  getScopedOfflineQueueKey,
  getScopedStateRecoveryKey,
  isGuestQueueOwner,
  shouldQueueOfflineMutation
} from './storageCore';

// Re-export all dependency-neutral storage primitives and constants
export * from './storageCore';

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
      let isFromLegacy = false;
      // Migration fallback for initial legacy guest key if present
      if (!saved && safeGetLocalStorage(LEGACY_STORAGE_KEY)) {
        const legacyRaw = safeGetLocalStorage(LEGACY_STORAGE_KEY);
        if (legacyRaw) {
          try {
            const legacyParsed = JSON.parse(legacyRaw);
            // Only migrate if legacy data belongs to guest
            if (!legacyParsed.userProfile?.id || legacyParsed.userProfile?.id === GUEST_USER_PROFILE.id) {
              saved = legacyRaw;
              isFromLegacy = true;
            }
          } catch {
            safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
          }
        }
      }

      if (saved) {
        let parsed: any;
        try {
          parsed = JSON.parse(saved);
        } catch {
          console.warn('[Bushido Storage] Corrupted JSON in guest partition, clearing and falling back safely');
          safeRemoveLocalStorage(scopedKey);
          if (isFromLegacy) {
            safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
          }
          saveRecoveryMetadata(null, {
            recoveredCycleCount: guestFallback.cycles.length,
            discardedCycleCount: 0,
            recoveredLogCount: guestFallback.logs.length,
            discardedLogCount: 0,
            duplicateCount: 0,
            orphanCount: 0,
            usedFallback: true,
            corruptedRawCleared: true,
            timestamp: Date.now()
          });
          return guestFallback;
        }

        if (parsed && typeof parsed === 'object') {
          const { state: sanitized, recovery } = recoverSystemState(parsed, guestFallback, GUEST_USER_PROFILE);
          sanitized.userProfile.id = GUEST_USER_PROFILE.id;
          if (recovery.discardedCycleCount > 0 || recovery.discardedLogCount > 0 || recovery.duplicateCount > 0 || recovery.orphanCount > 0) {
            saveRecoveryMetadata(null, recovery);
            safeSetLocalStorage(scopedKey, JSON.stringify(sanitized));
            if (isFromLegacy) {
              safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
            }
          }
          return sanitized;
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
    let isFromLegacy = false;

    // Backward-compat check for initial admin master profile if stored under legacy key
    if (!saved && normId === 'admin-master-001') {
      const legacyRaw = safeGetLocalStorage(LEGACY_STORAGE_KEY);
      if (legacyRaw) {
        try {
          const legacyParsed = JSON.parse(legacyRaw);
          if (legacyParsed.userProfile?.id === 'admin-master-001') {
            saved = legacyRaw;
            isFromLegacy = true;
          }
        } catch {
          safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
        }
      }
    }

    if (saved) {
      let parsed: any;
      try {
        parsed = JSON.parse(saved);
      } catch {
        console.warn(`[Bushido Storage] Corrupted JSON in user partition (${normId}), clearing and falling back safely`);
        safeRemoveLocalStorage(scopedKey);
        if (isFromLegacy) {
          safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
        }
        saveRecoveryMetadata(normId, {
          recoveredCycleCount: authFallback.cycles.length,
          discardedCycleCount: 0,
          recoveredLogCount: authFallback.logs.length,
          discardedLogCount: 0,
          duplicateCount: 0,
          orphanCount: 0,
          usedFallback: true,
          corruptedRawCleared: true,
          timestamp: Date.now()
        });
        return authFallback;
      }

      if (parsed && typeof parsed === 'object') {
        // Strict boundary: A mismatched userProfile.id in stored JSON must never transfer Cycles or DailyLogs into another authenticated account
        if (parsed.userProfile?.id && parsed.userProfile.id !== normId && parsed.userProfile.id !== GUEST_USER_PROFILE.id) {
          console.warn(`[Bushido Storage] Rejecting mismatched user state (expected ${normId}, found ${parsed.userProfile.id})`);
          return authFallback;
        }
        const { state: sanitized, recovery } = recoverSystemState(parsed, authFallback, authFallbackUser);
        sanitized.userProfile.id = normId;
        if (recovery.discardedCycleCount > 0 || recovery.discardedLogCount > 0 || recovery.duplicateCount > 0 || recovery.orphanCount > 0) {
          saveRecoveryMetadata(normId, recovery);
          safeSetLocalStorage(scopedKey, JSON.stringify(sanitized));
          if (isFromLegacy) {
            safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
          }
        }
        return sanitized;
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

  // 2. Clear demo-consumed state, recovery metadata, and scoped offline queue
  safeRemoveLocalStorage(scopedDemoKey);
  clearStoredStateRecoveryMetadata(ownerId);
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

export interface ExportProfileDto {
  name: string;
  nightOwlCutoffHour?: number;
  accentTheme?: string;
}

export interface ExportBackupDto {
  cycles: Cycle[];
  logs: DailyLog[];
  settings: SystemSettings;
  userProfile: ExportProfileDto;
  exportedAt: string;
}

/**
 * Builds a privacy-safe, narrowly scoped JSON export payload.
 * Strictly excludes internal and security-relevant Profile fields such as
 * isAdmin, tokenVersion, paymentRefId, email, phoneNumber, vipSince, etc.
 * Does not export session data, tokens, offline queue, or quarantine items.
 */
export function buildExportPayload(state: SystemState): ExportBackupDto {
  const safeProfile: ExportProfileDto = {
    name: state.userProfile?.name || 'کاربر سامورایی'
  };

  if (
    typeof state.userProfile?.nightOwlCutoffHour === 'number' &&
    Number.isInteger(state.userProfile.nightOwlCutoffHour) &&
    state.userProfile.nightOwlCutoffHour >= 0 &&
    state.userProfile.nightOwlCutoffHour <= 23
  ) {
    safeProfile.nightOwlCutoffHour = state.userProfile.nightOwlCutoffHour;
  }

  if (
    typeof state.userProfile?.accentTheme === 'string' &&
    ['amber', 'emerald', 'crimson', 'cyan'].includes(state.userProfile.accentTheme)
  ) {
    safeProfile.accentTheme = state.userProfile.accentTheme;
  }

  return {
    cycles: Array.isArray(state.cycles) ? state.cycles : [],
    logs: Array.isArray(state.logs) ? state.logs : [],
    settings: state.settings,
    userProfile: safeProfile,
    exportedAt: new Date().toISOString()
  };
}

/**
 * Validates whether a value is a valid calendar date string in strict YYYY-MM-DD format.
 */
export function isValidISODateString(val: unknown): val is string {
  if (typeof val !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const y = Number(val.slice(0, 4));
  const m = Number(val.slice(5, 7));
  const d = Number(val.slice(8, 10));
  if (y < 1000 || y > 9999 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Validates whether an object is a structurally valid Cycle candidate.
 */
export function isStructurallyValidCycleCandidate(c: any): c is Cycle {
  if (!c || typeof c !== 'object' || Array.isArray(c)) return false;
  if (typeof c.id !== 'string' || c.id.trim().length === 0) return false;
  if (typeof c.title !== 'string' || c.title.trim().length === 0) return false;
  if (!isValidISODateString(c.startDate)) return false;
  if (!isValidISODateString(c.endDate)) return false;
  if (c.startDate > c.endDate) return false;
  if (c.rules !== undefined && !Array.isArray(c.rules)) return false;
  return true;
}

/**
 * Validates whether an object is a structurally valid DailyLog candidate.
 */
export function isStructurallyValidLogCandidate(l: any): l is DailyLog {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return false;
  if (typeof l.id !== 'string' || l.id.trim().length === 0) return false;
  if (typeof l.cycleId !== 'string' || l.cycleId.trim().length === 0) return false;
  if (!isValidISODateString(l.date)) return false;
  return true;
}

export interface StateRecoveryMetadata {
  recoveredCycleCount: number;
  discardedCycleCount: number;
  recoveredLogCount: number;
  discardedLogCount: number;
  duplicateCount: number;
  orphanCount: number;
  usedFallback: boolean;
  timestamp?: number;
  corruptedRawCleared?: boolean;
}

export interface StateRecoveryResult {
  state: SystemState;
  recovery: StateRecoveryMetadata;
}

/**
 * Persists privacy-safe recovery metadata for an account partition.
 */
export function saveRecoveryMetadata(ownerId: string | null | undefined, metadata: StateRecoveryMetadata): boolean {
  const normId = normalizeUserId(ownerId);
  const recoveryKey = getScopedStateRecoveryKey(normId);
  try {
    return safeSetLocalStorage(recoveryKey, JSON.stringify(metadata));
  } catch {
    return false;
  }
}

/**
 * Retrieves stored recovery metadata for an account partition.
 */
export function getStoredStateRecoveryMetadata(ownerId?: string | null): StateRecoveryMetadata | null {
  const normId = normalizeUserId(ownerId);
  const recoveryKey = getScopedStateRecoveryKey(normId);
  const raw = safeGetLocalStorage(recoveryKey);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && typeof parsed.recoveredCycleCount === 'number') {
      return parsed as StateRecoveryMetadata;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Clears stored recovery metadata for an account partition.
 */
export function clearStoredStateRecoveryMetadata(ownerId?: string | null): void {
  const normId = normalizeUserId(ownerId);
  const recoveryKey = getScopedStateRecoveryKey(normId);
  safeRemoveLocalStorage(recoveryKey);
}

/**
 * Deterministically recovers and sanitizes a parsed state object into a structurally sound SystemState.
 * Guarantees:
 * 1. Discards structurally invalid Cycles (malformed dates, missing id/title, inverted date range).
 * 2. Deduplicates Cycles with identical IDs: prefers higher valid revision, otherwise preserves first stable occurrence.
 * 3. Discards structurally invalid DailyLogs (malformed dates, missing id/cycleId).
 * 4. Orphan Policy: Excludes DailyLogs referencing missing, rejected, or duplicate-loser Cycles.
 * 5. Deduplicates DailyLogs with identical dates: prefers higher valid revision, otherwise preserves first stable occurrence.
 * 6. Strictly enforces Phase 6.3A Profile security allowlist and server-authoritative boundary.
 * 7. Safely retains valid Settings values.
 * 8. Returns privacy-safe aggregated recovery metadata (no personal identifiers, tokens, or titles).
 */
export function recoverSystemState(
  parsed: any, 
  fallbackState: SystemState, 
  defaultProfile: UserProfile
): StateRecoveryResult {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      state: fallbackState,
      recovery: {
        recoveredCycleCount: fallbackState.cycles.length,
        discardedCycleCount: 0,
        recoveredLogCount: fallbackState.logs.length,
        discardedLogCount: 0,
        duplicateCount: 0,
        orphanCount: 0,
        usedFallback: true,
        timestamp: Date.now()
      }
    };
  }

  const result: SystemState = {
    cycles: [],
    logs: [],
    settings: { ...fallbackState.settings },
    userProfile: { ...defaultProfile }
  };

  // 1. User Profile Protection & Strict Allow-List Policy (Phase 6.3A intact)
  if (parsed.userProfile && typeof parsed.userProfile === 'object' && !Array.isArray(parsed.userProfile)) {
    const raw = parsed.userProfile;
    const sanitizedProfile: UserProfile = {
      ...defaultProfile
    };

    // Explicit allowlist for local-editable presentation fields:
    if (typeof raw.name === 'string' && raw.name.trim().length > 0) {
      sanitizedProfile.name = raw.name.trim().slice(0, 80);
    }

    if (
      typeof raw.nightOwlCutoffHour === 'number' &&
      Number.isInteger(raw.nightOwlCutoffHour) &&
      raw.nightOwlCutoffHour >= 0 &&
      raw.nightOwlCutoffHour <= 23
    ) {
      sanitizedProfile.nightOwlCutoffHour = raw.nightOwlCutoffHour;
    }

    if (
      typeof raw.accentTheme === 'string' &&
      ['amber', 'emerald', 'crimson', 'cyan'].includes(raw.accentTheme)
    ) {
      sanitizedProfile.accentTheme = raw.accentTheme as AccentTheme;
    }

    // Explicitly enforce server-authoritative / security-relevant fields from trusted defaultProfile
    sanitizedProfile.id = defaultProfile.id;
    sanitizedProfile.isAdmin = Boolean(defaultProfile.isAdmin);
    sanitizedProfile.isVip = Boolean(defaultProfile.isVip);
    sanitizedProfile.tier = defaultProfile.tier || 'free';
    sanitizedProfile.activeCycleLimit = typeof defaultProfile.activeCycleLimit === 'number' ? defaultProfile.activeCycleLimit : 1;
    sanitizedProfile.vipSince = defaultProfile.vipSince;
    sanitizedProfile.vipExpiresAt = defaultProfile.vipExpiresAt;
    sanitizedProfile.paymentRefId = defaultProfile.paymentRefId;
    sanitizedProfile.email = defaultProfile.email;
    sanitizedProfile.phoneNumber = defaultProfile.phoneNumber;

    result.userProfile = sanitizedProfile;
  } else {
    result.userProfile = defaultProfile;
  }

  // 2. Cycles Array Validation & Deduplication
  let discardedCycleCount = 0;
  let cycleDuplicateCount = 0;
  const cycleMap = new Map<string, { candidate: Cycle; index: number }>();

  if (Array.isArray(parsed.cycles)) {
    parsed.cycles.forEach((rawCycle: any, idx: number) => {
      if (!isStructurallyValidCycleCandidate(rawCycle)) {
        discardedCycleCount++;
        return;
      }

      const cycleId = rawCycle.id.trim();
      const sanitizedCycle: Cycle = {
        ...rawCycle,
        id: cycleId,
        title: rawCycle.title.trim(),
        startDate: rawCycle.startDate,
        endDate: rawCycle.endDate,
        targetTheme: typeof rawCycle.targetTheme === 'string' ? rawCycle.targetTheme : '',
        inheritedStreak: typeof rawCycle.inheritedStreak === 'number' && Number.isFinite(rawCycle.inheritedStreak) && rawCycle.inheritedStreak >= 0 ? Math.floor(rawCycle.inheritedStreak) : 0,
        rules: Array.isArray(rawCycle.rules) ? rawCycle.rules.filter((r: any) => typeof r === 'string') : [],
        isArchived: Boolean(rawCycle.isArchived),
        reportRead: Boolean(rawCycle.reportRead),
        isSynced: rawCycle.isSynced !== undefined ? Boolean(rawCycle.isSynced) : false,
        revision: typeof rawCycle.revision === 'number' && Number.isInteger(rawCycle.revision) && rawCycle.revision > 0 ? rawCycle.revision : undefined,
        verdict: rawCycle.verdict && typeof rawCycle.verdict === 'object' ? rawCycle.verdict : undefined
      };

      if (!cycleMap.has(cycleId)) {
        cycleMap.set(cycleId, { candidate: sanitizedCycle, index: idx });
      } else {
        // Duplicate Cycle ID Policy:
        // Prefer higher valid revision; if equal or absent, preserve first stable occurrence.
        cycleDuplicateCount++;
        discardedCycleCount++;
        const existing = cycleMap.get(cycleId)!;
        const existingRev = existing.candidate.revision ?? 1;
        const newRev = sanitizedCycle.revision ?? 1;

        if (newRev > existingRev) {
          cycleMap.set(cycleId, { candidate: sanitizedCycle, index: existing.index });
        }
      }
    });

    result.cycles = Array.from(cycleMap.values())
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.candidate);
  } else if (parsed.cycles === undefined) {
    result.cycles = fallbackState.cycles;
  }

  // 3. DailyLogs Array Validation, Orphan Removal & Deduplication
  const retainedCycleIds = new Set(result.cycles.map(c => c.id));
  let discardedLogCount = 0;
  let logDuplicateCount = 0;
  let orphanCount = 0;
  const logMap = new Map<string, { candidate: DailyLog; index: number }>();

  if (Array.isArray(parsed.logs)) {
    parsed.logs.forEach((rawLog: any, idx: number) => {
      // 3.1 Structural validation check
      if (!isStructurallyValidLogCandidate(rawLog)) {
        discardedLogCount++;
        return;
      }

      const cycleId = rawLog.cycleId.trim();
      const date = rawLog.date;

      // 3.2 Orphan Policy: DailyLog must reference a retained, valid Cycle
      if (!retainedCycleIds.has(cycleId)) {
        orphanCount++;
        discardedLogCount++;
        return;
      }

      const sanitizedLog: DailyLog = {
        ...rawLog,
        id: rawLog.id.trim(),
        cycleId,
        date,
        createdAt: typeof rawLog.createdAt === 'string' && rawLog.createdAt.trim().length > 0 ? rawLog.createdAt : new Date().toISOString(),
        wakeUp: Boolean(rawLog.wakeUp),
        workout: Boolean(rawLog.workout),
        study: Boolean(rawLog.study),
        journal: Boolean(rawLog.journal),
        hardTask: Boolean(rawLog.hardTask),
        specialMission: Boolean(rawLog.specialMission),
        isSynced: rawLog.isSynced !== undefined ? Boolean(rawLog.isSynced) : false,
        revision: typeof rawLog.revision === 'number' && Number.isInteger(rawLog.revision) && rawLog.revision > 0 ? rawLog.revision : undefined
      };

      // 3.3 Duplicate Policy: Logical identity in product and database contract is `date`
      const logicalKey = date;

      if (!logMap.has(logicalKey)) {
        logMap.set(logicalKey, { candidate: sanitizedLog, index: idx });
      } else {
        // Duplicate DailyLog Policy:
        // Prefer higher valid revision; if equal or absent, preserve first stable occurrence.
        logDuplicateCount++;
        discardedLogCount++;
        const existing = logMap.get(logicalKey)!;
        const existingRev = existing.candidate.revision ?? 1;
        const newRev = sanitizedLog.revision ?? 1;

        if (newRev > existingRev) {
          logMap.set(logicalKey, { candidate: sanitizedLog, index: existing.index });
        }
      }
    });

    result.logs = Array.from(logMap.values())
      .sort((a, b) => a.index - b.index)
      .map(entry => entry.candidate);
  } else if (parsed.logs === undefined) {
    result.logs = fallbackState.logs.filter(l => retainedCycleIds.has(l.cycleId));
  }

  // 4. Settings Protection
  if (parsed.settings && typeof parsed.settings === 'object' && !Array.isArray(parsed.settings)) {
    const rawS = parsed.settings;
    result.settings = {
      id: typeof rawS.id === 'string' && rawS.id.trim().length > 0 ? rawS.id : fallbackState.settings.id,
      platformName: typeof rawS.platformName === 'string' && rawS.platformName.trim().length > 0 ? rawS.platformName : fallbackState.settings.platformName,
      centralEngineName: typeof rawS.centralEngineName === 'string' && rawS.centralEngineName.trim().length > 0 ? rawS.centralEngineName : fallbackState.settings.centralEngineName,
      allTimeMaxStreak: typeof rawS.allTimeMaxStreak === 'number' && Number.isFinite(rawS.allTimeMaxStreak) && rawS.allTimeMaxStreak >= 0 ? Math.floor(rawS.allTimeMaxStreak) : fallbackState.settings.allTimeMaxStreak,
      allTimeMaxScore: typeof rawS.allTimeMaxScore === 'number' && Number.isFinite(rawS.allTimeMaxScore) && rawS.allTimeMaxScore >= 0 ? Math.floor(rawS.allTimeMaxScore) : fallbackState.settings.allTimeMaxScore,
      allTimeMaxStandardDays: typeof rawS.allTimeMaxStandardDays === 'number' && Number.isFinite(rawS.allTimeMaxStandardDays) && rawS.allTimeMaxStandardDays >= 0 ? Math.floor(rawS.allTimeMaxStandardDays) : fallbackState.settings.allTimeMaxStandardDays,
      nightOwlCutoffHour: typeof rawS.nightOwlCutoffHour === 'number' && Number.isInteger(rawS.nightOwlCutoffHour) && rawS.nightOwlCutoffHour >= 0 && rawS.nightOwlCutoffHour <= 23 ? rawS.nightOwlCutoffHour : fallbackState.settings.nightOwlCutoffHour,
      accentTheme: typeof rawS.accentTheme === 'string' && ['amber', 'emerald', 'crimson', 'cyan'].includes(rawS.accentTheme) ? rawS.accentTheme : fallbackState.settings.accentTheme
    };
  } else {
    result.settings = { ...fallbackState.settings };
  }

  const recovery: StateRecoveryMetadata = {
    recoveredCycleCount: result.cycles.length,
    discardedCycleCount,
    recoveredLogCount: result.logs.length,
    discardedLogCount,
    duplicateCount: cycleDuplicateCount + logDuplicateCount,
    orphanCount,
    usedFallback: false,
    timestamp: Date.now()
  };

  return {
    state: result,
    recovery
  };
}

/**
 * Sanitizes and validates a parsed raw JSON object into a structurally sound SystemState.
 * Delegated directly to recoverSystemState for unified contract adherence.
 */
export function sanitizeSystemState(
  parsed: any, 
  fallbackState: SystemState, 
  defaultProfile: UserProfile
): SystemState {
  return recoverSystemState(parsed, fallbackState, defaultProfile).state;
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
  clearStoredStateRecoveryMetadata(normId);
  clearOfflineQueue(normId);
  if (!normId) {
    safeRemoveLocalStorage(LEGACY_STORAGE_KEY);
    safeRemoveLocalStorage(LEGACY_DEMO_CONSUMED_KEY);
    clearStoredStateRecoveryMetadata(null);
    clearOfflineQueue(null);
  }
}

export * from './offlineQueueUtils';

