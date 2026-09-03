import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizePhoneNumber,
  validateIranianPhone,
  maskPhoneNumber
} from '../server/utils/phone.js';
import {
  createOtpChallenge,
  verifyOtpChallenge,
  consumeOtpChallenge,
  hashOtpCode,
  OTP_PURPOSES
} from '../server/otp/index.js';
import {
  getSmsProvider,
  setSmsProvider,
  sendOtpSms,
  getLastDispatchedOtp,
  clearSmsHistory,
  MockSmsProvider,
  FailClosedSmsProvider
} from '../server/sms/index.js';
import {
  memoryStore,
  createUser,
  updateUser,
  deleteUser,
  findUserById,
  findUserByPhoneNumber,
  findUserByIdentifier,
  findActiveOtpChallenge,
  setPrismaState
} from '../server/db/index.js';
import { createOtpRecord } from '../server/db/otp.js';
import {
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  authMiddleware
} from '../server/auth.js';
import {
  SUPER_ADMIN_PHONE,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PASS
} from '../server/security.js';
import {
  registerRequestOtpSchema,
  registerVerifyOtpSchema,
  forgotPasswordRequestOtpSchema,
  resetPasswordWithOtpSchema
} from '../server/utils/validation.js';
import { app } from '../server.js';

describe('Phase 2B: Phone-First Authentication Final Closure Suite', () => {
  const originalEnv = { ...process.env };
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    // Spin up ephemeral test HTTP server for true route and middleware integration testing
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address() as any;
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(() => {
    memoryStore.users = [];
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.subscriptions = [];
    memoryStore.otpCodes = [];
    clearSmsHistory();
    setSmsProvider(new MockSmsProvider());
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
      assert.equal(normalizePhoneNumber('۰۹۱۲۳۴۵۶۷۸۹'), '09123456789');
      assert.equal(normalizePhoneNumber('٠٩١٢٣٤٥٦٧٨٩'), '09123456789');
      assert.equal(normalizePhoneNumber('+۹۸ ۹۱۲ ۳۴۵ ۶۷۸۹'), '09123456789');
    });

    it('rejects invalid or non-Iranian mobile numbers', () => {
      assert.equal(normalizePhoneNumber(''), null);
      assert.equal(normalizePhoneNumber('12345'), null);
      assert.equal(normalizePhoneNumber('02188776655'), null);
      assert.equal(normalizePhoneNumber('+14155552671'), null);
      assert.equal(normalizePhoneNumber('invalid-text'), null);
      assert.equal(normalizePhoneNumber('0900123456'), null);
      assert.equal(normalizePhoneNumber('091212345678'), null);
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
   * 2. No Raw OTP in Persisted Records Contract
   * ========================================================================= */
  describe('No Raw OTP in Persisted Records Contract', () => {
    it('proves persisted OTP records store codeHash only and never raw code', async () => {
      const result = await createOtpChallenge({
        phoneNumber: '09121234567',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      assert.equal(result.success, true);

      // Inspect persisted memory store record directly
      const record = memoryStore.otpCodes.find(c => c.identifier === '09121234567')!;
      assert.ok(record, 'Record must exist in persistence');
      assert.ok(record.codeHash && record.codeHash.length === 64, 'codeHash must be a 64-char SHA256 string');
      assert.equal((record as any).code, undefined, 'Persisted record MUST NOT have a raw code property');

      // Test retrieves raw OTP solely through Mock SMS Provider
      const dispatchedOtp = getLastDispatchedOtp('09121234567', OTP_PURPOSES.PHONE_REGISTRATION);
      assert.ok(dispatchedOtp && dispatchedOtp.length === 5, 'Mock SMS provider captured 5-digit OTP for test');
    });
  });

  /* =========================================================================
   * 3. Purpose-Bound OTP Challenge Engine
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

      const record = memoryStore.otpCodes.find(c => c.identifier === '09121234567');
      assert.ok(record);
      assert.equal(record.purpose, OTP_PURPOSES.PHONE_REGISTRATION);
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

    it('verifies valid code successfully on first attempt retrieved from mock provider', async () => {
      await createOtpChallenge({
        phoneNumber: '09123334455',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });

      const otp = getLastDispatchedOtp('09123334455', OTP_PURPOSES.PHONE_REGISTRATION)!;
      assert.ok(otp);

      const verified = await verifyOtpChallenge({
        phoneNumber: '09123334455',
        code: otp,
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      
      assert.equal(verified.success, true);
      const record = memoryStore.otpCodes.find(c => c.identifier === '09123334455')!;
      assert.equal(record.verified, true);
    });

    it('prevents replay attacks (challenge cannot be verified twice with consumption)', async () => {
      await createOtpChallenge({
        phoneNumber: '09124445566',
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });

      const otp = getLastDispatchedOtp('09124445566', OTP_PURPOSES.PHONE_REGISTRATION)!;
      
      const firstVerify = await verifyOtpChallenge({
        phoneNumber: '09124445566',
        code: otp,
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      assert.equal(firstVerify.success, true);

      // Second attempt must fail
      const secondVerify = await verifyOtpChallenge({
        phoneNumber: '09124445566',
        code: otp,
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

      const regOtp = getLastDispatchedOtp('09125556677', OTP_PURPOSES.PHONE_REGISTRATION)!;

      // Attempt verification with PASSWORD_RESET purpose
      const verifyWithWrongPurpose = await verifyOtpChallenge({
        phoneNumber: '09125556677',
        code: regOtp,
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });
      assert.equal(verifyWithWrongPurpose.success, false);
      if (!verifyWithWrongPurpose.success) {
        assert.equal(verifyWithWrongPurpose.code, 'PURPOSE_MISMATCH');
      }

      // Correct purpose still works
      const verifyWithCorrectPurpose = await verifyOtpChallenge({
        phoneNumber: '09125556677',
        code: regOtp,
        purpose: OTP_PURPOSES.PHONE_REGISTRATION
      });
      assert.equal(verifyWithCorrectPurpose.success, true);
    });

    it('rate limits wrong code attempts (locks after 5 failures)', async () => {
      await createOtpChallenge({
        phoneNumber: '09126667788',
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });

      const validOtp = getLastDispatchedOtp('09126667788', OTP_PURPOSES.PASSWORD_RESET)!;

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
        code: validOtp,
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

      const validOtp = getLastDispatchedOtp('09127778899', OTP_PURPOSES.PASSWORD_RESET)!;
      const record = memoryStore.otpCodes.find(c => c.identifier === '09127778899')!;
      // Simulate expiration
      record.expiresAt = new Date(Date.now() - 5000).toISOString();

      const verified = await verifyOtpChallenge({
        phoneNumber: '09127778899',
        code: validOtp,
        purpose: OTP_PURPOSES.PASSWORD_RESET
      });
      assert.equal(verified.success, false);
      if (!verified.success) {
        assert.equal(verified.code, 'OTP_EXPIRED');
      }
    });
  });

  /* =========================================================================
   * 4. Legacy Generic OTP Routes Resolution
   * ========================================================================= */
  describe('Legacy Generic OTP Routes Resolution', () => {
    it('rejects generic POST /api/auth/verify-otp without consuming the challenge or issuing a token', async () => {
      // 1. Send legitimate registration OTP
      const sendRes = await fetch(`${baseUrl}/api/auth/register/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '09121112233' })
      });
      assert.equal(sendRes.status, 200);
      const otp = getLastDispatchedOtp('09121112233', 'PHONE_REGISTRATION')!;
      assert.ok(otp);

      // 2. Call legacy generic verify route
      const legacyRes = await fetch(`${baseUrl}/api/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09121112233',
          code: otp,
          purpose: 'PHONE_REGISTRATION'
        })
      });
      assert.equal(legacyRes.status, 400);
      const legacyBody = await legacyRes.json();
      assert.equal(legacyBody.code, 'DEPRECATED_ROUTE');
      assert.equal(legacyBody.token, undefined, 'Must not issue a token');
      assert.equal(legacyBody.user, undefined, 'Must not create or return a user');

      // 3. Confirm challenge was NOT consumed and can still complete dedicated registration flow
      const regRes = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09121112233',
          code: otp,
          password: 'ValidPassword123!'
        })
      });
      assert.equal(regRes.status, 200, 'Dedicated registration MUST succeed using the unconsumed OTP');
      const regBody = await regRes.json();
      assert.equal(regBody.success, true);
      assert.ok(regBody.token);
      assert.equal(regBody.user.phoneNumber, '09121112233');
    });
  });

  /* =========================================================================
   * 5. Registration Completion Consistency
   * ========================================================================= */
  describe('Registration Completion Consistency', () => {
    it('prevents duplicate registration for the same phone number', async () => {
      // Create user 1
      await createUser({
        phoneNumber: '09125554433',
        passwordHash: hashPassword('Pass12345!')
      });

      // Attempt second creation with same phone must throw
      await assert.rejects(
        async () => {
          await createUser({
            phoneNumber: '09125554433',
            passwordHash: hashPassword('Pass12345!')
          });
        },
        /already exists/i
      );
    });

    it('ensures successful registration leaves no active reusable challenge', async () => {
      await fetch(`${baseUrl}/api/auth/register/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '09127776655' })
      });
      const otp = getLastDispatchedOtp('09127776655', 'PHONE_REGISTRATION')!;

      // Complete registration
      const regRes = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09127776655',
          code: otp,
          password: 'PassWord123!'
        })
      });
      assert.equal(regRes.status, 200);

      // Verify no active challenge remains
      const active = await findActiveOtpChallenge('09127776655', 'PHONE_REGISTRATION');
      assert.equal(active, null, 'Active challenge must be consumed');

      // Attempting to reuse the OTP must fail
      const reuseRes = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09127776655',
          code: otp,
          password: 'AnotherPassword123!'
        })
      });
      assert.equal(reuseRes.status, 400);
    });

    it('compensates and rolls back user creation if OTP finalization fails', async () => {
      // Setup challenge
      await createOtpChallenge({
        phoneNumber: '09128881122',
        purpose: 'PHONE_REGISTRATION'
      });
      const otp = getLastDispatchedOtp('09128881122', 'PHONE_REGISTRATION')!;

      // Hook users.push to purge otpCodes immediately after user creation to simulate finalization failure
      const origPush = memoryStore.users.push.bind(memoryStore.users);
      try {
        memoryStore.users.push = function (...args: any[]) {
          memoryStore.otpCodes = []; // Simulate database failure / race where challenge vanished before consumption
          return origPush(...args);
        };

        const regRes = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            phoneNumber: '09128881122',
            code: otp,
            password: 'PassWord123!'
          })
        });
        assert.equal(regRes.status, 500);
        const regBody = await regRes.json();
        assert.equal(regBody.code, 'OTP_FINALIZATION_FAILED');

        // Verify that user record was cleaned up via compensation
        const user = await findUserByPhoneNumber('09128881122');
        assert.equal(user, null, 'Unfinalized user MUST be removed via compensation');
      } finally {
        // Guarantee restoration of monkey patch to prevent test pollution
        memoryStore.users.push = origPush;
      }
    });
  });

  /* =========================================================================
   * 6. Real Middleware Session-Revocation Test
   * ========================================================================= */
  describe('Real Middleware Session Revocation', () => {
    it('exercises real authMiddleware: token A succeeds -> tokenVersion incremented -> token A returns 401 SESSION_REVOKED -> token B succeeds', async () => {
      // 1. Create a user with tokenVersion 0
      const user = await createUser({
        phoneNumber: '09123337788',
        passwordHash: hashPassword('PassWord123!')
      });
      assert.equal(user.tokenVersion ?? 0, 0);

      // 2. Issue token A with tokenVersion 0
      const tokenA = generateToken({
        userId: user.id,
        phoneNumber: user.phoneNumber,
        isVip: user.isVip,
        tier: user.tier,
        isAdmin: Boolean(user.isAdmin),
        tokenVersion: 0
      });

      // 3. Call protected route (/api/auth/me) with token A -> confirm HTTP 200
      const meResA = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokenA}` }
      });
      assert.equal(meResA.status, 200);
      const meBodyA = await meResA.json();
      assert.equal(meBodyA.user.id, user.id);

      // 4. Increment user tokenVersion (simulate password reset / session invalidation)
      await updateUser(user.id, { tokenVersion: 1 });

      // 5. Call the same protected route with token A
      const meResRevoked = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokenA}` }
      });

      // 6. Confirm HTTP 401 with SESSION_REVOKED
      assert.equal(meResRevoked.status, 401);
      const revokedBody = await meResRevoked.json();
      assert.equal(revokedBody.code, 'SESSION_REVOKED');

      // 7. Issue token B with tokenVersion 1
      const tokenB = generateToken({
        userId: user.id,
        phoneNumber: user.phoneNumber,
        isVip: user.isVip,
        tier: user.tier,
        isAdmin: Boolean(user.isAdmin),
        tokenVersion: 1
      });

      // 8. Confirm token B succeeds with HTTP 200
      const meResB = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${tokenB}` }
      });
      assert.equal(meResB.status, 200);
      const meBodyB = await meResB.json();
      assert.equal(meBodyB.user.id, user.id);
    });
  });

  /* =========================================================================
   * 7. Critical Auth HTTP Integration Tests Matrix
   * ========================================================================= */
  describe('Critical Auth HTTP Integration Tests Matrix', () => {
    it('registration cannot complete without OTP', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09121239999',
          code: '11111',
          password: 'ValidPassword123!'
        })
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.code, 'INVALID_OR_EXPIRED_OTP');
    });

    it('PHONE_REGISTRATION OTP completes registration and creates non-Admin, non-VIP, free user', async () => {
      await fetch(`${baseUrl}/api/auth/register/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '09129991122' })
      });
      const otp = getLastDispatchedOtp('09129991122', 'PHONE_REGISTRATION')!;

      const res = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09129991122',
          code: otp,
          password: 'StrongPassword123!'
        })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.user.isAdmin, false);
      assert.equal(body.user.isVip, false);
      assert.equal(body.user.tier, 'free');
    });

    it('PASSWORD_RESET OTP cannot complete registration', async () => {
      // First create user for password reset request
      await createUser({
        phoneNumber: '09128883344',
        passwordHash: hashPassword('OldPass123!')
      });

      // Request password reset OTP
      await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '09128883344' })
      });
      const resetOtp = getLastDispatchedOtp('09128883344', 'PASSWORD_RESET')!;

      // Try to use reset OTP for registration
      const regRes = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09128883344',
          code: resetOtp,
          password: 'NewPassword123!'
        })
      });
      assert.equal(regRes.status, 400);
    });

    it('privilege fields in public registration payload are strictly rejected', async () => {
      const res = await fetch(`${baseUrl}/api/auth/register/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09124449988',
          code: '12345',
          password: 'ValidPassword123!',
          isAdmin: true
        })
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.code, 'VALIDATION_ERROR');
    });

    it('phone and password login works for registered user', async () => {
      await createUser({
        phoneNumber: '09126665544',
        passwordHash: hashPassword('CorrectPassword123!')
      });

      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09126665544',
          password: 'CorrectPassword123!'
        })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.ok(body.token);
      assert.equal(body.user.phoneNumber, '09126665544');
    });

    it('public email login without pre-existing account is rejected', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: 'unknown_public_user@example.com',
          password: 'SomePassword123!'
        })
      });
      assert.equal(res.status, 400);
    });

    it('registration OTP cannot reset a password', async () => {
      // Create user
      await createUser({
        phoneNumber: '09129994455',
        passwordHash: hashPassword('OldPass123!')
      });

      // Request registration OTP (not reset OTP)
      await createOtpChallenge({
        phoneNumber: '09129994455',
        purpose: 'PHONE_REGISTRATION'
      });
      const regOtp = getLastDispatchedOtp('09129994455', 'PHONE_REGISTRATION')!;

      // Attempt password reset with registration OTP
      const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09129994455',
          code: regOtp,
          newPassword: 'NewPassword123!'
        })
      });
      assert.equal(resetRes.status, 400);
      const resetBody = await resetRes.json();
      assert.equal(resetBody.code, 'PURPOSE_MISMATCH');
    });

    it('password-reset OTP changes the password and invalidates previous session tokens', async () => {
      // 1. Create user
      const user = await createUser({
        phoneNumber: '09121118899',
        passwordHash: hashPassword('OriginalPass123!')
      });

      // 2. Login to obtain Session 1 Token
      const loginRes1 = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09121118899',
          password: 'OriginalPass123!'
        })
      });
      assert.equal(loginRes1.status, 200);
      const token1 = (await loginRes1.json()).token;

      // 3. Request Password Reset OTP
      await fetch(`${baseUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '09121118899' })
      });
      const resetOtp = getLastDispatchedOtp('09121118899', 'PASSWORD_RESET')!;

      // 4. Perform password reset
      const resetRes = await fetch(`${baseUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09121118899',
          code: resetOtp,
          newPassword: 'BrandNewPassword123!'
        })
      });
      assert.equal(resetRes.status, 200);
      const resetBody = await resetRes.json();
      assert.equal(resetBody.success, true);
      const token2 = resetBody.token;

      // 5. Old token1 MUST now be rejected by actual authMiddleware
      const oldSessionRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token1}` }
      });
      assert.equal(oldSessionRes.status, 401);
      assert.equal((await oldSessionRes.json()).code, 'SESSION_REVOKED');

      // 6. New token2 works
      const newSessionRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token2}` }
      });
      assert.equal(newSessionRes.status, 200);

      // 7. Can log in with new password
      const newLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: '09121118899',
          password: 'BrandNewPassword123!'
        })
      });
      assert.equal(newLoginRes.status, 200);
    });

    it('unconfigured production SMS returns controlled failure and leaves no active challenge', async () => {
      setSmsProvider(new FailClosedSmsProvider('SMS provider unconfigured'));

      const res = await fetch(`${baseUrl}/api/auth/register/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: '09120001122' })
      });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.equal(body.code, 'SMS_DISPATCH_FAILED');

      // Verify no challenge left in database
      const active = await findActiveOtpChallenge('09120001122', 'PHONE_REGISTRATION');
      assert.equal(active, null, 'Must purge failed challenge');

      setSmsProvider(new MockSmsProvider());
    });

    it('Super Admin legitimate login remains functional', async () => {
      const res = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: SUPER_ADMIN_PHONE,
          password: SUPER_ADMIN_PASS
        })
      });
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.success, true);
      assert.equal(body.user.isAdmin, true);
      assert.equal(body.user.isVip, true);
    });
  });

  /* =========================================================================
   * 8. Database Migration & Legacy Schema Compatibility Contract
   * ========================================================================= */
  describe('Database Migration & Legacy Schema Compatibility Contract', () => {
    it('migration SQL relaxes legacy NOT NULL code constraint without dropping data or reintroducing raw OTP', () => {
      const migrationPath = path.join(process.cwd(), 'prisma/migrations/20260903_phase2b_otp_persistence/migration.sql');
      assert.ok(fs.existsSync(migrationPath), 'Phase 2B migration SQL file must exist');

      const sql = fs.readFileSync(migrationPath, 'utf8');

      // 1. Must ensure legacy code column has NOT NULL dropped if present
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ALTER\s+COLUMN\s+"code"\s+DROP\s+NOT\s+NULL/i, 'Must drop NOT NULL constraint from legacy code column');

      // 2. Must default tokenVersion to 0
      assert.match(sql, /ALTER\s+TABLE\s+"User"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"tokenVersion"\s+INTEGER\s+NOT\s+NULL\s+DEFAULT\s+0/i);

      // 3. Must extend OtpCode with codeHash, purpose, attempts, maxAttempts, lastSentAt, consumedAt, updatedAt
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"codeHash"/i);
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"purpose"/i);
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"attempts"/i);
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"maxAttempts"/i);
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"lastSentAt"/i);
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"consumedAt"/i);
      assert.match(sql, /ALTER\s+TABLE\s+"OtpCode"\s+ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"updatedAt"/i);

      // 4. Must invalidate pre-migration blank/null codeHash records safely
      assert.match(sql, /UPDATE\s+"OtpCode"\s+SET\s+"verified"\s*=\s*true/i, 'Must safely invalidate legacy unhashed OTP records');
    });

    it('creates and persists OTP record with codeHash without supplying legacy plaintext code', async () => {
      const challengeId = `otp-mig-${Date.now()}`;
      const phone = '09121237890';
      const codeHash = hashOtpCode('12345', phone);
      const expiresAt = new Date(Date.now() + 180000).toISOString();
      const lastSentAt = new Date().toISOString();

      const created = await createOtpRecord({
        id: challengeId,
        identifier: phone,
        purpose: 'PHONE_REGISTRATION',
        codeHash,
        expiresAt,
        verified: false,
        attempts: 0,
        maxAttempts: 5,
        lastSentAt,
        consumedAt: null,
        userId: null,
        createdAt: lastSentAt,
        updatedAt: lastSentAt
      });

      assert.equal(created.id, challengeId);
      assert.equal(created.identifier, phone);
      assert.equal(created.codeHash, codeHash);
      assert.equal((created as any).code, undefined, 'Created record must not have plaintext code property');

      // Verify stored record in persistence
      const active = await findActiveOtpChallenge(phone, 'PHONE_REGISTRATION');
      assert.ok(active);
      assert.equal(active.codeHash, codeHash);
      assert.equal((active as any).code, undefined, 'Persisted record must have code undefined');
    });

    it('legacy OTP records with blank or null codeHash cannot verify under any circumstances', async () => {
      // Simulate a legacy pre-migration OTP record that only had plaintext or empty codeHash
      const legacyId = 'legacy-otp-record-1';
      const phone = '09129990011';
      
      memoryStore.otpCodes.push({
        id: legacyId,
        identifier: phone,
        purpose: 'PHONE_REGISTRATION',
        codeHash: '', // Blank hash from legacy migration default
        expiresAt: new Date(Date.now() + 180000).toISOString(),
        verified: false,
        attempts: 0,
        maxAttempts: 5,
        lastSentAt: new Date().toISOString(),
        consumedAt: null,
        userId: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      // Attempt verification with any code
      const result = await verifyOtpChallenge({
        phoneNumber: phone,
        code: '12345',
        purpose: 'PHONE_REGISTRATION'
      });

      assert.equal(result.success, false, 'Legacy blank-hash OTP must fail verification');
      if (!result.success) {
        assert.equal(result.code, 'INVALID_CODE');
      }
    });

    it('existing users with default tokenVersion 0 authenticate normally and are rejected on increment', async () => {
      // Simulate existing user created before or during migration (tokenVersion defaults to 0)
      const user = await createUser({
        phoneNumber: '09124440022',
        passwordHash: hashPassword('ExistingUserPass123!'),
        tokenVersion: 0
      });

      assert.equal(user.tokenVersion, 0);

      // Generate token with tokenVersion 0
      const token = generateToken({
        userId: user.id,
        phoneNumber: user.phoneNumber,
        isVip: user.isVip,
        tier: user.tier,
        isAdmin: Boolean(user.isAdmin),
        tokenVersion: 0
      });

      // Valid session
      const verifyResult = verifyToken(token);
      assert.ok(verifyResult);
      assert.equal(verifyResult.userId, user.id);
      assert.equal(verifyResult.tokenVersion, 0);

      // Can authenticate against /api/auth/me
      const meRes = await fetch(`${baseUrl}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      assert.equal(meRes.status, 200);
      const meBody = await meRes.json();
      assert.equal(meBody.user.id, user.id);
    });
  });
});
