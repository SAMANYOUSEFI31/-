import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Cycle, CycleMetrics, DailyLog } from '../types';
import { addDaysToDate, getLogicalTodayDate, formatPersianDate } from '../utils/dateUtils';
import { toPersianDigits } from '../utils/numberUtils';
import { HabitFidelityMatrix } from './HabitFidelityMatrix';
import { TacticalHeatmap90 } from './TacticalHeatmap90';
import { ResponsiveSubTabBar, SubTabItem } from './ResponsiveSubTabBar';
import { 
  ShieldCheck, 
  Flame, 
  AlertOctagon, 
  Snowflake, 
  Award, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  Zap, 
  Activity, 
  ShieldAlert, 
  Trophy, 
  TrendingUp,
  LayoutDashboard,
  Gauge,
  Grid3X3,
  BarChart3,
  Plus,
  Compass
} from 'lucide-react';

interface CycleDashboardViewProps {
  currentCycle?: Cycle | null;
  metrics?: CycleMetrics | null;
  logs: DailyLog[];
  cycles?: Cycle[];
  allTimeSettings?: {
    allTimeMaxStreak?: number;
    allTimeMaxScore?: number;
    allTimeMaxStandardDays?: number;
  };
  onSelectDate: (date: string) => void;
  onNavigateTab: (tab: string) => void;
  onOpenCreateCycle?: () => void;
}

type DashboardSubTab = 'overview' | 'heatmap' | 'analytics';

const CycleDashboardViewComponent: React.FC<CycleDashboardViewProps> = ({
  currentCycle,
  metrics,
  logs,
  cycles = [],
  allTimeSettings,
  onSelectDate,
  onNavigateTab,
  onOpenCreateCycle
}) => {
  const [activeSubTab, setActiveSubTab] = useState<DashboardSubTab>('overview');
  const [navDirection, setNavDirection] = useState<number>(0);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const logicalToday = getLogicalTodayDate();

  if (!currentCycle || !metrics) {
    return (
      <div className="space-y-6 max-w-lg mx-auto py-12 px-4 animate-in fade-in duration-200" dir="rtl">
        <div className="surface-z1 border-standard radius-modal p-6 sm:p-8 text-center space-y-4 shadow-subtle">
          <div className="w-16 h-16 radius-card bg-amber-subtle border border-amber-subtle flex items-center justify-center mx-auto text-amber">
            <LayoutDashboard className="w-8 h-8" />
          </div>
          <div className="space-y-1.5">
            <h3 className="text-base sm:text-lg font-black text-role-primary">
              اتاق فرماندهی در انتظار چرخه فعال
            </h3>
            <p className="text-xs text-role-secondary leading-relaxed max-w-sm mx-auto">
              جهت مشاهده نقشه‌های تاکتیکی ۹۰ روزه، ماتریس وفاداری به ارکان و رکوردهای دیسیپلین، ابتدا یک چرخه نبرد تعریف کنید.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
            <button
              onClick={onOpenCreateCycle || (() => onNavigateTab('archives'))}
              className="w-full sm:w-auto bg-amber hover:brightness-105 text-[var(--color-canvas-root)] font-black text-xs px-5 py-2.5 radius-component transition cursor-pointer active:scale-95 shadow-subtle inline-flex items-center justify-center gap-1.5 focus-ring-tactical"
            >
              <Plus className="w-4 h-4" />
              <span>تعریف چرخه ۹۰ روزه</span>
            </button>
            <button
              onClick={() => onNavigateTab('archives')}
              className="w-full sm:w-auto surface-z2 hover:brightness-110 text-role-primary font-bold text-xs px-4 py-2.5 radius-component transition cursor-pointer border-standard inline-flex items-center justify-center gap-1.5"
            >
              <span>مشاهده بایگانی</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // All-time highest streak and score records calculation
  const allTimeMaxStreak = Math.max(
    metrics.globalLiveStreak,
    metrics.maxPureStreak,
    allTimeSettings?.allTimeMaxStreak || 0
  );

  const allTimeMaxScore = Math.max(
    metrics.totalScore,
    allTimeSettings?.allTimeMaxScore || 0
  );

  const allTimeMaxStandardDays = Math.max(
    metrics.standardDaysCount,
    allTimeSettings?.allTimeMaxStandardDays || 0
  );

  const elapsedPercentage = Math.min(100, Math.round((metrics.elapsedDays / 90) * 100));

  const hasVulnerabilities = metrics.vulnerableHabits.length > 0;
  const hasUnresolvedDebt = metrics.unresolvedDebtCount > 0;

  const SUB_TABS: SubTabItem<DashboardSubTab>[] = [
    { 
      id: 'overview', 
      label: 'دید کلی', 
      icon: Gauge
    },
    { 
      id: 'heatmap', 
      label: 'نقشه ۹۰ روزه', 
      icon: Grid3X3, 
      badge: `${toPersianDigits(90)} روز`
    },
    { 
      id: 'analytics', 
      label: 'ماتریس عادات', 
      icon: BarChart3, 
      hasAlert: hasVulnerabilities || hasUnresolvedDebt
    },
  ];

  const switchSubTab = (newTab: DashboardSubTab) => {
    const currentIndex = SUB_TABS.findIndex(t => t.id === activeSubTab);
    const nextIndex = SUB_TABS.findIndex(t => t.id === newTab);
    if (currentIndex !== nextIndex) {
      setNavDirection(nextIndex > currentIndex ? 1 : -1);
      setActiveSubTab(newTab);
    }
  };

  // Touch swipe gesture handlers (smart vector disambiguation for fluid sub-tab swiping)
  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    // Only exclude active form inputs; allow smooth swiping starting on cards and matrix squares
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

    // Strict intentional threshold:
    // 1. Vector slope > 1.8 to strictly reject vertical scrolls
    // 2. Clear deliberate movement (>= 65px) or swift flick (>= 45px under 280ms)
    const isQuickFlick = elapsed < 280 && Math.abs(deltaX) >= 45;
    const isStandardSwipe = Math.abs(deltaX) >= 65;

    if ((isStandardSwipe || isQuickFlick) && Math.abs(deltaX) > Math.abs(deltaY) * 1.8) {
      const currentIndex = SUB_TABS.findIndex(t => t.id === activeSubTab);
      if (deltaX < 0) {
        // Swipe Left -> Next Tab in RTL
        if (currentIndex < SUB_TABS.length - 1) {
          switchSubTab(SUB_TABS[currentIndex + 1].id);
        }
      } else {
        // Swipe Right -> Prev Tab in RTL
        if (currentIndex > 0) {
          switchSubTab(SUB_TABS[currentIndex - 1].id);
        }
      }
    }
  };

  const isDemoCycle = currentCycle.id === 'cycle-1' || currentCycle.title.includes('چرخه ۱') || currentCycle.title.includes('فونداسیون');

  return (
    <div 
      className="space-y-6 sm:space-y-8 max-w-5xl mx-auto touch-pan-y w-full select-none" 
      dir="rtl"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* 1. Cycle Hero Header (Obsidian Design System Alignment) */}
      <div className="w-full max-w-full surface-z1 border-standard radius-modal p-4 sm:p-6 relative overflow-hidden shadow-subtle">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
          {/* Main Info Column */}
          <div className="lg:col-span-8 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              {/* Top Row: Temporal Timeline Cluster (روز چند از ۹۰ + بازه تاریخ) followed by Status */}
              <div className="flex items-center gap-2 flex-wrap">
                <div className="surface-z2 border-standard radius-component px-3 py-1 text-xs font-mono inline-flex items-center gap-2 text-role-primary shadow-subtle leading-none">
                  <span className="font-bold text-amber">روز {toPersianDigits(metrics.elapsedDays)} از ۹۰</span>
                  <span className="text-role-muted font-normal">|</span>
                  <span className="text-role-secondary">{formatPersianDate(currentCycle.startDate, { short: true })} تا {formatPersianDate(currentCycle.endDate, { short: true })}</span>
                </div>

                <span className="surface-z0 border border-rose-subtle text-rose px-3 py-1 radius-component text-xs font-bold font-mono inline-flex items-center leading-none">
                  <span>{metrics.statusLabelFa}</span>
                </span>

                {isDemoCycle && (
                  <span className="bg-amber-subtle border border-amber-subtle text-amber px-2.5 py-1 radius-component text-[11px] font-bold font-mono inline-flex items-center gap-1 leading-none">
                    <span>داده‌های شبیه‌سازی (Demo)</span>
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-role-primary tracking-tight">
                {currentCycle.title}
              </h1>

              <p className="text-xs sm:text-sm text-role-secondary leading-relaxed max-w-3xl">
                <span className="font-bold text-role-primary">تمرکز استراتژیک چرخه: </span>
                {currentCycle.targetTheme || 'دستیابی به بالاترین سطح تعهد و دیسیپلین پایدار در طول ۹۰ روز نبرد پیوسته.'}
              </p>

              {/* Progress Bar for 90 Days */}
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-[11px] text-role-secondary font-mono">
                  <span>پیشروی تقویمی دوره</span>
                  <span>{toPersianDigits(elapsedPercentage)}٪ سپری شده</span>
                </div>
                <div className="w-full surface-z0 h-2 radius-capsule overflow-hidden border-standard">
                  <div 
                    className="bg-rose h-full radius-capsule transition-all duration-500" 
                    style={{ width: `${elapsedPercentage}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Coach Voice Banner */}
            <div className="w-full surface-z0 border-standard radius-card p-3.5 sm:p-4 flex items-start gap-3.5 mt-2 shadow-subtle">
              <div className="w-10 h-10 radius-component surface-z2 border-standard flex items-center justify-center text-role-secondary shrink-0">
                <Compass className="w-5 h-5 text-role-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[11px] font-bold text-role-secondary block">پیام رفتاری مربی دیسیپلین:</span>
                <p className="text-xs sm:text-sm text-role-primary font-medium mt-0.5 leading-relaxed">
                  {metrics.coachMessage}
                </p>
              </div>
            </div>
          </div>

          {/* Discipline Score Badge Column (Harmonized with Battlefield Daily Score Box) */}
          <div className="lg:col-span-4 surface-z0 border-standard radius-card p-4 sm:p-5 text-center flex flex-col items-center justify-center space-y-2.5 shadow-subtle transition-all w-full max-w-[280px] mx-auto lg:max-w-none lg:w-full">
            <span className="text-xs text-role-secondary font-medium inline-flex items-center gap-1.5">
              <TrendingUp className="w-4 h-4 text-role-muted" />
              <span>شاخص انضباط سیستم (Discipline Score)</span>
            </span>
            <div className="text-4xl sm:text-5xl font-black font-mono text-role-primary tracking-tight my-1">
              {toPersianDigits(metrics.disciplinePercentage)}<span className="text-xl font-normal text-role-muted">٪</span>
            </div>
            
            <div className={`w-full max-w-[200px] px-3 py-1.5 radius-component border text-xs font-bold text-center ${
              metrics.disciplinePercentage >= 80
                ? 'bg-emerald-subtle border-emerald-subtle text-emerald'
                : metrics.disciplinePercentage < 70
                ? 'bg-debt-subtle border-debt-subtle text-debt'
                : 'surface-z2 border-standard text-role-primary'
            }`}>
              {metrics.disciplineLevel}
            </div>

            <p className="text-[10px] text-role-muted text-center leading-normal pt-1">
              محاسبه پیوسته با مخرج شبح طبق متدولوژی بوشیدو
            </p>
          </div>
        </div>
      </div>

      {/* 2. Progressive Disclosure Sub-Segmented Navigation Control with Spring layoutId Indicator */}
      <ResponsiveSubTabBar<DashboardSubTab>
        tabs={SUB_TABS}
        activeTab={activeSubTab}
        onSelectTab={switchSubTab}
        layoutId="activeCycleSubTabIndicator"
      />

      {/* 3. Dynamic Animated Content Area with Directional Slide Transitions */}
      <AnimatePresence mode="wait" initial={false}>
        {activeSubTab === 'overview' && (
          <motion.div
            key="overview"
            initial={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? -16 : 16) : 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? 16 : -16) : 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-6 sm:space-y-8"
          >
            {/* Key Metrics Bento Grid (معیارهای پویای چرخه فعلی با نسبت طلایی و ارتفاع هماهنگ) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
              {/* Streak Card (Fiery Rose) */}
              <div className="surface-z1 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 min-h-[112px] flex flex-col justify-between transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-role-secondary">زنجیره فعال</span>
                  <div className="w-7 h-7 radius-component bg-rose-subtle flex items-center justify-center shrink-0">
                    <Flame className="w-4 h-4 text-rose" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-rose leading-none my-1">
                  {toPersianDigits(metrics.pureStreak)} <span className="text-xs text-role-muted font-normal">روز</span>
                </div>
                <p className="text-[11px] text-role-secondary truncate">
                  سقف دوره: {toPersianDigits(metrics.maxPureStreak)} روز
                </p>
              </div>

              {/* Standard Days (Emerald) */}
              <div className="surface-z1 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 min-h-[112px] flex flex-col justify-between transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-role-secondary">روزهای استاندارد</span>
                  <div className="w-7 h-7 radius-component bg-emerald-subtle flex items-center justify-center shrink-0">
                    <CheckCircle2 className="w-4 h-4 text-emerald" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-emerald leading-none my-1">
                  {toPersianDigits(metrics.standardDaysCount)} <span className="text-xs text-role-muted font-normal">/ {toPersianDigits(metrics.logsCount)}</span>
                </div>
                <p className="text-[11px] text-role-secondary truncate">
                  نرخ موفقیت: {toPersianDigits(metrics.logsCount > 0 ? Math.round((metrics.standardDaysCount / metrics.logsCount) * 100) : 0)}٪
                </p>
              </div>

              {/* Total Score (Amber) */}
              <div className="surface-z1 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 min-h-[112px] flex flex-col justify-between transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-role-secondary">مجموع امتیاز</span>
                  <div className="w-7 h-7 radius-component bg-amber-subtle flex items-center justify-center shrink-0">
                    <Award className="w-4 h-4 text-amber" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-amber leading-none my-1">
                  {toPersianDigits(metrics.totalScore)}
                </div>
                <p className="text-[11px] text-role-secondary truncate">
                  سقف دوره‌ای: {toPersianDigits(metrics.elapsedDays * 10)}
                </p>
              </div>

              {/* Unresolved Debt (Neutral Surface with conditional status accent) */}
              <div className="surface-z1 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 min-h-[112px] flex flex-col justify-between transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-role-secondary">بدهی کالبدشکافی</span>
                  <div className={`w-7 h-7 radius-component surface-z2 border-standard flex items-center justify-center shrink-0 ${
                    metrics.unresolvedDebtCount > 0 ? 'text-debt' : 'text-role-muted'
                  }`}>
                    <AlertOctagon className="w-4 h-4" />
                  </div>
                </div>
                <div className={`text-2xl font-bold font-mono leading-none my-1 ${
                  metrics.unresolvedDebtCount > 0 ? 'text-debt' : 'text-role-primary'
                }`}>
                  {toPersianDigits(metrics.unresolvedDebtCount)} <span className="text-xs text-role-muted font-normal">روز</span>
                </div>
                <p className="text-[11px] text-role-secondary truncate">
                  {metrics.unresolvedDebtCount > 0 ? 'نیازمند کالبدشکافی فوری' : 'بدون بدهی معوق'}
                </p>
              </div>

              {/* Resolved Debt (Neutral Surface) */}
              <div className="surface-z1 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 min-h-[112px] flex flex-col justify-between transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-role-secondary">کالبدشکافی شده</span>
                  <div className="w-7 h-7 radius-component surface-z2 border-standard flex items-center justify-center shrink-0 text-role-muted">
                    <ShieldCheck className="w-4 h-4 text-role-muted" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-role-primary leading-none my-1">
                  {toPersianDigits(metrics.resolvedDebtCount)} <span className="text-xs text-role-muted font-normal">روز</span>
                </div>
                <p className="text-[11px] text-role-secondary truncate">
                  پرونده‌های تحلیل‌شده
                </p>
              </div>

              {/* Frozen Days (Neutral Surface) */}
              <div className="surface-z1 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 min-h-[112px] flex flex-col justify-between transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-role-secondary">توقف اضطراری</span>
                  <div className="w-7 h-7 radius-component surface-z2 border-standard flex items-center justify-center shrink-0 text-role-muted">
                    <Snowflake className="w-4 h-4 text-role-muted" />
                  </div>
                </div>
                <div className="text-2xl font-bold font-mono text-role-primary leading-none my-1">
                  {toPersianDigits(metrics.frozenDaysCount)} <span className="text-xs text-role-muted font-normal">روز</span>
                </div>
                <p className="text-[11px] text-role-secondary truncate">
                  فریز بدون جریمه
                </p>
              </div>
            </div>

            {/* Hall of Records & Benchmark Comparison (تالار رکوردها و معیارهای کلان) */}
            <div className="surface-z1 border-standard radius-modal p-5 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 radius-card surface-z2 border-standard flex items-center justify-center text-role-primary shrink-0">
                    <Trophy className="w-5 h-5 text-role-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm sm:text-base font-bold text-role-primary">
                      تالار رکوردها و قله‌های دیسیپلین (Hall of Records)
                    </h3>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-1">
                {/* Record 1: All-Time Longest Streak (Fiery Rose/Flame) */}
                <div className="surface-z0 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 space-y-2.5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-role-secondary font-medium">طولانی‌ترین زنجیره تاریخ</span>
                    <div className="w-8 h-8 radius-component bg-rose-subtle border border-rose-subtle flex items-center justify-center shrink-0">
                      <Flame className="w-4 h-4 text-rose" />
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl sm:text-3xl font-black font-mono text-rose">
                      {toPersianDigits(allTimeMaxStreak)}
                    </span>
                    <span className="text-xs text-role-secondary font-mono">روز متوالی</span>
                  </div>
                  <div className="text-[11px] text-role-secondary flex items-center justify-between pt-1 border-t border-[var(--color-border-subtle)]">
                    <span>در چرخه فعلی:</span>
                    <span className="font-bold text-rose font-mono">{toPersianDigits(metrics.maxPureStreak)} روز</span>
                  </div>
                </div>

                {/* Record 2: Max Standard Days (Vitality Emerald) */}
                <div className="surface-z0 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 space-y-2.5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-role-secondary font-medium">بیشترین روزهای استاندارد</span>
                    <div className="w-8 h-8 radius-component bg-emerald-subtle border border-emerald-subtle flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald" />
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl sm:text-3xl font-black font-mono text-emerald">
                      {toPersianDigits(allTimeMaxStandardDays)}
                    </span>
                    <span className="text-xs text-role-secondary font-mono">روز (۵/۵ کامل)</span>
                  </div>
                  <div className="text-[11px] text-role-secondary flex items-center justify-between pt-1 border-t border-[var(--color-border-subtle)]">
                    <span>در چرخه فعلی:</span>
                    <span className="font-bold text-emerald font-mono">{toPersianDigits(metrics.standardDaysCount)} روز</span>
                  </div>
                </div>

                {/* Record 3: Highest Score Accumulated (Imperial Amber) */}
                <div className="surface-z0 border-standard hover:border-[var(--color-border-hover)] radius-card p-4 space-y-2.5 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-role-secondary font-medium">بالاترین امتیاز کسب‌شده</span>
                    <div className="w-8 h-8 radius-component bg-amber-subtle border border-amber-subtle flex items-center justify-center shrink-0">
                      <Award className="w-4 h-4 text-amber" />
                    </div>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl sm:text-3xl font-black font-mono text-amber">
                      {toPersianDigits(allTimeMaxScore)}
                    </span>
                    <span className="text-xs text-role-secondary font-mono">امتیاز کل</span>
                  </div>
                  <div className="text-[11px] text-role-secondary flex items-center justify-between pt-1 border-t border-[var(--color-border-subtle)]">
                    <span>در چرخه فعلی:</span>
                    <span className="font-bold text-amber font-mono">{toPersianDigits(metrics.totalScore)}</span>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {activeSubTab === 'heatmap' && (
          <motion.div
            key="heatmap"
            initial={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? -16 : 16) : 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? 16 : -16) : 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-6"
          >
            {/* 90-Day Tactical Heatmap (نقشه حرارتی و ماتریس ۹۰ روزه در ۳ فاز) */}
            <TacticalHeatmap90
              currentCycle={currentCycle}
              metrics={metrics}
              logs={logs}
              onSelectDate={onSelectDate}
            />
          </motion.div>
        )}

        {activeSubTab === 'analytics' && (
          <motion.div
            key="analytics"
            initial={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? -16 : 16) : 0 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: navDirection !== 0 ? (navDirection > 0 ? 16 : -16) : 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-6 sm:space-y-8"
          >
            {/* Habit Fidelity Matrix (ماتریس وفاداری به ارکان دیسیپلین) */}
            <HabitFidelityMatrix
              currentCycle={currentCycle}
              metrics={metrics}
              logs={logs}
            />

            {/* Friction Analysis & Critical Vulnerabilities (تحلیل اصطکاک و ریشه‌یابی کلان) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              {/* Vulnerability Radar */}
              <div className="surface-z1 border-standard radius-modal p-5 sm:p-6 flex flex-col justify-between space-y-4">
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 radius-card surface-z2 border-standard flex items-center justify-center text-role-secondary shrink-0">
                      <ShieldAlert className="w-5 h-5 text-role-secondary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm sm:text-base text-role-primary">
                        آسیب‌پذیری‌های بحرانی
                      </h3>
                      <p className="text-xs text-role-secondary mt-0.5">
                        پایه‌های تعهد با نرخ اجرای کمتر از ۷۰٪
                      </p>
                    </div>
                  </div>

                  {metrics.vulnerableHabits.length === 0 ? (
                    <div className="bg-emerald-subtle border border-emerald-subtle radius-card p-6 text-center flex-1 flex flex-col items-center justify-center my-auto min-h-[140px]">
                      <CheckCircle2 className="w-8 h-8 text-emerald mb-2" />
                      <p className="text-sm font-bold text-emerald">
                        پایداری کامل ارکان فونداسیون
                      </p>
                      <p className="text-xs text-role-secondary mt-1 max-w-sm text-center">
                        تمام ۵ پایه تعهد در این چرخه با نرخ بالای ۷۰٪ در وضعیت کاملاً پایدار قرار دارند.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {metrics.vulnerableHabits.map(v => (
                        <div key={v.key} className="surface-z0 border-standard radius-card p-3.5 flex items-center justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm text-role-primary flex items-center gap-2 flex-wrap">
                              <span>{v.titleFa}</span>
                              <span className="text-xs bg-debt-subtle text-debt border border-debt-subtle px-2 py-0.5 radius-control font-mono">
                                {toPersianDigits(v.ratePct)}٪ موفقیت
                              </span>
                            </div>
                            <p className="text-xs text-role-secondary mt-0.5">
                              {toPersianDigits(v.successCount)} روز اجرا از {toPersianDigits(v.totalEvaluated)} روز ارزیابی شده
                            </p>
                          </div>

                          <div className="w-24 surface-z2 h-2.5 radius-capsule overflow-hidden shrink-0 border-standard">
                            <div 
                              className="bg-debt h-full radius-capsule" 
                              style={{ width: `${v.ratePct}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Dominant Failure Patterns */}
              <div className="surface-z1 border-standard radius-modal p-5 sm:p-6 flex flex-col justify-between space-y-4">
                <div className="flex-1 flex flex-col">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 radius-card surface-z2 border-standard flex items-center justify-center text-role-secondary shrink-0">
                      <Activity className="w-5 h-5 text-role-secondary" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm sm:text-base text-role-primary">
                        الگوهای اصطکاک و ریشه‌یابی
                      </h3>
                    </div>
                  </div>

                  <div className="space-y-3 flex-1 flex flex-col justify-center">
                    <div className="surface-z0 border-standard radius-card p-4">
                      <div className="text-xs text-role-secondary">غالب‌ترین دلیل شکست در این چرخه:</div>
                      <div className="text-base font-semibold text-role-primary mt-1 flex items-center gap-2">
                        <AlertOctagon className="w-4 h-4 text-role-muted shrink-0" />
                        <span>{metrics.dominantFailureReason}</span>
                      </div>
                    </div>

                    <div className="surface-z0 border-standard radius-card p-4">
                      <div className="text-xs text-role-secondary">بحرانی‌ترین زمان افت دیسیپلین:</div>
                      <div className="text-base font-semibold text-role-primary mt-1 flex items-center gap-2">
                        <Clock className="w-4 h-4 text-role-muted shrink-0" />
                        <span>{metrics.dominantFailureTime}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const CycleDashboardView = React.memo(CycleDashboardViewComponent);

