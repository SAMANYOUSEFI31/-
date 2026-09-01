import { SystemState } from '../types';
import { createInitialSystemState } from '../data/initialData';

export const STORAGE_KEY = 'bushido_discipline_os_v1';
export const TOKEN_KEY = 'bushido_auth_token';

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
  const initial = createInitialSystemState();
  try {
    const saved = safeGetLocalStorage(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (!parsed || typeof parsed !== 'object') {
        return initial;
      }

      // 1. User Profile Protection
      if (!parsed.userProfile || typeof parsed.userProfile !== 'object') {
        parsed.userProfile = initial.userProfile;
      }

      // 2. Cycles Array Protection (Strict Array.isArray check, preserving intentionally empty cycles)
      if (!Array.isArray(parsed.cycles)) {
        parsed.cycles = initial.cycles;
      } else {
        parsed.cycles = parsed.cycles
          .filter((c: any) => c && typeof c === 'object' && typeof c.id === 'string')
          .map((c: any) => ({
            ...c,
            isSynced: c.isSynced !== undefined ? c.isSynced : false
          }));
      }

      // 3. Logs Array Protection (Strict Array.isArray check, preserving intentionally empty logs)
      if (!Array.isArray(parsed.logs)) {
        parsed.logs = initial.logs;
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
        parsed.settings = initial.settings;
      }

      return parsed as SystemState;
    }
  } catch (e) {
    console.warn('[Bushido Storage] Failed to load from localStorage, initializing fresh:', e);
  }
  return initial;
}
