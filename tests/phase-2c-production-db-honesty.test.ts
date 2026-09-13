import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  setPrismaState,
  isDatabaseReady,
  assertPersistenceAvailable,
  initializeDatabase,
  isRunningOnVercel,
  getUserDailyLogs,
  upsertDailyLog,
  createCycle,
  findUserById
} from '../server/db/index.js';
import { harmonizeDatabaseEnv } from '../server/db/base.js';
import {
  executeDirectDailyLogMutation,
  rollbackOptimisticLogUpdate,
  DailyLog
} from '../src/utils/directMutationUtils.js';
import {
  getOfflineQueue,
  saveOfflineQueue
} from '../src/utils/offlineQueueUtils.js';

describe('Phase 2C: Production DB Honesty and Health Signal Suite', () => {
  const originalEnv = { ...process.env };
  const mockStorage: Record<string, string> = {};
  const storageMock = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
    removeItem: (key: string) => { delete mockStorage[key]; },
    clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
    get length() { return Object.keys(mockStorage).length; },
    key: (i: number) => Object.keys(mockStorage)[i] ?? null
  };

  beforeEach(() => {
    process.env = { ...originalEnv };
    mockStorage && Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    (globalThis as any).localStorage = storageMock;
    (globalThis as any).window = { localStorage: storageMock };
    setPrismaState(null, false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    mockStorage && Object.keys(mockStorage).forEach(k => delete mockStorage[k]);
    setPrismaState(null, false);
  });

  describe('1. Production Fail-Closed Invariants', () => {
    it('isDatabaseReady strictly requires connected Prisma in production', () => {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);
      assert.strictEqual(isDatabaseReady(), false, 'Must be false when Prisma is unavailable in production');

      setPrismaState({ $connect: async () => {} } as any, true);
      assert.strictEqual(isDatabaseReady(), true, 'Must be true when Prisma is available in production');
    });

    it('assertPersistenceAvailable throws 503 SERVICE_UNAVAILABLE in production if DB is down', () => {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);

      assert.throws(
        () => assertPersistenceAvailable('testOperation'),
        (err: any) => {
          return err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503;
        },
        'Must throw 503 SERVICE_UNAVAILABLE in production when DB is disconnected'
      );
    });

    it('database methods fail closed with 503 when called in production with DB down', async () => {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);

      await assert.rejects(
        async () => getUserDailyLogs('user-1'),
        (err: any) => err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503
      );

      await assert.rejects(
        async () => upsertDailyLog('user-1', { id: 'l1', cycleId: 'c1', date: '2026-09-13', wakeUp: true } as any),
        (err: any) => err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503
      );

      await assert.rejects(
        async () => createCycle('user-1', { id: 'c1', title: 'Test Cycle', startDate: '2026-09-13' } as any),
        (err: any) => err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503
      );

      await assert.rejects(
        async () => findUserById('user-1'),
        (err: any) => err.code === 'SERVICE_UNAVAILABLE' && err.statusCode === 503
      );
    });

    it('initializeDatabase throws fail-closed error in production when no PostgreSQL datasource is connectable', async () => {
      process.env.NODE_ENV = 'production';
      delete process.env.DATABASE_URL;
      delete process.env.POSTGRES_PRISMA_URL;
      delete process.env.POSTGRES_URL;
      delete process.env.POSTGRES_HOST;

      await assert.rejects(
        async () => initializeDatabase(),
        /Production database initialization failed: PostgreSQL datasource required/
      );
    });
  });

  describe('2. Health & Readiness Signals Clarity & Secret Censoring', () => {
    it('/api/health returns 200 ok when database is ready', async () => {
      process.env.NODE_ENV = 'production';
      setPrismaState({} as any, true);

      const serverModule = await import('../server.ts');
      const app = serverModule.default || serverModule.app;

      let statusCode = 0;
      let responseData: any = null;

      const mockReq: any = { method: 'GET', url: '/api/health', path: '/api/health' };
      const mockRes: any = {
        status: (code: number) => { statusCode = code; return mockRes; },
        json: (data: any) => { responseData = data; return mockRes; },
        setHeader: () => mockRes,
        removeHeader: () => mockRes
      };

      const routes = app._router.stack;
      const healthLayer = routes.find((r: any) => r.route && r.route.path === '/api/health');
      assert.ok(healthLayer, 'Health route must exist on express app');

      await healthLayer.route.stack[0].handle(mockReq, mockRes);

      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseData.status, 'ok');
      assert.strictEqual(responseData.ready, true);
      assert.ok(responseData.timestamp);

      // Secret & Diagnostic Leakage Verification
      assert.strictEqual(responseData.database, undefined, 'Must not leak database object');
      assert.strictEqual(responseData.DATABASE_URL, undefined, 'Must not leak DATABASE_URL');
      assert.strictEqual(responseData.POSTGRES_PRISMA_URL, undefined, 'Must not leak POSTGRES_PRISMA_URL');
      assert.strictEqual(responseData.password, undefined, 'Must not leak passwords');
      assert.strictEqual(responseData.stack, undefined, 'Must not leak stack');
    });

    it('/api/health returns 503 degraded when database is down in production', async () => {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);

      const serverModule = await import('../server.ts');
      const app = serverModule.default || serverModule.app;

      let statusCode = 0;
      let responseData: any = null;

      const mockReq: any = { method: 'GET', url: '/api/health', path: '/api/health' };
      const mockRes: any = {
        status: (code: number) => { statusCode = code; return mockRes; },
        json: (data: any) => { responseData = data; return mockRes; },
        setHeader: () => mockRes,
        removeHeader: () => mockRes
      };

      const routes = app._router.stack;
      const healthLayer = routes.find((r: any) => r.route && r.route.path === '/api/health');
      assert.ok(healthLayer, 'Health route must exist on express app');

      await healthLayer.route.stack[0].handle(mockReq, mockRes);

      assert.strictEqual(statusCode, 503);
      assert.strictEqual(responseData.status, 'degraded');
      assert.strictEqual(responseData.ready, false);
      assert.ok(responseData.timestamp);

      // Secret & Diagnostic Leakage Verification
      assert.strictEqual(responseData.database, undefined);
      assert.strictEqual(responseData.DATABASE_URL, undefined);
      assert.strictEqual(responseData.stack, undefined);
    });

    it('/api/ready returns 200 ready when database is ready', async () => {
      process.env.NODE_ENV = 'production';
      setPrismaState({} as any, true);

      const serverModule = await import('../server.ts');
      const app = serverModule.default || serverModule.app;

      let statusCode = 0;
      let responseData: any = null;

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

      assert.strictEqual(statusCode, 200);
      assert.strictEqual(responseData.status, 'ready');
      assert.strictEqual(responseData.ready, true);
    });

    it('/api/ready returns 503 unavailable when database is down in production', async () => {
      process.env.NODE_ENV = 'production';
      setPrismaState(null, false);

      const serverModule = await import('../server.ts');
      const app = serverModule.default || serverModule.app;

      let statusCode = 0;
      let responseData: any = null;

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

      assert.strictEqual(statusCode, 503);
      assert.strictEqual(responseData.status, 'unavailable');
      assert.strictEqual(responseData.ready, false);
      assert.strictEqual(responseData.code, 'SERVICE_UNAVAILABLE');
    });
  });

  describe('3. Env Harmonization & Vercel Localhost Protection', () => {
    it('handles empty and whitespace env strings gracefully without corrupting urls', () => {
      process.env.POSTGRES_PRISMA_URL = '   ';
      process.env.DATABASE_URL = '""';
      process.env.POSTGRES_URL = 'postgres://user:pass@ep-test.neon.tech/neondb';

      const harmonized = harmonizeDatabaseEnv();
      assert.ok(harmonized?.includes('ep-test.neon.tech'));
      assert.strictEqual(process.env.DATABASE_URL, harmonized);
    });

    it('detects Vercel environment correctly via isRunningOnVercel', () => {
      delete process.env.VERCEL;
      delete process.env.VERCEL_ENV;
      delete process.env.NOW_REGION;
      assert.strictEqual(isRunningOnVercel(), false);

      process.env.VERCEL = '1';
      assert.strictEqual(isRunningOnVercel(), true);
    });
  });

  describe('4. Client Honesty & Unsynced State When DB Down', () => {
    it('preserves isSynced: false in write-ahead queue when server responds with 503 Service Unavailable', async () => {
      const ownerId = 'user-db-down-test';
      const initialLog: DailyLog = {
        id: 'log-2026-09-13',
        cycleId: 'cycle-1',
        date: '2026-09-13',
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        notes: '',
        revision: 1,
        isSynced: true
      };

      const updatedLog: DailyLog = {
        ...initialLog,
        study: true,
        isSynced: false
      };

      // Mock fetch returning 503 Service Unavailable
      const mockFetch = async () => {
        return {
          ok: false,
          status: 503,
          json: async () => ({
            code: 'SERVICE_UNAVAILABLE',
            messageFa: 'سرویس پایگاه داده در دسترس نیست.'
          })
        } as any;
      };

      const result = await executeDirectDailyLogMutation({
        updatedLog,
        existingLog: initialLog,
        ownerId,
        authToken: 'valid-token',
        fetchFn: mockFetch as any
      });

      assert.strictEqual(result.status, 'SERVER_RETRYABLE');
      assert.strictEqual(result.statusCode, 503);

      // Verify the item remains in the offline queue with un-synced status
      const queue = getOfflineQueue(ownerId);
      assert.strictEqual(queue.length, 1);
      assert.strictEqual(queue[0].payload.study, true);
    });

    it('honestly rolls back and returns error when storage write fails during offline mutation', async () => {
      const ownerId = 'user-storage-failure-test';
      const initialLog: DailyLog = {
        id: 'log-2026-09-13',
        cycleId: 'cycle-1',
        date: '2026-09-13',
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        revision: 1,
        isSynced: true
      };

      const updatedLog: DailyLog = {
        ...initialLog,
        workout: true,
        isSynced: false
      };

      // Force storage setItem to throw QuotaExceededError
      const originalSetItem = storageMock.setItem;
      storageMock.setItem = () => {
        throw new Error('QuotaExceededError: storage full');
      };

      try {
        const result = await executeDirectDailyLogMutation({
          updatedLog,
          existingLog: initialLog,
          ownerId,
          authToken: 'valid-token'
        });

        assert.strictEqual(result.status, 'STORAGE_WRITE_FAILED');
        assert.ok(result.messageFa?.includes('خطا در ذخیره‌سازی محلی'));

        // Perform rollback
        const currentLogs = [updatedLog];
        const rolledBack = rollbackOptimisticLogUpdate(currentLogs, updatedLog.date, initialLog);
        assert.strictEqual(rolledBack[0].workout, false, 'Optimistic workout: true must be rolled back');
        assert.strictEqual(rolledBack[0].isSynced, true, 'Rolled back log must be restored to confirmed isSynced: true');
      } finally {
        storageMock.setItem = originalSetItem;
      }
    });

    it('rolls back optimistic state on 403 Forbidden without leaving fake synced checkmark', async () => {
      const ownerId = 'user-forbidden-test';
      const initialLog: DailyLog = {
        id: 'log-2026-09-13',
        cycleId: 'cycle-1',
        date: '2026-09-13',
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        revision: 1,
        isSynced: true
      };

      const updatedLog: DailyLog = {
        ...initialLog,
        workout: true,
        isSynced: false
      };

      const mockFetch = async () => {
        return {
          ok: false,
          status: 403,
          json: async () => ({
            code: 'FORBIDDEN',
            messageFa: 'دسترسی غیرمجاز.'
          })
        } as any;
      };

      const result = await executeDirectDailyLogMutation({
        updatedLog,
        existingLog: initialLog,
        ownerId,
        authToken: 'expired-or-forbidden-token',
        fetchFn: mockFetch as any
      });

      assert.strictEqual(result.status, 'FORBIDDEN');
      assert.strictEqual(result.statusCode, 403);

      // Verify item was removed from active queue and quarantined
      const queue = getOfflineQueue(ownerId);
      assert.strictEqual(queue.length, 0, 'Forbidden mutation must not remain in active replay queue');

      // Verify rollback
      const currentLogs = [updatedLog];
      const rolledBack = rollbackOptimisticLogUpdate(currentLogs, updatedLog.date, initialLog);
      assert.strictEqual(rolledBack[0].workout, false);
      assert.strictEqual(rolledBack[0].isSynced, true);
    });
  });
});
