import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  performVisibilityRefetch,
  setupVisibilityRefetchListeners,
  DEFAULT_VISIBILITY_REFETCH_THROTTLE_MS,
  DEFAULT_VISIBILITY_DEBOUNCE_MS,
  defaultVisibilityCoordinator
} from '../src/utils/visibilitySyncUtils.js';
import {
  enqueueOfflineMutation,
  getOfflineQueue,
  saveOfflineQueue
} from '../src/utils/offlineQueueUtils.js';
import { ReconciledBootState } from '../src/utils/syncReconciliation.js';
import { Cycle, DailyLog, UserProfile } from '../src/types.js';

describe('Visibility-Based Remote Refetch for Multi-Device Catch-Up', () => {
  const mockStorage: Record<string, string> = {};
  const mockLocalStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, val: string) => { mockStorage[key] = String(val); },
    removeItem: (key: string) => { delete mockStorage[key]; },
    clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
    get length() { return Object.keys(mockStorage).length; },
    key: (i: number) => Object.keys(mockStorage)[i] ?? null
  };

  const testUser = 'usr_device_sync_99';
  const testToken = 'mock_jwt_token_device_99';

  beforeEach(() => {
    mockLocalStorage.clear();
    (globalThis as any).localStorage = mockLocalStorage;
    (globalThis as any).window = { localStorage: mockLocalStorage };
    defaultVisibilityCoordinator.reset();
  });

  describe('1. Throttle Guard & Interval Enforcement', () => {
    it('skips refetch if elapsed time since last pull is within throttle window', async () => {
      let pullTimestamp = Date.now() - 5000; // 5 seconds ago (within 25s throttle window)
      let fetchCalled = false;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        getLastPullTimestamp: () => pullTimestamp,
        setLastPullTimestamp: (ts) => { pullTimestamp = ts; },
        customFetch: async () => {
          fetchCalled = true;
          return { ok: true, json: async () => [] } as any;
        }
      });

      assert.equal(outcome.status, 'SKIPPED_THROTTLED');
      assert.equal(fetchCalled, false, 'Fetch must not be invoked when throttled');
    });

    it('allows refetch when elapsed time exceeds throttle window and updates timestamp', async () => {
      let pullTimestamp = Date.now() - 30000; // 30 seconds ago (exceeds 25s throttle window)
      let appliedState: ReconciledBootState | null = null;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: (reconciled) => { appliedState = reconciled; },
        getLastPullTimestamp: () => pullTimestamp,
        setLastPullTimestamp: (ts) => { pullTimestamp = ts; },
        customFetch: async (url: string | URL | Request) => {
          const urlStr = String(url);
          if (urlStr.includes('/api/cycles')) {
            return {
              ok: true,
              json: async () => [{ id: 'cycle-remote-1', title: 'Authoritative Cycle', durationDays: 40, userId: testUser }]
            } as any;
          }
          if (urlStr.includes('/api/logs')) {
            return {
              ok: true,
              json: async () => [{ id: 'log-remote-1', date: '1403-06-18', cycleId: 'cycle-remote-1', userId: testUser, isSynced: true }]
            } as any;
          }
          return { ok: false } as any;
        }
      });

      assert.equal(outcome.status, 'FETCHED');
      assert.equal(outcome.fetchedCyclesCount, 1);
      assert.equal(outcome.fetchedLogsCount, 1);
      assert.ok(appliedState !== null, 'Reconciled state must be applied');
      assert.ok(pullTimestamp > Date.now() - 1000, 'Last pull timestamp must be updated to finish time');
    });
  });

  describe('2. Precondition Guards (Online, Auth, Document Visibility)', () => {
    it('skips refetch when offline with SKIPPED_OFFLINE', async () => {
      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        isOnlineResolver: () => false,
        getLastPullTimestamp: () => 0
      });

      assert.equal(outcome.status, 'SKIPPED_OFFLINE');
    });

    it('skips refetch when unauthenticated or missing token with SKIPPED_UNAUTHENTICATED', async () => {
      const outcomeNoToken = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => null,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        getLastPullTimestamp: () => 0
      });
      assert.equal(outcomeNoToken.status, 'SKIPPED_UNAUTHENTICATED');

      const outcomeGuest = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => 'guest',
        getCurrentAuthToken: () => 'some_token',
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        getLastPullTimestamp: () => 0
      });
      assert.equal(outcomeGuest.status, 'SKIPPED_UNAUTHENTICATED');
    });

    it('skips refetch when document is hidden with SKIPPED_HIDDEN', async () => {
      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        checkDocumentVisibility: () => false,
        getLastPullTimestamp: () => 0
      });

      assert.equal(outcome.status, 'SKIPPED_HIDDEN');
    });
  });

  describe('3. In-Flight Single-Pull Guard & Account Switch Safety', () => {
    it('guards against overlapping concurrent pulls with SKIPPED_IN_FLIGHT', async () => {
      let inFlight = true;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        isInFlight: () => inFlight,
        setIsInFlight: (val) => { inFlight = val; },
        getLastPullTimestamp: () => 0
      });

      assert.equal(outcome.status, 'SKIPPED_IN_FLIGHT');
    });

    it('discards stale response when active account transitions mid-flight with DISCARDED_STALE', async () => {
      let currentAccount = testUser;
      let applied = false;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => currentAccount,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => { applied = true; },
        getLastPullTimestamp: () => 0,
        customFetch: async () => {
          // Simulate account switch while HTTP fetch was awaiting response
          currentAccount = 'usr_another_account';
          return {
            ok: true,
            json: async () => [{ id: 'cycle-stale', title: 'Stale' }]
          } as any;
        }
      });

      assert.equal(outcome.status, 'DISCARDED_STALE');
      assert.equal(applied, false, 'State from previous account must never be applied to new account');
    });
  });

  describe('4. Multi-Device Reconciliation & Offline Queue Preservation', () => {
    it('reconciles authoritative remote updates from Device A while preserving pending Device B offline queue', async () => {
      // Setup pending offline mutation on Device B
      enqueueOfflineMutation(testUser, {
        type: 'UPDATE_LOG',
        payload: {
          date: '1403-06-20',
          cycleId: 'cycle-1',
          warriorWake: true,
          deepWork1: true,
          isSynced: false,
          clientUpdatedAt: Date.now()
        },
        retryCount: 0
      });

      let appliedState: ReconciledBootState | null = null;
      let replayRequested = false;

      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({
          cycles: [{ id: 'cycle-1', title: 'Local Cycle', durationDays: 40, userId: testUser }],
          logs: [{ id: 'log-1', date: '1403-06-20', cycleId: 'cycle-1', warriorWake: true, deepWork1: true, isSynced: false, userId: testUser }]
        }),
        onApplyReconciledState: (reconciled) => { appliedState = reconciled; },
        requestSyncReplay: async () => { replayRequested = true; },
        getLastPullTimestamp: () => 0,
        customFetch: async (url: string | URL | Request) => {
          const urlStr = String(url);
          if (urlStr.includes('/api/cycles')) {
            return {
              ok: true,
              json: async () => [{ id: 'cycle-1', title: 'Updated Cycle on Device A', durationDays: 40, userId: testUser }]
            } as any;
          }
          if (urlStr.includes('/api/logs')) {
            return {
              ok: true,
              json: async () => [{ id: 'log-remote-19', date: '1403-06-19', cycleId: 'cycle-1', warriorWake: true, userId: testUser, isSynced: true }]
            } as any;
          }
          return { ok: false } as any;
        }
      });

      assert.equal(outcome.status, 'FETCHED');
      assert.ok(appliedState !== null);
      // Remote cycle updated title
      assert.equal(appliedState!.cycles?.find(c => c.id === 'cycle-1')?.title, 'Updated Cycle on Device A');
      // Local pending mutation for 1403-06-20 is preserved with isSynced: false
      const pendingLog = appliedState!.logs?.find(l => l.date === '1403-06-20');
      assert.ok(pendingLog !== undefined);
      assert.equal(pendingLog!.isSynced, false, 'Pending mutation must retain isSynced: false');
      // Replay was triggered for pending queue
      assert.equal(replayRequested, true, 'Queue replay requested for active offline queue');
    });

    it('soft-fails gracefully on HTTP 500 error without throwing', async () => {
      const outcome = await performVisibilityRefetch({
        getCurrentActiveOwnerId: () => testUser,
        getCurrentAuthToken: () => testToken,
        getCurrentLocalState: () => ({ cycles: [], logs: [] }),
        onApplyReconciledState: () => {},
        getLastPullTimestamp: () => 0,
        customFetch: async () => ({
          ok: false,
          status: 500,
          json: async () => ({ error: 'Internal server error' })
        }) as any
      });

      assert.equal(outcome.status, 'FAILED');
      assert.ok(outcome.error !== undefined);
    });
  });

  describe('5. Listener Debounce & Coalescence', () => {
    it('coalesces rapid consecutive triggers into a single refetch invocation after debounce', async () => {
      let callCount = 0;
      const fakeEvents: Record<string, Function[]> = {};

      const fakeDoc = {
        visibilityState: 'visible',
        addEventListener: (event: string, fn: Function) => {
          fakeEvents[event] = fakeEvents[event] || [];
          fakeEvents[event].push(fn);
        },
        removeEventListener: (event: string, fn: Function) => {
          fakeEvents[event] = (fakeEvents[event] || []).filter(f => f !== fn);
        }
      };

      const fakeWin = {
        addEventListener: (event: string, fn: Function) => {
          fakeEvents[event] = fakeEvents[event] || [];
          fakeEvents[event].push(fn);
        },
        removeEventListener: (event: string, fn: Function) => {
          fakeEvents[event] = (fakeEvents[event] || []).filter(f => f !== fn);
        }
      };

      (globalThis as any).document = fakeDoc;
      (globalThis as any).window = fakeWin;

      const teardown = setupVisibilityRefetchListeners({
        onTriggerRefetch: () => { callCount++; },
        debounceMs: 50
      });

      // Fire visibilitychange + focus simultaneously
      fakeEvents['visibilitychange']?.forEach(fn => fn());
      fakeEvents['focus']?.forEach(fn => fn());
      fakeEvents['visibilitychange']?.forEach(fn => fn());

      // Before debounce elapsed
      assert.equal(callCount, 0);

      // Await debounce interval
      await new Promise(r => setTimeout(r, 80));

      // After debounce elapsed: exactly 1 coalesced invocation
      assert.equal(callCount, 1, 'Should coalesce rapid focus + visibilitychange events into 1 invocation');

      teardown();
      delete (globalThis as any).document;
      delete (globalThis as any).window;
    });
  });

  describe('6. Production Code-Base Wiring Invariants', () => {
    it('App.tsx contains authoritative visibility refetch wiring and architectural comment', () => {
      const appContent = fs.readFileSync('src/App.tsx', 'utf-8');

      // 1. Mandatory comment
      assert.ok(
        appContent.includes('// Remote pull on visibility is for multi-device catch-up, not realtime.'),
        'App.tsx must document: "Remote pull on visibility is for multi-device catch-up, not realtime."'
      );

      // 2. Imports and wiring
      assert.ok(
        appContent.includes('performVisibilityRefetch') && appContent.includes('setupVisibilityRefetchListeners'),
        'App.tsx must import performVisibilityRefetch and setupVisibilityRefetchListeners'
      );

      // 3. Boot timestamp tracking
      assert.ok(
        appContent.includes('lastRemotePullTimestampRef.current = Date.now();'),
        'App.tsx must record lastRemotePullTimestampRef upon successful boot pull'
      );

      // 4. Logout cleanup
      assert.ok(
        appContent.includes('lastRemotePullTimestampRef.current = 0;'),
        'App.tsx must reset lastRemotePullTimestampRef on logout'
      );
    });
  });
});
