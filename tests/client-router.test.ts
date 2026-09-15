import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  normalizePathname, 
  resolveTabFromPath, 
  getPathForTab 
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
});
