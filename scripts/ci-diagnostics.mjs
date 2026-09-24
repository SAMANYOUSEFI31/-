/**
 * Bushido Discipline OS - Authoritative CI Diagnostics & Logging Runner
 *
 * Capabilities:
 * - Real exit-code preservation for all mandatory CI gates
 * - Real-time live console streaming (stdout & stderr unbuffered)
 * - Safe credential & secret redaction for database passwords and JWT secrets
 * - Diagnostic artifact generation: metadata.txt, environment.txt, changed-files.txt,
 *   *.log files, test-failures.log, and test-summary.txt
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();
const diagnosticsDir = path.resolve(rootDir, 'ci-diagnostics');

export function ensureDiagnosticsDir() {
  if (!fs.existsSync(diagnosticsDir)) {
    fs.mkdirSync(diagnosticsDir, { recursive: true });
  }
}

/**
 * Sanitizes connection strings, tokens, and passwords from logs and metadata.
 * @param {string} text
 * @returns {string}
 */
export function redactSecrets(text) {
  if (typeof text !== 'string') return '';

  let sanitized = text;

  // Redact PostgreSQL / database connection credentials: postgresql://user:password@host
  sanitized = sanitized.replace(
    /(postgres(?:ql)?:\/\/[^\s\/?#:]+:)(?:[^\s\/?#@]+|[^@\s\/?#]*@[^@\s\/?#]*)+(@[^\s\/?#:]+)/gi,
    '$1***$2'
  );

  // Fallback for standard postgresql://user:pass@host
  sanitized = sanitized.replace(
    /(postgres(?:ql)?:\/\/[^\s\/?#:]+:)([^@\s\/?#]+)(@)/gi,
    '$1***$3'
  );

  // Redact explicit database passwords in connection strings like password=...
  sanitized = sanitized.replace(
    /(password=)[^\s&]+/gi,
    '$1[REDACTED]'
  );

  // Redact key-value secrets
  sanitized = sanitized.replace(
    /(JWT_SECRET|PASSWORD|PASS|SECRET|TOKEN|API_KEY|MERCHANT_ID)(["']?\s*[:=]\s*["']?)([^"'\s,;]+)/gi,
    '$1$2[REDACTED]'
  );

  // Redact Authorization headers / Bearer tokens
  sanitized = sanitized.replace(
    /(Authorization:\s*Bearer\s+)[A-Za-z0-9._-]+/gi,
    '$1[REDACTED]'
  );

  return sanitized;
}

/**
 * Initializes diagnostic metadata and environment files.
 */
export function initDiagnostics() {
  ensureDiagnosticsDir();

  // 1. metadata.txt
  const metadataLines = [
    `timestamp: ${new Date().toISOString()}`,
    `workflow: ${process.env.GITHUB_WORKFLOW || 'CI & Migration Integrity'}`,
    `run_id: ${process.env.GITHUB_RUN_ID || 'local'}`,
    `run_number: ${process.env.GITHUB_RUN_NUMBER || '1'}`,
    `run_attempt: ${process.env.GITHUB_RUN_ATTEMPT || '1'}`,
    `actor: ${process.env.GITHUB_ACTOR || 'local'}`,
    `event_name: ${process.env.GITHUB_EVENT_NAME || 'manual'}`,
    `ref: ${process.env.GITHUB_REF || 'refs/heads/main'}`,
    `sha: ${process.env.GITHUB_SHA || 'local-sha'}`,
  ];
  fs.writeFileSync(path.join(diagnosticsDir, 'metadata.txt'), metadataLines.join('\n') + '\n', 'utf8');

  // 2. environment.txt
  const envLines = [
    `os_platform: ${os.platform()} ${os.release()} ${os.arch()}`,
    `node_version: ${process.version}`,
    `ci: ${process.env.CI || 'false'}`,
    `github_actions: ${process.env.GITHUB_ACTIONS || 'false'}`,
    `runner_os: ${process.env.RUNNER_OS || os.type()}`,
    `runner_arch: ${process.env.RUNNER_ARCH || os.arch()}`,
    `disposable_db_acknowledged: ${process.env.DISPOSABLE_DB_ACKNOWLEDGED || 'not-set'}`,
  ];
  fs.writeFileSync(path.join(diagnosticsDir, 'environment.txt'), envLines.join('\n') + '\n', 'utf8');

  // 3. changed-files.txt placeholder if not existing
  const changedFilesPath = path.join(diagnosticsDir, 'changed-files.txt');
  if (!fs.existsSync(changedFilesPath)) {
    fs.writeFileSync(changedFilesPath, 'No changed files recorded\n', 'utf8');
  }
}

/**
 * Parses test execution output and extracts counts, TAP summary, and failure excerpts.
 * @param {string} logContent
 * @param {number} exitCode
 * @returns {{ summaryText: string, failuresText: string, diagnosticsText: string }}
 */
export function parseTestLog(logContent, exitCode) {
  const rawContent = typeof logContent === 'string' ? logContent : '';
  const lines = rawContent.split('\n');

  const testMatch = rawContent.match(/#\s+tests\s+(\d+)/);
  const suitesMatch = rawContent.match(/#\s+suites\s+(\d+)/);
  const passMatch = rawContent.match(/#\s+pass\s+(\d+)/);
  const failMatch = rawContent.match(/#\s+fail\s+(\d+)/);
  const cancelledMatch = rawContent.match(/#\s+cancelled\s+(\d+)/);
  const skippedMatch = rawContent.match(/#\s+skipped\s+(\d+)/);
  const durationMatch = rawContent.match(/#\s+duration_ms\s+([\d.]+)/);

  const totalTests = testMatch ? testMatch[1] : null;
  const suites = suitesMatch ? suitesMatch[1] : null;
  const passTests = passMatch ? passMatch[1] : null;
  const failTests = failMatch ? failMatch[1] : null;
  const cancelledTests = cancelledMatch ? cancelledMatch[1] : null;
  const skippedTests = skippedMatch ? skippedMatch[1] : null;
  const durationMs = durationMatch ? durationMatch[1] : null;

  const failCountNum = failTests !== null ? parseInt(failTests, 10) : null;
  const hasTapSummary = testMatch !== null && failMatch !== null;

  // Extract final TAP summary block
  const tapSummaryStart = rawContent.lastIndexOf('# tests ');
  let tapSummary = '';
  if (tapSummaryStart !== -1) {
    tapSummary = rawContent.slice(tapSummaryStart).trim();
  }

  // Extract ONLY actual TAP failure blocks (starting with 'not ok')
  const tapFailures = [];
  let isCapturingTapFailure = false;
  let currentFailureBlock = [];

  for (const line of lines) {
    const isNotOkLine = /^\s*not ok\b/.test(line);
    if (isNotOkLine) {
      if (currentFailureBlock.length > 0) {
        tapFailures.push(currentFailureBlock.join('\n'));
        currentFailureBlock = [];
      }
      isCapturingTapFailure = true;
      currentFailureBlock.push(line);
    } else if (isCapturingTapFailure) {
      // Check if we reached the end of YAML block '...' or another TAP marker
      if (/^\s*(\.\.\.|ok\b|#\s*Subtest:|1\.\.\d+)/.test(line)) {
        if (line.trim() === '...') {
          currentFailureBlock.push(line);
        }
        tapFailures.push(currentFailureBlock.join('\n'));
        currentFailureBlock = [];
        isCapturingTapFailure = false;
      } else {
        currentFailureBlock.push(line);
      }
    }
  }
  if (currentFailureBlock.length > 0) {
    tapFailures.push(currentFailureBlock.join('\n'));
  }

  // Extract non-TAP diagnostic output (console logs, fault-injection traces, error logs from negative tests)
  const diagnosticLines = [];
  for (const line of lines) {
    // Exclude standard TAP structural lines
    const isStandardTap = /^\s*(ok\s+\d+|1\.\.\d+|#\s+Subtest:|#\s+tests|#\s+suites|#\s+pass|#\s+fail|#\s+cancelled|#\s+skipped|#\s+todo|#\s+duration_ms|TAP version)/.test(line);
    if (!isStandardTap && line.trim().length > 0) {
      diagnosticLines.push(line);
    }
  }

  const isSuccess = exitCode === 0 && hasTapSummary && failCountNum === 0;

  const summary = [
    `status: ${isSuccess ? 'PASSED' : 'FAILED'}`,
    `exit_code: ${exitCode}`,
    totalTests !== null ? `total_tests: ${totalTests}` : 'total_tests: NOT_AVAILABLE',
    suites !== null ? `suites: ${suites}` : 'suites: NOT_AVAILABLE',
    passTests !== null ? `passed: ${passTests}` : 'passed: NOT_AVAILABLE',
    failTests !== null ? `failed: ${failTests}` : 'failed: NOT_AVAILABLE',
    cancelledTests !== null ? `cancelled: ${cancelledTests}` : 'cancelled: NOT_AVAILABLE',
    skippedTests !== null ? `skipped: ${skippedTests}` : 'skipped: NOT_AVAILABLE',
    durationMs !== null ? `duration_ms: ${durationMs}` : 'duration_ms: NOT_AVAILABLE',
    '',
    '--- TAP Summary ---',
    tapSummary || 'No TAP summary block found',
  ];

  if (!isSuccess && tapFailures.length > 0) {
    summary.push('', '--- First Relevant Failure Excerpt ---', tapFailures[0]);
  }

  let failuresText = '';
  if (isSuccess) {
    failuresText = 'No failing tests detected.\n';
  } else {
    if (tapFailures.length > 0) {
      failuresText = tapFailures.join('\n\n') + '\n';
    } else {
      // Non-zero exit with no TAP failure blocks (e.g. runner crash or syntax error)
      failuresText = `Test execution failed with exit code ${exitCode}.\n` +
        (diagnosticLines.length > 0 ? '\n--- Output Excerpt ---\n' + diagnosticLines.slice(-30).join('\n') + '\n' : '');
    }
  }

  const diagnosticsHeader = [
    '# Bushido CI - Test Diagnostics Log',
    '# Notice: This file captures diagnostic output, warnings, and expected error-path logs emitted',
    '# during fault-injection and negative-path tests. These entries represent tested error-handling',
    '# scenarios and do not constitute test failures when the authoritative TAP suite passes.',
    '',
  ].join('\n');

  const diagnosticsText = diagnosticsHeader +
    (diagnosticLines.length > 0 ? diagnosticLines.join('\n') + '\n' : 'No diagnostic error-path logs captured.\n');

  return {
    summaryText: summary.join('\n') + '\n',
    failuresText,
    diagnosticsText,
  };
}

/**
 * Finalizes diagnostics by redacting all logs, generating test-summary.txt and test-failures.log.
 */
export function finalizeDiagnostics() {
  ensureDiagnosticsDir();

  // Redact all existing files in ci-diagnostics
  const files = fs.readdirSync(diagnosticsDir);
  for (const file of files) {
    const filePath = path.join(diagnosticsDir, file);
    if (fs.statSync(filePath).isFile()) {
      const content = fs.readFileSync(filePath, 'utf8');
      const sanitized = redactSecrets(content);
      if (sanitized !== content) {
        fs.writeFileSync(filePath, sanitized, 'utf8');
      }
    }
  }

  // Parse test-full.log if present
  const testLogPath = path.join(diagnosticsDir, 'test-full.log');
  if (fs.existsSync(testLogPath)) {
    const testLog = fs.readFileSync(testLogPath, 'utf8');
    let exitCode = 0;
    const testExitCodePath = path.join(diagnosticsDir, '.test-exit-code');
    if (fs.existsSync(testExitCodePath)) {
      exitCode = parseInt(fs.readFileSync(testExitCodePath, 'utf8').trim(), 10) || 0;
    }
    const { summaryText, failuresText, diagnosticsText } = parseTestLog(testLog, exitCode);
    fs.writeFileSync(path.join(diagnosticsDir, 'test-summary.txt'), redactSecrets(summaryText), 'utf8');
    fs.writeFileSync(path.join(diagnosticsDir, 'test-failures.log'), redactSecrets(failuresText), 'utf8');
    fs.writeFileSync(path.join(diagnosticsDir, 'test-diagnostics.log'), redactSecrets(diagnosticsText), 'utf8');
  } else {
    const placeholderSummary = [
      'status: SKIPPED_OR_NOT_REACHED',
      'exit_code: NOT_AVAILABLE',
      'total_tests: NOT_AVAILABLE',
      'passed: NOT_AVAILABLE',
      'failed: NOT_AVAILABLE',
      'notice: Test gate was not executed or test-full.log was not produced.',
    ].join('\n') + '\n';
    fs.writeFileSync(path.join(diagnosticsDir, 'test-summary.txt'), placeholderSummary, 'utf8');
    fs.writeFileSync(path.join(diagnosticsDir, 'test-failures.log'), 'No test log produced.\n', 'utf8');
    fs.writeFileSync(path.join(diagnosticsDir, 'test-diagnostics.log'), 'No test log produced.\n', 'utf8');
  }

  // Remove internal marker files
  const testExitCodePath = path.join(diagnosticsDir, '.test-exit-code');
  if (fs.existsSync(testExitCodePath)) {
    fs.unlinkSync(testExitCodePath);
  }
}

/**
 * Executes a command, streams live output to console, captures log to disk, and exits with exact code.
 * @param {string} logFileName
 * @param {string} commandStr
 */
export function execCommand(logFileName, commandStr) {
  ensureDiagnosticsDir();
  const logFilePath = path.join(diagnosticsDir, logFileName);
  // Ensure empty file is created even if command produces no output
  fs.writeFileSync(logFilePath, '', 'utf8');
  const logStream = fs.createWriteStream(logFilePath, { flags: 'w', encoding: 'utf8' });

  const child = spawn(commandStr, {
    cwd: rootDir,
    shell: true,
    env: process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (data) => {
    process.stdout.write(data);
    logStream.write(data);
  });

  child.stderr.on('data', (data) => {
    process.stderr.write(data);
    logStream.write(data);
  });

  child.on('close', (code) => {
    logStream.end(() => {
      if (logFileName === 'test-full.log') {
        fs.writeFileSync(path.join(diagnosticsDir, '.test-exit-code'), String(code ?? 1), 'utf8');
      }
      process.exit(code ?? 1);
    });
  });
}

// CLI Dispatcher
const command = process.argv[2];

if (command === 'init') {
  initDiagnostics();
  process.exit(0);
} else if (command === 'finalize') {
  finalizeDiagnostics();
  process.exit(0);
} else if (command === 'exec') {
  const logFileName = process.argv[3];
  const cmdToRun = process.argv.slice(4).join(' ');
  if (!logFileName || !cmdToRun) {
    console.error('Usage: node scripts/ci-diagnostics.mjs exec <log-file-name> <command...>');
    process.exit(1);
  }
  execCommand(logFileName, cmdToRun);
} else if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  console.log('Bushido CI Diagnostics Utility');
  console.log('Usage:');
  console.log('  node scripts/ci-diagnostics.mjs init');
  console.log('  node scripts/ci-diagnostics.mjs exec <log-file-name> <command>');
  console.log('  node scripts/ci-diagnostics.mjs finalize');
}
