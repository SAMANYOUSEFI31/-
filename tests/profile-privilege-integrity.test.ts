import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  memoryStore,
  saveLocalStore,
  setPrismaState,
  findUserById,
  updateUser
} from '../server/db/index.js';
import { generateToken } from '../server/auth.js';
import { app } from '../server.js';

describe('Phase 3A.3: Profile & Privilege Boundary Integrity Suite', () => {
  const normalUserId = 'user-samurai-001';
  const targetVictimId = 'user-victim-002';

  let server: http.Server;
  let baseUrl = '';

  const normalUserToken = generateToken({
    userId: normalUserId,
    phoneNumber: '09123333333',
    isVip: false,
    tier: 'free',
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
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(() => {
    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.subscriptions = [];
    memoryStore.users = [
      {
        id: normalUserId,
        phoneNumber: '09123333333',
        name: 'سامورایی معمولی',
        email: null,
        passwordHash: null,
        tier: 'free',
        isVip: false,
        isAdmin: false,
        tokenVersion: 0,
        nightOwlCutoffHour: 4,
        accentTheme: 'amber',
        vipSince: null,
        vipExpiresAt: null,
        paymentRefId: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
      },
      {
        id: targetVictimId,
        phoneNumber: '09124444444',
        name: 'قربانی احتمالی',
        email: null,
        passwordHash: null,
        tier: 'free',
        isVip: false,
        isAdmin: false,
        tokenVersion: 0,
        nightOwlCutoffHour: 4,
        accentTheme: 'amber',
        vipSince: null,
        vipExpiresAt: null,
        paymentRefId: null,
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z'
      }
    ];
    saveLocalStore();
  });

  // ===========================================================================
  // 1. PRIVILEGE ESCALATION SCENARIOS OVER HTTP ENDPOINTS
  // ===========================================================================

  describe('Scenario 1: Attempting to set isAdmin: true', () => {
    it('strips isAdmin, returns non-admin, and leaves DB isAdmin=false', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'سامورایی باادعا',
          isAdmin: true
        })
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.isAdmin, false);
      assert.equal(data.user.name, 'سامورایی باادعا');

      // Verify DB persistence is unchanged for isAdmin
      const persisted = await findUserById(normalUserId);
      assert.ok(persisted);
      assert.equal(persisted.isAdmin, false);
      assert.equal(persisted.name, 'سامورایی باادعا');
    });
  });

  describe('Scenario 2: Attempting to set isVip: true', () => {
    it('strips isVip, returns non-VIP, and leaves DB isVip=false', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          isVip: true
        })
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.isVip, false);

      const persisted = await findUserById(normalUserId);
      assert.ok(persisted);
      assert.equal(persisted.isVip, false);
    });
  });

  describe('Scenario 3: Attempting to set tier: "vip" or "vip_samurai"', () => {
    it('strips tier, returns free tier, and leaves DB tier="free"', async () => {
      const res = await fetch(`${baseUrl}/api/user/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tier: 'vip_samurai'
        })
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.tier, 'free');

      const persisted = await findUserById(normalUserId);
      assert.ok(persisted);
      assert.equal(persisted.tier, 'free');
    });
  });

  describe('Scenario 4: Attempting to set tokenVersion: 999', () => {
    it('strips tokenVersion, keeps tokenVersion=0, and prevents session tampering', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          tokenVersion: 999
        })
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.tokenVersion, 0);

      const persisted = await findUserById(normalUserId);
      assert.ok(persisted);
      assert.equal(persisted.tokenVersion, 0);
    });
  });

  describe('Scenario 5: Attempting to set paymentRefId: "fake-admin-payment"', () => {
    it('strips paymentRefId, keeps paymentRefId=null in DB', async () => {
      const res = await fetch(`${baseUrl}/api/user/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          paymentRefId: 'fake-admin-payment'
        })
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.paymentRefId, null);

      const persisted = await findUserById(normalUserId);
      assert.ok(persisted);
      assert.equal(persisted.paymentRefId, null);
    });
  });

  describe('Scenario 6: Attempting to set id: "different-user" or userId: "different-user"', () => {
    it('ignores client id manipulation and retains authoritative user identity', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          id: targetVictimId,
          userId: targetVictimId,
          name: 'نام دستکاری شده'
        })
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.id, normalUserId);
      assert.equal(data.user.name, 'نام دستکاری شده');

      // Verify caller user was updated
      const callerUser = await findUserById(normalUserId);
      assert.ok(callerUser);
      assert.equal(callerUser.name, 'نام دستکاری شده');

      // Verify target victim user was completely untouched
      const victimUser = await findUserById(targetVictimId);
      assert.ok(victimUser);
      assert.equal(victimUser.name, 'قربانی احتمالی');
    });
  });

  describe('Scenario 7: Attempting to set activeCycleLimit: 9999 or other limits', () => {
    it('strips activeCycleLimit, user remains unaffected', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          activeCycleLimit: 9999
        })
      });

      assert.equal(res.status, 200);
      const persisted = await findUserById(normalUserId);
      assert.ok(persisted);
      assert.equal((persisted as any).activeCycleLimit, undefined);
    });
  });

  describe('Scenario 8: Mass Assignment Attack with combined protected fields', () => {
    it('strips all privilege, identity, role, and credential fields simultaneously', async () => {
      const maliciousPayload = {
        name: 'جنگجوی پاک‌نیت',
        isAdmin: true,
        isVip: true,
        role: 'ADMIN',
        tier: 'daimyo_master',
        tokenVersion: 42,
        paymentRefId: 'HACKED-REF-999',
        vipSince: '2026-01-01T00:00:00.000Z',
        vipExpiresAt: '2099-12-31T23:59:59.000Z',
        id: targetVictimId,
        userId: targetVictimId,
        phoneNumber: '09120000000',
        email: 'admin@bushido.local',
        password: 'NewPassword123!',
        passwordHash: 'injected_hash',
        createdAt: '1970-01-01T00:00:00.000Z',
        updatedAt: '1970-01-01T00:00:00.000Z',
        activeCycleLimit: 99999
      };

      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(maliciousPayload)
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.id, normalUserId);
      assert.equal(data.user.name, 'جنگجوی پاک‌نیت');
      assert.equal(data.user.isAdmin, false);
      assert.equal(data.user.isVip, false);
      assert.equal(data.user.tier, 'free');
      assert.equal(data.user.tokenVersion, 0);
      assert.equal(data.user.paymentRefId, null);
      assert.equal(data.user.vipSince, null);
      assert.equal(data.user.vipExpiresAt, null);
      assert.equal(data.user.phoneNumber, '09123333333');
      assert.equal(data.user.email, null);
      assert.equal(data.user.passwordHash, null);
      assert.equal(data.user.createdAt, '2026-09-01T00:00:00.000Z');

      // Check DB directly
      const dbUser = await findUserById(normalUserId);
      assert.ok(dbUser);
      assert.equal(dbUser.id, normalUserId);
      assert.equal(dbUser.name, 'جنگجوی پاک‌نیت');
      assert.equal(dbUser.isAdmin, false);
      assert.equal(dbUser.isVip, false);
      assert.equal(dbUser.tier, 'free');
      assert.equal(dbUser.tokenVersion, 0);
      assert.equal(dbUser.paymentRefId, null);
      assert.equal(dbUser.vipSince, null);
      assert.equal(dbUser.vipExpiresAt, null);
      assert.equal(dbUser.phoneNumber, '09123333333');
      assert.equal(dbUser.email, null);
      assert.equal(dbUser.passwordHash, null);
      assert.equal(dbUser.createdAt, '2026-09-01T00:00:00.000Z');
    });
  });

  describe('Scenario 9: Legitimate profile updates succeed', () => {
    it('successfully updates name, nightOwlCutoffHour, and accentTheme', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: 'فرمانده سامورایی وفادار',
          nightOwlCutoffHour: 5,
          accentTheme: 'emerald'
        })
      });

      assert.equal(res.status, 200);
      const data: any = await res.json();
      assert.equal(data.user.name, 'فرمانده سامورایی وفادار');
      assert.equal(data.user.nightOwlCutoffHour, 5);
      assert.equal(data.user.accentTheme, 'emerald');

      // Verify persistence
      const dbUser = await findUserById(normalUserId);
      assert.ok(dbUser);
      assert.equal(dbUser.name, 'فرمانده سامورایی وفادار');
      assert.equal(dbUser.nightOwlCutoffHour, 5);
      assert.equal(dbUser.accentTheme, 'emerald');
    });
  });

  describe('Scenario 10: Unauthenticated or invalid token profile update fails', () => {
    it('fails with 401 when no token is provided', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'مهاجم ناشناس' })
      });

      assert.equal(res.status, 401);
      const body: any = await res.json();
      assert.equal(body.code, 'UNAUTHORIZED');
    });

    it('fails with 401 when an invalid token is provided', async () => {
      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer invalid-token-string',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'مهاجم توکن جعلی' })
      });

      assert.equal(res.status, 401);
      const body: any = await res.json();
      assert.equal(body.code, 'INVALID_TOKEN');
    });

    it('fails with 401 when session has been revoked (stale tokenVersion)', async () => {
      // Advance user tokenVersion in DB
      memoryStore.users[0].tokenVersion = 5;

      const res = await fetch(`${baseUrl}/api/auth/profile`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${normalUserToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'مهاجم نشست باطل‌شده' })
      });

      assert.equal(res.status, 401);
      const body: any = await res.json();
      assert.equal(body.code, 'SESSION_REVOKED');
    });
  });

  // ===========================================================================
  // 2. DIRECT PERSISTENCE LAYER IMMUTABILITY TESTS (Prisma & MemoryStore)
  // ===========================================================================

  describe('Direct Persistence Layer Hardening (updateUser)', () => {
    it('prevents mutation of id and createdAt in memoryStore fallback', async () => {
      const initialCreatedAt = memoryStore.users[0].createdAt;
      
      const updated = await updateUser(normalUserId, {
        name: 'نام جدید امن',
        id: 'hacked-id' as any,
        createdAt: '1990-01-01' as any
      });

      assert.ok(updated);
      assert.equal(updated.id, normalUserId);
      assert.equal(updated.createdAt, initialCreatedAt);
      assert.equal(updated.name, 'نام جدید امن');

      const inStore = memoryStore.users.find(u => u.id === normalUserId);
      assert.ok(inStore);
      assert.equal(inStore.id, normalUserId);
      assert.equal(inStore.createdAt, initialCreatedAt);
    });

    it('prevents mutation of id, userId, and createdAt in Prisma execution pathway', async () => {
      let passedPrismaWhere: any = null;
      let passedPrismaData: any = null;

      const mockPrismaClient = {
        user: {
          update: async (args: any) => {
            passedPrismaWhere = args.where;
            passedPrismaData = args.data;
            return {
              id: normalUserId,
              phoneNumber: '09123333333',
              name: args.data.name || 'نام پریزما',
              email: null,
              passwordHash: null,
              role: 'FREE',
              tier: 'free',
              isVip: false,
              isAdmin: false,
              tokenVersion: 0,
              nightOwlCutoffHour: 4,
              accentTheme: 'amber',
              vipSince: null,
              vipExpiresAt: null,
              paymentRefId: null,
              createdAt: new Date('2026-09-01T00:00:00.000Z'),
              updatedAt: new Date()
            };
          }
        }
      };

      setPrismaState(mockPrismaClient as any, true);

      const result = await updateUser(normalUserId, {
        name: 'نام تست پریزما',
        id: 'malicious-prisma-id' as any,
        createdAt: '1970-01-01' as any,
        userId: 'malicious-user-id' as any
      } as any);

      assert.ok(result);
      assert.equal(result.id, normalUserId);
      assert.equal(passedPrismaWhere.id, normalUserId);
      assert.equal(passedPrismaData.id, undefined);
      assert.equal(passedPrismaData.userId, undefined);
      assert.equal(passedPrismaData.createdAt, undefined);
      assert.equal(passedPrismaData.name, 'نام تست پریزما');
    });
  });
});
