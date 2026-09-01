import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSystemState } from '../src/data/initialData.js';
import { loadStoredSystemState, STORAGE_KEY } from '../src/utils/storageUtils.js';

describe('Bushido Storage & Seed Preservation', () => {
  // Mock localStorage for Node environment tests
  const storageMock: Record<string, string> = {};

  beforeEach(() => {
    // Clear mock storage
    for (const k in storageMock) delete storageMock[k];

    // Define global window/localStorage mock if running in pure Node
    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = {
        localStorage: {
          getItem: (key: string) => storageMock[key] ?? null,
          setItem: (key: string, val: string) => { storageMock[key] = val; },
          removeItem: (key: string) => { delete storageMock[key]; }
        }
      };
    }
  });

  describe('Initial Seed Data Specs', () => {
    it('creates well-formed initial system state with exactly 1 active cycle and valid 25-day logs', () => {
      const state = createInitialSystemState();

      assert.equal(state.cycles.length, 1);
      assert.equal(state.cycles[0].id, 'cycle-1');
      assert.equal(state.logs.length, 25); // 24 past days + today = 25
      assert.ok(state.settings.allTimeMaxStreak >= 0);
      assert.ok(state.userProfile.name.length > 0);
    });
  });

  describe('Storage State Preservation & Immutability', () => {
    it('preserves user custom state without overwriting with seed when storage has data', () => {
      const customState = {
        cycles: [
          {
            id: 'my-custom-cycle',
            title: 'چرخه اختصاصی من',
            startDate: '2026-09-01',
            endDate: '2026-11-29',
            targetTheme: 'تمرکز کاری',
            rules: [],
            isArchived: false,
            reportRead: false,
            inheritedStreak: 0
          }
        ],
        logs: [],
        settings: {
          id: 'system-main',
          platformName: 'Bushido Discipline OS',
          centralEngineName: 'موتور مرکزی',
          allTimeMaxStreak: 0,
          allTimeMaxScore: 0,
          allTimeMaxStandardDays: 0,
          nightOwlCutoffHour: 4
        },
        userProfile: {
          id: 'user-custom-1',
          name: 'سامورایی حقیقی',
          email: 'user@example.com',
          phoneNumber: '09121234567',
          tier: 'free',
          isVip: false,
          isAdmin: false,
          activeCycleLimit: 1
        }
      };

      storageMock[STORAGE_KEY] = JSON.stringify(customState);

      const loaded = loadStoredSystemState();
      assert.equal(loaded.cycles.length, 1);
      assert.equal(loaded.cycles[0].id, 'my-custom-cycle');
      assert.equal(loaded.cycles[0].title, 'چرخه اختصاصی من');
      // Preserves intentionally empty logs array!
      assert.equal(loaded.logs.length, 0);
      assert.equal(loaded.userProfile.id, 'user-custom-1');
    });

    it('falls back safely to initial system state on invalid or corrupted JSON without throwing error', () => {
      storageMock[STORAGE_KEY] = 'INVALID_JSON_CORRUPTED';

      const loaded = loadStoredSystemState();
      assert.ok(loaded);
      assert.equal(loaded.cycles.length, 1);
      assert.equal(loaded.logs.length, 25);
    });
  });
});
