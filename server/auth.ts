import { Request, Response, NextFunction } from 'express';
import { findUserById } from './db';
import {
  generateToken,
  verifyToken,
  isSuperAdminIdentifier,
  hashPassword,
  verifyPassword,
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  SUPER_ADMIN_NAME,
  JWT_SECRET,
  allowTestShortcuts,
  parseStrictBoolean,
  isProduction,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities,
  type SecurityCapabilities
} from './security';

export {
  generateToken,
  verifyToken,
  isSuperAdminIdentifier,
  hashPassword,
  verifyPassword,
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS,
  SUPER_ADMIN_NAME,
  JWT_SECRET,
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

export interface AuthUserPayload {
  userId: string;
  email?: string | null;
  phoneNumber?: string | null;
  isVip: boolean;
  tier: string;
  isAdmin?: boolean;
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

    const isMaster =
      isSuperAdminIdentifier(user.phoneNumber) || isSuperAdminIdentifier(user.email);

    req.user = {
      userId: user.id,
      email: user.email,
      phoneNumber: user.phoneNumber,
      isVip: isMaster ? true : user.isVip,
      tier: isMaster ? 'vip_samurai' : user.tier,
      isAdmin: isMaster ? true : Boolean(user.isAdmin)
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

    const user = await findUserById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        code: 'USER_NOT_FOUND',
        messageFa: 'حساب کاربری یافت نشد.'
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
      isAdmin: true
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
            isAdmin: isMaster ? true : Boolean(user.isAdmin)
          };
        }
      }
    }
  } catch {
    // optional
  }
  next();
}
