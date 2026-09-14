import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  isPwaDismissed,
  markPwaDismissed,
  isPwaInstalled,
  markPwaInstalled,
  isIosTipDismissed,
  markIosTipDismissed,
  hasFirstValueAchieved,
  markFirstValueAchieved,
  isIOSDevice,
  isPwaStandalone,
  getScopedPwaDismissedKey,
  getScopedPwaInstalledKey,
  getScopedIosTipDismissedKey,
  getScopedFirstValueKey
} from '../src/utils/storageUtils.js';

test('Bushido OS — Phase 3C: PWA Install UX Closure & Mutual Exclusion Invariants', async (t) => {
  const storageMock: Record<string, string> = {};

  const setupMockEnv = (opts?: {
    userAgent?: string;
    platform?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    displayModeStandalone?: boolean;
  }) => {
    for (const k in storageMock) delete storageMock[k];
    const userAgent = opts?.userAgent ?? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36';
    const platform = opts?.platform ?? 'Linux armv8l';
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
      // Ignore if navigator is non-redefinable
    }
  };

  await t.test('1. Mutual Exclusion Guarantee: Android/Chrome banner and iOS tip NEVER overlap on any device', () => {
    // Android device
    setupMockEnv({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      platform: 'Linux armv8l'
    });
    assert.equal(isIOSDevice(), false, 'Android device must return isIOSDevice = false');
    // IosInstallTip condition requires isIOSDevice() === true
    assert.equal(isIOSDevice() && !isPwaStandalone(), false, 'IosInstallTip must NEVER qualify on Android');

    // iOS iPhone device
    setupMockEnv({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      platform: 'iPhone'
    });
    assert.equal(isIOSDevice(), true, 'iPhone device must return isIOSDevice = true');
    // PwaInstallBanner condition requires !isIOSDevice()
    assert.equal(!isIOSDevice(), false, 'PwaInstallBanner must NEVER qualify on iOS');

    // iOS iPadOS device
    setupMockEnv({
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      platform: 'MacIntel',
      maxTouchPoints: 5
    });
    assert.equal(isIOSDevice(), true, 'iPadOS must return isIOSDevice = true');
    assert.equal(!isIOSDevice(), false, 'PwaInstallBanner must NEVER qualify on iPadOS');
  });

  await t.test('2. Standalone / Installed mode suppresses BOTH install UI elements', () => {
    // Case A: Standalone via display-mode: standalone
    setupMockEnv({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      displayModeStandalone: true
    });
    assert.equal(isPwaStandalone(), true, 'Should detect standalone via display-mode');
    assert.equal(!isPwaStandalone() && isIOSDevice(), false, 'Ios tip suppressed');

    // Case B: Standalone via navigator.standalone (iOS)
    setupMockEnv({
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      standalone: true
    });
    assert.equal(isPwaStandalone(), true, 'Should detect standalone via navigator.standalone');
    assert.equal(isIOSDevice() && !isPwaStandalone(), false, 'iOS tip suppressed in standalone');

    // Case C: Explicitly marked installed in localStorage
    setupMockEnv({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8)',
      standalone: false
    });
    markPwaInstalled('user-100');
    assert.equal(isPwaInstalled('user-100'), true);
  });

  await t.test('3. First-value gating: Neither UI appears before first value is achieved', () => {
    setupMockEnv();
    const guestId = null;
    const authUserId = 'samurai-ux-closure';

    // Neither has achieved first value initially
    assert.equal(hasFirstValueAchieved(guestId), false, 'Guest has no initial first-value');
    assert.equal(hasFirstValueAchieved(authUserId), false, 'Auth user has no initial first-value');

    // Ticking habit awards first-value
    markFirstValueAchieved(authUserId);
    assert.equal(hasFirstValueAchieved(authUserId), true, 'Auth user now has first-value');
    assert.equal(hasFirstValueAchieved(guestId), false, 'Guest still has no first-value');
  });

  await t.test('4. Dismissal persistence: Respects dismissed state across sessions per owner', () => {
    setupMockEnv();
    const userA = 'user-alpha';
    const userB = 'user-beta';

    // Phase 3A: PWA Banner dismissal
    assert.equal(isPwaDismissed(userA), false);
    markPwaDismissed(userA);
    assert.equal(isPwaDismissed(userA), true);
    assert.equal(isPwaDismissed(userB), false, 'User B dismissal independent');

    // Phase 3B: iOS Tip dismissal
    assert.equal(isIosTipDismissed(userA), false);
    markIosTipDismissed(userA);
    assert.equal(isIosTipDismissed(userA), true);
    assert.equal(isIosTipDismissed(userB), false, 'User B iOS tip dismissal independent');
  });

  await t.test('5. Verified Storage Keys Contract for Phase 3 Closure', () => {
    assert.equal(getScopedFirstValueKey(null), 'bushido_first_value_guest');
    assert.equal(getScopedFirstValueKey('usr-1'), 'bushido_first_value_user_usr-1');

    assert.equal(getScopedPwaDismissedKey(null), 'bushido_pwa_dismissed_guest');
    assert.equal(getScopedPwaDismissedKey('usr-1'), 'bushido_pwa_dismissed_user_usr-1');

    assert.equal(getScopedPwaInstalledKey(null), 'bushido_pwa_installed_guest');
    assert.equal(getScopedPwaInstalledKey('usr-1'), 'bushido_pwa_installed_user_usr-1');

    assert.equal(getScopedIosTipDismissedKey(null), 'bushido_ios_tip_dismissed_guest');
    assert.equal(getScopedIosTipDismissedKey('usr-1'), 'bushido_ios_tip_dismissed_user_usr-1');
  });

  await t.test('6. Codebase Hygiene: Exactly two distinct non-overlapping install UI components and zero dead relics', () => {
    const componentsDir = path.join(process.cwd(), 'src', 'components');
    const files = fs.readdirSync(componentsDir);

    // Ensure no legacy/duplicate install files like PwaInstallModal, InstallPrompt, etc.
    const installRelatedFiles = files.filter(f => /install|pwa/i.test(f));
    assert.deepEqual(
      installRelatedFiles.sort(),
      ['IosInstallTip.tsx', 'PwaInstallBanner.tsx'].sort(),
      'Must contain only IosInstallTip.tsx and PwaInstallBanner.tsx'
    );

    // App.tsx must mount both cleanly without duplicates
    const appTsx = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    const pwaBannerMatches = appTsx.match(/<PwaInstallBanner/g);
    const iosTipMatches = appTsx.match(/<IosInstallTip/g);

    assert.equal(pwaBannerMatches?.length, 1, 'App.tsx must render exactly 1 PwaInstallBanner');
    assert.equal(iosTipMatches?.length, 1, 'App.tsx must render exactly 1 IosInstallTip');
  });
});
