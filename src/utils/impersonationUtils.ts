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
 * 3. Return explicit structured outcome
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

    if (
      res.status === 401 ||
      data?.code === 'SESSION_REVOKED' ||
      data?.code === 'INVALID_TOKEN' ||
      data?.code === 'USER_NOT_FOUND'
    ) {
      return {
        success: false,
        status: 'AUTH_REVOKED',
        code: data?.code || 'SESSION_REVOKED',
        messageFa: data?.messageFa || 'نشست کاربری مدیریت منقضی شده است. لطفاً مجدداً وارد شوید.'
      };
    }

    if (!res.ok) {
      return {
        success: false,
        status: 'AUTH_REVOKED',
        code: data?.code || `HTTP_${res.status}`,
        messageFa: data?.messageFa || 'احراز هویت حساب مدیریت با خطا مواجه شد.'
      };
    }

    const user = data?.user;
    if (!user || !user.id || !user.isAdmin) {
      return {
        success: false,
        status: 'INVALID_ADMIN_IDENTITY',
        code: 'NOT_AN_ADMIN',
        messageFa: 'حساب بازگردانی‌شده فاقد سطح دسترسی مدیریت است.'
      };
    }

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
    // Temporary network failure: do not clear tokens prematurely
    return {
      success: false,
      status: 'NETWORK_ERROR',
      error: err?.message || 'Network error',
      messageFa: 'خطا در برقراری ارتباط با سرور. لطفاً مجدداً تلاش نمایید.'
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
