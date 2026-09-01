import React, { useMemo } from 'react';
import { DailyLog, Cycle, CycleMetrics } from '../types';
import { addDaysToDate, formatPersianDate, getLogicalTodayDate } from '../utils/dateUtils';
import { computeDailyProperties } from '../engine/bushidoCalculations';
import { toPersianDigits } from '../utils/numberUtils';
import { 
  Calendar
} from 'lucide-react';

interface TacticalHeatmap90Props {
  currentCycle?: Cycle | null;
  metrics?: CycleMetrics | null;
  logs: DailyLog[];
  onSelectDate: (date: string) => void;
}

const TacticalHeatmap90Component: React.FC<TacticalHeatmap90Props> = ({
  currentCycle,
  metrics,
  logs,
  onSelectDate
}) => {
  const logicalToday = getLogicalTodayDate();

  // Create O(1) date-indexed lookup map for fast lookups across 90 days
  const logsByDate = useMemo(() => {
    const map = new Map<string, DailyLog>();
    for (let i = 0; i < logs.length; i++) {
      map.set(logs[i].date, logs[i]);
    }
    return map;
  }, [logs]);

  // Generate unified and precomputed 90 days array with static classes
  const allDays = useMemo(() => {
    if (!currentCycle) return [];
    return Array.from({ length: 90 }, (_, idx) => {
      const dayNumber = idx + 1;
      const dateStr = addDaysToDate(currentCycle.startDate, idx);
      const dayLog = logsByDate.get(dateStr);
      const computed = dayLog ? computeDailyProperties(dayLog, logs, logicalToday, currentCycle.startDate) : null;
      const isToday = dateStr === logicalToday;
      const isPast = dateStr < logicalToday;
      const isFuture = dateStr > logicalToday;

      let bgClass = 'bg-[#121215] text-zinc-500 border-zinc-800 hover:border-zinc-700 hover:text-zinc-300';
      let title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): بدون داده`;

      if (isToday) {
        if (computed && computed.statusType === 'standard') {
          if (computed.score === 10) {
            bgClass = 'bg-gradient-to-br from-amber-400 to-amber-500 text-zinc-950 border-amber-300 font-black shadow-md ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-950 scale-105 z-10';
            title = `روز ${toPersianDigits(dayNumber)} (امروز): کمال تعهد ۱۰ از ۱۰ (۵ پایه + ماموریت ویژه)`;
          } else {
            bgClass = 'bg-emerald-500 text-black border-emerald-400 font-bold shadow-md ring-2 ring-emerald-400 ring-offset-2 ring-offset-zinc-950 scale-105 z-10';
            title = `روز ${toPersianDigits(dayNumber)} (امروز): روز استاندارد ۸ از ۱۰ (۵ پایه کامل)`;
          }
        } else if (computed && computed.statusType === 'personal_frozen') {
          bgClass = 'bg-blue-600 text-white border-blue-400 ring-2 ring-blue-400 ring-offset-2 ring-offset-zinc-950 scale-105 z-10';
          title = `روز ${toPersianDigits(dayNumber)} (امروز): توقف اضطراری (فریز)`;
        } else {
          // Today in progress (neutral zinc token with amber active battle ring)
          const habitsDone = computed ? computed.habitsCount : 0;
          bgClass = 'bg-zinc-800 text-zinc-100 border-zinc-600 ring-2 ring-amber-400 ring-offset-2 ring-offset-zinc-950 font-black scale-105 z-10 shadow-lg';
          title = `روز ${toPersianDigits(dayNumber)} (امروز نبرد جاری): در حال اجرا (${toPersianDigits(habitsDone)} از ۵ پایه)`;
        }
      } else if (computed) {
        if (computed.statusType === 'standard') {
          if (computed.score === 10) {
            // 10/10 Gold / Amber Mastery Day
            bgClass = 'bg-gradient-to-br from-amber-400 to-amber-500 text-zinc-950 border-amber-300 font-black shadow-md ring-1 ring-amber-400/40';
            title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): کمال تعهد ۱۰ از ۱۰ (۵ پایه + ماموریت ویژه)`;
          } else {
            // 8/10 Emerald Standard Day
            bgClass = 'bg-emerald-500 text-black border-emerald-400 font-bold shadow-xs';
            title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): روز استاندارد ۸ از ۱۰ (۵ پایه کامل)`;
          }
        } else if (computed.statusType === 'personal_frozen') {
          bgClass = 'bg-blue-600 text-white border-blue-400';
          title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): توقف اضطراری (فریز)`;
        } else if (computed.statusType === 'burned_unresolved') {
          bgClass = 'bg-red-600 text-white border-red-400 animate-pulse';
          title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): نیازمند کالبدشکافی (بدهی باز)`;
        } else {
          bgClass = 'bg-purple-600 text-white border-purple-400';
          title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): پرونده کالبدشکافی بسته شد`;
        }
      } else if (isPast) {
        bgClass = 'bg-red-950/40 text-red-400 border-red-900/60';
        title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): ثبت نشده (غیبت تقویمی)`;
      }

      return {
        dayNumber,
        dateStr,
        dayNumberPersian: toPersianDigits(dayNumber),
        bgClass,
        title
      };
    });
  }, [currentCycle.startDate, logsByDate, logs, logicalToday]);

  return (
    <div className="w-full max-w-full bg-[#121215] border border-zinc-800 rounded-2xl sm:rounded-3xl p-3.5 sm:p-5 md:p-7 shadow-xl space-y-4 sm:space-y-5 overflow-hidden" dir="rtl">
      {/* Header & Unified Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4 border-b border-zinc-800/80 pb-3.5 sm:pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shadow-md shrink-0">
            <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-200" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base md:text-lg font-black text-zinc-100 truncate">
                ماتریس جامع ۹۰ روزه (Tactical 90-Day Matrix)
              </h2>
              <span className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] px-2.5 py-0.5 rounded-full font-bold select-none pointer-events-none cursor-default font-mono shrink-0">
                روز {toPersianDigits(metrics.elapsedDays)} از ۹۰
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 sm:mt-1 leading-relaxed">
              نمای سراسری و تعاملی کل چرخه ۹۰ روزه در یک کادر یکپارچه؛ انتخاب هر خانه برای پرش به روز نبرد
            </p>
          </div>
        </div>

        {/* Legend Badges */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-zinc-400 flex-wrap">
          <div className="inline-flex items-center gap-1.5 bg-[#18181b] px-2.5 py-1 rounded-xl border border-amber-500/30 text-amber-300 select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 shadow-xs shrink-0"></span>
            <span className="whitespace-nowrap leading-none">کمال ۱۰/۱۰ (با ماموریت ویژه)</span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-[#18181b] px-2.5 py-1 rounded-xl border border-emerald-500/30 text-emerald-300 select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-xs shrink-0"></span>
            <span className="whitespace-nowrap leading-none">استاندارد ۸/۱۰ (۵ پایه)</span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-[#18181b] px-2.5 py-1 rounded-xl border border-zinc-700 text-zinc-200 select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-400 ring-1 ring-amber-400 shrink-0"></span>
            <span className="whitespace-nowrap leading-none">امروز در حال نبرد</span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-[#18181b] px-2.5 py-1 rounded-xl border border-zinc-800 select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-500 shrink-0"></span>
            <span className="whitespace-nowrap leading-none">فریز اضطراری</span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-[#18181b] px-2.5 py-1 rounded-xl border border-zinc-800 select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse shrink-0"></span>
            <span className="whitespace-nowrap leading-none">بدهی باز</span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-[#18181b] px-2.5 py-1 rounded-xl border border-zinc-800 select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-600 shrink-0"></span>
            <span className="whitespace-nowrap leading-none">کالبدشکافی شده</span>
          </div>
          <div className="inline-flex items-center gap-1.5 bg-[#18181b] px-2.5 py-1 rounded-xl border border-zinc-800 select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 rounded-full bg-zinc-800 border border-zinc-700 shrink-0"></span>
            <span className="whitespace-nowrap leading-none">آینده</span>
          </div>
        </div>
      </div>

      {/* Unified 90-Cell Tactical Grid */}
      <div className="w-full max-w-full bg-[#18181b] border border-zinc-800/90 rounded-xl sm:rounded-2xl p-2 sm:p-3.5 md:p-5 overflow-hidden touch-pan-y">
        <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-15 lg:grid-cols-18 gap-1 sm:gap-1.5 md:gap-2 w-full">
          {allDays.map(cell => (
            <button
              key={cell.dayNumber}
              type="button"
              onClick={() => onSelectDate(cell.dateStr)}
              title={cell.title}
              className={`min-h-[44px] h-10 sm:h-11 md:h-12 w-full min-w-0 rounded-xl border text-xs sm:text-sm font-mono flex flex-col items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer touch-manipulation select-none ${cell.bgClass}`}
            >
              <span className="leading-none">{cell.dayNumberPersian}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export const TacticalHeatmap90 = React.memo(TacticalHeatmap90Component);

