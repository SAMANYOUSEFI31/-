import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialSystemState, createEmptySystemState } from '../src/data/initialData.js';
import { 
  loadStoredSystemState, 
  STORAGE_KEY, 
  DEMO_CONSUMED_KEY, 
  getScopedStorageKey,
  resolveBackendSyncDecision 
} from '../src/utils/storageUtils.js';

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

      storageMock[getScopedStorageKey('user-custom-1')] = JSON.stringify(customState);

      const loaded = loadStoredSystemState('user-custom-1');
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

    it('preserves empty cycles state when demo has been consumed/deleted intentionally', () => {
      storageMock[DEMO_CONSUMED_KEY] = 'true';
      const emptyState = {
        cycles: [],
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
          id: 'user-1',
          name: 'کاربر',
          email: '',
          phoneNumber: '',
          tier: 'free',
          isVip: false,
          isAdmin: false,
          activeCycleLimit: 1
        }
      };
      storageMock[STORAGE_KEY] = JSON.stringify(emptyState);

      const loaded = loadStoredSystemState();
      assert.equal(loaded.cycles.length, 0);
      assert.equal(loaded.logs.length, 0);
    });

    it('falls back to empty state (not initial demo seed) when DEMO_CONSUMED is true and storage is missing or corrupted', () => {
      storageMock[DEMO_CONSUMED_KEY] = 'true';
      delete storageMock[STORAGE_KEY];

      const loadedEmpty = loadStoredSystemState();
      assert.ok(loadedEmpty);
      assert.equal(loadedEmpty.cycles.length, 0, 'Must NOT resurrect demo cycles when demo is consumed');
      assert.equal(loadedEmpty.logs.length, 0, 'Must NOT resurrect demo logs when demo is consumed');

      // Also on corrupted JSON
      storageMock[STORAGE_KEY] = 'CORRUPTED_JSON';
      const loadedCorrupted = loadStoredSystemState();
      assert.equal(loadedCorrupted.cycles.length, 0);
      assert.equal(loadedCorrupted.logs.length, 0);
    });

    it('maintains demo seed on first visit when demo is not consumed', () => {
      delete storageMock[DEMO_CONSUMED_KEY];
      delete storageMock[STORAGE_KEY];

      const loaded = loadStoredSystemState();
      assert.equal(loaded.cycles.length, 1);
      assert.equal(loaded.cycles[0].id, 'cycle-1');
      assert.equal(loaded.logs.length, 25);
    });
  });

  describe('resolveBackendSyncDecision (Pure Decision Contract)', () => {
    it('returns null for nextCycles and nextLogs when demo is NOT consumed and API returns empty (preserving onboarding demo)', () => {
      const decision = resolveBackendSyncDecision({
        apiCycles: [],
        apiLogs: [],
        isDemoConsumed: false
      });

      // Returning null explicitly instructs the state reducer to keep local state untouched
      assert.equal(decision.nextCycles, null, 'Must return null for nextCycles to prevent overwriting demo cycles');
      assert.equal(decision.nextLogs, null, 'Must return null for nextLogs to prevent overwriting demo logs');
      assert.equal(decision.shouldMarkDemoConsumed, false, 'Must NOT prematurely mark demo as consumed');
      assert.equal(decision.nextActiveCycleId, null);

      // Verify that applying this decision to initial demo state keeps it 100% intact
      const initialSeed = createInitialSystemState();
      const resolvedCycles = decision.nextCycles !== null ? decision.nextCycles : initialSeed.cycles;
      const resolvedLogs = decision.nextLogs !== null ? decision.nextLogs : initialSeed.logs;

      assert.equal(resolvedCycles.length, 1);
      assert.equal(resolvedCycles[0].id, 'cycle-1');
      assert.equal(resolvedLogs.length, 25);
    });

    it('returns empty arrays when DEMO_CONSUMED is true and API returns empty (never resurrects demo)', () => {
      const decision = resolveBackendSyncDecision({
        apiCycles: [],
        apiLogs: [],
        isDemoConsumed: true
      });

      // Returning [] explicitly instructs state to remain empty
      assert.deepEqual(decision.nextCycles, [], 'Must return empty array for cycles when demo is consumed');
      assert.deepEqual(decision.nextLogs, [], 'Must return empty array for logs when demo is consumed');
      assert.equal(decision.shouldMarkDemoConsumed, false);
      assert.equal(decision.nextActiveCycleId, null);

      // Verify that applying this decision maintains empty state
      const currentCycles: any[] = [];
      const currentLogs: any[] = [];
      const resolvedCycles = decision.nextCycles !== null ? decision.nextCycles : currentCycles;
      const resolvedLogs = decision.nextLogs !== null ? decision.nextLogs : currentLogs;

      assert.equal(resolvedCycles.length, 0);
      assert.equal(resolvedLogs.length, 0);
    });

    it('prioritizes real server data over local state and instructs marking demo as consumed', () => {
      const serverCycle = {
        id: 'cycle-real-cloud-99',
        title: 'چرخه ابری واقعی',
        startDate: '2026-09-02',
        endDate: '2026-11-30',
        userId: 'user-1'
      } as any;

      const serverLog = {
        id: 'log-2026-09-02',
        date: '2026-09-02',
        cycleId: 'cycle-real-cloud-99',
        createdAt: '2026-09-02T10:00:00Z',
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false
      };

      const decision = resolveBackendSyncDecision({
        apiCycles: [serverCycle],
        apiLogs: [serverLog],
        isDemoConsumed: false
      });

      assert.equal(decision.shouldMarkDemoConsumed, true, 'Must mark demo as consumed when real server data arrives');
      assert.equal(decision.nextActiveCycleId, 'cycle-real-cloud-99');
      assert.equal(decision.nextCycles?.length, 1);
      assert.equal(decision.nextCycles?.[0].id, 'cycle-real-cloud-99');
      assert.equal(decision.nextLogs?.length, 1);
      assert.equal(decision.nextLogs?.[0].id, 'log-2026-09-02');
    });

    it('clears leftover demo logs when server has real cycles but 0 logs', () => {
      const serverCycle = {
        id: 'cycle-real-new',
        title: 'چرخه جدید بدون لاگ',
        startDate: '2026-09-02',
        endDate: '2026-11-30'
      } as any;

      const decision = resolveBackendSyncDecision({
        apiCycles: [serverCycle],
        apiLogs: [],
        isDemoConsumed: false
      });

      assert.equal(decision.shouldMarkDemoConsumed, true);
      assert.equal(decision.nextCycles?.length, 1);
      assert.deepEqual(decision.nextLogs, [], 'Must return empty logs array to clear phantom demo logs');
    });

    it('gracefully handles null / failed network responses without modifying local state', () => {
      const decision = resolveBackendSyncDecision({
        apiCycles: null,
        apiLogs: null,
        isDemoConsumed: false
      });

      assert.equal(decision.nextCycles, null);
      assert.equal(decision.nextLogs, null);
      assert.equal(decision.shouldMarkDemoConsumed, false);
      assert.equal(decision.nextActiveCycleId, null);
    });
  });
});
