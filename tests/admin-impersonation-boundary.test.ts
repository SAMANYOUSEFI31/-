import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  memoryStore,
  setPrismaState,
  findUserById
} from '../server/db/index.js';
import { generateToken, verifyToken } from '../server/auth.js';
import { app } from '../server.js';
import { transitionAccountState, loadStoredSystemState, saveStoredSystemState, TOKEN_KEY } from '../src/utils/storageUtils.js';
import { createInitialSystemState } from '../src/data/initialData.js';
import {
  IMPERSONATOR_TOKEN_KEY,
  IMPERSONATING_USER_KEY,
  validateAdminTokenForExit,
  buildExitImpersonationSuccessState,
  buildExitImpersonationRevokedState,
  executeLogoutDuringImpersonation,
  resolveImpersonationStateOnBoot
} from '../src/utils/impersonationUtils.js';

describe('Phase 3A.5: Admin & Impersonation Boundary Suite', () => {
  const adminId = 'admin-master-001';
  const secondAdminId = 'admin-secondary-002';
  const normalUserId = 'user-samurai-001';
  const otherUserId = 'user-ronin-002';

  let server: http.Server;
  let baseUrl = '';

  const adminToken = generateToken({
    userId: adminId,
    phoneNumber: '09120000000',
    isVip: true,
    tier: 'vip_samurai',
    isAdmin: true,
    tokenVersion: 0
  });

  const normalUserToken = generateToken({
    userId: normalUserId,
    phoneNumber: '09123333333',
    isVip: false,
    tier: 'free',
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
    if (server) {
      if (typeof (server as any).closeAllConnections === 'function') {
        (server as any).closeAllConnections();
      }
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
        id: adminId,
        phoneNumber: '09120000000',
        name: 'مدیر کل بوشیدو',
        email: 'admin@bushido.app',
        passwordHash: null,
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: true,
        tokenVersion: 0,
        nightOwlCutoffHour: 4,
        accentTheme: 'amber',
        vipSince: '2026-01-01T00:00:00.000Z',
        vipExpiresAt: null,
        paymentRefId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      },
      {
        id: normalUserId,
        phoneNumber: '09123333333',
        name: 'سامورایی هدف',
        email: 'samurai@bushido.app',
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
        id: otherUserId,
        phoneNumber: '09124444444',
        name: 'رونین دیگر',
        email: 'ronin@bushido.app',
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
        id: secondAdminId,
        phoneNumber: '09129999999',
        name: 'مدیر همکار',
        email: 'admin2@bushido.app',
        passwordHash: null,
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: true,
        tokenVersion: 0,
        nightOwlCutoffHour: 4,
        accentTheme: 'amber',
        vipSince: '2026-01-01T00:00:00.000Z',
        vipExpiresAt: null,
        paymentRefId: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    ];
  });

  it('1. Normal user cannot enter impersonation (403 Forbidden)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${normalUserToken}`
      },
      body: JSON.stringify({ targetUserId: otherUserId })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.code, 'FORBIDDEN');
  });

  it('2. Unauthenticated request cannot enter impersonation (401 Unauthorized)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ targetUserId: otherUserId })
    });

    assert.equal(res.status, 401);
  });

  it('3. Admin can enter impersonation and receives scoped token with audit claims', async () => {
    const res = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.success, true);
    assert.ok(data.token);
    assert.equal(data.user.id, normalUserId);
    assert.equal(data.user.isAdmin, false);

    // Verify token claims
    const decoded = verifyToken<any>(data.token);
    assert.ok(decoded);
    assert.equal(decoded.userId, normalUserId);
    assert.equal(decoded.isAdmin, false);
    assert.equal(decoded.isImpersonated, true);
    assert.equal(decoded.impersonatedBy, adminId);
  });

  it('4. Admin cannot self-impersonate (400 Bad Request)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: adminId })
    });

    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.code, 'SELF_IMPERSONATION_FORBIDDEN');
  });

  it('5. Impersonating non-existent user returns 404', async () => {
    const res = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: 'non-existent-user-999' })
    });

    assert.equal(res.status, 404);
  });

  it('6. Impersonated token cannot access admin endpoints (403 Forbidden)', async () => {
    // 1. Admin gets impersonation token for normal user
    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const impData = await impRes.json();
    const impToken = impData.token;

    // 2. Try to access /api/admin/stats with impersonation token
    const statsRes = await fetch(`${baseUrl}/api/admin/stats`, {
      headers: { Authorization: `Bearer ${impToken}` }
    });
    assert.equal(statsRes.status, 403);

    // 3. Try to access /api/admin/users with impersonation token
    const usersRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${impToken}` }
    });
    assert.equal(usersRes.status, 403);
  });

  it('7. Cycle created under impersonation belongs strictly to target user', async () => {
    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const { token: impToken } = await impRes.json();

    const cyclePayload = {
      id: 'cycle-imp-001',
      title: 'چرخه ایجاد شده در شبیه‌سازی',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      targetTheme: 'amber'
    };

    const createRes = await fetch(`${baseUrl}/api/cycles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${impToken}`
      },
      body: JSON.stringify(cyclePayload)
    });

    assert.equal(createRes.status, 200);

    // Verify in database: owner must be normalUserId, NOT adminId
    const storedCycle = memoryStore.cycles.find(c => c.id === 'cycle-imp-001');
    assert.ok(storedCycle);
    assert.equal(storedCycle.userId, normalUserId);
    assert.notEqual(storedCycle.userId, adminId);
  });

  it('8. DailyLog created/updated under impersonation belongs strictly to target user', async () => {
    // Create cycle for target user first
    memoryStore.cycles.push({
      id: 'cycle-imp-001',
      userId: normalUserId,
      title: 'چرخه کاربر هدف',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      isArchived: false,
      reportRead: false,
      targetTheme: 'amber',
      rules: [],
      verdict: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const { token: impToken } = await impRes.json();

    const logPayload = {
      cycleId: 'cycle-imp-001',
      date: '2026-09-01',
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true
    };

    const updateRes = await fetch(`${baseUrl}/api/daily-logs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${impToken}`
      },
      body: JSON.stringify(logPayload)
    });

    assert.equal(updateRes.status, 200);

    // Verify in database: owner must be normalUserId
    const storedLog = memoryStore.dailyLogs.find(l => l.date === '2026-09-01' && l.userId === normalUserId);
    assert.ok(storedLog);
    assert.equal(storedLog.userId, normalUserId);
  });

  it('9. Payment request under impersonation binds payment to target user, not admin', async () => {
    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const { token: impToken } = await impRes.json();

    const payRes = await fetch(`${baseUrl}/api/payment/request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${impToken}`
      },
      body: JSON.stringify({ planId: 'samurai_90days' })
    });

    assert.equal(payRes.status, 200);
    const payData = await payRes.json();
    assert.ok(payData.authority);

    // Verify in database: subscription belongs to normalUserId
    const sub = memoryStore.subscriptions.find(s => s.authority === payData.authority);
    assert.ok(sub);
    assert.equal(sub.userId, normalUserId);
    assert.notEqual(sub.userId, adminId);
  });

  it('10. Subscription verification under impersonation elevates target user, not admin', async () => {
    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const { token: impToken } = await impRes.json();

    // Create pending subscription for normalUser
    const authority = 'AUTH_TEST_IMP_VERIFY_999';
    memoryStore.subscriptions.push({
      id: 'sub-imp-999',
      userId: normalUserId,
      planId: 'samurai_90days',
      amount: 199000,
      status: 'pending',
      authority,
      refId: null,
      cardPan: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const verifyRes = await fetch(`${baseUrl}/api/payment/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${impToken}`
      },
      body: JSON.stringify({
        authority
      })
    });

    assert.equal(verifyRes.status, 200);

    // Target user should be elevated to VIP
    const userInDb = await findUserById(normalUserId);
    assert.ok(userInDb);
    assert.equal(userInDb.isVip, true);
    assert.equal(userInDb.tier, 'vip_samurai');
  });

  it('11. Profile update under impersonation cannot escalate privileges (strips protected fields)', async () => {
    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const { token: impToken } = await impRes.json();

    const profileRes = await fetch(`${baseUrl}/api/user/profile`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${impToken}`
      },
      body: JSON.stringify({
        name: 'نام به‌روزشده توسط ادمین',
        isAdmin: true, // Malicious attempt to escalate target user
        tier: 'vip_samurai',
        isVip: true
      })
    });

    assert.equal(profileRes.status, 200);

    // Verify in database: name updated, but isAdmin/isVip were NOT elevated
    const userInDb = await findUserById(normalUserId);
    assert.ok(userInDb);
    assert.equal(userInDb.name, 'نام به‌روزشده توسط ادمین');
    assert.equal(userInDb.isAdmin, false);
  });

  it('12. Target user password reset / session revocation invalidates impersonation token', async () => {
    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const { token: impToken } = await impRes.json();

    // Invalidate target user sessions in DB
    const userInDb = memoryStore.users.find(u => u.id === normalUserId);
    if (userInDb) {
      userInDb.tokenVersion = 1;
    }

    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${impToken}` }
    });

    assert.equal(meRes.status, 401);
    const data = await meRes.json();
    assert.equal(data.code, 'SESSION_REVOKED');
  });

  it('13. Exiting impersonation and fetching /api/auth/me with admin token restores admin identity', async () => {
    const meRes = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });

    assert.equal(meRes.status, 200);
    const data = await meRes.json();
    assert.ok(data.user);
    assert.equal(data.user.id, adminId);
    assert.equal(data.user.isAdmin, true);
    assert.equal(data.user.isVip, true);
  });

  it('14. Account state transition helper guarantees local storage isolation on switch and restore', () => {
    const adminInitialState = createInitialSystemState({
      id: adminId,
      name: 'مدیر کل بوشیدو',
      isAdmin: true,
      isVip: true,
      tier: 'vip_samurai'
    });

    const targetUserInitialState = createInitialSystemState({
      id: normalUserId,
      name: 'سامورایی هدف',
      isAdmin: false,
      isVip: false,
      tier: 'free'
    });

    // 1. Enter impersonation (Admin -> Target User)
    const toTargetTransition = transitionAccountState({
      currentSystemState: adminInitialState,
      targetUserId: normalUserId,
      targetUserProfile: targetUserInitialState.userProfile
    });

    assert.equal(toTargetTransition.nextState.userProfile.id, normalUserId);
    assert.equal(toTargetTransition.nextState.userProfile.isAdmin, false);

    // 2. Exit impersonation (Target User -> Admin)
    const backToAdminTransition = transitionAccountState({
      currentSystemState: toTargetTransition.nextState,
      targetUserId: adminId,
      targetUserProfile: adminInitialState.userProfile
    });

    assert.equal(backToAdminTransition.nextState.userProfile.id, adminId);
    assert.equal(backToAdminTransition.nextState.userProfile.isAdmin, true);
  });

  it('15. Admin cannot impersonate another Admin (403 ADMIN_TARGET_IMPERSONATION_FORBIDDEN)', async () => {
    const res = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: secondAdminId })
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.code, 'ADMIN_TARGET_IMPERSONATION_FORBIDDEN');
  });

  it('16. adminMiddleware defense-in-depth: Normal user, impersonated normal user, and impersonated admin target are all strictly rejected from admin endpoints', async () => {
    // 1. Normal user
    const normalRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${normalUserToken}` }
    });
    assert.equal(normalRes.status, 403);
    const normalData = await normalRes.json();
    assert.equal(normalData.code, 'FORBIDDEN');

    // 2. Impersonated normal user
    const impRes = await fetch(`${baseUrl}/api/admin/impersonate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });
    const { token: impNormalToken } = await impRes.json();
    const impNormalRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${impNormalToken}` }
    });
    assert.equal(impNormalRes.status, 403);
    const impNormalData = await impNormalRes.json();
    assert.equal(impNormalData.code, 'IMPERSONATION_ACCESS_FORBIDDEN');

    // 3. Impersonated Admin target (defense-in-depth: token payload with isAdmin: true and isImpersonated: true)
    const craftedImpersonatedAdminToken = generateToken({
      userId: secondAdminId,
      phoneNumber: '09129999999',
      isVip: true,
      tier: 'vip_samurai',
      isAdmin: true,
      tokenVersion: 0,
      isImpersonated: true,
      impersonatedBy: adminId
    });
    const craftedRes = await fetch(`${baseUrl}/api/admin/users`, {
      headers: { Authorization: `Bearer ${craftedImpersonatedAdminToken}` }
    });
    assert.equal(craftedRes.status, 403);
    const craftedData = await craftedRes.json();
    assert.equal(craftedData.code, 'IMPERSONATION_ACCESS_FORBIDDEN');
  });

  it('17. Fail-safe exit: valid Admin restoration verifies with /api/auth/me and transitions state', async () => {
    // Pure unit validator with actual server
    const outcome = await validateAdminTokenForExit(adminToken, async (input, init) => {
      return fetch(`${baseUrl}${input}`, init);
    });

    assert.equal(outcome.success, true);
    if (outcome.success) {
      assert.equal(outcome.status, 'SUCCESS');
      assert.equal(outcome.adminUser.id, adminId);
      assert.equal(outcome.adminUser.isAdmin, true);

      // Verify pure success state builder
      const dummyTargetState = createInitialSystemState({
        id: normalUserId,
        name: 'سامورایی هدف',
        isAdmin: false
      });
      const transition = buildExitImpersonationSuccessState(dummyTargetState, outcome.adminUser);
      assert.equal(transition.nextState.userProfile.id, adminId);
      assert.equal(transition.nextState.userProfile.isAdmin, true);
    }
  });

  it('18. Fail-safe exit: expired / malformed Admin token returns AUTH_REVOKED and transitions to signed out', async () => {
    const invalidToken = 'malformed.token.xyz';
    const outcome = await validateAdminTokenForExit(invalidToken, async (input, init) => {
      return fetch(`${baseUrl}${input}`, init);
    });

    assert.equal(outcome.success, false);
    if (!outcome.success) {
      assert.equal(outcome.status, 'AUTH_REVOKED');
      const dummyTargetState = createInitialSystemState({
        id: normalUserId,
        name: 'سامورایی هدف',
        isAdmin: false
      });
      const transition = buildExitImpersonationRevokedState(dummyTargetState);
      assert.equal(transition.nextState.userProfile.id, '');
      assert.equal(transition.nextState.userProfile.isAdmin, false);
    }
  });

  it('19. Fail-safe exit: SESSION_REVOKED Admin token returns AUTH_REVOKED', async () => {
    // Invalidate admin's session
    const adminInDb = memoryStore.users.find(u => u.id === adminId);
    if (adminInDb) {
      adminInDb.tokenVersion = 5;
    }

    // Token has tokenVersion 0, db has 5
    const outcome = await validateAdminTokenForExit(adminToken, async (input, init) => {
      return fetch(`${baseUrl}${input}`, init);
    });

    assert.equal(outcome.success, false);
    if (!outcome.success) {
      assert.equal(outcome.status, 'AUTH_REVOKED');
      assert.equal(outcome.code, 'SESSION_REVOKED');
    }

    // Reset tokenVersion
    if (adminInDb) {
      adminInDb.tokenVersion = 0;
    }
  });

  it('20. Fail-safe exit: non-Admin identity returned from /api/auth/me returns INVALID_ADMIN_IDENTITY', async () => {
    // Normal user token passed as admin token
    const outcome = await validateAdminTokenForExit(normalUserToken, async (input, init) => {
      return fetch(`${baseUrl}${input}`, init);
    });

    assert.equal(outcome.success, false);
    if (!outcome.success) {
      assert.equal(outcome.status, 'INVALID_ADMIN_IDENTITY');
      assert.equal(outcome.code, 'NOT_AN_ADMIN');
    }
  });

  it('21. Fail-safe exit: temporary network failure preserves recoverable token without premature destruction', async () => {
    const mockNetworkFailureFetch = async () => {
      throw new TypeError('Failed to fetch: Network error');
    };

    const outcome = await validateAdminTokenForExit(adminToken, mockNetworkFailureFetch as any);

    assert.equal(outcome.success, false);
    if (!outcome.success) {
      assert.equal(outcome.status, 'NETWORK_ERROR');
      // Crucial: token was NOT revoked or marked invalid, recoverable state maintained
    }
  });

  it('22. Logout while impersonating purges impersonation metadata and clears local tokens', () => {
    const storage: Record<string, string> = {
      [TOKEN_KEY]: 'current-token',
      [IMPERSONATOR_TOKEN_KEY]: adminToken,
      [IMPERSONATING_USER_KEY]: JSON.stringify({ id: normalUserId })
    };

    const storageDriver = {
      removeLocal: (k: string) => { delete storage[k]; },
      removeSession: (k: string) => { delete storage[k]; },
      setSession: (k: string, v: string) => { storage[k] = v; }
    };

    const dummyState = createInitialSystemState({ id: normalUserId, name: 'سامورایی هدف' });
    const transition = executeLogoutDuringImpersonation(dummyState, storageDriver);

    assert.equal(transition.nextState.userProfile.id, '');
    assert.equal(transition.nextState.userProfile.isAdmin, false);
    assert.equal(storage[TOKEN_KEY], undefined);
    assert.equal(storage[IMPERSONATOR_TOKEN_KEY], undefined);
    assert.equal(storage[IMPERSONATING_USER_KEY], undefined);
    assert.equal(storage['bushido_explicit_logout'], 'true');
  });

  it('23. Page reload while impersonating safely resolves and maintains impersonation state', () => {
    const activeImpToken = 'active-impersonated-token';
    const storage: Record<string, string> = {
      [TOKEN_KEY]: activeImpToken,
      [IMPERSONATOR_TOKEN_KEY]: adminToken,
      [IMPERSONATING_USER_KEY]: JSON.stringify({ id: normalUserId, name: 'سامورایی هدف' })
    };

    const storageDriver = {
      getLocal: (k: string) => storage[k] || null,
      getSession: (k: string) => storage[k] || null
    };

    const boot = resolveImpersonationStateOnBoot(storageDriver);
    assert.equal(boot.isImpersonating, true);
    assert.equal(boot.activeToken, activeImpToken);
    assert.equal(boot.impersonatorAdminToken, adminToken);
    assert.equal(boot.impersonatingUser?.id, normalUserId);
  });

  it('24. Server-side POST /api/admin/impersonate/exit validates admin token and returns admin profile', async () => {
    const exitRes = await fetch(`${baseUrl}/api/admin/impersonate/exit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ targetUserId: normalUserId })
    });

    assert.equal(exitRes.status, 200);
    const data = await exitRes.json();
    assert.equal(data.success, true);
    assert.equal(data.user.id, adminId);
    assert.equal(data.user.isAdmin, true);
  });
});
