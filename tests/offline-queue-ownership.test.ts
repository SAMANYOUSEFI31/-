import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getScopedOfflineQueueKey,
  getOfflineQueue,
  saveOfflineQueue,
  clearOfflineQueue,
  enqueueOfflineMutation,
  removeReplayedQueueItems,
  recordQueueItemFailure,
  replayAccountOfflineQueue,
  migrateLegacyGlobalQueue,
  quarantineQueueItems,
  getQuarantinedItems,
  clearQuarantine,
  getScopedQuarantineKey,
  isGuestQueueOwner,
  normalizeQueueOwner,
  OFFLINE_QUEUE_PREFIX,
  LEGACY_OFFLINE_QUEUE_KEY,
  OFFLINE_QUARANTINE_KEY
} from '../src/utils/offlineQueueUtils.js';
import { shouldQueueOfflineMutation } from '../src/utils/storageCore.js';
import { OfflineQueueItem } from '../src/types.js';

describe('Phase 3B: Account-Scoped Offline Queue & Safe Replay Contract', () => {
  const storageMock: Record<string, string> = {};

  beforeEach(() => {
    // Clear in-memory mock storage
    for (const k in storageMock) delete storageMock[k];

    // Ensure mock global window.localStorage exists
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => { storageMock[key] = String(val); },
        removeItem: (key: string) => { delete storageMock[key]; }
      }
    };
  });

  // ===========================================================================
  // 1. ACCOUNT-SCOPED STORAGE KEY SEGREGATION & NORMALIZATION
  // ===========================================================================
  describe('1. Storage Key Partitioning & Owner Normalization', () => {
    it('generates distinct partitioned keys for Guest, User A, User B, and Admin', () => {
      const keyGuest = getScopedOfflineQueueKey(null);
      const keyGuestExplicit = getScopedOfflineQueueKey('guest');
      const keyUserA = getScopedOfflineQueueKey('user-alpha-100');
      const keyUserB = getScopedOfflineQueueKey('user-beta-200');
      const keyAdmin = getScopedOfflineQueueKey('admin-master-999');

      assert.equal(keyGuest, 'bushido_offline_queue_guest');
      assert.equal(keyGuestExplicit, 'bushido_offline_queue_guest');
      assert.equal(keyUserA, 'bushido_offline_queue_user_user-alpha-100');
      assert.equal(keyUserB, 'bushido_offline_queue_user_user-beta-200');
      assert.equal(keyAdmin, 'bushido_offline_queue_user_admin-master-999');

      assert.notEqual(keyUserA, keyUserB);
      assert.notEqual(keyUserA, keyGuest);
      assert.notEqual(keyUserB, keyAdmin);
    });

    it('identifies guest partitions accurately and normalizes boundary IDs', () => {
      assert.equal(isGuestQueueOwner(null), true);
      assert.equal(isGuestQueueOwner(undefined), true);
      assert.equal(isGuestQueueOwner(''), true);
      assert.equal(isGuestQueueOwner('   '), true);
      assert.equal(isGuestQueueOwner('guest'), true);
      assert.equal(isGuestQueueOwner('__guest__'), true);

      assert.equal(isGuestQueueOwner('user-123'), false);
      assert.equal(isGuestQueueOwner('admin-1'), false);

      assert.equal(normalizeQueueOwner(null), 'guest');
      assert.equal(normalizeQueueOwner('  user-xyz  '), 'user-xyz');
    });
  });

  // ===========================================================================
  // 2. ENQUEUEING, COMPACTION & ORDERING RULES
  // ===========================================================================
  describe('2. Queue Mutations, Compaction & Lifecycle Rules', () => {
    it('enqueues mutations with embedded ownerId strictly bound to the target partition', () => {
      const item = enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-15', score: 8, isStandardDay: true }
      });

      assert.equal(item.ownerId, 'user-alpha');
      assert.equal(item.type, 'UPDATE_LOG');
      assert.ok(item.id);
      assert.ok(item.timestamp);
      assert.equal(item.retryCount, 0);

      const queueAlpha = getOfflineQueue('user-alpha');
      assert.equal(queueAlpha.length, 1);
      assert.equal(queueAlpha[0].payload.date, '1405-06-15');

      // User Beta and Guest queues must remain completely empty
      assert.equal(getOfflineQueue('user-beta').length, 0);
      assert.equal(getOfflineQueue('guest').length, 0);
    });

    it('compacts consecutive UPDATE_LOG mutations for the same date', () => {
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-15', score: 6, isStandardDay: false }
      });

      // User subsequently marks another habit for the same date
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-15', score: 10, isMasteryDay: true }
      });

      const queue = getOfflineQueue('user-alpha');
      assert.equal(queue.length, 1, 'Successive UPDATE_LOG on same date must be compacted into 1 item');
      assert.equal(queue[0].payload.score, 10);
      assert.equal(queue[0].payload.isMasteryDay, true);
    });

    it('cancels out CREATE_CYCLE followed by DELETE_CYCLE before server sync', () => {
      const cycleId = 'cycle-offline-temp-1';

      enqueueOfflineMutation('user-alpha', {
        type: 'CREATE_CYCLE',
        payload: { id: cycleId, title: 'Temporary Cycle', startDate: '1405-06-01' }
      });
      assert.equal(getOfflineQueue('user-alpha').length, 1);

      // User deletes the cycle before going online
      enqueueOfflineMutation('user-alpha', {
        type: 'DELETE_CYCLE',
        payload: { id: cycleId }
      });

      const queue = getOfflineQueue('user-alpha');
      assert.equal(queue.length, 0, 'CREATE followed by DELETE of an unsynced cycle must cancel both out');
    });

    it('compacts repeated UPDATE_CYCLE mutations for the same cycle ID', () => {
      const cycleId = 'cycle-persisted-1';

      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_CYCLE',
        payload: { id: cycleId, title: 'Old Title', targetTheme: 'zinc' }
      });

      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_CYCLE',
        payload: { id: cycleId, title: 'Refined Title', targetTheme: 'emerald' }
      });

      const queue = getOfflineQueue('user-alpha');
      assert.equal(queue.length, 1);
      assert.equal(queue[0].payload.title, 'Refined Title');
      assert.equal(queue[0].payload.targetTheme, 'emerald');
    });
  });

  // ===========================================================================
  // 3. SAFE REPLAY & ACCOUNT-ISOLATION DURING REPLAY
  // ===========================================================================
  describe('3. Safe Account-Scoped Replay & Mid-Replay Account Switching Guard', () => {
    it('replays only items from the active account partition using its valid auth token', async () => {
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-10', score: 8 }
      });
      enqueueOfflineMutation('user-beta', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-10', score: 10 }
      });

      const requestsMade: Array<{ url: string; auth: string; body: any }> = [];

      const mockFetch = async (url: string, init?: any) => {
        requestsMade.push({
          url,
          auth: init?.headers?.Authorization || '',
          body: init?.body ? JSON.parse(init.body) : null
        });
        return { ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } } as any;
      };

      const replayResult = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'jwt-token-alpha',
        fetchFn: mockFetch
      });

      assert.equal(replayResult.syncedCount, 1);
      assert.equal(replayResult.failedCount, 0);
      assert.equal(replayResult.stoppedDueToAccountChange, false);
      assert.equal(replayResult.stoppedDueToAuth, false);

      // User Alpha queue should now be empty
      assert.equal(getOfflineQueue('user-alpha').length, 0);

      // User Beta queue must NOT have been touched or replayed
      assert.equal(getOfflineQueue('user-beta').length, 1);
      assert.equal(requestsMade.length, 1);
      assert.equal(requestsMade[0].auth, 'Bearer jwt-token-alpha');
      assert.equal(requestsMade[0].body.score, 8);
    });

    it('strictly aborts replay if active account switches mid-replay (no cross-account replay)', async () => {
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-11', score: 8 }
      });
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-12', score: 8 }
      });

      let currentActiveUser = 'user-alpha';
      let callCount = 0;

      const mockFetch = async (url: string, init?: any) => {
        callCount++;
        if (callCount === 1) {
          // Mid-flight account transition simulates another user logging in before response completes
          currentActiveUser = 'user-beta';
        }
        return { ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } } as any;
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'jwt-token-alpha',
        getCurrentActiveAccountId: () => currentActiveUser,
        fetchFn: mockFetch
      });

      assert.equal(result.stoppedDueToAccountChange, true);
      assert.equal(result.syncedCount, 0, 'Post-fetch verification must abort commit when account changed');
      
      // User Alpha's queue must remain intact and NOT dropped
      const remainingAlpha = getOfflineQueue('user-alpha');
      assert.equal(remainingAlpha.length, 2);
    });

    it('quarantines and drops any foreign item whose embedded owner does not match target partition', async () => {
      // Artificially inject an item with owner 'user-hacker' directly into user-alpha's storage partition
      const corruptedItem: OfflineQueueItem = {
        id: 'corrupt-1',
        ownerId: 'user-hacker',
        type: 'UPDATE_PROFILE',
        payload: { name: 'Hacked Name' },
        timestamp: Date.now(),
        retryCount: 0
      };
      const keyAlpha = getScopedOfflineQueueKey('user-alpha');
      storageMock[keyAlpha] = JSON.stringify([corruptedItem]);

      clearQuarantine();

      const mockFetch = async (url?: any, init?: any) => {
        assert.fail('Should never make server request for mismatched owner item');
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'token-alpha',
        fetchFn: mockFetch
      });

      assert.equal(result.syncedCount, 0);
      assert.equal(getOfflineQueue('user-alpha').length, 0, 'Mismatched item must be purged from active queue');

      const quarantined = getQuarantinedItems();
      assert.equal(quarantined.length, 1);
      assert.ok(quarantined[0].reason.includes('Embedded owner mismatch'));
    });

    it('halts replay when server responds with 401 or 403 auth failure', async () => {
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-15', score: 10 }
      });

      const mockFetch = async (url?: any, init?: any) => {
        return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as any;
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'expired-token',
        fetchFn: mockFetch
      });

      assert.equal(result.stoppedDueToAuth, true);
      assert.equal(result.syncedCount, 0);
      // Item must remain in queue for when user re-authenticates
      assert.equal(getOfflineQueue('user-alpha').length, 1);
    });

    it('increments retryCount and records lastError on server 500 error', async () => {
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-16', score: 8 }
      });

      const mockFetch = async (url?: any, init?: any) => {
        return { ok: false, status: 500, json: async () => ({ error: 'Database Error' }) } as any;
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'valid-token',
        fetchFn: mockFetch
      });

      assert.equal(result.failedCount, 1);
      assert.equal(result.syncedCount, 0);

      const queue = getOfflineQueue('user-alpha');
      assert.equal(queue.length, 1);
      assert.equal(queue[0].retryCount, 1);
      assert.ok(queue[0].lastError?.includes('500'));
    });

    it('treats 404 response on DELETE_CYCLE as idempotent success', async () => {
      enqueueOfflineMutation('user-alpha', {
        type: 'DELETE_CYCLE',
        payload: { id: 'cycle-already-deleted' }
      });

      const mockFetch = async (url?: any, init?: any) => {
        return { ok: false, status: 404, json: async () => ({ error: 'Not found' }) } as any;
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'valid-token',
        fetchFn: mockFetch
      });

      assert.equal(result.syncedCount, 1);
      assert.equal(result.failedCount, 0);
      assert.equal(getOfflineQueue('user-alpha').length, 0);
    });
  });

  // ===========================================================================
  // 4. ADMIN IMPERSONATION PARTITION ISOLATION
  // ===========================================================================
  describe('4. Admin Impersonation Partition Isolation', () => {
    it('isolates mutations performed during impersonation strictly under impersonated user', () => {
      const adminId = 'admin-user-007';
      const targetUserId = 'client-user-999';

      // Admin impersonates client-user-999
      // Operations performed during impersonation must embed and store in client-user-999 partition
      enqueueOfflineMutation(targetUserId, {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-18', score: 10 }
      });

      const adminQueue = getOfflineQueue(adminId);
      const targetQueue = getOfflineQueue(targetUserId);

      assert.equal(adminQueue.length, 0, 'Admin queue must remain pristine during impersonation');
      assert.equal(targetQueue.length, 1, 'Target user queue must hold the mutation');
      assert.equal(targetQueue[0].ownerId, targetUserId);
    });
  });

  // ===========================================================================
  // 5. LEGACY GLOBAL QUEUE MIGRATION & QUARANTINE
  // ===========================================================================
  describe('5. Legacy Global Queue Migration & Quarantine Safety', () => {
    it('migrates verifiable items to owner partition and quarantines unverifiable items', () => {
      const legacyItems = [
        {
          id: 'item-valid-1',
          ownerId: 'user-gamma',
          type: 'UPDATE_LOG',
          payload: { date: '1405-05-01', score: 8 },
          timestamp: Date.now()
        },
        {
          id: 'item-valid-2',
          ownerId: 'user-gamma',
          type: 'UPDATE_CYCLE',
          payload: { id: 'cycle-gamma', title: 'Gamma Cycle' },
          timestamp: Date.now()
        },
        {
          id: 'item-ambiguous-no-owner',
          // missing ownerId
          type: 'UPDATE_LOG',
          payload: { date: '1405-05-02', score: 10 },
          timestamp: Date.now()
        },
        {
          id: 'item-corrupted',
          ownerId: 12345, // invalid type
          type: 'UNKNOWN_TYPE'
        }
      ];

      // Store in legacy global key
      storageMock[LEGACY_OFFLINE_QUEUE_KEY] = JSON.stringify(legacyItems);
      clearQuarantine();

      const result = migrateLegacyGlobalQueue();

      assert.equal(result.migratedCount, 2, 'Two verifiable items migrated');
      assert.equal(result.quarantinedCount, 2, 'Two ambiguous items quarantined');

      // Verifiable items must be present in user-gamma's partition
      const gammaQueue = getOfflineQueue('user-gamma');
      assert.equal(gammaQueue.length, 2);
      assert.equal(gammaQueue[0].ownerId, 'user-gamma');

      // Quarantined items must be preserved safely
      const quarantined = getQuarantinedItems();
      assert.equal(quarantined.length, 1);
      assert.equal(quarantined[0].items.length, 2);

      // Legacy global key must be completely removed
      assert.equal(storageMock[LEGACY_OFFLINE_QUEUE_KEY], undefined);
    });

    it('safely handles missing or corrupted legacy data without error', () => {
      storageMock[LEGACY_OFFLINE_QUEUE_KEY] = 'INVALID_JSON_@@##';
      const result = migrateLegacyGlobalQueue();
      assert.equal(result.migratedCount, 0);
      assert.equal(result.quarantinedCount, 0);
      assert.equal(storageMock[LEGACY_OFFLINE_QUEUE_KEY], undefined);
    });
  });

  // ===========================================================================
  // 6. PHASE 3B HARDENING: EXPLICIT AUTH TRANSITIONS, GUARD ALIGNMENT & ISOLATION INVARIANTS
  // ===========================================================================
  describe('6. Phase 3B Hardening: Explicit Transitions, Guard Alignment & Isolation Invariants', () => {
    it('Scenario 1: Guest -> User A replays ONLY User A queue and leaves Guest queue strictly untouched', async () => {
      // 1. Queue an item in Guest partition
      enqueueOfflineMutation(null, {
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-01', score: 6 }
      });

      // 2. Queue an item in User A partition
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-02', score: 9 }
      });

      assert.equal(getOfflineQueue(null).length, 1);
      assert.equal(getOfflineQueue('user-alpha').length, 1);

      // Track all HTTP requests made during replay
      const sentRequests: { url: string; authHeader: string; body: any }[] = [];
      const mockFetch = async (url: any, init?: any) => {
        sentRequests.push({
          url: String(url),
          authHeader: init?.headers?.Authorization || '',
          body: JSON.parse(init?.body || '{}')
        });
        return {
          ok: true,
          status: 200,
          json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }
        } as any;
      };

      // 3. Replay triggered explicitly for User A after login
      const result = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'token-alpha-123',
        fetchFn: mockFetch
      });

      // Assertions:
      assert.equal(result.syncedCount, 1);
      assert.equal(sentRequests.length, 1);
      assert.equal(sentRequests[0].authHeader, 'Bearer token-alpha-123');
      assert.equal(sentRequests[0].body.date, '1405-01-02');

      // User A queue must be empty, Guest queue must remain completely untouched
      assert.equal(getOfflineQueue('user-alpha').length, 0, 'User A queue must be fully drained');
      assert.equal(getOfflineQueue(null).length, 1, 'Guest queue must NEVER be touched or replayed');
      assert.equal(getOfflineQueue(null)[0].payload.date, '1405-01-01');
    });

    it('Scenario 2: User A -> User B replays ONLY User B queue with User B token, never User A queue', async () => {
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Alpha Warrior' }
      });

      enqueueOfflineMutation('user-beta', {
        type: 'UPDATE_PROFILE',
        payload: { name: 'Beta Champion' }
      });

      const sentRequests: { url: string; authHeader: string; body: any }[] = [];
      const mockFetch = async (url: any, init?: any) => {
        sentRequests.push({
          url: String(url),
          authHeader: init?.headers?.Authorization || '',
          body: JSON.parse(init?.body || '{}')
        });
        return {
          ok: true,
          status: 200,
          json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }
        } as any;
      };

      // Replay triggered explicitly for User B
      const result = await replayAccountOfflineQueue({
        activeAccountId: 'user-beta',
        authToken: 'token-beta-456',
        fetchFn: mockFetch
      });

      assert.equal(result.syncedCount, 1);
      assert.equal(sentRequests.length, 1);
      assert.equal(sentRequests[0].authHeader, 'Bearer token-beta-456');
      assert.equal(sentRequests[0].body.name, 'Beta Champion');

      // User B queue drained, User A queue untouched
      assert.equal(getOfflineQueue('user-beta').length, 0);
      assert.equal(getOfflineQueue('user-alpha').length, 1);
      assert.equal(getOfflineQueue('user-alpha')[0].payload.name, 'Alpha Warrior');
    });

    it('Scenario 3: Impersonation entry replays ONLY target-user queue with target token', async () => {
      const adminId = 'admin-super-001';
      const targetUserId = 'client-vip-888';

      enqueueOfflineMutation(adminId, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'admin-cycle-1', title: 'Admin Master Cycle' }
      });

      enqueueOfflineMutation(targetUserId, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'client-cycle-1', title: 'Client Custom Cycle' }
      });

      const sentRequests: { authHeader: string; body: any }[] = [];
      const mockFetch = async (url: any, init?: any) => {
        sentRequests.push({
          authHeader: init?.headers?.Authorization || '',
          body: JSON.parse(init?.body || '{}')
        });
        return {
          ok: true,
          status: 200,
          json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }
        } as any;
      };

      // Admin impersonates target user -> explicit replay for target user with target token
      const result = await replayAccountOfflineQueue({
        activeAccountId: targetUserId,
        authToken: 'impersonation-token-888',
        fetchFn: mockFetch
      });

      assert.equal(result.syncedCount, 1);
      assert.equal(sentRequests.length, 1);
      assert.equal(sentRequests[0].authHeader, 'Bearer impersonation-token-888');
      assert.equal(sentRequests[0].body.id, 'client-cycle-1');

      // Target user queue drained, admin queue untouched
      assert.equal(getOfflineQueue(targetUserId).length, 0);
      assert.equal(getOfflineQueue(adminId).length, 1);
    });

    it('Scenario 4: Impersonation exit never replays target-user queue', async () => {
      const adminId = 'admin-super-001';
      const targetUserId = 'client-vip-888';

      // Suppose target user still has an item
      enqueueOfflineMutation(targetUserId, {
        type: 'UPDATE_LOG',
        payload: { date: '1405-06-20', score: 10 }
      });

      // Admin exits impersonation -> triggers explicit replay for admin
      let fetchCalls = 0;
      const mockFetch = async (url?: any, init?: any) => {
        fetchCalls++;
        return {
          ok: true,
          status: 200,
          json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }
        } as any;
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: adminId,
        authToken: 'admin-original-token',
        fetchFn: mockFetch
      });

      // Admin had no items, target user queue is NEVER touched or sent with admin token
      assert.equal(result.syncedCount, 0);
      assert.equal(fetchCalls, 0);
      assert.equal(getOfflineQueue(targetUserId).length, 1, 'Target user queue remains untouched');
    });

    it('Scenario 5: Tokenless or Guest sessions strictly blocked from sending replay mutations', async () => {
      enqueueOfflineMutation(null, {
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-01', score: 7 }
      });

      let fetchAttempted = false;
      const mockFetch = async (url?: any, init?: any) => {
        fetchAttempted = true;
        assert.fail('Should never invoke fetch for tokenless or guest sessions');
      };

      // 1. Guest session replay
      const guestResult = await replayAccountOfflineQueue({
        activeAccountId: null,
        authToken: null,
        fetchFn: mockFetch
      });
      assert.equal(guestResult.syncedCount, 0);
      assert.equal(guestResult.stoppedDueToAuth, false);
      assert.equal(fetchAttempted, false);
      assert.equal(getOfflineQueue(null).length, 1);

      // 2. Authenticated user without auth token
      enqueueOfflineMutation('user-gamma', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-02', score: 8 }
      });

      const unauthResult = await replayAccountOfflineQueue({
        activeAccountId: 'user-gamma',
        authToken: null,
        fetchFn: mockFetch
      });
      assert.equal(unauthResult.syncedCount, 0);
      assert.equal(unauthResult.stoppedDueToAuth, true);
      assert.equal(fetchAttempted, false);
      assert.equal(getOfflineQueue('user-gamma').length, 1);
    });

    it('Scenario 6: Mutation queuing guard (shouldQueueOfflineMutation) provides authoritative checks', () => {
      // Guest sessions are always queued locally
      assert.equal(shouldQueueOfflineMutation(null, null), true);
      assert.equal(shouldQueueOfflineMutation('guest', null), true);
      assert.equal(shouldQueueOfflineMutation(null, 'any-token'), true);
      assert.equal(shouldQueueOfflineMutation('guest', 'any-token'), true);

      // Authenticated users without token are queued locally
      assert.equal(shouldQueueOfflineMutation('user-alpha', null), true);
      assert.equal(shouldQueueOfflineMutation('user-alpha', ''), true);

      // Authenticated users with token when online are NOT queued
      assert.equal(shouldQueueOfflineMutation('user-alpha', 'valid-token'), false);
      assert.equal(shouldQueueOfflineMutation('admin-001', 'admin-token'), false);

      // Offline network status always forces queueing
      const originalOnLine = globalThis.navigator?.onLine;
      Object.defineProperty(globalThis.navigator, 'onLine', { value: false, configurable: true, writable: true });
      assert.equal(shouldQueueOfflineMutation('user-alpha', 'valid-token'), true);

      // Restore online
      Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true, writable: true });
      assert.equal(shouldQueueOfflineMutation('user-alpha', 'valid-token'), false);

      // Reset to original if needed
      if (originalOnLine !== undefined) {
        Object.defineProperty(globalThis.navigator, 'onLine', { value: originalOnLine, configurable: true, writable: true });
      }
    });

    it('Scenario 7: Account switch mid-replay immediately aborts and preserves remaining queue', async () => {
      // --- Case 7A: Account switch between items (caught by pre-flight check before item 2) ---
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-01', score: 10 }
      });
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-02', score: 10 }
      });

      let activeAccountA = 'user-alpha';
      let callCountA = 0;

      const mockFetchA = async (url?: any, init?: any) => {
        callCountA++;
        return {
          ok: true,
          status: 200,
          json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }
        } as any;
      };

      const resultA = await replayAccountOfflineQueue({
        activeAccountId: 'user-alpha',
        authToken: 'token-alpha',
        fetchFn: mockFetchA,
        getCurrentActiveAccountId: () => activeAccountA,
        onItemSuccess: () => {
          // Switch account right after item 1 commits
          activeAccountA = 'user-beta';
        }
      });

      assert.equal(resultA.syncedCount, 1, 'First item committed before account switch');
      assert.equal(resultA.stoppedDueToAccountChange, true, 'Stopped due to account change');
      assert.equal(callCountA, 1, 'Only 1 request should have been made before pre-flight check caught switch');

      // Remaining item for user-alpha must still be preserved in user-alpha's queue
      const remainingAlpha = getOfflineQueue('user-alpha');
      assert.equal(remainingAlpha.length, 1);
      assert.equal(remainingAlpha[0].payload.date, '1405-01-02');

      // --- Case 7B: Account switch in-flight during request (caught by post-flight check before commit) ---
      enqueueOfflineMutation('user-delta', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-03', score: 8 }
      });

      let activeAccountB = 'user-delta';
      const mockFetchB = async (url?: any, init?: any) => {
        // Account changes while HTTP request is in-flight on the wire
        activeAccountB = 'user-epsilon';
        return {
          ok: true,
          status: 200,
          json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; }
        } as any;
      };

      const resultB = await replayAccountOfflineQueue({
        activeAccountId: 'user-delta',
        authToken: 'token-delta',
        fetchFn: mockFetchB,
        getCurrentActiveAccountId: () => activeAccountB
      });

      assert.equal(resultB.syncedCount, 0, 'In-flight switch prevented committing unverified success');
      assert.equal(resultB.stoppedDueToAccountChange, true);
      assert.equal(getOfflineQueue('user-delta').length, 1, 'Item remains safely in delta queue');
    });

    it('Scenario 8: Quarantine entries for corrupted/foreign items are partition-isolated and preserved across cleans', () => {
      clearQuarantine();

      // Quarantine an item for user-alpha
      quarantineQueueItems([{
        id: 'foreign-1',
        ownerId: 'user-alpha',
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-01', score: 1 }
      }], 'Corrupted signature', 'user-alpha');

      // Quarantine an item for user-beta
      quarantineQueueItems([{
        id: 'foreign-2',
        ownerId: 'user-beta',
        type: 'UPDATE_LOG',
        payload: { date: '1405-01-02', score: 2 }
      }], 'Security violation', 'user-beta');

      // Alpha quarantine has 1, Beta quarantine has 1
      assert.equal(getQuarantinedItems('user-alpha').length, 1);
      assert.equal(getQuarantinedItems('user-beta').length, 1);

      // Clearing User Beta's quarantine must NEVER affect User Alpha's quarantine
      clearQuarantine('user-beta');

      assert.equal(getQuarantinedItems('user-beta').length, 0);
      assert.equal(getQuarantinedItems('user-alpha').length, 1, 'User Alpha quarantine must be preserved');
    });

    it('Scenario 9: Global quarantine ledger does NOT store complete private payloads; sensitive credentials are redacted', () => {
      clearQuarantine();

      const userAId = 'user-alpha';
      const userBId = 'user-beta';

      // Quarantine items with private notes and sensitive credentials
      quarantineQueueItems([
        {
          id: 'item-priv-1',
          ownerId: userAId,
          type: 'UPDATE_LOG',
          payload: {
            date: '1405-01-10',
            habitNotes: 'Extremely personal diary entry for User A',
            authToken: 'secret-token-user-a',
            password: 'plain-password-123'
          }
        }
      ], 'Security check failed', userAId);

      quarantineQueueItems([
        {
          id: 'item-priv-2',
          ownerId: userBId,
          type: 'CREATE_CYCLE',
          payload: {
            id: 'cycle-secret-b',
            title: 'User B Confidential Business Plan',
            otpCode: '987654',
            secret: 'top-secret-val'
          }
        }
      ], 'Schema mismatch', userBId);

      // 1. Check owner-scoped partitions: payloads ARE preserved, but credentials MUST be redacted
      const alphaQuarantine = getQuarantinedItems(userAId);
      assert.equal(alphaQuarantine.length, 1);
      const alphaItem = alphaQuarantine[0].items[0];
      assert.equal(alphaItem.payload.habitNotes, 'Extremely personal diary entry for User A');
      assert.equal(alphaItem.payload.authToken, '[REDACTED]');
      assert.equal(alphaItem.payload.password, '[REDACTED]');

      const betaQuarantine = getQuarantinedItems(userBId);
      assert.equal(betaQuarantine.length, 1);
      const betaItem = betaQuarantine[0].items[0];
      assert.equal(betaItem.payload.title, 'User B Confidential Business Plan');
      assert.equal(betaItem.payload.otpCode, '[REDACTED]');
      assert.equal(betaItem.payload.secret, '[REDACTED]');

      // 2. Check global compatibility ledger: MUST NOT contain full private payloads from multiple users
      const globalRaw = storageMock[OFFLINE_QUARANTINE_KEY];
      assert.ok(globalRaw, 'Global ledger exists for compatibility/audit');
      const globalParsed = JSON.parse(globalRaw);
      assert.equal(globalParsed.length, 2);

      // In the global ledger, entries contain safe audit items, NOT full private payloads
      for (const entry of globalParsed) {
        assert.ok(entry.quarantinedAt);
        assert.ok(entry.reason);
        assert.equal(typeof entry.itemCount, 'number');
        for (const safeItem of entry.items) {
          assert.ok(safeItem.id);
          assert.ok(safeItem.type);
          assert.equal(typeof safeItem.hasPayload, 'boolean');
          // Payload itself must NEVER be duplicated in the global shared ledger
          assert.equal((safeItem as any).payload, undefined);
        }
      }

      // Neither user's private text must be present anywhere in the raw global ledger JSON
      assert.ok(!globalRaw.includes('Extremely personal diary entry for User A'));
      assert.ok(!globalRaw.includes('User B Confidential Business Plan'));
      assert.ok(!globalRaw.includes('secret-token-user-a'));
      assert.ok(!globalRaw.includes('plain-password-123'));
    });

    it('Scenario 10: Logout maintains partition integrity, does not merge, transfer, or replay queues', async () => {
      // User Alpha queues an item
      enqueueOfflineMutation('user-alpha', {
        type: 'UPDATE_LOG',
        payload: { date: '1405-02-01', score: 10 }
      });
      assert.equal(getOfflineQueue('user-alpha').length, 1);

      // User logs out (active account becomes null / guest)
      let networkCalls = 0;
      const mockFetch = async (url?: any, init?: any) => {
        networkCalls++;
        return { ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } } as any;
      };

      // Replay in logged-out / guest state
      const loggedOutResult = await replayAccountOfflineQueue({
        activeAccountId: null,
        authToken: null,
        fetchFn: mockFetch
      });

      // No network calls, 0 synced
      assert.equal(networkCalls, 0);
      assert.equal(loggedOutResult.syncedCount, 0);

      // User Alpha queue is strictly preserved and untouched
      assert.equal(getOfflineQueue('user-alpha').length, 1);
      assert.equal(getOfflineQueue('user-alpha')[0].payload.date, '1405-02-01');

      // Guest partition is unaffected
      assert.equal(getOfflineQueue(null).length, 0);

      // User Beta logs in
      const betaResult = await replayAccountOfflineQueue({
        activeAccountId: 'user-beta',
        authToken: 'token-beta',
        fetchFn: mockFetch
      });

      // User Beta has no items, network is NOT called, User Alpha queue is still untouched
      assert.equal(betaResult.syncedCount, 0);
      assert.equal(networkCalls, 0);
      assert.equal(getOfflineQueue('user-alpha').length, 1);
      assert.equal(getOfflineQueue('user-beta').length, 0);
    });

    it('Scenario 11: Page reload / storage restore preserves the correct account queue', () => {
      const activeUserId = 'user-champion';
      enqueueOfflineMutation(activeUserId, {
        type: 'UPDATE_LOG',
        payload: { date: '1405-03-01', score: 9 }
      });
      enqueueOfflineMutation(activeUserId, {
        type: 'UPDATE_PROFILE',
        payload: { displayName: 'Champion Restored' }
      });

      // Simulate full page reload by verifying that reading from localStorage restores the exact queue
      const restoredQueue = getOfflineQueue(activeUserId);
      assert.equal(restoredQueue.length, 2);
      assert.equal(restoredQueue[0].payload.date, '1405-03-01');
      assert.equal(restoredQueue[1].payload.displayName, 'Champion Restored');
      assert.equal(restoredQueue[0].ownerId, activeUserId);
      assert.equal(restoredQueue[1].ownerId, activeUserId);
    });

    it('Scenario 12: Repeated UPDATE_LOG compacts correctly for same cycle and date', () => {
      const owner = 'user-log-compact';
      clearOfflineQueue(owner);

      enqueueOfflineMutation(owner, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cycle-10', date: '1405-04-01', score: 5, wakeUp: true }
      });
      assert.equal(getOfflineQueue(owner).length, 1);

      // Second update for same cycle and date
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cycle-10', date: '1405-04-01', score: 8, wakeUp: true, workout: true }
      });

      // Must remain exactly 1 compacted item with the latest payload
      const queue = getOfflineQueue(owner);
      assert.equal(queue.length, 1);
      assert.equal(queue[0].payload.score, 8);
      assert.equal(queue[0].payload.workout, true);

      // Different date in same cycle -> separate item
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cycle-10', date: '1405-04-02', score: 10 }
      });
      assert.equal(getOfflineQueue(owner).length, 2);
    });

    it('Scenario 13: Repeated UPDATE_CYCLE compacts correctly, preserving CREATE_CYCLE dependency order', () => {
      const owner = 'user-cycle-compact';
      clearOfflineQueue(owner);

      // Step 1: Create cycle offline
      enqueueOfflineMutation(owner, {
        type: 'CREATE_CYCLE',
        payload: { id: 'cycle-created-offline', title: 'New Cycle v1' }
      });

      // Step 2: Update cycle offline
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'cycle-created-offline', title: 'New Cycle v2' }
      });

      // Step 3: Update cycle again offline
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'cycle-created-offline', title: 'New Cycle v3 - Final' }
      });

      const queue = getOfflineQueue(owner);
      assert.equal(queue.length, 2, 'Should contain CREATE_CYCLE followed by single compacted UPDATE_CYCLE');
      assert.equal(queue[0].type, 'CREATE_CYCLE');
      assert.equal(queue[0].payload.id, 'cycle-created-offline');
      assert.equal(queue[1].type, 'UPDATE_CYCLE');
      assert.equal(queue[1].payload.title, 'New Cycle v3 - Final');
    });

    it('Scenario 14: CREATE_CYCLE followed by DELETE_CYCLE completely removes the offline mutation chain', () => {
      const owner = 'user-create-delete';
      clearOfflineQueue(owner);

      // Create cycle offline
      enqueueOfflineMutation(owner, {
        type: 'CREATE_CYCLE',
        payload: { id: 'cycle-temp', title: 'Temporary' }
      });

      // Update cycle offline
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'cycle-temp', title: 'Temporary Updated' }
      });

      // Add log for this offline cycle
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cycle-temp', date: '1405-01-01', score: 8 }
      });

      assert.equal(getOfflineQueue(owner).length, 3);

      // Delete the cycle offline before sync
      enqueueOfflineMutation(owner, {
        type: 'DELETE_CYCLE',
        payload: { id: 'cycle-temp' }
      });

      // The entire pending chain for this offline cycle must be completely pruned
      const queue = getOfflineQueue(owner);
      assert.equal(queue.length, 0, 'CREATE_CYCLE + DELETE_CYCLE before sync removes all pending mutations');
    });

    it('Scenario 15: DELETE_CYCLE prunes pending Cycle updates and related DailyLog mutations, and duplicate DELETE_CYCLE is compacted', () => {
      const owner = 'user-server-delete';
      clearOfflineQueue(owner);

      // Existing cycle on server has pending offline updates
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_CYCLE',
        payload: { id: 'server-cycle-77', title: 'Server Cycle Updated' }
      });
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'server-cycle-77', date: '1405-05-01', score: 7 }
      });

      assert.equal(getOfflineQueue(owner).length, 2);

      // Delete cycle on server
      enqueueOfflineMutation(owner, {
        type: 'DELETE_CYCLE',
        payload: { id: 'server-cycle-77' }
      });

      // Pending updates and log mutations for that cycle are pruned; only 1 DELETE_CYCLE remains
      let queue = getOfflineQueue(owner);
      assert.equal(queue.length, 1);
      assert.equal(queue[0].type, 'DELETE_CYCLE');

      // Duplicate DELETE_CYCLE does not create redundant replay steps
      enqueueOfflineMutation(owner, {
        type: 'DELETE_CYCLE',
        payload: { id: 'server-cycle-77' }
      });
      queue = getOfflineQueue(owner);
      assert.equal(queue.length, 1);

      // Any attempted update after DELETE_CYCLE is dropped
      enqueueOfflineMutation(owner, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'server-cycle-77', date: '1405-05-02', score: 10 }
      });
      queue = getOfflineQueue(owner);
      assert.equal(queue.length, 1);
    });

    it('Scenario 16: Compaction never crosses account boundaries', () => {
      const user1 = 'user-iso-1';
      const user2 = 'user-iso-2';

      enqueueOfflineMutation(user1, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cycle-common', date: '1405-01-01', score: 5 }
      });
      enqueueOfflineMutation(user2, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cycle-common', date: '1405-01-01', score: 9 }
      });

      // User 1 updates their log again
      enqueueOfflineMutation(user1, {
        type: 'UPDATE_LOG',
        payload: { cycleId: 'cycle-common', date: '1405-01-01', score: 10 }
      });

      const q1 = getOfflineQueue(user1);
      const q2 = getOfflineQueue(user2);

      assert.equal(q1.length, 1);
      assert.equal(q1[0].payload.score, 10);
      assert.equal(q1[0].ownerId, user1);

      assert.equal(q2.length, 1);
      assert.equal(q2[0].payload.score, 9);
      assert.equal(q2[0].ownerId, user2);
    });

    it('Scenario 17: Running legacy migration more than once does not duplicate items (idempotent)', () => {
      const targetUser = 'user-idempotent';
      clearOfflineQueue(targetUser);

      storageMock[LEGACY_OFFLINE_QUEUE_KEY] = JSON.stringify([
        {
          id: 'item-mig-1',
          ownerId: targetUser,
          type: 'UPDATE_LOG',
          payload: { date: '1405-06-01' }
        }
      ]);

      const firstRun = migrateLegacyGlobalQueue();
      assert.equal(firstRun.migratedCount, 1);
      assert.equal(getOfflineQueue(targetUser).length, 1);

      // Second run immediately following
      const secondRun = migrateLegacyGlobalQueue();
      assert.equal(secondRun.migratedCount, 0);
      assert.equal(secondRun.quarantinedCount, 0);
      assert.equal(getOfflineQueue(targetUser).length, 1, 'Queue must not duplicate items');
    });

    it('Scenario 18: Quarantined data never replays automatically', async () => {
      const owner = 'user-quarantine-never-replays';
      clearOfflineQueue(owner);
      clearQuarantine(owner);

      quarantineQueueItems([
        {
          id: 'bad-item-99',
          ownerId: owner,
          type: 'UPDATE_LOG',
          payload: { date: '1405-01-01', badData: true }
        }
      ], 'Data corruption', owner);

      assert.equal(getQuarantinedItems(owner).length, 1);
      assert.equal(getOfflineQueue(owner).length, 0);

      let fetchInvoked = false;
      const mockFetch = async (url?: any, init?: any) => {
        fetchInvoked = true;
        return { ok: true, status: 200, json: async () => { const b = typeof init !== 'undefined' && init?.body ? JSON.parse(init.body) : {}; return { success: true, log: { date: b.date || b.id || '1403-12-01', cycleId: 'cyc_test', revision: 2, wakeUp: true, workout: true, study: false, journal: false, hardTask: false, specialMission: false }, cycle: { id: b.id || b.date || 'cyc_test', revision: 2, title: 'test', startDate: '2026-09-01', endDate: '2026-09-30' } }; } } as any;
      };

      const result = await replayAccountOfflineQueue({
        activeAccountId: owner,
        authToken: 'valid-token',
        fetchFn: mockFetch
      });

      assert.equal(result.syncedCount, 0);
      assert.equal(fetchInvoked, false, 'Quarantine data must never be fetched or replayed');
      assert.equal(getQuarantinedItems(owner).length, 1, 'Quarantine remains preserved');
    });

    it('Scenario 19: The production entry point (main.tsx) renders App.tsx directly and does not mount BushidoProvider', async () => {
      const fs = await import('node:fs');
      const mainContent = fs.readFileSync('src/main.tsx', 'utf-8');

      // main.tsx mounts <App />
      assert.ok(mainContent.includes('<App'), 'main.tsx must mount App');
      // main.tsx does NOT mount BushidoProvider
      assert.ok(!mainContent.includes('BushidoProvider'), 'main.tsx must NOT mount BushidoProvider');

      // BushidoContext has architectural notice
      const contextContent = fs.readFileSync('src/context/BushidoContext.tsx', 'utf-8');
      assert.ok(contextContent.includes('ARCHITECTURAL NOTICE - SPRINT 3B.1 CONTRACT'), 'BushidoContext has architectural notice');
    });

    it('Scenario 20: The production runtime (App.tsx) has authoritative online listener and migration', async () => {
      const fs = await import('node:fs');
      const appContent = fs.readFileSync('src/App.tsx', 'utf-8');

      // App.tsx invokes migrateLegacyGlobalQueue on mount
      assert.ok(appContent.includes('migrateLegacyGlobalQueue();'), 'App.tsx calls migrateLegacyGlobalQueue on mount');

      // App.tsx registers the authoritative browser online listener
      assert.ok(appContent.includes("window.addEventListener('online'"), 'App.tsx registers online listener');
      assert.ok(appContent.includes("window.removeEventListener('online'"), 'App.tsx unregisters online listener');

      // Replay is triggered through replayAccountOfflineQueue
      assert.ok(appContent.includes('replayAccountOfflineQueue'), 'App.tsx triggers replayAccountOfflineQueue');
    });
  });
});
