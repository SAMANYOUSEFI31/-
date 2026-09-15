import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { 
  TOUR_STEPS, 
} from '../src/components/FirstRunTour';
import { 
  getScopedTourSeenKey,
  TOUR_SEEN_KEY,
  TOUR_SEEN_PREFIX
} from '../src/utils/storageCore';
import {
  isTourSeen,
  markTourSeen,
  resetTourSeen,
  safeSetLocalStorage,
  safeRemoveLocalStorage,
  safeGetLocalStorage
} from '../src/utils/storageUtils';

// Mock localStorage and window for Node test environment
const storageMock: Record<string, string> = {};
const mockLocalStorage = {
  getItem: (key: string) => storageMock[key] ?? null,
  setItem: (key: string, val: string) => { storageMock[key] = String(val); },
  removeItem: (key: string) => { delete storageMock[key]; },
  clear: () => { for (const k in storageMock) delete storageMock[k]; },
  key: (index: number) => Object.keys(storageMock)[index] ?? null,
  get length() { return Object.keys(storageMock).length; }
};

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    localStorage: mockLocalStorage
  };
} else if (!globalThis.window.localStorage) {
  (globalThis.window as any).localStorage = mockLocalStorage;
}

if (typeof globalThis.localStorage === 'undefined') {
  globalThis.localStorage = mockLocalStorage as unknown as Storage;
}

describe('Phase 1B: First-Run Coach Marks on Battlefield', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('1. TOUR_STEPS defines 3-4 steps with Persian stoic copy and valid badges', () => {
    assert.ok(TOUR_STEPS.length >= 3 && TOUR_STEPS.length <= 4, 'Tour must have 3-4 steps');
    assert.strictEqual(TOUR_STEPS.length, 4);

    // Step 1: Foundations
    const step1 = TOUR_STEPS[0];
    assert.strictEqual(step1.id, 'step-foundations');
    assert.strictEqual(step1.targetId, 'battlefield-foundation-section');
    assert.ok(step1.title.includes('ارکان پنج‌گانه'));
    assert.ok(step1.description.includes('۵ رکن'));

    // Step 2: Score & Standard Day
    const step2 = TOUR_STEPS[1];
    assert.strictEqual(step2.id, 'step-score');
    assert.strictEqual(step2.targetId, 'battlefield-score-card');
    assert.ok(step2.title.includes('ارزش روز'));
    assert.ok(step2.description.includes('۸ از ۱۰'));

    // Step 3: Special Mission
    const step3 = TOUR_STEPS[2];
    assert.strictEqual(step3.id, 'step-special-mission');
    assert.strictEqual(step3.targetId, 'battlefield-special-mission-card');
    assert.ok(step3.title.includes('ماموریت ویژه'));
    assert.ok(step3.description.includes('۱۰ از ۱۰'));

    // Step 4: Command Hub / Navigation
    const step4 = TOUR_STEPS[3];
    assert.strictEqual(step4.id, 'step-command-hub');
    assert.strictEqual(step4.targetId, 'top-hub-bar');
    assert.ok(step4.title.includes('مرکز فرماندهی'));
    assert.ok(step4.description.includes('کات‌آف'));
  });

  it('2. Target elements actually exist in BattlefieldView and Navbar DOM markup', () => {
    const bfPath = path.resolve(process.cwd(), 'src/components/BattlefieldView.tsx');
    const bfContent = fs.readFileSync(bfPath, 'utf-8');

    assert.ok(bfContent.includes('id="battlefield-foundation-section"'), 'BattlefieldView must have battlefield-foundation-section');
    assert.ok(bfContent.includes('id="battlefield-score-card"'), 'BattlefieldView must have battlefield-score-card');
    assert.ok(bfContent.includes('id="battlefield-special-mission-card"'), 'BattlefieldView must have battlefield-special-mission-card');

    const navPath = path.resolve(process.cwd(), 'src/shared/components/layout/Navbar.tsx');
    const navContent = fs.readFileSync(navPath, 'utf-8');
    assert.ok(navContent.includes('id="top-hub-bar"'), 'Navbar must have id="top-hub-bar"');
  });

  it('3. Storage key scoping and persistence partition works per owner', () => {
    assert.strictEqual(getScopedTourSeenKey(null), `${TOUR_SEEN_PREFIX}guest`);
    assert.strictEqual(getScopedTourSeenKey(undefined), `${TOUR_SEEN_PREFIX}guest`);
    assert.strictEqual(getScopedTourSeenKey('admin-user-1'), `${TOUR_SEEN_PREFIX}user_admin-user-1`);

    // Initially unseen
    assert.strictEqual(isTourSeen(null), false);
    assert.strictEqual(isTourSeen('user-100'), false);

    // Mark seen for guest
    markTourSeen(null);
    assert.strictEqual(isTourSeen(null), true);
    // User-100 is still unseen
    assert.strictEqual(isTourSeen('user-100'), false);

    // Mark seen for user-100
    markTourSeen('user-100');
    assert.strictEqual(isTourSeen('user-100'), true);

    // Reset user-100
    resetTourSeen('user-100');
    assert.strictEqual(isTourSeen('user-100'), false);
    assert.strictEqual(isTourSeen(null), true);
  });

  it('4. FirstRunTour component strictly follows non-blocking ergonomics and accessibility', () => {
    const tourPath = path.resolve(process.cwd(), 'src/components/FirstRunTour.tsx');
    const tourContent = fs.readFileSync(tourPath, 'utf-8');

    // Never block habits rule: container and SVG spotlight must be pointer-events-none
    assert.ok(tourContent.includes('pointer-events-none'), 'Overlay container must have pointer-events-none');
    assert.ok(tourContent.includes('id="first-run-tour-container"'), 'Must have root id');
    assert.ok(tourContent.includes('id="first-run-tour-card"'), 'Must have card id');
    assert.ok(tourContent.includes('pointer-events-auto'), 'Only card has pointer-events-auto');

    // No scroll lock hell: must not lock document.body scroll
    assert.ok(!tourContent.includes('useBodyScrollLock'), 'Must NOT use body scroll lock');
    assert.ok(!tourContent.includes('overflow = \'hidden\''), 'Must NOT manipulate body overflow');

    // Accessible: Esc closes and Tab cycles
    assert.ok(tourContent.includes('Escape'), 'Must handle Escape key to close/skip');
    assert.ok(tourContent.includes('Tab'), 'Must provide light focus trap');
    assert.ok(tourContent.includes('first-run-tour-next-btn'), 'Must have next button');
    assert.ok(tourContent.includes('first-run-tour-skip-btn'), 'Must have skip button');
  });

  it('5. App.tsx mounts FirstRunTour gated by activeTab, cycles, and modals', () => {
    const appPath = path.resolve(process.cwd(), 'src/App.tsx');
    const appContent = fs.readFileSync(appPath, 'utf-8');

    assert.ok(appContent.includes('<FirstRunTour'), 'App.tsx must render FirstRunTour');
    assert.ok(appContent.includes('isTourOpen'), 'App.tsx must track isTourOpen');
    assert.ok(appContent.includes('isTourSeen'), 'App.tsx must check isTourSeen');
    assert.ok(appContent.includes('markTourSeen'), 'App.tsx must call markTourSeen');
    assert.ok(appContent.includes('activeTab === \'battlefield\''), 'Tour must be active on battlefield');
    assert.ok(appContent.includes('!isAnyModalOpen'), 'Tour must not collide with open modals');
  });

  it('6. ProfileSettingsView exposes onReplayTour button in Guide section', () => {
    const profilePath = path.resolve(process.cwd(), 'src/components/ProfileSettingsView.tsx');
    const profileContent = fs.readFileSync(profilePath, 'utf-8');

    assert.ok(profileContent.includes('onReplayTour'), 'ProfileSettingsView must accept onReplayTour prop');
    assert.ok(profileContent.includes('guide-replay-tour-btn'), 'ProfileSettingsView must have guide-replay-tour-btn');
    assert.ok(profileContent.includes('guide-replay-tour-card'), 'ProfileSettingsView must have guide-replay-tour-card');
  });
});
