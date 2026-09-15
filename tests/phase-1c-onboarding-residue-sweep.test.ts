import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  loadStoredSystemState,
  getScopedDemoConsumedKey,
  safeSetLocalStorage,
  safeGetLocalStorage
} from '../src/utils/storageUtils';
import { createEmptySystemState } from '../src/data/initialData';

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

describe('Phase 1C: Onboarding Residue Sweep & Unified Empty State Contract', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
  });

  it('1. App.tsx and BushidoContext.tsx have no dead legacy imports or obsolete demo keys', () => {
    const appContent = fs.readFileSync('src/App.tsx', 'utf-8');
    const contextContent = fs.readFileSync('src/context/BushidoContext.tsx', 'utf-8');

    // No unused global demo / storage key imports in App.tsx
    assert.ok(!appContent.includes('LEGACY_DEMO_CONSUMED_KEY,'), 'App.tsx must not import LEGACY_DEMO_CONSUMED_KEY');
    assert.ok(!appContent.includes('LEGACY_STORAGE_KEY,'), 'App.tsx must not import LEGACY_STORAGE_KEY');

    // No unused global keys in BushidoContext.tsx
    assert.ok(!contextContent.includes('LEGACY_DEMO_CONSUMED_KEY,'), 'BushidoContext.tsx must not import LEGACY_DEMO_CONSUMED_KEY');
    assert.ok(!contextContent.includes('LEGACY_STORAGE_KEY,'), 'BushidoContext.tsx must not import LEGACY_STORAGE_KEY');
  });

  it('2. CompactEmptyCycleState is unified and used across Battlefield, Archives, and Dashboard', () => {
    const bfContent = fs.readFileSync('src/features/battlefield/BattlefieldView.tsx', 'utf-8');
    const archivesContent = fs.readFileSync('src/features/archives/ArchivesView.tsx', 'utf-8');
    const dashboardContent = fs.readFileSync('src/features/dashboard/CycleDashboardView.tsx', 'utf-8');
    const compactContent = fs.readFileSync('src/features/cycles/CompactEmptyCycleState.tsx', 'utf-8');

    assert.ok(bfContent.includes('CompactEmptyCycleState'), 'BattlefieldView must use CompactEmptyCycleState');
    assert.ok(archivesContent.includes('CompactEmptyCycleState'), 'ArchivesView must use CompactEmptyCycleState');
    assert.ok(dashboardContent.includes('CompactEmptyCycleState'), 'CycleDashboardView must use CompactEmptyCycleState');
    assert.ok(compactContent.includes('CompactEmptyCycleState'), 'CompactEmptyCycleState.tsx must export component');
  });

  it('3. User Path 1 (First visit / Unconsumed): returns demo seed cycle', () => {
    const guestState = loadStoredSystemState(null);
    assert.ok(guestState.cycles.length > 0, 'First-time user must have starter demo cycle');
    assert.strictEqual(guestState.cycles[0].id, 'cycle-1');
    assert.ok(guestState.logs.length > 0, 'First-time user must have sample demo logs');
  });

  it('4. User Path 2 (Demo consumed, no real cycles): returns clean empty array and renders empty state', () => {
    // Explicitly consume demo for user
    const userId = 'user_clean_slate';
    safeSetLocalStorage(getScopedDemoConsumedKey(userId), 'true');

    const emptyState = loadStoredSystemState(userId);
    assert.strictEqual(emptyState.cycles.length, 0, 'Consumed user must have 0 cycles');
    assert.strictEqual(emptyState.logs.length, 0, 'Consumed user must have 0 logs');
  });

  it('5. User Path 3 (Has real cycle): loads real cycle and logs with full fidelity', () => {
    const userId = 'user_with_cycle';
    const realState = createEmptySystemState();
    realState.cycles = [{
      id: 'cycle-real-90',
      title: 'چرخه بهار بوشیدو',
      startDate: '2026-03-21',
      endDate: '2026-06-20',
      targetTheme: 'تسلط بر روتین صبح و تمرکز کاری',
      totalDays: 90,
      createdAt: '2026-03-21T00:00:00Z',
      isArchived: false,
      ownerId: userId
    }];
    realState.logs = [{
      id: 'log-1',
      cycleId: 'cycle-real-90',
      date: '2026-03-21',
      wakeUp: true,
      exercise: true,
      reading: true,
      deepWork: true,
      dietClean: true,
      specialMission: true,
      createdAt: '2026-03-21T10:00:00Z'
    }];

    assert.strictEqual(realState.cycles.length, 1);
    assert.strictEqual(realState.cycles[0].id, 'cycle-real-90');
    assert.strictEqual(realState.logs.length, 1);
  });
});
