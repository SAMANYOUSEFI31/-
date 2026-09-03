import crypto from 'crypto';
import {
  prisma,
  isPrismaAvailable,
  memoryStore,
  saveLocalStore,
  DBOtpCode
} from '../db/base.js';
import { normalizePhoneNumber } from '../utils/phone.js';
import { sendOtpSms, OTP_PURPOSES, type OtpPurposeType } from '../sms/index.js';
import { toEnglishDigits, isOtpDebugEnabled, allowTestShortcuts } from '../security.js';

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
 * Creates and dispatches a purpose-bound OTP challenge
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

  // 1. Check existing challenges for cooldown
  const existing = memoryStore.otpCodes
    .filter(o => o.identifier === normalizedPhone && o.purpose === options.purpose && !o.verified)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

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
  const expiresAt = new Date(nowTime + OTP_EXPIRATION_SECONDS * 1000).toISOString();

  const challenge: DBOtpCode = {
    id: `otp-${nowTime}-${Math.floor(Math.random() * 1000)}`,
    identifier: normalizedPhone,
    code,
    purpose: options.purpose,
    expiresAt,
    verified: false,
    attempts: 0,
    maxAttempts: OTP_MAX_ATTEMPTS,
    userId: options.userId || null,
    lastSentAt: now.toISOString(),
    createdAt: now.toISOString()
  };

  // 3. Invalidate previous unverified OTPs for this phone + purpose in memory
  memoryStore.otpCodes = memoryStore.otpCodes.filter(
    o => !(o.identifier === normalizedPhone && o.purpose === options.purpose && !o.verified)
  );
  memoryStore.otpCodes.push(challenge);
  saveLocalStore();

  // Try Prisma if available
  if (isPrismaAvailable && prisma) {
    try {
      await prisma.otpCode.create({
        data: {
          id: challenge.id,
          identifier: challenge.identifier,
          code: challenge.code,
          expiresAt: new Date(challenge.expiresAt),
          verified: false,
          userId: challenge.userId
        }
      });
    } catch (e) {
      // Prisma fallback already handled by memoryStore
    }
  }

  // 4. Dispatch via SMS provider
  const dispatchRes = await sendOtpSms(normalizedPhone, code, options.purpose);
  if (!dispatchRes.success) {
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

  if (isOtpDebugEnabled() || allowTestShortcuts()) {
    result.debugCode = code;
  }

  return result;
}

/**
 * Verifies a purpose-bound OTP challenge
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
  const nowStr = new Date().toISOString();

  // Find active challenge in memory
  const challenge = memoryStore.otpCodes.find(
    o => o.identifier === normalizedPhone && o.purpose === options.purpose && !o.verified
  );

  if (!challenge) {
    // Check if challenge exists under another purpose (purpose mismatch check)
    const anyPurposeChallenge = memoryStore.otpCodes.find(
      o => o.identifier === normalizedPhone && !o.verified
    );

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
  if (challenge.expiresAt < nowStr) {
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

  // Verify code
  if (challenge.code !== cleanCode) {
    challenge.attempts = currentAttempts + 1;
    saveLocalStore();

    const remaining = maxAttempts - challenge.attempts;
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

  // Match success: Mark verified (consumed)
  challenge.verified = true;
  saveLocalStore();

  if (isPrismaAvailable && prisma) {
    try {
      await prisma.otpCode.updateMany({
        where: { id: challenge.id },
        data: { verified: true }
      });
    } catch {
      // ignored
    }
  }

  return {
    success: true,
    phoneNumber: normalizedPhone,
    challengeId: challenge.id
  };
}
