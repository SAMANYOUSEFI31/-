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

  // Local optimistic state for zero-latency synchronous habit check toggles
  const [optimisticLog, setOptimisticLog] = useState<DailyLog | null>(null);

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

  // Derived currentActiveLog: prioritizes local optimistic state for 0ms visual feedback
  const currentActiveLog: DailyLog = useMemo(() => {
    if (optimisticLog && optimisticLog.date === selectedDate) {
      return optimisticLog;
    }
    return activeLog;
  }, [optimisticLog, selectedDate, activeLog]);

  // Reconcile optimisticLog when props.logs updates with latest mutations or when date changes
  useEffect(() => {
    const currentInLogs = logs.find(l => l.date === selectedDate);
    if (currentInLogs && latestActiveLogRef.current && latestActiveLogRef.current.date === selectedDate) {
      const allMatch = FOUNDATION_HABITS.every(h => Boolean(currentInLogs[h.key]) === Boolean(latestActiveLogRef.current[h.key])) &&
        Boolean(currentInLogs.specialMission) === Boolean(latestActiveLogRef.current.specialMission);
      if (allMatch) {
        setOptimisticLog(null);
      }
    }
  }, [logs, selectedDate]);

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
    return computeDailyProperties(currentActiveLog, logs, logicalToday, cycleStartDate);
  }, [currentActiveLog, logs, logicalToday, cycleStartDate]);

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
      : currentActiveLog;

    const nextVal = !baseLog[key];
    const updated: DailyLog = {
      ...baseLog,
      [key]: nextVal
    };

    // Immediately record locally and in optimistic state so UI updates instantaneously in 0ms
    latestActiveLogRef.current = updated;
    setOptimisticLog(updated);

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
      : currentActiveLog;

    const nextVal = !baseLog.specialMission;
    const updated: DailyLog = {
      ...baseLog,
      specialMission: nextVal
    };

    // Immediately record locally and in optimistic state so UI updates instantaneously in 0ms
    latestActiveLogRef.current = updated;
    setOptimisticLog(updated);

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
      id="battlefield-view-root"
      className="space-y-4 sm:space-y-6 max-w-5xl mx-auto touch-pan-y w-full select-none" 
      dir="rtl"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 0. Demo Scenario Clarification Notice */}
      {isDemoCycle && !hasDismissedDemoBanner && (
        <div 
          id="battlefield-demo-banner"
          className="w-full surface-z1 border-standard radius-card p-3.5 sm:p-4 text-xs shadow-subtle flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 animate-in fade-in slide-in-from-top-2 relative"
        >
          {/* Content Cluster: Icon + Title/Badge + Description */}
          <div id="battlefield-demo-content-cluster" className="flex items-start gap-3 min-w-0 flex-1 w-full sm:w-auto">
            {/* Sparkles Icon Container */}
            <div id="battlefield-demo-icon-container" className="w-8 h-8 radius-control bg-amber-subtle border border-amber-subtle text-amber flex items-center justify-center shrink-0 mt-0.5 sm:mt-0">
              <span id="battlefield-demo-icon-wrap" className="inline-flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-amber" />
              </span>
            </div>

            {/* Text & Meta Column */}
            <div id="battlefield-demo-text-col" className="min-w-0 flex-1 space-y-1">
              {/* Header Row: Title + Sample Badge + Mobile Close */}
              <div id="battlefield-demo-header-row" className="flex items-center justify-between gap-2">
                <div id="battlefield-demo-title-badge-cluster" className="flex items-center gap-2 flex-wrap">
                  <span id="battlefield-demo-title" className="font-bold text-role-primary text-xs sm:text-sm">
                    <span id="battlefield-demo-title-text">پیش‌نمایش داده‌های شبیه‌سازی‌شده (Demo Seed)</span>
                  </span>
                  <span id="battlefield-demo-badge" className="text-[10px] bg-amber-subtle text-amber border border-amber-subtle px-2 py-0.5 radius-micro font-mono font-bold select-none pointer-events-none inline-flex items-center">
                    <span id="battlefield-demo-badge-text">۲۴ روز نمونه</span>
                  </span>
                </div>

                {/* Mobile top-left corner dismiss button */}
                <button
                  id="battlefield-demo-dismiss-mobile"
                  type="button"
                  onClick={dismissDemoBanner}
                  className="sm:hidden text-role-secondary hover:text-role-primary hover:surface-z2 p-1.5 radius-control transition cursor-pointer shrink-0 focus-ring-tactical -mt-1 -ml-1 inline-flex items-center justify-center"
                  title="بستن اعلان"
                  aria-label="بستن اعلان"
                >
                  <span id="battlefield-demo-dismiss-mobile-icon-wrap" className="inline-flex items-center justify-center">
                    <X className="w-4 h-4" />
                  </span>
                </button>
              </div>

              {/* Narrative Text Container */}
              <div id="battlefield-demo-narrative-container">
                <p id="battlefield-demo-narrative-text" className="text-[11px] text-role-secondary leading-relaxed">
                  شما در حال بررسی سناریوی نمایشی بوشیدو هستید. جهت شروع پیشرفت واقعی، می‌توانید چرخه اختصاصی جدیدی آغاز کنید.
                </p>
              </div>
            </div>
          </div>

          {/* Actions Cluster: Start Real Cycle CTA + Desktop Dismiss Button */}
          <div id="battlefield-demo-actions-cluster" className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end pt-2 sm:pt-0">
            {onOpenCreateCycle && (
              <button
                id="battlefield-demo-create-cycle-btn"
                type="button"
                onClick={onOpenCreateCycle}
                className="w-full sm:w-auto bg-amber hover:brightness-110 text-canvas-root font-black text-xs px-4 py-2 radius-control transition cursor-pointer active:scale-95 shadow-subtle whitespace-nowrap focus-ring-tactical text-center inline-flex items-center justify-center gap-1.5"
              >
                <span id="battlefield-demo-create-cycle-icon-wrap" className="inline-flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5" />
                </span>
                <span id="battlefield-demo-create-cycle-text">شروع چرخه واقعی</span>
              </button>
            )}

            {/* Desktop dismiss button */}
            <button
              id="battlefield-demo-dismiss-desktop"
              type="button"
              onClick={dismissDemoBanner}
              className="hidden sm:inline-flex text-role-secondary hover:text-role-primary hover:surface-z2 p-2 radius-control transition cursor-pointer focus-ring-tactical items-center justify-center"
              title="بستن اعلان"
              aria-label="بستن اعلان"
            >
              <span id="battlefield-demo-dismiss-desktop-icon-wrap" className="inline-flex items-center justify-center">
                <X className="w-3.5 h-3.5" />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* 1. Fully Responsive Ergonomic Date Navigator & Cutoff Hub Bar */}
      <div 
        id="battlefield-date-navigator"
        className="w-full surface-z1 border-standard radius-card p-3 sm:p-4 shadow-subtle select-none space-y-2.5 sm:space-y-3"
      >
        {/* Main Navigation Row: Prev Day + Center Date Display + Next Day */}
        <div id="battlefield-date-nav-main-row" className="flex items-center justify-between gap-2 sm:gap-4 w-full">
          {/* Previous Day Button */}
          <button
            id="battlefield-prev-day-btn"
            type="button"
            onClick={() => navigateDate(addDaysToDate(selectedDate, -1), -1)}
            className="h-9 sm:h-10 px-2.5 sm:px-3.5 surface-z2 hover:surface-z3 active:surface-z3 text-role-primary radius-component transition cursor-pointer inline-flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap shrink-0 border-standard shadow-subtle active:scale-95 focus-ring-tactical"
            title="رفتن به روز قبل"
            aria-label="روز قبل"
          >
            <span id="battlefield-prev-day-icon-wrap" className="inline-flex items-center justify-center shrink-0">
              <ChevronRight className="w-4 h-4 text-role-muted" />
            </span>
            <span id="battlefield-prev-day-label" className="hidden sm:inline whitespace-nowrap leading-none">
              روز قبل
            </span>
          </button>

          {/* Center Date Text Container (Clean Minimalist Typography, Neutral APCA-Compliant) */}
          <div id="battlefield-date-center-col" className="flex-1 min-w-0 text-center px-1 flex flex-col items-center justify-center space-y-0.5">
            {/* Relative day indicator pill */}
            <div id="battlefield-relative-date-badge" className="text-[11px] sm:text-xs text-role-secondary font-semibold inline-flex items-center justify-center gap-1.5">
              <span id="battlefield-relative-date-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                <Calendar className="w-3.5 h-3.5 text-role-muted" />
              </span>
              <span id="battlefield-relative-date-label" className="whitespace-nowrap">
                {getRelativeDateLabel(selectedDate, logicalToday)}
              </span>
            </div>

            {/* Main Persian Date Heading */}
            <div id="battlefield-date-heading-container" className="inline-flex items-center justify-center">
              <h2 id="battlefield-date-heading" className="text-xs sm:text-sm md:text-base font-black text-role-primary tracking-tight font-mono whitespace-nowrap leading-none">
                {formatPersianDate(selectedDate, { withWeekday: true })}
              </h2>
            </div>
          </div>

          {/* Next Day Button */}
          <button
            id="battlefield-next-day-btn"
            type="button"
            onClick={() => navigateDate(addDaysToDate(selectedDate, 1), 1)}
            className="h-9 sm:h-10 px-2.5 sm:px-3.5 surface-z2 hover:surface-z3 active:surface-z3 text-role-primary radius-component transition cursor-pointer inline-flex items-center justify-center gap-1.5 text-xs font-bold whitespace-nowrap shrink-0 border-standard shadow-subtle active:scale-95 focus-ring-tactical"
            title="رفتن به روز بعد"
            aria-label="روز بعد"
          >
            <span id="battlefield-next-day-label" className="hidden sm:inline whitespace-nowrap leading-none">
              روز بعد
            </span>
            <span id="battlefield-next-day-icon-wrap" className="inline-flex items-center justify-center shrink-0">
              <ChevronLeft className="w-4 h-4 text-role-muted" />
            </span>
          </button>
        </div>

        {/* Dedicated Cutoff Sub-Bar (Centered with seamless layout & telemetry entity badge) */}
        <div id="battlefield-cutoff-sub-bar" className="pt-1 sm:pt-1.5 flex items-center justify-center text-[10px] sm:text-[11px]">
          {/* Centered Nightly Cutoff Box with Standard Telemetry Badge Entity */}
          <div 
            id="battlefield-cutoff-badge"
            className="entity-telemetry-badge inline-flex items-center gap-1.5 font-medium shadow-subtle leading-none"
          >
            <span id="battlefield-cutoff-icon-wrap" className="inline-flex items-center justify-center shrink-0">
              <Clock className="w-3.5 h-3.5 text-role-muted" />
            </span>
            <span id="battlefield-cutoff-text-group" className="inline-flex items-center gap-1">
              <span id="battlefield-cutoff-label" className="text-role-secondary">کات‌آف شبانه:</span>
              <span id="battlefield-cutoff-value" className="text-role-primary font-mono font-bold">{toPersianDigits(nightOwlCutoffHour)}:۰۰ بامداد</span>
            </span>
          </div>
        </div>
      </div>

      {/* Swipe navigation hint on mobile (Shown ONLY once for new users) */}
      {!hasSeenSwipeHint && (
        <div 
          id="battlefield-swipe-hint"
          className="flex items-center justify-between gap-2 px-3 py-1.5 surface-z1 radius-component text-[10px] text-role-secondary select-none sm:hidden -my-1 animate-in fade-in slide-in-from-top-1"
        >
          <div id="battlefield-swipe-hint-content" className="flex items-center gap-1.5">
            <span id="battlefield-swipe-hint-arrows" className="text-role-muted font-mono">‹ ›</span>
            <span id="battlefield-swipe-hint-text">برای تغییر سریع روزها، صفحه را به چپ یا راست بکشید (Swipe)</span>
          </div>
          <button
            id="battlefield-swipe-hint-dismiss-btn"
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
            <div 
              id="battlefield-future-banner"
              className="surface-z1 border-standard radius-card p-3.5 sm:p-4 text-role-primary shadow-subtle backdrop-blur-md"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 radius-component surface-z2 text-role-secondary flex items-center justify-center shrink-0">
                    <Compass className="w-4 h-4 text-role-secondary" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs sm:text-sm font-bold text-role-primary">
                        {getRelativeDateLabel(selectedDate, logicalToday)}
                      </h3>
                    </div>
                    <p className="text-[11px] sm:text-xs text-role-secondary leading-relaxed">
                      ثبت عملکردها صرفاً در روز موعود فعال خواهد شد. تمرکز دیسیپلین بر فتح روز جاری است.
                    </p>
                  </div>
                </div>

                <button
                  id="battlefield-future-jump-today-btn"
                  type="button"
                  onClick={() => onSelectDate(logicalToday)}
                  className="w-full sm:w-auto h-9 bg-rose-subtle hover:brightness-125 text-rose border border-rose-subtle font-bold text-xs px-3.5 radius-component inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-subtle shrink-0 whitespace-nowrap active:scale-[0.98] focus-ring-tactical"
                >
                  <Zap className="w-3.5 h-3.5 text-rose shrink-0" />
                  <span className="leading-none">پرش به روز جاری</span>
                </button>
              </div>
            </div>
          ) : isPast && !isCycleArchived ? (
            <div 
              id="battlefield-past-banner"
              className="surface-z1 border-standard radius-card p-3 sm:p-3.5 text-role-primary shadow-subtle"
            >
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 sm:gap-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 radius-component surface-z2 text-role-muted flex items-center justify-center shrink-0">
                    <Calendar className="w-4 h-4 text-role-muted" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-role-primary">
                        مشاهده تاریخچه ({getRelativeDateLabel(selectedDate, logicalToday)})
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  id="battlefield-past-jump-today-btn"
                  type="button"
                  onClick={() => onSelectDate(logicalToday)}
                  className="w-full sm:w-auto h-8 bg-rose-subtle hover:brightness-125 text-rose border border-rose-subtle font-bold text-xs px-3 radius-component inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-subtle shrink-0 whitespace-nowrap active:scale-[0.98] focus-ring-tactical"
                >
                  <Zap className="w-3.5 h-3.5 text-rose shrink-0" />
                  <span className="leading-none">پرش به روز جاری</span>
                </button>
              </div>
            </div>
          ) : isCycleArchived ? (
            <div 
              id="battlefield-archived-banner"
              className="bg-purple-subtle border border-purple-subtle radius-card p-4 text-role-primary shadow-subtle"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 radius-component bg-purple-subtle text-purple flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-purple flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-purple" />
                      <span>این چرخه بایگانی شده است (فقط‌خواندنی)</span>
                    </h3>
                    <span className="text-[10px] bg-purple-subtle text-purple px-2 py-0.5 radius-control font-bold">
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
            <div 
              id="battlefield-behavior-lock-banner"
              className="bg-debt-subtle border border-debt-subtle radius-card p-4 text-role-primary shadow-subtle animate-pulse"
            >
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 radius-component bg-debt-subtle text-debt flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-debt flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-debt" />
                      <span>قفل اجرا فعال است (Behavior Lock)</span>
                    </h3>
                    <span className="text-[10px] bg-debt-subtle text-debt px-2 py-0.5 radius-control font-bold">
                      {toPersianDigits(unresolvedPastLogs.length)} روز بدهی باز
                    </span>
                  </div>
                  <p className="text-xs text-role-secondary mt-1 leading-relaxed">
                    پیش از ثبت روز جاری، باید روزهای سوخته گذشته کالبدشکافی شده و علت شکست ثبت گردد.
                  </p>
                  
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {unresolvedPastLogs.map(ul => (
                      <button
                        id={`battlefield-autopsy-open-btn-${ul.id}`}
                        key={ul.id}
                        onClick={() => onOpenAutopsy(ul)}
                        className="bg-debt hover:brightness-110 text-role-primary text-xs font-bold px-2.5 py-1 radius-control flex items-center gap-1.5 transition cursor-pointer shadow-subtle active:scale-95 focus-ring-tactical"
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

          {/* 3. Daily Status & Score Header Card (Ergonomic, Non-Redundant & Cohesive Layout) */}
          <div 
            id="battlefield-hero-panel"
            className="entity-hero-panel w-full max-w-full p-4 sm:p-5 relative overflow-hidden"
          >
            <div id="battlefield-hero-main-layout" className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
              {/* Telemetry & Narrative Status Column */}
              <div id="battlefield-hero-narrative-col" className="space-y-3 flex-1 min-w-0">
                {/* Telemetry Cluster (Quantitative Counter + Streak Vitality) */}
                <div id="battlefield-telemetry-cluster" className="flex items-center gap-2 flex-wrap">
                  {/* Quantitative Metric Badge */}
                  <div id="battlefield-habits-count-badge" className="entity-telemetry-badge font-mono shrink-0 inline-flex items-center gap-1">
                    <span id="battlefield-habits-count-current" className="font-bold text-role-primary">{toPersianDigits(computed.habitsCount)}</span>
                    <span id="battlefield-habits-count-separator" className="text-role-muted">از</span>
                    <span id="battlefield-habits-count-total" className="font-bold text-role-secondary">{toPersianDigits(5)}</span>
                    <span id="battlefield-habits-count-unit" className="text-role-muted text-[10px]">پایه</span>
                  </div>

                  {/* Streak Vitality Badge */}
                  <div 
                    id="battlefield-streak-vitality-badge"
                    className={`entity-status-badge border inline-flex items-center gap-1.5 ${
                      isFuture
                        ? 'surface-z2 border-standard text-role-secondary font-medium'
                        : computed.isStandard
                        ? 'bg-rose-subtle border-rose-subtle text-rose font-bold'
                        : computed.statusType === 'personal_frozen'
                        ? 'bg-blue-subtle border-blue-subtle text-blue font-bold'
                        : isToday
                        ? 'surface-z2 border-standard text-role-secondary'
                        : 'bg-debt-subtle border-debt-subtle text-debt font-bold'
                    }`}
                  >
                    <span id="battlefield-streak-vitality-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                      <Flame className={`w-3.5 h-3.5 shrink-0 ${
                        isFuture ? 'text-role-muted' : computed.isStandard ? 'text-rose fill-rose-500/20' : isToday ? 'text-role-muted' : 'text-debt'
                      }`} />
                    </span>
                    <span id="battlefield-streak-vitality-label" className="whitespace-nowrap leading-none">
                      {isFuture
                        ? 'آماده ثبت زنجیره'
                        : computed.isStandard
                        ? 'زنجیره حفظ شد'
                        : computed.statusType === 'personal_frozen'
                        ? 'زنجیره در امان (فریز)'
                        : isToday
                        ? 'حفظ زنجیره با ۵ پایه'
                        : 'شکست زنجیره'}
                    </span>
                  </div>
                </div>

                {/* Coach Commentary narrative container */}
                <div id="battlefield-coach-commentary-container" className="min-h-[1.5rem] pt-0.5">
                  <p id="battlefield-coach-commentary" className="text-xs sm:text-sm text-role-secondary font-medium leading-relaxed">
                    {computed.coachStatusLabel}
                  </p>
                </div>
              </div>

              {/* Score & Gauge Block (Single Source of Truth for Daily Verdict) */}
              <div 
                id="battlefield-score-card"
                className="entity-metric-card-nested w-full md:w-[220px] shrink-0 p-3.5 sm:p-4 flex flex-col items-center justify-center gap-2.5 text-center shadow-subtle"
              >
                {/* Score Header Label */}
                <div id="battlefield-score-header" className="text-[11px] sm:text-xs text-role-secondary font-medium flex items-center justify-center gap-1.5 whitespace-nowrap select-none pointer-events-none">
                  <span id="battlefield-score-header-label">امتیاز ارزش روز</span>
                  <span id="battlefield-score-header-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                    {computed.score === 10 && <Swords className="w-3.5 h-3.5 text-amber" />}
                    {computed.isStandard && computed.score < 10 && <ShieldCheck className="w-3.5 h-3.5 text-emerald" />}
                  </span>
                </div>
                
                {/* Big Score Number */}
                <div 
                  id="battlefield-score-value"
                  className={`text-3xl sm:text-4xl font-black font-mono flex items-baseline justify-center gap-1.5 ${
                    isFuture
                      ? 'text-role-muted'
                      : computed.score === 10 
                      ? 'text-amber' 
                      : computed.isStandard 
                      ? 'text-emerald' 
                      : 'text-role-primary'
                  }`}
                >
                  <span id="battlefield-score-number" className="leading-none">{toPersianDigits(computed.score)}</span>
                  <span id="battlefield-score-max" className="text-xs font-semibold text-role-muted inline-flex items-center gap-0.5">
                    <span id="battlefield-score-max-sep">از</span>
                    <span id="battlefield-score-max-num">{toPersianDigits(10)}</span>
                  </span>
                </div>

                {/* Single Source of Truth: Definitive Status Ribbon with Fixed Height */}
                <div id="battlefield-score-ribbon" className="flex items-center justify-center h-6 select-none pointer-events-none w-full">
                  {computed.score === 10 ? (
                    <div id="battlefield-score-status-badge" className="entity-status-badge bg-amber-subtle text-amber border border-amber-subtle inline-flex items-center gap-1.5">
                      <span id="battlefield-score-status-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                        <Swords className="w-3.5 h-3.5 text-amber" />
                      </span>
                      <span id="battlefield-score-status-label" className="whitespace-nowrap leading-none">کمال تعهد (۱۰ از ۱۰)</span>
                    </div>
                  ) : computed.isStandard ? (
                    <div id="battlefield-score-status-badge" className="entity-status-badge bg-emerald-subtle text-emerald border border-emerald-subtle inline-flex items-center gap-1.5">
                      <span id="battlefield-score-status-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald" />
                      </span>
                      <span id="battlefield-score-status-label" className="whitespace-nowrap leading-none">روز استاندارد (۸ از ۱۰)</span>
                    </div>
                  ) : computed.statusType === 'personal_frozen' ? (
                    <div id="battlefield-score-status-badge" className="entity-status-badge bg-blue-subtle text-blue border border-blue-subtle inline-flex items-center gap-1.5">
                      <span id="battlefield-score-status-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                        <Snowflake className="w-3.5 h-3.5 text-blue" />
                      </span>
                      <span id="battlefield-score-status-label" className="whitespace-nowrap leading-none">توقف اضطراری (فریز)</span>
                    </div>
                  ) : computed.statusType === 'burned_resolved' ? (
                    <div id="battlefield-score-status-badge" className="entity-status-badge bg-purple-subtle text-purple border border-purple-subtle inline-flex items-center gap-1.5">
                      <span id="battlefield-score-status-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                        <ShieldCheck className="w-3.5 h-3.5 text-purple" />
                      </span>
                      <span id="battlefield-score-status-label" className="whitespace-nowrap leading-none">پرونده مختومه</span>
                    </div>
                  ) : isFuture ? (
                    <div id="battlefield-score-status-badge" className="entity-status-badge surface-z3 text-role-secondary inline-flex items-center gap-1.5">
                      <span id="battlefield-score-status-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                        <Compass className="w-3.5 h-3.5 text-role-muted" />
                      </span>
                      <span id="battlefield-score-status-label" className="whitespace-nowrap leading-none">روز آینده (پیش‌رو)</span>
                    </div>
                  ) : isToday ? (
                    <div id="battlefield-score-status-badge" className="entity-status-badge bg-amber-subtle/40 border border-amber-subtle/50 text-role-primary inline-flex items-center gap-1.5">
                      <span id="battlefield-score-status-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                        <Clock className="w-3.5 h-3.5 text-amber" />
                      </span>
                      <span id="battlefield-score-status-label" className="whitespace-nowrap leading-none">در جریان اجرای نبرد</span>
                    </div>
                  ) : (
                    <div id="battlefield-score-status-badge" className="entity-status-badge bg-debt-subtle text-debt border border-debt-subtle inline-flex items-center gap-1.5">
                      <span id="battlefield-score-status-icon-wrap" className="inline-flex items-center justify-center shrink-0">
                        <AlertTriangle className="w-3.5 h-3.5 text-debt" />
                      </span>
                      <span id="battlefield-score-status-label" className="whitespace-nowrap leading-none">بدهی دیسیپلین (سوخته)</span>
                    </div>
                  )}
                </div>

                {/* Precision 10-Segment Discipline Gauge (Discrete Perforated Slots) */}
                <div 
                  id="battlefield-score-gauge"
                  className="entity-gauge-track select-none pointer-events-none"
                >
                  {Array.from({ length: 10 }).map((_, idx) => {
                    const segmentIndex = idx + 1;
                    const isFilled = computed.score >= segmentIndex;
                    return (
                      <div
                        id={`battlefield-gauge-segment-${segmentIndex}`}
                        key={idx}
                        className={`h-2 flex-1 radius-capsule transition-all duration-200 ${
                          isFilled
                            ? computed.score === 10
                              ? 'bg-amber border border-amber/40 shadow-[0_0_6px_rgba(251,191,36,0.35)]'
                              : computed.isStandard
                              ? 'bg-emerald border border-emerald/40 shadow-[0_0_6px_rgba(52,211,153,0.35)]'
                              : computed.statusType === 'personal_frozen'
                              ? 'bg-blue border border-blue/40'
                              : 'bg-role-primary border border-subtle'
                            : 'surface-z0 border border-subtle shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]'
                        }`}
                        title={`قطعه ${toPersianDigits(segmentIndex)} از ۱۰`}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          {/* 4. Section A: The 5 Foundation Habits (Single Column Stack - Aligned to Content Width) */}
          <div id="battlefield-foundation-section" className="space-y-2.5 sm:space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h3 id="battlefield-foundation-heading" className="font-bold text-xs sm:text-sm text-role-primary flex items-center gap-2">
                <Swords className="w-4 h-4 text-role-secondary shrink-0" />
                <span>۵ رکن تعهد فونداسیون</span>
              </h3>
              <div id="battlefield-foundation-requirement-badge" className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs text-role-muted font-medium select-none pointer-events-none">
                <Target className="w-3.5 h-3.5 text-role-muted" />
                <span>شرط روز استاندارد: <span className="text-role-secondary font-mono font-bold">۸ از ۱۰</span></span>
              </div>
            </div>

            <div id="battlefield-habits-list" className="flex flex-col gap-2.5 sm:gap-3 w-full">
              {FOUNDATION_HABITS.map(h => {
                const isChecked = Boolean(currentActiveLog[h.key]);
                return (
                  <button
                    id={`battlefield-habit-card-${h.key}`}
                    type="button"
                    key={h.key}
                    disabled={isLocked}
                    onClick={() => toggleHabit(h.key)}
                    className={`entity-card-habit w-full min-h-[44px] p-3 sm:p-3.5 text-right flex items-center justify-between gap-3 group focus-ring-tactical ${
                      isChecked
                        ? 'is-checked-standard text-role-primary'
                        : 'text-role-secondary'
                    } ${isLocked ? 'is-locked' : ''}`}
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div className={`w-9 h-9 sm:w-10 sm:h-10 radius-component flex items-center justify-center shrink-0 transition-colors ${
                        isChecked
                          ? 'surface-z2 text-emerald border border-emerald-subtle'
                          : 'surface-z2 text-role-muted group-hover:text-role-primary border-standard'
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

                    <div className={`entity-stamp-target w-6 h-6 sm:w-7 sm:h-7 ${
                      isChecked
                        ? 'is-checked-standard'
                        : 'text-transparent group-hover:border-hover'
                    }`}>
                      <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Section B: Special Mission Accelerator (Distinct Full-Width Row Under The Five) */}
          <div id="battlefield-special-mission-section" className="space-y-2.5 sm:space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h4 id="battlefield-special-mission-heading" className="font-bold text-xs sm:text-sm text-role-primary flex items-center gap-2">
                <Rocket className="w-4 h-4 text-role-secondary shrink-0" />
                <span>ماموریت شتاب‌دهنده روز</span>
              </h4>
              <div id="battlefield-special-mission-reward-badge" className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs text-role-muted font-medium select-none pointer-events-none">
                <Sparkles className="w-3.5 h-3.5 text-amber" />
                <span>ارتقا به کمال: <span className="text-amber font-mono font-bold">+{toPersianDigits(2)} امتیاز (۱۰ از ۱۰)</span></span>
              </div>
            </div>

            <button
              id="battlefield-special-mission-card"
              type="button"
              disabled={isLocked}
              onClick={toggleSpecialMission}
              className={`entity-card-habit w-full min-h-[44px] p-3 sm:p-3.5 text-right flex items-center justify-between gap-3 group focus-ring-tactical ${
                currentActiveLog.specialMission
                  ? 'is-checked-mastery text-role-primary'
                  : 'text-role-secondary'
              } ${isLocked ? 'is-locked' : ''}`}
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 radius-component flex items-center justify-center shrink-0 transition-colors ${
                  currentActiveLog.specialMission
                    ? 'surface-z2 text-amber border border-amber-subtle'
                    : 'surface-z2 text-role-muted group-hover:text-role-primary border-standard'
                }`}>
                  <Target className={`w-5 h-5 ${currentActiveLog.specialMission ? 'text-amber' : 'text-role-muted group-hover:text-role-primary'}`} />
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="font-bold text-xs sm:text-sm text-role-primary flex items-center gap-2 leading-snug">
                    <span className="truncate">ماموریت ویژه روز</span>
                    <span className={`text-[10px] px-2 py-0.5 radius-capsule font-bold font-mono shrink-0 ${
                      currentActiveLog.specialMission
                        ? 'surface-z2 text-amber border border-amber-subtle'
                        : 'surface-z2 text-role-secondary border-standard'
                    }`}>
                      +{toPersianDigits(2)} امتیاز
                    </span>
                  </div>
                  <p className="text-[11px] text-role-secondary leading-relaxed text-right">
                    ثبت ماموریت کلیدی امروز در کنار ۵ رکن فونداسیون برای کسب امتیاز کامل ۱۰ از ۱۰.
                  </p>
                </div>
              </div>

              <div className={`entity-stamp-target w-6 h-6 sm:w-7 sm:h-7 ${
                currentActiveLog.specialMission
                  ? 'is-checked-mastery'
                  : 'text-transparent group-hover:border-hover'
              }`}>
                <Check className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />
              </div>
            </button>
          </div>

          {/* 5. Failure & Autopsy Action Section (If Not Standard) */}
          {!computed.isStandard && !isFuture && (() => {
            const hasFailureReason = !!(currentActiveLog.failureReason && currentActiveLog.failureReason.trim() !== '');
            const hasCountermeasure = !!(currentActiveLog.countermeasure && currentActiveLog.countermeasure.trim() !== '');
            const cleanFailureReason = hasFailureReason ? currentActiveLog.failureReason.trim() : '';
            const cleanCountermeasure = hasCountermeasure ? currentActiveLog.countermeasure.trim() : '';

            return (
              <div 
                id="battlefield-autopsy-section"
                className={`border radius-card p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 transition-all shadow-subtle ${
                  cleanFailureReason === 'دلایل شخصی'
                    ? 'bg-blue-subtle border-blue-subtle'
                    : hasFailureReason
                    ? 'bg-purple-subtle border-purple-subtle'
                    : (isToday ? 'surface-z1 border-standard' : 'bg-debt-subtle border-debt-subtle')
                }`}
              >
                <div className="flex items-start sm:items-center gap-3">
                  <div className={`w-9 h-9 radius-component flex items-center justify-center shrink-0 ${
                    cleanFailureReason === 'دلایل شخصی' 
                      ? 'surface-z2 text-blue border border-blue-subtle' 
                      : hasFailureReason 
                      ? 'surface-z2 text-purple border border-purple-subtle' 
                      : (isToday ? 'surface-z2 text-role-muted border-standard' : 'surface-z2 text-debt border border-debt-subtle')
                  }`}>
                    {cleanFailureReason === 'دلایل شخصی' ? (
                      <Snowflake className="w-4 h-4 text-blue" />
                    ) : hasFailureReason ? (
                      <ShieldCheck className="w-4 h-4 text-purple" />
                    ) : (
                      <AlertTriangle className={`w-4 h-4 ${isToday ? 'text-role-muted' : 'text-debt'}`} />
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs sm:text-sm text-role-primary">
                      {hasFailureReason 
                        ? `کالبدشکافی ثبت‌شده: ${cleanFailureReason}` 
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
                  id="battlefield-autopsy-action-btn"
                  type="button"
                  onClick={() => onOpenAutopsy(currentActiveLog)}
                  className={`w-full sm:w-auto font-bold text-xs px-3.5 py-2 radius-component inline-flex items-center justify-center gap-2 transition cursor-pointer border shrink-0 whitespace-nowrap active:scale-[0.98] focus-ring-tactical ${
                    hasFailureReason
                      ? 'surface-z2 hover:surface-z3 text-role-primary border-standard'
                      : (isToday 
                          ? 'surface-z2 hover:surface-z3 text-role-primary border-standard' 
                          : 'bg-debt hover:brightness-110 text-role-primary border-debt shadow-subtle')
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-role-secondary" />
                  <span>{hasFailureReason ? 'ویرایش کالبدشکافی' : (isToday ? 'ثبت کالبدشکافی امروز' : 'کالبدشکافی این روز')}</span>
                </button>
              </div>
            );
          })()}

          {/* 6. Daily Reflection & Strategy Notes (Clean Input Grouping) */}
          <div id="battlefield-daily-notes-section" className="space-y-2 px-0.5">
            <div className="flex items-center justify-between flex-wrap gap-2 px-0.5">
              <label htmlFor="battlefield-daily-notes" className="text-xs font-bold text-role-primary inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-role-muted" />
                <span>یادداشت و مشاهدات میدان نبرد</span>
              </label>
              <div id="battlefield-notes-status-badge" className="flex items-center gap-2 text-[11px]">
                {isFuture ? (
                  <span className="text-role-muted text-[11px]">
                    در روز موعود فعال می‌شود
                  </span>
                ) : isCycleArchived ? (
                  <span className="text-purple text-[11px] font-medium">
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
              id="battlefield-daily-notes"
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
              className="entity-input-well w-full p-3 sm:p-3.5 text-xs sm:text-sm placeholder:text-role-muted leading-relaxed font-sans resize-none overflow-hidden"
            />
          </div>
        </motion.div>
      </AnimatePresence>
      </div>
    </div>
  );
};

export const BattlefieldView = React.memo(BattlefieldViewComponent);
