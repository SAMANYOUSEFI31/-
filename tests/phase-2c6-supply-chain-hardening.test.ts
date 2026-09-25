/**
 * tests/phase-2c6-supply-chain-hardening.test.ts
 *
 * Phase 2C.6: Supply-Chain & Dependency Hardening Contract Tests
 *
 * Validates deterministic installation, immutable GitHub Action pins, least-privilege
 * permissions, Dependabot coverage, vulnerability gates, engines contract, and roadmap status.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const workflowsDir = path.join(rootDir, '.github', 'workflows');

describe('Phase 2C.6: Supply-Chain & Dependency Hardening Suite', () => {
  describe('1. Authoritative Lockfile & Engines Contract', () => {
    test('package-lock.json exists and maintains lockfile version', () => {
      const lockfilePath = path.join(rootDir, 'package-lock.json');
      assert.ok(fs.existsSync(lockfilePath), 'package-lock.json must exist in root');
      const lockfileRaw = fs.readFileSync(lockfilePath, 'utf8');
      const lockfile = JSON.parse(lockfileRaw);
      assert.ok(lockfile.lockfileVersion >= 2, 'Lockfile version must be >= 2');
      assert.strictEqual(lockfile.name, 'bushido-discipline-os');
    });

    test('package.json declares explicit engines contract for Node.js', () => {
      const pkgPath = path.join(rootDir, 'package.json');
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      assert.ok(pkg.engines, 'package.json must contain engines contract');
      assert.ok(pkg.engines.node, 'engines.node must be declared');
      assert.ok(
        pkg.engines.node.includes('20') || pkg.engines.node.includes('>=20'),
        'engines.node must specify Node.js 20 compatibility'
      );
    });

    test('bun.lock and alternative lockfiles remain removed', () => {
      assert.strictEqual(fs.existsSync(path.join(rootDir, 'bun.lock')), false, 'bun.lock must remain removed');
      assert.strictEqual(fs.existsSync(path.join(rootDir, 'yarn.lock')), false, 'yarn.lock must remain removed');
      assert.strictEqual(fs.existsSync(path.join(rootDir, 'pnpm-lock.yaml')), false, 'pnpm-lock.yaml must remain removed');
    });
  });

  describe('2. GitHub Workflows Supply-Chain Hardening', () => {
    const getWorkflowFiles = () => fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

    test('workflows directory contains authoritative CI workflow and build-apk.yml is absent', () => {
      const workflowFiles = getWorkflowFiles();
      assert.ok(workflowFiles.includes('ci.yml'), 'ci.yml must exist');
      assert.strictEqual(workflowFiles.includes('build-apk.yml'), false, 'build-apk.yml must be absent while Android architecture is deferred');
      assert.deepStrictEqual(workflowFiles, ['ci.yml'], 'ci.yml must remain the only authoritative workflow');
    });

    test('no workflow uses mutable ubuntu-latest runner image', () => {
      const workflowFiles = getWorkflowFiles();
      for (const file of workflowFiles) {
        const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
        assert.strictEqual(
          content.includes('runs-on: ubuntu-latest'),
          false,
          `${file} must NOT use mutable ubuntu-latest runner; must use explicit pinned Ubuntu version`
        );
      }
    });

    test('authoritative CI workflow uses npm ci and does not use npm install', () => {
      const ciContent = fs.readFileSync(path.join(workflowsDir, 'ci.yml'), 'utf8');
      assert.ok(ciContent.includes('npm ci'), 'ci.yml must use npm ci for installation');
      assert.strictEqual(
        /\bnpm install\b/.test(ciContent),
        false,
        'ci.yml must NOT use npm install for installation'
      );
    });

    test('all external GitHub Actions are pinned to full 40-character commit SHAs with version comments', () => {
      const shaRegex = /uses:\s*([a-zA-Z0-9_\-\.\/]+)@([a-f0-9]{40})\s*(?:#\s*(v[0-9\.]+.*))?/;
      const unpinnedRegex = /uses:\s*([a-zA-Z0-9_\-\.\/]+)@(?!([a-f0-9]{40}))([^\s]+)/g;
      const workflowFiles = getWorkflowFiles();

      for (const file of workflowFiles) {
        const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
        const lines = content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (/^\s*uses:\s*[^.\/]/.test(line)) { // External action (not local ./)
            const unpinnedMatch = unpinnedRegex.exec(line);
            if (unpinnedMatch) {
              assert.fail(
                `Unpinned action found in ${file} at line ${i + 1}: "${line.trim()}". Must use full 40-character commit SHA with version comment.`
              );
            }
            const pinnedMatch = line.match(shaRegex);
            assert.ok(
              pinnedMatch,
              `Action reference in ${file} at line ${i + 1} must match 40-char SHA pattern: "${line.trim()}"`
            );
            assert.strictEqual(
              pinnedMatch[2].length,
              40,
              `Commit SHA must be exactly 40 hexadecimal characters in ${file}: "${line.trim()}"`
            );
            assert.ok(
              line.includes('#'),
              `Action reference in ${file} at line ${i + 1} must include a human-readable version comment (e.g. # v4.2.2)`
            );
          }
        }
      }
    });

    test('all workflows declare explicit least-privilege permissions', () => {
      const workflowFiles = getWorkflowFiles();
      for (const file of workflowFiles) {
        const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
        assert.ok(
          content.includes('permissions:'),
          `${file} must declare explicit least-privilege permissions`
        );
        assert.ok(
          content.includes('contents: read'),
          `${file} permissions must restrict contents to read`
        );
      }
    });

    test('no workflow uses npm audit fix --force', () => {
      const workflowFiles = getWorkflowFiles();
      for (const file of workflowFiles) {
        const content = fs.readFileSync(path.join(workflowsDir, file), 'utf8');
        assert.strictEqual(
          content.includes('npm audit fix'),
          false,
          `${file} must not use npm audit fix`
        );
        assert.strictEqual(
          content.includes('--force'),
          false,
          `${file} must not use --force flag`
        );
      }
    });
  });

  describe('3. Vulnerability and Review Governance Gates', () => {
    test('CI workflow includes high-severity dependency vulnerability audit gate', () => {
      const ciContent = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8');
      assert.ok(
        ciContent.includes('npm audit --audit-level=high') || ciContent.includes('npm audit'),
        'ci.yml must include an authoritative npm audit gate'
      );
      assert.ok(
        ciContent.includes('--audit-level=high'),
        'ci.yml must enforce --audit-level=high gate'
      );
    });

    test('CI workflow includes pull-request dependency review gate', () => {
      const ciContent = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'ci.yml'), 'utf8');
      assert.ok(
        ciContent.includes('actions/dependency-review-action'),
        'ci.yml must include dependency-review-action'
      );
      assert.ok(
        ciContent.includes('fail-on-severity: high'),
        'dependency-review-action must enforce fail-on-severity: high'
      );
    });
  });

  describe('4. Dependabot Governance & Noise Reduction', () => {
    test('.github/dependabot.yml exists and configures npm and github-actions', () => {
      const dependabotPath = path.join(rootDir, '.github', 'dependabot.yml');
      assert.ok(fs.existsSync(dependabotPath), '.github/dependabot.yml must exist');
      const content = fs.readFileSync(dependabotPath, 'utf8');

      assert.ok(content.includes('package-ecosystem: "npm"') || content.includes("package-ecosystem: 'npm'"), 'Dependabot must cover npm');
      assert.ok(content.includes('package-ecosystem: "github-actions"') || content.includes("package-ecosystem: 'github-actions'"), 'Dependabot must cover github-actions');
      assert.ok(content.includes('interval: "weekly"') || content.includes("interval: 'weekly'") || content.includes('interval: weekly'), 'Dependabot must configure weekly interval');
      assert.strictEqual(
        content.includes('auto-merge') || content.includes('automerge'),
        false,
        'Dependabot must NOT enable automatic merging'
      );
    });

    test('Dependabot enforces strict PR limits (3 for npm, 2 for github-actions)', () => {
      const dependabotPath = path.join(rootDir, '.github', 'dependabot.yml');
      const content = fs.readFileSync(dependabotPath, 'utf8');

      assert.ok(content.includes('open-pull-requests-limit: 3'), 'Dependabot npm open-pull-requests-limit must be 3');
      assert.ok(content.includes('open-pull-requests-limit: 2'), 'Dependabot github-actions open-pull-requests-limit must be 2');
    });

    test('Dependabot ignores npm semver-major updates to prevent major version noise', () => {
      const dependabotPath = path.join(rootDir, '.github', 'dependabot.yml');
      const content = fs.readFileSync(dependabotPath, 'utf8');

      assert.ok(content.includes('version-update:semver-major'), 'Dependabot must ignore semver-major updates');
      assert.ok(content.includes('groups:'), 'Dependabot must configure update grouping for minor/patch');
    });
  });

  describe('5. Android APK Automation Governance & Deferred Architecture', () => {
    test('build-apk.yml is absent while Android architecture is deferred', () => {
      const apkPath = path.join(rootDir, '.github', 'workflows', 'build-apk.yml');
      assert.strictEqual(fs.existsSync(apkPath), false, 'build-apk.yml must be absent while Android architecture is deferred');
    });

    test('ci.yml remains the only authoritative workflow in .github/workflows', () => {
      const workflows = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      assert.deepStrictEqual(workflows, ['ci.yml'], 'ci.yml must remain the only authoritative workflow');
    });

    test('no normal push or pull-request Android workflow exists', () => {
      const workflows = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
      for (const wf of workflows) {
        const content = fs.readFileSync(path.join(workflowsDir, wf), 'utf8');
        assert.strictEqual(
          content.toLowerCase().includes('build apk') || content.toLowerCase().includes('android build'),
          false,
          `Workflow ${wf} must not contain push/PR Android build pipelines while android/ is absent`
        );
      }
    });
  });

  describe('6. Roadmap & Documentation Invariants', () => {
    test('RUNBOOK.md records exact roadmap statuses across all phases', () => {
      const runbookContent = fs.readFileSync(path.join(rootDir, 'RUNBOOK.md'), 'utf8');

      assert.ok(
        runbookContent.includes('CLOSED FOR CURRENT SCOPE'),
        'RUNBOOK.md must mark Phase 2C.4 as CLOSED FOR CURRENT SCOPE'
      );
      assert.ok(
        runbookContent.includes('OPEN DECISION'),
        'RUNBOOK.md must mark financial retention policy as OPEN DECISION'
      );
      assert.ok(
        runbookContent.includes('DEFERRED'),
        'RUNBOOK.md must mark account deletion implementation as DEFERRED'
      );
      assert.ok(
        /Phase 2C\.3.+?\|\s*\*\*CLOSED\*\*/.test(runbookContent),
        'RUNBOOK.md table must mark Phase 2C.3 as CLOSED'
      );
      assert.ok(
        /Phase 2C\.4.+?\|\s*\*\*CLOSED FOR CURRENT SCOPE\*\*/.test(runbookContent),
        'RUNBOOK.md table must mark Phase 2C.4 as CLOSED FOR CURRENT SCOPE'
      );
      assert.ok(
        /Phase 2C\.5.+?\|\s*\*\*CLOSED\*\*/.test(runbookContent),
        'RUNBOOK.md table must mark Phase 2C.5 as CLOSED'
      );
      assert.ok(
        /Phase 2C\.6.+?\|\s*\*\*IN PROGRESS\*\*/.test(runbookContent),
        'RUNBOOK.md table must mark Phase 2C.6 as IN PROGRESS'
      );
      assert.ok(
        /Phase 2D.+?\|\s*\*\*NOT STARTED\*\*/.test(runbookContent),
        'RUNBOOK.md table must mark Phase 2D as NOT STARTED'
      );
    });

    test('SECURITY.md contains supply chain and dependency security controls', () => {
      const securityContent = fs.readFileSync(path.join(rootDir, 'SECURITY.md'), 'utf8');
      assert.ok(
        securityContent.includes('زنجیره تامین') || securityContent.includes('Supply-Chain') || securityContent.includes('وابستگی‌ها') || securityContent.includes('Dependabot'),
        'SECURITY.md must document supply-chain and dependency governance policies'
      );
    });

    test('tests/backup-restore-proof.test.ts preserves fail-closed git assertions', () => {
      const backupTestContent = fs.readFileSync(path.join(rootDir, 'tests', 'backup-restore-proof.test.ts'), 'utf8');
      assert.ok(
        backupTestContent.includes('assert.equal(checkRes.status, 0'),
        'backup-restore-proof.test.ts must assert checkRes.status === 0 unconditionally'
      );
      assert.ok(
        backupTestContent.includes('assert.equal(lsRes.status, 0'),
        'backup-restore-proof.test.ts must assert lsRes.status === 0 unconditionally'
      );
    });
  });
});
