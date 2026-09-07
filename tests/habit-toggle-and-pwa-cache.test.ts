import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  applyReplayItemToActiveState,
  applyOptimisticLogUpdate,
  rollbackOptimisticLogUpdate
} from '../src/utils/directMutationUtils.js';
import {
  saveOfflineQueue,
  getOfflineQueue
} from '../src/utils/offlineQueueUtils.js';
import { DailyLog } from '../src/types.js';

test('Rapid Habit Toggles & PWA Deployment Caching Test Suite', async (t) => {
  const dummyOwner = 'user_habit_toggle_test';
  const storageMock: Record<string, string> = {};

  // Setup / Teardown
  const cleanup = () => {
    for (const k in storageMock) delete storageMock[k];
    (globalThis as any).window = {
      localStorage: {
        getItem: (key: string) => storageMock[key] ?? null,
        setItem: (key: string, val: string) => { storageMock[key] = String(val); },
        removeItem: (key: string) => { delete storageMock[key]; }
      }
    };
    saveOfflineQueue(dummyOwner, []);
  };

  cleanup();

  await t.test('1. Service Worker defines v4 cache versions and Network-First for scripts and styles', () => {
    const swPath = path.join(process.cwd(), 'public', 'sw.js');
    const swContent = fs.readFileSync(swPath, 'utf8');

    assert.ok(
      swContent.includes("'bushido-static-v4'"),
      'SW must define bushido-static-v4 as static cache name'
    );
    assert.ok(
      swContent.includes("'bushido-runtime-v4'"),
      'SW must define bushido-runtime-v4 as runtime cache name'
    );
    assert.ok(
      swContent.includes('isScriptOrStyle'),
      'SW must include specific handling for scripts and stylesheets'
    );
    assert.ok(
      swContent.includes('self.skipWaiting()'),
      'SW must call skipWaiting on install'
    );
    assert.ok(
      swContent.includes('self.clients.claim()'),
      'SW must call clients.claim on activate'
    );
  });

  await t.test('2. applyReplayItemToActiveState preserves optimistic habit changes when a newer mutation exists in offline queue', () => {
    const targetDate = '2026-09-07';
    const cycleId = 'cycle_habit_test_1';

    const baseLog: DailyLog = {
      id: 'log_1',
      cycleId,
      date: targetDate,
      wakeUp: true,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false,
      revision: 1,
      createdAt: '2026-09-07T08:00:00Z',
      isSynced: false
    };

    // Simulate item 1 (workout toggle to true) replay response from server
    const item1 = {
      id: 'queue_op_1',
      type: 'UPDATE_LOG',
      ownerId: dummyOwner,
      dedupKey: `log:${cycleId}:${targetDate}`,
      payload: { ...baseLog, workout: true }
    };

    const serverResult1 = {
      log: {
        id: 'log_1',
        cycleId,
        date: targetDate,
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 2,
        createdAt: '2026-09-07T08:00:00Z',
        updatedAt: '2026-09-07T08:01:00Z'
      }
    };

    // Case A: Queue has a newer item (item 2 toggling workout back to false and study to true)
    const item2 = {
      id: 'queue_op_2',
      type: 'UPDATE_LOG',
      ownerId: dummyOwner,
      dedupKey: `log:${cycleId}:${targetDate}`,
      payload: { ...baseLog, workout: false, study: true, revision: 2 },
      timestamp: Date.now() + 100
    };
    saveOfflineQueue(dummyOwner, [item2 as any]);

    // Current active state has optimistic state of item 2 (workout: false, study: true)
    const currentActiveState = {
      cycles: [],
      logs: [{ ...baseLog, workout: false, study: true, revision: 1, isSynced: false }]
    };

    const stateAfterReplay1 = applyReplayItemToActiveState(
      currentActiveState,
      item1 as any,
      serverResult1
    );

    // Assert that active state did NOT overwrite optimistic workout: false with serverResult1 workout: true
    assert.equal(
      stateAfterReplay1.logs[0].workout,
      false,
      'Active state must preserve optimistic workout: false while newer mutation is in queue'
    );
    assert.equal(
      stateAfterReplay1.logs[0].study,
      true,
      'Active state must preserve optimistic study: true'
    );
    assert.equal(
      stateAfterReplay1.logs[0].revision,
      2,
      'Active state must update to server revision 2'
    );
    assert.equal(
      stateAfterReplay1.logs[0].isSynced,
      false,
      'Log must remain isSynced: false because a newer edit is pending'
    );

    // Case B: Once all queue items are drained, replaying the final item marks isSynced: true
    saveOfflineQueue(dummyOwner, []);
    const serverResult2 = {
      log: {
        id: 'log_1',
        cycleId,
        date: targetDate,
        wakeUp: true,
        workout: false,
        study: true,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 3,
        createdAt: '2026-09-07T08:00:00Z',
        updatedAt: '2026-09-07T08:02:00Z'
      }
    };

    const stateAfterReplay2 = applyReplayItemToActiveState(
      stateAfterReplay1,
      item2 as any,
      serverResult2
    );

    assert.equal(stateAfterReplay2.logs[0].workout, false);
    assert.equal(stateAfterReplay2.logs[0].study, true);
    assert.equal(stateAfterReplay2.logs[0].revision, 3);
    assert.equal(
      stateAfterReplay2.logs[0].isSynced,
      true,
      'Log must be marked isSynced: true when no newer items exist in queue'
    );
  });

  await t.test('3. applyOptimisticLogUpdate correctly marks isSynced: false on rapid habit toggles', () => {
    const existingLogs: DailyLog[] = [
      {
        id: 'log_1',
        cycleId: 'c1',
        date: '2026-09-07',
        wakeUp: true,
        workout: true,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        revision: 1,
        isSynced: true,
        createdAt: '2026-09-07T08:00:00Z'
      }
    ];

    // Tap 1: study toggle
    const tap1Update: DailyLog = {
      ...existingLogs[0],
      study: true
    };
    const { nextLogs: logsAfterTap1 } = applyOptimisticLogUpdate(existingLogs, tap1Update);

    assert.equal(logsAfterTap1[0].study, true);
    assert.equal(logsAfterTap1[0].isSynced, false, 'isSynced must be false during in-flight edit');

    // Tap 2: rapid subsequent tap toggling journal on the output of Tap 1
    const tap2Update: DailyLog = {
      ...logsAfterTap1[0],
      journal: true
    };
    const { nextLogs: logsAfterTap2 } = applyOptimisticLogUpdate(logsAfterTap1, tap2Update);

    assert.equal(logsAfterTap2[0].study, true, 'study must remain true');
    assert.equal(logsAfterTap2[0].journal, true, 'journal must be true');
    assert.equal(logsAfterTap2[0].isSynced, false);

    // Rollback check
    const rolledBack = rollbackOptimisticLogUpdate(logsAfterTap2, '2026-09-07', existingLogs[0]);
    assert.equal(rolledBack[0].study, false, 'Rolled back study must be false');
    assert.equal(rolledBack[0].journal, false, 'Rolled back journal must be false');
    assert.equal(rolledBack[0].isSynced, true, 'Rolled back state must restore original isSynced: true');
  });

  cleanup();
});
