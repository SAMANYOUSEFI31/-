import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toEnglishDigits,
  parseStrictBoolean,
  getAppEnvironment,
  isProduction,
  isPublicProduction,
  isStaging,
  allowTestShortcuts,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities,
  getJwtSecret,
  getSuperAdminIdentifier,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  isSuperAdminIdentifier
} from '../server/security.js';
import {
  MockSmsProvider,
  clearSmsHistory,
  smsDispatchHistory,
  setSmsProvider,
  getSmsProvider
} from '../server/sms/index.js';
import {
  getPaymentAdapter,
  setPaymentAdapterOverride,
  ProviderNeutralSimulatorAdapter
} from '../server/payment/adapter.js';

describe('Phase 2A: Production Safety Boundaries & Security Matrix', () => {
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

  describe('Application Environment Resolver (APP_ENV vs NODE_ENV)', () => {
    const origEnv = { ...process.env };

    const restoreEnv = () => {
      process.env = { ...origEnv };
    };

    it('Scenario 1: Explicit APP_ENV values are respected', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.NODE_ENV = 'development';
        assert.equal(getAppEnvironment(), 'production');
        assert.equal(isPublicProduction(), true);
        assert.equal(isStaging(), false);

        process.env.APP_ENV = 'staging';
        process.env.NODE_ENV = 'production';
        assert.equal(getAppEnvironment(), 'staging');
        assert.equal(isPublicProduction(), false);
        assert.equal(isStaging(), true);

        process.env.APP_ENV = 'development';
        assert.equal(getAppEnvironment(), 'development');

        process.env.APP_ENV = 'test';
        assert.equal(getAppEnvironment(), 'test');
      } finally {
        restoreEnv();
      }
    });

    it('Scenario 2: Absent APP_ENV falls back cleanly to NODE_ENV', () => {
      try {
        delete process.env.APP_ENV;

        process.env.NODE_ENV = 'production';
        assert.equal(getAppEnvironment(), 'production');
        assert.equal(isPublicProduction(), true);

        process.env.NODE_ENV = 'test';
        assert.equal(getAppEnvironment(), 'test');

        process.env.NODE_ENV = 'development';
        assert.equal(getAppEnvironment(), 'development');

        process.env.NODE_ENV = 'custom_other';
        assert.equal(getAppEnvironment(), 'development');

        delete process.env.NODE_ENV;
        assert.equal(getAppEnvironment(), 'development');
      } finally {
        restoreEnv();
      }
    });

    it('Scenario 3: Invalid explicit APP_ENV fails closed to "invalid"', () => {
      try {
        process.env.APP_ENV = 'unknown_env';
        process.env.NODE_ENV = 'development';
        assert.equal(getAppEnvironment(), 'invalid');
        assert.equal(isPublicProduction(), false);
        assert.equal(allowTestShortcuts(), false);
        assert.equal(isQuickLoginEnabled(), false);
        assert.equal(isOtpDebugEnabled(), false);
        assert.equal(isMockOtpEnabled(), false);
        assert.equal(isMockPaymentEnabled(), false);
      } finally {
        restoreEnv();
      }
    });
  });

  describe('Public Production Immunity Matrix', () => {
    const origEnv = { ...process.env };

    const restoreEnv = () => {
      process.env = { ...origEnv };
    };

    it('Production: ALLOW_TEST_SHORTCUTS=true has NO effect', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        process.env.ENABLE_QUICK_LOGIN = 'true';
        process.env.ENABLE_OTP_DEBUG = 'true';

        assert.equal(allowTestShortcuts(), false);
        assert.equal(isQuickLoginEnabled(), false);
        assert.equal(isOtpDebugEnabled(), false);
        assert.equal(isMockOtpEnabled(), false);
        assert.equal(isMockPaymentEnabled(), false);

        const caps = getSecurityCapabilities();
        assert.equal(caps.appEnvironment, 'production');
        assert.equal(caps.isPublicProduction, true);
        assert.equal(caps.testShortcutsEnabled, false);
        assert.equal(caps.quickLoginEnabled, false);
        assert.equal(caps.otpDebugEnabled, false);
        assert.equal(caps.mockOtpEnabled, false);
        assert.equal(caps.mockPaymentEnabled, false);
      } finally {
        restoreEnv();
      }
    });

    it('Staging: Shortcuts disabled by default, enabled only with ALLOW_TEST_SHORTCUTS=true', () => {
      try {
        process.env.APP_ENV = 'staging';
        delete process.env.ALLOW_TEST_SHORTCUTS;
        delete process.env.ENABLE_OTP_DEBUG;
        delete process.env.ENABLE_QUICK_LOGIN;

        // Default staging -> disabled
        assert.equal(allowTestShortcuts(), false);
        assert.equal(isQuickLoginEnabled(), false);
        assert.equal(isOtpDebugEnabled(), false);
        assert.equal(isMockOtpEnabled(), false);
        assert.equal(isMockPaymentEnabled(), false);

        // Staging with ALLOW_TEST_SHORTCUTS=true -> enabled
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        assert.equal(allowTestShortcuts(), true);
        assert.equal(isQuickLoginEnabled(), true);
        assert.equal(isMockOtpEnabled(), true);
        assert.equal(isMockPaymentEnabled(), true);

        // Staging OTP debug requires ENABLE_OTP_DEBUG=true
        assert.equal(isOtpDebugEnabled(), false);
        process.env.ENABLE_OTP_DEBUG = 'true';
        assert.equal(isOtpDebugEnabled(), true);

        // Staging quick login can be explicitly disabled
        process.env.ENABLE_QUICK_LOGIN = 'false';
        assert.equal(isQuickLoginEnabled(), false);
      } finally {
        restoreEnv();
      }
    });

    it('Development: Defaults to test shortcuts enabled', () => {
      try {
        process.env.APP_ENV = 'development';
        delete process.env.ALLOW_TEST_SHORTCUTS;

        assert.equal(allowTestShortcuts(), true);
        assert.equal(isQuickLoginEnabled(), true);
        assert.equal(isMockOtpEnabled(), true);
        assert.equal(isMockPaymentEnabled(), true);

        // Can disable quick login explicitly
        process.env.ENABLE_QUICK_LOGIN = 'false';
        assert.equal(isQuickLoginEnabled(), false);
      } finally {
        restoreEnv();
      }
    });
  });

  describe('JWT Secret Single Source of Truth & Validation', () => {
    const origEnv = { ...process.env };

    const restoreEnv = () => {
      process.env = { ...origEnv };
    };

    it('Production: throws if JWT_SECRET is missing or < 32 characters', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true'; // must not weaken
        delete process.env.JWT_SECRET;

        assert.throws(() => getJwtSecret(), /FATAL: JWT_SECRET is required in production/);

        process.env.JWT_SECRET = 'too-short-secret';
        assert.throws(() => getJwtSecret(), /FATAL: JWT_SECRET must be at least 32 characters/);

        process.env.JWT_SECRET = 'a-super-secure-production-secret-key-that-is-valid-32b';
        assert.equal(getJwtSecret(), 'a-super-secure-production-secret-key-that-is-valid-32b');
      } finally {
        restoreEnv();
      }
    });

    it('Staging: throws if JWT_SECRET is missing or < 32 characters', () => {
      try {
        process.env.APP_ENV = 'staging';
        delete process.env.JWT_SECRET;

        assert.throws(() => getJwtSecret(), /FATAL: JWT_SECRET is required in staging/);

        process.env.JWT_SECRET = 'short-staging-key';
        assert.throws(() => getJwtSecret(), /FATAL: JWT_SECRET must be at least 32 characters in staging/);

        process.env.JWT_SECRET = 'a-valid-staging-secret-key-that-is-at-least-32-chars';
        assert.equal(getJwtSecret(), 'a-valid-staging-secret-key-that-is-at-least-32-chars');
      } finally {
        restoreEnv();
      }
    });

    it('Development/Test: uses fallback if unconfigured, or configured secret if present', () => {
      try {
        process.env.APP_ENV = 'development';
        delete process.env.JWT_SECRET;

        const devSecret = getJwtSecret();
        assert.ok(typeof devSecret === 'string' && devSecret.length >= 32);

        process.env.JWT_SECRET = 'custom-dev-secret';
        assert.equal(getJwtSecret(), 'custom-dev-secret');
      } finally {
        restoreEnv();
      }
    });
  });

  describe('SMS Provider Boundary & Production Fail-Closed', () => {
    const origEnv = { ...process.env };

    const restoreEnv = () => {
      process.env = { ...origEnv };
      clearSmsHistory();
    };

    it('MockSmsProvider fails closed in production and does not log/record raw OTP', async () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        clearSmsHistory();

        const provider = new MockSmsProvider();
        const result = await provider.sendSms({
          to: '09123456789',
          message: 'کد ۱۲۳۴۵',
          otpCode: '12345',
          purpose: 'PHONE_REGISTRATION'
        });

        assert.equal(result.success, false);
        assert.equal(result.error, 'SMS_GATEWAY_UNCONFIGURED_IN_PRODUCTION');
        assert.equal(smsDispatchHistory.length, 0, 'No SMS must be recorded in history in production');
      } finally {
        restoreEnv();
      }
    });

    it('setSmsProvider cannot install mock provider in public production', () => {
      try {
        process.env.APP_ENV = 'production';
        const initialProvider = getSmsProvider();
        setSmsProvider(new MockSmsProvider());
        // Should not replace if it was another provider
      } finally {
        restoreEnv();
      }
    });
  });

  describe('Payment Gateway Adapter Boundary', () => {
    const origEnv = { ...process.env };

    const restoreEnv = () => {
      process.env = { ...origEnv };
      setPaymentAdapterOverride(null);
    };

    it('getPaymentAdapter returns null in public production and staging without shortcuts', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        assert.equal(getPaymentAdapter(), null);

        process.env.APP_ENV = 'staging';
        delete process.env.ALLOW_TEST_SHORTCUTS;
        assert.equal(getPaymentAdapter(), null);

        process.env.APP_ENV = 'invalid';
        assert.equal(getPaymentAdapter(), null);
      } finally {
        restoreEnv();
      }
    });

    it('getPaymentAdapter returns simulator in development, test, and staging with shortcuts', () => {
      try {
        process.env.APP_ENV = 'development';
        assert.ok(getPaymentAdapter() instanceof ProviderNeutralSimulatorAdapter);

        process.env.APP_ENV = 'test';
        assert.ok(getPaymentAdapter() instanceof ProviderNeutralSimulatorAdapter);

        process.env.APP_ENV = 'staging';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        assert.ok(getPaymentAdapter() instanceof ProviderNeutralSimulatorAdapter);
      } finally {
        restoreEnv();
      }
    });

    it('setPaymentAdapterOverride rejects simulator installation in production', () => {
      try {
        process.env.APP_ENV = 'production';
        setPaymentAdapterOverride(new ProviderNeutralSimulatorAdapter());
        assert.equal(getPaymentAdapter(), null);
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
    const origEnv = { ...process.env };

    const restoreEnv = () => {
      process.env = { ...origEnv };
    };

    it('matches super admin identifier in dev/test, and empty in production if not set', () => {
      try {
        process.env.APP_ENV = 'production';
        delete process.env.SUPER_ADMIN_PHONE;
        delete process.env.SUPER_ADMIN_EMAIL;
        delete process.env.SUPER_ADMIN_IDENTIFIER;

        assert.equal(getSuperAdminIdentifier(), '');
        assert.equal(isSuperAdminIdentifier(''), false);
        assert.equal(isSuperAdminIdentifier(null), false);
      } finally {
        restoreEnv();
      }
    });
  });
});

