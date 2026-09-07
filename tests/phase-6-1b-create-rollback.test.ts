import test from 'node:test';
import assert from 'node:assert/strict';
import { rollbackOptimisticCycleCreate } from '../src/utils/directMutationUtils.js';
import { Cycle, DailyLog } from '../src/types.js';

test('Phase 6.1B Create Cycle Rollback Helper', async (t) => {

  const demoCycle: Cycle = {
    id: 'cycle-1',
    title: 'چرخه (نمونه)',
    startDate: '2025-01-01',
    endDate: '2025-03-01',
    targetTheme: 'focus',
    inheritedStreak: 0,
    isArchived: false,
    reportRead: false
  };

  const demoLog: DailyLog = {
    id: 'log-1',
    cycleId: 'cycle-1',
    date: '2025-01-01',
    checks: [],
    pureStreak: 0,
    isSynced: true
  };

  const newCycle: Cycle = {
    id: 'cycle-2',
    title: 'چرخه واقعی',
    startDate: '2025-01-05',
    endDate: '2025-04-05',
    targetTheme: 'health',
    inheritedStreak: 0,
    isArchived: false,
    reportRead: false
  };

  await t.test('Storage failure during Create restores previous Cycles & DailyLogs completely', () => {
    // 1. Initial State (baseline)
    const previousCycles = [demoCycle];
    const previousLogs = [demoLog];

    // 2. Optimistic state (demo removed, new added)
    const optimisticCycles = [newCycle];
    const optimisticLogs: DailyLog[] = []; // empty

    // 3. Rollback
    const { nextCycles, nextLogs } = rollbackOptimisticCycleCreate(
      optimisticCycles,
      optimisticLogs,
      newCycle.id,
      previousCycles,
      previousLogs
    );

    // 4. Verification
    assert.equal(nextCycles.length, 1);
    assert.equal(nextCycles[0].id, 'cycle-1');
    assert.equal(nextLogs.length, 1);
    assert.equal(nextLogs[0].id, 'log-1');
  });

  await t.test('Definitive server rejection (400, 403, 422) restores complete baseline without touching other concurrent edits', () => {
    const previousCycles = [demoCycle];
    const previousLogs = [demoLog];

    const anotherLog: DailyLog = {
      id: 'log-2',
      cycleId: 'cycle-1',
      date: '2025-01-02',
      checks: [],
      pureStreak: 0,
      isSynced: true
    };

    // User created cycle, and concurrently another tab or process added a log
    const optimisticCycles = [newCycle];
    const optimisticLogs = [anotherLog]; 

    const { nextCycles, nextLogs } = rollbackOptimisticCycleCreate(
      optimisticCycles,
      optimisticLogs,
      newCycle.id,
      previousCycles,
      previousLogs
    );

    // Verify it brought back the demo cycle
    assert.ok(nextCycles.find(c => c.id === 'cycle-1'), 'Previous cycle restored');
    // Verify it removed the new cycle
    assert.ok(!nextCycles.find(c => c.id === 'cycle-2'), 'New cycle removed');
    // Verify it brought back the demo log
    assert.ok(nextLogs.find(l => l.id === 'log-1'), 'Previous log restored');
    // Verify it KEPT the concurrently added log
    assert.ok(nextLogs.find(l => l.id === 'log-2'), 'Concurrent log kept');
  });
});
