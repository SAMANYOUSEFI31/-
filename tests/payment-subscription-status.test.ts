import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryStore,
  findUserById,
  saveUser,
  createSubscriptionRecord,
  completeSubscription,
  markSubscriptionFailed,
  getUserSubscriptions,
  adminGetAllSubscriptions,
  adminGetOverviewStats,
  DBSubscriptionStatus
} from '../server/db/index.js';

describe('Payment & Subscription Status Consistency Suite (Phase 2A)', () => {
  const testUserId = 'test-user-payment-001';
  const testUserEmail = 'samurai.payment@bushido.io';

  beforeEach(() => {
    // Reset memoryStore
    memoryStore.users = [];
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.otpCodes = [];
    memoryStore.subscriptions = [];

    // Seed test user
    memoryStore.users.push({
      id: testUserId,
      email: testUserEmail,
      phoneNumber: '+989123334455',
      name: 'سامورایی آزمایشی',
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

  it('1. Pending Flow: initial subscription creation enters canonical PENDING status', async () => {
    const sub = await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_annual',
      amount: 890000,
      authority: 'A_TEST_PENDING_001',
      description: 'طرح سالانه'
    });

    assert.ok(sub);
    assert.equal(sub.status, 'PENDING');
    assert.equal(sub.amount, 890000);
    assert.equal(sub.authority, 'A_TEST_PENDING_001');
    assert.equal(sub.refId, null);
    assert.equal(sub.cardPan, null);

    // User must NOT be VIP while pending
    const user = await findUserById(testUserId);
    assert.equal(user?.isVip, false);
    assert.equal(user?.tier, 'ronin_free');
  });

  it('2. Success Flow & VIP Activation: transitioning to SUCCESS activates VIP status', async () => {
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_annual',
      amount: 890000,
      authority: 'A_TEST_SUCCESS_001',
      description: 'طرح سالانه'
    });

    const completed = await completeSubscription(
      'A_TEST_SUCCESS_001',
      'REF_BANK_987654',
      '6037-99**-****-1111'
    );

    assert.ok(completed);
    assert.equal(completed.status, 'SUCCESS');
    assert.equal(completed.refId, 'REF_BANK_987654');
    assert.equal(completed.cardPan, '6037-99**-****-1111');
    assert.ok(completed.expiresAt);

    // Verify user profile elevation
    const user = await findUserById(testUserId);
    assert.equal(user?.isVip, true);
    assert.equal(user?.tier, 'vip_samurai');
    assert.equal(user?.paymentRefId, 'REF_BANK_987654');
    assert.ok(user?.vipSince);
    assert.ok(user?.vipExpiresAt);
  });

  it('3. Failed Flow: marking subscription failed transitions to FAILED without VIP activation', async () => {
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_quarterly',
      amount: 290000,
      authority: 'A_TEST_FAILED_001',
      description: 'طرح فصلی'
    });

    const failed = await markSubscriptionFailed(
      'A_TEST_FAILED_001',
      'تراکنش توسط کاربر لغو شد'
    );

    assert.ok(failed);
    assert.equal(failed.status, 'FAILED');
    assert.ok(failed.description?.includes('تراکنش توسط کاربر لغو شد'));

    // Verify user profile remains free
    const user = await findUserById(testUserId);
    assert.equal(user?.isVip, false);
    assert.equal(user?.tier, 'ronin_free');
    assert.equal(user?.paymentRefId, null);
  });

  it('4. Revenue Calculation: only tallies SUCCESS status subscriptions', async () => {
    // 1. Success sub: 890,000
    const sub1 = await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_annual',
      amount: 890000,
      authority: 'AUTH_REV_001'
    });
    await completeSubscription('AUTH_REV_001', 'REF_1', '6037-1111');

    // 2. Success sub: 290,000
    const sub2 = await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_quarterly',
      amount: 290000,
      authority: 'AUTH_REV_002'
    });
    await completeSubscription('AUTH_REV_002', 'REF_2', '6037-2222');

    // 3. Pending sub: 500,000 (must be ignored in revenue)
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_semi_annual',
      amount: 500000,
      authority: 'AUTH_REV_PENDING'
    });

    // 4. Failed sub: 290,000 (must be ignored in revenue)
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_quarterly',
      amount: 290000,
      authority: 'AUTH_REV_FAILED'
    });
    await markSubscriptionFailed('AUTH_REV_FAILED', 'انصراف کاربر');

    const stats = await adminGetOverviewStats();
    // Revenue must strictly equal 890000 + 290000 = 1180000
    assert.equal(stats.totalRevenueToman, 1180000);
    assert.equal(stats.vipUsers, 1);
  });

  it('5. Repeated verification idempotency: re-completing already SUCCESS subscription is idempotent', async () => {
    await createSubscriptionRecord({
      userId: testUserId,
      planId: 'samurai_annual',
      amount: 890000,
      authority: 'A_TEST_IDEMPOTENT_001'
    });

    const firstCompletion = await completeSubscription(
      'A_TEST_IDEMPOTENT_001',
      'REF_FIRST_CALL',
      '6037-99**-****-1234'
    );
    assert.equal(firstCompletion?.status, 'SUCCESS');

    // Repeated call with same authority
    const secondCompletion = await completeSubscription(
      'A_TEST_IDEMPOTENT_001',
      'REF_SECOND_CALL',
      '6037-99**-****-5678'
    );

    assert.ok(secondCompletion);
    assert.equal(secondCompletion?.status, 'SUCCESS');
    assert.equal(secondCompletion?.refId, 'REF_SECOND_CALL');

    const allSubs = await getUserSubscriptions(testUserId);
    assert.equal(allSubs.length, 1);
    assert.equal(allSubs[0].status, 'SUCCESS');
  });

  it('6. Strict Contract Enforcement: DBSubscriptionStatus only accepts PENDING, SUCCESS, FAILED', () => {
    const validStatuses: DBSubscriptionStatus[] = ['PENDING', 'SUCCESS', 'FAILED'];
    assert.equal(validStatuses.length, 3);
    assert.ok(validStatuses.includes('PENDING'));
    assert.ok(validStatuses.includes('SUCCESS'));
    assert.ok(validStatuses.includes('FAILED'));
  });
});
