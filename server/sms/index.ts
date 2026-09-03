import { isProduction, allowTestShortcuts, isOtpDebugEnabled } from '../security.js';

export const OTP_PURPOSES = {
  PHONE_REGISTRATION: 'PHONE_REGISTRATION',
  PASSWORD_RESET: 'PASSWORD_RESET'
} as const;

export type OtpPurposeType = 'PHONE_REGISTRATION' | 'PASSWORD_RESET';

export interface SmsSendOptions {
  to: string; // Canonical phone number (09XXXXXXXXX)
  message: string;
  templateId?: string;
  otpCode?: string;
  purpose?: OtpPurposeType;
}

export interface SmsSendResult {
  success: boolean;
  messageId?: string;
  provider: string;
  error?: string;
}

export interface SmsProvider {
  readonly name: string;
  sendSms(options: SmsSendOptions): Promise<SmsSendResult>;
}

/**
 * In-memory buffer for testing / audit verification of dispatched SMS messages
 */
export interface DispatchedSmsLog {
  to: string;
  otpCode?: string;
  purpose?: OtpPurposeType;
  message: string;
  provider: string;
  sentAt: string;
}

export const smsDispatchHistory: DispatchedSmsLog[] = [];

export function clearSmsHistory(): void {
  smsDispatchHistory.length = 0;
}

/**
 * Mock / Unconfigured SMS Provider
 * Used in development, testing, and fallback when real SMS gateway credentials are not configured.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = 'mock_console_provider';

  async sendSms(options: SmsSendOptions): Promise<SmsSendResult> {
    const isProd = isProduction();
    const testAllowed = allowTestShortcuts();

    // If strictly in production and shortcuts are NOT allowed, and no live gateway is configured,
    // we must fail-closed to prevent silent phantom registration.
    if (isProd && !testAllowed) {
      return {
        success: false,
        provider: this.name,
        error: 'SMS_GATEWAY_UNCONFIGURED_IN_PRODUCTION'
      };
    }

    const logEntry: DispatchedSmsLog = {
      to: options.to,
      otpCode: options.otpCode,
      purpose: options.purpose,
      message: options.message,
      provider: this.name,
      sentAt: new Date().toISOString()
    };

    smsDispatchHistory.push(logEntry);

    if (testAllowed || !isProd) {
      const purposeFa =
        options.purpose === 'PHONE_REGISTRATION'
          ? 'ثبت‌نام شماره'
          : options.purpose === 'PASSWORD_RESET'
          ? 'بازیابی رمز عبور'
          : 'احراز هویت';
      console.log(
        `[Bushido SMS Provider: ${this.name}] To: ${options.to} | Purpose: ${purposeFa} | Code: [ ${options.otpCode || 'N/A'} ]`
      );
    }

    return {
      success: true,
      messageId: `mock-msg-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
      provider: this.name
    };
  }
}

/**
 * Fail-Closed SMS Provider
 * Rejects all SMS requests deliberately (used for production fail-closed states)
 */
export class FailClosedSmsProvider implements SmsProvider {
  readonly name = 'fail_closed_provider';
  constructor(private readonly reason: string = 'SMS provider fail-closed') {}

  async sendSms(options: SmsSendOptions): Promise<SmsSendResult> {
    return {
      success: false,
      provider: this.name,
      error: this.reason
    };
  }
}

// Active singleton provider
let activeSmsProvider: SmsProvider = new MockSmsProvider();

export function setSmsProvider(provider: SmsProvider): void {
  activeSmsProvider = provider;
}

export function getSmsProvider(): SmsProvider {
  return activeSmsProvider;
}

/**
 * Standardized OTP SMS dispatcher
 */
export async function sendOtpSms(
  to: string,
  otpCode: string,
  purpose: OtpPurposeType
): Promise<SmsSendResult> {
  const provider = getSmsProvider();

  let message = '';
  if (purpose === 'PHONE_REGISTRATION') {
    message = `کد تایید ثبت‌نام در مرام‌نامه دیسیپلین بوشیدو: ${otpCode}\nمدت اعتبار: ۳ دقیقه`;
  } else if (purpose === 'PASSWORD_RESET') {
    message = `کد تایید بازیابی رمز عبور در بوشیدو: ${otpCode}\nمدت اعتبار: ۳ دقیقه`;
  } else {
    message = `کد تایید بوشیدو: ${otpCode}\nمدت اعتبار: ۳ دقیقه`;
  }

  return await provider.sendSms({
    to,
    message,
    otpCode,
    purpose
  });
}
