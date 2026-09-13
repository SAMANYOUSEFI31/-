import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { 
  loadStoredSystemState, 
  DEMO_CONSUMED_KEY, 
  getScopedDemoConsumedKey,
  resolveBackendSyncDecision,
  safeSetLocalStorage,
  safeRemoveLocalStorage,
  getScopedStorageKey
} from '../src/utils/storageUtils.js';
import { createInitialSystemState, GUEST_USER_PROFILE } from '../src/data/initialData.js';

describe('Phase 1A: Demo-First TTV & Compact Empty State Contracts', () => {
  const storageMock: Record<string, string> = {};

  beforeEach(() => {
    // Clear mock storage before each test
    for (const k in storageMock) delete storageMock[k];

    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => { storageMock[key] = val; },
        removeItem: (key: string) => { delete storageMock[key]; }
      }
    };
  });

  describe('1. First-Run Demo-First Time-to-Value (TTV)', () => {
    it('lands first-time unconsumed guest directly on initial demo seed cycle with 25 logs', () => {
      const state = loadStoredSystemState(null);
      assert.ok(state.cycles.length >= 1, 'Initial state must contain at least 1 cycle');
      const firstCycle = state.cycles[0];
      assert.equal(firstCycle.id, 'cycle-1', 'First-run cycle must be the starter sample cycle-1');
      assert.ok(firstCycle.title.includes('(نمونه)'), 'Sample cycle must be explicitly labeled with (نمونه)');
      assert.equal(state.logs.length, 25, 'Initial state must contain exactly 25 sample logs for rich TTV');
    });

    it('preserves demo seed across backend sync when remote API returns empty and demo is not consumed', () => {
      const decision = resolveBackendSyncDecision({
        apiCycles: [],
        apiLogs: [],
        isDemoConsumed: false
      });
      assert.equal(decision.nextCycles, null, 'Must preserve local demo cycle by returning null nextCycles');
      assert.equal(decision.nextLogs, null, 'Must preserve local demo logs by returning null nextLogs');
      assert.equal(decision.shouldMarkDemoConsumed, false, 'Must not mark demo consumed prematurely');
    });
  });

  describe('2. Compact Empty State & Anti-Resurrection Invariants', () => {
    it('returns empty cycles when demo is consumed and storage has no cycles', () => {
      safeSetLocalStorage(DEMO_CONSUMED_KEY, 'true');
      const scopedKey = getScopedDemoConsumedKey(null);
      safeSetLocalStorage(scopedKey, 'true');

      const state = loadStoredSystemState(null);
      assert.equal(state.cycles.length, 0, 'Cycles must be strictly empty when demo is consumed and no user cycles exist');
      assert.equal(state.logs.length, 0, 'Logs must be strictly empty when no cycles exist');
    });

    it('never resurrects demo seed when remote API returns empty after demo is consumed', () => {
      const decision = resolveBackendSyncDecision({
        apiCycles: [],
        apiLogs: [],
        isDemoConsumed: true
      });
      assert.deepEqual(decision.nextCycles, [], 'Must return empty array for nextCycles to prevent demo resurrection');
      assert.deepEqual(decision.nextLogs, [], 'Must return empty array for nextLogs');
    });

    it('maintains empty state on corrupted or wiped payload when demoConsumed flag is set', () => {
      safeSetLocalStorage(DEMO_CONSUMED_KEY, 'true');
      safeSetLocalStorage(getScopedStorageKey(null), '{ "invalid": "corrupted json payload');

      const state = loadStoredSystemState(null);
      assert.equal(state.cycles.length, 0, 'Corrupted storage fallback must not re-inject demo-1 when demo was consumed');
    });
  });

  describe('3. Clean Architecture & Compact Empty State UI Contract', () => {
    it('ensures OnboardingWelcomeView is reduced to compact empty state with one sentence and single mastery CTA', async () => {
      const fs = await import('node:fs');
      const fileContent = fs.readFileSync('src/components/OnboardingWelcomeView.tsx', 'utf-8');

      // Must have single sentence and mastery CTA
      assert.ok(fileContent.includes('هیچ چرخه فعالی وجود ندارد'), 'Must display compact heading');
      assert.ok(fileContent.includes('برای آغاز مسیر انضباط و ثبت روزانه ارکان بوشیدو، اولین چرخه ۹۰ روزه نبرد خود را بسازید.'), 'Must display single dignified sentence');
      assert.ok(fileContent.includes('btn-contract-mastery'), 'Must use existing btn-contract-mastery token');
      assert.ok(fileContent.includes('تعریف اولین چرخه نبرد'), 'Must have single mastery CTA');

      // Must NOT contain old multi-section manifesto wall
      assert.ok(!fileContent.includes('مسیر گام‌به‌گام پیروزی در سامانه بوشیدو'), 'Must not contain 3 pillars manifesto');
      assert.ok(!fileContent.includes('به کارزار فتح اراده و دیسیپلین خوش آمدید'), 'Must not contain long welcome hero');
      assert.ok(!fileContent.includes('grid grid-cols-1 md:grid-cols-3'), 'Must not contain 3-column feature cards');
    });

    it('ensures App.tsx has no dead onboarding routes or unused welcome imports', async () => {
      const fs = await import('node:fs');
      const appContent = fs.readFileSync('src/App.tsx', 'utf-8');

      assert.ok(!appContent.includes('OnboardingWelcomeView'), 'App.tsx must not import OnboardingWelcomeView directly');
      assert.ok(!appContent.includes("activeTab === 'onboarding'"), 'App.tsx must not have an onboarding tab route');
    });
  });
});
