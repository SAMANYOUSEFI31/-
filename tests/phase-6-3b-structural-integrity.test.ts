import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadStoredSystemState,
  recoverSystemState,
  sanitizeSystemState,
  getStoredStateRecoveryMetadata,
  clearStoredStateRecoveryMetadata,
  isValidISODateString,
  isStructurallyValidCycleCandidate,
  isStructurallyValidLogCandidate,
  getScopedStorageKey,
  getScopedDemoConsumedKey,
  getScopedStateRecoveryKey,
  STORAGE_KEY,
  DEMO_CONSUMED_KEY,
  clearUserLocalState,
  resetAccountState
} from '../src/utils/storageUtils';
import { createInitialSystemState, createEmptySystemState, GUEST_USER_PROFILE } from '../src/data/initialData';
import { Cycle, DailyLog, SystemState, UserProfile } from '../src/types';

describe('Phase 6.3B: Structural State Integrity and Corruption Recovery', () => {
  let storageMock: Record<string, string> = {};

  beforeEach(() => {
    storageMock = {};
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => { storageMock[key] = String(val); },
        removeItem: (key: string) => { delete storageMock[key]; },
        clear: () => { storageMock = {}; },
        key: (idx: number) => Object.keys(storageMock)[idx] ?? null,
        get length() { return Object.keys(storageMock).length; }
      }
    };
  });

  const baseUser: UserProfile = {
    ...GUEST_USER_PROFILE,
    id: 'user_samurai_1',
    name: 'سامورایی اصیل'
  };

  const validCycle1: Cycle = {
    id: 'cycle-1',
    title: 'نبرد اول',
    startDate: '2026-09-01',
    endDate: '2026-11-29',
    rules: ['قانون اول'],
    inheritedStreak: 0,
    isArchived: false,
    reportRead: false,
    revision: 1
  };

  const validCycle2: Cycle = {
    id: 'cycle-2',
    title: 'نبرد دوم',
    startDate: '2026-12-01',
    endDate: '2027-02-28',
    rules: [],
    inheritedStreak: 10,
    isArchived: false,
    reportRead: false,
    revision: 1
  };

  const validLog1: DailyLog = {
    id: 'log-1',
    cycleId: 'cycle-1',
    date: '2026-09-01',
    wakeUp: true,
    workout: true,
    study: true,
    journal: true,
    hardTask: true,
    specialMission: false,
    revision: 1
  };

  const validLog2: DailyLog = {
    id: 'log-2',
    cycleId: 'cycle-1',
    date: '2026-09-02',
    wakeUp: false,
    workout: true,
    study: true,
    journal: false,
    hardTask: false,
    specialMission: false,
    revision: 1
  };

  describe('1. Date & Candidate Structural Validation Primitives', () => {
    it('validates ISO calendar dates strictly', () => {
      assert.equal(isValidISODateString('2026-09-01'), true);
      assert.equal(isValidISODateString('2026-02-28'), true);
      assert.equal(isValidISODateString('2026-02-30'), false, 'Non-existent leap day must fail');
      assert.equal(isValidISODateString('2026-13-01'), false, 'Invalid month must fail');
      assert.equal(isValidISODateString('2026-09-32'), false, 'Invalid day must fail');
      assert.equal(isValidISODateString('not-a-date'), false);
      assert.equal(isValidISODateString(''), false);
      assert.equal(isValidISODateString(null), false);
      assert.equal(isValidISODateString(undefined), false);
    });

    it('validates structural Cycle candidates', () => {
      assert.equal(isStructurallyValidCycleCandidate(validCycle1), true);
      assert.equal(isStructurallyValidCycleCandidate({ ...validCycle1, id: '' }), false, 'Empty id must fail');
      assert.equal(isStructurallyValidCycleCandidate({ ...validCycle1, title: '   ' }), false, 'Blank title must fail');
      assert.equal(isStructurallyValidCycleCandidate({ ...validCycle1, startDate: 'invalid' }), false);
      assert.equal(isStructurallyValidCycleCandidate({ ...validCycle1, startDate: '2026-12-01', endDate: '2026-09-01' }), false, 'Inverted dates must fail');
      assert.equal(isStructurallyValidCycleCandidate(null), false);
      assert.equal(isStructurallyValidCycleCandidate([]), false);
    });

    it('validates structural DailyLog candidates', () => {
      assert.equal(isStructurallyValidLogCandidate(validLog1), true);
      assert.equal(isStructurallyValidLogCandidate({ ...validLog1, id: '' }), false, 'Empty id must fail');
      assert.equal(isStructurallyValidLogCandidate({ ...validLog1, cycleId: '' }), false, 'Empty cycleId must fail');
      assert.equal(isStructurallyValidLogCandidate({ ...validLog1, date: '2026-09-35' }), false, 'Malformed date must fail');
      assert.equal(isStructurallyValidLogCandidate(null), false);
    });
  });

  describe('2. Duplicate Resolution Policies', () => {
    it('deduplicates Cycle IDs preferring candidate with higher valid revision', () => {
      const fallback = createEmptySystemState(baseUser);
      const duplicateCycles = [
        { ...validCycle1, title: 'نسخه قدیمی', revision: 1 },
        { ...validCycle1, title: 'نسخه جدید', revision: 3 }
      ];

      const { state, recovery } = recoverSystemState({ cycles: duplicateCycles }, fallback, baseUser);
      assert.equal(state.cycles.length, 1);
      assert.equal(state.cycles[0].title, 'نسخه جدید');
      assert.equal(state.cycles[0].revision, 3);
      assert.equal(recovery.duplicateCount, 1);
      assert.equal(recovery.recoveredCycleCount, 1);
      assert.equal(recovery.discardedCycleCount, 1);
    });

    it('deduplicates Cycle IDs preserving first stable occurrence when revisions are equal or absent', () => {
      const fallback = createEmptySystemState(baseUser);
      const duplicateCycles = [
        { ...validCycle1, title: 'رخداد اول' },
        { ...validCycle1, title: 'رخداد دوم' }
      ];

      const { state, recovery } = recoverSystemState({ cycles: duplicateCycles }, fallback, baseUser);
      assert.equal(state.cycles.length, 1);
      assert.equal(state.cycles[0].title, 'رخداد اول');
      assert.equal(recovery.duplicateCount, 1);
    });

    it('deduplicates DailyLogs preferring candidate with higher valid revision on identical date', () => {
      const fallback = createEmptySystemState(baseUser);
      const duplicateLogs = [
        { ...validLog1, wakeUp: false, revision: 1 },
        { ...validLog1, wakeUp: true, revision: 4 }
      ];

      const { state, recovery } = recoverSystemState(
        { cycles: [validCycle1], logs: duplicateLogs },
        fallback,
        baseUser
      );

      assert.equal(state.logs.length, 1);
      assert.equal(state.logs[0].wakeUp, true);
      assert.equal(state.logs[0].revision, 4);
      assert.equal(recovery.duplicateCount, 1);
      assert.equal(recovery.recoveredLogCount, 1);
    });

    it('deduplicates DailyLogs preserving first stable occurrence when revisions are equal', () => {
      const fallback = createEmptySystemState(baseUser);
      const duplicateLogs = [
        { ...validLog1, notes: 'یادداشت اولیه', revision: 2 },
        { ...validLog1, notes: 'یادداشت ثانویه', revision: 2 }
      ];

      const { state, recovery } = recoverSystemState(
        { cycles: [validCycle1], logs: duplicateLogs },
        fallback,
        baseUser
      );

      assert.equal(state.logs.length, 1);
      assert.equal(state.logs[0].notes, 'یادداشت اولیه');
      assert.equal(recovery.duplicateCount, 1);
    });
  });

  describe('3. Orphan DailyLog Filtering Policy', () => {
    it('excludes DailyLogs referencing non-existent Cycles without crashing or inventing cycles', () => {
      const fallback = createEmptySystemState(baseUser);
      const orphanLog: DailyLog = {
        ...validLog1,
        id: 'orphan-1',
        cycleId: 'non-existent-cycle-999',
        date: '2026-09-05'
      };

      const { state, recovery } = recoverSystemState(
        { cycles: [validCycle1], logs: [validLog1, orphanLog] },
        fallback,
        baseUser
      );

      assert.equal(state.cycles.length, 1);
      assert.equal(state.logs.length, 1);
      assert.equal(state.logs[0].id, 'log-1');
      assert.equal(recovery.orphanCount, 1);
      assert.equal(recovery.discardedLogCount, 1);
      assert.equal(recovery.recoveredLogCount, 1);
    });

    it('excludes DailyLogs whose parent Cycle was rejected due to malformed date range', () => {
      const fallback = createEmptySystemState(baseUser);
      const malformedCycle = {
        id: 'malformed-c1',
        title: 'چرخه خراب',
        startDate: '2026-12-01',
        endDate: '2026-01-01' // Inverted!
      };
      const logPointingToMalformed: DailyLog = {
        ...validLog1,
        id: 'log-malformed-parent',
        cycleId: 'malformed-c1',
        date: '2026-09-10'
      };

      const { state, recovery } = recoverSystemState(
        { cycles: [malformedCycle, validCycle2], logs: [logPointingToMalformed] },
        fallback,
        baseUser
      );

      assert.equal(state.cycles.length, 1);
      assert.equal(state.cycles[0].id, 'cycle-2');
      assert.equal(state.logs.length, 0, 'Log pointing to rejected cycle must be excluded as an orphan');
      assert.equal(recovery.discardedCycleCount, 1);
      assert.equal(recovery.orphanCount, 1);
      assert.equal(recovery.discardedLogCount, 1);
    });
  });

  describe('4. Partial State Recovery & Non-Destructive Filtering', () => {
    it('preserves valid subsets of Cycles and Logs rather than wiping out to empty seed', () => {
      const fallback = createEmptySystemState(baseUser);
      const malformedCycle = { id: 'c-broken', title: '', startDate: 'bad-date', endDate: 'bad-date' };
      const malformedLog = { id: 'l-broken', cycleId: 'cycle-1', date: 'not-a-date' };

      const mixedInput = {
        cycles: [validCycle1, malformedCycle, validCycle2],
        logs: [validLog1, malformedLog, validLog2],
        settings: { platformName: 'بوشیدو کاستوم', allTimeMaxStreak: 45 }
      };

      const { state, recovery } = recoverSystemState(mixedInput, fallback, baseUser);

      assert.equal(state.cycles.length, 2);
      assert.equal(state.cycles[0].id, 'cycle-1');
      assert.equal(state.cycles[1].id, 'cycle-2');
      assert.equal(state.logs.length, 2);
      assert.equal(state.logs[0].id, 'log-1');
      assert.equal(state.logs[1].id, 'log-2');
      assert.equal(state.settings.platformName, 'بوشیدو کاستوم');
      assert.equal(state.settings.allTimeMaxStreak, 45);

      assert.equal(recovery.recoveredCycleCount, 2);
      assert.equal(recovery.discardedCycleCount, 1);
      assert.equal(recovery.recoveredLogCount, 2);
      assert.equal(recovery.discardedLogCount, 1);
      assert.equal(recovery.orphanCount, 0);
      assert.equal(recovery.usedFallback, false);
    });

    it('is completely deterministic: identical inputs produce identical recovered states', () => {
      const fallback = createEmptySystemState(baseUser);
      const raw = {
        cycles: [validCycle1, { id: 'c-invalid', startDate: 'invalid' }, validCycle1],
        logs: [validLog1, { id: 'l-invalid', date: 'invalid' }, validLog1]
      };

      const result1 = recoverSystemState(raw, fallback, baseUser);
      const result2 = recoverSystemState(raw, fallback, baseUser);

      assert.deepEqual(result1.state, result2.state);
      assert.deepEqual(result1.recovery, result2.recovery);
    });
  });

  describe('5. Corrupted Raw JSON & Storage Partition Recovery', () => {
    it('clears unparseable JSON from storage and falls back safely without throwing', () => {
      const userKey = getScopedStorageKey('user-corrupted-99');
      storageMock[userKey] = '{ corrupted unparseable JSON #$%@! ';

      const loaded = loadStoredSystemState('user-corrupted-99');
      assert.ok(loaded);
      assert.equal(loaded.userProfile.id, 'user-corrupted-99');
      assert.equal(loaded.cycles.length, 0);

      // Verify that corrupted raw key was cleared from storage
      assert.equal(storageMock[userKey], undefined, 'Corrupted raw value must be cleared from storage');

      // Verify recovery metadata was written
      const recovery = getStoredStateRecoveryMetadata('user-corrupted-99');
      assert.ok(recovery);
      assert.equal(recovery.usedFallback, true);
      assert.equal(recovery.corruptedRawCleared, true);

      // On next load, storage is clean and does not attempt parsing invalid JSON
      const nextLoaded = loadStoredSystemState('user-corrupted-99');
      assert.equal(nextLoaded.userProfile.id, 'user-corrupted-99');
    });

    it('handles guest partition corrupted JSON respecting demo-consumed state', () => {
      const guestKey = getScopedStorageKey(null);
      const demoConsumedKey = getScopedDemoConsumedKey(null);

      // Case A: Demo NOT consumed -> falls back to initial state
      storageMock[guestKey] = 'INVALID_JSON_FOR_GUEST';
      const guestInitial = loadStoredSystemState(null);
      assert.equal(guestInitial.cycles.length, 1);
      assert.equal(guestInitial.logs.length, 25);
      assert.equal(storageMock[guestKey], undefined);

      // Case B: Demo IS consumed -> falls back to empty state
      storageMock[demoConsumedKey] = 'true';
      storageMock[guestKey] = 'INVALID_JSON_AGAIN';
      const guestEmpty = loadStoredSystemState(null);
      assert.equal(guestEmpty.cycles.length, 0);
      assert.equal(guestEmpty.logs.length, 0);
      assert.equal(storageMock[guestKey], undefined);
    });

    it('persists sanitized recovered state back to storage to prevent repeated recovery overhead', () => {
      const userKey = getScopedStorageKey('user-repeat-1');
      const rawPartiallyCorrupted = {
        cycles: [validCycle1, { id: 'invalid-c', startDate: '9999-99-99' }],
        logs: [validLog1]
      };
      storageMock[userKey] = JSON.stringify(rawPartiallyCorrupted);

      const firstLoad = loadStoredSystemState('user-repeat-1');
      assert.equal(firstLoad.cycles.length, 1);

      // The storage value is now replaced with the clean, recovered JSON
      const cleanedStorageVal = JSON.parse(storageMock[userKey]);
      assert.equal(cleanedStorageVal.cycles.length, 1);
      assert.equal(cleanedStorageVal.cycles[0].id, 'cycle-1');
    });

    it('guarantees account partition isolation during corruption recovery', () => {
      const userAKey = getScopedStorageKey('user-a');
      const userBKey = getScopedStorageKey('user-b');
      const guestKey = getScopedStorageKey(null);

      // User A has corrupt data
      storageMock[userAKey] = 'CORRUPTED_USER_A';
      // User B has valid data
      storageMock[userBKey] = JSON.stringify({
        cycles: [validCycle2],
        logs: []
      });
      // Guest has valid data
      storageMock[guestKey] = JSON.stringify({
        cycles: [validCycle1],
        logs: []
      });

      const loadedA = loadStoredSystemState('user-a');
      assert.equal(loadedA.cycles.length, 0);
      assert.equal(storageMock[userAKey], undefined);

      // User B and Guest must be 100% untouched
      const loadedB = loadStoredSystemState('user-b');
      assert.equal(loadedB.cycles.length, 1);
      assert.equal(loadedB.cycles[0].id, 'cycle-2');

      const loadedGuest = loadStoredSystemState(null);
      assert.equal(loadedGuest.cycles.length, 1);
      assert.equal(loadedGuest.cycles[0].id, 'cycle-1');
    });
  });

  describe('6. Phase 6.3A Profile Protection Invariants Maintained', () => {
    it('strictly preserves Phase 6.3A Profile allowlist rejecting privileged field tampering', () => {
      const fallback = createEmptySystemState(baseUser);
      const tamperedPayload = {
        userProfile: {
          id: 'user_attacker',
          name: 'نام تمیز',
          nightOwlCutoffHour: 4,
          accentTheme: 'cyan',
          isAdmin: true,
          isVip: true,
          tier: 'vip_lifetime',
          activeCycleLimit: 999,
          paymentRefId: 'fake_ref_123',
          email: 'hacker@attacker.io'
        },
        cycles: [validCycle1]
      };

      const { state } = recoverSystemState(tamperedPayload, fallback, baseUser);

      // Allowed local presentation fields overlay properly:
      assert.equal(state.userProfile.name, 'نام تمیز');
      assert.equal(state.userProfile.nightOwlCutoffHour, 4);
      assert.equal(state.userProfile.accentTheme, 'cyan');

      // Privileged / server-authoritative fields remain strictly locked to trusted baseUser:
      assert.equal(state.userProfile.id, baseUser.id);
      assert.equal(state.userProfile.isAdmin, false);
      assert.equal(state.userProfile.isVip, false);
      assert.equal(state.userProfile.tier, 'free');
      assert.equal(state.userProfile.activeCycleLimit, 1);
      assert.equal(state.userProfile.paymentRefId, baseUser.paymentRefId);
      assert.equal(state.userProfile.email, baseUser.email);
    });
  });

  describe('7. Account Reset & State Clearing Operations', () => {
    it('clears stored recovery metadata on account reset and clearUserLocalState', () => {
      const userKey = getScopedStorageKey('user-reset-test');
      const recoveryKey = getScopedStateRecoveryKey('user-reset-test');

      storageMock[recoveryKey] = JSON.stringify({ recoveredCycleCount: 1, discardedCycleCount: 0, usedFallback: false });
      assert.ok(getStoredStateRecoveryMetadata('user-reset-test'));

      clearUserLocalState('user-reset-test');
      assert.equal(getStoredStateRecoveryMetadata('user-reset-test'), null);
      assert.equal(storageMock[recoveryKey], undefined);

      // Also on resetAccountState
      storageMock[recoveryKey] = JSON.stringify({ recoveredCycleCount: 1, discardedCycleCount: 0, usedFallback: false });
      resetAccountState({ ...baseUser, id: 'user-reset-test' });
      assert.equal(getStoredStateRecoveryMetadata('user-reset-test'), null);
    });
  });
});
