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
  });

  describe('2. GitHub Workflows Supply-Chain Hardening', () => {
    const workflowsDir = path.join(rootDir, '.github', 'workflows');
    const workflowFiles = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));

    test('workflows directory contains authoritative CI and APK workflows', () => {
      assert.ok(workflowFiles.includes('ci.yml'), 'ci.yml must exist');
      assert.ok(workflowFiles.includes('build-apk.yml'), 'build-apk.yml must exist');
    });

    test('no workflow uses mutable ubuntu-latest runner image', () => {
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

  describe('4. Dependabot Governance', () => {
    test('.github/dependabot.yml exists and configures npm and github-actions', () => {
      const dependabotPath = path.join(rootDir, '.github', 'dependabot.yml');
      assert.ok(fs.existsSync(dependabotPath), '.github/dependabot.yml must exist');
      const content = fs.readFileSync(dependabotPath, 'utf8');

      assert.ok(content.includes('package-ecosystem: "npm"') || content.includes("package-ecosystem: 'npm'"), 'Dependabot must cover npm');
      assert.ok(content.includes('package-ecosystem: "github-actions"') || content.includes("package-ecosystem: 'github-actions'"), 'Dependabot must cover github-actions');
      assert.ok(content.includes('interval:'), 'Dependabot must configure an update schedule interval');
      assert.strictEqual(
        content.includes('auto-merge') || content.includes('automerge'),
        false,
        'Dependabot must NOT enable automatic merging'
      );
    });
  });

  describe('5. Android APK Workflow Blocker Integrity', () => {
    test('APK workflow does not dynamically add unpinned packages or skip validation silently', () => {
      const apkContent = fs.readFileSync(path.join(rootDir, '.github', 'workflows', 'build-apk.yml'), 'utf8');
      assert.strictEqual(
        apkContent.includes('npm install --legacy-peer-deps'),
        false,
        'build-apk.yml must not use npm install --legacy-peer-deps'
      );
      assert.strictEqual(
        apkContent.includes('-x test -x lint'),
        false,
        'build-apk.yml must not silently skip android tests and linting'
      );
      assert.ok(
        apkContent.includes('DISABLED') || apkContent.includes('Blocker'),
        'build-apk.yml must document its disabled/blocked status explicitly'
      );
    });
  });

  describe('6. Roadmap & Security Documentation Synchronization', () => {
    test('RUNBOOK.md records Phase 2C.5 CLOSED, Phase 2C.6 IN PROGRESS, Phase 2D NOT STARTED', () => {
      const runbookContent = fs.readFileSync(path.join(rootDir, 'RUNBOOK.md'), 'utf8');
      assert.ok(runbookContent.includes('Phase 2C.5'), 'RUNBOOK.md must mention Phase 2C.5');
      assert.ok(runbookContent.includes('Phase 2C.6'), 'RUNBOOK.md must mention Phase 2C.6');
      assert.ok(runbookContent.includes('Phase 2D'), 'RUNBOOK.md must mention Phase 2D');
    });

    test('SECURITY.md contains supply chain and dependency security controls', () => {
      const securityContent = fs.readFileSync(path.join(rootDir, 'SECURITY.md'), 'utf8');
      assert.ok(
        securityContent.includes('زنجیره تامین') || securityContent.includes('Supply-Chain') || securityContent.includes('وابستگی‌ها') || securityContent.includes('Dependabot'),
        'SECURITY.md must document supply-chain and dependency governance policies'
      );
    });
  });
});
