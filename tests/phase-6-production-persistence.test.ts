import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {
  initializeDatabase,
  isDatabaseReady,
  assertPersistenceAvailable,
  createUser,
  createCycle,
  upsertDailyLog,
  createSubscriptionRecord,
  saveLocalStore,
  loadLocalStore,
  setPrismaState,
  isPrismaAvailable,
  memoryStore
} from '../server/db/index.js';

describe('Phase 6 Production Persistence Audit & Fail-Closed Invariants', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalDatabaseUrl = process.env.DATABASE_URL;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalDatabaseUrl) {
      process.env.DATABASE_URL = originalDatabaseUrl;
    } else {
      delete process.env.DATABASE_URL;
    }
    // Restore non-production state
    setPrismaState(null, false);
  });

  describe('1. Production Initialization Rejection', () => {
    it('throws error and does not treat failed PostgreSQL init as success in production', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      setPrismaState(null, false);

      await assert.rejects(
        async () => {
          await initializeDatabase();
        },
        (err: any) => {
          assert.match(err.message, /Production database initialization failed/);
          return true;
        },
        'Production initialization must throw when authoritative PostgreSQL is unavailable'
      );

      // Verify that database is NOT marked as ready
      assert.strictEqual(isDatabaseReady(), false, 'isDatabaseReady() must return false when Prisma is unavailable in production');
      assert.strictEqual(isPrismaAvailable, false, 'isPrismaAvailable must remain false');
    });
  });

  describe('2. Direct Persistence Operations Fail Closed in Production', () => {
    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);
    });

    it('assertPersistenceAvailable throws SERVICE_UNAVAILABLE 503 error in production', () => {
      assert.throws(
        () => {
          assertPersistenceAvailable('testOperation');
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
          assert.strictEqual(err.statusCode, 503);
          return true;
        }
      );
    });

    it('createUser fails closed and does not mutate memoryStore in production', async () => {
      const initialUsersCount = memoryStore.users.length;
      await assert.rejects(
        async () => {
          await createUser({
            name: 'Test Samurai',
            email: 'test@bushido.local',
            passwordHash: 'hash123'
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
          assert.strictEqual(err.statusCode, 503);
          return true;
        }
      );
      assert.strictEqual(memoryStore.users.length, initialUsersCount, 'memoryStore must not receive unauthoritative writes in production');
    });

    it('createCycle fails closed and rejects write in production without Prisma', async () => {
      await assert.rejects(
        async () => {
          await createCycle('user-123', {
            title: 'New Cycle',
            startDate: '2026-09-01',
            endDate: '2026-11-29',
            rules: []
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
          assert.strictEqual(err.statusCode, 503);
          return true;
        }
      );
    });

    it('upsertDailyLog fails closed and rejects log write in production without Prisma', async () => {
      await assert.rejects(
        async () => {
          await upsertDailyLog('user-123', {
            cycleId: 'cycle-123',
            date: '2026-09-06',
            status: 'completed'
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
          assert.strictEqual(err.statusCode, 503);
          return true;
        }
      );
    });

    it('createSubscriptionRecord fails closed and rejects write in production without Prisma', async () => {
      await assert.rejects(
        async () => {
          await createSubscriptionRecord({
            userId: 'user-123',
            planId: 'monthly_plan',
            amount: 199000,
            authority: 'AUTH-TEST-001'
          });
        },
        (err: any) => {
          assert.strictEqual(err.code, 'SERVICE_UNAVAILABLE');
          assert.strictEqual(err.statusCode, 503);
          return true;
        }
      );
    });

    it('saveLocalStore is a safe no-op in production (never treats local file or memory as authoritative)', () => {
      // Should execute without throwing and without writing to disk
      assert.doesNotThrow(() => {
        saveLocalStore();
      });
    });

    it('loadLocalStore in production returns empty fallback rather than stale unauthoritative data', () => {
      const store = loadLocalStore();
      assert.deepStrictEqual(store.users, []);
      assert.deepStrictEqual(store.cycles, []);
    });
  });

  describe('3. Development and Test Fallback Invariants', () => {
    it('allows memory and local fallback when NODE_ENV is test', async () => {
      process.env.NODE_ENV = 'test';
      setPrismaState(null, false);

      await assert.doesNotReject(async () => {
        await initializeDatabase();
      });

      assert.strictEqual(isDatabaseReady(), true, 'isDatabaseReady() must be true in test mode');
      assert.doesNotThrow(() => {
        assertPersistenceAvailable('testDevOp');
      });
    });

    it('allows memory and local fallback when NODE_ENV is development', async () => {
      process.env.NODE_ENV = 'development';
      setPrismaState(null, false);

      await assert.doesNotReject(async () => {
        await initializeDatabase();
      });

      assert.strictEqual(isDatabaseReady(), true, 'isDatabaseReady() must be true in development mode');
    });
  });

  describe('4. Health & Readiness Probe Contract', () => {
    it('isDatabaseReady reflects Prisma connection status in production', () => {
      process.env.NODE_ENV = 'production';
      
      setPrismaState(null, false);
      assert.strictEqual(isDatabaseReady(), false, 'Must be false when Prisma is unavailable in production');

      setPrismaState({} as any, true);
      assert.strictEqual(isDatabaseReady(), true, 'Must be true when Prisma is available in production');
    });

    it('public health check does not expose sensitive database or environment secrets', async () => {
      // Import the Express app from server.ts
      const serverModule = await import('../server.ts');
      const app = serverModule.default || serverModule.app;

      // Mock request and response to verify /api/health output payload
      let responseData: any = null;
      let statusCode = 200;

      const mockReq: any = { method: 'GET', url: '/api/health', path: '/api/health' };
      const mockRes: any = {
        status: (code: number) => { statusCode = code; return mockRes; },
        json: (data: any) => { responseData = data; return mockRes; },
        setHeader: () => mockRes,
        removeHeader: () => mockRes
      };

      // Find the health route handler from app._router.stack
      const routes = app._router.stack;
      const healthLayer = routes.find((r: any) => r.route && r.route.path === '/api/health');
      assert.ok(healthLayer, 'Health route must exist on express app');

      await healthLayer.route.stack[0].handle(mockReq, mockRes);

      assert.strictEqual(statusCode, 200);
      assert.ok(responseData, 'Health response must be present');
      assert.strictEqual(responseData.status, 'ok');
      assert.ok(responseData.timestamp, 'Timestamp must be present');

      // Crucial Security Verification: No sensitive internal leaks
      assert.strictEqual(responseData.database, undefined, 'Public health probe must not leak database diagnostics');
      assert.strictEqual(responseData.DATABASE_URL, undefined, 'Public health probe must not leak DATABASE_URL');
      assert.strictEqual(responseData.memoryUsage, undefined, 'Public health probe must not leak memory metrics');
      assert.strictEqual(responseData.stack, undefined, 'Public health probe must not leak stack traces');
    });

    it('public readiness probe returns 503 when database is unavailable in production', async () => {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);

      const serverModule = await import('../server.ts');
      const app = serverModule.default || serverModule.app;

      let responseData: any = null;
      let statusCode = 200;

      const mockReq: any = { method: 'GET', url: '/api/ready', path: '/api/ready' };
      const mockRes: any = {
        status: (code: number) => { statusCode = code; return mockRes; },
        json: (data: any) => { responseData = data; return mockRes; },
        setHeader: () => mockRes,
        removeHeader: () => mockRes
      };

      const routes = app._router.stack;
      const readyLayer = routes.find((r: any) => r.route && r.route.path === '/api/ready');
      assert.ok(readyLayer, 'Ready route must exist on express app');

      await readyLayer.route.stack[0].handle(mockReq, mockRes);

      assert.strictEqual(statusCode, 503, 'Readiness probe must return 503 when database is unavailable');
      assert.strictEqual(responseData.status, 'unavailable');
      assert.strictEqual(responseData.ready, false);
      assert.strictEqual(responseData.code, 'SERVICE_UNAVAILABLE');
      assert.ok(responseData.messageFa);

      // Verify no sensitive connection strings or diagnostics leaked in 503 response
      assert.strictEqual(responseData.driver, undefined);
      assert.strictEqual(responseData.DATABASE_URL, undefined);
    });

    it('public readiness probe returns 200 when database is ready', async () => {
      process.env.NODE_ENV = 'test';
      setPrismaState(null, false); // In test, fallback is considered ready

      const serverModule = await import('../server.ts');
      const app = serverModule.default || serverModule.app;

      let responseData: any = null;
      let statusCode = 200;

      const mockReq: any = { method: 'GET', url: '/api/ready', path: '/api/ready' };
      const mockRes: any = {
        status: (code: number) => { statusCode = code; return mockRes; },
        json: (data: any) => { responseData = data; return mockRes; },
        setHeader: () => mockRes,
        removeHeader: () => mockRes
      };

      const routes = app._router.stack;
      const readyLayer = routes.find((r: any) => r.route && r.route.path === '/api/ready');
      assert.ok(readyLayer, 'Ready route must exist on express app');

      await readyLayer.route.stack[0].handle(mockReq, mockRes);

      assert.strictEqual(statusCode, 200, 'Readiness probe must return 200 when database is ready');
      assert.strictEqual(responseData.status, 'ready');
      assert.strictEqual(responseData.ready, true);
    });
  });
});
