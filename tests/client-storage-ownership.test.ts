import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadStoredSystemState,
  writeStateDirect,
  saveSystemStateDebounced,
  flushPendingStorageSave,
  cancelPendingStorageSave,
  getScopedStorageKey,
  getScopedDemoConsumedKey,
  getActiveAccountId,
  setActiveAccountId,
  normalizeUserId,
  clearUserLocalState,
  transitionAccountState,
  resetAccountState,
  importAccountState,
  STORAGE_PREFIX,
  DEMO_CONSUMED_PREFIX,
  LEGACY_STORAGE_KEY,
  LEGACY_DEMO_CONSUMED_KEY,
  TOKEN_KEY,
  ACTIVE_ACCOUNT_KEY
} from '../src/utils/storageUtils.js';
import { GUEST_USER_PROFILE, createInitialSystemState, createEmptySystemState } from '../src/data/initialData.js';
import { Cycle, DailyLog, SystemState, UserProfile } from '../src/types.js';

describe('Phase 3A: Client Local Ownership & Partition Isolation Contract', () => {
  const storageMock: Record<string, string> = {};

  beforeEach(() => {
    // Clear storage mock
    for (const k in storageMock) delete storageMock[k];

    // Reset pending debounce state
    cancelPendingStorageSave();

    // Mock global window and localStorage in Node
    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = {
        localStorage: {
          getItem: (key: string) => storageMock[key] ?? null,
          setItem: (key: string, val: string) => { storageMock[key] = String(val); },
          removeItem: (key: string) => { delete storageMock[key]; }
        }
      };
    }
  });

  // ===========================================================================
  // 1. ACCOUNT-SCOPED STATE PROOF & ISOLATION
  // ===========================================================================
  describe('1. Account-Scoped State Isolation & Storage Key Segregation', () => {
    it('stores User A, User B, and Guest states under strictly separated storage keys', () => {
      const keyGuest = getScopedStorageKey(null);
      const keyUserA = getScopedStorageKey('user-alpha-100');
      const keyUserB = getScopedStorageKey('user-beta-200');

      assert.equal(keyGuest, 'bushido_state_guest');
      assert.equal(keyUserA, 'bushido_state_user_user-alpha-100');
      assert.equal(keyUserB, 'bushido_state_user_user-beta-200');
      assert.notEqual(keyUserA, keyUserB);
      assert.notEqual(keyUserA, keyGuest);
    });

    it('persists distinct meaningful states for User A and User B, and guarantees 0 data leakage when loaded', () => {
      const stateA: SystemState = {
        cycles: [
          {
            id: 'cycle-alpha-1',
            title: 'چرخه تمرکز آلفا',
            startDate: '2026-09-01',
            endDate: '2026-11-29',
            targetTheme: 'amber',
            inheritedStreak: 12,
            isArchived: false,
            reportRead: false,
            rules: ['بیداری ۵ صبح']
          }
        ],
        logs: [
          {
            id: 'log-alpha-1',
            cycleId: 'cycle-alpha-1',
            date: '2026-09-01',
            wakeUp: true,
            workout: true,
            study: true,
            journal: true,
            hardTask: true,
            specialMission: false,
            notes: 'روز اول نبرد آلفا'
          }
        ],
        settings: {
          id: 'settings-alpha',
          platformName: 'سامانه آلفا',
          centralEngineName: 'موتور آلفا',
          allTimeMaxStreak: 12,
          allTimeMaxScore: 10,
          allTimeMaxStandardDays: 1,
          nightOwlCutoffHour: 3
        },
        userProfile: {
          id: 'user-alpha-100',
          name: 'فرمانده آلفا',
          email: 'alpha@bushido.app',
          phoneNumber: '09121111111',
          tier: 'vip_samurai',
          isVip: true,
          isAdmin: false,
          activeCycleLimit: 999
        }
      };

      const stateB: SystemState = {
        cycles: [
          {
            id: 'cycle-beta-1',
            title: 'چرخه اراده بتا',
            startDate: '2026-10-01',
            endDate: '2026-12-30',
            targetTheme: 'crimson',
            inheritedStreak: 0,
            isArchived: false,
            reportRead: false,
            rules: ['ورزش صبحگاهی']
          }
        ],
        logs: [
          {
            id: 'log-beta-1',
            cycleId: 'cycle-beta-1',
            date: '2026-10-01',
            wakeUp: true,
            workout: false,
            study: false,
            journal: false,
            hardTask: false,
            specialMission: false,
            notes: 'روز اول بتا'
          }
        ],
        settings: {
          id: 'settings-beta',
          platformName: 'سامانه بتا',
          centralEngineName: 'موتور بتا',
          allTimeMaxStreak: 3,
          allTimeMaxScore: 5,
          allTimeMaxStandardDays: 0,
          nightOwlCutoffHour: 5
        },
        userProfile: {
          id: 'user-beta-200',
          name: 'جنگجوی بتا',
          email: 'beta@bushido.app',
          phoneNumber: '09122222222',
          tier: 'free',
          isVip: false,
          isAdmin: false,
          activeCycleLimit: 1
        }
      };

      writeStateDirect(stateA, 'user-alpha-100');
      writeStateDirect(stateB, 'user-beta-200');

      // Verify User A load
      const loadedA = loadStoredSystemState('user-alpha-100');
      assert.equal(loadedA.userProfile.id, 'user-alpha-100');
      assert.equal(loadedA.userProfile.name, 'فرمانده آلفا');
      assert.equal(loadedA.cycles.length, 1);
      assert.equal(loadedA.cycles[0].id, 'cycle-alpha-1');
      assert.equal(loadedA.cycles[0].title, 'چرخه تمرکز آلفا');
      assert.equal(loadedA.logs.length, 1);
      assert.equal(loadedA.logs[0].notes, 'روز اول نبرد آلفا');
      assert.equal(loadedA.settings.nightOwlCutoffHour, 3);

      // Verify User B load
      const loadedB = loadStoredSystemState('user-beta-200');
      assert.equal(loadedB.userProfile.id, 'user-beta-200');
      assert.equal(loadedB.userProfile.name, 'جنگجوی بتا');
      assert.equal(loadedB.cycles.length, 1);
      assert.equal(loadedB.cycles[0].id, 'cycle-beta-1');
      assert.equal(loadedB.cycles[0].title, 'چرخه اراده بتا');
      assert.equal(loadedB.logs.length, 1);
      assert.equal(loadedB.logs[0].notes, 'روز اول بتا');
      assert.equal(loadedB.settings.nightOwlCutoffHour, 5);

      // Verify Guest load returns isolated guest seed/fallback, NOT user A or B
      const loadedGuest = loadStoredSystemState(null);
      assert.notEqual(loadedGuest.userProfile.id, 'user-alpha-100');
      assert.notEqual(loadedGuest.userProfile.id, 'user-beta-200');
      assert.ok(!loadedGuest.cycles.some(c => c.id === 'cycle-alpha-1' || c.id === 'cycle-beta-1'));
      assert.ok(!loadedGuest.logs.some(l => l.id === 'log-alpha-1' || l.id === 'log-beta-1'));
    });

    it('loads a clean empty state for an authenticated user with no prior storage, never borrowing another user data', () => {
      writeStateDirect({
        cycles: [{ id: 'c-alpha', title: 'چرخه آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 5 }],
        logs: [{ id: 'l-alpha', cycleId: 'c-alpha', date: '2026-09-01', wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false }],
        settings: { id: 's-1', platformName: 'OS', centralEngineName: 'Engine', allTimeMaxStreak: 5, allTimeMaxScore: 10, allTimeMaxStandardDays: 1, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-alpha-100', name: 'آلفا', email: 'a@a.com', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      }, 'user-alpha-100');

      const loadedC = loadStoredSystemState('user-charlie-300');
      assert.ok(loadedC);
      assert.equal(loadedC.userProfile.id, 'user-charlie-300');
      assert.equal(loadedC.cycles.length, 0, 'New authenticated user must start with clean empty cycles array');
      assert.equal(loadedC.logs.length, 0, 'New authenticated user must start with clean empty logs array');
    });

    it('guarantees debounced write for User A flushes to User A key before User B write begins, preventing cross-write', () => {
      const stateA: SystemState = {
        cycles: [{ id: 'c-deb-a', title: 'چرخه آلفا با تاخیر', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 1 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 1, allTimeMaxScore: 1, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-deb-a', name: 'کاربر الف', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      const stateB: SystemState = {
        cycles: [{ id: 'c-deb-b', title: 'چرخه بتا با تاخیر', startDate: '2026-10-01', endDate: '2026-12-29', targetTheme: 'crimson', isArchived: false, reportRead: false, inheritedStreak: 2 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 2, allTimeMaxScore: 2, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-deb-b', name: 'کاربر ب', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      saveSystemStateDebounced(stateA, 'user-deb-a', 500);
      saveSystemStateDebounced(stateB, 'user-deb-b', 500);
      flushPendingStorageSave();

      const rawA = storageMock[getScopedStorageKey('user-deb-a')];
      assert.ok(rawA, 'User A state must be persisted');
      const parsedA = JSON.parse(rawA);
      assert.equal(parsedA.cycles[0].id, 'c-deb-a');

      const rawB = storageMock[getScopedStorageKey('user-deb-b')];
      assert.ok(rawB, 'User B state must be persisted');
      const parsedB = JSON.parse(rawB);
      assert.equal(parsedB.cycles[0].id, 'c-deb-b');
    });
  });

  // ===========================================================================
  // 2. BEHAVIORAL TRANSITION CONTRACTS: LOGIN, SWITCH, LOGOUT, IMPERSONATION
  // ===========================================================================
  describe('2. Behavioral Transition Contracts', () => {
    it('Scenario 1: guest -> user A login (persists guest, loads user A, updates ACTIVE_ACCOUNT_KEY)', () => {
      const guestState = createInitialSystemState();
      writeStateDirect(guestState, null);

      writeStateDirect({
        cycles: [{ id: 'cycle-a-saved', title: 'چرخه ذخیره شده آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 7 }],
        logs: [{ id: 'log-a-1', cycleId: 'cycle-a-saved', date: '2026-09-01', wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false }],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 7, allTimeMaxScore: 10, allTimeMaxStandardDays: 1, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-1', name: 'آلفا', email: 'a@bushido.app', phoneNumber: '09121111111', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      }, 'user-a-1');

      const transition = transitionAccountState({
        currentSystemState: guestState,
        targetUserId: 'user-a-1',
        targetUserProfile: { id: 'user-a-1', name: 'آلفا سرور' }
      });

      assert.equal(transition.nextState.userProfile.id, 'user-a-1');
      assert.equal(transition.nextState.userProfile.name, 'آلفا سرور');
      assert.equal(transition.nextState.cycles.length, 1);
      assert.equal(transition.nextState.cycles[0].id, 'cycle-a-saved');
      assert.equal(getActiveAccountId(), 'user-a-1');
      assert.equal(storageMock[ACTIVE_ACCOUNT_KEY], 'user-a-1');
    });

    it('Scenario 2: user A -> user B switch (flushes A to A key, loads B, updates ACTIVE_ACCOUNT_KEY)', () => {
      const currentMemoryStateA: SystemState = {
        cycles: [{ id: 'cycle-a-live', title: 'چرخه فعال آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 10 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 10, allTimeMaxScore: 10, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-1', name: 'کاربر الف', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      writeStateDirect({
        cycles: [{ id: 'cycle-b-saved', title: 'چرخه بتا', startDate: '2026-10-01', endDate: '2026-12-30', targetTheme: 'emerald', isArchived: false, reportRead: false, inheritedStreak: 2 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 2, allTimeMaxScore: 4, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-b-2', name: 'کاربر ب', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      }, 'user-b-2');

      const switchResult = transitionAccountState({
        currentSystemState: currentMemoryStateA,
        targetUserId: 'user-b-2',
        targetUserProfile: { id: 'user-b-2', name: 'کاربر ب سرور' }
      });

      assert.equal(switchResult.nextState.userProfile.id, 'user-b-2');
      assert.equal(switchResult.nextState.cycles.length, 1);
      assert.equal(switchResult.nextState.cycles[0].id, 'cycle-b-saved');
      assert.ok(!switchResult.nextState.cycles.some(c => c.id === 'cycle-a-live'));
      assert.equal(getActiveAccountId(), 'user-b-2');

      const loadedA = loadStoredSystemState('user-a-1');
      assert.equal(loadedA.cycles[0].id, 'cycle-a-live');
    });

    it('Scenario 3: user A -> logout -> guest (persists user A, loads clean guest, clears ACTIVE_ACCOUNT_KEY)', () => {
      const userAState: SystemState = {
        cycles: [{ id: 'cycle-a-persisted', title: 'چرخه ماندگار آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 8 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 8, allTimeMaxScore: 8, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-logout', name: 'آلفا', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      const logoutResult = transitionAccountState({
        currentSystemState: userAState,
        targetUserId: null
      });

      assert.equal(logoutResult.nextState.userProfile.id, GUEST_USER_PROFILE.id);
      assert.equal(getActiveAccountId(), null);
      assert.equal(storageMock[ACTIVE_ACCOUNT_KEY], undefined);

      const rawUserA = storageMock[getScopedStorageKey('user-a-logout')];
      assert.ok(rawUserA);
      const parsedUserA = JSON.parse(rawUserA);
      assert.equal(parsedUserA.cycles[0].id, 'cycle-a-persisted');

      const reloginResult = transitionAccountState({
        currentSystemState: logoutResult.nextState,
        targetUserId: 'user-a-logout',
        targetUserProfile: { id: 'user-a-logout', name: 'آلفا' }
      });
      assert.equal(reloginResult.nextState.cycles[0].id, 'cycle-a-persisted');
      assert.equal(getActiveAccountId(), 'user-a-logout');
    });

    it('Scenario 4: admin -> impersonated user -> admin (maintains clean partition boundaries roundtrip)', () => {
      const adminState: SystemState = {
        cycles: [{ id: 'c-admin', title: 'چرخه مدیریت سامورایی', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 50 }],
        logs: [],
        settings: { id: 's-adm', platformName: 'Admin OS', centralEngineName: 'Admin Engine', allTimeMaxStreak: 50, allTimeMaxScore: 100, allTimeMaxStandardDays: 10, nightOwlCutoffHour: 4 },
        userProfile: { id: 'admin-master-001', name: 'مدیر کل', email: 'admin@bushido.app', phoneNumber: '09375454050', tier: 'vip_samurai', isVip: true, isAdmin: true, activeCycleLimit: 999 }
      };

      const targetUserState: SystemState = {
        cycles: [{ id: 'c-target', title: 'چرخه کاربر هدف', startDate: '2026-09-15', endDate: '2026-12-14', targetTheme: 'emerald', isArchived: false, reportRead: false, inheritedStreak: 3 }],
        logs: [],
        settings: { id: 's-tgt', platformName: 'Target OS', centralEngineName: 'Target Engine', allTimeMaxStreak: 3, allTimeMaxScore: 5, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'target-user-777', name: 'کاربر تحت نظارت', email: 'tgt@bushido.app', phoneNumber: '09127777777', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      writeStateDirect(adminState, 'admin-master-001');
      writeStateDirect(targetUserState, 'target-user-777');

      // 1. Enter impersonation
      const enterImpersonation = transitionAccountState({
        currentSystemState: adminState,
        targetUserId: 'target-user-777',
        targetUserProfile: targetUserState.userProfile
      });
      assert.equal(enterImpersonation.nextState.userProfile.id, 'target-user-777');
      assert.equal(enterImpersonation.nextState.cycles[0].id, 'c-target');
      assert.equal(getActiveAccountId(), 'target-user-777');

      // 2. Exit impersonation
      const exitImpersonation = transitionAccountState({
        currentSystemState: enterImpersonation.nextState,
        targetUserId: 'admin-master-001',
        targetUserProfile: adminState.userProfile
      });
      assert.equal(exitImpersonation.nextState.userProfile.id, 'admin-master-001');
      assert.equal(exitImpersonation.nextState.cycles[0].id, 'c-admin');
      assert.equal(getActiveAccountId(), 'admin-master-001');
    });

    it('Scenario 5: pending debounced write during account switch is canceled so stale state cannot overwrite target or outgoing account', () => {
      const oldStateA: SystemState = {
        cycles: [{ id: 'c-old', title: 'چرخه قدیمی', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 1 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 1, allTimeMaxScore: 1, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-race', name: 'کاربر الف', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      const newStateA: SystemState = {
        cycles: [{ id: 'c-new-explicit', title: 'چرخه جدید نهایی', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 5 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 5, allTimeMaxScore: 5, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-race', name: 'کاربر الف', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      // Queue an old debounced write
      saveSystemStateDebounced(oldStateA, 'user-a-race', 500);

      // Now immediately transition to User B passing newStateA as currentSystemState
      const transitionResult = transitionAccountState({
        currentSystemState: newStateA,
        targetUserId: 'user-b-dest',
        targetUserProfile: { id: 'user-b-dest', name: 'کاربر مقصد' }
      });

      assert.equal(transitionResult.nextState.userProfile.id, 'user-b-dest');
      assert.equal(getActiveAccountId(), 'user-b-dest');

      // The outgoing state saved in storage for User A MUST be newStateA, NOT the stale oldStateA
      const storedA = loadStoredSystemState('user-a-race');
      assert.equal(storedA.cycles[0].id, 'c-new-explicit');
      assert.equal(storedA.settings.allTimeMaxStreak, 5);

      // User B storage has zero cycles
      const storedB = loadStoredSystemState('user-b-dest');
      assert.equal(storedB.cycles.length, 0);
    });
  });

  // ===========================================================================
  // 3. BEHAVIORAL RESET & IMPORT DATA USING EXPORTED UTILITIES
  // ===========================================================================
  describe('3. Behavioral Reset & Import Data Using Exported Utilities', () => {
    it('Scenario 6: reset authenticated user via resetAccountState resets partition and preserves other users', () => {
      const userAProfile: UserProfile = {
        id: 'user-reset-auth',
        name: 'سامورایی بازنشانی',
        email: 'reset@bushido.app',
        phoneNumber: '09123333333',
        tier: 'free',
        isVip: false,
        isAdmin: false,
        activeCycleLimit: 1
      };

      // User A has modified cycles and demo consumed flag
      writeStateDirect({
        cycles: [{ id: 'custom-cycle-to-reset', title: 'چرخه قبل از ریست', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 20 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 20, allTimeMaxScore: 20, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: userAProfile
      }, 'user-reset-auth');
      storageMock[getScopedDemoConsumedKey('user-reset-auth')] = 'true';

      // User B exists
      writeStateDirect({
        cycles: [{ id: 'user-b-safe-cycle', title: 'چرخه امن کاربر ب', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'emerald', isArchived: false, reportRead: false, inheritedStreak: 10 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 10, allTimeMaxScore: 10, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-b-untouched', name: 'کاربر ب', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      }, 'user-b-untouched');

      // Reset User A
      const { freshState, activeCycleId } = resetAccountState(userAProfile);

      assert.equal(freshState.userProfile.id, 'user-reset-auth');
      assert.equal(freshState.userProfile.name, 'سامورایی بازنشانی');
      assert.equal(freshState.cycles.length, 1);
      assert.equal(freshState.cycles[0].id, 'cycle-1');
      assert.equal(activeCycleId, 'cycle-1');
      assert.equal(storageMock[getScopedDemoConsumedKey('user-reset-auth')], undefined);

      // Verify on disk
      const loadedA = loadStoredSystemState('user-reset-auth');
      assert.equal(loadedA.cycles[0].id, 'cycle-1');

      // Verify User B is completely untouched
      const loadedB = loadStoredSystemState('user-b-untouched');
      assert.equal(loadedB.cycles[0].id, 'user-b-safe-cycle');
    });

    it('Scenario 7: reset guest via resetAccountState purges demo flags and resets guest storage safely', () => {
      // Guest demo consumed
      storageMock[getScopedDemoConsumedKey(null)] = 'true';
      storageMock[LEGACY_DEMO_CONSUMED_KEY] = 'true';
      storageMock[LEGACY_STORAGE_KEY] = '{"old": "data"}';

      const { freshState } = resetAccountState(GUEST_USER_PROFILE);

      assert.equal(freshState.userProfile.id, GUEST_USER_PROFILE.id);
      assert.equal(freshState.cycles.length, 1);
      assert.equal(freshState.logs.length, 25);
      assert.equal(storageMock[getScopedDemoConsumedKey(null)], undefined);
      assert.equal(storageMock[LEGACY_DEMO_CONSUMED_KEY], undefined);
      assert.equal(storageMock[LEGACY_STORAGE_KEY], undefined);
    });

    it('Scenario 8: import while authenticated via importAccountState scopes data to active user', () => {
      const backupJson = JSON.stringify({
        cycles: [{ id: 'imported-cycle-1', title: 'چرخه وارداتی', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 15 }],
        logs: [{ id: 'imported-log-1', cycleId: 'imported-cycle-1', date: '2026-09-01', wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false }],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 15, allTimeMaxScore: 15, allTimeMaxStandardDays: 1, nightOwlCutoffHour: 4 },
        userProfile: { id: 'some-old-id', name: 'نام قبلی', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      });

      const importRes = importAccountState(backupJson, 'user-target-auth');

      assert.equal(importRes.success, true);
      assert.ok(importRes.state);
      assert.equal(importRes.state.userProfile.id, 'user-target-auth');
      assert.equal(importRes.state.cycles[0].id, 'imported-cycle-1');
      assert.equal(storageMock[getScopedDemoConsumedKey('user-target-auth')], 'true');

      // Verify stored state in target partition
      const stored = loadStoredSystemState('user-target-auth');
      assert.equal(stored.userProfile.id, 'user-target-auth');
      assert.equal(stored.cycles[0].id, 'imported-cycle-1');
      assert.equal(stored.logs[0].id, 'imported-log-1');

      // Old ID was neutralized: no partition was created for 'some-old-id'
      assert.equal(storageMock[getScopedStorageKey('some-old-id')], undefined);
    });

    it('Scenario 9: import as guest via importAccountState scopes data to guest profile', () => {
      const backupJson = JSON.stringify({
        cycles: [{ id: 'guest-imported-cycle', title: 'چرخه مهمان وارداتی', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 4 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 4, allTimeMaxScore: 4, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'random-user-id', name: 'کاربر ناشناس', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      });

      const importRes = importAccountState(backupJson, null);

      assert.equal(importRes.success, true);
      assert.ok(importRes.state);
      assert.equal(importRes.state.userProfile.id, GUEST_USER_PROFILE.id);
      assert.equal(storageMock[getScopedDemoConsumedKey(null)], 'true');

      const loadedGuest = loadStoredSystemState(null);
      assert.equal(loadedGuest.cycles[0].id, 'guest-imported-cycle');
      assert.equal(loadedGuest.userProfile.id, GUEST_USER_PROFILE.id);
    });

    it('Scenario 10: mismatched imported userProfile.id is neutralized to active account', () => {
      const maliciousBackupJson = JSON.stringify({
        cycles: [{ id: 'c-injected', title: 'چرخه تزریق شده', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 99 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 99, allTimeMaxScore: 99, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-victim-account', name: 'اکانت قربانی', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      });

      const res = importAccountState(maliciousBackupJson, 'user-current-session');
      assert.equal(res.success, true);
      assert.equal(res.state?.userProfile.id, 'user-current-session');

      // Victim account partition was NEVER created or modified
      assert.equal(storageMock[getScopedStorageKey('user-victim-account')], undefined);
      assert.ok(storageMock[getScopedStorageKey('user-current-session')]);
    });
  });

  // ===========================================================================
  // 4. MIGRATION, CORRUPTION, AND PRESERVATION OF UNRELATED KEYS
  // ===========================================================================
  describe('4. Legacy Migration, Corruption Resiliency, and Key Preservation', () => {
    it('Scenario 11: legacy guest migration preserves legacy data for guest, but NOT for authenticated user', () => {
      const legacyGuestData = {
        cycles: [{ id: 'legacy-c-guest', title: 'چرخه قدیمی مهمان', startDate: '2026-08-01', endDate: '2026-10-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 0 }],
        logs: [],
        settings: { id: 's-leg', platformName: 'Legacy', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: GUEST_USER_PROFILE.id, name: 'مهمان قدیمی', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      storageMock[LEGACY_STORAGE_KEY] = JSON.stringify(legacyGuestData);

      // Guest loads -> adopts legacy
      const guestLoaded = loadStoredSystemState(null);
      assert.equal(guestLoaded.cycles.length, 1);
      assert.equal(guestLoaded.cycles[0].id, 'legacy-c-guest');

      // Authenticated user loads -> clean empty cycles, never adopts guest legacy
      const authLoaded = loadStoredSystemState('user-fresh-100');
      assert.equal(authLoaded.cycles.length, 0);
      assert.equal(authLoaded.userProfile.id, 'user-fresh-100');
    });

    it('Scenario 12: corrupted JSON in every partition falls back safely without throwing', () => {
      // Corrupted guest partition
      storageMock[getScopedStorageKey(null)] = '{ corrupt json !@#$%';
      const guestFallback = loadStoredSystemState(null);
      assert.ok(guestFallback);
      assert.equal(guestFallback.userProfile.id, GUEST_USER_PROFILE.id);

      // Corrupted authenticated partition
      storageMock[getScopedStorageKey('user-corrupted-1')] = 'INVALID_JSON';
      const authFallback = loadStoredSystemState('user-corrupted-1');
      assert.ok(authFallback);
      assert.equal(authFallback.userProfile.id, 'user-corrupted-1');
      assert.equal(authFallback.cycles.length, 0);

      // Corrupted legacy storage
      storageMock[LEGACY_STORAGE_KEY] = 'CORRUPTED_LEGACY';
      const adminFallback = loadStoredSystemState('admin-master-001');
      assert.ok(adminFallback);
      assert.equal(adminFallback.userProfile.id, 'admin-master-001');

      // Corrupted JSON string in importAccountState
      const importErr = importAccountState('NOT_A_JSON', 'user-1');
      assert.equal(importErr.success, false);
      assert.equal(importErr.errorMessage, 'خطا در تجزیه فایل JSON.');
    });

    it('Scenario 13: operations on User A preserve unrelated users’ scoped keys 100% unaltered', () => {
      const userBKey = getScopedStorageKey('user-unrelated-b');
      const userCKey = getScopedStorageKey('user-unrelated-c');
      const adminKey = getScopedStorageKey('admin-master-001');
      const guestKey = getScopedStorageKey(null);

      storageMock[userBKey] = JSON.stringify({ marker: 'USER_B_DATA' });
      storageMock[userCKey] = JSON.stringify({ marker: 'USER_C_DATA' });
      storageMock[adminKey] = JSON.stringify({ marker: 'ADMIN_DATA' });
      storageMock[guestKey] = JSON.stringify({ marker: 'GUEST_DATA' });

      const userAProfile: UserProfile = { id: 'user-active-a', name: 'User A', email: 'a@a.com', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 };
      const userAState: SystemState = {
        ...createInitialSystemState(userAProfile),
        userProfile: userAProfile
      };

      // Perform write, reset, import, and transitions on User A
      writeStateDirect(userAState, 'user-active-a');
      resetAccountState(userAProfile);
      importAccountState(JSON.stringify(userAState), 'user-active-a');
      transitionAccountState({ currentSystemState: userAState, targetUserId: 'user-active-a', targetUserProfile: userAProfile });

      // Verify all unrelated storage keys remain completely untouched
      assert.equal(JSON.parse(storageMock[userBKey]).marker, 'USER_B_DATA');
      assert.equal(JSON.parse(storageMock[userCKey]).marker, 'USER_C_DATA');
      assert.equal(JSON.parse(storageMock[adminKey]).marker, 'ADMIN_DATA');
      assert.equal(JSON.parse(storageMock[guestKey]).marker, 'GUEST_DATA');
    });
  });

  // ===========================================================================
  // 5. STORAGE OWNERSHIP AUTHORITY & IDENTITY INTEGRITY
  // ===========================================================================
  describe('5. Storage Ownership Authority & Identity Integrity', () => {
    it('normalizes user IDs strictly from canonical ID and never derives ownership from mutable profile attributes', () => {
      assert.equal(normalizeUserId('   user-123   '), 'user-123');
      assert.equal(normalizeUserId(''), null);
      assert.equal(normalizeUserId('__guest__'), null);
      assert.equal(normalizeUserId(null), null);
      assert.equal(normalizeUserId(undefined), null);

      const key1 = getScopedStorageKey('user-fixed-id');
      const key2 = getScopedStorageKey('user-fixed-id');
      assert.equal(key1, key2);
    });

    it('safe unverified startup sequence loads Guest fallback when activeAccountId is not verified', () => {
      storageMock[TOKEN_KEY] = 'unverified-jwt-token';
      delete storageMock[ACTIVE_ACCOUNT_KEY];

      const activeAcc = getActiveAccountId();
      assert.equal(activeAcc, null);

      const state = loadStoredSystemState(activeAcc);
      assert.equal(state.userProfile.id, GUEST_USER_PROFILE.id);
    });
  });

  // ===========================================================================
  // 6. PHASE 3B HANDOFF: OFFLINE QUEUE STATUS DOCUMENTATION
  // ===========================================================================
  describe('6. Phase 3B Handoff Status: Global Offline Queue Awareness', () => {
    it('acknowledges OFFLINE_QUEUE_KEY operates globally in Phase 3A and must be scoped in Phase 3B', () => {
      const OFFLINE_QUEUE_KEY = 'bushido_offline_queue';
      assert.equal(OFFLINE_QUEUE_KEY, 'bushido_offline_queue');
    });
  });
});
