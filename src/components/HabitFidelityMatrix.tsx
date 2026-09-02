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
      let tierColor = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      let barColor = 'bg-emerald-500';

      if (ratePct < 70) {
        tierLabel = 'آسیب‌پذیر (اصطکاک)';
        tierColor = 'text-red-400 bg-red-500/10 border-red-500/20';
        barColor = 'bg-red-500';
      } else if (ratePct < 85) {
        tierLabel = 'استاندارد و مطلوب';
        tierColor = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
        barColor = 'bg-amber-400';
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
    <div className="bg-[#121215]/90 border border-zinc-800 rounded-3xl p-5 sm:p-7 shadow-xl space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800/80 pb-5">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-zinc-800/90 border border-zinc-700/80 flex items-center justify-center text-zinc-200 shadow-md shrink-0">
            <Layers className="w-6 h-6 text-zinc-200" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base sm:text-lg font-black text-zinc-100">
                ماتریس وفاداری به ارکان دیسیپلین (Fidelity Matrix)
              </h2>
              <span className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] px-2.5 py-0.5 rounded-full font-bold select-none pointer-events-none cursor-default font-mono">
                ارزیابی {toPersianDigits(activeBase)} روز فعال
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              تحلیل تفکیکی نرخ وفاداری و پایداری هر یک از ۵ پایه شکست‌ناپذیر در طول چرخه ۹۰ روزه
            </p>
          </div>
        </div>

        {/* Aggregate Pillar Strength Badge */}
        <div className="bg-[#18181b] border border-zinc-800 rounded-2xl px-4 py-2.5 flex items-center gap-3 self-start sm:self-auto shadow-xs">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shrink-0">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="text-right">
            <span className="text-[10px] text-zinc-400 block font-medium">وفاداری میانگین ارکان</span>
            <span className="text-base font-black text-zinc-100 font-mono leading-tight">
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
            className="bg-[#18181b] border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4.5 space-y-3.5 transition-all shadow-xs"
          >
            {/* Title Row */}
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-zinc-800/90 border border-zinc-700/80 flex items-center justify-center shrink-0">
                  {getIcon(habit.iconName, 'text-zinc-200')}
                </div>
                <div>
                  <h4 className="text-sm font-bold text-zinc-100 leading-tight">
                    {habit.titleFa}
                  </h4>
                  <p className="text-[11px] text-zinc-400 mt-0.5 leading-normal">
                    {habit.subtitleFa}
                  </p>
                </div>
              </div>

              {/* Rate percentage badge */}
              <div className="text-left shrink-0">
                <span className="text-lg font-black font-mono text-zinc-100">
                  {toPersianDigits(habit.ratePct)}٪
                </span>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="space-y-1.5">
              <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden border border-zinc-800">
                <div 
                  className={`${habit.barColor} h-full rounded-full transition-all duration-500`}
                  style={{ width: `${habit.ratePct}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-zinc-400">
                <span>{toPersianDigits(habit.successCount)} روز اجرا</span>
                <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold ${habit.tierColor}`}>
                  {habit.tierLabel}
                </span>
              </div>
            </div>
          </div>
        ))}

        {/* Special Mission Bonus Card (6th Card to complete the layout) */}
        <div className="bg-[#18181b] border border-zinc-800 hover:border-zinc-700 rounded-2xl p-4.5 space-y-3.5 transition-all shadow-xs">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                <Rocket className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-amber-300 leading-tight">
                  ماموریت شتاب‌دهنده ویژه
                </h4>
                <p className="text-[11px] text-zinc-400 mt-0.5 leading-normal">
                  ارتقای امتیاز روز از ۸ به ۱۰ (Mastery)
                </p>
              </div>
            </div>

            <div className="text-left shrink-0">
              <span className="text-lg font-black font-mono text-amber-400">
                {toPersianDigits(specialMissionRate)}٪
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="w-full bg-zinc-900 h-2 rounded-full overflow-hidden border border-zinc-800">
              <div 
                className="bg-amber-400 h-full rounded-full transition-all duration-500"
                style={{ width: `${specialMissionRate}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>{toPersianDigits(specialMissionCount)} بار اجرای ماموریت ویژه</span>
              <span className="px-2 py-0.5 rounded-md border text-[10px] font-bold text-amber-300 bg-amber-500/10 border-amber-500/20">
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

