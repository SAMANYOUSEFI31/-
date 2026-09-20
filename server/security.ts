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

export type AppEnvironment = 'development' | 'test' | 'staging' | 'production';

/**
 * Resolves the current application environment with fail-closed semantics.
 * Priority:
 * 1. APP_ENV (if provided). Valid values: 'development' | 'test' | 'staging' | 'production'.
 *    Any invalid/unknown value fails closed to 'production'.
 * 2. If APP_ENV is unset, falls back to NODE_ENV compatibility:
 *    - 'production' -> 'production'
 *    - 'staging' -> 'staging'
 *    - 'test' -> 'test'
 *    - 'development' -> 'development'
 *    - empty/unset -> 'development'
 *    - any invalid/unknown value -> fails closed to 'production'.
 */
export function getAppEnv(): AppEnvironment {
  if (process.env.APP_ENV !== undefined) {
    const rawAppEnv = process.env.APP_ENV.trim().toLowerCase();
    if (rawAppEnv === 'production') return 'production';
    if (rawAppEnv === 'staging') return 'staging';
    if (rawAppEnv === 'test') return 'test';
    if (rawAppEnv === 'development') return 'development';
    return 'production'; // Invalid APP_ENV fails closed to production
  }

  if (process.env.NODE_ENV !== undefined) {
    const rawNodeEnv = process.env.NODE_ENV.trim().toLowerCase();
    if (rawNodeEnv === 'production') return 'production';
    if (rawNodeEnv === 'staging') return 'staging';
    if (rawNodeEnv === 'test') return 'test';
    if (rawNodeEnv === 'development') return 'development';
    return 'production'; // Invalid NODE_ENV fails closed to production
  }

  return 'production';
}

/** بررسی اینکه آیا محیط فعلی پروداکشن است */
export function isProduction(): boolean {
  return getAppEnv() === 'production';
}

/**
 * حالت تست و میانبرها:
 * در محیط پروداکشن همیشه غیرفعال است (Fail-Closed). هیچ متغیری نمی‌تواند آن را در پروداکشن فعال کند.
 * در محیط استیجینگ صرفاً با ALLOW_TEST_SHORTCUTS=true فعال می‌گردد.
 * در محیط‌های توسعه و تست به‌طور پیش‌فرض فعال است مگر اینکه به صراحت غیرفعال شده باشد.
 */
export function allowTestShortcuts(): boolean {
  const env = getAppEnv();
  if (env === 'production') {
    return false;
  }
  if (env === 'staging') {
    return parseStrictBoolean(process.env.ALLOW_TEST_SHORTCUTS);
  }
  if (process.env.ALLOW_TEST_SHORTCUTS !== undefined) {
    return parseStrictBoolean(process.env.ALLOW_TEST_SHORTCUTS);
  }
  return true;
}

/** بررسی فعال بودن قابلیت ورود سریع */
export function isQuickLoginEnabled(): boolean {
  if (isProduction()) return false;
  if (!allowTestShortcuts()) return false;
  if (process.env.ENABLE_QUICK_LOGIN !== undefined) {
    return parseStrictBoolean(process.env.ENABLE_QUICK_LOGIN);
  }
  return true;
}

/** بررسی فعال بودن حالت دیباگ OTP */
export function isOtpDebugEnabled(): boolean {
  if (isProduction()) return false;
  if (!allowTestShortcuts()) return false;
  return parseStrictBoolean(process.env.ENABLE_OTP_DEBUG);
}

/** بررسی فعال بودن OTP شبیه‌سازی‌شده (بدون درگاه پیامکی زنده) */
export function isMockOtpEnabled(): boolean {
  if (isProduction()) return false;
  return allowTestShortcuts();
}

/** بررسی فعال بودن پرداخت شبیه‌سازی‌شده (بدون درگاه زرین‌پال زنده) */
export function isMockPaymentEnabled(): boolean {
  if (isProduction()) return false;
  return allowTestShortcuts();
}

/** ساختار جامع قابلیت‌های امنیتی و محیطی سرور */
export interface SecurityCapabilities {
  appEnv: AppEnvironment;
  isProduction: boolean;
  testShortcutsEnabled: boolean;
  quickLoginEnabled: boolean;
  otpDebugEnabled: boolean;
  mockOtpEnabled: boolean;
  mockPaymentEnabled: boolean;
}

/** دریافت وضعیت متمرکز تمامی قابلیت‌های امنیتی */
export function getSecurityCapabilities(): SecurityCapabilities {
  return {
    appEnv: getAppEnv(),
    isProduction: isProduction(),
    testShortcutsEnabled: allowTestShortcuts(),
    quickLoginEnabled: isQuickLoginEnabled(),
    otpDebugEnabled: isOtpDebugEnabled(),
    mockOtpEnabled: isMockOtpEnabled(),
    mockPaymentEnabled: isMockPaymentEnabled()
  };
}

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  const prod = isProduction();

  if (!secret) {
    if (prod) {
      throw new Error('FATAL: JWT_SECRET is required in production.');
    }
    return 'dev-fallback-insecure-secret-key-change-in-production-32b';
  }
  if (prod && secret.length < 32) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters.');
  }
  return secret;
}

export function getSuperAdminIdentifier(): string {
  const configured =
    process.env.SUPER_ADMIN_IDENTIFIER?.trim() ||
    process.env.ADMIN_PHONE?.trim() ||
    process.env.ADMIN_USERNAME?.trim() ||
    process.env.SUPER_ADMIN_PHONE?.trim() ||
    process.env.SUPER_ADMIN_EMAIL?.trim();

  if (configured) return configured;
  if (isProduction()) return '';
  return allowTestShortcuts() ? 'admin' : '';
}

export function getSuperAdminPhone(): string {
  const phone = process.env.SUPER_ADMIN_PHONE?.trim();
  if (phone) return phone;
  if (isProduction()) return '';
  return allowTestShortcuts() ? '09120000000' : '';
}

export function getSuperAdminEmail(): string {
  const email = process.env.SUPER_ADMIN_EMAIL?.trim();
  if (email) return email;
  if (isProduction()) return '';
  return allowTestShortcuts() ? 'admin@bushido.local' : '';
}

export function getSuperAdminPass(): string {
  const pass = process.env.SUPER_ADMIN_PASS;
  if (pass) return pass;
  if (isProduction()) return '';
  return allowTestShortcuts() ? 'AdminPass123!' : '';
}

export function getSuperAdminName(): string {
  return process.env.SUPER_ADMIN_NAME?.trim() || 'فرمانده ارشد سامورایی';
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
  const cleanInput = toEnglishDigits(identifier).trim().toLowerCase();
  if (!cleanInput) return false;

  const inputBuf = Buffer.from(cleanInput, 'utf8');

  const targets: string[] = [];
  const primary = getSuperAdminIdentifier();
  if (primary) targets.push(primary);
  const phone = getSuperAdminPhone();
  if (phone && !targets.includes(phone)) targets.push(phone);
  const email = getSuperAdminEmail();
  if (email && !targets.includes(email)) targets.push(email);

  for (const target of targets) {
    const cleanTarget = toEnglishDigits(target).trim().toLowerCase();
    const targetBuf = Buffer.from(cleanTarget, 'utf8');
    if (inputBuf.length === targetBuf.length && crypto.timingSafeEqual(inputBuf, targetBuf)) {
      return true;
    }
  }

  return false;
}

export const SUPER_ADMIN_PHONE = process.env.SUPER_ADMIN_PHONE || (isProduction() ? '' : '09120000000');
export const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || (isProduction() ? '' : 'admin@bushido.local');
export const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS || (isProduction() ? '' : 'AdminPass123!');
export const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'فرمانده ارشد سامورایی';


