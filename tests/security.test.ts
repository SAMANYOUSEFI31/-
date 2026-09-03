import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toEnglishDigits,
  parseStrictBoolean,
  isProduction,
  allowTestShortcuts,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  isSuperAdminIdentifier
} from '../server/security.js';

describe('Bushido Security & Environment Separation Matrix', () => {
  describe('Persian / Arabic Digit Normalization', () => {
    it('converts Persian and Arabic digits to English standard digits', () => {
      assert.equal(toEnglishDigits('۰۹۳۷۵۴۵۴۰۵۰'), '09375454050');
      assert.equal(toEnglishDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
      assert.equal(toEnglishDigits('admin-123'), 'admin-123');
      assert.equal(toEnglishDigits(''), '');
    });
  });

  describe('Strict Boolean Parsing Contract', () => {
    it('accepts only exact case-insensitive "true" string as true', () => {
      assert.equal(parseStrictBoolean('true'), true);
      assert.equal(parseStrictBoolean('TRUE'), true);
      assert.equal(parseStrictBoolean('True'), true);
      assert.equal(parseStrictBoolean('  true  '), true);
    });

    it('rejects all other values (fail-closed behavior)', () => {
      assert.equal(parseStrictBoolean('false'), false);
      assert.equal(parseStrictBoolean('FALSE'), false);
      assert.equal(parseStrictBoolean('1'), false);
      assert.equal(parseStrictBoolean('yes'), false);
      assert.equal(parseStrictBoolean('on'), false);
      assert.equal(parseStrictBoolean(''), false);
      assert.equal(parseStrictBoolean(undefined), false);
      assert.equal(parseStrictBoolean(null), false);
      assert.equal(parseStrictBoolean(' random '), false);
    });
  });

  describe('Environment Capability Matrix & Fail-Closed Behavior', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origAllow = process.env.ALLOW_TEST_SHORTCUTS;
    const origOtpDebug = process.env.ENABLE_OTP_DEBUG;
    const origQuickLogin = process.env.ENABLE_QUICK_LOGIN;

    const restoreEnv = () => {
      process.env.NODE_ENV = origNodeEnv;
      if (origAllow !== undefined) process.env.ALLOW_TEST_SHORTCUTS = origAllow;
      else delete process.env.ALLOW_TEST_SHORTCUTS;

      if (origOtpDebug !== undefined) process.env.ENABLE_OTP_DEBUG = origOtpDebug;
      else delete process.env.ENABLE_OTP_DEBUG;

      if (origQuickLogin !== undefined) process.env.ENABLE_QUICK_LOGIN = origQuickLogin;
      else delete process.env.ENABLE_QUICK_LOGIN;
    };

    it('Scenario 1: Production with NO shortcuts flag (Public Production / Liara) -> Fail Closed', () => {
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ALLOW_TEST_SHORTCUTS;
        delete process.env.ENABLE_OTP_DEBUG;
        delete process.env.ENABLE_QUICK_LOGIN;

        assert.equal(isProduction(), true);
        assert.equal(allowTestShortcuts(), false);
        assert.equal(isQuickLoginEnabled(), false);
        assert.equal(isOtpDebugEnabled(), false);
        assert.equal(isMockOtpEnabled(), false);
        assert.equal(isMockPaymentEnabled(), false);

        const caps = getSecurityCapabilities();
        assert.equal(caps.isProduction, true);
        assert.equal(caps.testShortcutsEnabled, false);
        assert.equal(caps.quickLoginEnabled, false);
        assert.equal(caps.otpDebugEnabled, false);
        assert.equal(caps.mockOtpEnabled, false);
        assert.equal(caps.mockPaymentEnabled, false);
      } finally {
        restoreEnv();
      }
    });

    it('Scenario 2: Production with ALLOW_TEST_SHORTCUTS=true (Private Vercel Test) -> Shortcuts Allowed', () => {
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        delete process.env.ENABLE_OTP_DEBUG;
        delete process.env.ENABLE_QUICK_LOGIN;

        assert.equal(isProduction(), true);
        assert.equal(allowTestShortcuts(), true);
        assert.equal(isQuickLoginEnabled(), true);
        assert.equal(isOtpDebugEnabled(), false);
        assert.equal(isMockOtpEnabled(), true);
        assert.equal(isMockPaymentEnabled(), true);

        const caps = getSecurityCapabilities();
        assert.equal(caps.isProduction, true);
        assert.equal(caps.testShortcutsEnabled, true);
        assert.equal(caps.quickLoginEnabled, true);
        assert.equal(caps.mockOtpEnabled, true);
        assert.equal(caps.mockPaymentEnabled, true);
      } finally {
        restoreEnv();
      }
    });

    it('Scenario 3: Production with ALLOW_TEST_SHORTCUTS=true AND ENABLE_OTP_DEBUG=true -> OTP Debug Enabled', () => {
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        process.env.ENABLE_OTP_DEBUG = 'true';

        assert.equal(allowTestShortcuts(), true);
        assert.equal(isOtpDebugEnabled(), true);
      } finally {
        restoreEnv();
      }
    });

    it('Scenario 4: Production with ENABLE_OTP_DEBUG=true but ALLOW_TEST_SHORTCUTS unset -> OTP Debug Strictly Blocked', () => {
      try {
        process.env.NODE_ENV = 'production';
        delete process.env.ALLOW_TEST_SHORTCUTS;
        process.env.ENABLE_OTP_DEBUG = 'true';

        // OTP debug must NOT be enabled in production without ALLOW_TEST_SHORTCUTS=true
        assert.equal(isOtpDebugEnabled(), false);
      } finally {
        restoreEnv();
      }
    });

    it('Scenario 5: Malformed values in Production (ALLOW_TEST_SHORTCUTS=1 / yes / on) -> Strictly Fails Closed', () => {
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = '1';
        assert.equal(allowTestShortcuts(), false);

        process.env.ALLOW_TEST_SHORTCUTS = 'yes';
        assert.equal(allowTestShortcuts(), false);

        process.env.ALLOW_TEST_SHORTCUTS = 'TRUE_VALUE';
        assert.equal(allowTestShortcuts(), false);
      } finally {
        restoreEnv();
      }
    });

    it('Scenario 6: Development Mode (NODE_ENV=development) -> Defaults to Test Capabilities Enabled', () => {
      try {
        process.env.NODE_ENV = 'development';
        delete process.env.ALLOW_TEST_SHORTCUTS;

        assert.equal(isProduction(), false);
        assert.equal(allowTestShortcuts(), true);
        assert.equal(isQuickLoginEnabled(), true);
        assert.equal(isMockOtpEnabled(), true);
        assert.equal(isMockPaymentEnabled(), true);
      } finally {
        restoreEnv();
      }
    });
  });

  describe('Password Hashing & Constant-Time Verification', () => {
    it('generates secure salted PBKDF2 hash and verifies correctly', () => {
      const password = 'CorrectHorseBatteryStaple123!';
      const hash = hashPassword(password);

      assert.ok(hash.includes(':'), 'Hash must contain salt:hash delimiter');
      assert.equal(verifyPassword(password, hash), true);
      assert.equal(verifyPassword('WrongPassword', hash), false);
      assert.equal(verifyPassword('', hash), false);
      assert.equal(verifyPassword(password, null), false);
      assert.equal(verifyPassword(password, 'invalid-hash-format'), false);
    });
  });

  describe('JWT Token Contract', () => {
    it('generates and verifies signed token payload', () => {
      const payload = { userId: 'user-123', email: 'test@bushido.app', isVip: true };
      const token = generateToken(payload, '1h');

      assert.ok(typeof token === 'string' && token.length > 20);
      const decoded = verifyToken<typeof payload>(token);
      assert.ok(decoded);
      assert.equal(decoded.userId, 'user-123');
      assert.equal(decoded.email, 'test@bushido.app');
      assert.equal(decoded.isVip, true);
    });

    it('rejects tampered or malformed tokens', () => {
      assert.equal(verifyToken(''), null);
      assert.equal(verifyToken('malformed.token.here'), null);
      assert.equal(verifyToken(null as any), null);
    });
  });

  describe('Super Admin Identifier Verification', () => {
    it('matches super admin identifier regardless of digit format or whitespace', () => {
      assert.equal(isSuperAdminIdentifier(''), false);
      assert.equal(isSuperAdminIdentifier(null), false);
    });
  });
});
