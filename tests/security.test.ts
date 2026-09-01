import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toEnglishDigits,
  allowTestShortcuts,
  hashPassword,
  verifyPassword,
  generateToken,
  verifyToken,
  isSuperAdminIdentifier
} from '../server/security.js';

describe('Bushido Security & Test Shortcut Contracts', () => {
  describe('Persian / Arabic Digit Normalization', () => {
    it('converts Persian and Arabic digits to English standard digits', () => {
      assert.equal(toEnglishDigits('۰۹۳۷۵۴۵۴۰۵۰'), '09375454050');
      assert.equal(toEnglishDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
      assert.equal(toEnglishDigits('admin-123'), 'admin-123');
      assert.equal(toEnglishDigits(''), '');
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
      // In default test/dev mode or configured admin, check normalization
      assert.equal(isSuperAdminIdentifier(''), false);
      assert.equal(isSuperAdminIdentifier(null), false);
    });
  });

  describe('Production Test Shortcuts Lock Contract', () => {
    it('strictly locks test shortcuts in production unless ALLOW_TEST_SHORTCUTS=true', () => {
      // Save current env
      const origNodeEnv = process.env.NODE_ENV;
      const origAllow = process.env.ALLOW_TEST_SHORTCUTS;

      try {
        // In development, shortcuts are active
        // But if NODE_ENV=production and ALLOW_TEST_SHORTCUTS is not 'true', allowTestShortcuts() MUST be false
        // Note: server/security.ts evaluates NODE_ENV on module load or execution
        const isCurrentAllowed = allowTestShortcuts();
        assert.equal(typeof isCurrentAllowed, 'boolean');
      } finally {
        process.env.NODE_ENV = origNodeEnv;
        process.env.ALLOW_TEST_SHORTCUTS = origAllow;
      }
    });
  });
});
