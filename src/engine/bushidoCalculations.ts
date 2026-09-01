import { 
  DailyLog, 
  Cycle, 
  CycleMetrics, 
  DailyComputed, 
  HabitDef, 
  VulnerableHabit, 
  DisciplineLevel, 
  DayStatusType, 
  CycleStatusType 
} from '../types';
import { addDaysToDate, daysBetween, getLogicalTodayDate } from '../utils/dateUtils';
import { toPersianDigits } from '../utils/numberUtils';

export const FOUNDATION_HABITS: HabitDef[] = [
  {
    key: 'wakeUp',
    title: 'Early Rise',
    titleFa: 'سحرخیزی',
    subtitleFa: 'بیدارباش سر ساعت بدون بهانه',
    iconName: 'Sun',
    color: 'amber'
  },
  {
    key: 'workout',
    title: 'Workout',
    titleFa: 'ورزش و تحرک',
    subtitleFa: 'فعالیت بدنی هدفمند و منظم',
    iconName: 'Dumbbell',
    color: 'emerald'
  },
  {
    key: 'study',
    title: 'Study & Reading',
    titleFa: 'مطالعه تخصصی',
    subtitleFa: 'تغذیه ذهن و یادگیری عمیق',
    iconName: 'BookOpen',
    color: 'blue'
  },
  {
    key: 'journal',
    title: 'Journaling',
    titleFa: 'ژورنال‌نویسی',
    subtitleFa: 'ثبت روزانه، تحلیل ذهن و شفافیت',
    iconName: 'PenTool',
    color: 'violet'
  },
  {
    key: 'hardTask',
    title: 'Deep Hard Task',
    titleFa: 'کار سخت روز',
    subtitleFa: 'سنگین‌ترین قورباغه روزکاری',
    iconName: 'Briefcase',
    color: 'rose'
  }
];

export function createEmptyCycleMetrics(): CycleMetrics {
  return {
    cycle: {
      id: '',
      title: 'بدون چرخه فعال',
      startDate: '',
      endDate: '',
      targetTheme: 'تسلط بر سحرخیزی و دیسیپلین آهنین',
      rules: [],
      isArchived: false,
      reportRead: false,
      inheritedStreak: 0
    },
    status: 'active',
    statusLabelFa: 'بدون چرخه فعال',
    elapsedDays: 0,
    remainingDays: 90,
    logsCount: 0,
    standardDaysCount: 0,
    burnedDaysCount: 0,
    unresolvedDebtCount: 0,
    resolvedDebtCount: 0,
    frozenDaysCount: 0,
    inactiveDaysCount: 0,
    incompleteDaysCount: 0,
    totalScore: 0,
    disciplineScore: 0,
    disciplinePercentage: 0,
    disciplineLevel: '🛡️ انضباط آهنین',
    pureStreak: 0,
    maxPureStreak: 0,
    inheritedStreak: 0,
    globalLiveStreak: 0,
    maxGlobalStreak: 0,
    maxFailureRun: 0,
    maxInactiveRun: 0,
    maxIncompleteRun: 0,
    dominantFailureReason: 'بدون شکست',
    dominantFailureTime: 'بدون شکست',
    vulnerableHabits: [],
    needsIntervention: false,
    isCourtReady: false,
    coachMessage: 'برای شروع، نخستین چرخه ۹۰ روزه خود را ایجاد و ثبت روزانه را آغاز کنید'
  };
}

/**
 * Computes individual daily log properties strictly per Notion Formula 2.0 specs
 */
export function computeDailyProperties(
  log: DailyLog, 
  allCycleLogs: DailyLog[], 
  logicalToday: string = getLogicalTodayDate(),
  cycleStartDate?: string
): DailyComputed {
  const habitsCount = [
    log.wakeUp,
    log.workout,
    log.study,
    log.journal,
    log.hardTask
  ].filter(Boolean).length;

  const isStandard = habitsCount === 5;
  const missionScore = log.specialMission ? 2 : 0;
  const bonusScore = isStandard ? 3 : 0;
  const score = Math.min(10, habitsCount + missionScore + bonusScore);

  let statusType: DayStatusType;
  if (isStandard) {
    statusType = 'standard';
  } else if (log.failureReason === 'دلایل شخصی') {
    statusType = 'personal_frozen';
  } else if (log.failureReason && log.failureTime) {
    statusType = 'burned_resolved';
  } else {
    statusType = 'burned_unresolved';
  }

  // A day only strictly requires autopsy if it is in the past (< logicalToday) and not standard/frozen
  const needsAutopsy = log.date < logicalToday && !isStandard && statusType === 'burned_unresolved';

  // Check if previous days strictly before this date (within the cycle) have unresolved debts
  // Evaluates every calendar day between cycle start and this date/today to ensure absent/missing days are counted
  let pastUnresolvedCount = 0;
  if (cycleStartDate && log.date > cycleStartDate) {
    let checkDate = cycleStartDate;
    while (checkDate < log.date && checkDate < logicalToday) {
      const existing = allCycleLogs.find(
        l => l.date === checkDate && (!log.cycleId || !l.cycleId || l.cycleId === log.cycleId)
      );
      if (!existing) {
        // Missing past calendar day in cycle is automatically an open unresolved debt
        pastUnresolvedCount += 1;
      } else {
        const lCount = [existing.wakeUp, existing.workout, existing.study, existing.journal, existing.hardTask].filter(Boolean).length;
        const lStandard = lCount === 5;
        if (!lStandard && existing.failureReason !== 'دلایل شخصی') {
          if (!existing.failureReason || !existing.failureTime) {
            pastUnresolvedCount += 1;
          }
        }
      }
      checkDate = addDaysToDate(checkDate, 1);
    }
  } else {
    pastUnresolvedCount = allCycleLogs.filter(l => {
      if (log.cycleId && l.cycleId && l.cycleId !== log.cycleId) return false;
      if (l.date >= log.date || l.date >= logicalToday) return false;
      const lCount = [l.wakeUp, l.workout, l.study, l.journal, l.hardTask].filter(Boolean).length;
      const lStandard = lCount === 5;
      if (lStandard || l.failureReason === 'دلایل شخصی') return false;
      return !l.failureReason || !l.failureTime;
    }).length;
  }

  const isLockedDueToPastDebt = log.date === logicalToday && pastUnresolvedCount > 0;

  // Rich coach status label (Disciplined, Stoic & Professional)
  let coachStatusLabel = '';
  const smTag = log.specialMission ? ' + ماموریت ویژه' : '';

  if (log.date > logicalToday) {
    const diff = daysBetween(logicalToday, log.date);
    if (diff === 1) {
      coachStatusLabel = 'فردا هنوز فرا نرسیده است. تمرکز بر فتح روز جاری است.';
    } else {
      coachStatusLabel = `${toPersianDigits(diff)} روز تا این تاریخ باقی است. تمرکز بر روز جاری است.`;
    }
  } else if (log.date < logicalToday) {
    if (statusType === 'personal_frozen') {
      coachStatusLabel = 'توقف اضطراری؛ زنجیره بدون آسیب حفظ شد.';
    } else if (isStandard) {
      coachStatusLabel = 'روز استاندارد تثبیت شد' + smTag;
    } else if (statusType === 'burned_unresolved') {
      coachStatusLabel = 'نیازمند کالبدشکافی؛ ثبت علت افت الزامی است.';
    } else {
      coachStatusLabel = 'پرونده شکست با ثبت کالبدشکافی بسته شد.';
    }
  } else {
    // Is today
    if (isStandard) {
      coachStatusLabel = log.specialMission
        ? 'کمال تعهد با ۵ پایه و ماموریت ویژه ثبت شد.'
        : 'روز استاندارد با ۵ پایه فونداسیون تثبیت شد.';
    } else if (statusType === 'personal_frozen') {
      coachStatusLabel = 'توقف اضطراری؛ زنجیره در امان است.';
    } else if (habitsCount === 4) {
      coachStatusLabel = 'فقط ۱ پایه تا استانداردسازی روز فاصله دارید.' + smTag;
    } else if (habitsCount >= 1 && habitsCount <= 3) {
      coachStatusLabel = `${toPersianDigits(5 - habitsCount)} پایه تا استانداردسازی روز باقی مانده است.` + smTag;
    } else {
      coachStatusLabel = 'روز در جریان است؛ ثبت پایه‌های فونداسیون را آغاز کنید.';
    }
  }

  const displayScore = score === 10 ? 'کمال تعهد: ۱۰ از ۱۰' : `امتیاز ارزش روز: ${toPersianDigits(score)} از ۱۰`;
  const filledChar = '■ ';
  const emptyChar = '□ ';
  const displayProgressBlocks = filledChar.repeat(score) + emptyChar.repeat(Math.max(0, 10 - score));

  return {
    isStandard,
    habitsCount,
    score,
    statusType,
    needsAutopsy,
    isLockedDueToPastDebt,
    coachStatusLabel,
    displayScore,
    displayProgressBlocks
  };
}

/**
 * Computes Cycle Metrics strictly adhering to the PDF formulas (OCR pages 27-59)
 */
export function computeCycleMetrics(
  cycle: Cycle,
  logs: DailyLog[],
  allCycles: Cycle[] = [],
  logicalToday: string = getLogicalTodayDate()
): CycleMetrics {
  // Sort logs by date ascending
  const cycleLogs = logs
    .filter(l => l.cycleId === cycle.id || (!l.cycleId && l.date >= cycle.startDate && l.date <= cycle.endDate))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Determine cycle status
  const cycleStartDate = cycle.startDate;
  const cycleEndDate = cycle.endDate || addDaysToDate(cycle.startDate, 89);
  
  let status: CycleStatusType = 'active';
  let statusLabelFa = '⚡ چرخه فعال';

  // Check overlap with other active cycles
  const otherCycles = allCycles.filter(c => c.id !== cycle.id);
  const hasOverlap = otherCycles.some(oc => {
    const ocEnd = oc.endDate || addDaysToDate(oc.startDate, 89);
    return !(cycleEndDate < oc.startDate || cycleStartDate > ocEnd);
  });

  if (hasOverlap) {
    status = 'overlap_error';
    statusLabelFa = '⚠️ تداخل تقویمی چرخه';
  } else if (cycle.isArchived) {
    status = 'archived';
    statusLabelFa = '📦 بایگانی شده';
  } else if (logicalToday < cycleStartDate) {
    status = 'upcoming';
    statusLabelFa = '⏳ چرخه آینده';
  } else if (logicalToday > cycleEndDate) {
    if (cycle.reportRead) {
      status = 'archived';
      statusLabelFa = '📦 بایگانی شده';
    } else {
      status = 'ready_for_court';
      statusLabelFa = '⚖️ آماده برای قرارگاه بوشیدو';
    }
  } else {
    status = 'active';
    statusLabelFa = '⚡ چرخه فعال';
  }

  // Elapsed and remaining days (capped 0 to 90)
  let elapsedDays = 0;
  if (logicalToday < cycleStartDate) {
    elapsedDays = 0;
  } else if (logicalToday > cycleEndDate) {
    elapsedDays = 90;
  } else {
    elapsedDays = Math.min(90, Math.max(1, daysBetween(cycleStartDate, logicalToday) + 1));
  }
  const remainingDays = Math.max(0, 90 - elapsedDays);

  // Build full synthesized timeline up to logicalToday or cycleEndDate
  // This guarantees absent days (where user didn't log) are accurately recognized as open debts / inactive days
  const effectiveEnd = logicalToday > cycleEndDate ? cycleEndDate : logicalToday;
  const synthesizedList: { log: DailyLog; computed: DailyComputed }[] = [];
  
  if (status !== 'upcoming') {
    let curr = cycleStartDate;
    while (curr <= effectiveEnd) {
      let existingLog = cycleLogs.find(l => l.date === curr);
      if (!existingLog) {
        existingLog = {
          id: `virtual-${curr}`,
          cycleId: cycle.id,
          date: curr,
          createdAt: new Date().toISOString(),
          wakeUp: false,
          workout: false,
          study: false,
          journal: false,
          hardTask: false,
          specialMission: false
        };
      }
      synthesizedList.push({
        log: existingLog,
        computed: computeDailyProperties(existingLog, cycleLogs, logicalToday, cycleStartDate)
      });
      curr = addDaysToDate(curr, 1);
    }
  }

  // Also include any future logs that might have been created or modified
  cycleLogs.forEach(l => {
    if (l.date > effectiveEnd) {
      synthesizedList.push({
        log: l,
        computed: computeDailyProperties(l, cycleLogs, logicalToday, cycleStartDate)
      });
    }
  });

  const computedList = synthesizedList;

  const logsCount = cycleLogs.length;
  const standardDaysCount = computedList.filter(c => c.computed.isStandard).length;
  
  const unresolvedDebtCount = computedList.filter(
    c => c.log.date < logicalToday && c.computed.statusType === 'burned_unresolved'
  ).length;

  const resolvedDebtCount = computedList.filter(
    c => c.computed.statusType === 'burned_resolved'
  ).length;

  const burnedDaysCount = unresolvedDebtCount + resolvedDebtCount;
  
  const frozenDaysCount = computedList.filter(
    c => c.computed.statusType === 'personal_frozen'
  ).length;

  const inactiveDaysCount = computedList.filter(
    c => c.computed.statusType !== 'personal_frozen' && c.computed.habitsCount === 0 && !c.computed.isStandard
  ).length;

  const incompleteDaysCount = computedList.filter(
    c => c.computed.statusType !== 'personal_frozen' && c.computed.habitsCount > 0 && !c.computed.isStandard
  ).length;

  const totalScore = computedList.reduce((acc, curr) => acc + curr.computed.score, 0);

  // Discipline Score & Phantom Denominator (Pages 46-47)
  const todayLog = computedList.find(c => c.log.date === logicalToday);
  const isTodayCompleted = todayLog ? (todayLog.computed.isStandard || !!todayLog.log.failureReason) : false;

  const validLogs = computedList.filter(c => 
    c.log.date <= logicalToday && (c.log.date < logicalToday || isTodayCompleted)
  );

  const n_frozen = validLogs.filter(c => c.computed.statusType === 'personal_frozen').length;
  const raw_elapsed = (status === 'active') ? (elapsedDays - 1 + (isTodayCompleted ? 1 : 0)) : elapsedDays;
  const evaluated_days = Math.max(0, raw_elapsed - n_frozen);

  const n1 = validLogs.filter(c => c.computed.statusType === 'standard').length;
  const n2 = validLogs.filter(c => c.computed.statusType === 'burned_resolved' && c.computed.habitsCount > 0).length;
  const n3 = validLogs.filter(c => c.computed.statusType === 'burned_resolved' && c.computed.habitsCount === 0).length;
  const n4 = validLogs.filter(c => c.computed.statusType === 'burned_unresolved' && c.computed.habitsCount > 0).length;
  const n5 = validLogs.filter(c => c.computed.statusType === 'burned_unresolved' && c.computed.habitsCount === 0).length;

  const active_valid_count = validLogs.filter(c => c.computed.statusType !== 'personal_frozen').length;
  const missing_days = Math.max(0, evaluated_days - active_valid_count);

  const phantom_denominator = evaluated_days + (0.2 * n3) + (1.5 * n4) + (3.0 * (n5 + missing_days));
  
  let disciplineScore = 1.0;
  if (evaluated_days > 0 && phantom_denominator > 0) {
    disciplineScore = Math.max(0, Math.min(1, n1 / phantom_denominator));
  } else if (evaluated_days === 0) {
    disciplineScore = 1.0;
  }
  const disciplinePercentage = Math.round(disciplineScore * 100);

  let disciplineLevel: DisciplineLevel = '🛡️ انضباط آهنین';
  if (status === 'upcoming') {
    disciplineLevel = '⏳ آینده';
  } else if (status === 'overlap_error') {
    disciplineLevel = '⚠️ خطای ساختار';
  } else if (disciplineScore >= 0.8) {
    disciplineLevel = '🛡️ انضباط آهنین';
  } else if (disciplineScore >= 0.6) {
    disciplineLevel = '⚔️ انضباط پایدار';
  } else if (disciplineScore >= 0.4) {
    disciplineLevel = '👺 انضباط ناپایدار';
  } else {
    disciplineLevel = '👹 بحران تعهد';
  }

  // Pure Streak & Max Pure Streak calculation (OCR Page 36 & 53)
  // Walk logs in chronological order up to today
  let currentPureStreak = 0;
  let maxPureStreak = 0;
  let runningStreak = 0;
  
  const pastAndTodayLogs = computedList
    .filter(c => c.log.date <= logicalToday)
    .sort((a, b) => a.log.date.localeCompare(b.log.date));

  for (let i = 0; i < pastAndTodayLogs.length; i++) {
    const item = pastAndTodayLogs[i];
    const isToday = item.log.date === logicalToday;

    // Check gaps with previous log
    if (i > 0) {
      const prev = pastAndTodayLogs[i - 1];
      const gap = daysBetween(prev.log.date, item.log.date) - 1;
      if (gap > 0) {
        runningStreak = 0; // gap breaks streak
      }
    }

    if (item.computed.isStandard) {
      runningStreak += 1;
      if (runningStreak > maxPureStreak) maxPureStreak = runningStreak;
    } else if (item.computed.statusType === 'personal_frozen') {
      // Frozen day passes through without resetting the streak, but doesn't add to count
      // streak continues
    } else if (isToday && !item.log.failureReason) {
      // Today is in progress! Day has not failed and is still open.
      // Retain continuous streak accumulated up to yesterday.
    } else {
      // Burned past day or explicitly failed day resets streak
      runningStreak = 0;
    }
  }
  currentPureStreak = runningStreak;

  const inheritedStreak = cycle.inheritedStreak || 0;
  const globalLiveStreak = inheritedStreak + currentPureStreak;
  const maxGlobalStreak = Math.max(inheritedStreak + maxPureStreak, globalLiveStreak);

  // Failure and Inactive Runs
  let maxFailureRun = 0;
  let currFailureRun = 0;
  let maxInactiveRun = 0;
  let currInactiveRun = 0;
  let maxIncompleteRun = 0;
  let currIncompleteRun = 0;

  pastAndTodayLogs.forEach(item => {
    if (item.computed.statusType === 'burned_unresolved' || item.computed.statusType === 'burned_resolved') {
      currFailureRun += 1;
      if (currFailureRun > maxFailureRun) maxFailureRun = currFailureRun;
    } else {
      currFailureRun = 0;
    }

    if (item.computed.statusType !== 'personal_frozen' && item.computed.habitsCount === 0 && !item.computed.isStandard) {
      currInactiveRun += 1;
      if (currInactiveRun > maxInactiveRun) maxInactiveRun = currInactiveRun;
    } else {
      currInactiveRun = 0;
    }

    if (item.computed.statusType !== 'personal_frozen' && item.computed.habitsCount > 0 && !item.computed.isStandard) {
      currIncompleteRun += 1;
      if (currIncompleteRun > maxIncompleteRun) maxIncompleteRun = currIncompleteRun;
    } else {
      currIncompleteRun = 0;
    }
  });

  // Dominant Failure Reasons and Times
  const reasonCounts: Record<string, number> = {};
  const timeCounts: Record<string, number> = {};

  cycleLogs.forEach(l => {
    if (l.failureReason && l.failureReason !== 'دلایل شخصی') {
      reasonCounts[l.failureReason] = (reasonCounts[l.failureReason] || 0) + 1;
    }
    if (l.failureTime) {
      timeCounts[l.failureTime] = (timeCounts[l.failureTime] || 0) + 1;
    }
  });

  let dominantFailureReason = 'بدون شکست';
  let maxRCount = 0;
  Object.entries(reasonCounts).forEach(([r, c]) => {
    if (c > maxRCount) {
      maxRCount = c;
      dominantFailureReason = r;
    }
  });

  let dominantFailureTime = 'بدون شکست';
  let maxTCount = 0;
  Object.entries(timeCounts).forEach(([t, c]) => {
    if (c > maxTCount) {
      maxTCount = c;
      dominantFailureTime = t;
    }
  });

  // Vulnerability Analysis (< 70% success threshold per OCR page 44-45)
  const activeBase = Math.max(1, logsCount - frozenDaysCount);
  const vulnerableHabits: VulnerableHabit[] = [];

  FOUNDATION_HABITS.forEach(h => {
    const successCount = cycleLogs.filter(l => l[h.key]).length;
    const ratePct = Math.round((successCount / activeBase) * 100);
    if (logsCount > 0 && ratePct < 70) {
      vulnerableHabits.push({
        key: h.key,
        titleFa: h.titleFa,
        ratePct,
        successCount,
        totalEvaluated: activeBase,
        icon: h.iconName
      });
    }
  });

  const needsIntervention = status === 'active' && (
    disciplineLevel === '👹 بحران تعهد' || unresolvedDebtCount >= 2
  );

  const isCourtReady = remainingDays === 0 && unresolvedDebtCount === 0 && logsCount >= 85;

  // Cycle Coach Behavioral Message (OCR Page 50)
  let coachMessage = '';
  if (status === 'overlap_error') {
    coachMessage = '⚠️ تداخل تقویمی │ این چرخه با یکی از چرخه‌های دیگر تداخل زمانی دارد';
  } else if (status === 'upcoming') {
    coachMessage = '⏳ در انتظار آغاز │ این دوره هنوز فعال نشده است';
  } else if (isCourtReady) {
    coachMessage = '⚖️ گزارش میدان نبرد آماده هست │ برای دریافت حکم نهایی به دادگاه بوشیدو مراجعه کنید';
  } else if (remainingDays === 0) {
    coachMessage = '🚨 چرخه منقضی شده │ برای دریافت گزارش نهایی، بررسی‌های باقیمانده را انجام دهید';
  } else if (disciplineLevel === '👹 بحران تعهد') {
    coachMessage = '🔴 بحران دیسیپلین │ امتیاز انضباط به پایین‌ترین سطح رسیده است. سریعاً به میدان نبرد برگردید!';
  } else if (unresolvedDebtCount >= 2) {
    coachMessage = `🚨 نیازمند مداخله فوری │ ${unresolvedDebtCount} روز بدهی کالبدشکافی نشده وجود دارد. سیستم قفل شده است!`;
  } else if (unresolvedDebtCount === 1) {
    coachMessage = '⚠️ روز بررسی نشده │ ۱ روز بررسی نشده از قبل دارید. قبل از بحرانی شدن پرونده‌اش را ببندید';
  } else if (burnedDaysCount > 0 && unresolvedDebtCount === 0 && disciplineLevel !== '🛡️ انضباط آهنین') {
    coachMessage = '🛡️ دارای پتانسیل جهش │ با تمرکز بیشتر می‌توانید به انضباط آهنین برسید';
  } else {
    coachMessage = '🟢 انضباط آهنین │ این سطح از تعهد و دیسیپلین را تا پایان چرخه ۹۰ روزه حفظ کن';
  }

  return {
    cycle,
    status,
    statusLabelFa,
    elapsedDays,
    remainingDays,
    logsCount,
    standardDaysCount,
    burnedDaysCount,
    unresolvedDebtCount,
    resolvedDebtCount,
    frozenDaysCount,
    inactiveDaysCount,
    incompleteDaysCount,
    totalScore,
    disciplineScore,
    disciplinePercentage,
    disciplineLevel,
    pureStreak: currentPureStreak,
    maxPureStreak,
    inheritedStreak,
    globalLiveStreak,
    maxGlobalStreak,
    maxFailureRun,
    maxInactiveRun,
    maxIncompleteRun,
    dominantFailureReason,
    dominantFailureTime,
    vulnerableHabits,
    needsIntervention,
    isCourtReady,
    coachMessage
  };
}
