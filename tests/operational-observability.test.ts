import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { app } from '../server.js';
import {
  errorHandler,
  requestIdMiddleware,
  getRequestId,
  AppError
} from '../server/middleware/security.js';
import {
  getAppEnvironment,
  isProduction,
  isStaging,
  allowTestShortcuts,
  isOtpDebugEnabled
} from '../server/security.js';

describe('Phase: Operational Observability Baseline Contracts', () => {
  let server: http.Server;
  let baseUrl = '';

  before(async () => {
    // Start server using the exported express app wrapped in standard http server
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

  /* =========================================================================
   * A. REQUEST ID GENERATION CONTRACTS
   * ========================================================================= */
  describe('A. Request ID Generation & Header Propagation', () => {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it('returns X-Request-ID header on successful 200 API responses', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      assert.strictEqual(res.status, 200);
      const reqId = res.headers.get('x-request-id');
      assert.ok(reqId, 'X-Request-ID header must be present on successful response');
      assert.match(reqId, uuidRegex, 'X-Request-ID must be a valid UUID');
    });

    it('returns X-Request-ID header on 401 unauthenticated API responses', async () => {
      const res = await fetch(`${baseUrl}/api/cycles`);
      assert.strictEqual(res.status, 401);
      const reqId = res.headers.get('x-request-id');
      assert.ok(reqId, 'X-Request-ID header must be present on 401 response');
      assert.match(reqId, uuidRegex, 'X-Request-ID must be a valid UUID');
    });

    it('returns X-Request-ID header on 404 not found API responses', async () => {
      const res = await fetch(`${baseUrl}/api/nonexistent-endpoint-test`);
      assert.strictEqual(res.status, 404);
      const reqId = res.headers.get('x-request-id');
      assert.ok(reqId, 'X-Request-ID header must be present on 404 response');
      assert.match(reqId, uuidRegex, 'X-Request-ID must be a valid UUID');
    });

    it('generates unique request IDs across distinct requests', async () => {
      const [res1, res2] = await Promise.all([
        fetch(`${baseUrl}/api/health`),
        fetch(`${baseUrl}/api/health`)
      ]);
      const id1 = res1.headers.get('x-request-id');
      const id2 = res2.headers.get('x-request-id');
      assert.ok(id1);
      assert.ok(id2);
      assert.notStrictEqual(id1, id2, 'Each request must receive a distinct unique request ID');
    });

    it('does NOT allow client-supplied X-Request-ID to control the authoritative server ID', async () => {
      const clientInboundId = 'attacker-supplied-custom-request-id-12345';
      const res = await fetch(`${baseUrl}/api/health`, {
        headers: {
          'X-Request-ID': clientInboundId
        }
      });
      assert.strictEqual(res.status, 200);
      const serverId = res.headers.get('x-request-id');
      assert.ok(serverId);
      assert.notStrictEqual(serverId, clientInboundId, 'Server MUST NOT trust client-supplied X-Request-ID as authoritative');
      assert.match(serverId, uuidRegex, 'Server-controlled ID must be a cryptographically valid UUID');
    });

    it('getRequestId helper extracts the request ID from Request object safely', () => {
      assert.strictEqual(getRequestId(null), '');
      assert.strictEqual(getRequestId(undefined), '');
      assert.strictEqual(getRequestId({} as any), '');
      assert.strictEqual(getRequestId({ requestId: 'uuid-123' } as any), 'uuid-123');
      assert.strictEqual(getRequestId({ id: 'uuid-456' } as any), 'uuid-456');
    });
  });

  /* =========================================================================
   * B. STRUCTURED 5XX LOGGING CONTRACTS
   * ========================================================================= */
  describe('B. Structured 5xx Error Logging', () => {
    it('emits a single structured JSON log event on unexpected 5xx errors', () => {
      const loggedLines: string[] = [];
      const originalConsoleError = console.error;
      console.error = (msg: any) => {
        loggedLines.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
      };

      try {
        const mockReq: any = {
          id: 'test-req-uuid-999',
          requestId: 'test-req-uuid-999',
          method: 'POST',
          baseUrl: '/api',
          path: '/cycles',
          originalUrl: '/api/cycles?query=value'
        };

        const mockRes: any = {
          statusCode: 500,
          headers: {} as Record<string, string>,
          getHeader(name: string) {
            return this.headers[name.toLowerCase()] || this.headers[name];
          },
          setHeader(name: string, val: string) {
            this.headers[name.toLowerCase()] = val;
          },
          status(code: number) {
            this.statusCode = code;
            return this;
          },
          json(body: any) {
            this.body = body;
            return this;
          }
        };

        const testError = new Error('Unexpected database connection failure');
        testError.name = 'DatabaseFatalError';

        errorHandler(testError, mockReq, mockRes, () => {});

        assert.strictEqual(mockRes.statusCode, 500);
        assert.strictEqual(loggedLines.length, 1, 'Exactly one structured JSON log line must be written');

        const parsedLog = JSON.parse(loggedLines[0]);
        assert.strictEqual(parsedLog.event, 'server_error');
        assert.strictEqual(parsedLog.requestId, 'test-req-uuid-999');
        assert.strictEqual(parsedLog.method, 'POST');
        assert.strictEqual(parsedLog.path, '/api/cycles');
        assert.strictEqual(parsedLog.statusCode, 500);
        assert.strictEqual(parsedLog.errorCode, 'INTERNAL_SERVER_ERROR');
        assert.strictEqual(parsedLog.errorName, 'DatabaseFatalError');
        assert.ok(parsedLog.environment, 'Environment must be present in log');
        assert.ok(parsedLog.timestamp, 'Timestamp must be present in log');
        assert.ok(!isNaN(Date.parse(parsedLog.timestamp)), 'Timestamp must be valid ISO date');
      } finally {
        console.error = originalConsoleError;
      }
    });

    it('strips query parameters from path in structured log payload', () => {
      const loggedLines: string[] = [];
      const originalConsoleError = console.error;
      console.error = (msg: any) => {
        loggedLines.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
      };

      try {
        const mockReq: any = {
          requestId: 'req-strip-query-123',
          method: 'GET',
          path: '/api/logs',
          originalUrl: '/api/logs?cycleId=secret-cycle-123&page=2'
        };

        const mockRes: any = {
          statusCode: 500,
          headers: {},
          getHeader(name: string) { return this.headers[name]; },
          setHeader(name: string, val: string) { this.headers[name] = val; },
          status(code: number) { this.statusCode = code; return this; },
          json(body: any) { this.body = body; return this; }
        };

        errorHandler(new Error('Boom'), mockReq, mockRes, () => {});

        assert.strictEqual(loggedLines.length, 1);
        const parsedLog = JSON.parse(loggedLines[0]);
        assert.strictEqual(parsedLog.path, '/api/logs', 'Path must not contain query parameters');
        assert.ok(!parsedLog.path.includes('secret-cycle-123'));
      } finally {
        console.error = originalConsoleError;
      }
    });
  });

  /* =========================================================================
   * C. REDACTION & SENSITIVE DATA DEFENSE CONTRACTS
   * ========================================================================= */
  describe('C. Redaction of Sensitive Data in Logs', () => {
    const origEnv = { ...process.env };

    after(() => {
      process.env = { ...origEnv };
    });

    it('redacts DATABASE_URL, JWT_SECRET, passwords, OTPs, Bearer tokens, and merchant secrets from error messages', () => {
      process.env.DATABASE_URL = 'postgresql://postgres:SuperSecretPassword123@db.internal:5432/bushido_db';
      process.env.JWT_SECRET = 'ultra-secret-jwt-key-999';
      process.env.SUPER_ADMIN_PASS = 'SuperAdminSecretMasterKey';
      process.env.ZARINPAL_MERCHANT_ID = 'zarinpal-merchant-secret-uuid-123';

      const loggedLines: string[] = [];
      const originalConsoleError = console.error;
      console.error = (msg: any) => {
        loggedLines.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
      };

      try {
        const mockReq: any = {
          requestId: 'redact-test-id-1',
          method: 'POST',
          path: '/api/auth/login'
        };

        const mockRes: any = {
          statusCode: 500,
          headers: {},
          getHeader(name: string) { return this.headers[name]; },
          setHeader(name: string, val: string) { this.headers[name] = val; },
          status(code: number) { this.statusCode = code; return this; },
          json(body: any) { this.body = body; return this; }
        };

        const leakedMessage = `Failed connecting to postgresql://postgres:SuperSecretPassword123@db.internal:5432/bushido_db with JWT secret ultra-secret-jwt-key-999 and master pass SuperAdminSecretMasterKey for merchant zarinpal-merchant-secret-uuid-123 with Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.XYZ and otp: 849201`;
        const testError = new Error(leakedMessage);

        errorHandler(testError, mockReq, mockRes, () => {});

        assert.strictEqual(loggedLines.length, 1);
        const logString = loggedLines[0];

        // Verify none of the sensitive values are leaked
        assert.ok(!logString.includes('SuperSecretPassword123'), 'DB password must not be in logs');
        assert.ok(!logString.includes('ultra-secret-jwt-key-999'), 'JWT secret must not be in logs');
        assert.ok(!logString.includes('SuperAdminSecretMasterKey'), 'SuperAdmin password must not be in logs');
        assert.ok(!logString.includes('zarinpal-merchant-secret-uuid-123'), 'Merchant ID must not be in logs');
        assert.ok(!logString.includes('849201'), 'OTP code must not be in logs');

        const parsedLog = JSON.parse(logString);
        assert.ok(!parsedLog.body, 'Request body must NEVER be in log object');
        assert.ok(!parsedLog.headers, 'Request headers must NEVER be in log object');
        assert.ok(!parsedLog.query, 'Query values must NEVER be in log object');
      } finally {
        console.error = originalConsoleError;
        process.env = { ...origEnv };
      }
    });

    it('in production environment, error message in logs and response is generic safe string', () => {
      const loggedLines: string[] = [];
      const originalConsoleError = console.error;
      console.error = (msg: any) => {
        loggedLines.push(typeof msg === 'string' ? msg : JSON.stringify(msg));
      };

      try {
        process.env.APP_ENV = 'production';
        process.env.NODE_ENV = 'production';

        const mockReq: any = {
          requestId: 'prod-err-id-1',
          method: 'GET',
          path: '/api/cycles'
        };

        const mockRes: any = {
          statusCode: 500,
          headers: {},
          getHeader(name: string) { return this.headers[name]; },
          setHeader(name: string, val: string) { this.headers[name] = val; },
          status(code: number) { this.statusCode = code; return this; },
          json(body: any) { this.body = body; return this; }
        };

        const sensitiveError = new Error('Sensitive internal DB query failure table=users');
        errorHandler(sensitiveError, mockReq, mockRes, () => {});

        assert.strictEqual(mockRes.statusCode, 500);
        assert.strictEqual(mockRes.body.stack, undefined, 'Stack trace must be omitted in production response');
        assert.strictEqual(mockRes.body.message, 'An internal server error occurred.');

        assert.strictEqual(loggedLines.length, 1);
        const parsedLog = JSON.parse(loggedLines[0]);
        assert.strictEqual(parsedLog.message, 'An internal server error occurred.');
        assert.strictEqual(parsedLog.environment, 'production');
      } finally {
        console.error = originalConsoleError;
        process.env = { ...origEnv };
      }
    });
  });

  /* =========================================================================
   * D. EXISTING CONTROLLED ERROR CONTRACTS
   * ========================================================================= */
  describe('D. Controlled Error Response Contracts', () => {
    it('preserves 428 PreconditionRequiredError mapping with entity metadata', () => {
      const mockReq: any = { requestId: 'req-precondition-1', path: '/api/cycles/1' };
      const mockRes: any = {
        statusCode: 428,
        headers: {},
        getHeader(name: string) { return this.headers[name]; },
        setHeader(name: string, val: string) { this.headers[name] = val; },
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { this.body = body; return this; }
      };

      const err: any = new Error('Revision required');
      err.name = 'PreconditionRequiredError';
      err.entityType = 'cycle';
      err.entityId = 'cyc-100';

      errorHandler(err, mockReq, mockRes, () => {});

      assert.strictEqual(mockRes.statusCode, 428);
      assert.strictEqual(mockRes.body.code, 'PRECONDITION_REQUIRED');
      assert.strictEqual(mockRes.body.entityType, 'cycle');
      assert.strictEqual(mockRes.body.entityId, 'cyc-100');
    });

    it('preserves 409 ConcurrencyConflictError mapping with revisions', () => {
      const mockReq: any = { requestId: 'req-conflict-1', path: '/api/cycles/1' };
      const mockRes: any = {
        statusCode: 409,
        headers: {},
        getHeader(name: string) { return this.headers[name]; },
        setHeader(name: string, val: string) { this.headers[name] = val; },
        status(code: number) { this.statusCode = code; return this; },
        json(body: any) { this.body = body; return this; }
      };

      const err: any = new Error('Concurrency conflict');
      err.name = 'ConcurrencyConflictError';
      err.entityType = 'cycle';
      err.entityId = 'cyc-100';
      err.currentRevision = 3;
      err.expectedRevision = 2;

      errorHandler(err, mockReq, mockRes, () => {});

      assert.strictEqual(mockRes.statusCode, 409);
      assert.strictEqual(mockRes.body.code, 'CONFLICT');
      assert.strictEqual(mockRes.body.currentRevision, 3);
      assert.strictEqual(mockRes.body.expectedRevision, 2);
    });

    it('preserves 503 ServiceUnavailableError mapping without leaking db config in staging/production', () => {
      const origEnv = { ...process.env };
      try {
        process.env.APP_ENV = 'staging';
        process.env.NODE_ENV = 'production';

        const mockReq: any = { requestId: 'req-503-1', path: '/api/health' };
        const mockRes: any = {
          statusCode: 503,
          headers: {},
          getHeader(name: string) { return this.headers[name]; },
          setHeader(name: string, val: string) { this.headers[name] = val; },
          status(code: number) { this.statusCode = code; return this; },
          json(body: any) { this.body = body; return this; }
        };

        const err: any = new Error('Internal connection pool timeout at postgres://...');
        err.name = 'ServiceUnavailableError';

        errorHandler(err, mockReq, mockRes, () => {});

        assert.strictEqual(mockRes.statusCode, 503);
        assert.strictEqual(mockRes.body.code, 'SERVICE_UNAVAILABLE');
        assert.strictEqual(mockRes.body.message, 'Database persistence service is currently unavailable.');
      } finally {
        process.env = { ...origEnv };
      }
    });
  });

  /* =========================================================================
   * E. ENVIRONMENT & SECURITY CONTRACT CONSISTENCY
   * ========================================================================= */
  describe('E. Environment & Security Contract Consistency', () => {
    const origEnv = { ...process.env };

    after(() => {
      process.env = { ...origEnv };
    });

    it('maintains APP_ENV=staging with NODE_ENV=production contract (Vercel staging behavior)', () => {
      try {
        process.env.APP_ENV = 'staging';
        process.env.NODE_ENV = 'production';

        assert.strictEqual(getAppEnvironment(), 'staging');
        assert.strictEqual(isProduction(), true);
        assert.strictEqual(isStaging(), true);
        assert.strictEqual(allowTestShortcuts(), false);
      } finally {
        process.env = { ...origEnv };
      }
    });

    it('observability baseline does not tamper with OTP debug rules', () => {
      try {
        process.env.APP_ENV = 'production';
        process.env.ENABLE_OTP_DEBUG = 'true';
        assert.strictEqual(isOtpDebugEnabled(), false, 'OTP debug must remain disabled in production');
      } finally {
        process.env = { ...origEnv };
      }
    });
  });
});
