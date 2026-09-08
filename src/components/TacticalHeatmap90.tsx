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

      let bgClass = 'surface-z1 text-role-muted border-standard hover:border-[var(--color-border-hover)] hover:text-role-secondary';
      let title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): بدون داده`;

      if (isToday) {
        if (computed && computed.statusType === 'standard') {
          if (computed.score === 10) {
            bgClass = 'bg-amber text-[var(--color-canvas-root)] border-amber font-black shadow-subtle ring-2 ring-amber ring-offset-2 ring-offset-[var(--color-canvas-root)] scale-105 z-10';
            title = `روز ${toPersianDigits(dayNumber)} (امروز): کمال تعهد ۱۰ از ۱۰ (۵ پایه + ماموریت ویژه)`;
          } else {
            bgClass = 'bg-emerald text-[var(--color-canvas-root)] border-emerald font-bold shadow-subtle ring-2 ring-emerald ring-offset-2 ring-offset-[var(--color-canvas-root)] scale-105 z-10';
            title = `روز ${toPersianDigits(dayNumber)} (امروز): روز استاندارد ۸ از ۱۰ (۵ پایه کامل)`;
          }
        } else if (computed && computed.statusType === 'personal_frozen') {
          bgClass = 'bg-blue text-role-primary border-blue ring-2 ring-blue ring-offset-2 ring-offset-[var(--color-canvas-root)] scale-105 z-10';
          title = `روز ${toPersianDigits(dayNumber)} (امروز): توقف اضطراری (فریز)`;
        } else {
          // Today in progress (neutral zinc token with amber active battle ring)
          const habitsDone = computed ? computed.habitsCount : 0;
          bgClass = 'surface-z2 text-role-primary border-standard ring-2 ring-amber ring-offset-2 ring-offset-[var(--color-canvas-root)] font-black scale-105 z-10 shadow-subtle';
          title = `روز ${toPersianDigits(dayNumber)} (امروز نبرد جاری): در حال اجرا (${toPersianDigits(habitsDone)} از ۵ پایه)`;
        }
      } else if (computed) {
        if (computed.statusType === 'standard') {
          if (computed.score === 10) {
            // 10/10 Gold / Amber Mastery Day
            bgClass = 'bg-amber text-[var(--color-canvas-root)] border-amber font-black shadow-subtle ring-1 ring-amber-subtle';
            title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): کمال تعهد ۱۰ از ۱۰ (۵ پایه + ماموریت ویژه)`;
          } else {
            // 8/10 Emerald Standard Day
            bgClass = 'bg-emerald text-[var(--color-canvas-root)] border-emerald font-bold shadow-subtle';
            title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): روز استاندارد ۸ از ۱۰ (۵ پایه کامل)`;
          }
        } else if (computed.statusType === 'personal_frozen') {
          bgClass = 'bg-blue text-role-primary border-blue';
          title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): توقف اضطراری (فریز)`;
        } else if (computed.statusType === 'burned_unresolved') {
          bgClass = 'bg-debt text-role-primary border-debt animate-pulse';
          title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): نیازمند کالبدشکافی (بدهی باز)`;
        } else {
          bgClass = 'bg-purple text-role-primary border-purple';
          title = `روز ${toPersianDigits(dayNumber)} (${formatPersianDate(dateStr, { short: true })}): پرونده کالبدشکافی بسته شد`;
        }
      } else if (isPast) {
        bgClass = 'bg-debt-subtle text-debt border-debt-subtle';
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
    <div className="w-full max-w-full surface-z1 border-standard radius-card sm:radius-modal p-3.5 sm:p-5 md:p-7 shadow-subtle space-y-4 sm:space-y-5 overflow-hidden" dir="rtl">
      {/* Header & Unified Summary */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 sm:gap-4 border-b border-[var(--color-border-subtle)] pb-3.5 sm:pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 sm:w-12 sm:h-12 radius-component surface-z2 border-standard flex items-center justify-center text-role-primary shadow-subtle shrink-0">
            <Calendar className="w-5 h-5 sm:w-6 sm:h-6 text-role-primary" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm sm:text-base md:text-lg font-black text-role-primary truncate">
                ماتریس جامع ۹۰ روزه (Tactical 90-Day Matrix)
              </h2>
              <span className="surface-z2 border-standard text-role-secondary text-[10px] px-2.5 py-0.5 radius-capsule font-bold select-none pointer-events-none cursor-default font-mono shrink-0">
                روز {toPersianDigits(metrics.elapsedDays)} از ۹۰
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-role-secondary mt-0.5 sm:mt-1 leading-relaxed">
              نمای سراسری و تعاملی کل چرخه ۹۰ روزه در یک کادر یکپارچه؛ انتخاب هر خانه برای پرش به روز نبرد
            </p>
          </div>
        </div>

        {/* Legend Badges */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] text-role-secondary flex-wrap">
          <div className="inline-flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control border border-amber-subtle text-amber select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 radius-capsule bg-amber shadow-subtle shrink-0"></span>
            <span className="whitespace-nowrap leading-none">کمال ۱۰/۱۰ (با ماموریت ویژه)</span>
          </div>
          <div className="inline-flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control border border-emerald-subtle text-emerald select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 radius-capsule bg-emerald shadow-subtle shrink-0"></span>
            <span className="whitespace-nowrap leading-none">استاندارد ۸/۱۰ (۵ پایه)</span>
          </div>
          <div className="inline-flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control border-standard text-role-primary select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 radius-capsule surface-z3 ring-1 ring-amber shrink-0"></span>
            <span className="whitespace-nowrap leading-none">امروز در حال نبرد</span>
          </div>
          <div className="inline-flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control border border-blue-subtle text-blue select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 radius-capsule bg-blue shrink-0"></span>
            <span className="whitespace-nowrap leading-none">فریز اضطراری</span>
          </div>
          <div className="inline-flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control border border-debt-subtle text-debt select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 radius-capsule bg-debt animate-pulse shrink-0"></span>
            <span className="whitespace-nowrap leading-none">بدهی باز</span>
          </div>
          <div className="inline-flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control border border-purple-subtle text-purple select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 radius-capsule bg-purple shrink-0"></span>
            <span className="whitespace-nowrap leading-none">کالبدشکافی شده</span>
          </div>
          <div className="inline-flex items-center gap-1.5 surface-z2 px-2.5 py-1 radius-control border-standard text-role-muted select-none pointer-events-none whitespace-nowrap">
            <span className="w-2.5 h-2.5 radius-capsule surface-z1 border-standard shrink-0"></span>
            <span className="whitespace-nowrap leading-none">آینده</span>
          </div>
        </div>
      </div>

      {/* Unified 90-Cell Tactical Grid */}
      <div className="w-full max-w-full surface-z2 border-standard radius-card p-2 sm:p-3.5 md:p-5 overflow-hidden touch-pan-y">
        <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-[repeat(15,minmax(0,1fr))] lg:grid-cols-[repeat(18,minmax(0,1fr))] gap-1 sm:gap-1.5 md:gap-2 w-full">
          {allDays.map(cell => (
            <button
              key={cell.dayNumber}
              type="button"
              onClick={() => onSelectDate(cell.dateStr)}
              title={cell.title}
              className={`min-h-[44px] h-10 sm:h-11 md:h-12 w-full min-w-0 radius-control border text-xs sm:text-sm font-mono flex flex-col items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer touch-manipulation select-none focus-ring-tactical ${cell.bgClass}`}
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

