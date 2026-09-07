import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as storageUtils from '../src/utils/storageUtils.js';
import {
  loadStoredSystemState,
  writeStateDirect,
  sanitizeSystemState,
  buildExportPayload,
  getScopedStorageKey,
  resetAccountState
} from '../src/utils/storageUtils.js';
import { GUEST_USER_PROFILE, createInitialSystemState } from '../src/data/initialData.js';
import { SystemState, UserProfile } from '../src/types.js';

describe('Phase 6.3A: Data Integrity Hardening & JSON Import Removal', () => {
  const storageMock: Record<string, string> = {};

  beforeEach(() => {
    for (const k in storageMock) delete storageMock[k];

    if (typeof globalThis.window === 'undefined') {
      (globalThis as any).window = {
        localStorage: {
          getItem: (key: string) => storageMock[key] ?? null,
          setItem: (key: string, val: string) => { storageMock[key] = String(val); },
          removeItem: (key: string) => { delete storageMock[key]; },
          clear: () => { for (const k in storageMock) delete storageMock[k]; }
        },
        sessionStorage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
          clear: () => {}
        }
      };
      (globalThis as any).localStorage = (globalThis as any).window.localStorage;
    }
  });

  // ===========================================================================
  // 1. IMPORT REMOVAL & CONTRACT ENFORCEMENT
  // ===========================================================================
  describe('1. Import Mechanism Removal & Static Surface Verification', () => {
    it('1. storageUtils no longer exposes importAccountState', () => {
      assert.equal((storageUtils as any).importAccountState, undefined);
    });

    it('2. App.tsx no longer contains handleImportData or importAccountState', () => {
      const appContent = fs.readFileSync(path.resolve(process.cwd(), 'src/App.tsx'), 'utf-8');
      assert.ok(!appContent.includes('importAccountState'), 'App.tsx should not import importAccountState');
      assert.ok(!appContent.includes('handleImportData'), 'App.tsx should not contain handleImportData');
    });

    it('3. ProfileSettingsView and DatabaseView no longer expose onImportData or import callbacks', () => {
      const profileSettingsContent = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/ProfileSettingsView.tsx'),
        'utf-8'
      );
      assert.ok(!profileSettingsContent.includes('onImportData'), 'ProfileSettingsView should not have onImportData');
      assert.ok(!profileSettingsContent.includes('handleFileChange'), 'ProfileSettingsView should not have file reader');

      const databaseViewContent = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/DatabaseView.tsx'),
        'utf-8'
      );
      assert.ok(!databaseViewContent.includes('onImportData'), 'DatabaseView should not have onImportData');
      assert.ok(!databaseViewContent.includes('handleFileImport'), 'DatabaseView should not have handleFileImport');
    });

    it('4. No file input for JSON restoration remains in settings or database views', () => {
      const profileSettingsContent = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/ProfileSettingsView.tsx'),
        'utf-8'
      );
      assert.ok(!profileSettingsContent.includes('accept=".json"'), 'ProfileSettingsView should not have .json file input');

      const databaseViewContent = fs.readFileSync(
        path.resolve(process.cwd(), 'src/components/DatabaseView.tsx'),
        'utf-8'
      );
      assert.ok(!databaseViewContent.includes('accept=".json"'), 'DatabaseView should not have .json file input');
    });
  });

  // ===========================================================================
  // 2. EXPORT FUNCTIONALITY & PRIVACY FILTERING
  // ===========================================================================
  describe('2. Narrowed Export DTO & Privacy Enforcement', () => {
    const mockFullSystemState: SystemState = {
      cycles: [
        {
          id: 'cycle-1',
          title: 'چرخه ۱',
          startDate: '2026-09-01',
          endDate: '2026-11-29',
          targetTheme: 'amber',
          isArchived: false,
          reportRead: false,
          inheritedStreak: 10
        }
      ],
      logs: [
        {
          id: 'log-1',
          cycleId: 'cycle-1',
          date: '2026-09-01',
          wakeUp: true,
          workout: true,
          study: true,
          journal: true,
          hardTask: true,
          specialMission: false
        }
      ],
      settings: {
        id: 'settings-1',
        platformName: 'Bushido OS',
        centralEngineName: 'Bushido Engine',
        allTimeMaxStreak: 10,
        allTimeMaxScore: 10,
        allTimeMaxStandardDays: 1,
        nightOwlCutoffHour: 4
      },
      userProfile: {
        id: 'user-vip-admin-1',
        name: 'فرمانده سامورایی',
        email: 'commander@bushido.io',
        phoneNumber: '+989123456789',
        tier: 'vip_samurai',
        isVip: true,
        isAdmin: true,
        activeCycleLimit: 3,
        paymentRefId: 'PAY-SECRET-998877',
        vipSince: '2026-01-01',
        vipExpiresAt: '2027-01-01',
        accentTheme: 'crimson',
        nightOwlCutoffHour: 2
      }
    };

    it('5. Export behavior remains available via buildExportPayload', () => {
      assert.equal(typeof buildExportPayload, 'function');
      const exportDto = buildExportPayload(mockFullSystemState);
      assert.ok(exportDto);
      assert.ok(exportDto.exportedAt);
    });

    it('6. Export output includes Cycles, DailyLogs, and user-owned Settings', () => {
      const exportDto = buildExportPayload(mockFullSystemState);
      assert.equal(exportDto.cycles.length, 1);
      assert.equal(exportDto.cycles[0].id, 'cycle-1');
      assert.equal(exportDto.logs.length, 1);
      assert.equal(exportDto.logs[0].id, 'log-1');
      assert.equal(exportDto.settings.allTimeMaxStreak, 10);
      assert.equal(exportDto.settings.nightOwlCutoffHour, 4);
    });

    it('7. Export output does NOT include isAdmin', () => {
      const exportDto = buildExportPayload(mockFullSystemState);
      assert.equal((exportDto.userProfile as any).isAdmin, undefined);
    });

    it('8. Export output does NOT include tokenVersion or internal tokens', () => {
      const exportDto = buildExportPayload(mockFullSystemState);
      assert.equal((exportDto.userProfile as any).tokenVersion, undefined);
      assert.equal((exportDto as any).token, undefined);
      assert.equal((exportDto as any).authToken, undefined);
    });

    it('9. Export output does NOT include paymentRefId, vipSince, or vipExpiresAt', () => {
      const exportDto = buildExportPayload(mockFullSystemState);
      assert.equal((exportDto.userProfile as any).paymentRefId, undefined);
      assert.equal((exportDto.userProfile as any).vipSince, undefined);
      assert.equal((exportDto.userProfile as any).vipExpiresAt, undefined);
      assert.equal((exportDto.userProfile as any).email, undefined);
      assert.equal((exportDto.userProfile as any).phoneNumber, undefined);
    });

    it('10. Export output does NOT include offline queue, quarantine, or impersonation metadata', () => {
      const exportDto = buildExportPayload(mockFullSystemState);
      assert.equal((exportDto as any).offlineQueue, undefined);
      assert.equal((exportDto as any).quarantine, undefined);
      assert.equal((exportDto as any).impersonatorToken, undefined);
      assert.equal((exportDto as any).impersonatingUser, undefined);
    });
  });

  // ===========================================================================
  // 3. TAMPERED LOCAL STORAGE HYDRATION PROTECTION
  // ===========================================================================
  describe('3. Client Hydration Security & Storage Protection Policy', () => {
    const trustedAuthUser: UserProfile = {
      id: 'auth-user-normal',
      name: 'کاربر عادی',
      email: 'user@bushido.io',
      phoneNumber: '+989111111111',
      tier: 'free',
      isVip: false,
      isAdmin: false,
      activeCycleLimit: 1
    };

    it('11. Tampered authenticated Local Storage cannot elevate isAdmin', () => {
      const tamperedStorage = {
        cycles: [],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: {
          id: 'auth-user-normal',
          name: 'کاربر هکر',
          isAdmin: true
        }
      };

      storageMock[getScopedStorageKey('auth-user-normal')] = JSON.stringify(tamperedStorage);
      const loaded = loadStoredSystemState('auth-user-normal');

      assert.equal(loaded.userProfile.isAdmin, false);
    });

    it('12. Tampered authenticated Local Storage cannot elevate isVip', () => {
      const tamperedStorage = {
        cycles: [],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: {
          id: 'auth-user-normal',
          name: 'کاربر هکر',
          isVip: true,
          vipExpiresAt: '2099-01-01'
        }
      };

      storageMock[getScopedStorageKey('auth-user-normal')] = JSON.stringify(tamperedStorage);
      const loaded = loadStoredSystemState('auth-user-normal');

      assert.equal(loaded.userProfile.isVip, false);
      assert.equal(loaded.userProfile.vipExpiresAt, undefined);
    });

    it('13. Tampered stored Tier and activeCycleLimit do not replace trusted baseline values', () => {
      const tamperedStorage = {
        cycles: [],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: {
          id: 'auth-user-normal',
          name: 'کاربر هکر',
          tier: 'vip_samurai',
          activeCycleLimit: 99
        }
      };

      storageMock[getScopedStorageKey('auth-user-normal')] = JSON.stringify(tamperedStorage);
      const loaded = loadStoredSystemState('auth-user-normal');

      assert.equal(loaded.userProfile.tier, 'free');
      assert.equal(loaded.userProfile.activeCycleLimit, 1);
    });

    it('14. Tampered payment, tokenVersion, email and phone fields are ignored', () => {
      const tamperedStorage = {
        cycles: [],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: {
          id: 'auth-user-normal',
          name: 'کاربر هکر',
          paymentRefId: 'FORGED_REF_ID',
          tokenVersion: 999,
          email: 'injected@hacker.io',
          phoneNumber: '+989000000000'
        }
      };

      storageMock[getScopedStorageKey('auth-user-normal')] = JSON.stringify(tamperedStorage);
      const loaded = loadStoredSystemState('auth-user-normal');

      assert.equal(loaded.userProfile.paymentRefId, undefined);
      assert.equal((loaded.userProfile as any).tokenVersion, undefined);
      assert.equal(loaded.userProfile.email, '');
      assert.equal(loaded.userProfile.phoneNumber, '');
      assert.notEqual(loaded.userProfile.email, 'injected@hacker.io');
      assert.notEqual(loaded.userProfile.phoneNumber, '+989000000000');
    });

    it('15. Tampered Guest storage cannot create Admin, VIP, or paid tier state', () => {
      const tamperedGuestStorage = {
        cycles: [],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: {
          id: '',
          name: 'مهمان متقلب',
          isAdmin: true,
          isVip: true,
          tier: 'vip_samurai',
          activeCycleLimit: 10,
          paymentRefId: 'FAKE_PAYMENT'
        }
      };

      storageMock[getScopedStorageKey(null)] = JSON.stringify(tamperedGuestStorage);
      const loaded = loadStoredSystemState(null);

      assert.equal(loaded.userProfile.isAdmin, false);
      assert.equal(loaded.userProfile.isVip, false);
      assert.equal(loaded.userProfile.tier, 'free');
      assert.equal(loaded.userProfile.activeCycleLimit, 1);
      assert.equal(loaded.userProfile.paymentRefId, undefined);
    });

    it('16. Explicitly allowed local Profile preferences (name, accentTheme, nightOwlCutoffHour) restore correctly', () => {
      const validCustomPreferences = {
        cycles: [],
        logs: [],
        settings: { id: 's', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 0, allTimeMaxScore: 0, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: {
          id: 'auth-user-normal',
          name: 'سهراب سامورایی',
          accentTheme: 'emerald',
          nightOwlCutoffHour: 3
        }
      };

      storageMock[getScopedStorageKey('auth-user-normal')] = JSON.stringify(validCustomPreferences);
      const loaded = loadStoredSystemState('auth-user-normal');

      assert.equal(loaded.userProfile.name, 'سهراب سامورایی');
      assert.equal(loaded.userProfile.accentTheme, 'emerald');
      assert.equal(loaded.userProfile.nightOwlCutoffHour, 3);
    });

    it('17. Account-scoped ownership remains unchanged and partition-isolated', () => {
      const userAKey = getScopedStorageKey('user-a');
      const userBKey = getScopedStorageKey('user-b');

      storageMock[userAKey] = JSON.stringify({
        cycles: [{ id: 'c-a', title: 'چرخه A', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'amber', isArchived: false, reportRead: false, inheritedStreak: 1 }],
        logs: [],
        settings: { id: 's-a', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 1, allTimeMaxScore: 1, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-a', name: 'کاربر A' }
      });

      storageMock[userBKey] = JSON.stringify({
        cycles: [{ id: 'c-b', title: 'چرخه B', startDate: '2026-09-01', endDate: '2026-11-29', targetTheme: 'crimson', isArchived: false, reportRead: false, inheritedStreak: 2 }],
        logs: [],
        settings: { id: 's-b', platformName: 'OS', centralEngineName: 'E', allTimeMaxStreak: 2, allTimeMaxScore: 2, allTimeMaxStandardDays: 0, nightOwlCutoffHour: 4 },
        userProfile: { id: 'user-b', name: 'کاربر B' }
      });

      const loadedA = loadStoredSystemState('user-a');
      const loadedB = loadStoredSystemState('user-b');

      assert.equal(loadedA.cycles[0].id, 'c-a');
      assert.equal(loadedB.cycles[0].id, 'c-b');
      assert.equal(loadedA.userProfile.id, 'user-a');
      assert.equal(loadedB.userProfile.id, 'user-b');
    });

    it('18. Existing Export and Reset behavior remains functional', () => {
      const sampleUser: UserProfile = {
        id: 'user-test-reset',
        name: 'کاربر تست',
        email: 'test@bushido.io',
        phoneNumber: '',
        tier: 'free',
        isVip: false,
        isAdmin: false,
        activeCycleLimit: 1
      };

      const { freshState, activeCycleId } = resetAccountState(sampleUser);
      assert.ok(freshState);
      assert.ok(activeCycleId);
      assert.equal(freshState.userProfile.id, 'user-test-reset');
      assert.equal(freshState.cycles.length, 1);

      const exported = buildExportPayload(freshState);
      assert.equal(exported.cycles.length, 1);
      assert.equal(exported.userProfile.name, 'کاربر تست');
    });
  });
});
