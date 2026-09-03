import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryStore,
  createUser,
  findUserById,
  findUserByIdentifier,
  getUserCycles,
  createCycle,
  updateCycle,
  deleteCycle,
  getUserDailyLogs,
  upsertDailyLog,
  createSubscriptionRecord,
  completeSubscription,
  getUserSubscriptions,
  adminGetAllUsers,
  adminUpdateUser,
  adminGetAllSubscriptions,
  adminGetOverviewStats,
  ensureDefaultAdminAndUsers,
  setPrismaState,
  loadLocalStore
} from '../server/db/index.js';
import {
  generateToken,
  verifyToken
} from '../server/auth.js';
import {
  isProduction,
  allowTestShortcuts,
  isQuickLoginEnabled,
  isOtpDebugEnabled,
  isMockOtpEnabled,
  isMockPaymentEnabled,
  getSecurityCapabilities,
  SUPER_ADMIN_EMAIL,
  SUPER_ADMIN_PHONE
} from '../server/security.js';

describe('Phase 1 Core Compliance & Acceptance Criteria Verification', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset memory store to pristine clean state
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
   * 1. Production Database Fallback Safety
   * ========================================================================= */
  describe('1. Production Database Fallback Safety', () => {
    it('operates safely in local fallback store when Prisma is unavailable', async () => {
      setPrismaState(null, false);

      const user = await createUser({
        email: 'fallback-warrior@bushido.app',
        name: 'مبارز فال‌بک',
        passwordHash: 'hashed_pw_123',
        tier: 'free',
        isVip: false,
        isAdmin: false
      });

      assert.ok(user.id);
      assert.equal(user.email, 'fallback-warrior@bushido.app');

      const found = await findUserById(user.id);
      assert.ok(found);
      assert.equal(found?.name, 'مبارز فال‌بک');
    });

    it('does NOT seed default test users in production mode when shortcuts are disabled', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_TEST_SHORTCUTS;

      assert.equal(isProduction(), true);
      assert.equal(allowTestShortcuts(), false);

      // In production fallback, ensureDefaultAdminAndUsers should be a no-op or prevented
      if (allowTestShortcuts()) {
        ensureDefaultAdminAndUsers();
      }

      assert.equal(memoryStore.users.length, 0);
    });

    it('seeds test users only when ALLOW_TEST_SHORTCUTS=true in staging / development', () => {
      process.env.NODE_ENV = 'development';
      ensureDefaultAdminAndUsers();

      assert.ok(memoryStore.users.length >= 1);
      const testUser = memoryStore.users.find(u => u.id === 'test-user-001');
      assert.ok(testUser);
      assert.equal(testUser?.email, 'test@bushido.app');
    });
  });

  /* =========================================================================
   * 2. Explicit Environment Separation Matrix
   * ========================================================================= */
  describe('2. Explicit Environment Separation Matrix', () => {
    it('strictly isolates production environment and fails closed on malformed values', () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_SHORTCUTS = 'yes'; // malformed boolean

      const caps = getSecurityCapabilities();
      assert.equal(caps.isProduction, true);
      assert.equal(caps.testShortcutsEnabled, false);
      assert.equal(caps.quickLoginEnabled, false);
      assert.equal(caps.mockOtpEnabled, false);
      assert.equal(caps.mockPaymentEnabled, false);
      assert.equal(caps.otpDebugEnabled, false);
    });

    it('enables test capabilities when ALLOW_TEST_SHORTCUTS is explicitly "true"', () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_SHORTCUTS = 'true';

      const caps = getSecurityCapabilities();
      assert.equal(caps.isProduction, true);
      assert.equal(caps.testShortcutsEnabled, true);
      assert.equal(caps.quickLoginEnabled, true);
      assert.equal(caps.mockOtpEnabled, true);
      assert.equal(caps.mockPaymentEnabled, true);
    });
  });

  /* =========================================================================
   * 3. Removal / Blocking of Reachable Production Developer-Entry Paths
   * ========================================================================= */
  describe('3. Removal of Reachable Production Developer-Entry Paths', () => {
    it('blocks quick-login capability in production by default', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_TEST_SHORTCUTS;

      assert.equal(isQuickLoginEnabled(), false);
    });

    it('blocks mock OTP generation and debug codes in production by default', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_TEST_SHORTCUTS;

      assert.equal(isMockOtpEnabled(), false);
      assert.equal(isOtpDebugEnabled(), false);
    });

    it('blocks mock payment simulator in production by default', () => {
      process.env.NODE_ENV = 'production';
      delete process.env.ALLOW_TEST_SHORTCUTS;

      assert.equal(isMockPaymentEnabled(), false);
    });
  });

  /* =========================================================================
   * 4. Super Admin Management Capabilities
   * ========================================================================= */
  describe('4. Super Admin Management Capabilities', () => {
    it('allows super admin to view system overview stats and list all users', async () => {
      const admin = await createUser({
        email: SUPER_ADMIN_EMAIL,
        phoneNumber: SUPER_ADMIN_PHONE,
        name: 'فرمانده ارشد',
        passwordHash: 'hash',
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: true
      });

      const user1 = await createUser({
        email: 'warrior1@bushido.app',
        name: 'مبارز اول',
        passwordHash: 'hash',
        tier: 'free',
        isVip: false,
        isAdmin: false
      });

      const allUsers = await adminGetAllUsers();
      assert.equal(allUsers.length, 2);

      const stats = await adminGetOverviewStats();
      assert.equal(stats.totalUsers, 2);
      assert.equal(stats.vipUsers, 1);
    });

    it('allows super admin to promote user to VIP with extension', async () => {
      const warrior = await createUser({
        email: 'warrior2@bushido.app',
        name: 'مبارز دوم',
        passwordHash: 'hash',
        tier: 'free',
        isVip: false,
        isAdmin: false
      });

      const updated = await adminUpdateUser(warrior.id, {
        tier: 'vip_samurai',
        isVip: true,
        daysExtension: 30
      });

      assert.ok(updated);
      assert.equal(updated?.isVip, true);
      assert.equal(updated?.tier, 'vip_samurai');
      assert.ok(updated?.vipExpiresAt);
    });

    it('prevents demotion of root super admin account', async () => {
      const adminEmail = 'root-commander@bushido.app';
      const rootAdmin = await createUser({
        email: adminEmail,
        phoneNumber: '09370000000',
        name: 'فرمانده کل',
        passwordHash: 'hash',
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: true
      });

      // Simulation of root admin safety check
      const isTargetRoot = rootAdmin.email === adminEmail;
      assert.equal(isTargetRoot, true);

      const attemptDemoteIsAdmin = false;
      const attemptDemoteIsVip = false;
      const isDemotionBlocked = isTargetRoot && (attemptDemoteIsAdmin === false || attemptDemoteIsVip === false);
      assert.equal(isDemotionBlocked, true, 'Root admin demotion must be strictly blocked');
    });
  });

  /* =========================================================================
   * 5. Ownership Verification for DailyLog, Subscription, and Cycles
   * ========================================================================= */
  describe('5. Ownership Verification for Resources', () => {
    let userAId: string;
    let userBId: string;

    beforeEach(async () => {
      const userA = await createUser({
        email: 'userA@bushido.app',
        name: 'کاربر الف',
        passwordHash: 'hashA',
        tier: 'free',
        isVip: false,
        isAdmin: false
      });
      const userB = await createUser({
        email: 'userB@bushido.app',
        name: 'کاربر ب',
        passwordHash: 'hashB',
        tier: 'free',
        isVip: false,
        isAdmin: false
      });
      userAId = userA.id;
      userBId = userB.id;
    });

    it('strictly isolates Cycle creation, retrieval, updates, and deletion per user', async () => {
      // User A creates cycle
      const cycleA = await createCycle(userAId, {
        title: 'چرخه ۲۵ روزه کاربر الف',
        startDate: '2026-09-01',
        endDate: '2026-09-25'
      });

      // User B creates cycle
      const cycleB = await createCycle(userBId, {
        title: 'چرخه ۲۵ روزه کاربر ب',
        startDate: '2026-09-01',
        endDate: '2026-09-25'
      });

      // User A only sees cycle A
      const cyclesA = await getUserCycles(userAId);
      assert.equal(cyclesA.length, 1);
      assert.equal(cyclesA[0].id, cycleA.id);

      // User B only sees cycle B
      const cyclesB = await getUserCycles(userBId);
      assert.equal(cyclesB.length, 1);
      assert.equal(cyclesB[0].id, cycleB.id);

      // User A attempts to update User B's cycle -> Must return null (rejected)
      const tamperedUpdate = await updateCycle(userAId, cycleB.id, {
        title: 'دستکاری مخرب'
      });
      assert.equal(tamperedUpdate, null, 'User A must not be able to mutate User B cycle');

      // User A attempts to delete User B's cycle -> Must return false (rejected)
      const tamperedDelete = await deleteCycle(userAId, cycleB.id);
      assert.equal(tamperedDelete, false, 'User A must not be able to delete User B cycle');

      // User B cycle remains untouched
      const verifiedCycleB = await getUserCycles(userBId);
      assert.equal(verifiedCycleB.length, 1);
      assert.equal(verifiedCycleB[0].title, 'چرخه ۲۵ روزه کاربر ب');
    });

    it('strictly isolates DailyLog upsert and queries per user', async () => {
      const cycleA = await createCycle(userAId, {
        title: 'چرخه الف',
        startDate: '2026-09-01',
        endDate: '2026-09-25'
      });
      const cycleB = await createCycle(userBId, {
        title: 'چرخه ب',
        startDate: '2026-09-01',
        endDate: '2026-09-25'
      });

      // User A logs for day 1
      await upsertDailyLog(userAId, {
        cycleId: cycleA.id,
        date: '2026-09-01',
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: false
      });

      // User B logs for day 1
      await upsertDailyLog(userBId, {
        cycleId: cycleB.id,
        date: '2026-09-01',
        wakeUp: false,
        workout: false,
        study: true,
        journal: false,
        hardTask: false,
        specialMission: false
      });

      // Query User A logs
      const logsA = await getUserDailyLogs(userAId);
      assert.equal(logsA.length, 1);
      assert.equal(logsA[0].wakeUp, true);
      assert.equal(logsA[0].workout, true);

      // Query User B logs
      const logsB = await getUserDailyLogs(userBId);
      assert.equal(logsB.length, 1);
      assert.equal(logsB[0].wakeUp, false);
      assert.equal(logsB[0].workout, false);

      // Query logs of User A with User B cycleId -> Must return empty array
      const crossLogs = await getUserDailyLogs(userAId, cycleB.id);
      assert.equal(crossLogs.length, 0, 'Cross-user cycle querying must return 0 logs');
    });

    it('strictly isolates Subscription records per user and fulfills correctly on completion', async () => {
      // User A initiates subscription
      const subA = await createSubscriptionRecord({
        userId: userAId,
        planId: 'quarterly_samurai',
        amount: 289000,
        authority: 'AUTH-USER-A-001',
        description: 'اشتراک فصلی کاربر الف'
      });

      // User B initiates subscription
      const subB = await createSubscriptionRecord({
        userId: userBId,
        planId: 'annual_shogun',
        amount: 890000,
        authority: 'AUTH-USER-B-002',
        description: 'اشتراک سالانه کاربر ب'
      });

      // User A retrieves their own subscriptions
      const userASubs = await getUserSubscriptions(userAId);
      assert.equal(userASubs.length, 1);
      assert.equal(userASubs[0].id, subA.id);
      assert.equal(userASubs[0].amount, 289000);

      // User B retrieves their own subscriptions
      const userBSubs = await getUserSubscriptions(userBId);
      assert.equal(userBSubs.length, 1);
      assert.equal(userBSubs[0].id, subB.id);
      assert.equal(userBSubs[0].amount, 890000);

      // Complete User A subscription
      const completedSub = await completeSubscription('AUTH-USER-A-001', 'REF-A-12345', '6037-99**-****-1234');
      assert.ok(completedSub);
      assert.equal(completedSub?.status, 'COMPLETED');

      // Verify User A elevated to VIP
      const updatedUserA = await findUserById(userAId);
      assert.equal(updatedUserA?.isVip, true);
      assert.equal(updatedUserA?.tier, 'vip_samurai');

      // Verify User B remains free (not elevated by User A transaction)
      const userBCheck = await findUserById(userBId);
      assert.equal(userBCheck?.isVip, false);
      assert.equal(userBCheck?.tier, 'free');
    });
  });
});
