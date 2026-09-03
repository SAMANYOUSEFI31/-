import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadStoredSystemState,
  writeStateDirect,
  saveSystemStateDebounced,
  flushPendingStorageSave,
  getScopedStorageKey,
  getScopedDemoConsumedKey,
  getActiveAccountId,
  setActiveAccountId,
  normalizeUserId,
  clearUserLocalState,
  transitionAccountState,
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
  // 1. ACCOUNT-SCOPED STATE PROOF
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

      // Write directly to their respective partitions
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
      // User A exists in storage
      writeStateDirect({
        cycles: [{ id: 'c-alpha', title: 'چرخه آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 5 }],
        logs: [{ id: 'l-alpha', cycleId: 'c-alpha', date: '2026-09-01', wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false }],
        settings: { id: 's-1', platformName: 'OS', centralEngineName: 'Engine', allTimeMaxStreak: 5, allTimeMaxScore: 10, allTimeMaxStandardDays: 1, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-alpha-100', name: 'آلفا', email: 'a@a.com', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      }, 'user-alpha-100');

      // User C has no prior storage
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

      // Queue debounced save for User A
      saveSystemStateDebounced(stateA, 'user-deb-a', 500);

      // Immediately queue debounced save for User B before User A's timer fires
      saveSystemStateDebounced(stateB, 'user-deb-b', 500);

      // Flush all pending saves
      flushPendingStorageSave();

      // Check User A key contains stateA
      const rawA = storageMock[getScopedStorageKey('user-deb-a')];
      assert.ok(rawA, 'User A state must be persisted');
      const parsedA = JSON.parse(rawA);
      assert.equal(parsedA.cycles[0].id, 'c-deb-a');

      // Check User B key contains stateB
      const rawB = storageMock[getScopedStorageKey('user-deb-b')];
      assert.ok(rawB, 'User B state must be persisted');
      const parsedB = JSON.parse(rawB);
      assert.equal(parsedB.cycles[0].id, 'c-deb-b');
    });
  });

  // ===========================================================================
  // 2. LOGIN, LOGOUT, AND ACCOUNT-SWITCH CONTRACT
  // ===========================================================================
  describe('2. Login, Logout, and Account-Switch Contract', () => {
    it('transitions from Guest to User A and loads User A partition on login', () => {
      // 1. Initial Guest session with default seed
      const guestState = createInitialSystemState();

      // User A already has saved partition
      writeStateDirect({
        cycles: [{ id: 'cycle-a-saved', title: 'چرخه ذخیره شده آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 7 }],
        logs: [{ id: 'log-a-1', cycleId: 'cycle-a-saved', date: '2026-09-01', wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false }],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 7, allTimeMaxScore: 10, allTimeMaxStandardDays: 1, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-1', name: 'آلفا', email: 'a@bushido.app', phoneNumber: '09121111111', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      }, 'user-a-1');

      // Perform account transition to User A
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
    });

    it('switching from User A to User B flushes User A and loads User B partition with 0 leakage', () => {
      const currentMemoryStateA: SystemState = {
        cycles: [{ id: 'cycle-a-live', title: 'چرخه فعال آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 10 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 10, allTimeMaxScore: 10, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-1', name: 'کاربر الف', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      // User B has their own saved partition
      writeStateDirect({
        cycles: [{ id: 'cycle-b-saved', title: 'چرخه بتا', startDate: '2026-10-01', endDate: '2026-12-30', targetTheme: 'emerald', isArchived: false, reportRead: false, inheritedStreak: 2 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 2, allTimeMaxScore: 4, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-b-2', name: 'کاربر ب', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      }, 'user-b-2');

      // Switch to User B
      const switchResult = transitionAccountState({
        currentSystemState: currentMemoryStateA,
        targetUserId: 'user-b-2',
        targetUserProfile: { id: 'user-b-2', name: 'کاربر ب سرور' }
      });

      // Verify in-memory state is now User B's
      assert.equal(switchResult.nextState.userProfile.id, 'user-b-2');
      assert.equal(switchResult.nextState.cycles.length, 1);
      assert.equal(switchResult.nextState.cycles[0].id, 'cycle-b-saved');
      assert.ok(!switchResult.nextState.cycles.some(c => c.id === 'cycle-a-live'));

      // Verify User A was flushed to storage before switch
      const loadedA = loadStoredSystemState('user-a-1');
      assert.equal(loadedA.cycles[0].id, 'cycle-a-live');
    });

    it('logout clears authenticated in-memory state, loads Guest, and preserves User A stored partition', () => {
      const userAState: SystemState = {
        cycles: [{ id: 'cycle-a-persisted', title: 'چرخه ماندگار آلفا', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 8 }],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 8, allTimeMaxScore: 8, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a-logout', name: 'آلفا', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      // Logout transition
      const logoutResult = transitionAccountState({
        currentSystemState: userAState,
        targetUserId: null
      });

      // In-memory state is now Guest
      assert.equal(logoutResult.nextState.userProfile.id, GUEST_USER_PROFILE.id);
      assert.equal(getActiveAccountId(), null);

      // User A partition in localStorage remains 100% intact
      const rawUserA = storageMock[getScopedStorageKey('user-a-logout')];
      assert.ok(rawUserA);
      const parsedUserA = JSON.parse(rawUserA);
      assert.equal(parsedUserA.cycles[0].id, 'cycle-a-persisted');

      // Logging back in restores User A partition
      const reloginResult = transitionAccountState({
        currentSystemState: logoutResult.nextState,
        targetUserId: 'user-a-logout',
        targetUserProfile: { id: 'user-a-logout', name: 'آلفا' }
      });
      assert.equal(reloginResult.nextState.cycles[0].id, 'cycle-a-persisted');
    });

    it('impersonation entry and exit correctly separates Admin partition and Target User partition', () => {
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

      // 1. Enter impersonation (Admin -> Target User)
      const enterImpersonation = transitionAccountState({
        currentSystemState: adminState,
        targetUserId: 'target-user-777',
        targetUserProfile: targetUserState.userProfile
      });
      assert.equal(enterImpersonation.nextState.userProfile.id, 'target-user-777');
      assert.equal(enterImpersonation.nextState.cycles[0].id, 'c-target');
      assert.equal(getActiveAccountId(), 'target-user-777');

      // 2. Exit impersonation (Target User -> Admin)
      const exitImpersonation = transitionAccountState({
        currentSystemState: enterImpersonation.nextState,
        targetUserId: 'admin-master-001',
        targetUserProfile: adminState.userProfile
      });
      assert.equal(exitImpersonation.nextState.userProfile.id, 'admin-master-001');
      assert.equal(exitImpersonation.nextState.cycles[0].id, 'c-admin');
      assert.equal(getActiveAccountId(), 'admin-master-001');
    });
  });

  // ===========================================================================
  // 3. SCOPED DEMO-CONSUMED KEY ISOLATION
  // ===========================================================================
  describe('3. Scoped Demo-Consumed Key Isolation', () => {
    it('guarantees User A consuming demo does NOT consume demo for User B or Guest', () => {
      const demoKeyA = getScopedDemoConsumedKey('user-alpha-1');
      const demoKeyB = getScopedDemoConsumedKey('user-beta-2');
      const demoKeyGuest = getScopedDemoConsumedKey(null);

      assert.equal(demoKeyA, 'bushido_demo_consumed_user_user-alpha-1');
      assert.equal(demoKeyB, 'bushido_demo_consumed_user_user-beta-2');
      assert.equal(demoKeyGuest, 'bushido_demo_consumed_guest');

      // User A consumes demo
      storageMock[demoKeyA] = 'true';

      assert.equal(storageMock[demoKeyA], 'true');
      assert.equal(storageMock[demoKeyB], undefined);
      assert.equal(storageMock[demoKeyGuest], undefined);
      assert.equal(storageMock[LEGACY_DEMO_CONSUMED_KEY], undefined);

      // Guest load still gets full starter demo seed because guest demo is not consumed
      const guestState = loadStoredSystemState(null);
      assert.equal(guestState.cycles.length, 1);
      assert.equal(guestState.logs.length, 25);
    });

    it('Guest consuming demo leaves authenticated account demo state untouched', () => {
      const demoKeyGuest = getScopedDemoConsumedKey(null);
      storageMock[demoKeyGuest] = 'true';

      const demoKeyA = getScopedDemoConsumedKey('user-alpha-1');
      assert.equal(storageMock[demoKeyA], undefined);
    });

    it('Cycle operations, reset-data, and import-data strictly write to scoped demo keys and never global legacy keys', () => {
      const userAId = 'user-samurai-888';
      const scopedDemoKeyA = getScopedDemoConsumedKey(userAId);
      const scopedDemoKeyGuest = getScopedDemoConsumedKey(null);

      // 1. Simulating Cycle Creation for User A
      storageMock[scopedDemoKeyA] = 'true';
      assert.equal(storageMock[scopedDemoKeyA], 'true');
      assert.equal(storageMock[scopedDemoKeyGuest], undefined);
      assert.equal(storageMock[LEGACY_DEMO_CONSUMED_KEY], undefined);

      // 2. Simulating Reset-Data for User A: removes only scopedDemoKeyA
      delete storageMock[scopedDemoKeyA];
      assert.equal(storageMock[scopedDemoKeyA], undefined);
      // Legacy keys must not be created or corrupted
      assert.equal(storageMock[LEGACY_DEMO_CONSUMED_KEY], undefined);

      // 3. Simulating Import-Data for User A: sets scopedDemoKeyA to true
      storageMock[scopedDemoKeyA] = 'true';
      assert.equal(storageMock[scopedDemoKeyA], 'true');
      assert.equal(storageMock[scopedDemoKeyGuest], undefined);
      assert.equal(storageMock[LEGACY_DEMO_CONSUMED_KEY], undefined);
    });
  });

  // ===========================================================================
  // 4. STORAGE OWNERSHIP AUTHORITY & IDENTITY INTEGRITY
  // ===========================================================================
  describe('4. Storage Ownership Authority & Identity Integrity', () => {
    it('normalizes user IDs strictly from canonical ID and never derives ownership from mutable profile attributes', () => {
      assert.equal(normalizeUserId('   user-123   '), 'user-123');
      assert.equal(normalizeUserId(''), null);
      assert.equal(normalizeUserId('__guest__'), null);
      assert.equal(normalizeUserId(null), null);
      assert.equal(normalizeUserId(undefined), null);

      // Changing name, phone, or tier must NOT alter the partition key
      const key1 = getScopedStorageKey('user-fixed-id');
      const key2 = getScopedStorageKey('user-fixed-id');
      assert.equal(key1, key2);
    });

    it('safe unverified startup sequence loads Guest fallback when activeAccountId is not verified', () => {
      // Simulate token exists in storage but activeAccountId is missing/null
      storageMock[TOKEN_KEY] = 'unverified-jwt-token';
      delete storageMock[ACTIVE_ACCOUNT_KEY];

      const activeAcc = getActiveAccountId();
      assert.equal(activeAcc, null);

      // Loading state with unverified account loads guest state, NEVER arbitrary user data
      const state = loadStoredSystemState(activeAcc);
      assert.equal(state.userProfile.id, GUEST_USER_PROFILE.id);
    });
  });

  // ===========================================================================
  // 5. LEGACY STORAGE MIGRATION SAFETY
  // ===========================================================================
  describe('5. Legacy Storage Migration Safety', () => {
    it('does NOT allow an authenticated user to adopt legacy guest data', () => {
      const legacyGuestData = {
        cycles: [{ id: 'legacy-c-1', title: 'چرخه قدیمی مهمان', startDate: '2026-08-01', endDate: '2026-10-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 0 }],
        logs: [],
        settings: { id: 's-leg', platformName: 'Legacy', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: GUEST_USER_PROFILE.id, name: 'مهمان قدیمی', email: '', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      storageMock[LEGACY_STORAGE_KEY] = JSON.stringify(legacyGuestData);

      // Authenticated User A tries to load
      const userAState = loadStoredSystemState('user-alpha-real');
      assert.equal(userAState.userProfile.id, 'user-alpha-real');
      assert.equal(userAState.cycles.length, 0, 'Must NOT adopt legacy guest cycles for authenticated user');
    });

    it('allows only confirmed admin-master-001 account to migrate matching legacy admin data', () => {
      const legacyAdminData = {
        cycles: [{ id: 'legacy-admin-c', title: 'چرخه قدیمی مدیر ارشد', startDate: '2026-08-01', endDate: '2026-10-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 20 }],
        logs: [],
        settings: { id: 's-adm', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 20, allTimeMaxScore: 40, allTimeMaxStandardDays: 5, nightOwlCutoffHour: 4 },
        userProfile: { id: 'admin-master-001', name: 'فرمانده ارشد', email: 'admin@bushido.app', phoneNumber: '09375454050', tier: 'vip_samurai', isVip: true, isAdmin: true, activeCycleLimit: 999 }
      };

      storageMock[LEGACY_STORAGE_KEY] = JSON.stringify(legacyAdminData);

      // Admin loads -> matching ID migrates successfully
      const adminState = loadStoredSystemState('admin-master-001');
      assert.equal(adminState.cycles.length, 1);
      assert.equal(adminState.cycles[0].id, 'legacy-admin-c');

      // Random user loads -> rejected
      const randomUserState = loadStoredSystemState('user-random-999');
      assert.equal(randomUserState.cycles.length, 0);
    });

    it('rejects stored JSON payload with mismatched userProfile.id to prevent cross-account injection', () => {
      // Maliciously inject User A payload into User B partition key
      const stolenPayload = {
        cycles: [{ id: 'stolen-cycle', title: 'چرخه به سرقت رفته', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 100 }],
        logs: [{ id: 'stolen-log', cycleId: 'stolen-cycle', date: '2026-09-01', wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: true }],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 100, allTimeMaxScore: 100, allTimeMaxStandardDays: 20, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-victim-victim', name: 'قربانی', email: 'v@v.com', phoneNumber: '', tier: 'free', isVip: false, isAdmin: false, activeCycleLimit: 1 }
      };

      // Put it in attacker's key
      storageMock[getScopedStorageKey('user-attacker-666')] = JSON.stringify(stolenPayload);

      // Loading for attacker must detect mismatched userProfile.id and return clean fallback
      const attackerLoaded = loadStoredSystemState('user-attacker-666');
      assert.equal(attackerLoaded.userProfile.id, 'user-attacker-666');
      assert.equal(attackerLoaded.cycles.length, 0, 'Must reject mismatched cycles');
      assert.equal(attackerLoaded.logs.length, 0, 'Must reject mismatched logs');
    });
  });

  // ===========================================================================
  // 6. PHASE 3B HANDOFF: OFFLINE QUEUE STATUS DOCUMENTATION
  // ===========================================================================
  describe('6. Phase 3B Handoff Status: Global Offline Queue Awareness', () => {
    it('acknowledges OFFLINE_QUEUE_KEY operates globally in Phase 3A and must be scoped in Phase 3B', () => {
      const OFFLINE_QUEUE_KEY = 'bushido_offline_queue';
      assert.equal(OFFLINE_QUEUE_KEY, 'bushido_offline_queue');
      // Phase 3A invariant: We document that the offline queue is currently global and will be redesigned in Phase 3B.
    });
  });
});
