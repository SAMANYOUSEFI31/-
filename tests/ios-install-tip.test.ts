import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isIosTipDismissed,
  markIosTipDismissed,
  resetIosTipDismissed,
  getScopedIosTipDismissedKey,
  IOS_TIP_DISMISSED_KEY,
  isIOSDevice,
  isPwaStandalone,
  hasFirstValueAchieved,
  markFirstValueAchieved
} from '../src/utils/storageUtils.js';

test('Bushido OS — Phase 3B: Honest iOS Add-to-Home-Screen Tip & Guide Backup', async (t) => {
  const storageMock: Record<string, string> = {};

  const setupMockWindow = (opts?: {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    displayModeStandalone?: boolean;
  }) => {
    for (const k in storageMock) delete storageMock[k];
    const userAgent = opts?.userAgent ?? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
    const platform = opts?.platform ?? 'iPhone';
    const maxTouchPoints = opts?.maxTouchPoints ?? 5;
    const isStandalone = opts?.standalone ?? false;
    const isDisplayModeStandalone = opts?.displayModeStandalone ?? false;

    const mockNavigator = {
      userAgent,
      platform,
      maxTouchPoints,
      standalone: isStandalone
    };

    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => { storageMock[key] = String(val); },
        removeItem: (key: string) => { delete storageMock[key]; }
      },
      matchMedia: (query: string) => ({
        matches: query.includes('display-mode: standalone') ? isDisplayModeStandalone : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false
      }),
      navigator: mockNavigator
    };

    try {
      Object.defineProperty(globalThis, 'navigator', {
        value: mockNavigator,
        configurable: true,
        writable: true
      });
    } catch {
      // Fallback for environments where navigator cannot be redefined
    }
  };

  await t.test('1. Scoped Storage Key for iOS tip dismissal partitions guest and users', () => {
    assert.equal(getScopedIosTipDismissedKey(null), 'bushido_ios_tip_dismissed_guest');
    assert.equal(getScopedIosTipDismissedKey(''), 'bushido_ios_tip_dismissed_guest');
    assert.equal(getScopedIosTipDismissedKey('samurai-42'), 'bushido_ios_tip_dismissed_user_samurai-42');
  });

  await t.test('2. Dismissal persistence and reset logic', () => {
    setupMockWindow();

    assert.equal(isIosTipDismissed('user-ios-1'), false);
    assert.equal(isIosTipDismissed(null), false);

    // Mark dismissed for user-ios-1
    markIosTipDismissed('user-ios-1');
    assert.equal(isIosTipDismissed('user-ios-1'), true);
    assert.equal(isIosTipDismissed(null), false);
    assert.equal(storageMock['bushido_ios_tip_dismissed_user_user-ios-1'], 'true');

    // Reset user-ios-1
    resetIosTipDismissed('user-ios-1');
    assert.equal(isIosTipDismissed('user-ios-1'), false);

    // Mark guest
    markIosTipDismissed(null);
    assert.equal(isIosTipDismissed(null), true);
    assert.equal(storageMock[IOS_TIP_DISMISSED_KEY], 'true');
    assert.equal(storageMock['bushido_ios_tip_dismissed_guest'], 'true');
  });

  await t.test('3. iOS and iPadOS device detection accuracy', () => {
    // iPhone
    setupMockWindow({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    assert.equal(isIOSDevice(), true);

    // iPad
    setupMockWindow({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X)' });
    assert.equal(isIOSDevice(), true);

    // iPadOS with desktop Safari UA (MacIntel + touch points)
    setupMockWindow({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5
    });
    assert.equal(isIOSDevice(), true);

    // Desktop Mac (MacIntel without touch points)
    setupMockWindow({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 0
    });
    assert.equal(isIOSDevice(), false);

    // Android
    setupMockWindow({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      platform: 'Linux armv8l',
      maxTouchPoints: 5
    });
    assert.equal(isIOSDevice(), false);
  });

  await t.test('4. Standalone detection correctly prevents tip if already installed', () => {
    // Not standalone
    setupMockWindow({ standalone: false, displayModeStandalone: false });
    assert.equal(isPwaStandalone(), false);

    // iOS navigator.standalone true
    setupMockWindow({ standalone: true, displayModeStandalone: false });
    assert.equal(isPwaStandalone(), true);

    // CSS display-mode: standalone
    setupMockWindow({ standalone: false, displayModeStandalone: true });
    assert.equal(isPwaStandalone(), true);
  });

  await t.test('5. Source code inspection: IosInstallTip honesty, steps and no fake install', () => {
    const componentPath = path.join(process.cwd(), 'src', 'shared', 'components', 'pwa', 'IosInstallTip.tsx');
    const content = fs.readFileSync(componentPath, 'utf8');

    // Rule: Must contain honest Persian steps
    assert.ok(content.includes('Safari'), 'Must mention Safari');
    assert.ok(content.includes('اشتراک‌گذاری') || content.includes('Share'), 'Must mention Share action');
    assert.ok(content.includes('افزودن به صفحه اصلی') || content.includes('Add to Home Screen'), 'Must mention Add to Home Screen');

    // Rule: Action button must be «متوجه شدم» (no fake install prompt call)
    assert.ok(content.includes('متوجه شدم'), 'Must contain «متوجه شدم» button');
    assert.ok(!content.includes('prompt()'), 'Must NOT call prompt() or simulate fake install prompt');
    assert.ok(!content.includes('deferredPrompt'), 'Must NOT use deferredPrompt in iOS honest tip');

    // Rule: Non-blocking positioning
    assert.ok(
      content.includes('fixed bottom-20') || content.includes('fixed bottom-'),
      'Must be non-blocking floating card'
    );
    assert.ok(!content.includes('fixed inset-0 bg-black/'), 'Must NOT be a blocking modal');
  });

  await t.test('6. Source code inspection: App.tsx mounts IosInstallTip alongside PwaInstallBanner', () => {
    const appPath = path.join(process.cwd(), 'src', 'App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf8');

    assert.ok(appContent.includes("import { IosInstallTip } from './shared/components/pwa/IosInstallTip'"), 'App.tsx must import IosInstallTip');
    assert.ok(appContent.includes('<IosInstallTip'), 'App.tsx must render IosInstallTip');
    assert.ok(appContent.includes('hasSessionFirstValue'), 'Must wire first-value gate');
  });

  await t.test('7. Source code inspection: One-line backup under More / Guide in ProfileSettingsView', () => {
    const profileViewPath = path.join(process.cwd(), 'src', 'components', 'ProfileSettingsView.tsx');
    const viewContent = fs.readFileSync(profileViewPath, 'utf8');

    assert.ok(
      viewContent.includes('guide-ios-install-backup-card'),
      'Must contain backup card id guide-ios-install-backup-card'
    );
    assert.ok(
      viewContent.includes('افزودن به صفحه اصلی در آیفون') || viewContent.includes('افزودن بوشیدو به صفحه اصلی در آیفون'),
      'Must contain clear iOS backup title in Guide'
    );
    assert.ok(
      viewContent.includes('Safari'),
      'Must mention Safari in backup note'
    );
  });
});
