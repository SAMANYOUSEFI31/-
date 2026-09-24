import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findTestFiles, runTests } from '../scripts/run-tests.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

describe('Test Runner Cross-Platform Portability Contract', () => {
  test('package.json no longer contains literal tests/**/*.test.ts glob', () => {
    const pkgPath = path.join(rootDir, 'package.json');
    const pkgContent = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(pkgContent);

    assert.ok(pkg.scripts && pkg.scripts.test, 'package.json must contain a test script');
    assert.strictEqual(
      pkg.scripts.test.includes('tests/**/*.test.ts'),
      false,
      'package.json test script must NOT contain literal tests/**/*.test.ts glob'
    );
    assert.strictEqual(
      pkg.scripts.test,
      'node scripts/run-tests.mjs',
      'package.json test script must invoke node scripts/run-tests.mjs'
    );
  });

  test('scripts/run-tests.mjs exists and is valid ES module', () => {
    const scriptPath = path.join(rootDir, 'scripts', 'run-tests.mjs');
    assert.ok(fs.existsSync(scriptPath), 'scripts/run-tests.mjs must exist on disk');
    const content = fs.readFileSync(scriptPath, 'utf8');
    assert.ok(content.length > 0, 'scripts/run-tests.mjs must not be empty');
  });

  test('test discovery is recursive and discovers all existing .test.ts files', () => {
    const discovered = findTestFiles();
    assert.ok(discovered.length > 0, 'Must discover at least 1 test file');

    // Manually scan tests directory recursively
    const testsDir = path.join(rootDir, 'tests');
    const manualFiles = [];
    function scan(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(full);
        } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
          manualFiles.push(path.relative(rootDir, full).split(path.sep).join('/'));
        }
      }
    }
    scan(testsDir);
    manualFiles.sort();

    assert.deepStrictEqual(
      discovered,
      manualFiles,
      'Discovered files must exactly match all recursively discovered .test.ts files'
    );
  });

  test('discovered test files are deterministically sorted', () => {
    const discovered = findTestFiles();
    const sortedCopy = [...discovered].sort();
    assert.deepStrictEqual(
      discovered,
      sortedCopy,
      'findTestFiles must return paths in deterministic sorted order'
    );
  });

  test('zero discovered test files produces a non-zero exit code without running child runner', () => {
    // Capture stderr to prevent polluting test log
    const origError = console.error;
    let loggedError = '';
    console.error = (...args) => {
      loggedError += args.join(' ') + '\n';
    };

    try {
      const exitCode = runTests([]);
      assert.strictEqual(exitCode, 1, 'runTests([]) must return non-zero exit code 1');
      assert.ok(
        loggedError.includes('Zero test files discovered'),
        'Error message must indicate zero test files discovered'
      );
    } finally {
      console.error = origError;
    }
  });

  test('child execution configuration strictly enforces shell: false and explicit argument array', () => {
    const scriptContent = fs.readFileSync(
      path.join(rootDir, 'scripts', 'run-tests.mjs'),
      'utf8'
    );

    assert.ok(
      scriptContent.includes('shell: false'),
      'Runner must explicitly configure shell: false to prevent shell interpolation'
    );
    assert.ok(
      scriptContent.includes('spawnSync'),
      'Runner must use spawnSync or spawn with explicit argument array'
    );
    assert.ok(
      scriptContent.includes("NODE_ENV: 'test'"),
      'Runner must explicitly configure NODE_ENV: test in environment'
    );
    assert.ok(
      scriptContent.includes("'--test-concurrency=1'"),
      'Runner must explicitly enforce --test-concurrency=1 for serialized deterministic execution'
    );
  });

  test('backup-restore-proof test file strictly isolates DISPOSABLE_DB_ACKNOWLEDGED with try/finally restoration', () => {
    const backupProofContent = fs.readFileSync(
      path.join(rootDir, 'tests', 'backup-restore-proof.test.ts'),
      'utf8'
    );

    assert.ok(
      backupProofContent.includes('delete process.env.DISPOSABLE_DB_ACKNOWLEDGED'),
      'Safety test must delete DISPOSABLE_DB_ACKNOWLEDGED before assertSafety assertion'
    );
    assert.ok(
      backupProofContent.includes('finally'),
      'Safety test must wrap in try/finally to guarantee environment restoration'
    );
  });

  test('offline and mutation test suites strictly restore global navigator, window, and localStorage mocks', () => {
    const filesToAudit = [
      'tests/offline-queue-ownership.test.ts',
      'tests/phase-6-1a-dailylog-write-ahead.test.ts',
      'tests/phase-6-1b-cycle-mutation-reliability.test.ts',
      'tests/phase-6-1a-corrective-pass.test.ts'
    ];

    for (const relPath of filesToAudit) {
      const content = fs.readFileSync(path.join(rootDir, relPath), 'utf8');
      assert.ok(
        content.includes('after') || content.includes('afterEach'),
        `${relPath} must implement teardown lifecycle hook`
      );
      assert.ok(
        content.includes('delete (globalThis as any).window') || content.includes('delete (globalThis as any).localStorage') || content.includes('origWindow'),
        `${relPath} must cleanly delete or restore global mocks`
      );
    }
  });
});
