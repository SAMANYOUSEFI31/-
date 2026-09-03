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

/** بررسی اینکه آیا محیط فعلی پروداکشن است */
export function isProduction(): boolean {
  return (process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

/**
 * حالت تست و میانبرها:
 * در محیط توسعه/تست همیشه فعال است.
 * در محیط پروداکشن (مانند Vercel) صرفاً با ALLOW_TEST_SHORTCUTS=true فعال می‌گردد.
 */
export function allowTestShortcuts(): boolean {
  if (!isProduction()) return true;
  return parseStrictBoolean(process.env.ALLOW_TEST_SHORTCUTS);
}

/** بررسی فعال بودن قابلیت ورود سریع */
export function isQuickLoginEnabled(): boolean {
  if (!allowTestShortcuts()) return false;
  if (process.env.ENABLE_QUICK_LOGIN !== undefined) {
    return parseStrictBoolean(process.env.ENABLE_QUICK_LOGIN);
  }
  return true;
}

/** بررسی فعال بودن حالت دیباگ OTP */
export function isOtpDebugEnabled(): boolean {
  if (!allowTestShortcuts()) return false;
  return parseStrictBoolean(process.env.ENABLE_OTP_DEBUG);
}

/** بررسی فعال بودن OTP شبیه‌سازی‌شده (بدون درگاه پیامکی زنده) */
export function isMockOtpEnabled(): boolean {
  return allowTestShortcuts();
}

/** بررسی فعال بودن پرداخت شبیه‌سازی‌شده (بدون درگاه زرین‌پال زنده) */
export function isMockPaymentEnabled(): boolean {
  return allowTestShortcuts();
}

/** ساختار جامع قابلیت‌های امنیتی و محیطی سرور */
export interface SecurityCapabilities {
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
  const testAllowed = allowTestShortcuts();

  if (!secret) {
    if (prod && !testAllowed) {
      throw new Error('FATAL: JWT_SECRET is required in production.');
    }
    return 'dev-fallback-insecure-secret-key-change-in-production-32b';
  }
  if (prod && secret.length < 32 && !testAllowed) {
    throw new Error('FATAL: JWT_SECRET must be at least 32 characters.');
  }
  return secret;
}

export function getSuperAdminIdentifier(): string {
  return (
    process.env.SUPER_ADMIN_IDENTIFIER ||
    process.env.ADMIN_PHONE ||
    process.env.ADMIN_USERNAME ||
    process.env.SUPER_ADMIN_PHONE ||
    process.env.SUPER_ADMIN_EMAIL ||
    (allowTestShortcuts() ? 'admin' : '')
  );
}

const PBKDF2_ITERATIONS = 100000;
const PBKDF2_KEYLEN = 64;
const PBKDF2_DIGEST = 'sha512';
const SALT_BYTE_SIZE = 16;

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

export const SUPER_ADMIN_PHONE = process.env.SUPER_ADMIN_PHONE || '';
export const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || '';
export const SUPER_ADMIN_PASS = process.env.SUPER_ADMIN_PASS || '';
export const SUPER_ADMIN_NAME = process.env.SUPER_ADMIN_NAME || 'فرمانده ارشد سامورایی';

/** برای سازگاری با importهای قدیمی — دیگر در production مقدار ثابت ندارد */
export const JWT_SECRET = process.env.JWT_SECRET || 'dev-fallback-insecure-secret-key-change-in-production-32b';

