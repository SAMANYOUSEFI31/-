import React, { useState, useRef } from 'react';
import { Cycle } from '../types';
import { getLogicalTodayDate, addDaysToDate, formatPersianDate } from '../utils/dateUtils';
import { toPersianDigits } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { useModalAccessibility } from '../utils/useModalAccessibility';
import { findOverlappingCycle } from '../utils/cycleValidation';
import { 
  Sparkles, 
  Calendar, 
  Target, 
  AlertTriangle, 
  Layers, 
  X, 
  ShieldCheck,
  Flame,
  Swords
} from 'lucide-react';

interface CreateCycleModalProps {
  isOpen: boolean;
  existingCycles: Cycle[];
  onClose: () => void;
  onCreateCycle: (title: string, startDate: string, targetTheme: string) => void;
}

export const CreateCycleModal: React.FC<CreateCycleModalProps> = ({
  isOpen,
  existingCycles,
  onClose,
  onCreateCycle
}) => {
  useBodyScrollLock(isOpen);

  const { containerRef } = useModalAccessibility<HTMLDivElement>({
    isOpen,
    onClose
  });

  const startDateInputRef = useRef<HTMLInputElement>(null);

  const logicalToday = getLogicalTodayDate();
  const nonDemoCycles = existingCycles.filter(c => c.id !== 'cycle-1' && !c.title.includes('(نمونه)'));
  const defaultTitle = `چرخه نبرد ۹۰ روزه (دوره ${toPersianDigits(nonDemoCycles.length + 1)})`;
  
  const [title, setTitle] = useState(defaultTitle);
  const [startDate, setStartDate] = useState(logicalToday);
  const [targetTheme, setTargetTheme] = useState('');
  const [overlapError, setOverlapError] = useState<string | null>(null);

  if (!isOpen) return null;

  const endDate = addDaysToDate(startDate, 89);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !startDate) return;

    const proposedStart = startDate;
    const proposedEnd = endDate;

    // Check for overlap against existing non-demo cycles
    const overlappingCycle = findOverlappingCycle(proposedStart, proposedEnd, existingCycles);

    if (overlappingCycle) {
      soundFX.playWarning();
      haptics.warningAlert();
      setOverlapError(
        `تداخل تقویمی: بازه زمانی این چرخه (${formatPersianDate(proposedStart)} تا ${formatPersianDate(proposedEnd)}) با چرخه «${overlappingCycle.title}» (${formatPersianDate(overlappingCycle.startDate)} تا ${formatPersianDate(overlappingCycle.endDate || addDaysToDate(overlappingCycle.startDate, 89))}) تداخل دارد.`
      );
      // Move focus to start date input so user can immediately correct the date
      setTimeout(() => {
        startDateInputRef.current?.focus();
      }, 50);
      return;
    }

    soundFX.playStandardDay();
    haptics.masterySuccess();
    onCreateCycle(title.trim(), startDate, targetTheme.trim() || 'انضباط و تمرکز بی‌رحمانه');
    onClose();
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-4 overscroll-contain overflow-y-auto"
      dir="rtl"
    >
      <div 
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-cycle-title"
        aria-describedby="create-cycle-description"
        tabIndex={-1}
        className="bg-[#1c1c21] border border-zinc-800 rounded-3xl w-full max-w-lg p-5 sm:p-7 space-y-5 shadow-2xl animate-in zoom-in-95 motion-reduce:animate-none duration-200 relative my-auto focus:outline-none"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 sm:top-4 left-3 sm:left-4 w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition cursor-pointer touch-manipulation"
          title="بستن"
          aria-label="بستن"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="flex items-center gap-3.5 pr-1">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 shadow-lg shadow-amber-500/10">
            <Swords className="w-6 h-6" />
          </div>
          <div>
            <h3 id="create-cycle-title" className="text-base sm:text-lg font-black text-zinc-100 flex items-center gap-2">
              <span>تعریف چرخه ۹۰ روزه نبرد</span>
            </h3>
            <p id="create-cycle-description" className="text-xs text-zinc-400 mt-0.5">
              پایه‌ریزی دوره تمرکز و دیسیپلین سامورایی
            </p>
          </div>
        </div>

        {/* Overlap Error Alert if any */}
        {overlapError && (
          <div 
            id="create-cycle-overlap-error"
            role="alert" 
            aria-live="assertive"
            className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-2xl p-3.5 text-xs font-medium flex items-start gap-2.5 animate-in fade-in motion-reduce:animate-none"
          >
            <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
            <span className="leading-relaxed">{overlapError}</span>
          </div>
        )}

        {/* Cycle Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="create-cycle-title-input" className="text-xs font-bold text-zinc-300 block mb-1.5">
              عنوان چرخه نبرد:
            </label>
            <input
              id="create-cycle-title-input"
              type="text"
              value={title}
              onChange={e => {
                setTitle(e.target.value);
                if (overlapError) setOverlapError(null);
              }}
              placeholder="مثال: چرخه اول — تسلط بر سحرخیزی و کار عمیق"
              required
              className="w-full bg-[#18181b] border border-zinc-800 focus:border-amber-500/60 rounded-xl p-3 text-xs sm:text-sm text-zinc-100 focus:outline-none transition"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="create-cycle-start-date-input" className="text-xs font-bold text-zinc-300 block mb-1.5">
                تاریخ شروع چرخه:
              </label>
              <input
                ref={startDateInputRef}
                id="create-cycle-start-date-input"
                type="date"
                value={startDate}
                aria-invalid={Boolean(overlapError)}
                aria-describedby={overlapError ? "create-cycle-overlap-error create-cycle-start-date-helper" : "create-cycle-start-date-helper"}
                onChange={e => {
                  setStartDate(e.target.value);
                  if (overlapError) setOverlapError(null);
                }}
                required
                className={`w-full bg-[#18181b] border ${overlapError ? 'border-red-500/60' : 'border-zinc-800'} focus:border-amber-500/60 rounded-xl p-2.5 text-xs sm:text-sm text-zinc-100 font-mono focus:outline-none transition text-right`}
              />
              <span id="create-cycle-start-date-helper" className="text-[10px] text-zinc-400 mt-1 block">
                معادل: {formatPersianDate(startDate)}
              </span>
            </div>

            <div>
              <label htmlFor="create-cycle-end-date-output" className="text-xs font-bold text-zinc-400 block mb-1.5">
                پایان دوره (۹۰ روزه):
              </label>
              <output 
                id="create-cycle-end-date-output"
                htmlFor="create-cycle-start-date-input"
                aria-describedby="create-cycle-end-date-helper"
                className="w-full bg-[#18181b]/60 border border-zinc-800 rounded-xl p-2.5 text-xs sm:text-sm text-zinc-400 font-mono select-none flex items-center justify-between block"
              >
                <span>{endDate}</span>
                <span className="text-[10px] text-amber-400 font-sans font-bold">۹۰ روز</span>
              </output>
              <span id="create-cycle-end-date-helper" className="text-[10px] text-zinc-400 mt-1 block">
                معادل: {formatPersianDate(endDate)}
              </span>
            </div>
          </div>

          <div>
            <label htmlFor="create-cycle-theme-input" className="text-xs font-bold text-zinc-300 block mb-1.5">
              میثاق و تم اصلی چرخه (جهت یادآوری هدف):
            </label>
            <textarea
              id="create-cycle-theme-input"
              value={targetTheme}
              onChange={e => setTargetTheme(e.target.value)}
              rows={2}
              placeholder="مثال: بدون بهانه، اراده آهنین در سحرخیزی و اتمام پروژه اصلی"
              className="w-full bg-[#18181b] border border-zinc-800 focus:border-amber-500/60 rounded-xl p-3 text-xs sm:text-sm text-zinc-100 focus:outline-none transition resize-none leading-relaxed"
            />
          </div>

          <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-3 text-[11px] text-zinc-400 flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>چرخه جدید با ۵ رکن استاندارد بوشیدو و سیستم ردیابی رگه استمرار آغاز می‌شود.</span>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-800/80">
            <button
              type="button"
              onClick={onClose}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-bold transition cursor-pointer active:scale-95 motion-reduce:transform-none touch-manipulation"
            >
              انصراف
            </button>
            <button
              type="submit"
              className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black px-6 py-2.5 min-h-[44px] rounded-xl text-xs font-black shadow-lg shadow-amber-500/25 transition cursor-pointer active:scale-95 motion-reduce:transform-none flex items-center gap-1.5 touch-manipulation"
            >
              <Sparkles className="w-4 h-4" />
              <span>آغاز چرخه نبرد</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
