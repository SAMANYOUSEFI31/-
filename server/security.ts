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
const NODE_ENV = process.env.NODE_ENV || 'development';

/** حالت تست روی Vercel بدون OTP/زرین‌پال واقعی */
export function allowTestShortcuts(): boolean {
  if (NODE_ENV !== 'production') return true;
  return process.env.ALLOW_TEST_SHORTCUTS === 'true';
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (NODE_ENV === 'production' && !allowTestShortcuts()) {
      throw new Error('FATAL: JWT_SECRET is required in production.');
    }
    return 'dev-fallback-insecure-secret-key-change-in-production-32b';
  }
  if (NODE_ENV === 'production' && secret.length < 32 && !allowTestShortcuts()) {
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
