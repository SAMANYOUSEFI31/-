import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
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

  describe('5. Phase R1C: PWA Manifest & Routing Closure Invariants', () => {
    const manifestPath = path.resolve(process.cwd(), 'public/manifest.json');
    const manifestContent = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    it('manifest start_url is / (or /battlefield), matching the default application route', () => {
      assert.ok(
        manifestContent.start_url === '/' || manifestContent.start_url === '/battlefield',
        `start_url must be / or /battlefield, got ${manifestContent.start_url}`
      );
      const resolved = resolveTabFromPath(manifestContent.start_url);
      assert.equal(resolved.tab, 'battlefield');
      assert.equal(resolved.isKnown, true);
    });

    it('all PWA shortcuts point to real canonical paths without query param fragments', () => {
      assert.ok(Array.isArray(manifestContent.shortcuts), 'shortcuts must be an array');
      assert.ok(manifestContent.shortcuts.length >= 2, 'manifest must declare at least 2 shortcuts');

      const urls = manifestContent.shortcuts.map((s: { url: string }) => s.url);

      // Verify no shortcut uses old query string pattern like ?tab=...
      for (const url of urls) {
        assert.ok(!url.includes('?tab='), `Shortcut URL ${url} must not use query parameter pattern`);
        assert.ok(url.startsWith('/'), `Shortcut URL ${url} must be an absolute path starting with /`);

        // Every shortcut URL must resolve cleanly to a known tab
        const resolved = resolveTabFromPath(url);
        assert.equal(resolved.isKnown, true, `Shortcut ${url} must resolve to a known tab`);
      }

      // Explicitly check that / and /dashboard are among the shortcuts
      assert.ok(urls.includes('/') || urls.includes('/battlefield'), 'Must include root or battlefield shortcut');
      assert.ok(urls.includes('/dashboard'), 'Must include real /dashboard shortcut');
    });

    it('Navbar component adheres to router navigation without full page reloads', () => {
      const navbarFile = path.resolve(process.cwd(), 'src/shared/components/layout/Navbar.tsx');
      const navbarContent = fs.readFileSync(navbarFile, 'utf8');

      // Brand mark is an interactive button that triggers handleTabClick('battlefield')
      assert.ok(
        navbarContent.includes("onClick={() => handleTabClick('battlefield')}"),
        'Brand button must navigate to battlefield via handleTabClick'
      );

      // Desktop and mobile navigation tabs trigger handleTabClick
      assert.ok(
        navbarContent.includes('onClick={() => handleTabClick(tab.id)}'),
        'Tab buttons must trigger handleTabClick without page reload'
      );

      // handleTabClick uses onSelectTab and avoids reload
      assert.ok(
        navbarContent.includes('onSelectTab(tabId)'),
        'handleTabClick must delegate to onSelectTab router handler'
      );

      // No raw <a href links for internal tab navigation
      assert.ok(
        !navbarContent.includes('<a href="/dashboard"'),
        'Navbar must not use hard anchor navigation for /dashboard'
      );
      assert.ok(
        !navbarContent.includes('<a href="/battlefield"'),
        'Navbar must not use hard anchor navigation for /battlefield'
      );
    });
  });

  describe('5. Battlefield / Dashboard / More Path Mapping & PWA Back Loop Invariants', () => {
    it('enforces strict canonical mapping for core tabs: battlefield, dashboard, more', () => {
      // Direct tab to canonical path
      assert.equal(getPathForTab('battlefield'), '/battlefield');
      assert.equal(getPathForTab('dashboard'), '/dashboard');
      assert.equal(getPathForTab('more'), '/more');

      // Canonical aliases
      assert.equal(getPathForTab('cycle'), '/dashboard');
      assert.equal(getPathForTab('profile'), '/more');
      assert.equal(getPathForTab('settings'), '/more');

      // Direct path to tab resolution
      const bRes = resolveTabFromPath('/battlefield');
      assert.equal(bRes.tab, 'battlefield');
      assert.equal(bRes.canonicalPath, '/battlefield');
      assert.equal(bRes.isKnown, true);

      const dRes = resolveTabFromPath('/dashboard');
      assert.equal(dRes.tab, 'dashboard');
      assert.equal(dRes.canonicalPath, '/dashboard');
      assert.equal(dRes.isKnown, true);

      const mRes = resolveTabFromPath('/more');
      assert.equal(mRes.tab, 'profile');
      assert.equal(mRes.canonicalPath, '/more');
      assert.equal(mRes.isKnown, true);
    });

    it('canonicalizes query params, hashes, trailing slashes, and uppercase variations for core tabs', () => {
      const bDirty = resolveTabFromPath('/BATTLEFIELD/?mode=focus#today');
      assert.equal(bDirty.tab, 'battlefield');
      assert.equal(bDirty.canonicalPath, '/battlefield');
      assert.equal(bDirty.isKnown, true);

      const dDirty = resolveTabFromPath('/DASHBOARD///?chart=spline#kpi');
      assert.equal(dDirty.tab, 'dashboard');
      assert.equal(dDirty.canonicalPath, '/dashboard');
      assert.equal(dDirty.isKnown, true);

      const mDirty = resolveTabFromPath('/MORE/?theme=dark#settings');
      assert.equal(mDirty.tab, 'profile');
      assert.equal(mDirty.canonicalPath, '/more');
      assert.equal(mDirty.isKnown, true);
    });

    it('shouldPushTab correctly distinguishes transitions across battlefield, dashboard, and more', () => {
      // Transitions between different tabs push history
      assert.equal(shouldPushTab('/battlefield', 'dashboard'), true);
      assert.equal(shouldPushTab('/dashboard', 'profile'), true);
      assert.equal(shouldPushTab('/more', 'battlefield'), true);
      assert.equal(shouldPushTab('/more', 'dashboard'), true);
      assert.equal(shouldPushTab('/dashboard', 'battlefield'), true);

      // Re-clicking active tab or alias does NOT push history
      assert.equal(shouldPushTab('/battlefield', 'battlefield'), false);
      assert.equal(shouldPushTab('/', 'battlefield'), false);
      assert.equal(shouldPushTab('/dashboard', 'dashboard'), false);
      assert.equal(shouldPushTab('/dashboard', 'cycle'), false);
      assert.equal(shouldPushTab('/more', 'more'), false);
      assert.equal(shouldPushTab('/more', 'profile'), false);
      assert.equal(shouldPushTab('/more', 'settings'), false);
    });

    it('simulates full bi-directional browser history traversal across battlefield -> dashboard -> more', () => {
      const stack: { path: string; tab: string }[] = [];
      let pointer = -1;

      const navigate = (tab: string) => {
        const currentPath = pointer >= 0 ? stack[pointer].path : '';
        if (shouldPushTab(currentPath, tab)) {
          pointer++;
          stack.splice(pointer);
          stack.push({ path: getPathForTab(tab), tab });
        }
      };

      // Step 1: initial load at battlefield
      pointer = 0;
      stack.push({ path: '/battlefield', tab: 'battlefield' });
      assert.equal(resolveTabFromPath(stack[pointer].path).tab, 'battlefield');

      // Step 2: navigate to dashboard
      navigate('dashboard');
      assert.equal(pointer, 1);
      assert.equal(stack[pointer].path, '/dashboard');
      assert.equal(resolveTabFromPath(stack[pointer].path).tab, 'dashboard');

      // Step 3: navigate to more
      navigate('profile');
      assert.equal(pointer, 2);
      assert.equal(stack[pointer].path, '/more');
      assert.equal(resolveTabFromPath(stack[pointer].path).tab, 'profile');

      // Step 4: press Back button in browser (popstate to dashboard)
      pointer--;
      assert.equal(pointer, 1);
      const back1 = resolveTabFromPath(stack[pointer].path);
      assert.equal(back1.tab, 'dashboard');
      assert.equal(back1.canonicalPath, '/dashboard');

      // Step 5: press Back button again (popstate to battlefield)
      pointer--;
      assert.equal(pointer, 0);
      const back2 = resolveTabFromPath(stack[pointer].path);
      assert.equal(back2.tab, 'battlefield');
      assert.equal(back2.canonicalPath, '/battlefield');
    });
  });
});
