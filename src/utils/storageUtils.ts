import { SystemState, Cycle, DailyLog } from '../types';
import { createInitialSystemState, createEmptySystemState } from '../data/initialData';

export const STORAGE_KEY = 'bushido_discipline_os_v1';
export const TOKEN_KEY = 'bushido_auth_token';
export const DEMO_CONSUMED_KEY = 'bushido_demo_consumed_v1';

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
let debounceTimer: NodeJS.Timeout | number | null = null;
let idleCallbackId: number | null = null;

const DEBOUNCE_DELAY_MS = 350;

/**
 * Directly writes state to localStorage safely
 */
function writeStateDirect(state: SystemState): boolean {
  try {
    return safeSetLocalStorage(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error('[Bushido Storage] Failed to save state to localStorage:', err);
    return false;
  }
}

/**
 * Flush any pending debounced writes immediately to disk.
 * Must be called before page unload or critical resets.
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
    writeStateDirect(pendingStateToSave);
    pendingStateToSave = null;
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
 * Asynchronously persists system state to localStorage with debouncing & requestIdleCallback
 * to completely eliminate main thread blocking and frame drops on rapid habit toggling.
 */
export function saveSystemStateDebounced(state: SystemState, delayMs: number = DEBOUNCE_DELAY_MS): void {
  pendingStateToSave = state;

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
            writeStateDirect(pendingStateToSave);
            pendingStateToSave = null;
          }
        },
        { timeout: 1000 }
      );
    } else {
      if (pendingStateToSave) {
        writeStateDirect(pendingStateToSave);
        pendingStateToSave = null;
      }
    }
  }, delayMs);
}

/**
 * Loads system state from localStorage with fallback and schema migration checks.
 * Correctly preserves empty cycles/logs arrays if the user deleted all data.
 */
export function loadStoredSystemState(): SystemState {
  const isDemoConsumed = safeGetLocalStorage(DEMO_CONSUMED_KEY) === 'true';
  const defaultFallback = isDemoConsumed ? createEmptySystemState() : createInitialSystemState();

  try {
    const saved = safeGetLocalStorage(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') {
        return defaultFallback;
      }

      // 1. User Profile Protection
      if (!parsed.userProfile || typeof parsed.userProfile !== 'object') {
        parsed.userProfile = defaultFallback.userProfile;
      }

      // 2. Cycles Array Protection (Strict Array.isArray check, preserving intentionally empty cycles only if demo consumed)
      if (!Array.isArray(parsed.cycles) || (!isDemoConsumed && parsed.cycles.length === 0)) {
        parsed.cycles = defaultFallback.cycles;
      } else {
        parsed.cycles = parsed.cycles
          .filter((c: any) => c && typeof c === 'object' && typeof c.id === 'string')
          .map((c: any) => ({
            ...c,
            isSynced: c.isSynced !== undefined ? c.isSynced : false
          }));
      }

      // 3. Logs Array Protection (Strict Array.isArray check, preserving intentionally empty logs only if demo consumed)
      if (!Array.isArray(parsed.logs) || (!isDemoConsumed && parsed.cycles.length > 0 && parsed.cycles[0].id === 'cycle-1' && parsed.logs.length === 0)) {
        parsed.logs = defaultFallback.logs;
      } else {
        parsed.logs = parsed.logs
          .filter((l: any) => l && typeof l === 'object' && typeof l.date === 'string')
          .map((l: any) => ({
            ...l,
            isSynced: l.isSynced !== undefined ? l.isSynced : false
          }));
      }

      // 4. Settings Protection
      if (!parsed.settings || typeof parsed.settings !== 'object') {
        parsed.settings = defaultFallback.settings;
      }

      return parsed as SystemState;
    }
  } catch (e) {
    console.warn('[Bushido Storage] Failed to load from localStorage, initializing fresh:', e);
  }
  return defaultFallback;
}
