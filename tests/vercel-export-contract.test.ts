import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Vercel Export & Serverless Contract', () => {
  it('exports an executable Express application from api/index.js and api/[...path].js (robust CJS/ESM interop)', async () => {
    // Set VERCEL environment flag to simulate Vercel serverless environment
    process.env.VERCEL = '1';

    // Dynamically import api/index.js as Vercel would
    const apiModule = await import('../api/index.js');
    const app = apiModule.default;

    assert.ok(app, 'api/index.js must export a default value');
    assert.strictEqual(typeof app, 'function', 'api/index.js default export must be an executable function (Express app)');
    assert.strictEqual(typeof app.use, 'function', 'Exported app must have express middleware function .use()');
    assert.strictEqual(typeof app.get, 'function', 'Exported app must have express routing function .get()');
    assert.strictEqual(typeof app.post, 'function', 'Exported app must have express routing function .post()');

    // Dynamically import api/[...path].js as Vercel would for catch-all
    const catchAllModule = await import('../api/[...path].js');
    const catchAllApp = catchAllModule.default;

    assert.ok(catchAllApp, 'api/[...path].js must export a default value');
    assert.strictEqual(typeof catchAllApp, 'function', 'api/[...path].js default export must be an executable function');
    assert.strictEqual(typeof catchAllApp.use, 'function', 'Exported catchAllApp must have express middleware function .use()');
    assert.strictEqual(typeof catchAllApp.get, 'function', 'Exported catchAllApp must have express routing function .get()');
    assert.strictEqual(typeof catchAllApp.post, 'function', 'Exported catchAllApp must have express routing function .post()');
  });

  it('handles simulated Vercel serverless request preserving full /api/ paths with fallback', async () => {
    const http = await import('node:http');
    const catchAllModule = await import('../api/[...path].js');
    const handler = catchAllModule.default;

    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      // 1. Direct /api/health path preservation
      const directRes = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.strictEqual(directRes.status, 200, 'Direct /api/health should be 200');
      const directData = await directRes.json();
      assert.ok(directData.status === 'ok' || directData.status === 'degraded');
      assert.strictEqual(typeof directData.ready, 'boolean');

      // 2. Direct /api/logs with missing auth -> returns 401 JSON, NOT HTML
      const logsRes = await fetch(`http://127.0.0.1:${port}/api/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test' })
      });
      assert.strictEqual(logsRes.status, 401, 'POST /api/logs without auth must be 401');
      const logsData = await logsRes.json();
      assert.ok(logsData.error || logsData.messageFa || logsData.code, 'Should return JSON error body, not HTML');

      // 3. Fallback: query parameter (?path=health)
      const queryRes = await fetch(`http://127.0.0.1:${port}/api?path=health`);
      assert.strictEqual(queryRes.status, 200, 'Status should be 200 with ?path=health');
      const queryData = await queryRes.json();
      assert.ok(queryData.status === 'ok' || queryData.status === 'degraded');
      assert.strictEqual(typeof queryData.ready, 'boolean');

      // 4. Quick login route
      const authRes = await fetch(`http://127.0.0.1:${port}/api/auth/quick-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      assert.ok(authRes.status >= 400 && authRes.status < 500, 'Empty body should yield 4xx JSON response');
      const authData = await authRes.json();
      assert.ok(authData.error || authData.messageFa || authData.code, 'Should return JSON error body, not HTML');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});



