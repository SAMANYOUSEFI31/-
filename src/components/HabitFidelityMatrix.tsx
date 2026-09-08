import React, { useMemo } from 'react';
import { DailyLog, Cycle, CycleMetrics } from '../types';
import { FOUNDATION_HABITS } from '../engine/bushidoCalculations';
import { toPersianDigits } from '../utils/numberUtils';
import { 
  Sun, 
  Dumbbell, 
  BookOpen, 
  PenTool, 
  Briefcase, 
  Rocket, 
  ShieldCheck, 
  Layers, 
  CheckCircle2 
} from 'lucide-react';

interface HabitFidelityMatrixProps {
  currentCycle?: Cycle | null;
  metrics?: CycleMetrics | null;
  logs: DailyLog[];
}

const HabitFidelityMatrixComponent: React.FC<HabitFidelityMatrixProps> = ({
  currentCycle,
  metrics,
  logs
}) => {
  const {
    habitStats,
    specialMissionRate,
    specialMissionCount,
    activeBase,
    averageFidelity
  } = useMemo(() => {
    if (!currentCycle || !metrics) {
      return {
        habitStats: [],
        specialMissionRate: 0,
        specialMissionCount: 0,
        activeBase: 0,
        averageFidelity: 0
      };
    }

    const cycleLogs = logs.filter(
      l => l.cycleId === currentCycle.id || (l.date >= currentCycle.startDate && l.date <= currentCycle.endDate)
    );

    const totalLogs = cycleLogs.length;
    const base = Math.max(1, totalLogs - (metrics.frozenDaysCount || 0));

    // Calculate statistics for all 5 foundation habits
    const stats = FOUNDATION_HABITS.map(h => {
      const successCount = cycleLogs.filter(l => l[h.key]).length;
      const ratePct = totalLogs > 0 ? Math.round((successCount / base) * 100) : 0;
      
      let tierLabel = 'آهنین و پایدار';
      let tierColor = 'text-emerald bg-emerald-subtle border-emerald-subtle';
      let barColor = 'bg-emerald';

      if (ratePct < 70) {
        tierLabel = 'آسیب‌پذیر (اصطکاک)';
        tierColor = 'text-debt bg-debt-subtle border-debt-subtle';
        barColor = 'bg-debt';
      } else if (ratePct < 85) {
        tierLabel = 'استاندارد و مطلوب';
        tierColor = 'text-amber bg-amber-subtle border-amber-subtle';
        barColor = 'bg-amber';
      }

      return {
        ...h,
        successCount,
        ratePct,
        tierLabel,
        tierColor,
        barColor
      };
    });

    const missionCount = cycleLogs.filter(l => l.specialMission).length;
    const missionRate = totalLogs > 0 ? Math.round((missionCount / totalLogs) * 100) : 0;
    const avgFidelity = totalLogs > 0 ? Math.round(stats.reduce((acc, h) => acc + h.ratePct, 0) / stats.length) : 0;

    return {
      habitStats: stats,
      specialMissionRate: missionRate,
      specialMissionCount: missionCount,
      activeBase: base,
      averageFidelity: avgFidelity
    };
  }, [logs, currentCycle.id, currentCycle.startDate, currentCycle.endDate, metrics.frozenDaysCount]);

  // Icon mapping for each habit key
  const getIcon = (iconName: string, colorClass: string) => {
    const props = { className: `w-5 h-5 ${colorClass}` };
    switch (iconName) {
      case 'Sun': return <Sun {...props} />;
      case 'Dumbbell': return <Dumbbell {...props} />;
      case 'BookOpen': return <BookOpen {...props} />;
      case 'PenTool': return <PenTool {...props} />;
      case 'Briefcase': return <Briefcase {...props} />;
      default: return <CheckCircle2 {...props} />;
    }
  };

  return (
    <div className="surface-z1 border-standard radius-card sm:radius-modal p-5 sm:p-7 shadow-subtle space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--color-border-subtle)] pb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 radius-component surface-z2 border-standard flex items-center justify-center text-role-primary shadow-subtle shrink-0">
            <Layers className="w-6 h-6 text-role-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-role-primary">
                ماتریس وفاداری به ارکان دیسیپلین (Fidelity Matrix)
              </h2>
              <span className="surface-z2 border-standard text-role-secondary text-[10px] px-2.5 py-0.5 radius-capsule font-bold select-none pointer-events-none cursor-default font-mono">
                ارزیابی {toPersianDigits(activeBase)} روز فعال
              </span>
            </div>
            <p className="text-xs text-role-secondary mt-1">
              تحلیل تفکیکی نرخ وفاداری و پایداری هر یک از ۵ پایه شکست‌ناپذیر در طول چرخه ۹۰ روزه
            </p>
          </div>
        </div>

        {/* Aggregate Pillar Strength Badge */}
        <div className="surface-z2 border-standard radius-card px-4 py-2.5 flex items-center gap-3 self-start sm:self-auto shadow-subtle">
          <div className="w-10 h-10 radius-component bg-emerald-subtle border border-emerald-subtle flex items-center justify-center text-emerald shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald" />
          </div>
          <div className="text-right">
            <span className="text-[10px] text-role-secondary block font-medium">وفاداری میانگین ارکان</span>
            <span className="text-base font-black text-role-primary font-mono leading-tight">
              {toPersianDigits(averageFidelity)}٪
            </span>
          </div>
        </div>
      </div>

      {/* 5 Core Pillars Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {habitStats.map(habit => (
          <div 
            key={habit.key}
            className="surface-z2 border-standard hover:border-[var(--color-border-hover)] radius-card p-4.5 space-y-3.5 transition-all shadow-subtle"
          >
            {/* Title Row */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 radius-component surface-z3 border-standard flex items-center justify-center shrink-0">
                  {getIcon(habit.iconName, 'text-role-primary')}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-role-primary leading-tight">
                    {habit.titleFa}
                  </h4>
                  <p className="text-[11px] text-role-secondary mt-0.5 leading-normal">
                    {habit.subtitleFa}
                  </p>
                </div>
              </div>

              {/* Rate percentage badge */}
              <div className="text-left shrink-0">
                <span className="text-lg font-black font-mono text-role-primary">
                  {toPersianDigits(habit.ratePct)}٪
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full surface-z0 h-2 radius-capsule overflow-hidden border-standard">
                <div 
                  className={`${habit.barColor} h-full radius-capsule transition-all duration-500`}
                  style={{ width: `${habit.ratePct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-role-secondary">
                <span>{toPersianDigits(habit.successCount)} روز اجرا</span>
                <span className={`px-2 py-0.5 radius-control border text-[10px] font-bold ${habit.tierColor}`}>
                  {habit.tierLabel}
                </span>
              </div>
            </div>
          </div>
        ))}

        {/* Special Mission Bonus Card (6th Card to complete the layout) */}
        <div className="surface-z2 border-standard hover:border-[var(--color-border-hover)] radius-card p-4.5 space-y-3.5 transition-all shadow-subtle">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 radius-component bg-amber-subtle border border-amber-subtle flex items-center justify-center shrink-0">
                <Rocket className="w-5 h-5 text-amber" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber leading-tight">
                  ماموریت شتاب‌دهنده ویژه
                </h4>
                <p className="text-[11px] text-role-secondary mt-0.5 leading-normal">
                  ارتقای امتیاز روز از ۸ به ۱۰ (Mastery)
                </p>
              </div>
            </div>

            <div className="text-left shrink-0">
              <span className="text-lg font-black font-mono text-amber">
                {toPersianDigits(specialMissionRate)}٪
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="w-full surface-z0 h-2 radius-capsule overflow-hidden border-standard">
              <div 
                className="bg-amber h-full radius-capsule transition-all duration-500"
                style={{ width: `${specialMissionRate}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-role-secondary">
              <span>{toPersianDigits(specialMissionCount)} بار اجرای ماموریت ویژه</span>
              <span className="px-2 py-0.5 radius-control border text-[10px] font-bold text-amber bg-amber-subtle border-amber-subtle">
                ارزش افزوده (+۲)
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const HabitFidelityMatrix = React.memo(HabitFidelityMatrixComponent);

