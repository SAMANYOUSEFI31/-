import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  memoryStore,
  findUserById,
  createSubscriptionRecord,
  completeSubscription,
  markSubscriptionFailed,
  findSubscriptionByAuthority,
  getUserSubscriptions,
  adminGetAllSubscriptions,
  adminGetOverviewStats,
  getPlanById,
  isValidPlanId,
  getAllPlans
} from '../server/db/index.js';
import { paymentRequestSchema, paymentVerifySchema } from '../server/utils/validation.js';

describe('Payment & Subscription Verification Idempotency Suite (Phase 2A.1 Unit & Fallback-Store Tests)', () => {
  const testUserId = 'test-user-payment-001';
  const testUserEmail = 'samurai.payment@bushido.test';

  beforeEach(() => {
    // Reset in-memory fallback store to isolate test cases
    memoryStore.users = [];
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.otpCodes = [];
    memoryStore.subscriptions = [];

    // Seed synthetic user fixture
    memoryStore.users.push({
      id: testUserId,
      email: testUserEmail,
      phoneNumber: '+989123334455',
      name: 'سامورایی تستی',
      role: 'FREE',
      tier: 'ronin_free',
      isVip: false,
      vipSince: null,
      vipExpiresAt: null,
      paymentRefId: null,
      isAdmin: false,
      nightOwlCutoffHour: 4,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
  });

  it('A. First successful completion: transitions PENDING to SUCCESS and elevates user VIP status', async () => {
    // Arrange: create one user and one PENDING subscription with synthetic fixtures
    const sub = await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_a',
      amount: 1000,
      authority: 'TEST_AUTH_IDEMPOTENCY_001',
      description: 'طرح تستی الف'
    });
    assert.equal(sub.status, 'PENDING');

    // Act: complete it with original payment proof
    const completed = await completeSubscription(
      'TEST_AUTH_IDEMPOTENCY_001',
      'ORIGINAL_REF',
      'ORIGINAL_CARD'
    );

    // Assert: status and payment proofs are persisted
    assert.ok(completed);
    assert.equal(completed.status, 'SUCCESS');
    assert.equal(completed.refId, 'ORIGINAL_REF');
    assert.equal(completed.cardPan, 'ORIGINAL_CARD');
    assert.ok(completed.expiresAt);

    // Assert: user becomes VIP with timestamps
    const user = await findUserById(testUserId);
    assert.ok(user);
    assert.equal(user.isVip, true);
    assert.equal(user.tier, 'vip_samurai');
    assert.ok(user.vipSince);
    assert.ok(user.vipExpiresAt);
    assert.equal(user.paymentRefId, 'ORIGINAL_REF');
  });

  it('B. Duplicate completion immutability: repeated completion cannot mutate original evidence or extend VIP', async () => {
    // Arrange: first successful completion
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_a',
      amount: 1000,
      authority: 'TEST_AUTH_IDEMPOTENCY_001',
      description: 'طرح تستی الف'
    });

    const firstCompletion = await completeSubscription(
      'TEST_AUTH_IDEMPOTENCY_001',
      'ORIGINAL_REF',
      'ORIGINAL_CARD'
    );
    assert.ok(firstCompletion);

    const subAfterFirst = (await getUserSubscriptions(testUserId))[0];
    const userAfterFirst = (await findUserById(testUserId))!;
    const statsAfterFirst = await adminGetOverviewStats();

    const originalRefId = subAfterFirst.refId;
    const originalCardPan = subAfterFirst.cardPan;
    const originalExpiresAt = subAfterFirst.expiresAt;
    const originalVipSince = userAfterFirst.vipSince;
    const originalVipExpiresAt = userAfterFirst.vipExpiresAt;
    const originalSubCount = (await getUserSubscriptions(testUserId)).length;
    const originalRevenue = statsAfterFirst.totalRevenueToman;

    // Act: duplicate completion attempt with different reference and card values
    const secondCompletion = await completeSubscription(
      'TEST_AUTH_IDEMPOTENCY_001',
      'ATTEMPTED_OVERWRITE_REF',
      'ATTEMPTED_OVERWRITE_CARD'
    );

    // Assert: returned object preserves original evidence
    assert.ok(secondCompletion);
    assert.equal(secondCompletion.status, 'SUCCESS');
    assert.equal(secondCompletion.refId, 'ORIGINAL_REF');
    assert.equal(secondCompletion.cardPan, 'ORIGINAL_CARD');

    // Assert: persisted storage remains strictly immutable
    const subAfterSecond = (await getUserSubscriptions(testUserId))[0];
    const userAfterSecond = (await findUserById(testUserId))!;
    const statsAfterSecond = await adminGetOverviewStats();
    const allSubsAfterSecond = await getUserSubscriptions(testUserId);

    assert.equal(subAfterSecond.refId, originalRefId);
    assert.equal(subAfterSecond.cardPan, originalCardPan);
    assert.equal(subAfterSecond.expiresAt, originalExpiresAt);
    assert.equal(userAfterSecond.vipSince, originalVipSince);
    assert.equal(userAfterSecond.vipExpiresAt, originalVipExpiresAt);
    assert.equal(allSubsAfterSecond.length, originalSubCount);
    assert.equal(statsAfterSecond.totalRevenueToman, originalRevenue);
  });

  it('C. Unknown authority: rejects unknown authority without modifying users or creating subscriptions', async () => {
    // Arrange: capture initial baseline
    const initialSubs = await adminGetAllSubscriptions();
    const initialStats = await adminGetOverviewStats();

    // Act: attempt completion on non-existent authority
    const result = await completeSubscription(
      'UNKNOWN_AUTHORITY_99999',
      'REF_UNKNOWN',
      'CARD_UNKNOWN'
    );

    // Assert: returns null
    assert.equal(result, null);

    // Assert: no side effects on subscriptions or revenue
    const subsAfter = await adminGetAllSubscriptions();
    const statsAfter = await adminGetOverviewStats();
    assert.equal(subsAfter.length, initialSubs.length);
    assert.equal(statsAfter.totalRevenueToman, initialStats.totalRevenueToman);

    // Assert: user remains non-VIP
    const user = await findUserById(testUserId);
    assert.equal(user?.isVip, false);
  });

  it('D. FAILED terminal behavior: a FAILED transaction cannot silently transition to SUCCESS', async () => {
    // Arrange: create a PENDING subscription and transition it to FAILED
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_d',
      amount: 1500,
      authority: 'TEST_AUTH_FAILED_001',
      description: 'طرح تستی شکست خورده'
    });

    const failed = await markSubscriptionFailed(
      'TEST_AUTH_FAILED_001',
      'خطای بانکی تستی'
    );
    assert.ok(failed);
    assert.equal(failed.status, 'FAILED');

    // Act: attempt completion on this FAILED transaction
    const completedAttempt = await completeSubscription(
      'TEST_AUTH_FAILED_001',
      'REF_ATTEMPT_AFTER_FAIL',
      'CARD_ATTEMPT_AFTER_FAIL'
    );

    // Assert: completion must return null (not transition)
    assert.equal(completedAttempt, null);

    // Assert: persisted status remains FAILED
    const subs = await getUserSubscriptions(testUserId);
    assert.equal(subs.length, 1);
    assert.equal(subs[0].status, 'FAILED');
    assert.equal(subs[0].refId, null);

    // Assert: user does not become VIP
    const user = await findUserById(testUserId);
    assert.equal(user?.isVip, false);
    assert.equal(user?.tier, 'ronin_free');

    // Assert: revenue does not include failed transaction
    const stats = await adminGetOverviewStats();
    assert.equal(stats.totalRevenueToman, 0);
  });

  it('E. Revenue behavior: revenue counts only SUCCESS transactions and ignores duplicates', async () => {
    // Arrange:
    // 1. One SUCCESS transaction for 1000
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_e1',
      amount: 1000,
      authority: 'TEST_AUTH_REV_SUCCESS'
    });
    await completeSubscription('TEST_AUTH_REV_SUCCESS', 'REF_REV_1', 'CARD_1');

    // 2. One PENDING transaction for 2000
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_e2',
      amount: 2000,
      authority: 'TEST_AUTH_REV_PENDING'
    });

    // 3. One FAILED transaction for 3000
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_e3',
      amount: 3000,
      authority: 'TEST_AUTH_REV_FAILED'
    });
    await markSubscriptionFailed('TEST_AUTH_REV_FAILED', 'رد تراکنش');

    // Assert: revenue strictly equals 1000
    const stats1 = await adminGetOverviewStats();
    assert.equal(stats1.totalRevenueToman, 1000);

    // Act: attempt duplicate verification of the SUCCESS transaction
    await completeSubscription('TEST_AUTH_REV_SUCCESS', 'REF_REV_DUPLICATE', 'CARD_2');

    // Assert: revenue remains 1000 (duplicate did not add revenue)
    const stats2 = await adminGetOverviewStats();
    assert.equal(stats2.totalRevenueToman, 1000);
  });

  it('F. Runtime status contract: real operations produce and return canonical uppercase statuses', async () => {
    // 1. Creation produces PENDING
    const subPending = await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_f1',
      amount: 500,
      authority: 'TEST_AUTH_CONTRACT_001'
    });
    assert.equal(subPending.status, 'PENDING');

    // 2. Successful completion produces SUCCESS
    const subSuccess = await completeSubscription(
      'TEST_AUTH_CONTRACT_001',
      'REF_CONTRACT_001',
      'CARD_001'
    );
    assert.ok(subSuccess);
    assert.equal(subSuccess.status, 'SUCCESS');

    // 3. Failure produces FAILED
    const subToFail = await createSubscriptionRecord({
      userId: testUserId,
      planId: 'test_plan_f2',
      amount: 700,
      authority: 'TEST_AUTH_CONTRACT_002'
    });
    const subFailed = await markSubscriptionFailed(
      'TEST_AUTH_CONTRACT_002',
      'تراکنش منقضی شد'
    );
    assert.ok(subFailed);
    assert.equal(subFailed.status, 'FAILED');

    // 4. Admin query returns canonical uppercase statuses
    const adminSubs = await adminGetAllSubscriptions();
    assert.equal(adminSubs.length, 2);

    const statuses = adminSubs.map(s => s.status);
    assert.deepEqual(statuses.sort(), ['FAILED', 'SUCCESS']);
    for (const st of statuses) {
      assert.ok(st === 'PENDING' || st === 'SUCCESS' || st === 'FAILED');
      assert.equal(st, st.toUpperCase());
    }
  });

  it('G. Obsolete literal detection: active payment & subscription source code does not contain obsolete status literals', () => {
    const paymentSourceFiles = [
      path.resolve(process.cwd(), 'server/db/subscriptions.ts'),
      path.resolve(process.cwd(), 'server/db/base.ts'),
      path.resolve(process.cwd(), 'server/db/index.ts'),
      path.resolve(process.cwd(), 'server.ts'),
      path.resolve(process.cwd(), 'src/types.ts'),
      path.resolve(process.cwd(), 'src/components/AdminView.tsx')
    ];

    // Obsolete status patterns to detect
    const forbiddenPatterns = [
      { name: 'COMPLETED literal', regex: /['"`]COMPLETED['"`]/ },
      { name: 'status === "success" comparison', regex: /status\s*===?\s*['"`]success['"`]/ },
      { name: 'status: "success" property', regex: /status\s*:\s*['"`]success['"`]/ }
    ];

    for (const filePath of paymentSourceFiles) {
      assert.ok(fs.existsSync(filePath), `Source file must exist: ${filePath}`);
      const content = fs.readFileSync(filePath, 'utf-8');

      for (const pattern of forbiddenPatterns) {
        const match = content.match(pattern.regex);
        assert.equal(
          match,
          null,
          `Forbidden obsolete status literal '${pattern.name}' found in ${path.relative(process.cwd(), filePath)}: match="${match?.[0]}"`
        );
      }
    }
  });

  describe('Phase 2C: Authoritative Plan Trust Boundary & Duration Fulfillment', () => {
    it('H. Plan catalog integrity: plans are authoritative, immutable, and accurately typed', () => {
      const allPlans = getAllPlans();
      assert.ok(allPlans.length >= 2, 'Should have at least 90-day and annual plans');

      const plan90 = getPlanById('samurai_90days');
      assert.ok(plan90, 'samurai_90days must exist in authoritative catalog');
      assert.equal(plan90.priceToman, 199000);
      assert.equal(plan90.durationDays, 90);
      assert.equal(plan90.durationMonths, 3);
      assert.equal(plan90.tier, 'vip_samurai');

      const planAnnual = getPlanById('samurai_annual');
      assert.ok(planAnnual, 'samurai_annual must exist in authoritative catalog');
      assert.equal(planAnnual.priceToman, 590000);
      assert.equal(planAnnual.durationDays, 365);
      assert.equal(planAnnual.durationMonths, 12);
      assert.equal(planAnnual.tier, 'vip_samurai');

      assert.equal(isValidPlanId('samurai_90days'), true);
      assert.equal(isValidPlanId('samurai_annual'), true);
      assert.equal(isValidPlanId('invalid_hacker_plan'), false);
      assert.equal(getPlanById('non_existent'), null);
    });

    it('I. Fulfillment duration accuracy: samurai_90days yields 90-day VIP and samurai_annual yields 365-day VIP', async () => {
      // 1. Test 90-day fulfillment
      const nowBefore = Date.now();
      await createSubscriptionRecord({
        userId: testUserId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_TEST_90DAYS'
      });

      const completed90 = await completeSubscription('AUTH_TEST_90DAYS', 'REF_90', 'CARD_90');
      assert.ok(completed90);
      assert.equal(completed90.status, 'SUCCESS');
      assert.ok(completed90.expiresAt);

      const expDate90 = new Date(completed90.expiresAt).getTime();
      const diffDays90 = Math.round((expDate90 - nowBefore) / (86400000));
      assert.equal(diffDays90, 90, 'Fulfillment duration for 90-day plan must be exactly 90 days');

      const user90 = await findUserById(testUserId);
      assert.ok(user90);
      assert.equal(user90.isVip, true);
      assert.equal(user90.tier, 'vip_samurai');
      assert.equal(user90.vipExpiresAt, completed90.expiresAt);

      // 2. Test Annual fulfillment
      const nowBeforeAnnual = Date.now();
      await createSubscriptionRecord({
        userId: testUserId,
        planId: 'samurai_annual',
        amount: 590000,
        authority: 'AUTH_TEST_ANNUAL'
      });

      const completedAnnual = await completeSubscription('AUTH_TEST_ANNUAL', 'REF_ANNUAL', 'CARD_ANNUAL');
      assert.ok(completedAnnual);
      assert.equal(completedAnnual.status, 'SUCCESS');
      assert.ok(completedAnnual.expiresAt);

      const expDateAnnual = new Date(completedAnnual.expiresAt).getTime();
      const diffDaysAnnual = Math.round((expDateAnnual - nowBeforeAnnual) / (86400000));
      assert.equal(diffDaysAnnual, 365, 'Fulfillment duration for annual plan must be exactly 365 days');

      const userAnnual = await findUserById(testUserId);
      assert.ok(userAnnual);
      assert.equal(userAnnual.vipExpiresAt, completedAnnual.expiresAt);
    });

    it('J. Schema validation & input protection: accepts valid planId, optional amount, rejects malformed payloads', () => {
      // Valid minimal payload with planId only (no client-supplied amount)
      const validMin = paymentRequestSchema.safeParse({
        planId: 'samurai_90days'
      });
      assert.equal(validMin.success, true);
      if (validMin.success) {
        assert.equal(validMin.data.planId, 'samurai_90days');
        assert.equal(validMin.data.amount, undefined);
      }

      // Valid payload with planId and matching amount
      const validWithAmount = paymentRequestSchema.safeParse({
        planId: 'samurai_annual',
        amount: 590000,
        description: 'تست خرید سالانه'
      });
      assert.equal(validWithAmount.success, true);

      // Rejects empty planId
      const emptyPlan = paymentRequestSchema.safeParse({
        planId: ''
      });
      assert.equal(emptyPlan.success, false);

      // Rejects zero or negative amount if provided
      const negativeAmount = paymentRequestSchema.safeParse({
        planId: 'samurai_90days',
        amount: -100
      });
      assert.equal(negativeAmount.success, false);

      const zeroAmount = paymentRequestSchema.safeParse({
        planId: 'samurai_90days',
        amount: 0
      });
      assert.equal(zeroAmount.success, false);

      // Verification schema accepts authority and ignores/safely parses amount
      const validVerify = paymentVerifySchema.safeParse({
        authority: 'AUTH_12345678'
      });
      assert.equal(validVerify.success, true);
    });
  });

  describe('Phase 3A.4: Subscription & Payment Ownership Boundaries Suite', () => {
    const userAId = 'user-samurai-alice';
    const userBId = 'user-samurai-bob';

    beforeEach(() => {
      memoryStore.users = [
        {
          id: userAId,
          email: 'alice@bushido.test',
          phoneNumber: '+989121111111',
          name: 'آلیس سامورایی',
          role: 'FREE',
          tier: 'ronin_free',
          isVip: false,
          vipSince: null,
          vipExpiresAt: null,
          paymentRefId: null,
          isAdmin: false,
          nightOwlCutoffHour: 4,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        {
          id: userBId,
          email: 'bob@bushido.test',
          phoneNumber: '+989122222222',
          name: 'باب رونین',
          role: 'FREE',
          tier: 'ronin_free',
          isVip: false,
          vipSince: null,
          vipExpiresAt: null,
          paymentRefId: null,
          isAdmin: false,
          nightOwlCutoffHour: 4,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      ];
      memoryStore.subscriptions = [];
    });

    it('K. User A cannot read or access User B subscription records via getUserSubscriptions', async () => {
      // Create subscription owned strictly by User A
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 290000,
        authority: 'AUTH_ALICE_SECRET_01',
        description: 'طرح سه ماهه آلیس'
      });

      // Create subscription owned strictly by User B
      await createSubscriptionRecord({
        userId: userBId,
        planId: 'samurai_annual',
        amount: 590000,
        authority: 'AUTH_BOB_SECRET_02',
        description: 'طرح سالانه باب'
      });

      // Query User A subscriptions: must strictly only return User A records
      const aliceSubs = await getUserSubscriptions(userAId);
      assert.equal(aliceSubs.length, 1);
      assert.equal(aliceSubs[0].userId, userAId);
      assert.equal(aliceSubs[0].authority, 'AUTH_ALICE_SECRET_01');

      // Query User B subscriptions: must strictly only return User B records
      const bobSubs = await getUserSubscriptions(userBId);
      assert.equal(bobSubs.length, 1);
      assert.equal(bobSubs[0].userId, userBId);
      assert.equal(bobSubs[0].authority, 'AUTH_BOB_SECRET_02');

      // Verify no cross-tenant leakage
      assert.ok(!aliceSubs.some(s => s.userId === userBId));
      assert.ok(!bobSubs.some(s => s.userId === userAId));
    });

    it('L. Direct lookup findSubscriptionByAuthority returns correct record with owner identity', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 290000,
        authority: 'AUTH_DIRECT_LOOKUP_100',
        description: 'تست جستجوی مستقیم شناسه'
      });

      const found = await findSubscriptionByAuthority('AUTH_DIRECT_LOOKUP_100');
      assert.ok(found);
      assert.equal(found.userId, userAId);
      assert.equal(found.amount, 290000);
      assert.equal(found.status, 'PENDING');

      // Non-existent authority returns null
      const nonExistent = await findSubscriptionByAuthority('AUTH_NON_EXISTENT_999');
      assert.equal(nonExistent, null);
    });

    it('M. Completing User A subscription elevates only User A and leaves User B untouched', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_annual',
        amount: 590000,
        authority: 'AUTH_ALICE_ANNUAL_01',
        description: 'ارتقا سالانه آلیس'
      });

      const completed = await completeSubscription('AUTH_ALICE_ANNUAL_01', 'REF_ALICE_100', '6037-99**-****-1111');
      assert.ok(completed);
      assert.equal(completed.status, 'SUCCESS');
      assert.equal(completed.userId, userAId);

      // Verify User A profile is elevated to VIP
      const aliceProfile = await findUserById(userAId);
      assert.ok(aliceProfile);
      assert.equal(aliceProfile.isVip, true);
      assert.equal(aliceProfile.tier, 'vip_samurai');
      assert.equal(aliceProfile.paymentRefId, 'REF_ALICE_100');

      // Verify User B profile remains unchanged (Free Ronin)
      const bobProfile = await findUserById(userBId);
      assert.ok(bobProfile);
      assert.equal(bobProfile.isVip, false);
      assert.equal(bobProfile.tier, 'ronin_free');
      assert.equal(bobProfile.vipSince, null);
      assert.equal(bobProfile.vipExpiresAt, null);
      assert.equal(bobProfile.paymentRefId, null);
    });
  });
});
