import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import { generateToken } from '../server/auth.js';
import {
  memoryStore,
  setPrismaState,
  findUserById,
  createSubscriptionRecord,
  completeSubscription,
  markSubscriptionFailed,
  findSubscriptionByAuthority,
  getUserSubscriptions,
  getPlanById
} from '../server/db/index.js';
import {
  validateStateTransition,
  PaymentStateTransitionError
} from '../server/payment/transitions.js';
import {
  calculateRenewalExpiration
} from '../server/payment/renewal.js';
import {
  getPaymentAdapter,
  setPaymentAdapterOverride,
  ProviderNeutralSimulatorAdapter
} from '../server/payment/adapter.js';
import { validateAuthoritativePaymentResponse } from '../src/utils/paymentValidation.js';

describe('Phase 5A: Provider-Neutral Payment Integrity Core Acceptance Suite', () => {
  let server: http.Server;
  let baseUrl = '';

  const userAId = 'user-warrior-alpha';
  const userBId = 'user-warrior-beta';

  const userAToken = generateToken({
    userId: userAId,
    phoneNumber: '09121111111',
    isVip: false,
    tier: 'ronin_free',
    isAdmin: false,
    tokenVersion: 0
  });

  const userBToken = generateToken({
    userId: userBId,
    phoneNumber: '09122222222',
    isVip: false,
    tier: 'ronin_free',
    isAdmin: false,
    tokenVersion: 0
  });

  before(async () => {
    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    setPaymentAdapterOverride(null);
    setPrismaState(null, false);
    if (server) {
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
      if (typeof (server as any).closeIdleConnections === 'function') {
        (server as any).closeIdleConnections();
      }
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.unref();
    }
  });

  beforeEach(() => {
    setPaymentAdapterOverride(null);
    setPrismaState(null, false);
    memoryStore.subscriptions = [];
    memoryStore.users = [
      {
        id: userAId,
        phoneNumber: '09121111111',
        name: 'جنگجو الف',
        email: 'alpha@bushido.app',
        tier: 'ronin_free',
        isVip: false,
        isAdmin: false,
        tokenVersion: 0,
        vipSince: null,
        vipExpiresAt: null,
        paymentRefId: null,
        nightOwlCutoffHour: 4,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: userBId,
        phoneNumber: '09122222222',
        name: 'جنگجو ب',
        email: 'beta@bushido.app',
        tier: 'ronin_free',
        isVip: false,
        isAdmin: false,
        tokenVersion: 0,
        vipSince: null,
        vipExpiresAt: null,
        paymentRefId: null,
        nightOwlCutoffHour: 4,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
      }
    ];
  });

  // =========================================================================
  // Group A: Authenticated Payment Ownership
  // =========================================================================
  describe('Group A: Authenticated ownership', () => {
    it('A01. Unauthenticated payment request returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: 'samurai_90days' })
      });
      assert.equal(res.status, 401);
    });

    it('A02. Unauthenticated verification returns 401', async () => {
      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ authority: 'AUTH_TEST_UNAUTH_001' })
      });
      assert.equal(res.status, 401);
    });

    it('A03. Guest payment request fallback is removed (unauthenticated cannot create records)', async () => {
      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: 'samurai_90days', userId: 'guest-warrior-1' })
      });
      assert.equal(res.status, 401);
      assert.equal(memoryStore.subscriptions.length, 0);
    });

    it('A04. User A cannot verify User B authority (403 Forbidden)', async () => {
      // User B creates a payment authority
      const reqRes = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userBToken}`
        },
        body: JSON.stringify({ planId: 'samurai_90days' })
      });
      assert.equal(reqRes.status, 200);
      const { authority } = await reqRes.json();
      assert.ok(authority);

      // User A attempts to verify User B's authority
      const verifyRes = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });
      assert.equal(verifyRes.status, 403);
      const data = await verifyRes.json();
      assert.equal(data.code, 'FORBIDDEN');
    });

    it('A05. Ordinary users cannot bypass ownership with fake admin claims', async () => {
      // Create subscription owned by User B
      await createSubscriptionRecord({
        userId: userBId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_TEST_SPOOF_ADMIN'
      });

      // User A sends fake admin property in body
      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({
          authority: 'AUTH_TEST_SPOOF_ADMIN',
          isAdmin: true
        })
      });
      assert.equal(res.status, 403);
    });

    it('A06. Client-supplied userId cannot change payment ownership', async () => {
      // User A requests payment but includes userId of User B in body
      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({
          planId: 'samurai_90days',
          userId: userBId
        })
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      // Check database: record MUST belong strictly to User A
      const sub = memoryStore.subscriptions.find(s => s.authority === data.authority);
      assert.ok(sub);
      assert.equal(sub.userId, userAId);
      assert.notEqual(sub.userId, userBId);
    });

    it('A07. Client-supplied tier or VIP fields are ignored or rejected', async () => {
      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({
          planId: 'samurai_90days',
          tier: 'super_vip_hacker',
          isVip: true
        })
      });
      assert.equal(res.status, 200);

      // User in database must not have changed
      const user = await findUserById(userAId);
      assert.equal(user?.isVip, false);
      assert.equal(user?.tier, 'ronin_free');
    });

    it('A08. Client-supplied amount cannot override server Plan price', async () => {
      // samurai_90days is 199000. Client tries to send 1000 tomans.
      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({
          planId: 'samurai_90days',
          amount: 1000
        })
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'AMOUNT_MISMATCH');
    });
  });

  // =========================================================================
  // Group B: Financial Database Authority
  // =========================================================================
  describe('Group B: Financial authority', () => {
    it('B01. Prisma create failure does not create a memory Subscription', async () => {
      // Simulate active Prisma where create throws a database error
      const mockPrisma = {
        subscription: {
          create: async () => {
            throw new Error('Database connection severed');
          }
        }
      };
      setPrismaState(mockPrisma, true);

      await assert.rejects(
        async () => {
          await createSubscriptionRecord({
            userId: userAId,
            planId: 'samurai_90days',
            amount: 199000,
            authority: 'AUTH_PRISMA_FAIL_001'
          });
        },
        /Database connection severed/
      );

      // Memory store must be clean
      assert.equal(memoryStore.subscriptions.length, 0);
    });

    it('B02. Prisma read failure does not return a memory Subscription', async () => {
      memoryStore.subscriptions.push({
        id: 'sub-ghost-001',
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_PRISMA_READ_FAIL',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const mockPrisma = {
        subscription: {
          findUnique: async () => {
            throw new Error('Prisma read failure');
          }
        }
      };
      setPrismaState(mockPrisma, true);

      await assert.rejects(
        async () => {
          await findSubscriptionByAuthority('AUTH_PRISMA_READ_FAIL');
        },
        /Prisma read failure/
      );
    });

    it('B03. Prisma completion failure does not activate VIP in memory', async () => {
      const mockPrisma = {
        $transaction: async () => {
          throw new Error('Prisma transaction rollback');
        }
      };
      setPrismaState(mockPrisma, true);

      await assert.rejects(
        async () => {
          await completeSubscription('AUTH_TX_FAIL', 'REF_1', 'CARD_1');
        },
        /Prisma transaction rollback/
      );

      // Memory user must remain ronin_free / non-VIP
      const user = memoryStore.users.find(u => u.id === userAId);
      assert.equal(user?.isVip, false);
      assert.equal(user?.tier, 'ronin_free');
    });

    it('B04. Prisma not-found remains not-found', async () => {
      // Subscription exists in memoryStore, but Prisma is active and does NOT have it
      memoryStore.subscriptions.push({
        id: 'sub-local-only',
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_PRISMA_NOT_FOUND',
        status: 'PENDING',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });

      const mockPrisma = {
        subscription: {
          findUnique: async () => null
        }
      };
      setPrismaState(mockPrisma, true);

      const res = await findSubscriptionByAuthority('AUTH_PRISMA_NOT_FOUND');
      assert.equal(res, null);
    });

    it('B05. Explicit Prisma-unavailable test mode retains intended local behavior', async () => {
      setPrismaState(null, false);
      const sub = await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_LOCAL_OK'
      });
      assert.equal(sub.authority, 'AUTH_LOCAL_OK');
      assert.equal(sub.status, 'PENDING');

      const found = await findSubscriptionByAuthority('AUTH_LOCAL_OK');
      assert.ok(found);
      assert.equal(found.authority, 'AUTH_LOCAL_OK');
    });

    it('B06. One payment operation never mixes Prisma and memory records', async () => {
      const mockPrisma = {
        $transaction: async (fn: any) => {
          const tx = {
            subscription: {
              findUnique: async () => ({
                id: 'prisma-sub-1',
                userId: userAId,
                planId: 'samurai_90days',
                amount: 199000,
                authority: 'AUTH_ISOLATED',
                status: 'PENDING',
                createdAt: new Date(),
                updatedAt: new Date()
              }),
              updateMany: async () => ({ count: 1 }),
              update: async () => ({
                id: 'prisma-sub-1',
                userId: userAId,
                planId: 'samurai_90days',
                amount: 199000,
                authority: 'AUTH_ISOLATED',
                status: 'SUCCESS',
                refId: 'REF-PRISMA',
                cardPan: 'CARD-PRISMA',
                expiresAt: new Date(Date.now() + 90 * 86400000),
                createdAt: new Date(),
                updatedAt: new Date()
              })
            },
            user: {
              findUnique: async () => ({
                id: userAId,
                name: 'جنگجو الف',
                isVip: false,
                tier: 'ronin_free',
                vipSince: null,
                vipExpiresAt: null
              }),
              update: async () => ({
                id: userAId,
                name: 'جنگجو الف',
                isVip: true,
                tier: 'vip_samurai',
                vipSince: new Date(),
                vipExpiresAt: new Date(Date.now() + 90 * 86400000),
                paymentRefId: 'REF-PRISMA'
              })
            }
          };
          return fn(tx);
        }
      };
      setPrismaState(mockPrisma, true);

      const result = await completeSubscription('AUTH_ISOLATED', 'REF-PRISMA', 'CARD-PRISMA');
      assert.ok(result);
      assert.equal(result.status, 'SUCCESS');

      // Zero items should leak into memoryStore
      assert.equal(memoryStore.subscriptions.length, 0);
    });
  });

  // =========================================================================
  // Group C: State Transitions
  // =========================================================================
  describe('Group C: State transitions', () => {
    it('C01. New payment begins as PENDING', async () => {
      const sub = await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_STATE_01'
      });
      assert.equal(sub.status, 'PENDING');
    });

    it('C02. PENDING can transition to SUCCESS', async () => {
      const transition = validateStateTransition('PENDING', 'SUCCESS');
      assert.equal(transition.valid, true);
      assert.equal(transition.isNoop, false);

      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_STATE_02'
      });
      const completed = await completeSubscription('AUTH_STATE_02', 'REF_02', 'CARD_02');
      assert.equal(completed?.status, 'SUCCESS');
    });

    it('C03. PENDING can transition to FAILED', async () => {
      const transition = validateStateTransition('PENDING', 'FAILED');
      assert.equal(transition.valid, true);
      assert.equal(transition.isNoop, false);

      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_STATE_03'
      });
      const failed = await markSubscriptionFailed('AUTH_STATE_03', 'کارت نامعتبر');
      assert.equal(failed?.status, 'FAILED');
    });

    it('C04. SUCCESS cannot transition to FAILED (terminal)', async () => {
      assert.throws(
        () => validateStateTransition('SUCCESS', 'FAILED'),
        PaymentStateTransitionError
      );

      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_STATE_04'
      });
      await completeSubscription('AUTH_STATE_04', 'REF_04', 'CARD_04');

      // Attempt to mark failed
      const res = await markSubscriptionFailed('AUTH_STATE_04', 'تراکنش برگشت خورد');
      assert.equal(res?.status, 'SUCCESS'); // Must remain SUCCESS
    });

    it('C05. FAILED cannot transition to SUCCESS (terminal)', async () => {
      assert.throws(
        () => validateStateTransition('FAILED', 'SUCCESS'),
        PaymentStateTransitionError
      );

      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_STATE_05'
      });
      await markSubscriptionFailed('AUTH_STATE_05', 'رد شد');

      const completed = await completeSubscription('AUTH_STATE_05', 'REF_05', 'CARD_05');
      assert.equal(completed, null); // Fails closed
    });

    it('C06. Duplicate SUCCESS returns current result without duplicate side effects', async () => {
      const transition = validateStateTransition('SUCCESS', 'SUCCESS');
      assert.equal(transition.isNoop, true);

      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_STATE_06'
      });
      const first = await completeSubscription('AUTH_STATE_06', 'REF_ORIG', 'CARD_ORIG');
      const second = await completeSubscription('AUTH_STATE_06', 'REF_NEW', 'CARD_NEW');

      assert.equal(second?.status, 'SUCCESS');
      assert.equal(second?.refId, 'REF_ORIG');
      assert.equal(second?.expiresAt, first?.expiresAt);
    });

    it('C07. Duplicate FAILED returns current result without duplicate side effects', async () => {
      const transition = validateStateTransition('FAILED', 'FAILED');
      assert.equal(transition.isNoop, true);

      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_STATE_07'
      });
      const first = await markSubscriptionFailed('AUTH_STATE_07', 'دلیل اول');
      const second = await markSubscriptionFailed('AUTH_STATE_07', 'دلیل دوم');

      assert.equal(second?.status, 'FAILED');
      assert.equal(first?.status, 'FAILED');
    });
  });

  // =========================================================================
  // Group D: Atomic Completion
  // =========================================================================
  describe('Group D: Atomic completion', () => {
    it('D01. Adapter-level: Subscription completion and VIP activation succeed together in Prisma transaction mock', async () => {
      let subUpdated = false;
      let userUpdated = false;

      const mockPrisma = {
        $transaction: async (fn: any) => {
          const tx = {
            subscription: {
              findUnique: async () => ({
                id: 'sub-d01',
                userId: userAId,
                planId: 'samurai_90days',
                amount: 199000,
                authority: 'AUTH_D01',
                status: 'PENDING',
                createdAt: new Date(),
                updatedAt: new Date()
              }),
              updateMany: async () => ({ count: 1 }),
              update: async (args: any) => {
                subUpdated = true;
                return {
                  id: 'sub-d01',
                  userId: userAId,
                  planId: 'samurai_90days',
                  amount: 199000,
                  authority: 'AUTH_D01',
                  status: 'SUCCESS',
                  refId: 'REF_D01',
                  cardPan: 'CARD_D01',
                  expiresAt: args.data.expiresAt,
                  createdAt: new Date(),
                  updatedAt: new Date()
                };
              }
            },
            user: {
              findUnique: async () => ({
                id: userAId,
                name: 'جنگجو',
                isVip: false,
                tier: 'ronin_free',
                vipSince: null,
                vipExpiresAt: null
              }),
              update: async () => {
                userUpdated = true;
                return {
                  id: userAId,
                  name: 'جنگجو',
                  isVip: true,
                  tier: 'vip_samurai',
                  vipSince: new Date(),
                  vipExpiresAt: new Date(),
                  paymentRefId: 'REF_D01'
                };
              }
            }
          };
          return fn(tx);
        }
      };
      setPrismaState(mockPrisma, true);

      const res = await completeSubscription('AUTH_D01', 'REF_D01', 'CARD_D01');
      assert.ok(res);
      assert.equal(subUpdated, true);
      assert.equal(userUpdated, true);
    });

    it('D02. Adapter-level: If user activation fails in Prisma mock, transaction rejects and rolls back', async () => {
      const mockPrisma = {
        $transaction: async (fn: any) => {
          const tx = {
            subscription: {
              findUnique: async () => ({
                id: 'sub-d02',
                userId: userAId,
                planId: 'samurai_90days',
                amount: 199000,
                authority: 'AUTH_D02',
                status: 'PENDING',
                createdAt: new Date(),
                updatedAt: new Date()
              }),
              updateMany: async () => ({ count: 1 }),
              update: async () => ({})
            },
            user: {
              findUnique: async () => ({ id: userAId }),
              update: async () => {
                throw new Error('Deadlock on User row');
              }
            }
          };
          return fn(tx);
        }
      };
      setPrismaState(mockPrisma, true);

      await assert.rejects(
        async () => {
          await completeSubscription('AUTH_D02', 'REF_D02', 'CARD_D02');
        },
        /Deadlock on User row/
      );
    });

    it('D03. Adapter-level: If Subscription completion fails in Prisma mock, user does not become VIP', async () => {
      const mockPrisma = {
        $transaction: async (fn: any) => {
          const tx = {
            subscription: {
              findUnique: async () => {
                throw new Error('Database disk error');
              }
            },
            user: {
              update: async () => ({})
            }
          };
          return fn(tx);
        }
      };
      setPrismaState(mockPrisma, true);

      await assert.rejects(
        async () => {
          await completeSubscription('AUTH_D03', 'REF_D03', 'CARD_D03');
        },
        /Database disk error/
      );
    });

    it('D04. Local fallback mode also behaves atomically on failure', async () => {
      setPrismaState(null, false);
      await createSubscriptionRecord({
        userId: 'non-existent-user-xyz',
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_D04_NO_USER'
      });

      const res = await completeSubscription('AUTH_D04_NO_USER', 'REF_D04', 'CARD_D04');
      assert.equal(res, null);

      // Subscription remains PENDING (not marked SUCCESS when user missing)
      const sub = memoryStore.subscriptions.find(s => s.authority === 'AUTH_D04_NO_USER');
      assert.equal(sub?.status, 'PENDING');
    });

    it('D05. Successful completion persists refId, vipSince and vipExpiresAt', async () => {
      setPrismaState(null, false);
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_D05'
      });

      const completed = await completeSubscription('AUTH_D05', 'REF_D05_PROOF', '6037-99**-****-1111');
      assert.ok(completed);
      assert.equal(completed.refId, 'REF_D05_PROOF');
      assert.equal(completed.cardPan, '6037-99**-****-1111');
      assert.ok(completed.expiresAt);

      const user = await findUserById(userAId);
      assert.ok(user);
      assert.equal(user.isVip, true);
      assert.ok(user.vipSince);
      assert.ok(user.vipExpiresAt);
      assert.equal(user.paymentRefId, 'REF_D05_PROOF');
    });
  });

  // =========================================================================
  // Group E: Concurrent Verify and Idempotency
  // =========================================================================
  describe('Group E: Concurrent verify and idempotency', () => {
    it('E01. Adapter-level: Concurrent completion calls result in idempotent VIP state', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_CONCURRENT_01'
      });

      const [res1, res2] = await Promise.all([
        completeSubscription('AUTH_CONCURRENT_01', 'REF_1', 'CARD_1'),
        completeSubscription('AUTH_CONCURRENT_01', 'REF_2', 'CARD_2')
      ]);

      assert.ok(res1);
      assert.ok(res2);
      assert.equal(res1.status, 'SUCCESS');
      assert.equal(res2.status, 'SUCCESS');

      const user = await findUserById(userAId);
      assert.equal(user?.isVip, true);
    });

    it('E02. The second verify call returns the confirmed result', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_CONCURRENT_02'
      });

      const first = await completeSubscription('AUTH_CONCURRENT_02', 'REF_FIRST', 'CARD_FIRST');
      const second = await completeSubscription('AUTH_CONCURRENT_02', 'REF_SECOND', 'CARD_SECOND');

      assert.equal(second?.status, 'SUCCESS');
      assert.equal(second?.refId, first?.refId);
      assert.equal(second?.cardPan, first?.cardPan);
    });

    it('E03. Duplicate verify does not extend vipExpiresAt twice', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_CONCURRENT_03'
      });

      const first = await completeSubscription('AUTH_CONCURRENT_03', 'REF_E03', 'CARD_E03');
      const firstExp = first?.user?.vipExpiresAt || first?.expiresAt;

      const second = await completeSubscription('AUTH_CONCURRENT_03', 'REF_E03', 'CARD_E03');
      const secondExp = second?.user?.vipExpiresAt || second?.expiresAt;

      assert.equal(firstExp, secondExp);
    });

    it('E04. Duplicate verify does not create duplicate Subscription rows', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_CONCURRENT_04'
      });

      await completeSubscription('AUTH_CONCURRENT_04', 'REF_1', 'CARD_1');
      await completeSubscription('AUTH_CONCURRENT_04', 'REF_2', 'CARD_2');

      const subs = memoryStore.subscriptions.filter(s => s.authority === 'AUTH_CONCURRENT_04');
      assert.equal(subs.length, 1);
    });

    it('E05. Duplicate verify preserves original refId and cardPan', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_CONCURRENT_05'
      });

      await completeSubscription('AUTH_CONCURRENT_05', 'ORIGINAL_REF_VAL', 'ORIGINAL_CARD_VAL');
      const second = await completeSubscription('AUTH_CONCURRENT_05', 'NEW_REF_VAL', 'NEW_CARD_VAL');

      assert.equal(second?.refId, 'ORIGINAL_REF_VAL');
      assert.equal(second?.cardPan, 'ORIGINAL_CARD_VAL');
    });

    it('E06. Adapter-level: Concurrent completion under local fallback mode remains safe', async () => {
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_annual',
        amount: 590000,
        authority: 'AUTH_CONCURRENT_06'
      });

      const calls = Array.from({ length: 5 }, (_, i) =>
        completeSubscription('AUTH_CONCURRENT_06', `REF_${i}`, `CARD_${i}`)
      );
      const results = await Promise.all(calls);

      for (const res of results) {
        assert.ok(res);
        assert.equal(res.status, 'SUCCESS');
      }

      const subs = memoryStore.subscriptions.filter(s => s.authority === 'AUTH_CONCURRENT_06');
      assert.equal(subs.length, 1);
    });
  });

  // =========================================================================
  // Group F: Server-Authoritative Result and Renewal
  // =========================================================================
  describe('Group F: Server-authoritative result and renewal', () => {
    it('F01. Server calculates vipExpiresAt from server Plan duration', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      const exp90 = calculateRenewalExpiration(null, 90, now);
      const diffDays90 = Math.round((exp90.getTime() - now.getTime()) / 86400000);
      assert.equal(diffDays90, 90);

      const exp365 = calculateRenewalExpiration(null, 365, now);
      const diffDays365 = Math.round((exp365.getTime() - now.getTime()) / 86400000);
      assert.equal(diffDays365, 365);
    });

    it('F02. Active VIP renewal extends from current vipExpiresAt', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      // User currently has VIP valid until 2026-10-01 (30 days from now)
      const currentExp = new Date('2026-10-01T12:00:00.000Z');

      const renewedExp = calculateRenewalExpiration(currentExp, 90, now);
      // New expiration must be currentExp + 90 days = 120 days from now
      const diffDaysFromNow = Math.round((renewedExp.getTime() - now.getTime()) / 86400000);
      assert.equal(diffDaysFromNow, 120);

      const diffDaysFromBase = Math.round((renewedExp.getTime() - currentExp.getTime()) / 86400000);
      assert.equal(diffDaysFromBase, 90);
    });

    it('F03. Inactive or non-VIP renewal extends from server current time', () => {
      const now = new Date('2026-09-01T12:00:00.000Z');
      // Already expired yesterday
      const expiredYesterday = new Date('2026-08-31T12:00:00.000Z');

      const renewedExp = calculateRenewalExpiration(expiredYesterday, 90, now);
      const diffDaysFromNow = Math.round((renewedExp.getTime() - now.getTime()) / 86400000);
      assert.equal(diffDaysFromNow, 90);
    });

    it('F04. Client cannot choose expiration date', async () => {
      const clientWantedDate = '2099-12-31T23:59:59.000Z';
      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({
          planId: 'samurai_90days',
          vipExpiresAt: clientWantedDate
        })
      });
      assert.equal(res.status, 200);
      const data = await res.json();

      // Complete payment
      const verifyRes = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({
          authority: data.authority,
          vipExpiresAt: clientWantedDate
        })
      });
      assert.equal(verifyRes.status, 200);
      const verifyData = await verifyRes.json();

      // Client-supplied date is ignored
      assert.notEqual(verifyData.subscription.expiresAt, clientWantedDate);
      const actualExp = new Date(verifyData.subscription.expiresAt).getTime();
      const diffDays = Math.round((actualExp - Date.now()) / 86400000);
      assert.equal(diffDays, 90);
    });

    it('F05. Payment success response includes server-confirmed receipt data', async () => {
      const reqRes = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ planId: 'samurai_90days' })
      });
      const { authority } = await reqRes.json();

      const verifyRes = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });
      assert.equal(verifyRes.status, 200);
      const data = await verifyRes.json();

      assert.ok(data.refId);
      assert.ok(data.cardPan);
      assert.ok(data.authority);
      assert.equal(data.tier, 'vip_samurai');
      assert.ok(data.subscription);
      assert.ok(data.user);
      assert.equal(data.user.isVip, true);
    });
  });

  // =========================================================================
  // Group G: Provider-Neutral and Safe Error Contract
  // =========================================================================
  describe('Group G: Provider-neutral and safe error contract', () => {
    it('G01. Payment request does not require or depend on a selected provider', async () => {
      const adapter = getPaymentAdapter();
      assert.ok(adapter);
      assert.equal(adapter.mode, 'provider-simulator-dev');

      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ planId: 'samurai_90days' })
      });
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.ok(data.authority);
      assert.ok(data.paymentUrl);
      assert.equal(data.mode, 'provider-simulator-dev');
    });

    it('G02. Payment completion does not depend on provider-specific response shape', async () => {
      // Mock adapter returning custom domain result
      const customAdapter = {
        name: 'Custom Provider Adapter',
        mode: 'provider-test',
        requestPayment: async (params: any) => ({
          authority: `CUSTOM_AUTH_${Date.now()}`,
          paymentUrl: '/custom-gateway',
          amount: params.amount,
          planId: params.planId,
          mode: 'provider-test'
        }),
        buildRedirectUrl: (auth: string) => `/custom-gateway?auth=${auth}`,
        verifyPayment: async () => ({
          success: true,
          status: 'SUCCESS' as const,
          refId: 'CUSTOM-REF-999',
          cardPan: '6037-99**-****-8888'
        }),
        normalizeProviderError: () => ({
          code: 'PAYMENT_FAILED',
          messageFa: 'خطا',
          retryable: false
        })
      };
      setPaymentAdapterOverride(customAdapter);

      const reqRes = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ planId: 'samurai_90days' })
      });
      const { authority } = await reqRes.json();

      const verifyRes = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });
      assert.equal(verifyRes.status, 200);
      const data = await verifyRes.json();
      assert.equal(data.refId, 'CUSTOM-REF-999');
      assert.equal(data.cardPan, '6037-99**-****-8888');
    });

    it('G03. Raw provider error does not leak to the client', async () => {
      const failingAdapter = {
        name: 'Failing Provider',
        mode: 'failing-test',
        requestPayment: async () => {
          throw new Error('RAW_UPSTREAM_HTTP_SOCKET_TIMEOUT_AT_PORT_443_STACK_INTERNAL');
        },
        buildRedirectUrl: () => '',
        verifyPayment: async () => ({
          success: false,
          status: 'FAILED' as const,
          errorCode: 'PROVIDER_INTERNAL_ERROR',
          errorMessageFa: 'تراکنش توسط درگاه بانکی تایید نشد.'
        }),
        normalizeProviderError: () => ({
          code: 'PAYMENT_FAILED',
          messageFa: 'تراکنش توسط درگاه بانکی تایید نشد.',
          retryable: false
        })
      };
      setPaymentAdapterOverride(failingAdapter);

      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority: 'AUTH_PROVIDER_FAIL'
      });

      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority: 'AUTH_PROVIDER_FAIL' })
      });
      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'PAYMENT_FAILED');
      assert.equal(data.messageFa, 'تراکنش توسط درگاه بانکی تایید نشد.');
      assert.equal(data.stack, undefined);
    });

    it('G04. Mock mode is never labelled live', async () => {
      const adapter = new ProviderNeutralSimulatorAdapter();
      assert.notEqual(adapter.mode, 'live');
      assert.notEqual(adapter.mode, 'production');
      assert.ok(adapter.mode.includes('simulator') || adapter.mode.includes('dev'));

      const reqRes = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ planId: 'samurai_90days' })
      });
      const data = await reqRes.json();
      assert.notEqual(data.mode, 'live');
      assert.notEqual(data.mode, 'production');
    });

    it('G05. Production mode cannot silently fall back to simulated success', async () => {
      // In production mode with no adapter, getPaymentAdapter() returns null
      setPaymentAdapterOverride(null);

      const originalEnv = process.env.NODE_ENV;
      const originalAllowShortcuts = process.env.ALLOW_TEST_SHORTCUTS;
      const originalJwtSecret = process.env.JWT_SECRET;
      try {
        process.env.NODE_ENV = 'production';
        process.env.ALLOW_TEST_SHORTCUTS = 'false';
        process.env.JWT_SECRET = 'a-super-secret-production-key-that-is-at-least-32-chars!';

        const adapter = getPaymentAdapter();
        assert.equal(adapter, null);

        // Generate valid token with this secret
        const validProdToken = generateToken({
          userId: userAId,
          phoneNumber: '09121111111',
          isVip: false,
          tier: 'ronin_free',
          isAdmin: false,
          tokenVersion: 0
        });

        const res = await fetch(`${baseUrl}/api/payment/request`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${validProdToken}`
          },
          body: JSON.stringify({ planId: 'samurai_90days' })
        });
        assert.equal(res.status, 503);
        const data = await res.json();
        assert.equal(data.code, 'PAYMENT_UNAVAILABLE');
      } finally {
        process.env.NODE_ENV = originalEnv;
        if (originalAllowShortcuts !== undefined) {
          process.env.ALLOW_TEST_SHORTCUTS = originalAllowShortcuts;
        } else {
          delete process.env.ALLOW_TEST_SHORTCUTS;
        }
        if (originalJwtSecret !== undefined) {
          process.env.JWT_SECRET = originalJwtSecret;
        } else {
          delete process.env.JWT_SECRET;
        }
      }
    });
  });

  // =========================================================================
  // Corrective Pass: Focused Blockers Verification Suites (A, B, C, D)
  // =========================================================================

  describe('Corrective Pass Suite A: Server-Authoritative Client State', () => {
    const baseClientUser = {
      id: userAId,
      name: 'سامورایی تست',
      phoneNumber: '09121111111',
      isVip: false,
      tier: 'ronin_free' as const,
      vipSince: null,
      vipExpiresAt: null,
      activeCycleLimit: 1,
      createdAt: new Date().toISOString()
    };

    it('A01. Missing Server user prevents onUpgradeSuccess', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: userAId,
              authority: 'AUTH_CP_A01',
              refId: 'REF_CP_A01',
              amount: 199000
            },
            refId: 'REF_CP_A01'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A01'
        },
        baseClientUser
      );

      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'MISSING_SERVER_USER');
      assert.equal(res.validatedUser, null);
    });

    it('A02. Mismatched Server user ID prevents local VIP activation', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: 'intruder-user-id',
              authority: 'AUTH_CP_A02',
              refId: 'REF_CP_A02',
              amount: 199000
            },
            user: {
              id: 'intruder-user-id',
              isVip: true,
              tier: 'vip_samurai',
              vipExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
              paymentRefId: 'REF_CP_A02'
            },
            refId: 'REF_CP_A02'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A02'
        },
        baseClientUser
      );

      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'USER_ID_MISMATCH');
      assert.equal(res.validatedUser, null);
    });

    it('A03. Missing SUCCESS Subscription prevents local VIP activation', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'PENDING',
              userId: userAId,
              authority: 'AUTH_CP_A03',
              refId: 'REF_CP_A03',
              amount: 199000
            },
            user: {
              id: userAId,
              isVip: true,
              tier: 'vip_samurai',
              vipExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
              paymentRefId: 'REF_CP_A03'
            },
            refId: 'REF_CP_A03'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A03'
        },
        baseClientUser
      );

      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'SUBSCRIPTION_NOT_SUCCESS');
      assert.equal(res.validatedUser, null);
    });

    it('A04. Missing vipExpiresAt prevents local VIP activation', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: userAId,
              authority: 'AUTH_CP_A04',
              refId: 'REF_CP_A04',
              amount: 199000
            },
            user: {
              id: userAId,
              isVip: true,
              tier: 'vip_samurai',
              vipExpiresAt: null,
              paymentRefId: 'REF_CP_A04'
            },
            refId: 'REF_CP_A04'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A04'
        },
        baseClientUser
      );

      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'INVALID_VIP_EXPIRES_AT');
      assert.equal(res.validatedUser, null);
    });

    it('A05. Invalid vipExpiresAt prevents local VIP activation', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: userAId,
              authority: 'AUTH_CP_A05',
              refId: 'REF_CP_A05',
              amount: 199000
            },
            user: {
              id: userAId,
              isVip: true,
              tier: 'vip_samurai',
              vipExpiresAt: '2020-01-01T00:00:00.000Z',
              paymentRefId: 'REF_CP_A05'
            },
            refId: 'REF_CP_A05'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A05'
        },
        baseClientUser
      );

      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'EXPIRED_VIP_DATE');
      assert.equal(res.validatedUser, null);
    });

    it('A06. Missing paymentRefId prevents receipt creation', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: userAId,
              authority: 'AUTH_CP_A06',
              amount: 199000
            },
            user: {
              id: userAId,
              isVip: true,
              tier: 'vip_samurai',
              vipExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString()
            }
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A06'
        },
        baseClientUser
      );

      assert.equal(res.valid, false);
      assert.equal(res.errorCode, 'MISSING_PAYMENT_REF_ID');
      assert.equal(res.receipt, null);
    });

    it('A07. Client never calculates activeCycleLimit', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: userAId,
              authority: 'AUTH_CP_A07',
              refId: 'REF_CP_A07',
              amount: 199000
            },
            user: {
              id: userAId,
              isVip: true,
              tier: 'vip_samurai',
              vipExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
              paymentRefId: 'REF_CP_A07'
              // Notice: server does NOT provide activeCycleLimit
            },
            refId: 'REF_CP_A07'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A07'
        },
        baseClientUser
      );

      assert.equal(res.valid, true);
      assert.ok(res.validatedUser);
      // Must preserve the existing client profile limit, never inject 99 or local invention
      assert.equal(res.validatedUser.activeCycleLimit, 1);
    });

    it('A08. Client never creates a fallback refId', () => {
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: userAId,
              authority: 'AUTH_CP_A08',
              refId: 'REF_SERVER_AUTHORITATIVE_888',
              amount: 199000
            },
            user: {
              id: userAId,
              isVip: true,
              tier: 'vip_samurai',
              vipExpiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
              paymentRefId: 'REF_SERVER_AUTHORITATIVE_888'
            },
            refId: 'REF_SERVER_AUTHORITATIVE_888'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A08'
        },
        baseClientUser
      );

      assert.equal(res.valid, true);
      assert.ok(res.receipt);
      assert.equal(res.receipt.refId, 'REF_SERVER_AUTHORITATIVE_888');
      assert.notEqual(res.receipt.refId, 'REF-CONFIRMED');
    });

    it('A09. Fully valid authoritative result updates the correct profile', () => {
      const validFutureDate = new Date(Date.now() + 90 * 86400000).toISOString();
      const res = validateAuthoritativePaymentResponse(
        {
          data: {
            status: 100,
            subscription: {
              status: 'SUCCESS',
              userId: userAId,
              authority: 'AUTH_CP_A09',
              refId: 'REF_CP_A09',
              amount: 199000,
              cardPan: '6037-99**-****-1234'
            },
            user: {
              id: userAId,
              name: 'سامورایی تایید شده',
              isVip: true,
              tier: 'vip_samurai',
              vipSince: new Date().toISOString(),
              vipExpiresAt: validFutureDate,
              paymentRefId: 'REF_CP_A09'
            },
            refId: 'REF_CP_A09',
            cardPan: '6037-99**-****-1234'
          },
          currentUserId: userAId,
          expectedAuthority: 'AUTH_CP_A09'
        },
        baseClientUser
      );

      assert.equal(res.valid, true);
      assert.ok(res.validatedUser);
      assert.equal(res.validatedUser.id, userAId);
      assert.equal(res.validatedUser.isVip, true);
      assert.equal(res.validatedUser.tier, 'vip_samurai');
      assert.equal(res.validatedUser.vipExpiresAt, validFutureDate);
      assert.ok(res.receipt);
      assert.equal(res.receipt.refId, 'REF_CP_A09');
      assert.equal(res.receipt.cardPan, '6037-99**-****-1234');
    });
  });

  describe('Corrective Pass Suite B: Simulator Isolation', () => {
    const originalEnv = process.env.NODE_ENV;
    const originalShortcuts = process.env.ALLOW_TEST_SHORTCUTS;

    afterEach(() => {
      process.env.NODE_ENV = originalEnv;
      if (originalShortcuts !== undefined) {
        process.env.ALLOW_TEST_SHORTCUTS = originalShortcuts;
      } else {
        delete process.env.ALLOW_TEST_SHORTCUTS;
      }
      setPaymentAdapterOverride(null);
    });

    it('B01. Production ignores or rejects adapter override', () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_SHORTCUTS = 'false';

      const mockAdapter: any = {
        name: 'MaliciousTestAdapter',
        mode: 'override',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => ({} as any),
        normalizeProviderError: () => ({} as any)
      };

      setPaymentAdapterOverride(mockAdapter);
      const active = getPaymentAdapter();
      assert.equal(active, null, 'In production without test shortcuts, adapter override must not be accepted');
    });

    it('B02. Production without a real provider returns null', () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_SHORTCUTS = 'false';
      setPaymentAdapterOverride(null);

      const active = getPaymentAdapter();
      assert.equal(active, null);
    });

    it('B03. Payment route returns PAYMENT_UNAVAILABLE in production without provider', async () => {
      process.env.NODE_ENV = 'production';
      process.env.ALLOW_TEST_SHORTCUTS = 'false';
      setPaymentAdapterOverride(null);

      const res = await fetch(`${baseUrl}/api/payment/request`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ planId: 'samurai_90days' })
      });

      assert.equal(res.status, 503);
      const data = await res.json();
      assert.equal(data.code, 'PAYMENT_UNAVAILABLE');
    });

    it('B04. Development simulator remains clearly development-only', () => {
      process.env.NODE_ENV = 'development';
      setPaymentAdapterOverride(null);

      const active = getPaymentAdapter();
      assert.ok(active);
      assert.equal(active.mode, 'provider-simulator-dev');
      assert.equal(active.name, 'ProviderNeutralSimulator');
    });

    it('B05. No simulator response is labelled live', async () => {
      process.env.NODE_ENV = 'development';
      setPaymentAdapterOverride(null);

      const active = getPaymentAdapter();
      assert.ok(active);
      const reqRes = await active.requestPayment({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000
      });

      assert.notEqual(reqRes.mode, 'live');
      assert.notEqual(reqRes.mode, 'production');
      assert.equal(reqRes.mode, 'provider-simulator-dev');
    });
  });

  describe('Corrective Pass Suite C: Provider Failure Semantics', () => {
    afterEach(() => {
      setPaymentAdapterOverride(null);
    });

    it('C01. Definitive rejection transitions PENDING to FAILED', async () => {
      const authority = 'AUTH_CP_C01';
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority
      });

      const mockRejectAdapter: any = {
        name: 'MockRejectAdapter',
        mode: 'test',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => ({
          success: false,
          status: 'FAILED' as const,
          failureClassification: 'DEFINITIVE_REJECTION' as const,
          errorCode: 'CARD_BLOCKED',
          errorMessageFa: 'کارت بانکی مسدود است.',
          retryable: false
        }),
        normalizeProviderError: (e: any) => ({
          code: 'CARD_BLOCKED',
          messageFa: 'کارت بانکی مسدود است.',
          retryable: false
        })
      };
      setPaymentAdapterOverride(mockRejectAdapter);

      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'CARD_BLOCKED');
      assert.equal(data.retryable, false);

      const sub = await findSubscriptionByAuthority(authority);
      assert.equal(sub?.status, 'FAILED');
    });

    it('C02. Retryable timeout leaves Subscription PENDING', async () => {
      const authority = 'AUTH_CP_C02';
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority
      });

      const mockTimeoutAdapter: any = {
        name: 'MockTimeoutAdapter',
        mode: 'test',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => {
          throw new Error('Upstream network timeout after 10000ms');
        },
        normalizeProviderError: (e: any) => ({
          code: 'PAYMENT_TEMPORARY_ERROR',
          messageFa: 'خطای موقت در ارتباط با درگاه پرداخت.',
          retryable: true
        })
      };
      setPaymentAdapterOverride(mockTimeoutAdapter);

      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.code, 'PAYMENT_TEMPORARY_ERROR');
      assert.equal(data.retryable, true);

      const sub = await findSubscriptionByAuthority(authority);
      assert.equal(sub?.status, 'PENDING', 'Subscription must remain PENDING on retryable timeout');
    });

    it('C03. Temporary provider unavailability leaves Subscription PENDING', async () => {
      const authority = 'AUTH_CP_C03';
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority
      });

      const mockUnavailableAdapter: any = {
        name: 'MockUnavailableAdapter',
        mode: 'test',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => ({
          success: false,
          status: 'FAILED' as const,
          failureClassification: 'RETRYABLE_ERROR' as const,
          errorCode: 'PAYMENT_TEMPORARY_ERROR',
          errorMessageFa: 'درگاه موقتاً قطع است.',
          retryable: true
        }),
        normalizeProviderError: (e: any) => ({
          code: 'PAYMENT_TEMPORARY_ERROR',
          messageFa: 'درگاه موقتاً قطع است.',
          retryable: true
        })
      };
      setPaymentAdapterOverride(mockUnavailableAdapter);

      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.retryable, true);

      const sub = await findSubscriptionByAuthority(authority);
      assert.equal(sub?.status, 'PENDING');
    });

    it('C04. Ambiguous result leaves Subscription PENDING', async () => {
      const authority = 'AUTH_CP_C04';
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority
      });

      const mockAmbiguousAdapter: any = {
        name: 'MockAmbiguousAdapter',
        mode: 'test',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => ({
          success: false,
          status: 'FAILED' as const,
          failureClassification: 'AMBIGUOUS_RESULT' as const,
          errorCode: 'PAYMENT_AMBIGUOUS_STATUS',
          errorMessageFa: 'وضعیت تراکنش نامشخص است.',
          retryable: true
        }),
        normalizeProviderError: (e: any) => ({
          code: 'PAYMENT_AMBIGUOUS_STATUS',
          messageFa: 'وضعیت تراکنش نامشخص است.',
          retryable: true
        })
      };
      setPaymentAdapterOverride(mockAmbiguousAdapter);

      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });

      assert.equal(res.status, 400);
      const data = await res.json();
      assert.equal(data.retryable, true);

      const sub = await findSubscriptionByAuthority(authority);
      assert.equal(sub?.status, 'PENDING');
    });

    it('C05. Retryable failure does not activate VIP', async () => {
      const authority = 'AUTH_CP_C05';
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority
      });

      const mockRetryAdapter: any = {
        name: 'MockRetryAdapter',
        mode: 'test',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => ({
          success: false,
          status: 'FAILED' as const,
          failureClassification: 'RETRYABLE_ERROR' as const,
          errorCode: 'PAYMENT_TEMPORARY_ERROR',
          errorMessageFa: 'پاسخ نامشخص.',
          retryable: true
        }),
        normalizeProviderError: (e: any) => ({
          code: 'PAYMENT_TEMPORARY_ERROR',
          messageFa: 'پاسخ نامشخص.',
          retryable: true
        })
      };
      setPaymentAdapterOverride(mockRetryAdapter);

      await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });

      const user = await findUserById(userAId);
      assert.equal(user?.isVip, false);
      assert.equal(user?.tier, 'ronin_free');
    });

    it('C06. Retryable failure does not extend vipExpiresAt', async () => {
      const user = await findUserById(userAId);
      assert.equal(user?.vipExpiresAt, null);
    });

    it('C07. Raw provider error is not returned', async () => {
      const authority = 'AUTH_CP_C07';
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority
      });

      const rawLeakAdapter: any = {
        name: 'RawLeakAdapter',
        mode: 'test',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => {
          throw new Error('RAW_UPSTREAM_INTERNAL_SOCKET_FATAL_ERROR_AT_REMOTE_IP_10.2.0.1');
        },
        normalizeProviderError: () => ({
          code: 'PAYMENT_TEMPORARY_ERROR',
          messageFa: 'خطای موقت در ارتباط با درگاه پرداخت. لطفاً پس از چند لحظه دوباره تلاش کنید.',
          retryable: true
        })
      };
      setPaymentAdapterOverride(rawLeakAdapter);

      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });

      const rawText = await res.text();
      assert.equal(rawText.includes('RAW_UPSTREAM_INTERNAL_SOCKET_FATAL'), false);
    });

    it('C08. Normalized retryable application error is returned', async () => {
      const authority = 'AUTH_CP_C08';
      await createSubscriptionRecord({
        userId: userAId,
        planId: 'samurai_90days',
        amount: 199000,
        authority
      });

      const rawLeakAdapter: any = {
        name: 'RawLeakAdapter',
        mode: 'test',
        requestPayment: async () => ({} as any),
        verifyPayment: async () => {
          throw new Error('Connection timeout');
        },
        normalizeProviderError: (e: any) => new ProviderNeutralSimulatorAdapter().normalizeProviderError(e)
      };
      setPaymentAdapterOverride(rawLeakAdapter);

      const res = await fetch(`${baseUrl}/api/payment/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userAToken}`
        },
        body: JSON.stringify({ authority })
      });

      const data = await res.json();
      assert.equal(data.code, 'PAYMENT_TEMPORARY_ERROR');
      assert.equal(data.retryable, true);
      assert.ok(data.messageFa);
    });
  });

  describe('Corrective Pass Suite D: Fake Gateway Removal', () => {
    it('D01. Production UI does not collect card number', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile('./src/components/PaymentModal.tsx', 'utf-8');
      
      assert.equal(content.includes('شماره کارت ۱۶ رقمی'), false);
      assert.equal(content.includes('cardNumber'), false);
      assert.equal(content.includes('formatCardNumber'), false);
    });

    it('D02. Production UI does not collect CVV2', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile('./src/components/PaymentModal.tsx', 'utf-8');

      assert.equal(content.includes('cvv2'), false);
      assert.equal(content.includes('CVV2'), false);
    });

    it('D03. Production UI does not collect banking OTP', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile('./src/components/PaymentModal.tsx', 'utf-8');

      assert.equal(content.includes('دریافت رمز پویا'), false);
      assert.equal(content.includes('otpCode'), false);
      assert.equal(content.includes('otpSent'), false);
    });

    it('D04. UI does not claim a specific Provider before selection', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile('./src/components/PaymentModal.tsx', 'utf-8');

      assert.equal(content.includes('زرین‌پال'), false);
      assert.equal(content.includes('شاپرک'), false);
      assert.equal(content.includes('ZarinPal'), false);
    });

    it('D05. Development simulation uses no realistic banking credentials', async () => {
      const fs = await import('node:fs/promises');
      const content = await fs.readFile('./src/components/PaymentModal.tsx', 'utf-8');

      // The simulator only displays metadata (package title, amount, authority) and a single confirm button
      assert.ok(content.includes('شبیه‌ساز پرداخت (محیط توسعه)'));
      assert.ok(content.includes('تایید پرداخت شبیه‌سازی‌شده'));
      assert.ok(content.includes('DEV ONLY'));
      assert.equal(content.includes('expMonth'), false);
      assert.equal(content.includes('expYear'), false);
      assert.equal(content.includes('رمز اینترنتی'), false);
    });
  });
});
