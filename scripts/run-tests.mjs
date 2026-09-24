import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

/**
 * Recursively discovers all test files ending with .test.ts in the specified directory.
 * @param {string} dir
 * @returns {string[]} Sorted relative file paths
 */
export function findTestFiles(dir = path.join(rootDir, 'tests')) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const results = [];

  function scan(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
        // Normalize path with forward slashes for cross-platform consistency
        const relativePath = path.relative(rootDir, fullPath).split(path.sep).join('/');
        results.push(relativePath);
      }
    }
  }

  scan(dir);
  results.sort();
  return results;
}

/**
 * Executes test runner with explicit test files list.
 * @param {string[]} testFiles
 * @returns {number} exit code
 */
export function runTests(testFiles = findTestFiles()) {
  if (!testFiles || testFiles.length === 0) {
    console.error('Error: Zero test files discovered ending with .test.ts');
    return 1;
  }

  console.log(`Discovered ${testFiles.length} test files for execution.`);

  // Node 20 native test runner with tsx loader
  const childArgs = ['--import', 'tsx', '--test', '--test-concurrency=1', ...testFiles];

  const result = spawnSync(process.execPath, childArgs, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      NODE_ENV: 'test',
    },
  });

  if (result.error) {
    console.error('Failed to start test runner child process:', result.error);
    return 1;
  }

  if (result.signal) {
    console.error(`Test runner process killed with signal: ${result.signal}`);
    return 1;
  }

  return result.status ?? 1;
}

// If executed directly from command line
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const exitCode = runTests();
  process.exit(exitCode);
}
