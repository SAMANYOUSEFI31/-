import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  normalizePathname, 
  resolveTabFromPath, 
  getPathForTab,
  shouldPushTab,
  RouterHistoryState
} from '../src/utils/routerUtils.js';

describe('Client Router: Phase R1A Route Resolution & History Invariants', () => {
  describe('1. Path Normalization', () => {
    it('normalizes empty or root path to /', () => {
      assert.equal(normalizePathname(''), '/');
      assert.equal(normalizePathname('/'), '/');
      assert.equal(normalizePathname('///'), '/');
    });

    it('strips query parameters and hash fragments', () => {
      assert.equal(normalizePathname('/dashboard?tab=cycle&date=1403'), '/dashboard');
      assert.equal(normalizePathname('/more#section-account'), '/more');
      assert.equal(normalizePathname('/battlefield?foo=bar#hash'), '/battlefield');
    });

    it('collapses trailing slashes and lowercases paths', () => {
      assert.equal(normalizePathname('/Dashboard/'), '/dashboard');
      assert.equal(normalizePathname('/MORE///'), '/more');
      assert.equal(normalizePathname('/ARCHIVES/'), '/archives');
    });
  });

  describe('2. Canonical Route Resolution', () => {
    it('resolves / and /battlefield to battlefield shell as known routes', () => {
      const rootRes = resolveTabFromPath('/');
      assert.equal(rootRes.tab, 'battlefield');
      assert.equal(rootRes.canonicalPath, '/');
      assert.equal(rootRes.isKnown, true);

      const battlefieldRes = resolveTabFromPath('/battlefield');
      assert.equal(battlefieldRes.tab, 'battlefield');
      assert.equal(battlefieldRes.canonicalPath, '/battlefield');
      assert.equal(battlefieldRes.isKnown, true);
    });

    it('resolves /dashboard and /cycle to dashboard shell', () => {
      const dashRes = resolveTabFromPath('/dashboard');
      assert.equal(dashRes.tab, 'dashboard');
      assert.equal(dashRes.canonicalPath, '/dashboard');
      assert.equal(dashRes.isKnown, true);

      const cycleRes = resolveTabFromPath('/cycle');
      assert.equal(cycleRes.tab, 'dashboard');
      assert.equal(cycleRes.canonicalPath, '/dashboard');
      assert.equal(cycleRes.isKnown, true);
    });

    it('resolves /more, /profile, and /settings to profile shell', () => {
      const moreRes = resolveTabFromPath('/more');
      assert.equal(moreRes.tab, 'profile');
      assert.equal(moreRes.canonicalPath, '/more');
      assert.equal(moreRes.isKnown, true);

      const profileRes = resolveTabFromPath('/profile');
      assert.equal(profileRes.tab, 'profile');
      assert.equal(profileRes.canonicalPath, '/more');
      assert.equal(profileRes.isKnown, true);

      const settingsRes = resolveTabFromPath('/settings');
      assert.equal(settingsRes.tab, 'profile');
      assert.equal(settingsRes.canonicalPath, '/more');
      assert.equal(settingsRes.isKnown, true);
    });

    it('resolves /archives, /more/archives, and legacy ledger paths to archives shell', () => {
      const archivesRes = resolveTabFromPath('/archives');
      assert.equal(archivesRes.tab, 'archives');
      assert.equal(archivesRes.canonicalPath, '/archives');
      assert.equal(archivesRes.isKnown, true);

      const nestedArchivesRes = resolveTabFromPath('/more/archives');
      assert.equal(nestedArchivesRes.tab, 'archives');
      assert.equal(nestedArchivesRes.canonicalPath, '/archives');
      assert.equal(nestedArchivesRes.isKnown, true);

      const dbRes = resolveTabFromPath('/database');
      assert.equal(dbRes.tab, 'archives');
      assert.equal(dbRes.canonicalPath, '/archives');
      assert.equal(dbRes.isKnown, true);

      const courtRes = resolveTabFromPath('/court');
      assert.equal(courtRes.tab, 'archives');
      assert.equal(courtRes.canonicalPath, '/archives');
      assert.equal(courtRes.isKnown, true);
    });

    it('resolves /admin to admin panel shell', () => {
      const adminRes = resolveTabFromPath('/admin');
      assert.equal(adminRes.tab, 'admin');
      assert.equal(adminRes.canonicalPath, '/admin');
      assert.equal(adminRes.isKnown, true);
    });

    it('identifies unknown paths as isKnown: false and defaults tab to battlefield', () => {
      const unknownRes = resolveTabFromPath('/some-nonexistent-path');
      assert.equal(unknownRes.tab, 'battlefield');
      assert.equal(unknownRes.canonicalPath, '/battlefield');
      assert.equal(unknownRes.isKnown, false);

      const unknownDeepRes = resolveTabFromPath('/dashboard/unknown/sub');
      assert.equal(unknownDeepRes.tab, 'battlefield');
      assert.equal(unknownDeepRes.canonicalPath, '/battlefield');
      assert.equal(unknownDeepRes.isKnown, false);
    });
  });

  describe('3. Tab to Canonical Path Mapping', () => {
    it('returns canonical paths for all main tabs', () => {
      assert.equal(getPathForTab('battlefield'), '/battlefield');
      assert.equal(getPathForTab('dashboard'), '/dashboard');
      assert.equal(getPathForTab('cycle'), '/dashboard');
      assert.equal(getPathForTab('profile'), '/more');
      assert.equal(getPathForTab('settings'), '/more');
      assert.equal(getPathForTab('more'), '/more');
      assert.equal(getPathForTab('archives'), '/archives');
      assert.equal(getPathForTab('database'), '/archives');
      assert.equal(getPathForTab('court'), '/archives');
      assert.equal(getPathForTab('admin'), '/admin');
      assert.equal(getPathForTab('unknown'), '/battlefield');
    });
  });

  describe('4. Phase R1B: Back Stack Navigation & History Push Invariants', () => {
    it('shouldPushTab returns true when navigating across distinct tabs', () => {
      assert.equal(shouldPushTab('/', 'dashboard'), true);
      assert.equal(shouldPushTab('/battlefield', 'dashboard'), true);
      assert.equal(shouldPushTab('/dashboard', 'profile'), true);
      assert.equal(shouldPushTab('/more', 'archives'), true);
      assert.equal(shouldPushTab('/archives', 'admin'), true);
      assert.equal(shouldPushTab('/admin', 'battlefield'), true);
    });

    it('shouldPushTab returns false when re-clicking the currently active tab or alias', () => {
      // Battlefield variations
      assert.equal(shouldPushTab('/', 'battlefield'), false);
      assert.equal(shouldPushTab('/battlefield', 'battlefield'), false);

      // Dashboard variations
      assert.equal(shouldPushTab('/dashboard', 'dashboard'), false);
      assert.equal(shouldPushTab('/cycle', 'dashboard'), false);
      assert.equal(shouldPushTab('/dashboard', 'cycle'), false);

      // More / Profile variations
      assert.equal(shouldPushTab('/more', 'profile'), false);
      assert.equal(shouldPushTab('/profile', 'more'), false);
      assert.equal(shouldPushTab('/settings', 'profile'), false);

      // Archives variations
      assert.equal(shouldPushTab('/archives', 'archives'), false);
      assert.equal(shouldPushTab('/more/archives', 'archives'), false);
      assert.equal(shouldPushTab('/database', 'archives'), false);
    });

    it('simulates in-app history stack for Battlefield -> Dashboard -> More -> Back -> Back', () => {
      interface HistoryEntry {
        path: string;
        state: RouterHistoryState;
      }
      const historyStack: HistoryEntry[] = [];
      let currentIndex = -1;

      const push = (tab: string) => {
        const path = getPathForTab(tab);
        const state: RouterHistoryState = { tab, inApp: true };
        // If we navigated back and then push, discard forward history
        historyStack.splice(currentIndex + 1);
        historyStack.push({ path, state });
        currentIndex = historyStack.length - 1;
      };

      const replace = (tab: string, path: string) => {
        const state: RouterHistoryState = { tab, inApp: true };
        if (historyStack.length === 0) {
          historyStack.push({ path, state });
          currentIndex = 0;
        } else {
          historyStack[currentIndex] = { path, state };
        }
      };

      // 1. Initial page load at / (Battlefield) uses replaceState
      replace('battlefield', '/');
      assert.equal(historyStack.length, 1);
      assert.equal(historyStack[currentIndex].path, '/');
      assert.equal(historyStack[currentIndex].state.tab, 'battlefield');

      // 2. User clicks Dashboard: uses pushState
      assert.equal(shouldPushTab(historyStack[currentIndex].path, 'dashboard'), true);
      push('dashboard');
      assert.equal(historyStack.length, 2);
      assert.equal(currentIndex, 1);
      assert.equal(historyStack[currentIndex].path, '/dashboard');
      assert.equal(historyStack[currentIndex].state.tab, 'dashboard');

      // 3. User clicks More: uses pushState
      assert.equal(shouldPushTab(historyStack[currentIndex].path, 'profile'), true);
      push('profile');
      assert.equal(historyStack.length, 3);
      assert.equal(currentIndex, 2);
      assert.equal(historyStack[currentIndex].path, '/more');
      assert.equal(historyStack[currentIndex].state.tab, 'profile');

      // 4. User presses browser Back: pops to Dashboard
      currentIndex -= 1;
      const backEntry1 = historyStack[currentIndex];
      const resolvedBack1 = resolveTabFromPath(backEntry1.path);
      assert.equal(resolvedBack1.tab, 'dashboard');
      assert.equal(backEntry1.path, '/dashboard');

      // 5. User presses browser Back again: pops to Battlefield
      currentIndex -= 1;
      const backEntry2 = historyStack[currentIndex];
      const resolvedBack2 = resolveTabFromPath(backEntry2.path);
      assert.equal(resolvedBack2.tab, 'battlefield');
      assert.equal(backEntry2.path, '/');

      // 6. User presses browser Back a 3rd time: stack has no prior in-app entry
      const canGoBackInApp = currentIndex > 0;
      assert.equal(canGoBackInApp, false, 'Should allow browser default leave without trapping');
    });

    it('simulates deep link to /dashboard: Back once leaves without trapping', () => {
      interface HistoryEntry {
        path: string;
        state: RouterHistoryState;
      }
      const historyStack: HistoryEntry[] = [];
      let currentIndex = -1;

      const replace = (tab: string, path: string) => {
        const state: RouterHistoryState = { tab, inApp: true };
        if (historyStack.length === 0) {
          historyStack.push({ path, state });
          currentIndex = 0;
        } else {
          historyStack[currentIndex] = { path, state };
        }
      };

      // 1. Initial deep link to /dashboard uses replaceState
      const resolved = resolveTabFromPath('/dashboard');
      assert.equal(resolved.tab, 'dashboard');
      replace(resolved.tab, resolved.canonicalPath);

      // Stack length is 1
      assert.equal(historyStack.length, 1);
      assert.equal(currentIndex, 0);

      // Pressing back once means there are no prior in-app entries
      const canGoBackInApp = currentIndex > 0;
      assert.equal(canGoBackInApp, false, 'Deep link Back once leaves the app or goes to prior external page');
    });
  });
});
