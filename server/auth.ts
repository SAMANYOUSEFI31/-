import { Request, Response, NextFunction } from 'express';
import { findUserById } from './db';
import { logImpersonationAudit } from './audit';
import {
  generateToken,
  verifyToken,
  getJwtSecret,
  getAppEnv,
  type AppEnvironment,
  isSuperAdminIdentifier,
  getSuperAdminIdentifier,
  getSuperAdminPhone,
  getSuperAdminEmail,
  getSuperAdminPass,
  getSuperAdminName,
  hashPassword,
  verifyPassword,
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  SUPER_ADMIN_NAME,
  allowTestShortcuts,
  parseStrictBoolean,
  isProduction,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities,
  DUMMY_PASSWORD_HASH,
  type SecurityCapabilities
} from './security';

export {
  generateToken,
  verifyToken,
  getJwtSecret,
  getAppEnv,
  type AppEnvironment,
  isSuperAdminIdentifier,
  getSuperAdminIdentifier,
  getSuperAdminPhone,
  getSuperAdminEmail,
  getSuperAdminPass,
  getSuperAdminName,
  hashPassword,
  verifyPassword,
  DUMMY_PASSWORD_HASH,
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  SUPER_ADMIN_NAME,
  allowTestShortcuts,
  parseStrictBoolean,
  isProduction,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities,
  type SecurityCapabilities
};

export * from './utils/phone';
export * from './sms';
export * from './otp';

export interface AuthUserPayload {
  userId: string;
  email?: string | null;
  phoneNumber?: string | null;
  isVip: boolean;
  tier: string;
  isAdmin?: boolean;
  isSuperAdmin?: boolean;
  tokenVersion?: number;
  isImpersonated?: boolean;
  impersonatedBy?: string | null;
}

export interface AuthenticatedRequest extends Request {
  user?: AuthUserPayload;
}

export async function authMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        messageFa: 'نشست کاربری نامعتبر است. لطفاً مجدداً وارد شوید.'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken<AuthUserPayload & { exp?: number }>(token);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        messageFa: 'توکن نامعتبر یا منقضی شده است.'
      });
    }

    const user = await findUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'کاربر در دیتابیس یافت نشد.'
      });
    }

    // GAP 6: Server-Authoritative Session Invalidation
    const userVersion = user.tokenVersion ?? 0;
    const tokenVersion = decoded.tokenVersion ?? 0;
    if (tokenVersion < userVersion) {
      return res.status(401).json({
        code: 'SESSION_REVOKED',
        messageFa: 'نشست کاربری شما به دلیل تغییر رمز عبور منقضی شده است. لطفاً مجدداً وارد شوید.'
      });
    }

    const isMaster =
      isSuperAdminIdentifier(user.phoneNumber) || isSuperAdminIdentifier(user.email);

    req.user = {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: isMaster ? true : user.isVip,
      tier: isMaster ? 'vip_samurai' : user.tier,
      isAdmin: isMaster ? true : Boolean(user.isAdmin),
      isSuperAdmin: isMaster,
      tokenVersion: user.tokenVersion ?? 0,
      isImpersonated: Boolean(decoded.isImpersonated),
      impersonatedBy: decoded.impersonatedBy || null
    };

    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    res.status(401).json({
      code: 'AUTH_ERROR',
      messageFa: 'احراز هویت با خطا مواجه شد.'
    });
  }
}

export async function adminMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        messageFa: 'دسترسی غیرمجاز: ابتدا وارد شوید.'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken<AuthUserPayload>(token);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        messageFa: 'توکن نامعتبر یا منقضی شده است.'
      });
    }

    // Defense in Depth: Reject ANY token where isImpersonated === true
    if (decoded.isImpersonated) {
      logImpersonationAudit({
        eventType: 'impersonation_denied',
        impersonatorAdminId: decoded.impersonatedBy || null,
        targetUserId: decoded.userId,
        result: 'failure',
        errorCode: 'IMPERSONATION_ACCESS_FORBIDDEN'
      });
      return res.status(403).json({
        code: 'IMPERSONATION_ACCESS_FORBIDDEN',
        messageFa: 'دسترسی به بخش مدیریت در حالت شبیه‌سازی اکیداً ممنوع است.'
      });
    }

    const user = await findUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'حساب کاربری یافت نشد.'
      });
    }

    const userVersion = user.tokenVersion ?? 0;
    const tokenVersion = decoded.tokenVersion ?? 0;
    if (tokenVersion < userVersion) {
      return res.status(401).json({
        code: 'SESSION_REVOKED',
        messageFa: 'نشست کاربری منقضی شده است. لطفاً مجدداً وارد شوید.'
      });
    }

    const isMaster =
      isSuperAdminIdentifier(user.phoneNumber) || isSuperAdminIdentifier(user.email);

    if (!user.isAdmin && !isMaster) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        messageFa: 'دسترسی فقط برای مدیران بوشیدو مجاز است.'
      });
    }

    req.user = {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: true,
      tier: 'vip_samurai',
      isAdmin: true,
      isSuperAdmin: isMaster,
      tokenVersion: user.tokenVersion ?? 0,
      isImpersonated: Boolean(decoded.isImpersonated),
      impersonatedBy: decoded.impersonatedBy || null
    };

    next();
  } catch (err) {
    console.error('Admin middleware error:', err);
    res.status(401).json({
      code: 'AUTH_ERROR',
      messageFa: 'احراز هویت مدیر با خطا مواجه شد.'
    });
  }
}

/**
 * Super Admin Middleware: Strictly reserved for the Master Commander (Super Admin).
 * Regular Admins will receive 403 SUPER_ADMIN_REQUIRED.
 */
export async function superAdminMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        code: 'UNAUTHORIZED',
        messageFa: 'دسترسی غیرمجاز: ابتدا وارد شوید.'
      });
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyToken<AuthUserPayload>(token);
    if (!decoded || !decoded.userId) {
      return res.status(401).json({
        code: 'INVALID_TOKEN',
        messageFa: 'توکن نامعتبر یا منقضی شده است.'
      });
    }

    if (decoded.isImpersonated) {
      return res.status(403).json({
        code: 'IMPERSONATION_ACCESS_FORBIDDEN',
        messageFa: 'عملیات فرماندهی کل در حالت شبیه‌سازی مجاز نمی‌باشد.'
      });
    }

    const user = await findUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'حساب کاربری یافت نشد.'
      });
    }

    const userVersion = user.tokenVersion ?? 0;
    const tokenVersion = decoded.tokenVersion ?? 0;
    if (tokenVersion < userVersion) {
      return res.status(401).json({
        code: 'SESSION_REVOKED',
        messageFa: 'نشست کاربری منقضی شده است. لطفاً مجدداً وارد شوید.'
      });
    }

    const isMaster =
      isSuperAdminIdentifier(user.phoneNumber) || isSuperAdminIdentifier(user.email);

    if (!isMaster) {
      return res.status(403).json({
        code: 'SUPER_ADMIN_REQUIRED',
        messageFa: 'این عملیات فوق‌امنیتی منحصراً در صلاحیت سوپر ادمین (فرمانده کل بوشیدو) می‌باشد.'
      });
    }

    req.user = {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: true,
      tier: 'vip_samurai',
      isAdmin: true,
      isSuperAdmin: true,
      tokenVersion: user.tokenVersion ?? 0,
      isImpersonated: false,
      impersonatedBy: null
    };

    next();
  } catch (err) {
    console.error('Super Admin middleware error:', err);
    res.status(401).json({
      code: 'AUTH_ERROR',
      messageFa: 'احراز هویت سوپر ادمین با خطا مواجه شد.'
    });
  }
}

export async function optionalAuthMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = verifyToken<AuthUserPayload>(token);
      if (decoded?.userId) {
        const user = await findUserById(decoded.userId);
        if (user) {
          const isMaster =
            isSuperAdminIdentifier(user.phoneNumber) ||
            isSuperAdminIdentifier(user.email);
          req.user = {
            userId: user.id,
            email: user.email,
            phoneNumber: user.phoneNumber,
            isVip: isMaster ? true : user.isVip,
            tier: isMaster ? 'vip_samurai' : user.tier,
            isAdmin: isMaster ? true : Boolean(user.isAdmin),
            tokenVersion: user.tokenVersion ?? 0,
            isImpersonated: Boolean(decoded.isImpersonated),
            impersonatedBy: decoded.impersonatedBy || null
          };
        }
      }
    }
  } catch {
    // optional
  }
  next();
}
