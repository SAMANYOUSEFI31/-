import crypto from 'crypto';
import {
  DBOtpCode
} from '../db/base.js';
import {
  findActiveOtpChallenge,
  findLatestOtpChallenge,
  createOtpRecord,
  updateOtpRecord,
  removeOtpRecord
} from '../db/otp.js';
import { normalizePhoneNumber } from '../utils/phone.js';
import { sendOtpSms, OTP_PURPOSES, type OtpPurposeType } from '../sms/index.js';
import {
  getJwtSecret,
  toEnglishDigits,
  isOtpDebugEnabled,
  allowTestShortcuts,
  isProduction
} from '../security.js';

export { OTP_PURPOSES };
export type { OtpPurposeType };

export const OTP_EXPIRATION_SECONDS = 180; // 3 minutes validity
export const OTP_COOLDOWN_SECONDS = 60;    // 60 seconds resend cooldown
export const OTP_MAX_ATTEMPTS = 5;         // Maximum 5 incorrect attempts

export interface CreateOtpChallengeOptions {
  phoneNumber: string;
  purpose: OtpPurposeType;
  userId?: string;
}

export type CreateOtpChallengeResult =
  | {
      success: true;
      phoneNumber: string;
      expiresInSeconds: number;
      cooldownSeconds: number;
      debugCode?: string;
    }
  | {
      success: false;
      code: 'INVALID_PHONE_NUMBER' | 'COOLDOWN_ACTIVE' | 'SMS_DISPATCH_FAILED';
      messageFa: string;
      retryAfterSeconds?: number;
    };

export interface VerifyOtpChallengeOptions {
  phoneNumber: string;
  code: string;
  purpose: OtpPurposeType;
  consume?: boolean; // Default is true; set false for atomic multi-step flows
}

export type VerifyOtpChallengeResult =
  | {
      success: true;
      phoneNumber: string;
      challengeId: string;
    }
  | {
      success: false;
      code:
        | 'INVALID_PHONE_NUMBER'
        | 'INVALID_OR_EXPIRED_OTP'
        | 'OTP_EXPIRED'
        | 'PURPOSE_MISMATCH'
        | 'MAX_ATTEMPTS_EXCEEDED'
        | 'INVALID_CODE';
      messageFa: string;
      remainingAttempts?: number;
    };

/**
 * Computes a secure keyed HMAC hash for an OTP code bound to a canonical phone number
 */
export function hashOtpCode(code: string, phoneNumber: string): string {
  const secret = getJwtSecret();
  return crypto.createHmac('sha256', secret).update(`${phoneNumber}:${code}`).digest('hex');
}

/**
 * Constant-time comparison between user input and stored codeHash
 */
export function verifyOtpCode(inputCode: string, phoneNumber: string, storedHash: string): boolean {
  if (!inputCode || !storedHash) return false;
  const computed = hashOtpCode(inputCode, phoneNumber);
  const a = Buffer.from(computed, 'utf8');
  const b = Buffer.from(storedHash, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Creates, persists, and dispatches a purpose-bound OTP challenge
 */
export async function createOtpChallenge(
  options: CreateOtpChallengeOptions
): Promise<CreateOtpChallengeResult> {
  const normalizedPhone = normalizePhoneNumber(options.phoneNumber);
  if (!normalizedPhone) {
    return {
      success: false,
      code: 'INVALID_PHONE_NUMBER',
      messageFa: 'شماره موبایل وارد شده نامعتبر است. فرمت صحیح: ۰۹۱۲۳۴۵۶۷۸۹'
    };
  }

  const now = new Date();
  const nowTime = now.getTime();

  // 1. Check existing challenges for cooldown using persistent storage
  const existing = await findLatestOtpChallenge(normalizedPhone, options.purpose);

  if (existing) {
    const lastSentTime = new Date(existing.lastSentAt || existing.createdAt).getTime();
    const elapsedSeconds = Math.floor((nowTime - lastSentTime) / 1000);
    if (elapsedSeconds < OTP_COOLDOWN_SECONDS) {
      const retryAfterSeconds = OTP_COOLDOWN_SECONDS - elapsedSeconds;
      return {
        success: false,
        code: 'COOLDOWN_ACTIVE',
        messageFa: `لطفاً ${retryAfterSeconds} ثانیه قبل از درخواست مجدد کد تایید صبر فرمایید.`,
        retryAfterSeconds
      };
    }
  }

  // 2. Generate secure 5-digit OTP
  const code = crypto.randomInt(10000, 100000).toString();
  const codeHash = hashOtpCode(code, normalizedPhone);
  const expiresAt = new Date(nowTime + OTP_EXPIRATION_SECONDS * 1000).toISOString();

  const challenge: DBOtpCode = {
    id: `otp-${nowTime}-${Math.floor(Math.random() * 1000)}`,
    identifier: normalizedPhone,
    purpose: options.purpose,
    codeHash,
    expiresAt,
    verified: false,
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    userId: options.userId || null,
    lastSentAt: now.toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  // 3. Persist record (supersedes prior unverified challenges)
  await createOtpRecord(challenge);

  // 4. Dispatch via SMS provider
  const dispatchRes = await sendOtpSms(normalizedPhone, code, options.purpose);
  if (!dispatchRes.success) {
    // GAP 5: Failed SMS dispatch cleanup!
    // Remove the challenge so it does not remain usable and does not cause a stale cooldown.
    await removeOtpRecord(challenge.id);
    return {
      success: false,
      code: 'SMS_DISPATCH_FAILED',
      messageFa: 'ارسال پیامک با خطا مواجه شد. لطفاً دوباره تلاش نمایید.'
    };
  }

  const result: CreateOtpChallengeResult = {
    success: true,
    phoneNumber: normalizedPhone,
    expiresInSeconds: OTP_EXPIRATION_SECONDS,
    cooldownSeconds: OTP_COOLDOWN_SECONDS
  };

  // Public production must never log or return the raw OTP!
  if (isOtpDebugEnabled() && allowTestShortcuts() && !isProduction()) {
    result.debugCode = code;
  }

  return result;
}

/**
 * Verifies a purpose-bound OTP challenge against persistent storage
 */
export async function verifyOtpChallenge(
  options: VerifyOtpChallengeOptions
): Promise<VerifyOtpChallengeResult> {
  const normalizedPhone = normalizePhoneNumber(options.phoneNumber);
  if (!normalizedPhone) {
    return {
      success: false,
      code: 'INVALID_PHONE_NUMBER',
      messageFa: 'شماره موبایل وارد شده نامعتبر است.'
    };
  }

  const cleanCode = toEnglishDigits(options.code || '').trim();
  const now = new Date();

  // Find active challenge in persistent storage
  const challenge = await findActiveOtpChallenge(normalizedPhone, options.purpose);

  if (!challenge) {
    // Check if challenge exists under another purpose (purpose mismatch check)
    const anyPurposeChallenge = await findActiveOtpChallenge(normalizedPhone);

    if (anyPurposeChallenge && anyPurposeChallenge.purpose && anyPurposeChallenge.purpose !== options.purpose) {
      return {
        success: false,
        code: 'PURPOSE_MISMATCH',
        messageFa: 'این کد تایید برای این عملیات معتبر نیست.'
      };
    }

    return {
      success: false,
      code: 'INVALID_OR_EXPIRED_OTP',
      messageFa: 'کد تایید نامعتبر است یا منقضی شده است.'
    };
  }

  // Check expiration
  if (new Date(challenge.expiresAt).getTime() < now.getTime()) {
    return {
      success: false,
      code: 'OTP_EXPIRED',
      messageFa: 'کد تایید منقضی شده است. لطفاً کد جدید درخواست نمایید.'
    };
  }

  // Check max attempts
  const currentAttempts = challenge.attempts || 0;
  const maxAttempts = challenge.maxAttempts || OTP_MAX_ATTEMPTS;

  if (currentAttempts >= maxAttempts) {
    return {
      success: false,
      code: 'MAX_ATTEMPTS_EXCEEDED',
      messageFa: 'تعداد تلاش‌های ناموفق بیش از حد مجاز است. لطفاً کد جدید درخواست کنید.'
    };
  }

  // Verify code using constant-time hash comparison
  const isValid = verifyOtpCode(cleanCode, normalizedPhone, challenge.codeHash);

  if (!isValid) {
    const newAttempts = currentAttempts + 1;
    await updateOtpRecord(challenge.id, { attempts: newAttempts });

    const remaining = maxAttempts - newAttempts;
    if (remaining <= 0) {
      return {
        success: false,
        code: 'MAX_ATTEMPTS_EXCEEDED',
        messageFa: 'تعداد تلاش‌های ناموفق بیش از حد مجاز شد. کد منقضی گردید.',
        remainingAttempts: 0
      };
    }

    return {
      success: false,
      code: 'INVALID_CODE',
      messageFa: `کد تایید وارد شده نادرست است. (${remaining} تلاش باقی‌مانده)`,
      remainingAttempts: remaining
    };
  }

  // Match success: Consume challenge if requested (default true)
  if (options.consume !== false) {
    await updateOtpRecord(challenge.id, {
      verified: true,
      consumedAt: new Date().toISOString()
    });
  }

  return {
    success: true,
    phoneNumber: normalizedPhone,
    challengeId: challenge.id
  };
}

/**
 * Explicitly consumes a previously verified challenge
 */
export async function consumeOtpChallenge(challengeId: string): Promise<boolean> {
  const updated = await updateOtpRecord(challengeId, {
    verified: true,
    consumedAt: new Date().toISOString()
  });
  return Boolean(updated);
}
