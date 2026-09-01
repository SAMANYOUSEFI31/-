import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { 
  computeDailyProperties, 
  computeCycleMetrics, 
  createEmptyCycleMetrics 
} from '../src/engine/bushidoCalculations.js';
import { DailyLog, Cycle } from '../src/types.js';

describe('Bushido Discipline Engine - Pure Functions', () => {
  const logicalToday = '2026-09-01';

  describe('Daily Score & Status Calculations', () => {
    it('calculates 8/10 for standard day (5/5 habits) without special mission', () => {
      const log: DailyLog = {
        id: 'log-1',
        cycleId: 'cycle-1',
        date: '2026-09-01',
        createdAt: new Date().toISOString(),
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: false
      };

      const result = computeDailyProperties(log, [log], logicalToday);
      assert.equal(result.habitsCount, 5);
      assert.equal(result.isStandard, true);
      assert.equal(result.score, 8); // 5 habits + 3 standard bonus = 8
      assert.equal(result.statusType, 'standard');
    });

    it('calculates 10/10 mastery for standard day (5/5 habits) with special mission', () => {
      const log: DailyLog = {
        id: 'log-1',
        cycleId: 'cycle-1',
        date: '2026-09-01',
        createdAt: new Date().toISOString(),
        wakeUp: true,
        workout: true,
        study: true,
        journal: true,
        hardTask: true,
        specialMission: true
      };

      const result = computeDailyProperties(log, [log], logicalToday);
      assert.equal(result.habitsCount, 5);
      assert.equal(result.isStandard, true);
      assert.equal(result.score, 10); // 5 habits + 3 bonus + 2 mission = 10
      assert.equal(result.statusType, 'standard');
    });

    it('calculates partial score correctly for incomplete days', () => {
      const log: DailyLog = {
        id: 'log-2',
        cycleId: 'cycle-1',
        date: '2026-09-01',
        createdAt: new Date().toISOString(),
        wakeUp: true,
        workout: true,
        study: true,
        journal: false,
        hardTask: false,
        specialMission: false
      };

      const result = computeDailyProperties(log, [log], logicalToday);
      assert.equal(result.habitsCount, 3);
      assert.equal(result.isStandard, false);
      assert.equal(result.score, 3);
      assert.equal(result.statusType, 'burned_unresolved');
    });

    it('classifies personal emergency freeze as personal_frozen without punishing streak', () => {
      const log: DailyLog = {
        id: 'log-3',
        cycleId: 'cycle-1',
        date: '2026-08-30',
        createdAt: new Date().toISOString(),
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        failureReason: 'دلایل شخصی',
        failureTime: 'وسط روز'
      };

      const result = computeDailyProperties(log, [log], logicalToday);
      assert.equal(result.statusType, 'personal_frozen');
      assert.equal(result.needsAutopsy, false);
    });

    it('marks past incomplete day with missing autopsy as burned_unresolved and needsAutopsy', () => {
      const log: DailyLog = {
        id: 'log-4',
        cycleId: 'cycle-1',
        date: '2026-08-30',
        createdAt: new Date().toISOString(),
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false
      };

      const result = computeDailyProperties(log, [log], logicalToday);
      assert.equal(result.statusType, 'burned_unresolved');
      assert.equal(result.needsAutopsy, true);
    });

    it('marks past incomplete day with completed autopsy as burned_resolved', () => {
      const log: DailyLog = {
        id: 'log-5',
        cycleId: 'cycle-1',
        date: '2026-08-30',
        createdAt: new Date().toISOString(),
        wakeUp: true,
        workout: false,
        study: false,
        journal: false,
        hardTask: false,
        specialMission: false,
        failureReason: 'وقتم رو به خوبی مدیریت نکردم',
        failureTime: 'آخر روز',
        countermeasure: 'قانون ۳۰ دقیقه اول'
      };

      const result = computeDailyProperties(log, [log], logicalToday);
      assert.equal(result.statusType, 'burned_resolved');
      assert.equal(result.needsAutopsy, false);
    });
  });

  describe('Cycle Metrics & Pure Streak Calculation', () => {
    const cycle: Cycle = {
      id: 'cycle-test-1',
      title: 'چرخه آزمایشی ۹۰ روزه',
      startDate: '2026-08-01',
      endDate: '2026-10-29',
      targetTheme: 'تسلط بر سحرخیزی',
      inheritedStreak: 5,
      rules: ['ساعت ۵:۳۰ صبح'],
      isArchived: false,
      reportRead: false
    };

    it('handles empty cycle gracefully', () => {
      const empty = createEmptyCycleMetrics();
      assert.equal(empty.status, 'active');
      assert.equal(empty.totalScore, 0);
      assert.equal(empty.pureStreak, 0);
    });

    it('accurately calculates continuous Pure Streak through consecutive standard days', () => {
      const logs: DailyLog[] = [
        {
          id: 'l-1',
          cycleId: cycle.id,
          date: '2026-08-28',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false
        },
        {
          id: 'l-2',
          cycleId: cycle.id,
          date: '2026-08-29',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: true
        },
        {
          id: 'l-3',
          cycleId: cycle.id,
          date: '2026-08-30',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false
        }
      ];

      const metrics = computeCycleMetrics(cycle, logs, [cycle], '2026-08-30');
      assert.equal(metrics.pureStreak, 3);
      assert.equal(metrics.maxPureStreak, 3);
      assert.equal(metrics.globalLiveStreak, 8); // 5 inherited + 3 current
    });

    it('preserves Pure Streak across personal emergency freeze days without incrementing count', () => {
      const logs: DailyLog[] = [
        {
          id: 'l-1',
          cycleId: cycle.id,
          date: '2026-08-28',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false
        },
        {
          id: 'l-2',
          cycleId: cycle.id,
          date: '2026-08-29',
          createdAt: '',
          wakeUp: false, workout: false, study: false, journal: false, hardTask: false, specialMission: false,
          failureReason: 'دلایل شخصی'
        },
        {
          id: 'l-3',
          cycleId: cycle.id,
          date: '2026-08-30',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false
        }
      ];

      const metrics = computeCycleMetrics(cycle, logs, [cycle], '2026-08-30');
      assert.equal(metrics.pureStreak, 2); // 2 standard days, freeze did NOT reset streak
      assert.equal(metrics.frozenDaysCount, 1);
    });

    it('resets Pure Streak to 0 on burned past day', () => {
      const logs: DailyLog[] = [
        {
          id: 'l-1',
          cycleId: cycle.id,
          date: '2026-08-28',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false
        },
        {
          id: 'l-2',
          cycleId: cycle.id,
          date: '2026-08-29',
          createdAt: '',
          wakeUp: false, workout: false, study: false, journal: false, hardTask: false, specialMission: false,
          failureReason: 'تنبل بودم'
        },
        {
          id: 'l-3',
          cycleId: cycle.id,
          date: '2026-08-30',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false
        }
      ];

      const metrics = computeCycleMetrics(cycle, logs, [cycle], '2026-08-30');
      assert.equal(metrics.pureStreak, 1); // Streak reset on 08-29, restart from 08-30
      assert.equal(metrics.maxPureStreak, 1);
    });

    it('correctly calculates discipline score and phantom denominator', () => {
      const logs: DailyLog[] = [
        {
          id: 'l-1',
          cycleId: cycle.id,
          date: '2026-08-01',
          createdAt: '',
          wakeUp: true, workout: true, study: true, journal: true, hardTask: true, specialMission: false
        }
      ];

      const metrics = computeCycleMetrics(cycle, logs, [cycle], '2026-08-01');
      assert.ok(metrics.disciplineScore > 0);
      assert.ok(metrics.disciplinePercentage >= 0 && metrics.disciplinePercentage <= 100);
    });
  });
});
