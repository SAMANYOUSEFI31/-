/**
 * Bushido Discipline OS - CI Diagnostics Parser & Redaction Regression Tests
 *
 * Validates:
 * 1. A passing TAP suite containing expected Error: and stack traces produces 'No failing tests detected.'
 * 2. Fault-injection/negative test output is classified as diagnostics, not failures
 * 3. Real TAP not ok records are captured in test-failures.log
 * 4. Non-zero child exit code remains classified as FAILED
 * 5. Missing TAP counts are recorded as NOT_AVAILABLE, not zero
 * 6. Passing suite with 0 failures reports PASSED
 * 7. Database credentials and passwords are redacted
 * 8. Bearer tokens and API secrets are redacted
 * 9. Diagnostics runner export contracts and structure
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseTestLog, redactSecrets } from '../scripts/ci-diagnostics.mjs';

describe('CI Diagnostics Parser & Secret Redaction Contract', () => {
  it('1. passing TAP suite with expected Error: and stack-trace logs produces No failing tests detected', () => {
    const sampleLog = `
TAP version 13
# Subtest: tests/storage-and-seed.test.ts
[Storage Error] QuotaExceededError: simulated localStorage write failure
    at mockSetItem (src/sync/storageCore.ts:42:15)
Error: Expected quarantine handling on invalid payload
    at assertThrows (tests/storage-and-seed.test.ts:98:12)
ok 1 - tests/storage-and-seed.test.ts
  ---
  duration_ms: 120.45
  ...
1..1
# tests 15
# suites 3
# pass 15
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 450.12
`;
    const { summaryText, failuresText, diagnosticsText } = parseTestLog(sampleLog, 0);

    assert.ok(summaryText.includes('status: PASSED'), 'Status must be PASSED');
    assert.strictEqual(failuresText, 'No failing tests detected.\n', 'Failures log must contain exactly No failing tests detected.');
    assert.ok(diagnosticsText.includes('QuotaExceededError'), 'Diagnostics log must preserve fault-injection output');
  });

  it('2. expected fault-injection and negative-path console output is not classified as a test failure', () => {
    const sampleLog = `
TAP version 13
# Subtest: tests/debt-autopsy-contract.test.ts
[Database] Simulation failure: connection refused to 127.0.0.1:5432
TypeError [ERR_INVALID_ARG_TYPE]: The "path" argument must be of type string
AssertionError [ERR_ASSERTION]: Expected error captured in try/catch block
ok 1 - tests/debt-autopsy-contract.test.ts
  ---
  duration_ms: 85.2
  ...
1..1
# tests 42
# suites 8
# pass 42
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 850.5
`;
    const { summaryText, failuresText } = parseTestLog(sampleLog, 0);

    assert.ok(summaryText.includes('status: PASSED'));
    assert.strictEqual(failuresText, 'No failing tests detected.\n');
  });

  it('3. real TAP not ok test is captured in test-failures.log and summary excerpt', () => {
    const sampleLog = `
TAP version 13
# Subtest: tests/failing-suite.test.ts
    not ok 1 - should validate strict cycle invariant
      ---
      duration_ms: 12.5
      error: 'AssertionError: expected true to equal false'
      stack: |-
        at TestContext.<anonymous> (tests/failing-suite.test.ts:45:10)
      ...
    1..1
not ok 1 - tests/failing-suite.test.ts
  ---
  duration_ms: 50.2
  ...
1..1
# tests 10
# suites 2
# pass 9
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 320.1
`;
    const { summaryText, failuresText } = parseTestLog(sampleLog, 1);

    assert.ok(summaryText.includes('status: FAILED'), 'Summary must report FAILED');
    assert.ok(summaryText.includes('failed: 1'), 'Summary must report failed: 1');
    assert.ok(failuresText.includes('not ok 1 - should validate strict cycle invariant'), 'Failure record must be present');
    assert.ok(failuresText.includes('expected true to equal false'), 'Error description must be present');
  });

  it('4. non-zero child exit code remains failed even if no TAP not ok line was emitted', () => {
    const crashLog = `
node:internal/modules/esm/resolve:257
  throw new ERR_MODULE_NOT_FOUND(packageName, fileURLToPath(base));
  ^
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'missing-dep'
`;
    const { summaryText, failuresText } = parseTestLog(crashLog, 1);

    assert.ok(summaryText.includes('status: FAILED'), 'Must report FAILED on non-zero exit code');
    assert.ok(summaryText.includes('exit_code: 1'), 'Must preserve exit_code: 1');
    assert.ok(failuresText.includes('Test execution failed with exit code 1'), 'Must record failure reason');
  });

  it('5. missing TAP counts are recorded as NOT_AVAILABLE, not zero', () => {
    const incompleteLog = `
Running tests...
Process terminated unexpectedly.
`;
    const { summaryText } = parseTestLog(incompleteLog, 1);

    assert.ok(summaryText.includes('total_tests: NOT_AVAILABLE'), 'Missing total_tests must be NOT_AVAILABLE');
    assert.ok(summaryText.includes('passed: NOT_AVAILABLE'), 'Missing passed count must be NOT_AVAILABLE');
    assert.ok(summaryText.includes('failed: NOT_AVAILABLE'), 'Missing failed count must be NOT_AVAILABLE');
    assert.ok(!summaryText.includes('total_tests: 0'), 'Must not report missing total as 0');
    assert.ok(!summaryText.includes('failed: 0'), 'Must not report missing failed as 0');
  });

  it('6. a passing suite with zero TAP failures is reported accurately with full counts', () => {
    const passLog = `
1..55
# tests 958
# suites 236
# pass 958
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 34795.832036
`;
    const { summaryText, failuresText } = parseTestLog(passLog, 0);

    assert.ok(summaryText.includes('status: PASSED'));
    assert.ok(summaryText.includes('exit_code: 0'));
    assert.ok(summaryText.includes('total_tests: 958'));
    assert.ok(summaryText.includes('suites: 236'));
    assert.ok(summaryText.includes('passed: 958'));
    assert.ok(summaryText.includes('failed: 0'));
    assert.ok(summaryText.includes('skipped: 0'));
    assert.strictEqual(failuresText, 'No failing tests detected.\n');
  });

  it('7. database credentials and connection passwords are sanitized', () => {
    const rawPgUri = 'postgresql://postgres:p@ssw0rd123@db.example.com:5432/bushido_prod?sslmode=require';
    const sanitized = redactSecrets(rawPgUri);

    assert.ok(!sanitized.includes('p@ssw0rd123'), 'Raw password must not be present');
    assert.ok(sanitized.includes('postgresql://postgres:***@db.example.com'), 'Must be masked with ***');

    const explicitPass = 'DATABASE_URL="postgres://user:secret@localhost:5432/db" password=supersecretpass';
    const sanitizedExplicit = redactSecrets(explicitPass);
    assert.ok(!sanitizedExplicit.includes('secret'));
    assert.ok(!sanitizedExplicit.includes('supersecretpass'));
  });

  it('8. bearer tokens and common secrets are sanitized', () => {
    const logWithSecrets = `
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.token12345
JWT_SECRET=super_secret_jwt_key_9999
API_KEY: "prod_live_api_token_abc123"
MERCHANT_ID = 'zibal_merchant_456'
`;
    const sanitized = redactSecrets(logWithSecrets);

    assert.ok(!sanitized.includes('token12345'), 'Bearer token must be redacted');
    assert.ok(!sanitized.includes('super_secret_jwt_key_9999'), 'JWT_SECRET value must be redacted');
    assert.ok(!sanitized.includes('prod_live_api_token_abc123'), 'API_KEY value must be redacted');
    assert.ok(!sanitized.includes('zibal_merchant_456'), 'MERCHANT_ID value must be redacted');
    assert.ok(sanitized.includes('[REDACTED]'), 'Must replace with [REDACTED]');
  });

  it('9. diagnostics parser preserves non-string input safely', () => {
    const emptyResult = parseTestLog(null, 1);
    assert.ok(emptyResult.summaryText.includes('status: FAILED'));
    assert.ok(emptyResult.summaryText.includes('total_tests: NOT_AVAILABLE'));
  });
});
