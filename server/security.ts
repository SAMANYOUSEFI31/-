import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * تبدیل خودکار اعداد فارسی و عربی به اعداد انگلیسی استاندارد
 */
export function toEnglishDigits(str: string = ''): string {
  return str
    .replace(/[۰-۹]/g, (d) => (d.charCodeAt(0) - 1776).toString())
    .replace(/[٠-٩]/g, (d) => (d.charCodeAt(0) - 1632).toString());
}

/**
 * تجزیه سخت‌گیرانه مقادیر بولی از متغیرهای محیطی
 * فقط رشته نرمال‌شده "true" مقدار true برمی‌گرداند؛
 * مقادیر خالی، false، 1، yes، یا ناامن مقدار false خواهند بود.
 */
export function parseStrictBoolean(val?: string | null): boolean {
  if (!val || typeof val !== 'string') return false;
  return val.trim().toLowerCase() === 'true';
}

/**
 * ساختار انواع محیط‌های اجرایی برنامه
 */
export type AppEnvironment = 'development' | 'test' | 'staging' | 'production' | 'invalid';

/**
 * تعیین محیط منطقی برنامه بر اساس متغیرهای APP_ENV و NODE_ENV
 * قانون ارزیابی:
 * ۱. اگر APP_ENV معتبر باشد، مقدار آن اعمال می‌شود.
 * ۲. اگر APP_ENV غایب باشد:
 *    - NODE_ENV=test -> test
 *    - NODE_ENV=development -> development
 *    - NODE_ENV=production -> production
 *    - هر مقدار نامعتبر یا غایب دیگر در NODE_ENV -> development
 * ۳. اگر APP_ENV مقدار نامعتبر داشته باشد -> invalid (Fail Closed)
 */
export function getAppEnvironment(): AppEnvironment {
  const appEnvRaw = process.env.APP_ENV;
  if (appEnvRaw !== undefined) {
    const clean = appEnvRaw.trim().toLowerCase();
    if (clean === 'development' || clean === 'test' || clean === 'staging' || clean === 'production') {
      return clean;
    }
    return 'invalid';
  }

  const nodeEnv = (process.env.NODE_ENV || '').trim().toLowerCase();
  if (nodeEnv === 'test') return 'test';
  if (nodeEnv === 'development') return 'development';
  if (nodeEnv === 'production') return 'production';
  return 'development';
}

/** بررسی اینکه آیا محیط فعلی پروداکشن عمومی است */
export function isPublicProduction(): boolean {
  return getAppEnvironment() === 'production';
}

/** بررسی اینکه آیا محیط فعلی استیجینگ است */
export function isStaging(): boolean {
  return getAppEnvironment() === 'staging';
}

/** بررسی اینکه آیا محیط زمان‌اجرای نود/ویت پروداکشن است (جهت مدیریت فایل‌های استاتیک) */
export function isProduction(): boolean {
  return (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * حالت تست و میانبرها:
 * - در پروداکشن عمومی و محیط‌های نامعتبر: همیشه غیرفعال (false) - متغیر ALLOW_TEST_SHORTCUTS هیچ تاثیری ندارد.
 * - در استیجینگ: صرفاً با ALLOW_TEST_SHORTCUTS=true فعال می‌گردد.
 * - در توسعه و تست: به‌طور پیش‌فرض فعال است.
 */
export function allowTestShortcuts(): boolean {
  const env = getAppEnvironment();
  if (env === 'production' || env === 'invalid') {
    return false;
  }
  if (env === 'staging') {
    return parseStrictBoolean(process.env.ALLOW_TEST_SHORTCUTS);
  }
  return true;
}

/** بررسی فعال بودن قابلیت ورود سریع */
export function isQuickLoginEnabled(): boolean {
  const env = getAppEnvironment();
  if (env === 'production' || env === 'invalid') {
    return false;
  }
  if (!allowTestShortcuts()) {
    return false;
  }
  if (process.env.ENABLE_QUICK_LOGIN !== undefined) {
    return parseStrictBoolean(process.env.ENABLE_QUICK_LOGIN);
  }
  return true;
}

/** بررسی فعال بودن حالت دیباگ OTP */
export function isOtpDebugEnabled(): boolean {
  const env = getAppEnvironment();
  if (env === 'production' || env === 'invalid') {
    return false;
  }
  if (!allowTestShortcuts()) {
    return false;
  }
  return parseStrictBoolean(process.env.ENABLE_OTP_DEBUG);
}

/** بررسی فعال بودن OTP شبیه‌سازی‌شده (بدون درگاه پیامکی زنده) */
export function isMockOtpEnabled(): boolean {
  const env = getAppEnvironment();
  if (env === 'production' || env === 'invalid') {
    return false;
  }
  return allowTestShortcuts();
}

/** بررسی فعال بودن پرداخت شبیه‌سازی‌شده (بدون درگاه زرین‌پال زنده) */
export function isMockPaymentEnabled(): boolean {
  const env = getAppEnvironment();
  if (env === 'production' || env === 'invalid') {
    return false;
  }
  return allowTestShortcuts();
}

/** ساختار جامع قابلیت‌های امنیتی و محیطی سرور */
export interface SecurityCapabilities {
  appEnvironment: AppEnvironment;
  isProduction: boolean;
  isPublicProduction: boolean;
  testShortcutsEnabled: boolean;
  quickLoginEnabled: boolean;
  otpDebugEnabled: boolean;
  mockOtpEnabled: boolean;
  mockPaymentEnabled: boolean;
}

/** دریافت وضعیت متمرکز تمامی قابلیت‌های امنیتی */
export function getSecurityCapabilities(): SecurityCapabilities {
  return {
    appEnvironment: getAppEnvironment(),
    isProduction: isProduction(),
    isPublicProduction: isPublicProduction(),
    testShortcutsEnabled: allowTestShortcuts(),
    quickLoginEnabled: isQuickLoginEnabled(),
    otpDebugEnabled: isOtpDebugEnabled(),
    mockOtpEnabled: isMockOtpEnabled(),
    mockPaymentEnabled: isMockPaymentEnabled()
  };
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  const env = getAppEnvironment();

  if (env === 'production') {
    if (!secret) {
      throw new Error('FATAL: JWT_SECRET is required in production.');
    }
    if (secret.length < 32) {
      throw new Error('FATAL: JWT_SECRET must be at least 32 characters in production.');
    }
    return secret;
  }

  if (env === 'staging') {
    if (!secret) {
      throw new Error('FATAL: JWT_SECRET is required in staging.');
    }
    if (secret.length < 32) {
      throw new Error('FATAL: JWT_SECRET must be at least 32 characters in staging.');
    }
    return secret;
  }

  if (env === 'invalid') {
    if (!secret) {
      throw new Error('FATAL: Invalid APP_ENV configuration and JWT_SECRET is missing.');
    }
    if (secret.length < 32) {
      throw new Error('FATAL: JWT_SECRET must be at least 32 characters.');
    }
    return secret;
  }

  // Development and test
  if (!secret) {
    return 'dev-fallback-insecure-secret-key-change-in-production-32b';
  }
  return secret;
}

export function getSuperAdminIdentifier(): string {
  const env = getAppEnvironment();
  const isDevOrTest = env === 'development' || env === 'test';
  return (
    process.env.SUPER_ADMIN_IDENTIFIER ||
    process.env.ADMIN_PHONE ||
    process.env.ADMIN_USERNAME ||
    process.env.SUPER_ADMIN_PHONE ||
    process.env.SUPER_ADMIN_EMAIL ||
    (isDevOrTest ? 'admin' : '')
  );
}

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
const SALT_BYTE_SIZE = 16;

/** Dummy PBKDF2 hash used to mitigate timing-based user enumeration when a user account does not exist */
export const DUMMY_PASSWORD_HASH =
  '0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** هش رمز — خروجی: salt:hash */
export function hashPassword(password: string): string {
  if (!password || typeof password !== 'string') {
    throw new Error('Password must be a non-empty string.');
  }
  const salt = crypto.randomBytes(SALT_BYTE_SIZE).toString('hex');
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
  return `${salt}:${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash?: string | null): boolean {
  if (!password || !storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, originalHashHex] = parts;
  if (!salt || !originalHashHex) return false;
  try {
    const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, PBKDF2_KEYLEN, PBKDF2_DIGEST);
    const a = Buffer.from(derived.toString('hex'), 'utf8');
    const b = Buffer.from(originalHashHex, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function generateToken(payload: Record<string, any>, expiresIn: string | number = '7d'): string {
  const secret = getJwtSecret();
  return jwt.sign(payload, secret, { expiresIn: expiresIn as jwt.SignOptions['expiresIn'] });
}

export function verifyToken<T = any>(token: string): T | null {
  if (!token || typeof token !== 'string') return null;
  try {
    return jwt.verify(token, getJwtSecret()) as T;
  } catch {
    return null;
  }
}

export function isSuperAdminIdentifier(identifier?: string | null): boolean {
  if (!identifier || typeof identifier !== 'string') return false;
  const target = getSuperAdminIdentifier();
  if (!target) return false;

  // تبدیل ورودی و مقدار هدف به اعداد انگلیسی و متن یکسان
  const cleanInput = toEnglishDigits(identifier).trim().toLowerCase();
  const cleanTarget = toEnglishDigits(target).trim().toLowerCase();

  const a = Buffer.from(cleanInput, 'utf8');
  const b = Buffer.from(cleanTarget, 'utf8');

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const SUPER_ADMIN_PHONE =
  process.env.SUPER_ADMIN_PHONE ||
  ((getAppEnvironment() === 'development' || getAppEnvironment() === 'test') ? '09120000000' : '');
export const SUPER_ADMIN_EMAIL =
  process.env.SUPER_ADMIN_EMAIL ||
  ((getAppEnvironment() === 'development' || getAppEnvironment() === 'test') ? 'admin@bushido.local' : '');
export const SUPER_ADMIN_PASS =
  process.env.SUPER_ADMIN_PASS ||
  ((getAppEnvironment() === 'development' || getAppEnvironment() === 'test') ? 'AdminPass123!' : '');
export const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'فرمانده ارشد سامورایی';


