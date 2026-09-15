import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { normalizeVercelUrl } from '../api/index.js';

describe('Bushido API Routing & Health Invariants Suite (Pre-Launch Lock)', () => {
  let server: http.Server;
  let baseUrl = '';
  let authToken = '';

  before(async () => {
    // Import api/index.js (which exports the Vercel serverless request handler wrapping Express)
    const apiModule = await import('../api/index.js');
    const handler = apiModule.default;

    server = http.createServer(handler);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as any;
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });

    // Obtain authenticated token via quick-login rewrite
    const loginRes = await fetch(`${baseUrl}/api?path=auth/quick-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'test_user' })
    });
    if (loginRes.ok) {
      const loginBody = await loginRes.json();
      authToken = loginBody.token;
    }
  });

  after(async () => {
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  /* -------------------------------------------------------------------------
   * 1. URL NORMALIZER UNIT CONTRACTS
   * ------------------------------------------------------------------------- */
  describe('1. normalizeVercelUrl Transformation Invariants', () => {
    it('normalizes ?path=health to /api/health', () => {
      const req: any = { url: '/api?path=health' };
      normalizeVercelUrl(req);
      assert.strictEqual(req.url, '/api/health');
    });

    it('normalizes ?path=logs/123 to /api/logs/123', () => {
      const req: any = { url: '/api?path=logs/123' };
      normalizeVercelUrl(req);
      assert.strictEqual(req.url, '/api/logs/123');
    });

    it('preserves additional query parameters when stripping path parameter', () => {
      const req: any = { url: '/api?path=logs&cycleId=cyc-999&limit=10' };
      normalizeVercelUrl(req);
      assert.strictEqual(req.url, '/api/logs?cycleId=cyc-999&limit=10');
    });

    it('leaves direct /api/health path untouched', () => {
      const req: any = { url: '/api/health' };
      normalizeVercelUrl(req);
      assert.strictEqual(req.url, '/api/health');
    });

    it('handles x-forwarded-uri header when present', () => {
      const req: any = {
        url: '/api',
        headers: { 'x-forwarded-uri': '/api/cycles/cyc-001?active=true' }
      };
      normalizeVercelUrl(req);
      assert.strictEqual(req.url, '/api/cycles/cyc-001?active=true');
    });
  });

  /* -------------------------------------------------------------------------
   * 2. HEALTH & READINESS PROBE CONTRACTS
   * ------------------------------------------------------------------------- */
  describe('2. Health & Readiness Probe JSON Contracts', () => {
    it('GET /api/health returns HTTP 200 with { status: "ok"|"degraded", ready: boolean, timestamp: string }', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/json/);

      const body = await res.json();
      assert.ok(body.status === 'ok' || body.status === 'degraded', 'status must be ok or degraded');
      assert.strictEqual(typeof body.ready, 'boolean', 'ready must be a boolean');
      assert.strictEqual(typeof body.timestamp, 'string', 'timestamp must be an ISO string');
      assert.ok(!Number.isNaN(Date.parse(body.timestamp)), 'timestamp must parse as valid date');
    });

    it('GET /api?path=health (Vercel rewrite) returns identical JSON health contract', async () => {
      const res = await fetch(`${baseUrl}/api?path=health`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/json/);

      const body = await res.json();
      assert.ok(body.status === 'ok' || body.status === 'degraded');
      assert.strictEqual(typeof body.ready, 'boolean');
      assert.strictEqual(typeof body.timestamp, 'string');
    });

    it('GET /api/ready and /api?path=ready return valid readiness JSON', async () => {
      const directRes = await fetch(`${baseUrl}/api/ready`);
      assert.strictEqual(directRes.status, 200);
      const directBody = await directRes.json();
      assert.strictEqual(directBody.status, 'ready');
      assert.strictEqual(directBody.ready, true);

      const rewriteRes = await fetch(`${baseUrl}/api?path=ready`);
      assert.strictEqual(rewriteRes.status, 200);
      const rewriteBody = await rewriteRes.json();
      assert.strictEqual(rewriteBody.status, 'ready');
      assert.strictEqual(rewriteBody.ready, true);
    });

    it('GET /api and GET /api/ return valid JSON root info (prevents Cannot GET /api)', async () => {
      const res = await fetch(`${baseUrl}/api`);
      assert.strictEqual(res.status, 200);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      const body = await res.json();
      assert.strictEqual(body.status, 'ok');
      assert.strictEqual(body.service, 'Bushido Discipline OS API');
      assert.strictEqual(body.health, '/api/health');

      const slashRes = await fetch(`${baseUrl}/api/`);
      assert.strictEqual(slashRes.status, 200);
      const slashBody = await slashRes.json();
      assert.strictEqual(slashBody.status, 'ok');
    });

    it('GET /api/nonexistent-route returns HTTP 404 JSON (NOT plain text or HTML)', async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent-route-xyz-999`);
      assert.strictEqual(res.status, 404);
      assert.match(res.headers.get('content-type') || '', /application\/json/);
      const body = await res.json();
      assert.strictEqual(body.error, 'NOT_FOUND');
      assert.ok(body.messageFa);
    });
  });

  /* -------------------------------------------------------------------------
   * 3. CYCLES API ROUTING & LIFECYCLE CONTRACTS
   * ------------------------------------------------------------------------- */
  describe('3. Cycles API Routing Contracts (Direct vs ?path= Rewrite)', () => {
    it('GET & POST /api/cycles requires authentication (returns 401 JSON, NOT HTML)', async () => {
      const unauthGetDirect = await fetch(`${baseUrl}/api/cycles`);
      assert.strictEqual(unauthGetDirect.status, 401);
      const unauthGetDirectBody = await unauthGetDirect.json();
      assert.ok(unauthGetDirectBody.code || unauthGetDirectBody.error);

      const unauthGetRewrite = await fetch(`${baseUrl}/api?path=cycles`);
      assert.strictEqual(unauthGetRewrite.status, 401);
      const unauthGetRewriteBody = await unauthGetRewrite.json();
      assert.ok(unauthGetRewriteBody.code || unauthGetRewriteBody.error);

      const unauthPostRewrite = await fetch(`${baseUrl}/api?path=cycles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'نبرد ۱', startDate: '1405-01-01' })
      });
      assert.strictEqual(unauthPostRewrite.status, 401);
      const unauthPostRewriteBody = await unauthPostRewrite.json();
      assert.ok(unauthPostRewriteBody.code || unauthPostRewriteBody.error);
    });

    it('creates, retrieves, updates, and deletes cycles under /api?path=cycles rewrites', async () => {
      assert.ok(authToken, 'Auth token must be available from quick login');

      const cyclePayload = {
        title: 'چرخه آزمایشی مسیر',
        startDate: '1405-01-01',
        endDate: '1405-03-31',
        targetTheme: 'تمرکز و انضباط',
        rules: ['سحرخیزی ساعت ۵']
      };

      // 1. Create Cycle via /api?path=cycles
      const createRes = await fetch(`${baseUrl}/api?path=cycles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(cyclePayload)
      });
      assert.strictEqual(createRes.status, 200, 'Cycle creation via rewrite should succeed');
      const createBody = await createRes.json();
      assert.ok(createBody.cycle, 'Should return created cycle');
      const createdCycleId = createBody.cycle.id;

      // 2. Fetch Cycles via /api?path=cycles
      const listRes = await fetch(`${baseUrl}/api?path=cycles`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      assert.strictEqual(listRes.status, 200);
      const listBody = await listRes.json();
      assert.ok(Array.isArray(listBody.cycles));
      assert.ok(listBody.cycles.some((c: any) => c.id === createdCycleId));

      // 3. Update Cycle via /api?path=cycles/${createdCycleId}
      const updateRes = await fetch(`${baseUrl}/api?path=cycles/${createdCycleId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title: 'چرخه آزمایشی مسیر (ویرایش شده)',
          expectedRevision: createBody.cycle.revision || 1
        })
      });
      assert.strictEqual(updateRes.status, 200);
      const updateBody = await updateRes.json();
      assert.strictEqual(updateBody.cycle.title, 'چرخه آزمایشی مسیر (ویرایش شده)');

      // 4. Delete Cycle via /api?path=cycles/${createdCycleId}
      const deleteRes = await fetch(`${baseUrl}/api?path=cycles/${createdCycleId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'If-Match': `"${updateBody.cycle.revision || 2}"`
        }
      });
      assert.strictEqual(deleteRes.status, 200);
      const deleteBody = await deleteRes.json();
      assert.strictEqual(deleteBody.success, true);
    });
  });

  /* -------------------------------------------------------------------------
   * 4. DAILY LOGS API ROUTING & QUERY STRING CONTRACTS
   * ------------------------------------------------------------------------- */
  describe('4. Daily Logs API Routing & Query Preservation Contracts', () => {
    it('creates, retrieves with query filter, and updates logs under /api?path=logs', async () => {
      assert.ok(authToken, 'Auth token must be available from quick login');

      // Create parent cycle first
      const cyclePayload = {
        title: 'چرخه گزارش‌ها',
        startDate: '1405-01-01',
        endDate: '1405-03-31'
      };
      const cycleRes = await fetch(`${baseUrl}/api?path=cycles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(cyclePayload)
      });
      assert.strictEqual(cycleRes.status, 200, 'Cycle creation for log test should succeed');
      const cycleData = await cycleRes.json();
      const parentCycleId = cycleData.cycle.id;

      const day = String(Math.floor(1 + Math.random() * 28)).padStart(2, '0');
      const month = String(Math.floor(1 + Math.random() * 12)).padStart(2, '0');
      const uniqueDate = `1406-${month}-${day}`;
      const logPayload = {
        cycleId: parentCycleId,
        date: uniqueDate,
        wakeUp: true,
        workout: true,
        study: false,
        journal: true,
        hardTask: true
      };

      // 1. Post Daily Log via /api?path=logs
      const postLogRes = await fetch(`${baseUrl}/api?path=logs`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify(logPayload)
      });
      assert.strictEqual(postLogRes.status, 200);
      const postLogBody = await postLogRes.json();
      assert.strictEqual(postLogBody.success, true);
      assert.strictEqual(postLogBody.log.date, uniqueDate);

      // 2. Query logs with ?cycleId= filter preserved across rewrite: /api?path=logs&cycleId=${parentCycleId}
      const queryLogsRes = await fetch(`${baseUrl}/api?path=logs&cycleId=${parentCycleId}`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      assert.strictEqual(queryLogsRes.status, 200);
      const queryLogsBody = await queryLogsRes.json();
      assert.ok(Array.isArray(queryLogsBody.logs));
      assert.ok(queryLogsBody.logs.some((l: any) => l.cycleId === parentCycleId));

      // 3. Query logs for non-existent cycle returns empty array
      const emptyLogsRes = await fetch(`${baseUrl}/api?path=logs&cycleId=cyc_non_existent_999`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      assert.strictEqual(emptyLogsRes.status, 200);
      const emptyLogsBody = await emptyLogsRes.json();
      assert.deepStrictEqual(emptyLogsBody.logs, []);
    });
  });

  /* -------------------------------------------------------------------------
   * 5. AUTH & PROFILE ROUTES
   * ------------------------------------------------------------------------- */
  describe('5. Auth & Profile Routes under /api?path= Rewrite', () => {
    it('GET /api?path=auth/me returns authenticated user profile', async () => {
      assert.ok(authToken);
      const res = await fetch(`${baseUrl}/api?path=auth/me`, {
        headers: {
          'Authorization': `Bearer ${authToken}`
        }
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.ok(body.user);
      assert.strictEqual(typeof body.user.id, 'string');
    });

    it('POST /api?path=auth/send-otp handles validation and returns JSON', async () => {
      const freshPhone = `0919${Math.floor(1000000 + Math.random() * 9000000)}`;
      const res = await fetch(`${baseUrl}/api?path=auth/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: freshPhone,
          purpose: 'PHONE_REGISTRATION'
        })
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.success, true);
      assert.strictEqual(body.phoneNumber, freshPhone);
    });
  });
});

