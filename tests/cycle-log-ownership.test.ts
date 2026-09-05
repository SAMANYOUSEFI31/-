import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  memoryStore,
  saveLocalStore,
  setPrismaState,
  getUserCycles,
  getCycleById,
  createCycle,
  updateCycle,
  archiveCycle,
  restoreCycle,
  deleteCycle,
  getUserDailyLogs,
  getDailyLogById,
  getDailyLogByDate,
  upsertDailyLog,
  updateDailyLog,
  deleteDailyLog,
  deleteDailyLogByDate
} from '../server/db/index.js';
import { generateToken } from '../server/auth.js';
import { app } from '../server.js';

describe('Phase 3A.2: Server-Side Cycle and DailyLog Ownership Integrity Suite', () => {
  const userA = 'user-alpha-001';
  const userB = 'user-beta-002';
  const attackerUser = 'attacker-evil-999';

  let server: http.Server;
  let baseUrl = '';

  const tokenUserA = generateToken({
    userId: userA,
    phoneNumber: '09121111111',
    isVip: false,
    tier: 'FREE'
  });

  const tokenUserB = generateToken({
    userId: userB,
    phoneNumber: '09122222222',
    isVip: false,
    tier: 'FREE'
  });

  before(async () => {
    // Spin up ephemeral HTTP server for live route and middleware ownership testing
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
    memoryStore.users = [
      {
        id: userA,
        phoneNumber: '09121111111',
        name: 'کاربر آلفا',
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: userB,
        phoneNumber: '09122222222',
        name: 'کاربر بتا',
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
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    saveLocalStore();
  });

  /* =========================================================================
   * PART 1: PERSISTENCE & DB-LAYER OWNERSHIP VALIDATION
   * ========================================================================= */
  describe('Part 1: Database & Persistence Layer Ownership Isolation', () => {
    it('Test 1.1: User A creates a Cycle -> strictly owned by User A', async () => {
      const cycle = await createCycle(userA, {
        title: 'چرخه اول آلفا',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        targetTheme: 'amber',
        inheritedStreak: 5,
        rules: ['بیداری سحرگاهی', 'ورزش سامورایی']
      });

      assert.ok(cycle.id);
      assert.equal(cycle.userId, userA);
      assert.equal(cycle.title, 'چرخه اول آلفا');
      assert.equal(cycle.isArchived, false);

      const inStore = memoryStore.cycles.find(c => c.id === cycle.id);
      assert.ok(inStore);
      assert.equal(inStore.userId, userA);
    });

    it('Test 1.2: Cycle list isolation -> User A sees only A cycles, User B sees only B cycles', async () => {
      await createCycle(userA, {
        title: 'چرخه ۱ آلفا',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });
      await createCycle(userB, {
        title: 'چرخه ۱ بتا',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });

      const userACycles = await getUserCycles(userA);
      assert.equal(userACycles.length, 1);
      assert.equal(userACycles[0].userId, userA);
      assert.equal(userACycles[0].title, 'چرخه ۱ آلفا');

      const userBCycles = await getUserCycles(userB);
      assert.equal(userBCycles.length, 1);
      assert.equal(userBCycles[0].userId, userB);
      assert.equal(userBCycles[0].title, 'چرخه ۱ بتا');
    });

    it('Test 1.3: User B operations on User A Cycle are denied and persistence remains unchanged', async () => {
      const cycleA = await createCycle(userA, {
        title: 'چرخه دست‌نخورده آلفا',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        targetTheme: 'amber'
      });

      // Non-owner read
      const readAttempt = await getCycleById(userB, cycleA.id);
      assert.equal(readAttempt, null);

      // Non-owner update
      const updateAttempt = await updateCycle(userB, cycleA.id, {
        title: 'تغییر غیرمجاز توسط کاربر B',
        targetTheme: 'crimson'
      }, 1);
      assert.equal(updateAttempt, null);

      // Non-owner archive
      const archiveAttempt = await archiveCycle(userB, cycleA.id, 1);
      assert.equal(archiveAttempt, null);

      // Non-owner restore
      const restoreAttempt = await restoreCycle(userB, cycleA.id, 1);
      assert.equal(restoreAttempt, null);

      // Non-owner delete
      const deleteAttempt = await deleteCycle(userB, cycleA.id, 1);
      assert.equal(deleteAttempt, false);

      // Persistence unchanged check
      const cycleAVerify = await getCycleById(userA, cycleA.id);
      assert.ok(cycleAVerify);
      assert.equal(cycleAVerify.title, 'چرخه دست‌نخورده آلفا');
      assert.equal(cycleAVerify.targetTheme, 'amber');
      assert.equal(cycleAVerify.isArchived, false);
      assert.equal(cycleAVerify.userId, userA);
    });

    it('Test 1.4: Cross-user cycle ID collision/hijacking is rejected', async () => {
      const cycleA = await createCycle(userA, {
        id: 'cycle-custom-fixed-id-1',
        title: 'چرخه ثابت آلفا',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });

      // User B attempts to create a cycle claiming User A's cycle ID
      await assert.rejects(
        async () => {
          await createCycle(userB, {
            id: cycleA.id,
            title: 'تلاش تصاحب توسط کاربر B',
            startDate: '2026-09-01',
            endDate: '2026-09-30'
          });
        },
        (err: any) => {
          assert.equal(err.code, 'CYCLE_ID_COLLISION');
          return true;
        }
      );

      // Verify User A cycle remains completely intact
      const verifyA = await getCycleById(userA, cycleA.id);
      assert.ok(verifyA);
      assert.equal(verifyA.title, 'چرخه ثابت آلفا');
      assert.equal(verifyA.userId, userA);
    });

    it('Test 1.5: User B cannot create DailyLog under User A Cycle -> Rejected, 0 records created', async () => {
      const cycleA = await createCycle(userA, {
        title: 'چرخه خصوصی آلفا',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });

      await assert.rejects(
        async () => {
          await upsertDailyLog(userB, {
            cycleId: cycleA.id,
            date: '2026-09-06',
            wakeUp: true,
            workout: true
          });
        },
        (err: any) => {
          assert.ok(err.code === 'CYCLE_NOT_FOUND' || err.message?.includes('Cycle not found'));
          return true;
        }
      );

      // Persistence unchanged: exactly 0 logs
      assert.equal(memoryStore.dailyLogs.length, 0);
      assert.equal((await getUserDailyLogs(userA)).length, 0);
      assert.equal((await getUserDailyLogs(userB)).length, 0);
    });

    it('Test 1.6: User B cannot read, update, or delete User A DailyLog -> Rejected, log intact', async () => {
      const cycleA = await createCycle(userA, {
        title: 'چرخه آلفا',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });

      const logA = await upsertDailyLog(userA, {
        cycleId: cycleA.id,
        date: '2026-09-10',
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: true,
        notes: 'گزارش روزانه اختصاصی آلفا'
      });

      // Non-owner read by ID
      const readById = await getDailyLogById(userB, logA.id);
      assert.equal(readById, null);

      // Non-owner read by Date
      const readByDate = await getDailyLogByDate(userB, '2026-09-10');
      assert.equal(readByDate, null);

      // Non-owner update
      const updateAttempt = await updateDailyLog(userB, logA.id, {
        notes: 'تلاش خرابکاری در یادداشت',
        wakeUp: false
      }, 1);
      assert.equal(updateAttempt, null);

      // Non-owner delete by ID
      const deleteById = await deleteDailyLog(userB, logA.id, 1);
      assert.equal(deleteById, false);

      // Non-owner delete by Date
      const deleteByDate = await deleteDailyLogByDate(userB, '2026-09-10', 1);
      assert.equal(deleteByDate, false);

      // Persistence unchanged: User A log retains all original values
      const verifyLogA = await getDailyLogById(userA, logA.id);
      assert.ok(verifyLogA);
      assert.equal(verifyLogA.notes, 'گزارش روزانه اختصاصی آلفا');
      assert.equal(verifyLogA.wakeUp, true);
      assert.equal(verifyLogA.userId, userA);
    });

    it('Test 1.7: User A cannot move DailyLog to User B cycle -> Rejected with CYCLE_NOT_FOUND', async () => {
      const cycleA = await createCycle(userA, {
        title: 'چرخه آلفا',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });

      const cycleB = await createCycle(userB, {
        title: 'چرخه بتا',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });

      const logA = await upsertDailyLog(userA, {
        cycleId: cycleA.id,
        date: '2026-09-11',
        wakeUp: true
      });

      // User A attempts to reparent their log to User B's cycle
      await assert.rejects(
        async () => {
          await updateDailyLog(userA, logA.id, {
            cycleId: cycleB.id
          }, 1);
        },
        (err: any) => {
          assert.equal(err.code, 'CYCLE_NOT_FOUND');
          return true;
        }
      );

      // Persistence unchanged: log retains original cycleId
      const verifyLog = await getDailyLogById(userA, logA.id);
      assert.ok(verifyLog);
      assert.equal(verifyLog.cycleId, cycleA.id);
    });

    it('Test 1.8: Client userId spoofing payload is strictly overridden by authenticated user', async () => {
      const cycle = await createCycle(attackerUser, {
        title: 'چرخه مهاجم',
        startDate: '2026-09-01',
        endDate: '2026-09-30',
        ...({ userId: userA } as any)
      });
      assert.equal(cycle.userId, attackerUser);

      const updated = await updateCycle(attackerUser, cycle.id, {
        title: 'عنوان تغییر یافته',
        ...({ userId: userA, id: 'hijacked-id' } as any)
      }, 1);
      assert.ok(updated);
      assert.equal(updated.userId, attackerUser);
      assert.equal(updated.id, cycle.id);
    });

    it('Test 1.9: Deleting Cycle cascades only to owned DailyLogs, leaving foreign records untouched', async () => {
      const cycleA = await createCycle(userA, {
        title: 'چرخه A',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });
      await upsertDailyLog(userA, {
        cycleId: cycleA.id,
        date: '2026-09-01',
        wakeUp: true
      });

      const cycleB = await createCycle(userB, {
        title: 'چرخه B',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      });
      await upsertDailyLog(userB, {
        cycleId: cycleB.id,
        date: '2026-09-01',
        wakeUp: true
      });

      const deleteRes = await deleteCycle(userA, cycleA.id, 1);
      assert.equal(deleteRes, true);

      // User A records deleted
      assert.equal((await getUserCycles(userA)).length, 0);
      assert.equal((await getUserDailyLogs(userA)).length, 0);

      // User B records 100% intact
      const userBCycles = await getUserCycles(userB);
      assert.equal(userBCycles.length, 1);
      assert.equal(userBCycles[0].id, cycleB.id);

      const userBLogs = await getUserDailyLogs(userB);
      assert.equal(userBLogs.length, 1);
      assert.equal(userBLogs[0].cycleId, cycleB.id);
    });
  });

  /* =========================================================================
   * PART 2: HTTP ROUTE-LAYER OWNERSHIP VALIDATION MATRIX
   * Covers all 4 required evidence criteria:
   *   1. Owner success case
   *   2. Non-owner denial case
   *   3. Unauthenticated denial case
   *   4. Persistence unchanged after denied mutation
   * ========================================================================= */
  describe('Part 2: HTTP Route-Layer Ownership & Access Control Matrix', () => {
    // -------------------------------------------------------------------------
    // 2.1 Cycle Read: GET /api/cycles/:id
    // -------------------------------------------------------------------------
    describe('GET /api/cycles/:id', () => {
      it('1. Owner success case -> 200 with cycle data', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          headers: { Authorization: `Bearer ${tokenUserA}` }
        });
        assert.equal(res.status, 200);
        const body: any = await res.json();
        assert.equal(body.cycle.id, cycle.id);
        assert.equal(body.cycle.userId, userA);
      });

      it('2. Non-owner denial case -> 404 NOT_FOUND', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          headers: { Authorization: `Bearer ${tokenUserB}` }
        });
        assert.equal(res.status, 404);
        const body: any = await res.json();
        assert.equal(body.code, 'NOT_FOUND');
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`);
        assert.equal(res.status, 401);
      });
    });

    // -------------------------------------------------------------------------
    // 2.2 Cycle Update: PUT /api/cycles/:id
    // -------------------------------------------------------------------------
    describe('PUT /api/cycles/:id', () => {
      it('1. Owner success case -> 200 with updated cycle', async () => {
        const cycle = await createCycle(userA, {
          title: 'عنوان اولیه',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenUserA}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title: 'عنوان به‌روزرسانی‌شده', expectedRevision: 1 })
        });
        assert.equal(res.status, 200);
        const body: any = await res.json();
        assert.equal(body.cycle.title, 'عنوان به‌روزرسانی‌شده');
      });

      it('2. Non-owner denial case -> 404 NOT_FOUND', async () => {
        const cycle = await createCycle(userA, {
          title: 'عنوان اولیه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenUserB}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title: 'تلاش هک توسط کاربر B', expectedRevision: 1 })
        });
        assert.equal(res.status, 404);
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'عنوان آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'بدون توکن', expectedRevision: 1 })
        });
        assert.equal(res.status, 401);
      });

      it('4. Persistence unchanged after denied mutation', async () => {
        const cycle = await createCycle(userA, {
          title: 'عنوان اصلی دست‌نخورده',
          startDate: '2026-09-01',
          endDate: '2026-09-30',
          targetTheme: 'amber'
        });

        // Denied attempt by User B
        await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenUserB}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ title: 'تلاش تغییر غیرمجاز', targetTheme: 'crimson', expectedRevision: 1 })
        });

        // Verify cycle is unchanged in store
        const verify = await getCycleById(userA, cycle.id);
        assert.ok(verify);
        assert.equal(verify.title, 'عنوان اصلی دست‌نخورده');
        assert.equal(verify.targetTheme, 'amber');
      });
    });

    // -------------------------------------------------------------------------
    // 2.3 Cycle Archive & Restore: PUT /api/cycles/:id/archive & restore
    // -------------------------------------------------------------------------
    describe('PUT /api/cycles/:id/archive & /restore', () => {
      it('1. Owner success case -> 200 with isArchived toggled', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        // Archive
        const archRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}/archive`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokenUserA}`, 'x-expected-revision': '1' }
        });
        assert.equal(archRes.status, 200);
        assert.equal((await archRes.json() as any).cycle.isArchived, true);

        // Restore
        const restRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}/restore`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokenUserA}`, 'x-expected-revision': '2' }
        });
        assert.equal(restRes.status, 200);
        assert.equal((await restRes.json() as any).cycle.isArchived, false);
      });

      it('2. Non-owner denial case -> 404 NOT_FOUND for both archive and restore', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const archRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}/archive`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokenUserB}`, 'x-expected-revision': '1' }
        });
        assert.equal(archRes.status, 404);

        const restRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}/restore`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokenUserB}`, 'x-expected-revision': '1' }
        });
        assert.equal(restRes.status, 404);
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const archRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}/archive`, {
          method: 'PUT',
          headers: { 'x-expected-revision': '1' }
        });
        assert.equal(archRes.status, 401);

        const restRes = await fetch(`${baseUrl}/api/cycles/${cycle.id}/restore`, {
          method: 'PUT',
          headers: { 'x-expected-revision': '1' }
        });
        assert.equal(restRes.status, 401);
      });

      it('4. Persistence unchanged after denied archive mutation', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        await fetch(`${baseUrl}/api/cycles/${cycle.id}/archive`, {
          method: 'PUT',
          headers: { Authorization: `Bearer ${tokenUserB}`, 'x-expected-revision': '1' }
        });

        const verify = await getCycleById(userA, cycle.id);
        assert.ok(verify);
        assert.equal(verify.isArchived, false);
      });
    });

    // -------------------------------------------------------------------------
    // 2.4 Cycle Delete: DELETE /api/cycles/:id
    // -------------------------------------------------------------------------
    describe('DELETE /api/cycles/:id', () => {
      it('1. Owner success case -> 200 with success: true and deleted from store', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه برای حذف',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenUserA}`, 'x-expected-revision': '1' }
        });
        assert.equal(res.status, 200);

        const verify = await getCycleById(userA, cycle.id);
        assert.equal(verify, null);
      });

      it('2. Non-owner denial case -> 404 NOT_FOUND', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه محافظت‌شده آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenUserB}`, 'x-expected-revision': '1' }
        });
        assert.equal(res.status, 404);
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه محافظت‌شده آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'DELETE',
          headers: { 'x-expected-revision': '1' }
        });
        assert.equal(res.status, 401);
      });

      it('4. Persistence unchanged after denied deletion', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه محافظت‌شده آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        await fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenUserB}`, 'x-expected-revision': '1' }
        });

        const verify = await getCycleById(userA, cycle.id);
        assert.ok(verify);
        assert.equal(verify.title, 'چرخه محافظت‌شده آلفا');
      });
    });

    // -------------------------------------------------------------------------
    // 2.5 DailyLog Creation under Cycle: POST /api/logs & /api/daily-logs
    // -------------------------------------------------------------------------
    describe('POST /api/logs & /api/daily-logs (Create Log)', () => {
      it('1. Owner success case -> 200 with created daily log', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/logs`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenUserA}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cycleId: cycle.id,
            date: '2026-09-02',
            wakeUp: true,
            workout: true
          })
        });
        assert.equal(res.status, 200);
        const body: any = await res.json();
        assert.equal(body.log.cycleId, cycle.id);
        assert.equal(body.log.userId, userA);
        assert.equal(body.log.wakeUp, true);
      });

      it('2. Non-owner denial case -> 404 CYCLE_NOT_FOUND when targeting foreign cycle', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/logs`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenUserB}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cycleId: cycle.id,
            date: '2026-09-02',
            wakeUp: true
          })
        });
        assert.equal(res.status, 404);
        const body: any = await res.json();
        assert.equal(body.code, 'CYCLE_NOT_FOUND');
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        const res = await fetch(`${baseUrl}/api/logs`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cycleId: cycle.id,
            date: '2026-09-02',
            wakeUp: true
          })
        });
        assert.equal(res.status, 401);
      });

      it('4. Persistence unchanged after denied log creation', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });

        // User B attempts to create log under User A's cycle
        await fetch(`${baseUrl}/api/logs`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenUserB}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            cycleId: cycle.id,
            date: '2026-09-03',
            wakeUp: true
          })
        });

        // Verify 0 logs exist in DB
        assert.equal(memoryStore.dailyLogs.length, 0);
        assert.equal((await getUserDailyLogs(userA)).length, 0);
        assert.equal((await getUserDailyLogs(userB)).length, 0);
      });
    });

    // -------------------------------------------------------------------------
    // 2.6 DailyLog Read: GET /api/logs/:id & /api/daily-logs/:id
    // -------------------------------------------------------------------------
    describe('GET /api/logs/:id & /api/daily-logs/:id', () => {
      it('1. Owner success case -> 200 with log data', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-04',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          headers: { Authorization: `Bearer ${tokenUserA}` }
        });
        assert.equal(res.status, 200);
        const body: any = await res.json();
        assert.equal(body.log.id, log.id);
        assert.equal(body.log.userId, userA);
      });

      it('2. Non-owner denial case -> 404 NOT_FOUND', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-04',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          headers: { Authorization: `Bearer ${tokenUserB}` }
        });
        assert.equal(res.status, 404);
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-04',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`);
        assert.equal(res.status, 401);
      });
    });

    // -------------------------------------------------------------------------
    // 2.7 DailyLog Update: PUT /api/logs/:id & /api/daily-logs/:id
    // -------------------------------------------------------------------------
    describe('PUT /api/logs/:id & /api/daily-logs/:id (Update Log)', () => {
      it('1. Owner success case -> 200 with updated log fields', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-05',
          wakeUp: false,
          notes: 'یادداشت اولیه'
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenUserA}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            wakeUp: true,
            workout: true,
            notes: 'یادداشت جدید سامورایی',
            expectedRevision: 1
          })
        });
        assert.equal(res.status, 200);
        const body: any = await res.json();
        assert.equal(body.log.wakeUp, true);
        assert.equal(body.log.workout, true);
        assert.equal(body.log.notes, 'یادداشت جدید سامورایی');
      });

      it('2. Non-owner denial case -> 404 NOT_FOUND', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-05',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenUserB}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ wakeUp: false, expectedRevision: 1 })
        });
        assert.equal(res.status, 404);
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-05',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wakeUp: false, expectedRevision: 1 })
        });
        assert.equal(res.status, 401);
      });

      it('4. Persistence unchanged after denied log update', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-05',
          wakeUp: true,
          notes: 'یادداشت دست‌نخورده آلفا'
        });

        // Denied attempt by User B
        await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenUserB}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ wakeUp: false, notes: 'تخریب توسط هکر', expectedRevision: 1 })
        });

        // Verify in DB
        const verifyLog = await getDailyLogById(userA, log.id);
        assert.ok(verifyLog);
        assert.equal(verifyLog.wakeUp, true);
        assert.equal(verifyLog.notes, 'یادداشت دست‌نخورده آلفا');
      });

      it('5. User A updating log with User B cycleId -> 404 CYCLE_NOT_FOUND, cycleId unchanged', async () => {
        const cycleA = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const cycleB = await createCycle(userB, {
          title: 'چرخه بتا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const logA = await upsertDailyLog(userA, {
          cycleId: cycleA.id,
          date: '2026-09-06',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${logA.id}`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${tokenUserA}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ cycleId: cycleB.id, expectedRevision: 1 })
        });
        assert.equal(res.status, 404);
        const body: any = await res.json();
        assert.equal(body.code, 'CYCLE_NOT_FOUND');

        // Persistence unchanged check
        const verifyLog = await getDailyLogById(userA, logA.id);
        assert.ok(verifyLog);
        assert.equal(verifyLog.cycleId, cycleA.id);
      });
    });

    // -------------------------------------------------------------------------
    // 2.8 DailyLog Delete: DELETE /api/logs/:id & /api/daily-logs/:id
    // -------------------------------------------------------------------------
    describe('DELETE /api/logs/:id & /api/daily-logs/:id (Delete Log)', () => {
      it('1. Owner success case -> 200 with success: true and deleted from store', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-07',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenUserA}`, 'x-expected-revision': '1' }
        });
        assert.equal(res.status, 200);

        const verify = await getDailyLogById(userA, log.id);
        assert.equal(verify, null);
      });

      it('2. Non-owner denial case -> 404 NOT_FOUND', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-07',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenUserB}`, 'x-expected-revision': '1' }
        });
        assert.equal(res.status, 404);
      });

      it('3. Unauthenticated denial case -> 401 UNAUTHORIZED', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-07',
          wakeUp: true
        });

        const res = await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'DELETE',
          headers: { 'x-expected-revision': '1' }
        });
        assert.equal(res.status, 401);
      });

      it('4. Persistence unchanged after denied log deletion', async () => {
        const cycle = await createCycle(userA, {
          title: 'چرخه آلفا',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
        const log = await upsertDailyLog(userA, {
          cycleId: cycle.id,
          date: '2026-09-07',
          wakeUp: true,
          notes: 'یادداشت مهم که نباید پاک شود'
        });

        // Non-owner delete attempt
        await fetch(`${baseUrl}/api/logs/${log.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${tokenUserB}`, 'x-expected-revision': '1' }
        });

        // Verify log is still in database
        const verifyLog = await getDailyLogById(userA, log.id);
        assert.ok(verifyLog);
        assert.equal(verifyLog.notes, 'یادداشت مهم که نباید پاک شود');
      });
    });
  });
});
