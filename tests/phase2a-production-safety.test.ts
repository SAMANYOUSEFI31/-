import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  getAppEnv,
  isProduction,
  allowTestShortcuts,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities,
  getJwtSecret,
  generateToken,
  verifyToken,
  getSuperAdminIdentifier,
  getSuperAdminPhone,
  getSuperAdminEmail,
  getSuperAdminPass,
  isSuperAdminIdentifier
} from '../server/security.js';

describe('Phase 2A: Production-Safety Foundation Hardening', () => {
  const originalEnv = { ...process.env };

  function restoreEnv() {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    for (const [key, value] of Object.entries(originalEnv)) {
      process.env[key] = value;
    }
  }

  /* =========================================================================
   * Contract Test: Safe Build and Migration Separation in package.json
   * ========================================================================= */
  describe('A. Safe Build and Migration Separation Contract', () => {
    it('verifies package.json scripts do not mutate database schema in build, start, test, or lint', () => {
      const packageJsonPath = path.resolve(process.cwd(), 'package.json');
      const raw = fs.readFileSync(packageJsonPath, 'utf8');
      const pkg = JSON.parse(raw);
      const scripts = pkg.scripts || {};

      // 1. db:migrate:deploy must exist and be dedicated to migration deployment
      assert.ok(scripts['db:migrate:deploy'], 'db:migrate:deploy script must exist');
      assert.equal(scripts['db:migrate:deploy'], 'prisma migrate deploy');

      // 2. build must NOT run prisma db push, prisma migrate dev, or --accept-data-loss
      const forbiddenInBuild = ['prisma db push', 'prisma migrate dev', '--accept-data-loss'];
      for (const forbidden of forbiddenInBuild) {
        assert.ok(
          !scripts.build.includes(forbidden),
          `build script must not contain "${forbidden}". Actual: ${scripts.build}`
        );
      }

      // 3. vercel-build must not contain forbidden mutation commands
      if (scripts['vercel-build']) {
        for (const forbidden of forbiddenInBuild) {
          assert.ok(
            !scripts['vercel-build'].includes(forbidden),
            `vercel-build script must not contain "${forbidden}"`
          );
        }
      }

      // 4. start, test, lint must not contain schema mutations
      const operationalScripts = ['start', 'test', 'lint'];
      for (const scriptName of operationalScripts) {
        if (scripts[scriptName]) {
          for (const forbidden of forbiddenInBuild) {
            assert.ok(
              !scripts[scriptName].includes(forbidden),
              `${scriptName} script must not contain "${forbidden}"`
            );
          }
        }
      }

      // 5. No script other than db:push may run prisma db push
      for (const [name, command] of Object.entries(scripts)) {
        if (name !== 'db:push') {
          assert.ok(
            !String(command).includes('prisma db push'),
            `Script "${name}" must not execute prisma db push`
          );
        }
        assert.ok(
          !String(command).includes('--accept-data-loss'),
          `Script "${name}" must never use --accept-data-loss`
        );
      }
    });
  });

  /* =========================================================================
   * B. Strict Application Environment Model & Fail-Closed Behaviors
   * ========================================================================= */
  describe('B. Strict Environment Model & Fail-Closed Scenarios', () => {
    it('1. Production plus ALLOW_TEST_SHORTCUTS=true still returns false for allowTestShortcuts()', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';

        assert.equal(isProduction(), true);
        assert.equal(allowTestShortcuts(), false);

        // Also test with NODE_ENV=production and unset APP_ENV
        delete process.env.APP_ENV;
        process.env.NODE_ENV = 'production';
        assert.equal(isProduction(), true);
        assert.equal(allowTestShortcuts(), false);
      } finally {
        restoreEnv();
      }
    });

    it('2. Production plus ENABLE_QUICK_LOGIN=true still disables quick login', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ENABLE_QUICK_LOGIN = 'true';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';

        assert.equal(isQuickLoginEnabled(), false);
      } finally {
        restoreEnv();
      }
    });

    it('3. Production plus ENABLE_OTP_DEBUG=true still disables OTP debug', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ENABLE_OTP_DEBUG = 'true';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';

        assert.equal(isOtpDebugEnabled(), false);
      } finally {
        restoreEnv();
      }
    });

    it('4. Production disables mock OTP and mock payment', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';

        assert.equal(isMockOtpEnabled(), false);
        assert.equal(isMockPaymentEnabled(), false);
      } finally {
        restoreEnv();
      }
    });

    it('5. Production does not expose default admin identifiers or credentials', () => {
      try {
        process.env.APP_ENV = 'production';
        delete process.env.SUPER_ADMIN_PHONE;
        delete process.env.SUPER_ADMIN_EMAIL;
        delete process.env.SUPER_ADMIN_PASS;
        delete process.env.SUPER_ADMIN_IDENTIFIER;
        delete process.env.ADMIN_PHONE;
        delete process.env.ADMIN_USERNAME;

        assert.equal(getSuperAdminIdentifier(), '');
        assert.equal(getSuperAdminPhone(), '');
        assert.equal(getSuperAdminEmail(), '');
        assert.equal(getSuperAdminPass(), '');

        assert.equal(isSuperAdminIdentifier('admin'), false);
        assert.equal(isSuperAdminIdentifier('09120000000'), false);
        assert.equal(isSuperAdminIdentifier('admin@bushido.local'), false);

        // If explicit production credentials are provided, they are honored
        process.env.SUPER_ADMIN_PHONE = '09129998877';
        process.env.SUPER_ADMIN_PASS = 'StrongProdPass2026!';
        assert.equal(getSuperAdminPhone(), '09129998877');
        assert.equal(getSuperAdminPass(), 'StrongProdPass2026!');
        assert.equal(isSuperAdminIdentifier('09129998877'), true);
        assert.equal(isSuperAdminIdentifier('09120000000'), false);
      } finally {
        restoreEnv();
      }
    });

    it('6. Staging allows test shortcuts only when explicitly configured', () => {
      try {
        process.env.APP_ENV = 'staging';
        delete process.env.ALLOW_TEST_SHORTCUTS;

        // Unconfigured staging -> shortcuts disabled
        assert.equal(isProduction(), false);
        assert.equal(allowTestShortcuts(), false);
        assert.equal(isQuickLoginEnabled(), false);

        // Explicitly configured staging -> shortcuts allowed
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        assert.equal(allowTestShortcuts(), true);
        assert.equal(isQuickLoginEnabled(), true);
        assert.equal(isMockOtpEnabled(), true);
        assert.equal(isMockPaymentEnabled(), true);

        // Staging with invalid ALLOW_TEST_SHORTCUTS fails closed
        process.env.ALLOW_TEST_SHORTCUTS = 'yes';
        assert.equal(allowTestShortcuts(), false);
      } finally {
        restoreEnv();
      }
    });

    it('7. Test environment behaves deterministically', () => {
      try {
        process.env.APP_ENV = 'test';
        delete process.env.ALLOW_TEST_SHORTCUTS;

        assert.equal(getAppEnv(), 'test');
        assert.equal(isProduction(), false);
        assert.equal(allowTestShortcuts(), true);
        assert.equal(isQuickLoginEnabled(), true);
        assert.equal(isMockOtpEnabled(), true);
        assert.equal(isMockPaymentEnabled(), true);
      } finally {
        restoreEnv();
      }
    });

    it('8. Invalid APP_ENV fails closed to safe production behavior', () => {
      try {
        const invalidEnvs = ['prod', 'prd', 'live', 'unknown', 'stage', 'dev', '1', 'true', ' '];
        for (const invalid of invalidEnvs) {
          process.env.APP_ENV = invalid;
          process.env.ALLOW_TEST_SHORTCUTS = 'true';

          assert.equal(getAppEnv(), 'production', `APP_ENV="${invalid}" must fail closed to production`);
          assert.equal(isProduction(), true, `APP_ENV="${invalid}" must report isProduction=true`);
          assert.equal(allowTestShortcuts(), false, `APP_ENV="${invalid}" must disable shortcuts`);
          assert.equal(isQuickLoginEnabled(), false);
          assert.equal(isMockOtpEnabled(), false);
          assert.equal(isMockPaymentEnabled(), false);
        }
      } finally {
        restoreEnv();
      }
    });
  });

  /* =========================================================================
   * C. JWT Secret Single Source of Truth
   * ========================================================================= */
  describe('C. JWT Secret Single Source of Truth', () => {
    it('throws in production when JWT_SECRET is missing', () => {
      try {
        process.env.APP_ENV = 'production';
        delete process.env.JWT_SECRET;
        assert.throws(
          () => getJwtSecret(),
          /JWT_SECRET is required in production/
        );
      } finally {
        restoreEnv();
      }
    });

    it('throws in production when JWT_SECRET is shorter than 32 characters', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.JWT_SECRET = 'short-key-less-than-32-chars';
        assert.throws(
          () => getJwtSecret(),
          /JWT_SECRET must be at least 32 characters/
        );
      } finally {
        restoreEnv();
      }
    });

    it('never weakens production validation because test shortcuts are enabled', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'true';
        delete process.env.JWT_SECRET;
        assert.throws(
          () => getJwtSecret(),
          /JWT_SECRET is required in production/
        );
      } finally {
        restoreEnv();
      }
    });

    it('permits clearly development/test-only fallback outside production', () => {
      try {
        process.env.APP_ENV = 'development';
        delete process.env.JWT_SECRET;
        const fallback = getJwtSecret();
        assert.ok(fallback.includes('dev-fallback'));
      } finally {
        restoreEnv();
      }
    });

    it('signs and verifies tokens when valid production secret (>= 32 chars) is provided', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.JWT_SECRET = 'production-super-secret-key-with-at-least-32-characters!';

        const payload = { userId: 'u-1', email: 'user@example.com', role: 'admin' };
        const token = generateToken(payload, '2h');
        assert.ok(token);

        const decoded = verifyToken<typeof payload>(token);
        assert.ok(decoded);
        assert.equal(decoded.userId, 'u-1');
        assert.equal(decoded.email, 'user@example.com');
      } finally {
        restoreEnv();
      }
    });

    it('verifies that legacy JWT_SECRET fallback constant is NOT exported from security or auth modules', async () => {
      const securityModule = await import('../server/security.js');
      const authModule = await import('../server/auth.js');

      assert.equal('JWT_SECRET' in securityModule, false, 'JWT_SECRET constant must not be exported from server/security.js');
      assert.equal('JWT_SECRET' in authModule, false, 'JWT_SECRET constant must not be exported from server/auth.js');
    });
  });
});
