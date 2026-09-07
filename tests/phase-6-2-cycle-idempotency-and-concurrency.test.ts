import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import { generateToken } from '../server/auth.js';
import {
  memoryStore,
  setPrismaState,
  createCycle,
  getCycleById,
  updateCycle,
  upsertDailyLog,
  getDailyLogByDate
} from '../server/db/index.js';

describe('Phase 6.2 Focused Audit: Concurrent CreateCycle Idempotency & Simultaneous Update Proofs', () => {
  const userAlpha = 'usr_idemp_alpha_62';
  const userBeta = 'usr_idemp_beta_62';

  const tokenAlpha = generateToken({
    userId: userAlpha,
    phoneNumber: '09121112233',
    isVip: true,
    tier: 'VIP',
    isAdmin: false
  });

  let server: http.Server;
  let baseUrl = '';
  const originalFetch = globalThis.fetch;

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
    globalThis.fetch = originalFetch;
    if (server) {
      (server as any).closeAllConnections?.();
      server.unref?.();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  beforeEach(() => {
    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.users = [
      {
        id: userAlpha,
        phoneNumber: '09121112233',
        email: 'alpha@bushido.local',
        name: 'Alpha Idempotency User',
        passwordHash: 'hashed_pwd_alpha',
        tier: 'vip',
        isVip: true,
        isAdmin: false,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: userBeta,
        phoneNumber: '09124445566',
        email: 'beta@bushido.local',
        name: 'Beta Idempotency User',
        passwordHash: 'hashed_pwd_beta',
        tier: 'vip',
        isVip: true,
        isAdmin: false,
        tokenVersion: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  });

  afterEach(() => {
    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
  });

  // =========================================================================
  // 1. Sequential same-operation duplicate Create
  // =========================================================================
  it('1. Sequential same-operation duplicate Create - both calls return the same Cycle ID, exactly one exists, revision remains 1', async () => {
    const opId = 'op_seq_dup_001';

    const first = await createCycle(userAlpha, {
      clientOperationId: opId,
      title: 'Sequential Master Cycle',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    assert.equal(first.id, `cyc_${userAlpha}_${opId}`);
    assert.equal(first.revision, 1);

    const second = await createCycle(userAlpha, {
      clientOperationId: opId,
      title: 'Sequential Master Cycle (Duplicate Delivery)',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    assert.equal(second.id, first.id);
    assert.equal(second.revision, 1);
    assert.equal(memoryStore.cycles.length, 1);
  });

  // =========================================================================
  // 2. Simulated concurrent Prisma Create race
  // =========================================================================
  it('2. Simulated concurrent Prisma Create race - losing caller on P2002 rereads authoritative winning Cycle, preserving revision 1', async () => {
    const opId = 'op_prisma_race_002';
    const targetCycleId = `cyc_${userAlpha}_${opId}`;

    let createdRecordInDB: any = null;

    // Controllable Prisma Mock simulating two concurrent create calls entering before either completes
    const mockPrismaClient: any = {
      cycle: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          if (createdRecordInDB && createdRecordInDB.id === where.id) {
            return createdRecordInDB;
          }
          return null;
        },
        create: async ({ data }: { data: any }) => {
          // If already created, simulate Prisma Unique constraint violation (P2002)
          if (createdRecordInDB && createdRecordInDB.id === data.id) {
            const p2002Err: any = new Error('Unique constraint failed on the constraint: `Cycle_id_key`');
            p2002Err.code = 'P2002';
            throw p2002Err;
          }
          // Winning create
          createdRecordInDB = {
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
            revision: 1
          };
          return createdRecordInDB;
        }
      }
    };

    setPrismaState(mockPrismaClient, true);

    // Both callers execute concurrently
    const [resultA, resultB] = await Promise.all([
      createCycle(userAlpha, {
        clientOperationId: opId,
        title: 'Concurrent Race Cycle A',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      }),
      createCycle(userAlpha, {
        clientOperationId: opId,
        title: 'Concurrent Race Cycle B',
        startDate: '2026-09-01',
        endDate: '2026-09-30'
      })
    ]);

    assert.equal(resultA.id, targetCycleId);
    assert.equal(resultB.id, targetCycleId);
    assert.equal(resultA.revision, 1);
    assert.equal(resultB.revision, 1);
    assert.equal(createdRecordInDB.id, targetCycleId);
  });

  // =========================================================================
  // 3. Different operation collision
  // =========================================================================
  it('3. Different operation collision - random target without clientOperationId colliding throws safe typed CYCLE_ID_COLLISION', async () => {
    const mockPrismaClient: any = {
      cycle: {
        findUnique: async () => null,
        create: async () => {
          const p2002Err: any = new Error('Unique constraint failed on the fields: (`id`)');
          p2002Err.code = 'P2002';
          throw p2002Err;
        }
      }
    };

    setPrismaState(mockPrismaClient, true);

    await assert.rejects(
      async () => {
        await createCycle(userAlpha, {
          title: 'Random Collision Cycle',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
      },
      (err: any) => {
        assert.equal(err.code, 'CYCLE_ID_COLLISION');
        assert.match(err.message, /already exists/);
        return true;
      }
    );
  });

  // =========================================================================
  // 4. Cross-owner collision
  // =========================================================================
  it('4. Cross-owner collision - User B cannot claim User A deterministic cycle ID, no data exposed', async () => {
    const sharedCollisionId = 'cyc_shared_collision_id';

    const mockPrismaClient: any = {
      cycle: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          if (where.id === sharedCollisionId) {
            return {
              id: sharedCollisionId,
              userId: userAlpha, // Belongs to User Alpha
              title: 'Alpha Top Secret Strategy',
              revision: 1
            };
          }
          return null;
        },
        create: async () => {
          const p2002Err: any = new Error('Unique constraint failed on the fields: (`id`)');
          p2002Err.code = 'P2002';
          throw p2002Err;
        }
      }
    };

    setPrismaState(mockPrismaClient, true);

    // User Beta attempts to create using the same explicit ID
    await assert.rejects(
      async () => {
        await createCycle(userBeta, {
          id: sharedCollisionId,
          title: 'Beta Attempted Hijack',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
      },
      (err: any) => {
        assert.equal(err.code, 'CYCLE_ID_COLLISION');
        assert.match(err.message, /already belongs to another user/);
        // Ensure no confidential data from User Alpha is exposed in the error message
        assert.doesNotMatch(err.message, /Top Secret/);
        assert.doesNotMatch(err.message, new RegExp(userAlpha));
        return true;
      }
    );
  });

  // =========================================================================
  // 5. P2002 with missing authoritative reread
  // =========================================================================
  it('5. P2002 with missing authoritative reread - fails closed safely rather than guessing success', async () => {
    const opId = 'op_ghost_reread_005';
    const targetCycleId = `cyc_${userAlpha}_${opId}`;

    const mockPrismaClient: any = {
      cycle: {
        findUnique: async () => null, // Reread returns null (e.g. concurrent hard delete)
        create: async () => {
          const p2002Err: any = new Error('Unique constraint failed on the fields: (`id`)');
          p2002Err.code = 'P2002';
          throw p2002Err;
        }
      }
    };

    setPrismaState(mockPrismaClient, true);

    await assert.rejects(
      async () => {
        await createCycle(userAlpha, {
          clientOperationId: opId,
          title: 'Ghost Reread Cycle',
          startDate: '2026-09-01',
          endDate: '2026-09-30'
        });
      },
      (err: any) => {
        assert.equal(err.code, 'CYCLE_ID_COLLISION');
        return true;
      }
    );
  });

  // =========================================================================
  // 6. Real simultaneous stale Update evidence (Cycle)
  // =========================================================================
  it('6. Real simultaneous Cycle Update evidence - two concurrent HTTP updates with expectedRevision=1: exactly one 200, exactly one 409', async () => {
    setPrismaState(null, false);
    const cycle = await createCycle(userAlpha, {
      title: 'Simultaneous Base Cycle',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    assert.equal(cycle.revision, 1);

    // Issue two updates simultaneously over HTTP
    const [res1, res2] = await Promise.all([
      fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
        body: JSON.stringify({
          title: 'Simultaneous Update Alpha-1',
          expectedRevision: 1
        })
      }),
      fetch(`${baseUrl}/api/cycles/${cycle.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
        body: JSON.stringify({
          title: 'Simultaneous Update Alpha-2',
          expectedRevision: 1
        })
      })
    ]);

    const statuses = [res1.status, res2.status].sort();
    assert.deepEqual(statuses, [200, 409], 'Exactly one update must succeed (200) and one must fail with Conflict (409)');

    const finalCycle = await getCycleById(userAlpha, cycle.id);
    assert.equal(finalCycle?.revision, 2, 'Authoritative revision increments exactly once to 2');
  });

  // =========================================================================
  // 7. Equivalent simultaneous DailyLog Update evidence
  // =========================================================================
  it('7. Equivalent simultaneous DailyLog Update evidence - two concurrent HTTP updates with expectedRevision=1: exactly one 200, exactly one 409', async () => {
    setPrismaState(null, false);
    const cycle = await createCycle(userAlpha, {
      title: 'Simultaneous Log Cycle',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    const initialLog = await upsertDailyLog(userAlpha, {
      cycleId: cycle.id,
      date: '2026-09-06',
      wakeUp: true
    });
    assert.equal(initialLog.revision, 1);

    // Issue two simultaneous updates with expectedRevision=1
    const [logRes1, logRes2] = await Promise.all([
      fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
        body: JSON.stringify({
          cycleId: cycle.id,
          date: '2026-09-06',
          workout: true,
          expectedRevision: 1
        })
      }),
      fetch(`${baseUrl}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tokenAlpha}` },
        body: JSON.stringify({
          cycleId: cycle.id,
          date: '2026-09-06',
          study: true,
          expectedRevision: 1
        })
      })
    ]);

    const logStatuses = [logRes1.status, logRes2.status].sort();
    assert.deepEqual(logStatuses, [200, 409], 'Exactly one log update must succeed (200) and one must receive Conflict (409)');

    const finalLog = await getDailyLogByDate(userAlpha, '2026-09-06');
    assert.equal(finalLog?.revision, 2, 'Final log revision increments exactly once to 2');
  });
});
