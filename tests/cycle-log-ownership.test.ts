import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  memoryStore,
  saveLocalStore,
  loadLocalStore,
  setPrismaState,
  getUserCycles,
  getCycleById,
  createCycle,
  updateCycle,
  archiveCycle,
  restoreCycle,
  deleteCycle,
  getUserDailyLogs,
  getDailyLogById,
  getDailyLogByDate,
  upsertDailyLog,
  deleteDailyLog,
  deleteDailyLogByDate
} from '../server/db/index.js';

describe('Phase 3A.2: Server-Side Cycle and DailyLog Ownership Integrity', () => {
  const userA = 'user-alpha-001';
  const userB = 'user-beta-002';
  const attackerUser = 'attacker-evil-999';

  beforeEach(() => {
    // Force memory store mode for deterministic local isolation (no live DB mutation)
    setPrismaState(null, false);
    memoryStore.cycles = [];
    memoryStore.dailyLogs = [];
    memoryStore.users = [];
    saveLocalStore();
  });

  // ---------------------------------------------------------------------------
  // Test A: User A creates a Cycle -> Cycle is owned by User A.
  // ---------------------------------------------------------------------------
  it('Test A: User A creates a Cycle -> Cycle is owned strictly by User A', async () => {
    const cycle = await createCycle(userA, {
      title: 'چرخه اول آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      targetTheme: 'amber',
      inheritedStreak: 5,
      rules: ['بیداری سحرگاهی', 'ورزش سامورایی']
    });

    assert.ok(cycle.id);
    assert.equal(cycle.userId, userA);
    assert.equal(cycle.title, 'چرخه اول آلفا');
    assert.equal(cycle.isArchived, false);

    // Verify in storage
    const inStore = memoryStore.cycles.find(c => c.id === cycle.id);
    assert.ok(inStore);
    assert.equal(inStore.userId, userA);
  });

  // ---------------------------------------------------------------------------
  // Test B: User A lists Cycles -> Sees only User A's Cycles.
  // ---------------------------------------------------------------------------
  it('Test B: User A lists Cycles -> Sees only User A cycles and not foreign cycles', async () => {
    await createCycle(userA, {
      title: 'چرخه ۱ آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    await createCycle(userA, {
      title: 'چرخه ۲ آلفا',
      startDate: '2026-10-01',
      endDate: '2026-10-31'
    });
    await createCycle(userB, {
      title: 'چرخه ۱ بتا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    const userACycles = await getUserCycles(userA);
    assert.equal(userACycles.length, 2);
    assert.ok(userACycles.every(c => c.userId === userA));
    assert.ok(userACycles.some(c => c.title === 'چرخه ۱ آلفا'));
    assert.ok(userACycles.some(c => c.title === 'چرخه ۲ آلفا'));
    assert.ok(!userACycles.some(c => c.title === 'چرخه ۱ بتا'));
  });

  // ---------------------------------------------------------------------------
  // Test C: User B lists Cycles -> Sees only User B's Cycles; cannot see User A's Cycles.
  // ---------------------------------------------------------------------------
  it('Test C: User B lists Cycles -> Sees only User B cycles, zero leakage of User A data', async () => {
    await createCycle(userA, {
      title: 'چرخه محرمانه آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    await createCycle(userB, {
      title: 'چرخه عمومی بتا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    const userBCycles = await getUserCycles(userB);
    assert.equal(userBCycles.length, 1);
    assert.equal(userBCycles[0].userId, userB);
    assert.equal(userBCycles[0].title, 'چرخه عمومی بتا');
  });

  // ---------------------------------------------------------------------------
  // Test D: User B attempts to read/update/delete/archive User A's Cycle -> Rejected, untouched.
  // ---------------------------------------------------------------------------
  it('Test D: User B attempts to read, update, archive or delete User A Cycle -> Rejected, Cycle remains untouched', async () => {
    const cycleA = await createCycle(userA, {
      title: 'چرخه دست‌نخورده آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      targetTheme: 'amber'
    });

    // 1. User B tries to read User A's cycle by ID
    const readAttempt = await getCycleById(userB, cycleA.id);
    assert.equal(readAttempt, null, 'User B must not be able to read User A cycle by ID');

    // 2. User B tries to update User A's cycle
    const updateAttempt = await updateCycle(userB, cycleA.id, {
      title: 'هک شده توسط کاربر ب',
      targetTheme: 'crimson'
    });
    assert.equal(updateAttempt, null, 'User B must not be able to update User A cycle');

    // 3. User B tries to archive User A's cycle
    const archiveAttempt = await archiveCycle(userB, cycleA.id);
    assert.equal(archiveAttempt, null, 'User B must not be able to archive User A cycle');

    // 4. User B tries to delete User A's cycle
    const deleteAttempt = await deleteCycle(userB, cycleA.id);
    assert.equal(deleteAttempt, false, 'User B must not be able to delete User A cycle');

    // Verify User A's cycle is completely intact in database
    const cycleAVerify = await getCycleById(userA, cycleA.id);
    assert.ok(cycleAVerify);
    assert.equal(cycleAVerify.title, 'چرخه دست‌نخورده آلفا');
    assert.equal(cycleAVerify.targetTheme, 'amber');
    assert.equal(cycleAVerify.isArchived, false);
    assert.equal(cycleAVerify.userId, userA);
  });

  // ---------------------------------------------------------------------------
  // Test E: User A creates a DailyLog for User A's Cycle -> Owned by User A, linked to Cycle A.
  // ---------------------------------------------------------------------------
  it('Test E: User A creates a DailyLog for User A Cycle -> Owned by User A and linked to Cycle A', async () => {
    const cycleA = await createCycle(userA, {
      title: 'چرخه اصلی آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    const logA = await upsertDailyLog(userA, {
      cycleId: cycleA.id,
      date: '2026-09-05',
      wakeUp: true,
      workout: true,
      study: true,
      journal: false,
      hardTask: true,
      specialMission: false,
      notes: 'تمرین سحرگاهی سامورایی'
    });

    assert.ok(logA.id);
    assert.equal(logA.userId, userA);
    assert.equal(logA.cycleId, cycleA.id);
    assert.equal(logA.date, '2026-09-05');
    assert.equal(logA.wakeUp, true);

    // Verify retrieved by user
    const fetchedLogs = await getUserDailyLogs(userA, cycleA.id);
    assert.equal(fetchedLogs.length, 1);
    assert.equal(fetchedLogs[0].id, logA.id);
    assert.equal(fetchedLogs[0].userId, userA);
  });

  // ---------------------------------------------------------------------------
  // Test F: User B attempts to create/upsert a DailyLog referencing User A's Cycle -> Rejected before writing.
  // ---------------------------------------------------------------------------
  it('Test F: User B attempts to upsert DailyLog referencing User A Cycle -> Rejected before writing, 0 cross-user records', async () => {
    const cycleA = await createCycle(userA, {
      title: 'چرخه خصوصی آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    // User B tries to insert a log referencing cycleA.id
    await assert.rejects(
      async () => {
        await upsertDailyLog(userB, {
          cycleId: cycleA.id,
          date: '2026-09-06',
          wakeUp: true,
          workout: true,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false
        });
      },
      (err: any) => {
        assert.ok(err.code === 'CYCLE_NOT_FOUND' || err.message?.includes('Cycle not found'));
        return true;
      }
    );

    // Verify no logs were inserted for User B or under Cycle A
    assert.equal(memoryStore.dailyLogs.length, 0);
    const userBLogs = await getUserDailyLogs(userB);
    assert.equal(userBLogs.length, 0);
    const userALogs = await getUserDailyLogs(userA);
    assert.equal(userALogs.length, 0);
  });

  // ---------------------------------------------------------------------------
  // Test G: User B attempts to read/update/delete User A's DailyLog -> Rejected, intact.
  // ---------------------------------------------------------------------------
  it('Test G: User B attempts to read or delete User A DailyLog -> Rejected, User A log remains intact', async () => {
    const cycleA = await createCycle(userA, {
      title: 'چرخه آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });

    const logA = await upsertDailyLog(userA, {
      cycleId: cycleA.id,
      date: '2026-09-10',
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true,
      specialMission: true,
      notes: 'رکورد بی‌نقص'
    });

    // 1. User B tries to read User A's log by ID
    const readLogAttempt = await getDailyLogById(userB, logA.id);
    assert.equal(readLogAttempt, null);

    // 2. User B tries to read User A's log by Date
    const readDateAttempt = await getDailyLogByDate(userB, '2026-09-10');
    assert.equal(readDateAttempt, null);

    // 3. User B tries to delete User A's log by ID
    const deleteAttempt = await deleteDailyLog(userB, logA.id);
    assert.equal(deleteAttempt, false);

    // 4. User B tries to delete User A's log by Date
    const deleteDateAttempt = await deleteDailyLogByDate(userB, '2026-09-10');
    assert.equal(deleteDateAttempt, false);

    // Verify User A's log is completely preserved
    const logAVerify = await getDailyLogById(userA, logA.id);
    assert.ok(logAVerify);
    assert.equal(logAVerify.notes, 'رکورد بی‌نقص');
    assert.equal(logAVerify.userId, userA);
  });

  // ---------------------------------------------------------------------------
  // Test H: Client payload supplying a different userId -> Server ignores/overrides with authenticated user.
  // ---------------------------------------------------------------------------
  it('Test H: Client payload attempting userId spoofing -> Server strictly binds to authenticated userId', async () => {
    // Attempting to spoof User A's ID while authenticated as Attacker
    const cycle = await createCycle(attackerUser, {
      title: 'چرخه مهاجم',
      startDate: '2026-09-01',
      endDate: '2026-09-30',
      // Client sends malicious userId in extra payload
      ...({ userId: userA } as any)
    });

    assert.equal(cycle.userId, attackerUser, 'Created cycle must belong to attackerUser, not spoofed userA');

    // Attempting to update cycle with spoofed userId
    const updated = await updateCycle(attackerUser, cycle.id, {
      title: 'عنوان تغییر یافته',
      // Malicious attempt to transfer ownership
      ...({ userId: userA, id: 'new-stolen-id' } as any)
    });

    assert.ok(updated);
    assert.equal(updated.userId, attackerUser, 'Ownership must NOT be transferable via update payload');
    assert.equal(updated.id, cycle.id, 'Cycle ID must be immutable');
  });

  // ---------------------------------------------------------------------------
  // Test I: Deleting a Cycle deletes only the DailyLogs belonging to that Cycle and User.
  // ---------------------------------------------------------------------------
  it('Test I: Deleting a Cycle cascades only to owned DailyLogs, leaving foreign cycles and logs intact', async () => {
    // User A Cycle 1 with 2 logs
    const cycleA1 = await createCycle(userA, {
      title: 'چرخه ۱ آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    await upsertDailyLog(userA, {
      cycleId: cycleA1.id,
      date: '2026-09-01',
      wakeUp: true,
      workout: true,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false
    });
    await upsertDailyLog(userA, {
      cycleId: cycleA1.id,
      date: '2026-09-02',
      wakeUp: true,
      workout: false,
      study: true,
      journal: false,
      hardTask: false,
      specialMission: false
    });

    // User A Cycle 2 with 1 log
    const cycleA2 = await createCycle(userA, {
      title: 'چرخه ۲ آلفا',
      startDate: '2026-10-01',
      endDate: '2026-10-31'
    });
    await upsertDailyLog(userA, {
      cycleId: cycleA2.id,
      date: '2026-10-01',
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true,
      specialMission: true
    });

    // User B Cycle 1 with 1 log
    const cycleB1 = await createCycle(userB, {
      title: 'چرخه ۱ بتا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    await upsertDailyLog(userB, {
      cycleId: cycleB1.id,
      date: '2026-09-01',
      wakeUp: true,
      workout: true,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false
    });

    // User A deletes Cycle A1
    const deleteResult = await deleteCycle(userA, cycleA1.id);
    assert.equal(deleteResult, true);

    // Verify Cycle A1 is gone
    const userACycles = await getUserCycles(userA);
    assert.equal(userACycles.length, 1);
    assert.equal(userACycles[0].id, cycleA2.id);

    // Verify Cycle A1 logs are gone, but Cycle A2 log remains
    const userALogs = await getUserDailyLogs(userA);
    assert.equal(userALogs.length, 1);
    assert.equal(userALogs[0].cycleId, cycleA2.id);

    // Verify User B's Cycle and Log are 100% untouched
    const userBCycles = await getUserCycles(userB);
    assert.equal(userBCycles.length, 1);
    assert.equal(userBCycles[0].id, cycleB1.id);

    const userBLogs = await getUserDailyLogs(userB);
    assert.equal(userBLogs.length, 1);
    assert.equal(userBLogs[0].cycleId, cycleB1.id);
  });

  // ---------------------------------------------------------------------------
  // Test J: Querying foreign cycleId in getUserDailyLogs returns empty, 0 leakage.
  // ---------------------------------------------------------------------------
  it('Test J: User B querying logs with User A cycleId returns empty array, zero foreign data leakage', async () => {
    const cycleA = await createCycle(userA, {
      title: 'چرخه بسیار محرمانه آلفا',
      startDate: '2026-09-01',
      endDate: '2026-09-30'
    });
    await upsertDailyLog(userA, {
      cycleId: cycleA.id,
      date: '2026-09-01',
      wakeUp: true,
      workout: true,
      study: true,
      journal: true,
      hardTask: true,
      specialMission: true,
      notes: 'یادداشت‌های محرمانه آلفا'
    });

    // User B tries to query logs for User A's cycle
    const userBLogsForCycleA = await getUserDailyLogs(userB, cycleA.id);
    assert.equal(userBLogsForCycleA.length, 0, 'Must return empty array for foreign cycle query');
  });
});
