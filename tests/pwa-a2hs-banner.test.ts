import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isPwaDismissed,
  markPwaDismissed,
  resetPwaDismissed,
  isPwaInstalled,
  markPwaInstalled,
  hasFirstValueAchieved,
  markFirstValueAchieved,
  resetFirstValue,
  getScopedPwaDismissedKey,
  getScopedPwaInstalledKey,
  getScopedFirstValueKey,
  PWA_DISMISSED_KEY,
  PWA_INSTALLED_KEY,
  FIRST_VALUE_KEY
} from '../src/utils/storageUtils.js';

test('Bushido OS — Phase 3A: PWA A2HS Banner & First-Value Governance', async (t) => {
  const storageMock: Record<string, string> = {};

  const setupMockWindow = () => {
    for (const k in storageMock) delete storageMock[k];
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => { storageMock[key] = String(val); },
        removeItem: (key: string) => { delete storageMock[key]; }
      },
      matchMedia: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      }),
      navigator: {
        standalone: false
      }
    };
  };

  setupMockWindow();

  await t.test('1. Scoped Storage Keys generation for Guest and Authenticated Users', () => {
    // Guest keys
    assert.equal(getScopedPwaDismissedKey(null), 'bushido_pwa_dismissed_guest');
    assert.equal(getScopedPwaDismissedKey(''), 'bushido_pwa_dismissed_guest');
    assert.equal(getScopedPwaInstalledKey(null), 'bushido_pwa_installed_guest');
    assert.equal(getScopedFirstValueKey(null), 'bushido_first_value_guest');

    // Authenticated user keys
    assert.equal(getScopedPwaDismissedKey('samurai-007'), 'bushido_pwa_dismissed_user_samurai-007');
    assert.equal(getScopedPwaInstalledKey('samurai-007'), 'bushido_pwa_installed_user_samurai-007');
    assert.equal(getScopedFirstValueKey('samurai-007'), 'bushido_first_value_user_samurai-007');
  });

  await t.test('2. First-value tracking is partitioned and properly recorded on habit tick', () => {
    setupMockWindow();

    // Initially unachieved for guest and user
    assert.equal(hasFirstValueAchieved(null), false);
    assert.equal(hasFirstValueAchieved('user-a'), false);

    // Mark guest as achieved
    markFirstValueAchieved(null);
    assert.equal(hasFirstValueAchieved(null), true);
    // User A remains unachieved (partition isolation)
    assert.equal(hasFirstValueAchieved('user-a'), false);

    // Mark user A as achieved
    markFirstValueAchieved('user-a');
    assert.equal(hasFirstValueAchieved('user-a'), true);

    // Reset guest
    resetFirstValue(null);
    assert.equal(hasFirstValueAchieved(null), false);
    assert.equal(hasFirstValueAchieved('user-a'), true);
  });

  await t.test('3. Dismissal persistence prevents nag on subsequent loads per owner', () => {
    setupMockWindow();

    // Initially not dismissed
    assert.equal(isPwaDismissed('warrior-1'), false);
    assert.equal(isPwaDismissed('warrior-2'), false);

    // Dismiss for warrior-1
    markPwaDismissed('warrior-1');
    assert.equal(isPwaDismissed('warrior-1'), true);
    assert.equal(isPwaDismissed('warrior-2'), false);

    // Verify localStorage contains scoped key
    assert.equal(storageMock['bushido_pwa_dismissed_user_warrior-1'], 'true');
    assert.equal(storageMock['bushido_pwa_dismissed_user_warrior-2'], undefined);

    // Reset
    resetPwaDismissed('warrior-1');
    assert.equal(isPwaDismissed('warrior-1'), false);
  });

  await t.test('4. Install persistence prevents future prompts once installed', () => {
    setupMockWindow();

    assert.equal(isPwaInstalled('hero-10'), false);
    markPwaInstalled('hero-10');
    assert.equal(isPwaInstalled('hero-10'), true);
    assert.equal(storageMock['bushido_pwa_installed_user_hero-10'], 'true');
  });

  await t.test('5. Source code verification: PwaInstallBanner component governance adherence', () => {
    const componentPath = path.join(process.cwd(), 'src', 'components', 'PwaInstallBanner.tsx');
    const content = fs.readFileSync(componentPath, 'utf8');

    // Rule: Listen for beforeinstallprompt and preventDefault
    assert.ok(
      content.includes("window.addEventListener('beforeinstallprompt'"),
      'Must listen for beforeinstallprompt event'
    );
    assert.ok(
      content.includes('e.preventDefault()'),
      'Must call preventDefault on beforeinstallprompt to suppress default browser infobar'
    );
    assert.ok(
      content.includes('setDeferredPrompt('),
      'Must retain deferredPrompt for user-initiated install action'
    );

    // Rule: Standalone mode suppression
    assert.ok(
      content.includes('(display-mode: standalone)'),
      'Must check display-mode standalone'
    );

    // Rule: Persian stoic copy and btn-contract-primary button
    assert.ok(
      content.includes('نصب / افزودن به صفحه اصلی'),
      'Must include exact Persian label: نصب / افزودن به صفحه اصلی'
    );
    assert.ok(
      content.includes('btn-contract-primary'),
      'Must use btn-contract-primary token for install action'
    );
    assert.ok(
      content.includes('btn-contract-ghost'),
      'Must use btn-contract-ghost token for dismiss action'
    );
    assert.ok(
      content.includes('بعداً'),
      'Must include mild Persian dismiss copy'
    );

    // Rule: Never block habit ticking (floating region, no modal backdrop)
    assert.ok(
      content.includes('fixed bottom-20') || content.includes('fixed bottom-'),
      'Must be a non-blocking floating card at bottom of viewport'
    );
    assert.ok(
      !content.includes('fixed inset-0 bg-black/'),
      'Must NOT render a full-screen blocking backdrop'
    );
  });

  await t.test('6. Source code verification: App.tsx wiring and habit tick first-value trigger', () => {
    const appPath = path.join(process.cwd(), 'src', 'App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    // Verification: PwaInstallBanner is imported and mounted
    assert.ok(
      appContent.includes("import { PwaInstallBanner } from './components/PwaInstallBanner'"),
      'App.tsx must import PwaInstallBanner'
    );
    assert.ok(
      appContent.includes('<PwaInstallBanner'),
      'App.tsx must mount PwaInstallBanner'
    );

    // Verification: first value is detected and marked in handleUpdateLog on habit toggle
    assert.ok(
      appContent.includes('markFirstValueAchieved'),
      'App.tsx must call markFirstValueAchieved'
    );
    assert.ok(
      appContent.includes('hasSessionFirstValue'),
      'App.tsx must pass hasSessionFirstValue to PwaInstallBanner'
    );
  });
});
