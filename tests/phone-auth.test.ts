import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizePhoneNumber,
  validateIranianPhone,
  maskPhoneNumber
} from '../server/utils/phone.js';
import {
  createOtpChallenge,
  verifyOtpChallenge,
  OTP_PURPOSES
} from '../server/otp/index.js';
import {
  getSmsProvider,
  setSmsProvider,
  sendOtpSms,
  MockSmsProvider,
  FailClosedSmsProvider
} from '../server/sms/index.js';
import {
  memoryStore,
  createUser,
  findUserByPhoneNumber,
  findUserByIdentifier,
  setPrismaState
} from '../server/db/index.js';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken
} from '../server/auth.js';

describe('Phase 2B: Phone-First Authentication Foundation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    memoryStore.users = [];
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.subscriptions = [];
    memoryStore.otpCodes = [];
    setPrismaState(null, false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  /* =========================================================================
   * 1. Phone Normalization & Validation
   * ========================================================================= */
  describe('Phone Number Normalization & Validation', () => {
    it('normalizes various standard Iranian mobile number formats to 09XXXXXXXXX', () => {
      assert.equal(normalizePhoneNumber('09121234567'), '09121234567');
      assert.equal(normalizePhoneNumber('+989121234567'), '09121234567');
      assert.equal(normalizePhoneNumber('00989121234567'), '09121234567');
      assert.equal(normalizePhoneNumber('989121234567'), '09121234567');
      assert.equal(normalizePhoneNumber('9121234567'), '09121234567');
      assert.equal(normalizePhoneNumber(' 0912-123-4567 '), '09121234567');
    });

    it('normalizes Persian and Arabic numerals to ASCII digits', () => {
      // Persian digits: ۰۹۱۲۳۴۵۶۷۸۹
      assert.equal(normalizePhoneNumber('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
      // Arabic digits: ٠٩١٢٣٤٥٦٧٨٩
      assert.equal(normalizePhoneNumber('٠٩١٢٣٤٥٦٧٨٩'), '09123456789');
      // Mixed with symbols
      assert.equal(normalizePhoneNumber('+۹۸ ۹۱۲ ۳۴۵ ۶۷۸۹'), '09123456789');
    });

    it('rejects invalid or non-Iranian mobile numbers', () => {
      assert.equal(normalizePhoneNumber(''), null);
      assert.equal(normalizePhoneNumber('12345'), null);
      assert.equal(normalizePhoneNumber('02188776655'), null); // Landline
      assert.equal(normalizePhoneNumber('+14155552671'), null); // US number
      assert.equal(normalizePhoneNumber('invalid-text'), null);
      assert.equal(normalizePhoneNumber('0900123456'), null); // Too short
      assert.equal(normalizePhoneNumber('091212345678'), null); // Too long
    });

    it('validates mobile numbers correctly using validateIranianPhone', () => {
      assert.equal(validateIranianPhone('09121234567'), true);
      assert.equal(validateIranianPhone('۰۹۱۲۳۴۵۶۷۸۹'), true);
      assert.equal(validateIranianPhone('+989351234567'), true);
      assert.equal(validateIranianPhone('02188888888'), false);
      assert.equal(validateIranianPhone('hello@example.com'), false);
    });

    it('masks phone numbers safely for privacy display', () => {
      assert.equal(maskPhoneNumber('09121234567'), '0912***4567');
      assert.equal(maskPhoneNumber('09375454050'), '0937***4050');
    });
  });

  /* =========================================================================
   * 2. SMS Provider Abstraction & Fail-Closed Behavior
   * ========================================================================= */
  describe('SMS Provider Abstraction', () => {
    it('uses MockSmsProvider in development by default', async () => {
      setSmsProvider(new MockSmsProvider());
      const result = await sendOtpSms('09121234567', '12345', OTP_PURPOSES.PHONE_REGISTRATION);
      
      assert.equal(result.success, true);
      assert.equal(result.provider, 'mock_console_provider');
    });

    it('strictly fails-closed in production when FailClosedSmsProvider is used', async () => {
      setSmsProvider(new FailClosedSmsProvider('Production SMS provider is not configured'));
      const result = await sendOtpSms('09121234567', '12345', OTP_PURPOSES.PHONE_REGISTRATION);

      assert.equal(result.success, false);
      assert.equal(result.provider, 'fail_closed_provider');
      assert.match(result.error || '', /not configured/i);

      // Restore mock provider
      setSmsProvider(new MockSmsProvider());
    });

    it('allows custom provider registration via setSmsProvider', async () => {
      const dispatched: Array<{ to: string; code?: string }> = [];
      
      setSmsProvider({
        name: 'custom-provider',
        async sendSms(options) {
          dispatched.push({ to: options.to, code: options.otpCode });
          return { success: true, messageId: 'custom-123', provider: 'custom-provider' };
        }
      });

      const result = await sendOtpSms('09121234567', '99887', OTP_PURPOSES.PASSWORD_RESET);

      assert.equal(result.success, true);
      assert.equal(dispatched.length, 1);
      assert.equal(dispatched[0].to, '09121234567');
      assert.equal(dispatched[0].code, '99887');

      // Reset to default
      setSmsProvider(new MockSmsProvider());
    });
  });

  /* =========================================================================
   * 3. Purpose-Bound OTP Challenges
   * ========================================================================= */
  describe('Purpose-Bound OTP Challenge Engine', () => {
    it('creates OTP challenge and stores purpose, phone, and expiry', async () => {
      const result = await createOtpChallenge({
        phoneNumber: '09121234567',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      
      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.phoneNumber, '09121234567');
        assert.ok(result.expiresInSeconds > 0);
        assert.ok(result.cooldownSeconds > 0);
      }

      // Check record in memory store
      const record = memoryStore.otpCodes.find(c => c.identifier === '09121234567');
      assert.ok(record);
      assert.equal(record.purpose, OTP_PURPOSES.PHONE_REGISTRATION);
      assert.equal(record.code.length, 5);
      assert.equal(record.attempts, 0);
      assert.equal(record.verified, false);
    });

    it('enforces cooldown throttling between requests for the same phone & purpose', async () => {
      const first = await createOtpChallenge({
        phoneNumber: '09129998877',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      assert.equal(first.success, true);

      // Immediate second request must be blocked by cooldown
      const second = await createOtpChallenge({
        phoneNumber: '09129998877',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });

      assert.equal(second.success, false);
      if (!second.success) {
        assert.equal(second.code, 'COOLDOWN_ACTIVE');
        assert.ok((second.retryAfterSeconds || 0) > 0);
      }
    });

    it('verifies valid code successfully on first attempt', async () => {
      await createOtpChallenge({
        phoneNumber: '09123334455',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });

      const record = memoryStore.otpCodes.find(c => c.identifier === '09123334455')!;
      assert.ok(record);

      const verified = await verifyOtpChallenge({
        phoneNumber: '09123334455',
        code: record.code,
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      
      assert.equal(verified.success, true);
      assert.equal(record.verified, true);
    });

    it('prevents replay attacks (challenge cannot be verified twice)', async () => {
      await createOtpChallenge({
        phoneNumber: '09124445566',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });

      const record = memoryStore.otpCodes.find(c => c.identifier === '09124445566')!;
      
      const firstVerify = await verifyOtpChallenge({
        phoneNumber: '09124445566',
        code: record.code,
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      assert.equal(firstVerify.success, true);

      // Second attempt must fail
      const secondVerify = await verifyOtpChallenge({
        phoneNumber: '09124445566',
        code: record.code,
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      assert.equal(secondVerify.success, false);
      if (!secondVerify.success) {
        assert.equal(secondVerify.code, 'INVALID_OR_EXPIRED_OTP');
      }
    });

    it('enforces strict purpose isolation (cannot use REGISTRATION OTP for PASSWORD_RESET)', async () => {
      await createOtpChallenge({
        phoneNumber: '09125556677',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });

      const record = memoryStore.otpCodes.find(c => c.identifier === '09125556677')!;

      // Attempt verification with PASSWORD_RESET purpose
      const verifyWithWrongPurpose = await verifyOtpChallenge({
        phoneNumber: '09125556677',
        code: record.code,
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });
      assert.equal(verifyWithWrongPurpose.success, false);
      if (!verifyWithWrongPurpose.success) {
        assert.equal(verifyWithWrongPurpose.code, 'PURPOSE_MISMATCH');
      }

      // Correct purpose still works
      const verifyWithCorrectPurpose = await verifyOtpChallenge({
        phoneNumber: '09125556677',
        code: record.code,
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      assert.equal(verifyWithCorrectPurpose.success, true);
    });

    it('rate limits wrong code attempts (locks after 5 failures)', async () => {
      await createOtpChallenge({
        phoneNumber: '09126667788',
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });

      const record = memoryStore.otpCodes.find(c => c.identifier === '09126667788')!;

      for (let i = 0; i < 5; i++) {
        const attempt = await verifyOtpChallenge({
          phoneNumber: '09126667788',
          code: '00000',
          purpose: OTP_PURPOSES.PASSWORD_RESET
        });
        assert.equal(attempt.success, false);
      }

      // Even if the correct code is provided on the 6th attempt, it must fail because max attempts exceeded
      const finalAttempt = await verifyOtpChallenge({
        phoneNumber: '09126667788',
        code: record.code,
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });
      assert.equal(finalAttempt.success, false);
      if (!finalAttempt.success) {
        assert.equal(finalAttempt.code, 'MAX_ATTEMPTS_EXCEEDED');
      }
    });

    it('rejects expired challenges', async () => {
      await createOtpChallenge({
        phoneNumber: '09127778899',
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });

      const record = memoryStore.otpCodes.find(c => c.identifier === '09127778899')!;
      // Simulate expiration
      record.expiresAt = new Date(Date.now() - 5000).toISOString();

      const verified = await verifyOtpChallenge({
        phoneNumber: '09127778899',
        code: record.code,
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });
      assert.equal(verified.success, false);
      if (!verified.success) {
        assert.equal(verified.code, 'OTP_EXPIRED');
      }
    });
  });

  /* =========================================================================
   * 4. User Storage & Phone Identification Contract
   * ========================================================================= */
  describe('User Storage Phone Identification', () => {
    it('creates user with canonical phoneNumber and finds user by phone', async () => {
      const user = await createUser({
        phoneNumber: '09123456789',
        passwordHash: hashPassword('SecretPass123!'),
        name: 'سامورایی آزمایشی'
      });

      assert.equal(user.phoneNumber, '09123456789');

      // Find by exact phone
      const found = await findUserByPhoneNumber('09123456789');
      assert.ok(found);
      assert.equal(found.id, user.id);

      // Find by unnormalized phone (+98)
      const foundWithIntl = await findUserByPhoneNumber('+989123456789');
      assert.ok(foundWithIntl);
      assert.equal(foundWithIntl.id, user.id);

      // Find by Persian numerals
      const foundWithPersian = await findUserByPhoneNumber('۰۹۱۲۳۴۵۶۷۸۹');
      assert.ok(foundWithPersian);
      assert.equal(foundWithPersian.id, user.id);
    });

    it('resolves user via findUserByIdentifier with phone numbers', async () => {
      const user = await createUser({
        phoneNumber: '09351112233',
        passwordHash: hashPassword('PassWord1234'),
        name: 'رزمنده'
      });

      const found = await findUserByIdentifier('09351112233');
      assert.ok(found);
      assert.equal(found.id, user.id);

      const foundIntl = await findUserByIdentifier('00989351112233');
      assert.ok(foundIntl);
      assert.equal(foundIntl.id, user.id);
    });

    it('verifies passwords with secure constant-time PBKDF2 verification', () => {
      const hash = hashPassword('MySafePassword#1');
      assert.equal(verifyPassword('MySafePassword#1', hash), true);
      assert.equal(verifyPassword('WrongPassword', hash), false);
      assert.equal(verifyPassword('', hash), false);
    });
  });
});

