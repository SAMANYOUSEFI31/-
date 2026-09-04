/**
 * Impersonation Lifecycle & Fail-Safe Exit Utilities
 *
 * Provides pure, deterministic decision logic and state transitions
 * for admin impersonation and fail-safe exit.
 */

import {
  TOKEN_KEY,
  safeGetLocalStorage,
  safeSetLocalStorage,
  safeRemoveLocalStorage,
  safeGetSessionStorage,
  safeSetSessionStorage,
  safeRemoveSessionStorage,
  transitionAccountState
} from './storageUtils';
import { toPersianDigits } from './numberUtils';
import type { SystemState, UserSubscriptionTier } from '../types';

export const IMPERSONATOR_TOKEN_KEY = 'bushido_impersonator_token';
export const IMPERSONATING_USER_KEY = 'bushido_impersonating_user';

export type ExitImpersonationResult =
  | {
      success: true;
      status: 'SUCCESS';
      adminUser: {
        id: string;
        name: string;
        email?: string | null;
        phoneNumber?: string | null;
        isVip: boolean;
        isAdmin: boolean;
        tier?: UserSubscriptionTier;
      };
      adminToken: string;
      messageFa: string;
    }
  | {
      success: false;
      status: 'AUTH_REVOKED';
      code: string;
      messageFa: string;
    }
  | {
      success: false;
      status: 'INVALID_ADMIN_IDENTITY';
      code: string;
      messageFa: string;
    }
  | {
      success: false;
      status: 'TEMPORARY_SERVER_ERROR';
      httpStatus: number;
      code: string;
      retryAfterSeconds?: number | null;
      messageFa: string;
    }
  | {
      success: false;
      status: 'NETWORK_ERROR';
      error: string;
      messageFa: string;
    }
  | {
      success: false;
      status: 'NO_ADMIN_TOKEN';
      messageFa: string;
    };

/**
 * Validates the stored admin token with /api/auth/me before any local exit state is altered.
 * Fail-safe order:
 * 1. Read token
 * 2. Validate with /api/auth/me
 * 3. Return explicit structured outcome:
 *    - SUCCESS: admin verified
 *    - AUTH_REVOKED: confirmed auth rejection (401, SESSION_REVOKED, INVALID_TOKEN, USER_NOT_FOUND)
 *    - INVALID_ADMIN_IDENTITY: valid account but lacks admin privileges
 *    - TEMPORARY_SERVER_ERROR: 429, 500, 502, 503, 504, 408 (preserves admin token & retryable)
 *    - NETWORK_ERROR: fetch exception or offline (preserves admin token & retryable)
 */
export async function validateAdminTokenForExit(
  adminToken: string | null | undefined,
  fetchFn: typeof fetch = fetch
): Promise<ExitImpersonationResult> {
  if (!adminToken || typeof adminToken !== 'string' || !adminToken.trim()) {
    return {
      success: false,
      status: 'NO_ADMIN_TOKEN',
      messageFa: 'توکن مدیر جهت بازگشت به حساب یافت نشد.'
    };
  }

  const cleanToken = adminToken.trim();

  try {
    const res = await fetchFn('/api/auth/me', {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cleanToken}`
      }
    });

    let data: any = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    // 1. Confirmed Authentication Rejection
    // Return AUTH_REVOKED only when authentication is actually rejected:
    // - HTTP 401
    // - SESSION_REVOKED
    // - INVALID_TOKEN
    // - USER_NOT_FOUND
    // - UNAUTHORIZED / EXPIRED_TOKEN
    const isConfirmedAuthInvalid =
      res.status === 401 ||
      data?.code === 'SESSION_REVOKED' ||
      data?.code === 'INVALID_TOKEN' ||
      data?.code === 'USER_NOT_FOUND' ||
      data?.code === 'UNAUTHORIZED' ||
      data?.code === 'EXPIRED_TOKEN';

    if (isConfirmedAuthInvalid) {
      return {
        success: false,
        status: 'AUTH_REVOKED',
        code: data?.code || 'SESSION_REVOKED',
        messageFa: data?.messageFa || 'نشست کاربری مدیریت منقضی شده است. لطفاً مجدداً وارد شوید.'
      };
    }

    // 2. HTTP 429 Rate Limiting (Temporary / Retryable Server Error)
    if (res.status === 429) {
      let retryAfterSeconds: number | null = null;
      try {
        const headerVal = res.headers?.get ? res.headers.get('Retry-After') : null;
        if (headerVal) {
          const parsed = parseInt(headerVal, 10);
          if (!isNaN(parsed) && parsed > 0) {
            retryAfterSeconds = parsed;
          }
        }
      } catch {}

      const messageFa = retryAfterSeconds
        ? `تعداد درخواست‌ها بیش از حد مجاز است. لطفاً پس از ${toPersianDigits(retryAfterSeconds)} ثانیه مجدداً تلاش نمایید.`
        : 'تعداد درخواست‌ها بیش از حد مجاز است. لطفاً لحظاتی بعد مجدداً تلاش نمایید.';

      return {
        success: false,
        status: 'TEMPORARY_SERVER_ERROR',
        httpStatus: 429,
        code: data?.code || 'RATE_LIMITED',
        retryAfterSeconds,
        messageFa
      };
    }

    // 3. HTTP 5xx or temporary / ambiguous non-ok server responses (500, 502, 503, 504, 408, etc.)
    if (!res.ok) {
      const isUnavailable = res.status === 503 || res.status === 504;
      return {
        success: false,
        status: 'TEMPORARY_SERVER_ERROR',
        httpStatus: res.status,
        code: data?.code || `HTTP_${res.status}`,
        retryAfterSeconds: null,
        messageFa: isUnavailable
          ? 'سرویس مدیریت موقتاً در دسترس نیست. لطفاً چند لحظه بعد مجدداً تلاش نمایید.'
          : 'سرور موقتاً پاسخگو نیست. لطفاً چند لحظه بعد مجدداً تلاش نمایید.'
      };
    }

    // 4. HTTP OK (200): Check Admin authority
    const user = data?.user;
    if (!user || !user.id || !user.isAdmin) {
      return {
        success: false,
        status: 'INVALID_ADMIN_IDENTITY',
        code: 'NOT_AN_ADMIN',
        messageFa: 'حساب بازگردانی‌شده فاقد سطح دسترسی مدیریت است.'
      };
    }

    // 5. Success
    return {
      success: true,
      status: 'SUCCESS',
      adminUser: {
        id: user.id,
        name: user.name || 'مدیر سامانه',
        email: user.email || null,
        phoneNumber: user.phoneNumber || null,
        isVip: Boolean(user.isVip),
        isAdmin: true,
        tier: user.tier || 'vip_samurai'
      },
      adminToken: cleanToken,
      messageFa: 'به حساب مدیریت بازگشتید.'
    };
  } catch (err: any) {
    // 6. Network failure or fetch exception: do not clear tokens prematurely
    return {
      success: false,
      status: 'NETWORK_ERROR',
      error: err?.message || 'Network error',
      messageFa: 'خطا در برقراری ارتباط با سرور. لطفاً اتصال اینترنت خود را بررسی کرده و مجدداً تلاش نمایید.'
    };
  }
}

/**
 * Pure state transition for successful exit from impersonation.
 */
export function buildExitImpersonationSuccessState(
  currentSystemState: SystemState,
  adminUser: {
    id: string;
    name: string;
    email?: string | null;
    phoneNumber?: string | null;
    isVip: boolean;
    isAdmin: boolean;
    tier?: UserSubscriptionTier;
  }
) {
  return transitionAccountState({
    currentSystemState,
    targetUserId: adminUser.id,
    targetUserProfile: adminUser
  });
}

/**
 * Pure state transition for failed exit (token revoked or invalid admin identity).
 * Clears unsafe auth and impersonation state and returns signed-out state.
 */
export function buildExitImpersonationRevokedState(currentSystemState: SystemState) {
  return transitionAccountState({
    currentSystemState,
    targetUserId: null
  });
}

/**
 * Pure helper for logout while impersonating:
 * returns signed-out state transition and clears all storage keys.
 */
export function executeLogoutDuringImpersonation(
  currentSystemState: SystemState,
  storageDriver?: {
    removeLocal: (key: string) => void;
    removeSession: (key: string) => void;
    setSession: (key: string, val: string) => void;
  }
) {
  const removeLocal = storageDriver?.removeLocal ?? safeRemoveLocalStorage;
  const removeSession = storageDriver?.removeSession ?? safeRemoveSessionStorage;
  const setSession = storageDriver?.setSession ?? safeSetSessionStorage;

  removeLocal(TOKEN_KEY);
  removeSession(IMPERSONATOR_TOKEN_KEY);
  removeSession(IMPERSONATING_USER_KEY);
  setSession('bushido_explicit_logout', 'true');

  return transitionAccountState({
    currentSystemState,
    targetUserId: null
  });
}

/**
 * Pure helper for checking state after page reload during impersonation.
 */
export function resolveImpersonationStateOnBoot(
  storageDriver?: {
    getLocal: (key: string) => string | null;
    getSession: (key: string) => string | null;
  }
): {
  isImpersonating: boolean;
  activeToken: string | null;
  impersonatorAdminToken: string | null;
  impersonatingUser: any | null;
} {
  const getLocal = storageDriver?.getLocal ?? safeGetLocalStorage;
  const getSession = storageDriver?.getSession ?? safeGetSessionStorage;

  const activeToken = getLocal(TOKEN_KEY);
  const impersonatorAdminToken = getSession(IMPERSONATOR_TOKEN_KEY);
  const rawUser = getSession(IMPERSONATING_USER_KEY);

  let impersonatingUser: any = null;
  if (rawUser) {
    try {
      impersonatingUser = JSON.parse(rawUser);
    } catch {
      impersonatingUser = null;
    }
  }

  const isImpersonating = Boolean(impersonatorAdminToken && impersonatingUser);

  return {
    isImpersonating,
    activeToken,
    impersonatorAdminToken,
    impersonatingUser
  };
}

export interface ImpersonationStorageDriver {
  setLocal?: (key: string, val: string) => void;
  removeLocal?: (key: string) => void;
  setSession?: (key: string, val: string) => void;
  removeSession?: (key: string) => void;
}

export interface ProcessExitOutcomeResult {
  action: 'SUCCESS_TRANSITION' | 'REVOKED_SIGN_OUT' | 'PRESERVE_RETRYABLE' | 'NO_OP';
  nextSystemState?: SystemState;
  nextActiveCycleId?: string | null;
  newAuthToken?: string | null;
  openAuthModal?: boolean;
  messageFa: string;
  isSuccess: boolean;
}

/**
 * Pure dispatcher for exit impersonation outcome:
 * - SUCCESS: updates localStorage with admin token, purges impersonator metadata, transitions system state to Admin.
 * - AUTH_REVOKED / INVALID_ADMIN_IDENTITY: removes tokens, clears impersonation metadata, marks explicit logout, transitions to signed out.
 * - TEMPORARY_SERVER_ERROR / NETWORK_ERROR: strictly PRESERVES tokens & metadata, does not change account, returns retryable message.
 * - NO_ADMIN_TOKEN: no-op with warning.
 */
export function processExitImpersonationOutcome(
  outcome: ExitImpersonationResult,
  currentSystemState: SystemState,
  storageDriver?: ImpersonationStorageDriver
): ProcessExitOutcomeResult {
  const setLocal = storageDriver?.setLocal ?? safeSetLocalStorage;
  const removeLocal = storageDriver?.removeLocal ?? safeRemoveLocalStorage;
  const setSession = storageDriver?.setSession ?? safeSetSessionStorage;
  const removeSession = storageDriver?.removeSession ?? safeRemoveSessionStorage;

  if (outcome.status === 'SUCCESS') {
    setLocal(TOKEN_KEY, outcome.adminToken);
    removeSession(IMPERSONATOR_TOKEN_KEY);
    removeSession(IMPERSONATING_USER_KEY);

    const transition = buildExitImpersonationSuccessState(currentSystemState, outcome.adminUser);
    return {
      action: 'SUCCESS_TRANSITION',
      nextSystemState: transition.nextState,
      nextActiveCycleId: transition.nextActiveCycleId,
      newAuthToken: outcome.adminToken,
      openAuthModal: false,
      messageFa: outcome.messageFa,
      isSuccess: true
    };
  }

  if (outcome.status === 'AUTH_REVOKED' || outcome.status === 'INVALID_ADMIN_IDENTITY') {
    removeLocal(TOKEN_KEY);
    removeSession(IMPERSONATOR_TOKEN_KEY);
    removeSession(IMPERSONATING_USER_KEY);
    setSession('bushido_explicit_logout', 'true');

    const transition = buildExitImpersonationRevokedState(currentSystemState);
    return {
      action: 'REVOKED_SIGN_OUT',
      nextSystemState: transition.nextState,
      nextActiveCycleId: transition.nextActiveCycleId,
      newAuthToken: null,
      openAuthModal: true,
      messageFa: outcome.messageFa,
      isSuccess: false
    };
  }

  if (outcome.status === 'TEMPORARY_SERVER_ERROR' || outcome.status === 'NETWORK_ERROR') {
    // Fail-safe requirement: do not clear the saved Admin token,
    // do not clear impersonation metadata, do not change the active account,
    // and do not report exit success.
    return {
      action: 'PRESERVE_RETRYABLE',
      messageFa: outcome.messageFa,
      isSuccess: false
    };
  }

  return {
    action: 'NO_OP',
    messageFa: outcome.messageFa,
    isSuccess: false
  };
}
