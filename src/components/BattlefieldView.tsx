import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DailyLog, Cycle, CycleMetrics, HabitKey } from '../types';
import { FOUNDATION_HABITS, computeDailyProperties } from '../engine/bushidoCalculations';
import { formatPersianDate, getLogicalTodayDate, addDaysToDate, getRelativeDateLabel } from '../utils/dateUtils';
import { toPersianDigits } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { safeGetLocalStorage, safeSetLocalStorage } from '../utils/storageUtils';
import { OnboardingWelcomeView } from './OnboardingWelcomeView';
import { 
  Sun, 
  Dumbbell, 
  BookOpen, 
  PenTool, 
  Briefcase, 
  Target, 
  CheckCircle2, 
  AlertTriangle, 
  Lock, 
  Flame, 
  Snowflake, 
  Sparkles, 
  Calendar, 
  ChevronRight, 
  ChevronLeft, 
  ShieldAlert, 
  Zap, 
  FileText, 
  Clock,
  Swords,
  ShieldCheck,
  X,
  Compass,
  Rocket,
  Check
} from 'lucide-react';

interface BattlefieldViewProps {
  currentCycle: Cycle | null;
  metrics?: CycleMetrics | null;
  logs: DailyLog[];
  selectedDate: string;
  nightOwlCutoffHour?: number;
  onSelectDate: (date: string) => void;
  onUpdateLog: (log: DailyLog) => void;
  onOpenAutopsy: (log: DailyLog) => void;
  onNavigateToArchives?: () => void;
  onOpenCreateCycle?: () => void;
  onNavigateToHabitsGuide?: () => void;
}

const HABIT_ICONS: Record<HabitKey, React.ReactNode> = {
  wakeUp: <Sun className="w-5 h-5" />,
  workout: <Dumbbell className="w-5 h-5" />,
  study: <BookOpen className="w-5 h-5" />,
  journal: <PenTool className="w-5 h-5" />,
  hardTask: <Briefcase className="w-5 h-5" />
};

const BattlefieldViewComponent: React.FC<BattlefieldViewProps> = ({
  currentCycle,
  metrics,
  logs,
  selectedDate,
  nightOwlCutoffHour = 4,
  onSelectDate,
  onUpdateLog,
  onOpenAutopsy,
  onNavigateToArchives,
  onOpenCreateCycle,
  onNavigateToHabitsGuide
}) => {
  const logicalToday = getLogicalTodayDate();
  const isToday = selectedDate === logicalToday;
  const isCycleArchived = !!currentCycle?.isArchived;
  const isFuture = selectedDate > logicalToday;
  const isPast = selectedDate < logicalToday;

  // Single-time swipe hint state persisted in localStorage
  const [hasSeenSwipeHint, setHasSeenSwipeHint] = useState<boolean>(() => {
    try {
      return localStorage.getItem('bushido_has_seen_swipe_hint') === 'true';
    } catch (e) {
      return false;
    }
  });

  const dismissSwipeHint = () => {
    setHasSeenSwipeHint(true);
    try {
      localStorage.setItem('bushido_has_seen_swipe_hint', 'true');
    } catch (e) {}
  };

  // Demo data clarification banner state (persisted)
  const [hasDismissedDemoBanner, setHasDismissedDemoBanner] = useState<boolean>(() => {
    return safeGetLocalStorage('bushido_demo_banner_dismissed') === 'true';
  });

  const dismissDemoBanner = () => {
    setHasDismissedDemoBanner(true);
    safeSetLocalStorage('bushido_demo_banner_dismissed', 'true');
  };

  // Find or construct memoized stable log for selected date
  const activeLog: DailyLog = useMemo(() => {
    const found = logs.find(l => l.date === selectedDate);
    if (found) return found;
    return {
      id: `log-${selectedDate}`,
      cycleId: currentCycle?.id || '',
      date: selectedDate,
      createdAt: new Date().toISOString(),
      wakeUp: false,
      workout: false,
      study: false,
      journal: false,
      hardTask: false,
      specialMission: false
    };
  }, [logs, selectedDate, currentCycle?.id]);

  // Local state for smooth, real-time typing in notes without UI stutter
  const [notesValue, setNotesValue] = useState(activeLog?.notes || '');
  const [isSaved, setIsSaved] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep latest notes, activeLog, and handler in refs to guarantee zero data-loss on rapid unmount / date switch / rapid habit taps
  const latestNotesRef = useRef(notesValue);
  latestNotesRef.current = notesValue;

  const latestActiveLogRef = useRef<DailyLog>(activeLog);

  // Sync ref with props/state whenever activeLog changes
  useEffect(() => {
    if (activeLog && activeLog.date === selectedDate) {
      latestActiveLogRef.current = activeLog;
    }
  }, [activeLog, selectedDate]);

  const onUpdateLogRef = useRef(onUpdateLog);
  onUpdateLogRef.current = onUpdateLog;

  const isCycleArchivedRef = useRef(isCycleArchived);
  isCycleArchivedRef.current = isCycleArchived;

  const isFutureRef = useRef(isFuture);
  isFutureRef.current = isFuture;

  // Flush any pending note changes immediately
  const flushPendingNotes = useCallback(() => {
    const currentActiveLog = (latestActiveLogRef.current && latestActiveLogRef.current.date === selectedDate)
      ? latestActiveLogRef.current
      : activeLog;
    if (!currentActiveLog || isCycleArchivedRef.current || isFutureRef.current) return;
    const currentVal = latestNotesRef.current;
    if (currentVal !== (currentActiveLog.notes || '')) {
      const updated: DailyLog = {
        ...currentActiveLog,
        notes: currentVal
      };
      latestActiveLogRef.current = updated;
      onUpdateLogRef.current(updated);
      setIsSaved(true);
    }
  }, [selectedDate, activeLog]);

  // Sync with selected date changes while flushing any unsaved pending edits from the previous date
  const lastSyncDateRef = useRef(selectedDate);
  useEffect(() => {
    if (lastSyncDateRef.current !== selectedDate) {
      flushPendingNotes();
      setNotesValue(activeLog?.notes || '');
      setIsSaved(true);
      lastSyncDateRef.current = selectedDate;
      latestActiveLogRef.current = activeLog;
    } else if (isSaved && notesValue !== (activeLog?.notes || '')) {
      setNotesValue(activeLog?.notes || '');
    }
  }, [selectedDate, activeLog?.notes, isSaved, flushPendingNotes, activeLog]);

  // Auto-resize textarea height to fit content naturally without awkward drag scroll
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(80, textareaRef.current.scrollHeight)}px`;
    }
  }, [notesValue]);

  // Ensure any unsaved pending notes are always flushed on unmount
  useEffect(() => {
    return () => {
      flushPendingNotes();
    };
  }, [flushPendingNotes]);

  // Debounced auto-save to global store
  useEffect(() => {
    if (isCycleArchived || isFuture || isSaved) return;

    const timer = setTimeout(() => {
      const currentActiveLog = (latestActiveLogRef.current && latestActiveLogRef.current.date === selectedDate)
        ? latestActiveLogRef.current
        : activeLog;
      if (currentActiveLog) {
        const updated: DailyLog = {
          ...currentActiveLog,
          notes: notesValue
        };
        latestActiveLogRef.current = updated;
        onUpdateLogRef.current(updated);
        setIsSaved(true);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [notesValue, isSaved, isCycleArchived, isFuture, selectedDate, activeLog]);

  // Track navigation direction for directional slide animation (1: next, -1: prev)
  const [navDirection, setNavDirection] = useState<number>(0);

  // Touch swipe gesture handlers (smart touch-area: works across canvas with strict deliberate thresholds)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const cycleStartDate = currentCycle?.startDate || '';

  const computed = useMemo(() => {
    return computeDailyProperties(activeLog, logs, logicalToday, cycleStartDate);
  }, [activeLog, logs, logicalToday, cycleStartDate]);

  // Find all unresolved past days that cause system lock (strictly before today) across the full timeline from cycle start
  const unresolvedPastLogs: DailyLog[] = useMemo(() => {
    const list: DailyLog[] = [];
    if (!currentCycle) return list;
    if (cycleStartDate && cycleStartDate < logicalToday) {
      let checkDate = cycleStartDate;
      while (checkDate < logicalToday) {
        let l = logs.find(item => item.date === checkDate);
        if (!l) {
          l = {
            id: `virtual-${checkDate}`,
            cycleId: currentCycle.id,
            date: checkDate,
            createdAt: new Date().toISOString(),
            wakeUp: false,
            workout: false,
            study: false,
            journal: false,
            hardTask: false,
            specialMission: false
          };
        }
        const c = computeDailyProperties(l, logs, logicalToday, cycleStartDate);
        if (c.statusType === 'burned_unresolved') {
          list.push(l);
        }
        checkDate = addDaysToDate(checkDate, 1);
      }
    }
    return list;
  }, [currentCycle, cycleStartDate, logs, logicalToday]);

  // 1. Guard against No Active Cycle / Empty State with Comprehensive Onboarding
  // (Placed AFTER all hooks to strictly adhere to React Rules of Hooks)
  if (!currentCycle || !metrics) {
    return (
      <OnboardingWelcomeView
        onOpenCreateCycle={onOpenCreateCycle || onNavigateToArchives || (() => {})}
        onNavigateToHabitsGuide={onNavigateToHabitsGuide || (() => {})}
      />
    );
  }

  const isLocked = (unresolvedPastLogs.length > 0 && isToday) || isCycleArchived || isFuture;

  const toggleHabit = (key: HabitKey) => {
    if (isCycleArchived) {
      soundFX.playWarning();
      return;
    }

    if (isFuture) {
      soundFX.playWarning();
      haptics.warningAlert();
      return;
    }

    if (isLocked) {
      soundFX.playWarning();
      haptics.warningAlert();
      return;
    }

    // Always compute next state from the latest known log for selectedDate to prevent race conditions on rapid taps
    const baseLog = (latestActiveLogRef.current && latestActiveLogRef.current.date === selectedDate)
      ? latestActiveLogRef.current
      : activeLog;

    const nextVal = !baseLog[key];
    const updated: DailyLog = {
      ...baseLog,
      [key]: nextVal
    };

    // Immediately record locally so subsequent clicks in the same frame/tick build on top of this state
    latestActiveLogRef.current = updated;

    const habitKeys: HabitKey[] = ['wakeUp', 'workout', 'study', 'journal', 'hardTask'];
    const wasStandard = habitKeys.every(k => baseLog[k]);
    const willBeStandard = habitKeys.every(k => (k === key ? nextVal : updated[k]));

    if (!nextVal) {
      // Unchecking habit
      haptics.uncheckTap();
    } else if (!wasStandard && willBeStandard) {
      if (updated.specialMission) {
        // 10/10 Mastery - Noble Bronze Harmonized Resonance
        soundFX.playMastery();
        haptics.masterySuccess();
      } else {
        // 8/10 Standard Day - Emerald Vitality
        soundFX.playStandardDay();
        haptics.standardDaySuccess();
      }
    } else {
      soundFX.playCheck();
      haptics.lightTap();
    }

    onUpdateLog(updated);
  };

  const toggleSpecialMission = () => {
    if (isCycleArchived || isLocked || isFuture) {
      soundFX.playWarning();
      haptics.warningAlert();
      return;
    }

    // Always compute next state from the latest known log for selectedDate to prevent race conditions on rapid taps
    const baseLog = (latestActiveLogRef.current && latestActiveLogRef.current.date === selectedDate)
      ? latestActiveLogRef.current
      : activeLog;

    const nextVal = !baseLog.specialMission;
    const updated: DailyLog = {
      ...baseLog,
      specialMission: nextVal
    };

    // Immediately record locally so subsequent clicks in the same frame/tick build on top of this state
    latestActiveLogRef.current = updated;

    const habitKeys: HabitKey[] = ['wakeUp', 'workout', 'study', 'journal', 'hardTask'];
    const isStandard = habitKeys.every(k => updated[k]);

    if (!nextVal) {
      haptics.uncheckTap();
    } else if (nextVal && isStandard) {
      // Reached 10/10 Mastery
      soundFX.playMastery();
      haptics.masterySuccess();
    } else {
      soundFX.playCheck();
      haptics.lightTap();
    }

    onUpdateLog(updated);
  };

  const handleNotesChange = (val: string) => {
    if (isCycleArchived || isFuture) return;
    setNotesValue(val);
    if (isSaved) {
      setIsSaved(false);
    }
  };

  const handleNotesBlur = () => {
    if (isCycleArchived || isFuture) return;
    flushPendingNotes();
  };

  const navigateDate = (newDate: string, direction: number) => {
    setNavDirection(direction);
    // Navigation is completely silent per Apple HIG & BENCHMARKS.md audio ergonomics
    onSelectDate(newDate);
    if (!hasSeenSwipeHint) {
      dismissSwipeHint();
    }
  };

  // Touch swipe gesture handlers (smart touch-area: works across canvas with strict deliberate thresholds)
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, select, [data-no-swipe], [contenteditable="true"]')) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    // Intentional ergonomic gesture detection (APCA / Stoic touch standard):
    // 1. Vector slope: deltaX dominates deltaY (slope > 1.25) to avoid false triggers during vertical scrolling
    // 2. Deliberate horizontal stroke (>= 40px) or rapid flick (>= 28px in < 320ms)
    const isQuickFlick = elapsed < 320 && Math.abs(deltaX) >= 28;
    const isStandardSwipe = Math.abs(deltaX) >= 40;

    if ((isStandardSwipe || isQuickFlick) && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      if (deltaX < 0) {
        // Swipe Left -> Next Day in RTL
        navigateDate(addDaysToDate(selectedDate, 1), 1);
      } else {
        // Swipe Right -> Prev Day in RTL
        navigateDate(addDaysToDate(selectedDate, -1), -1);
      }
    }
  };

  const isDemoCycle = currentCycle.id === 'cycle-1' || currentCycle.title.includes('چرخه ۱') || currentCycle.title.includes('فونداسیون');

  return (
    <div 
      className="space-y-4 sm:space-y-6 max-w-5xl mx-auto touch-pan-y w-full select-none" 
      dir="rtl"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 0. Demo Scenario Clarification Notice */}
      {isDemoCycle && !hasDismissedDemoBanner && (
        <div className="w-full surface-z1 border border-amber-subtle radius-card p-3 sm:p-4 text-xs shadow-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 radius-control bg-amber-subtle border border-amber-subtle text-amber flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4 text-amber" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-role-primary">پیش‌نمایش داده‌های شبیه‌سازی‌شده (Demo Seed)</span>
                <span className="text-[10px] bg-amber-subtle text-amber border border-amber-subtle px-2 py-0.5 radius-micro font-mono">
                  ۲۴ روز نمونه
                </span>
              </div>
              <p className="text-[11px] text-role-secondary mt-0.5 leading-relaxed">
                شما در حال بررسی سناریوی نمایشی بوشیدو هستید. جهت شروع پیشرفت واقعی، می‌توانید چرخه اختصاصی جدیدی آغاز کنید.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
            {onOpenCreateCycle && (
              <button
                type="button"
                onClick={onOpenCreateCycle}
                className="bg-amber hover:brightness-110 text-black font-black text-xs px-3.5 py-1.5 radius-control transition cursor-pointer active:scale-95 shadow-subtle whitespace-nowrap focus-ring-tactical"
              >
                شروع چرخه واقعی
              </button>
            )}
            <button
              type="button"
              onClick={dismissDemoBanner}
              className="text-role-secondary hover:text-role-primary p-1.5 radius-control border-standard surface-z1 hover:surface-z2 transition cursor-pointer focus-ring-tactical"
              title="بستن اعلان"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 1. Fully Responsive Ergonomic Date Navigator Bar */}
      <div className="w-full surface-z1 border-standard radius-card p-2.5 sm:p-4 shadow-subtle select-none space-y-2 sm:space-y-3">
        {/* Main Navigation Row: Prev Day + Center Date Display + Next Day */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-3 w-full">
          {/* Previous Day Button */}
          <button
            type="button"
            onClick={() => navigateDate(addDaysToDate(selectedDate, -1), -1)}
            className="h-9 sm:h-10 px-2.5 sm:px-3.5 surface-z2 hover:surface-z3 active:surface-z3 text-role-primary radius-component transition cursor-pointer inline-flex items-center justify-center gap-1 text-xs font-bold whitespace-nowrap shrink-0 border-standard shadow-subtle active:scale-95 focus-ring-tactical"
            title="رفتن به روز قبل"
            aria-label="روز قبل"
          >
            <ChevronRight className="w-4 h-4 shrink-0 text-role-muted" />
            <span className="hidden sm:inline whitespace-nowrap leading-none">روز قبل</span>
          </button>

          {/* Center Date Text (Clean Minimalist Typography, Neutral APCA-Compliant) */}
          <div className="flex-1 min-w-0 text-center px-1 flex flex-col items-center justify-center">
            <div className="text-[11px] sm:text-xs text-role-secondary font-semibold inline-flex items-center justify-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-role-muted shrink-0" />
              <span className="whitespace-nowrap">{getRelativeDateLabel(selectedDate, logicalToday)}</span>
            </div>
            <h2 className="text-xs sm:text-sm md:text-base font-black text-role-primary mt-0.5 tracking-tight font-mono whitespace-nowrap">
              {formatPersianDate(selectedDate, { withWeekday: true })}
            </h2>
          </div>

          {/* Next Day Button */}
          <button
            type="button"
            onClick={() => navigateDate(addDaysToDate(selectedDate, 1), 1)}
            className="h-9 sm:h-10 px-2.5 sm:px-3.5 surface-z2 hover:surface-z3 active:surface-z3 text-role-primary radius-component transition cursor-pointer inline-flex items-center justify-center gap-1 text-xs font-bold whitespace-nowrap shrink-0 border-standard shadow-subtle active:scale-95 focus-ring-tactical"
            title="رفتن به روز بعد"
            aria-label="روز بعد"
          >
            <span className="hidden sm:inline whitespace-nowrap leading-none">روز بعد</span>
            <ChevronLeft className="w-4 h-4 shrink-0 text-role-muted" />
          </button>
        </div>

        {/* Auxiliary Row: Night Owl Cutoff Badge (Centered & Stable) */}
        <div className="flex items-center justify-center pt-2 border-t border-standard">
          <div className="h-8 surface-z2 px-3.5 radius-component border-standard text-[11px] sm:text-xs text-role-secondary inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-subtle">
            <Clock className="w-3.5 h-3.5 text-role-muted shrink-0" />
            <span className="leading-none">کات‌آف شبانه: {toPersianDigits(nightOwlCutoffHour)}:۰۰ بامداد</span>
          </div>
        </div>
      </div>

      {/* Swipe navigation hint on mobile (Shown ONLY once for new users) */}
      {!hasSeenSwipeHint && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 surface-z1 border-standard radius-component text-[10px] text-role-secondary select-none sm:hidden -my-1 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-1.5">
            <span className="text-role-muted font-mono">‹ ›</span>
            <span>برای تغییر سریع روزها، صفحه را به چپ یا راست بکشید (Swipe)</span>
          </div>
          <button
            type="button"
            onClick={dismissSwipeHint}
            className="text-role-secondary hover:text-role-primary p-0.5 radius-micro cursor-pointer shrink-0 focus-ring-tactical"
            title="بستن راهنما"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 1.5. Dynamic Day Content with Directional Micro-Slide */}
      <div className="w-full max-w-full overflow-hidden">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={selectedDate}
            initial={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? -12 : 12) : 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? 12 : -12) : 0 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4 sm:space-y-6 w-full max-w-full"
          >
          {/* 2. Lock & Information Banners with Contextual Jump Action */}
          {isFuture ? (
            <div className="surface-z1 border-standard radius-card p-3.5 sm:p-4 text-role-primary shadow-subtle backdrop-blur-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 radius-component surface-z2 border-standard text-role-secondary flex items-center justify-center shrink-0 shadow-inner">
                    <Compass className="w-4 h-4 text-role-secondary" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs sm:text-sm font-bold text-role-primary">
                        {getRelativeDateLabel(selectedDate, logicalToday)}
                      </h3>
                      <span className="text-[10px] sm:text-[11px] surface-z2 text-role-secondary border-standard px-2 py-0.5 radius-control font-mono font-medium">
                        {formatPersianDate(selectedDate, { short: true })}
                      </span>
                    </div>
                    <p className="text-[11px] sm:text-xs text-role-secondary leading-relaxed">
                      ثبت عملکردها صرفاً در روز موعود فعال خواهد شد. تمرکز دیسیپلین بر فتح روز جاری است.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectDate(logicalToday)}
                  className="w-full sm:w-auto h-9 bg-rose-subtle hover:brightness-125 text-rose border-rose-subtle font-bold text-xs px-3.5 radius-component inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-subtle shrink-0 whitespace-nowrap active:scale-[0.98] focus-ring-tactical"
                >
                  <Zap className="w-3.5 h-3.5 text-rose shrink-0" />
                  <span className="leading-none">پرش به روز جاری</span>
                </button>
              </div>
            </div>
          ) : isPast && !isCycleArchived ? (
            <div className="surface-z1 border-standard radius-card p-3 sm:p-3.5 text-role-primary shadow-subtle">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 sm:gap-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 radius-component surface-z2 border-standard text-role-muted flex items-center justify-center shrink-0 shadow-inner">
                    <Calendar className="w-4 h-4 text-role-muted" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-role-primary">
                        مشاهده تاریخچه ({getRelativeDateLabel(selectedDate, logicalToday)})
                      </span>
                      <span className="text-[10px] surface-z2 text-role-secondary border-standard px-2 py-0.5 radius-control font-mono">
                        {formatPersianDate(selectedDate, { short: true })}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectDate(logicalToday)}
                  className="w-full sm:w-auto h-8 bg-rose-subtle hover:brightness-125 text-rose border-rose-subtle font-bold text-xs px-3 radius-component inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-subtle shrink-0 whitespace-nowrap active:scale-[0.98] focus-ring-tactical"
                >
                  <Zap className="w-3.5 h-3.5 text-rose shrink-0" />
                  <span className="leading-none">پرش به روز جاری</span>
                </button>
              </div>
            </div>
          ) : isCycleArchived ? (
            <div className="bg-purple-subtle border border-purple-subtle radius-card p-4 text-role-primary shadow-subtle">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 radius-component bg-purple-subtle text-purple flex items-center justify-center shrink-0 border border-purple-subtle">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-purple flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-purple" />
                      <span>این چرخه بایگانی شده است (فقط‌خواندنی)</span>
                    </h3>
                    <span className="text-[10px] bg-purple-subtle border border-purple-subtle text-purple px-2 py-0.5 radius-control font-bold">
                      سوابق قفل‌شده
                    </span>
                  </div>
                  <p className="text-xs text-role-secondary mt-1 leading-relaxed">
                    تمام ۹۰ روز این چرخه در دادگاه بوشیدو ارزیابی و بایگانی شده است.
                  </p>
                </div>
              </div>
            </div>
          ) : (unresolvedPastLogs.length > 0 && isToday) ? (
            <div className="bg-debt-subtle border-2 border-debt-subtle radius-card p-4 text-role-primary shadow-subtle animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 radius-component bg-debt-subtle text-debt flex items-center justify-center shrink-0 border border-debt-subtle">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-debt flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-debt" />
                      <span>قفل اجرا فعال است (Behavior Lock)</span>
                    </h3>
                    <span className="text-[10px] bg-debt-subtle border border-debt-subtle text-debt px-2 py-0.5 radius-control font-bold">
                      {toPersianDigits(unresolvedPastLogs.length)} روز بدهی باز
                    </span>
                  </div>
                  <p className="text-xs text-role-secondary mt-1 leading-relaxed">
                    پیش از ثبت روز جاری، باید روزهای سوخته گذشته کالبدشکافی شده و علت شکست ثبت گردد.
                  </p>
                  
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {unresolvedPastLogs.map(ul => (
                      <button
                        key={ul.id}
                        onClick={() => onOpenAutopsy(ul)}
                        className="bg-debt hover:brightness-110 text-white text-xs font-bold px-2.5 py-1 radius-control flex items-center gap-1.5 transition cursor-pointer shadow-subtle active:scale-95 focus-ring-tactical"
                      >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>کالبدشکافی {formatPersianDate(ul.date, { short: true })}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* 3. Daily Status & Score Header Card (Ergonomic, Balanced & Harmonious Layout) */}
          <div className="w-full max-w-full surface-z1 border-standard radius-card sm:radius-modal p-3.5 sm:p-5 relative overflow-hidden shadow-subtle">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
              <div className="space-y-2.5 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  {/* Status Pill */}
                  <span className={`px-2.5 py-1 radius-component text-[11px] sm:text-xs font-bold border inline-flex items-center gap-1.5 shrink-0 ${
                    computed.statusType === 'standard'
                      ? 'bg-emerald-subtle border-emerald-subtle text-emerald'
                      : computed.statusType === 'personal_frozen'
                      ? 'bg-blue-subtle border-blue-subtle text-blue'
                      : computed.statusType === 'burned_resolved'
                      ? 'surface-z2 border-standard text-role-primary'
                      : (isToday 
                          ? 'surface-z2 border-standard text-role-primary' 
                          : 'bg-debt-subtle border-debt-subtle text-debt')
                  }`}>
                    {computed.statusType === 'standard' && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {computed.statusType === 'personal_frozen' && <Snowflake className="w-3.5 h-3.5" />}
                    {computed.statusType === 'burned_resolved' && <FileText className="w-3.5 h-3.5" />}
                    {computed.statusType === 'burned_unresolved' && (
                      isToday ? <Clock className="w-3.5 h-3.5 text-role-muted" /> : <AlertTriangle className="w-3.5 h-3.5 text-debt" />
                    )}
                    <span>
                      {computed.statusType === 'standard' && 'تعهد کامل (Standard)'}
                      {computed.statusType === 'personal_frozen' && 'توقف اضطراری (فریز)'}
                      {computed.statusType === 'burned_resolved' && 'پرونده شکست بسته شد'}
                      {computed.statusType === 'burned_unresolved' && (isToday ? 'در جریان اجرای روز' : 'نیازمند کالبدشکافی')}
                    </span>
                  </span>

                  {/* Habit Count Badge */}
                  <span className="text-[11px] sm:text-xs text-role-secondary surface-z2 px-2.5 py-1 radius-component border-standard font-medium shrink-0">
                    {toPersianDigits(computed.habitsCount)} از {toPersianDigits(5)} پایه
                  </span>

                  {/* Streak Impact Badge */}
                  <span className={`text-[11px] sm:text-xs px-2.5 py-1 radius-component border inline-flex items-center gap-1.5 font-medium shrink-0 ${
                    computed.isStandard
                      ? 'bg-rose-subtle border-rose-subtle text-rose'
                      : computed.statusType === 'personal_frozen'
                      ? 'bg-blue-subtle border-blue-subtle text-blue'
                      : isToday
                      ? 'surface-z2 border-standard text-role-muted'
                      : 'bg-debt-subtle border-debt-subtle text-debt'
                  }`}>
                    <Flame className={`w-3.5 h-3.5 ${
                      computed.isStandard ? 'text-rose fill-current' : 'text-role-muted'
                    }`} />
                    <span>
                      {computed.isStandard
                        ? 'زنجیره حفظ شد'
                        : computed.statusType === 'personal_frozen'
                        ? 'زنجیره در امان (فریز)'
                        : isToday
                        ? 'حفظ زنجیره با ۵ پایه'
                        : 'شکست زنجیره'}
                    </span>
                  </span>
                </div>

                <p className="text-xs sm:text-sm text-role-secondary font-medium leading-relaxed min-h-[1.5rem]">
                  {computed.coachStatusLabel}
                </p>
              </div>

              {/* Score & Gauge Box (Centered, Symmetrical & Dignified Proportions with Golden Ratio micro-focusing) */}
              <div className={`border radius-card p-3.5 sm:p-5 text-center w-full max-w-[260px] mx-auto md:mx-0 md:w-[230px] md:max-w-none shrink-0 transition-all flex flex-col items-center justify-center gap-2.5 ${
                computed.score === 10
                  ? 'bg-amber-subtle border-amber-subtle shadow-subtle ring-1 ring-amber-subtle'
                  : computed.isStandard
                  ? 'bg-emerald-subtle border-emerald-subtle shadow-subtle ring-1 ring-emerald-subtle'
                  : 'surface-z2 border-standard'
              }`}>
                {/* Score Header Label */}
                <div className="text-[11px] sm:text-xs text-role-secondary font-medium flex items-center justify-center gap-1.5">
                  <span>امتیاز ارزش روز</span>
                  {computed.score === 10 && <Swords className="w-3.5 h-3.5 text-amber" />}
                  {computed.isStandard && computed.score < 10 && <ShieldCheck className="w-3.5 h-3.5 text-emerald" />}
                </div>
                
                {/* Big Score Number */}
                <div className={`text-3xl sm:text-4xl font-black flex items-baseline justify-center gap-1.5 ${
                  computed.score === 10 
                    ? 'text-amber' 
                    : computed.isStandard 
                    ? 'text-emerald' 
                    : 'text-role-primary'
                }`}>
                  <span className="leading-none">{toPersianDigits(computed.score)}</span>
                  <span className="text-xs font-semibold text-role-muted">از {toPersianDigits(10)}</span>
                </div>

                {/* Centered Status Ribbon with fixed height to prevent vertical jitter */}
                <div className="flex items-center justify-center h-7">
                  {computed.score === 10 ? (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-amber bg-amber-subtle py-1 px-3 radius-component border-amber-subtle shadow-subtle">
                      <Swords className="w-3.5 h-3.5 text-amber" />
                      <span>کمال تعهد</span>
                    </div>
                  ) : computed.isStandard ? (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald bg-emerald-subtle py-1 px-3 radius-component border-emerald-subtle shadow-subtle">
                      <ShieldCheck className="w-3.5 h-3.5 text-emerald" />
                      <span>روز استاندارد</span>
                    </div>
                  ) : (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-role-secondary surface-z3 px-3 py-1 radius-component border-standard shadow-subtle">
                      <Clock className="w-3.5 h-3.5 text-role-muted" />
                      <span>در انتظار ۵ پایه</span>
                    </div>
                  )}
                </div>

                {/* Precision 10-Segment Discipline Gauge */}
                <div className="w-full pt-2 border-t border-standard">
                  <div className="flex items-center gap-1 w-full justify-center">
                    {Array.from({ length: 10 }).map((_, idx) => {
                      const segmentIndex = idx + 1;
                      const isFilled = computed.score >= segmentIndex;
                      return (
                        <div
                          key={idx}
                          className={`h-1.5 sm:h-2 flex-1 rounded-full transition-all duration-300 ${
                            isFilled
                              ? computed.score === 10
                                ? 'bg-amber shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                                : computed.isStandard
                                ? 'bg-emerald shadow-[0_0_6px_rgba(52,211,153,0.5)]'
                                : computed.statusType === 'personal_frozen'
                                ? 'bg-blue'
                                : 'bg-[var(--color-text-secondary)]'
                              : 'surface-z1 border-standard'
                          }`}
                          title={`قطعه ${toPersianDigits(segmentIndex)} از ۱۰`}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 4. Section A: The 5 Foundation Habits (Responsive Touch-First Grid) */}
          <div className="space-y-2.5 sm:space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h3 className="font-bold text-xs sm:text-sm text-role-primary flex items-center gap-2">
                <Swords className="w-4 h-4 text-role-secondary shrink-0" />
                <span>۵ رکن تعهد فونداسیون</span>
              </h3>
              <span className="text-[11px] sm:text-xs text-role-secondary font-mono whitespace-nowrap surface-z2 px-2 py-0.5 radius-control border-standard">
                شرط روز استاندارد (۸ از ۱۰)
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 sm:gap-3">
              {FOUNDATION_HABITS.map(h => {
                const isChecked = Boolean(activeLog![h.key]);
                return (
                  <button
                    type="button"
                    key={h.key}
                    disabled={isLocked}
                    onClick={() => toggleHabit(h.key)}
                    className={`p-3 sm:p-3.5 radius-card border text-right transition-all flex items-center justify-between gap-3 group cursor-pointer active:scale-[0.98] focus-ring-tactical ${
                      isChecked
                        ? 'surface-z1 border-emerald-subtle text-role-primary shadow-subtle'
                        : 'surface-z1 border-standard text-role-secondary hover:border-[var(--color-border-hover)]'
                    } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div className={`w-9 h-9 sm:w-10 sm:h-10 radius-component flex items-center justify-center shrink-0 transition-all ${
                        isChecked
                          ? 'bg-emerald-subtle text-emerald ring-2 ring-emerald-subtle'
                          : 'surface-z2 text-role-muted group-hover:text-role-primary'
                      }`}>
                        {HABIT_ICONS[h.key]}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="font-bold text-xs sm:text-sm text-role-primary flex items-center gap-1.5 leading-snug">
                          <span className="truncate">{h.titleFa}</span>
                        </div>
                        <p className="text-[11px] text-role-secondary leading-relaxed text-right">
                          {h.subtitleFa}
                        </p>
                      </div>
                    </div>

                    <div className={`w-6 h-6 sm:w-7 sm:h-7 radius-component border flex items-center justify-center transition-all shrink-0 ${
                      isChecked
                        ? 'bg-emerald border-emerald text-black shadow-subtle scale-105'
                        : 'border-standard surface-z2 text-transparent group-hover:border-[var(--color-border-hover)]'
                    }`}>
                      <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Section B: Special Mission Accelerator */}
          <div className="space-y-2.5 sm:space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h4 className="font-bold text-xs sm:text-sm text-role-primary flex items-center gap-2">
                <Rocket className="w-4 h-4 text-amber shrink-0" />
                <span>ماموریت شتاب‌دهنده روز</span>
              </h4>
              <span className="text-[11px] sm:text-xs text-amber font-mono whitespace-nowrap bg-amber-subtle px-2 py-0.5 radius-control border border-amber-subtle">
                کمال تعهد (۱۰ از ۱۰)
              </span>
            </div>

            <button
              type="button"
              disabled={isLocked}
              onClick={toggleSpecialMission}
              className={`w-full p-3 sm:p-3.5 radius-card border text-right transition-all flex items-center justify-between gap-3 group cursor-pointer active:scale-[0.98] focus-ring-tactical ${
                activeLog?.specialMission
                  ? 'surface-z1 border-amber-subtle shadow-subtle'
                  : 'surface-z1 border-standard text-role-secondary hover:border-[var(--color-border-hover)]'
              } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 radius-component flex items-center justify-center shrink-0 transition-all ${
                  activeLog?.specialMission
                    ? 'bg-amber-subtle text-amber ring-2 ring-amber-subtle'
                    : 'surface-z2 text-role-muted group-hover:text-role-primary'
                }`}>
                  <Target className={`w-5 h-5 ${activeLog?.specialMission ? 'text-amber' : 'text-role-muted group-hover:text-role-primary'}`} />
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="font-bold text-xs sm:text-sm text-role-primary flex items-center gap-2 leading-snug">
                    <span className="truncate">ماموریت ویژه روز</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono border shrink-0 ${
                      activeLog?.specialMission
                        ? 'bg-amber-subtle text-amber border-amber-subtle'
                        : 'surface-z2 text-role-secondary border-standard'
                    }`}>
                      +{toPersianDigits(2)} امتیاز
                    </span>
                  </div>
                  <p className="text-[11px] text-role-secondary leading-relaxed text-right line-clamp-2 sm:line-clamp-none">
                    ثبت ماموریت کلیدی امروز در کنار ۵ رکن فونداسیون برای کسب امتیاز کامل ۱۰ از ۱۰.
                  </p>
                </div>
              </div>

              <div className={`w-6 h-6 sm:w-7 sm:h-7 radius-component border flex items-center justify-center transition-all shrink-0 ${
                activeLog?.specialMission
                  ? 'bg-amber border-amber text-black shadow-subtle scale-105'
                  : 'border-standard surface-z2 text-transparent group-hover:border-[var(--color-border-hover)]'
              }`}>
                <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </div>
            </button>
          </div>

          {/* 5. Failure & Autopsy Action Section (If Not Standard) */}
          {!computed.isStandard && !isFuture && (() => {
            const hasFailureReason = !!(activeLog.failureReason && activeLog.failureReason.trim() !== '');
            const hasCountermeasure = !!(activeLog.countermeasure && activeLog.countermeasure.trim() !== '');
            const cleanFailureReason = hasFailureReason ? activeLog.failureReason.trim() : '';
            const cleanCountermeasure = hasCountermeasure ? activeLog.countermeasure.trim() : '';

            return (
              <div className={`border radius-card p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 transition-all ${
                cleanFailureReason === 'دلایل شخصی'
                  ? 'bg-blue-subtle border-blue-subtle'
                  : hasFailureReason
                  ? 'surface-z1/80 border-standard'
                  : (isToday ? 'surface-z1/80 border-standard' : 'bg-debt-subtle border-debt-subtle')
              }`}>
                <div className="flex items-start sm:items-center gap-3">
                  <div className={`w-9 h-9 radius-component flex items-center justify-center shrink-0 ${
                    cleanFailureReason === 'دلایل شخصی' 
                      ? 'bg-blue-subtle text-blue border border-blue-subtle' 
                      : hasFailureReason 
                      ? 'surface-z2 text-role-primary border-standard' 
                      : (isToday ? 'surface-z2 text-role-primary border-standard' : 'bg-debt-subtle text-debt border border-debt-subtle')
                  }`}>
                    {cleanFailureReason === 'دلایل شخصی' ? (
                      <Snowflake className="w-4 h-4 text-blue" />
                    ) : hasFailureReason ? (
                      <FileText className="w-4 h-4 text-role-primary" />
                    ) : (
                      <AlertTriangle className="w-4 h-4 text-debt" />
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs sm:text-sm text-role-primary">
                      {hasFailureReason 
                        ? `علت ثبت شده: ${cleanFailureReason}` 
                        : (isToday ? 'ثبت کالبدشکافی یا توقف شخصی (اختیاری)' : 'کالبدشکافی و تسویه بدهی رفتاری')}
                    </h4>
                    <p className="text-[11px] text-role-secondary mt-0.5 leading-relaxed">
                      {hasFailureReason
                        ? (hasCountermeasure ? `پادزهر: ${cleanCountermeasure}` : 'پرونده این روز تحلیل و ثبت شده است.')
                        : (isToday 
                            ? 'در صورت مواجهه با مانع غیرمنتظره یا نیاز به فریز، می‌توانید کالبدشکافی را ثبت کنید.' 
                            : 'برای ثبت علت افت و رفع قفل دیسیپلین، کالبدشکافی این روز الزامی است.')}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onOpenAutopsy(activeLog!)}
                  className={`w-full sm:w-auto font-bold text-xs px-3.5 py-2 radius-component inline-flex items-center justify-center gap-2 transition cursor-pointer border shrink-0 whitespace-nowrap active:scale-[0.98] focus-ring-tactical ${
                    hasFailureReason
                      ? 'surface-z2 hover:surface-z3 text-role-primary border-standard'
                      : (isToday 
                          ? 'surface-z2 hover:surface-z3 text-role-primary border-standard' 
                          : 'bg-debt hover:brightness-110 text-white border-debt shadow-subtle')
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-role-secondary" />
                  <span>{hasFailureReason ? 'ویرایش کالبدشکافی' : (isToday ? 'ثبت کالبدشکافی امروز' : 'کالبدشکافی این روز')}</span>
                </button>
              </div>
            );
          })()}

          {/* 6. Daily Reflection & Strategy Notes */}
          <div className="surface-z1/80 border-standard radius-card p-3.5 sm:p-4 space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-role-primary inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-role-muted" />
                <span>یادداشت و مشاهدات میدان نبرد</span>
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                {isFuture ? (
                  <span className="text-role-muted surface-z2 px-2 py-0.5 radius-control border-standard">
                    در روز موعود فعال می‌شود
                  </span>
                ) : isCycleArchived ? (
                  <span className="text-purple bg-purple-subtle px-2 py-0.5 radius-control border border-purple-subtle">
                    بایگانی (فقط‌خواندنی)
                  </span>
                ) : (
                  <>
                    <span className={`inline-flex items-center gap-1 font-medium transition-colors ${
                      isSaved ? 'text-emerald' : 'text-amber'
                    }`}>
                      {isSaved ? (
                        <>
                          <Check className="w-3 h-3" />
                          <span>ذخیره شد</span>
                        </>
                      ) : (
                        <span>در حال ذخیره...</span>
                      )}
                    </span>
                    <span className="text-role-muted">|</span>
                    <span className="text-role-muted font-mono">
                      {notesValue ? `${toPersianDigits(notesValue.length)} کاراکتر` : 'اختیاری'}
                    </span>
                  </>
                )}
              </div>
            </div>
            
            <textarea
              ref={textareaRef}
              value={notesValue}
              onChange={e => handleNotesChange(e.target.value)}
              onBlur={handleNotesBlur}
              disabled={isFuture || isCycleArchived}
              placeholder={
                isFuture
                  ? "ثبت یادداشت‌ها و مشاهدات در روز مقرر فعال خواهد شد..."
                  : isCycleArchived
                  ? "این چرخه بایگانی شده است و یادداشت‌ها فقط‌خواندنی هستند."
                  : "ثبت دستاوردها، درس‌آموخته‌ها، چالش‌ها و بینش‌های استراتژیک امروز..."
              }
              rows={2}
              className={`w-full radius-component p-3 text-xs sm:text-sm text-role-primary placeholder:text-role-muted focus:outline-none transition-all leading-relaxed font-sans resize-none overflow-hidden ${
                isFuture || isCycleArchived
                  ? 'surface-z2/50 border-standard opacity-60 cursor-not-allowed'
                  : 'surface-z2 border-standard hover:border-[var(--color-border-hover)] focus:border-crimson focus:ring-1 focus:ring-crimson/30'
              }`}
            />
          </div>
        </motion.div>
      </AnimatePresence>
      </div>
    </div>
  );
};

export const BattlefieldView = React.memo(BattlefieldViewComponent);
