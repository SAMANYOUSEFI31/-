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
});
