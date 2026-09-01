import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DailyLog, Cycle, CycleMetrics, HabitKey } from '../types';
import { FOUNDATION_HABITS, computeDailyProperties } from '../engine/bushidoCalculations';
import { formatPersianDate, getLogicalTodayDate, addDaysToDate, getRelativeDateLabel } from '../utils/dateUtils';
import { toPersianDigits } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
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

export const BattlefieldView: React.FC<BattlefieldViewProps> = ({
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

  // Demo data clarification banner state (per session)
  const [hasDismissedDemoBanner, setHasDismissedDemoBanner] = useState<boolean>(false);

  const dismissDemoBanner = () => {
    setHasDismissedDemoBanner(true);
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

  // Keep latest notes, activeLog, and handler in refs to guarantee zero data-loss on rapid unmount / date switch
  const latestNotesRef = useRef(notesValue);
  latestNotesRef.current = notesValue;

  const latestActiveLogRef = useRef(activeLog);
  latestActiveLogRef.current = activeLog;

  const onUpdateLogRef = useRef(onUpdateLog);
  onUpdateLogRef.current = onUpdateLog;

  const isCycleArchivedRef = useRef(isCycleArchived);
  isCycleArchivedRef.current = isCycleArchived;

  const isFutureRef = useRef(isFuture);
  isFutureRef.current = isFuture;

  // Flush any pending note changes immediately
  const flushPendingNotes = useCallback(() => {
    const currentActiveLog = latestActiveLogRef.current;
    if (!currentActiveLog || isCycleArchivedRef.current || isFutureRef.current) return;
    const currentVal = latestNotesRef.current;
    if (currentVal !== (currentActiveLog.notes || '')) {
      const updated: DailyLog = {
        ...currentActiveLog,
        notes: currentVal
      };
      onUpdateLogRef.current(updated);
      setIsSaved(true);
    }
  }, []);

  // Sync with selected date changes while flushing any unsaved pending edits from the previous date
  const lastSyncDateRef = useRef(selectedDate);
  useEffect(() => {
    if (lastSyncDateRef.current !== selectedDate) {
      flushPendingNotes();
      setNotesValue(activeLog?.notes || '');
      setIsSaved(true);
      lastSyncDateRef.current = selectedDate;
    } else if (isSaved && notesValue !== (activeLog?.notes || '')) {
      setNotesValue(activeLog?.notes || '');
    }
  }, [selectedDate, activeLog?.notes, isSaved, flushPendingNotes]);

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
      const currentActiveLog = latestActiveLogRef.current;
      if (currentActiveLog) {
        const updated: DailyLog = {
          ...currentActiveLog,
          notes: notesValue
        };
        onUpdateLogRef.current(updated);
        setIsSaved(true);
      }
    }, 450);

    return () => clearTimeout(timer);
  }, [notesValue, isSaved, isCycleArchived, isFuture]);

  // Track navigation direction for directional slide animation (1: next, -1: prev)
  const [navDirection, setNavDirection] = useState<number>(0);

  // Touch swipe gesture handlers (smart touch-area: works across canvas with strict deliberate thresholds)
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

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

  const computed = computeDailyProperties(activeLog, logs, logicalToday, currentCycle.startDate);

  // Find all unresolved past days that cause system lock (strictly before today) across the full timeline from cycle start
  const unresolvedPastLogs: DailyLog[] = [];
  if (currentCycle.startDate && currentCycle.startDate < logicalToday) {
    let checkDate = currentCycle.startDate;
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
      const c = computeDailyProperties(l, logs, logicalToday, currentCycle.startDate);
      if (c.statusType === 'burned_unresolved') {
        unresolvedPastLogs.push(l);
      }
      checkDate = addDaysToDate(checkDate, 1);
    }
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

    const nextVal = !activeLog![key];
    const updated: DailyLog = {
      ...activeLog!,
      [key]: nextVal
    };

    const habitKeys: HabitKey[] = ['wakeUp', 'workout', 'study', 'journal', 'hardTask'];
    const wasStandard = habitKeys.every(k => activeLog![k]);
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
    const nextVal = !activeLog!.specialMission;
    const updated: DailyLog = {
      ...activeLog!,
      specialMission: nextVal
    };

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
        <div className="w-full bg-[#121215] border border-amber-500/30 rounded-2xl p-3 sm:p-4 text-xs shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in fade-in slide-in-from-top-2">
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold text-zinc-100">پیش‌نمایش داده‌های شبیه‌سازی‌شده (Demo Seed)</span>
                <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded font-mono">
                  ۲۴ روز نمونه
                </span>
              </div>
              <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
                شما در حال بررسی سناریوی نمایشی بوشیدو هستید. جهت شروع پیشرفت واقعی، می‌توانید چرخه اختصاصی جدیدی آغاز کنید.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto shrink-0 justify-end">
            {onOpenCreateCycle && (
              <button
                type="button"
                onClick={onOpenCreateCycle}
                className="bg-amber-500 hover:bg-amber-400 text-black font-black text-xs px-3.5 py-1.5 rounded-xl transition cursor-pointer active:scale-95 shadow-xs whitespace-nowrap"
              >
                شروع چرخه واقعی
              </button>
            )}
            <button
              type="button"
              onClick={dismissDemoBanner}
              className="text-zinc-400 hover:text-white p-1.5 rounded-lg border border-zinc-800 hover:bg-zinc-800 transition cursor-pointer"
              title="بستن اعلان"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* 1. Fully Responsive Ergonomic Date Navigator Bar */}
      <div className="w-full bg-[#121215] border border-zinc-800 rounded-2xl p-2.5 sm:p-4 shadow-lg select-none space-y-2 sm:space-y-3">
        {/* Main Navigation Row: Prev Day + Center Date Display + Next Day */}
        <div className="flex items-center justify-between gap-1.5 sm:gap-3 w-full">
          {/* Previous Day Button */}
          <button
            type="button"
            onClick={() => navigateDate(addDaysToDate(selectedDate, -1), -1)}
            className="h-9 sm:h-10 px-2.5 sm:px-3.5 bg-[#18181b] hover:bg-zinc-800 active:bg-zinc-700 text-zinc-200 hover:text-white rounded-xl transition cursor-pointer inline-flex items-center justify-center gap-1 text-xs font-bold whitespace-nowrap shrink-0 border border-zinc-700/70 shadow-xs active:scale-95"
            title="رفتن به روز قبل"
            aria-label="روز قبل"
          >
            <ChevronRight className="w-4 h-4 shrink-0 text-zinc-400" />
            <span className="hidden sm:inline whitespace-nowrap leading-none">روز قبل</span>
          </button>

          {/* Center Date Text (Clean Minimalist Typography, Neutral APCA-Compliant) */}
          <div className="flex-1 min-w-0 text-center px-1 flex flex-col items-center justify-center">
            <div className="text-[11px] sm:text-xs text-zinc-400 font-semibold inline-flex items-center justify-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
              <span className="whitespace-nowrap">{getRelativeDateLabel(selectedDate, logicalToday)}</span>
            </div>
            <h2 className="text-xs sm:text-sm md:text-base font-black text-zinc-100 mt-0.5 tracking-tight font-mono whitespace-nowrap">
              {formatPersianDate(selectedDate, { withWeekday: true })}
            </h2>
          </div>

          {/* Next Day Button */}
          <button
            type="button"
            onClick={() => navigateDate(addDaysToDate(selectedDate, 1), 1)}
            className="h-9 sm:h-10 px-2.5 sm:px-3.5 bg-[#18181b] hover:bg-zinc-800 active:bg-zinc-700 text-zinc-200 hover:text-white rounded-xl transition cursor-pointer inline-flex items-center justify-center gap-1 text-xs font-bold whitespace-nowrap shrink-0 border border-zinc-700/70 shadow-xs active:scale-95"
            title="رفتن به روز بعد"
            aria-label="روز بعد"
          >
            <span className="hidden sm:inline whitespace-nowrap leading-none">روز بعد</span>
            <ChevronLeft className="w-4 h-4 shrink-0 text-zinc-400" />
          </button>
        </div>

        {/* Auxiliary Row: Night Owl Cutoff Badge (Centered & Stable) */}
        <div className="flex items-center justify-center pt-2 border-t border-zinc-800/80">
          <div className="h-8 bg-[#09090b] px-3.5 rounded-xl border border-zinc-800 text-[11px] sm:text-xs text-zinc-400 inline-flex items-center justify-center gap-2 whitespace-nowrap shadow-xs">
            <Clock className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
            <span className="leading-none">کات‌آف شبانه: {toPersianDigits(nightOwlCutoffHour)}:۰۰ بامداد</span>
          </div>
        </div>
      </div>

      {/* Swipe navigation hint on mobile (Shown ONLY once for new users) */}
      {!hasSeenSwipeHint && (
        <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-[#121215] border border-zinc-800 rounded-xl text-[10px] text-zinc-400 select-none sm:hidden -my-1 animate-in fade-in slide-in-from-top-1">
          <div className="flex items-center gap-1.5">
            <span className="text-zinc-400 font-mono">‹ ›</span>
            <span>برای تغییر سریع روزها، صفحه را به چپ یا راست بکشید (Swipe)</span>
          </div>
          <button
            type="button"
            onClick={dismissSwipeHint}
            className="text-zinc-400 hover:text-white p-0.5 rounded cursor-pointer shrink-0"
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
            <div className="bg-[#121215]/80 border border-zinc-800 rounded-2xl p-3.5 sm:p-4 text-zinc-100 shadow-xl backdrop-blur-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-zinc-800 border border-zinc-700 text-zinc-300 flex items-center justify-center shrink-0 shadow-inner">
                    <Compass className="w-4 h-4 text-zinc-300" />
                  </div>
                  <div className="space-y-0.5 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-xs sm:text-sm font-bold text-zinc-100">
                        {getRelativeDateLabel(selectedDate, logicalToday)}
                      </h3>
                      <span className="text-[10px] sm:text-[11px] bg-zinc-800 text-zinc-300 border border-zinc-700 px-2 py-0.5 rounded-lg font-mono font-medium">
                        {formatPersianDate(selectedDate, { short: true })}
                      </span>
                    </div>
                    <p className="text-[11px] sm:text-xs text-zinc-400 leading-relaxed">
                      ثبت عملکردها صرفاً در روز موعود فعال خواهد شد. تمرکز دیسیپلین بر فتح روز جاری است.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectDate(logicalToday)}
                  className="w-full sm:w-auto h-9 bg-rose-500/15 hover:bg-rose-500/25 active:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs px-3.5 rounded-xl inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-sm shrink-0 whitespace-nowrap active:scale-[0.98]"
                >
                  <Zap className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="leading-none">پرش به روز جاری</span>
                </button>
              </div>
            </div>
          ) : isPast && !isCycleArchived ? (
            <div className="bg-[#121215]/80 border border-zinc-800/90 rounded-2xl p-3 sm:p-3.5 text-zinc-100 shadow-md">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 sm:gap-4">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-zinc-800 border border-zinc-700/80 text-zinc-400 flex items-center justify-center shrink-0 shadow-inner">
                    <Calendar className="w-4 h-4 text-zinc-400" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-zinc-200">
                        مشاهده تاریخچه ({getRelativeDateLabel(selectedDate, logicalToday)})
                      </span>
                      <span className="text-[10px] bg-zinc-800 text-zinc-400 border border-zinc-700 px-2 py-0.5 rounded-md font-mono">
                        {formatPersianDate(selectedDate, { short: true })}
                      </span>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onSelectDate(logicalToday)}
                  className="w-full sm:w-auto h-8 bg-rose-500/15 hover:bg-rose-500/25 active:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-bold text-xs px-3 rounded-xl inline-flex items-center justify-center gap-1.5 transition cursor-pointer shadow-xs shrink-0 whitespace-nowrap active:scale-[0.98]"
                >
                  <Zap className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="leading-none">پرش به روز جاری</span>
                </button>
              </div>
            </div>
          ) : isCycleArchived ? (
            <div className="bg-purple-950/60 border-2 border-purple-500/60 rounded-2xl p-4 text-zinc-100 shadow-xl shadow-purple-950/40">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-300 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-purple-200 flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-purple-400" />
                      <span>این چرخه بایگانی شده است (فقط‌خواندنی)</span>
                    </h3>
                    <span className="text-[10px] bg-purple-900/60 border border-purple-700 text-purple-200 px-2 py-0.5 rounded-md font-bold">
                      سوابق قفل‌شده
                    </span>
                  </div>
                  <p className="text-xs text-purple-200/90 mt-1 leading-relaxed">
                    تمام ۹۰ روز این چرخه در دادگاه بوشیدو ارزیابی و بایگانی شده است.
                  </p>
                </div>
              </div>
            </div>
          ) : (unresolvedPastLogs.length > 0 && isToday) ? (
            <div className="bg-red-950/60 border-2 border-red-500/60 rounded-2xl p-4 text-zinc-100 shadow-xl shadow-red-950/40 animate-pulse">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-red-500/20 text-red-400 flex items-center justify-center shrink-0">
                  <Lock className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-xs sm:text-sm font-bold text-red-300 flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-red-400" />
                      <span>قفل اجرا فعال است (Behavior Lock)</span>
                    </h3>
                    <span className="text-[10px] bg-red-900/60 border border-red-700 text-red-200 px-2 py-0.5 rounded-md font-bold">
                      {toPersianDigits(unresolvedPastLogs.length)} روز بدهی باز
                    </span>
                  </div>
                  <p className="text-xs text-red-200/90 mt-1 leading-relaxed">
                    پیش از ثبت روز جاری، باید روزهای سوخته گذشته کالبدشکافی شده و علت شکست ثبت گردد.
                  </p>
                  
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {unresolvedPastLogs.map(ul => (
                      <button
                        key={ul.id}
                        onClick={() => onOpenAutopsy(ul)}
                        className="bg-red-600 hover:bg-red-500 text-white text-xs font-bold px-2.5 py-1 rounded-lg flex items-center gap-1.5 transition cursor-pointer shadow-sm active:scale-95"
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
          <div className="w-full max-w-full bg-[#121215] border border-zinc-800 rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 relative overflow-hidden shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:gap-6">
              <div className="space-y-2.5 flex-1 min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  {/* Status Pill */}
                  <span className={`px-2.5 py-1 rounded-xl text-[11px] sm:text-xs font-bold border inline-flex items-center gap-1.5 shrink-0 ${
                    computed.statusType === 'standard'
                      ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                      : computed.statusType === 'personal_frozen'
                      ? 'bg-blue-950/90 border-blue-500/50 text-blue-300'
                      : computed.statusType === 'burned_resolved'
                      ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                      : (isToday 
                          ? 'bg-zinc-800 border-zinc-700 text-zinc-300' 
                          : 'bg-red-950/90 border-red-500/60 text-red-300')
                  }`}>
                    {computed.statusType === 'standard' && <CheckCircle2 className="w-3.5 h-3.5" />}
                    {computed.statusType === 'personal_frozen' && <Snowflake className="w-3.5 h-3.5" />}
                    {computed.statusType === 'burned_resolved' && <FileText className="w-3.5 h-3.5" />}
                    {computed.statusType === 'burned_unresolved' && (
                      isToday ? <Clock className="w-3.5 h-3.5 text-zinc-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                    )}
                    <span>
                      {computed.statusType === 'standard' && 'تعهد کامل (Standard)'}
                      {computed.statusType === 'personal_frozen' && 'توقف اضطراری (فریز)'}
                      {computed.statusType === 'burned_resolved' && 'پرونده شکست بسته شد'}
                      {computed.statusType === 'burned_unresolved' && (isToday ? 'در جریان اجرای روز' : 'نیازمند کالبدشکافی')}
                    </span>
                  </span>

                  {/* Habit Count Badge */}
                  <span className="text-[11px] sm:text-xs text-zinc-300 bg-[#09090b]/80 px-2.5 py-1 rounded-xl border border-zinc-800 font-medium shrink-0">
                    {toPersianDigits(computed.habitsCount)} از {toPersianDigits(5)} پایه
                  </span>

                  {/* Streak Impact Badge */}
                  <span className={`text-[11px] sm:text-xs px-2.5 py-1 rounded-xl border inline-flex items-center gap-1.5 font-medium shrink-0 ${
                    computed.isStandard
                      ? 'bg-rose-500/15 border-rose-500/30 text-rose-300'
                      : computed.statusType === 'personal_frozen'
                      ? 'bg-blue-500/15 border-blue-500/30 text-blue-300'
                      : isToday
                      ? 'bg-[#09090b]/80 border border-zinc-800 text-zinc-400'
                      : 'bg-red-500/15 border-red-500/30 text-red-300'
                  }`}>
                    <Flame className={`w-3.5 h-3.5 ${
                      computed.isStandard ? 'text-rose-400 fill-current' : 'text-zinc-500'
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

                <p className="text-xs sm:text-sm text-zinc-300 font-medium leading-relaxed min-h-[1.5rem]">
                  {computed.coachStatusLabel}
                </p>
              </div>

              {/* Score & Gauge Box (Centered, Symmetrical & Dignified Proportions with Golden Ratio micro-focusing) */}
              <div className={`border rounded-2xl p-3.5 sm:p-5 text-center w-full max-w-[260px] mx-auto md:mx-0 md:w-[230px] md:max-w-none shrink-0 transition-all flex flex-col items-center justify-center gap-2.5 ${
                computed.score === 10
                  ? 'bg-amber-950/40 border-amber-500/60 shadow-md shadow-amber-950/40 ring-1 ring-amber-500/40'
                  : computed.isStandard
                  ? 'bg-emerald-950/40 border-emerald-500/60 shadow-md shadow-emerald-950/40 ring-1 ring-emerald-500/40'
                  : 'bg-[#09090b]/80 border-zinc-800'
              }`}>
                {/* Score Header Label */}
                <div className="text-[11px] sm:text-xs text-zinc-400 font-medium flex items-center justify-center gap-1.5">
                  <span>امتیاز ارزش روز</span>
                  {computed.score === 10 && <Swords className="w-3.5 h-3.5 text-amber-400" />}
                  {computed.isStandard && computed.score < 10 && <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
                
                {/* Big Score Number */}
                <div className={`text-3xl sm:text-4xl font-black flex items-baseline justify-center gap-1.5 ${
                  computed.score === 10 
                    ? 'text-amber-300' 
                    : computed.isStandard 
                    ? 'text-emerald-400' 
                    : 'text-zinc-100'
                }`}>
                  <span className="leading-none">{toPersianDigits(computed.score)}</span>
                  <span className="text-xs font-semibold text-zinc-400">از {toPersianDigits(10)}</span>
                </div>

                {/* Centered Status Ribbon with fixed height to prevent vertical jitter */}
                <div className="flex items-center justify-center h-7">
                  {computed.score === 10 ? (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-black text-amber-300 bg-amber-500/20 py-1 px-3 rounded-xl border border-amber-500/40 shadow-xs">
                      <Swords className="w-3.5 h-3.5" />
                      <span>کمال تعهد</span>
                    </div>
                  ) : computed.isStandard ? (
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-bold text-emerald-300 bg-emerald-500/20 py-1 px-3 rounded-xl border border-emerald-500/40 shadow-xs">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>روز استاندارد</span>
                    </div>
                  ) : (
                    <div className="text-[11px] text-zinc-300 font-medium bg-zinc-900 px-3 py-1 rounded-xl border border-zinc-800">
                      در انتظار ۵ پایه
                    </div>
                  )}
                </div>

                {/* Precision 10-Segment Discipline Gauge */}
                <div className="w-full pt-2 border-t border-zinc-800">
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
                                ? 'bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.6)]'
                                : computed.isStandard
                                ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]'
                                : computed.statusType === 'personal_frozen'
                                ? 'bg-blue-400'
                                : 'bg-zinc-300'
                              : 'bg-zinc-800'
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
              <h3 className="font-bold text-xs sm:text-sm text-zinc-200 flex items-center gap-2">
                <Swords className="w-4 h-4 text-zinc-300 shrink-0" />
                <span>۵ رکن تعهد فونداسیون</span>
              </h3>
              <span className="text-[11px] sm:text-xs text-zinc-300 font-mono whitespace-nowrap bg-[#18181b] px-2 py-0.5 rounded-lg border border-zinc-800">
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
                    className={`p-3 sm:p-3.5 rounded-2xl border text-right transition-all flex items-center justify-between gap-3 group cursor-pointer active:scale-[0.98] ${
                      isChecked
                        ? 'bg-[#121215] border-emerald-500/50 text-zinc-100 shadow-md shadow-emerald-950/20'
                        : 'bg-[#121215] border-zinc-800 text-zinc-300 hover:border-zinc-700'
                    } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                      <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                        isChecked
                          ? 'bg-emerald-500/20 text-emerald-400 ring-2 ring-emerald-500/30'
                          : 'bg-zinc-800 text-zinc-400 group-hover:text-zinc-200'
                      }`}>
                        {HABIT_ICONS[h.key]}
                      </div>
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="font-bold text-xs sm:text-sm text-zinc-100 flex items-center gap-1.5 leading-snug">
                          <span className="truncate">{h.titleFa}</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed text-right line-clamp-2 sm:line-clamp-none">
                          {h.subtitleFa}
                        </p>
                      </div>
                    </div>

                    <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-xl border flex items-center justify-center transition-all shrink-0 ${
                      isChecked
                        ? 'bg-emerald-500 border-emerald-400 text-black shadow-md shadow-emerald-500/30 scale-105'
                        : 'border-zinc-700 bg-[#18181b] text-transparent group-hover:border-zinc-600'
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
              <h4 className="font-bold text-xs sm:text-sm text-zinc-200 flex items-center gap-2">
                <Rocket className="w-4 h-4 text-amber-400 shrink-0" />
                <span>ماموریت شتاب‌دهنده روز</span>
              </h4>
              <span className="text-[11px] sm:text-xs text-amber-400 font-mono whitespace-nowrap bg-amber-500/10 px-2 py-0.5 rounded-lg border border-amber-500/20">
                کمال تعهد (۱۰ از ۱۰)
              </span>
            </div>

            <button
              type="button"
              disabled={isLocked}
              onClick={toggleSpecialMission}
              className={`w-full p-3 sm:p-3.5 rounded-2xl border text-right transition-all flex items-center justify-between gap-3 group cursor-pointer active:scale-[0.98] ${
                activeLog?.specialMission
                  ? 'bg-gradient-to-r from-amber-950/40 via-[#121215] to-[#121215] border-amber-500/50 shadow-md shadow-amber-950/20'
                  : 'bg-[#121215] border-zinc-800 text-zinc-300 hover:border-zinc-700'
              } ${isLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
            >
              <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 transition-all ${
                  activeLog?.specialMission
                    ? 'bg-amber-500/20 text-amber-400 ring-2 ring-amber-500/30'
                    : 'bg-zinc-800 text-zinc-400 group-hover:text-zinc-200'
                }`}>
                  <Target className={`w-5 h-5 ${activeLog?.specialMission ? 'text-amber-400' : 'text-zinc-400 group-hover:text-zinc-200'}`} />
                </div>
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="font-bold text-xs sm:text-sm text-zinc-100 flex items-center gap-2 leading-snug">
                    <span className="truncate">ماموریت ویژه روز</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono border shrink-0 ${
                      activeLog?.specialMission
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-zinc-800 text-zinc-400 border-zinc-700'
                    }`}>
                      +{toPersianDigits(2)} امتیاز
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed text-right line-clamp-2 sm:line-clamp-none">
                    ثبت ماموریت کلیدی امروز در کنار ۵ رکن فونداسیون برای کسب امتیاز کامل ۱۰ از ۱۰.
                  </p>
                </div>
              </div>

              <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-xl border flex items-center justify-center transition-all shrink-0 ${
                activeLog?.specialMission
                  ? 'bg-amber-500 border-amber-400 text-black shadow-md shadow-amber-500/30 scale-105'
                  : 'border-zinc-700 bg-[#18181b] text-transparent group-hover:border-zinc-600'
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
              <div className={`border rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4 transition-all ${
                cleanFailureReason === 'دلایل شخصی'
                  ? 'bg-blue-950/30 border-blue-500/30'
                  : hasFailureReason
                  ? 'bg-[#121215]/80 border-zinc-800'
                  : (isToday ? 'bg-[#121215]/80 border-zinc-800' : 'bg-red-950/30 border-red-500/40')
              }`}>
                <div className="flex items-start sm:items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                    cleanFailureReason === 'دلایل شخصی' 
                      ? 'bg-blue-500/20 text-blue-400' 
                      : hasFailureReason 
                      ? 'bg-zinc-800 text-zinc-300' 
                      : (isToday ? 'bg-zinc-800 text-zinc-300' : 'bg-red-500/20 text-red-400')
                  }`}>
                    {cleanFailureReason === 'دلایل شخصی' ? (
                      <Snowflake className="w-4 h-4" />
                    ) : hasFailureReason ? (
                      <FileText className="w-4 h-4" />
                    ) : (
                      <AlertTriangle className="w-4 h-4" />
                    )}
                  </div>
                  <div>
                    <h4 className="font-bold text-xs sm:text-sm text-zinc-200">
                      {hasFailureReason 
                        ? `علت ثبت شده: ${cleanFailureReason}` 
                        : (isToday ? 'ثبت کالبدشکافی یا توقف شخصی (اختیاری)' : 'کالبدشکافی و تسویه بدهی رفتاری')}
                    </h4>
                    <p className="text-[11px] text-zinc-400 mt-0.5 leading-relaxed">
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
                  className={`w-full sm:w-auto font-bold text-xs px-3.5 py-2 rounded-xl inline-flex items-center justify-center gap-2 transition cursor-pointer border shrink-0 whitespace-nowrap active:scale-[0.98] ${
                    hasFailureReason
                      ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700'
                      : (isToday 
                          ? 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border-zinc-700' 
                          : 'bg-red-950/60 hover:bg-red-900/80 text-red-200 border-red-500/50 shadow-md shadow-red-950/40')
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-zinc-300" />
                  <span>{hasFailureReason ? 'ویرایش کالبدشکافی' : (isToday ? 'ثبت کالبدشکافی امروز' : 'کالبدشکافی این روز')}</span>
                </button>
              </div>
            );
          })()}

          {/* 6. Daily Reflection & Strategy Notes */}
          <div className="bg-[#121215]/80 border border-zinc-800 rounded-2xl p-3.5 sm:p-4 space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <label className="text-xs font-bold text-zinc-200 inline-flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-zinc-400" />
                <span>یادداشت و مشاهدات میدان نبرد</span>
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                {isFuture ? (
                  <span className="text-zinc-500 bg-[#09090b] px-2 py-0.5 rounded-md border border-zinc-800">
                    در روز موعود فعال می‌شود
                  </span>
                ) : isCycleArchived ? (
                  <span className="text-purple-400 bg-purple-950/40 px-2 py-0.5 rounded-md border border-purple-800/50">
                    بایگانی (فقط‌خواندنی)
                  </span>
                ) : (
                  <>
                    <span className={`inline-flex items-center gap-1 font-medium transition-colors ${
                      isSaved ? 'text-emerald-400/80' : 'text-amber-400/80'
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
                    <span className="text-zinc-600">|</span>
                    <span className="text-zinc-500 font-mono">
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
              className={`w-full rounded-xl p-3 text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none transition-all leading-relaxed font-sans resize-none overflow-hidden ${
                isFuture || isCycleArchived
                  ? 'bg-[#09090b]/40 border border-zinc-800 opacity-60 cursor-not-allowed'
                  : 'bg-[#09090b]/90 border border-zinc-800 hover:border-zinc-700 focus:border-rose-500/60 focus:ring-1 focus:ring-rose-500/30'
              }`}
            />
          </div>
        </motion.div>
      </AnimatePresence>
      </div>
    </div>
  );
};
