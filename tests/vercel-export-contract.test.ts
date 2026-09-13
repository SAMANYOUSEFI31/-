import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

describe('Vercel Export & Serverless Contract', () => {
  it('exports an executable Express application from api/index.js (robust CJS/ESM interop)', async () => {
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
  });

  it('handles simulated Vercel serverless request with query path parameter (?path=health)', async () => {
    const http = await import('node:http');
    const apiModule = await import('../api/index.js');
    const handler = apiModule.default;

    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : 0;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api?path=health`);
      assert.strictEqual(res.status, 200, 'Status should be 200');
      const data = await res.json();
      assert.ok(data.status === 'ok' || data.status === 'degraded');
      assert.strictEqual(typeof data.ready, 'boolean');

      const directRes = await fetch(`http://127.0.0.1:${port}/api/health`);
      assert.strictEqual(directRes.status, 200, 'Direct /api/health should be 200');
      const directData = await directRes.json();
      assert.ok(directData.status === 'ok' || directData.status === 'degraded');

      const authRes = await fetch(`http://127.0.0.1:${port}/api?path=auth/quick-login`, {
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



