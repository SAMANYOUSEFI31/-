import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DailyLog, FailureReason, FailureTime } from '../types';
import { formatPersianDate } from '../utils/dateUtils';
import { FOUNDATION_HABITS } from '../engine/bushidoCalculations';
import { getDeterministicAutopsy } from '../engine/deterministicSensei';
import { toPersianDigits } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { 
  X, 
  Sparkles, 
  AlertTriangle, 
  Clock, 
  CheckCircle2, 
  Brain, 
  ShieldAlert, 
  Target, 
  Flame, 
  Snowflake,
  Loader2,
  ChevronRight,
  ChevronLeft,
  ListOrdered
} from 'lucide-react';

interface AutopsyModalProps {
  log: DailyLog;
  cycleTheme?: string;
  allUnresolvedLogs?: DailyLog[];
  onSelectLog?: (log: DailyLog) => void;
  onSave: (updatedLog: DailyLog) => void;
  onClose: () => void;
}

const FAILURE_REASONS: FailureReason[] = [
  'وقتم رو به خوبی مدیریت نکردم',
  'نیمه‌کاره رها کردم',
  'بی‌برنامه بودم',
  'دلایل شخصی'
];

const FAILURE_TIMES: FailureTime[] = [
  'اول روز',
  'وسط روز',
  'آخر روز'
];

export const AutopsyModal: React.FC<AutopsyModalProps> = ({
  log,
  cycleTheme,
  allUnresolvedLogs = [],
  onSelectLog,
  onSave,
  onClose
}) => {
  useBodyScrollLock(true);

  const [reason, setReason] = useState<FailureReason>(log.failureReason || '');
  const [time, setTime] = useState<FailureTime>(log.failureTime || '');
  const [notes, setNotes] = useState(log.autopsyNotes || '');
  const [countermeasure, setCountermeasure] = useState(log.countermeasure || '');
  const [aiFeedback, setAiFeedback] = useState(log.aiFeedback || '');
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const currentLogIdRef = useRef(log.id);
  currentLogIdRef.current = log.id;

  // Sync state when log changes (e.g. when user clicks next/prev debt day or saves current debt)
  useEffect(() => {
    setReason(log.failureReason || '');
    setTime(log.failureTime || '');
    setNotes(log.autopsyNotes || '');
    setCountermeasure(log.countermeasure || '');
    setAiFeedback(log.aiFeedback || '');
    setIsLoadingAi(false);
  }, [log.id, log.date, log.failureReason, log.failureTime, log.autopsyNotes, log.countermeasure, log.aiFeedback]);

  // Clean up loading state on unmount
  useEffect(() => {
    return () => {
      setIsLoadingAi(false);
    };
  }, []);

  const missedHabits = FOUNDATION_HABITS
    .filter(h => !log[h.key])
    .map(h => h.titleFa);

  // Calculate current index among unresolved debt days
  const currentIndex = allUnresolvedLogs.findIndex(l => l.date === log.date);
  const totalDebts = allUnresolvedLogs.length;
  const hasMultipleDebts = totalDebts > 1 && onSelectLog;

  const handleAiAutopsy = async () => {
    const targetLogId = log.id;
    setIsLoadingAi(true);
    try {
      // Direct local deterministic engine call with backend sync
      const localResult = getDeterministicAutopsy({
        date: log.date,
        missedHabits,
        failureReason: reason || 'بی‌برنامه بودم',
        failureTime: time || 'وسط روز',
        userNotes: notes,
        cycleTheme
      });

      if (currentLogIdRef.current === targetLogId) {
        if (localResult.analysis) {
          setAiFeedback(localResult.analysis);
        }
        if (localResult.countermeasure && !countermeasure) {
          setCountermeasure(localResult.countermeasure);
        }
        if (localResult.psychologicalTrap) {
          setNotes(prev => prev ? `${prev}\n\n[تله شناختی]: ${localResult.psychologicalTrap}` : `[تله شناختی]: ${localResult.psychologicalTrap}`);
        }
      }

      // Sync with server if online
      const token = localStorage.getItem('bushido_auth_token');
      fetch('/api/ai/autopsy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          date: log.date,
          missedHabits,
          failureReason: reason || 'بی‌برنامه بودم',
          failureTime: time || 'وسط روز',
          userNotes: notes,
          cycleTheme
        })
      }).catch(() => {});

      soundFX.playCheck();
    } catch (err) {
      console.error('Autopsy error:', err);
    } finally {
      if (currentLogIdRef.current === targetLogId) {
        setIsLoadingAi(false);
      }
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const updated: DailyLog = {
      ...log,
      failureReason: reason,
      failureTime: time,
      autopsyNotes: notes,
      countermeasure,
      aiFeedback
    };
    soundFX.playAutopsySave();
    haptics.debtResolved();
    onSave(updated);

    // If there are other unresolved debts in the batch, seamlessly advance to next unresolved debt
    if (onSelectLog && allUnresolvedLogs.length > 1) {
      const remainingDebts = allUnresolvedLogs.filter(l => l.date !== log.date);
      if (remainingDebts.length > 0) {
        // Pick next debt relative to current position, or wrap around
        const nextIdx = currentIndex >= 0 && currentIndex < allUnresolvedLogs.length - 1 ? currentIndex : 0;
        const nextTarget = remainingDebts[nextIdx] || remainingDebts[0];
        onSelectLog(nextTarget);
        return;
      }
    }

    onClose();
  };

  const isPersonalFrozen = reason === 'دلایل شخصی';

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] overscroll-contain overflow-y-auto max-h-[100dvh]"
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="my-auto max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] w-full max-w-2xl bg-[#1c1c21] border border-zinc-800 rounded-2xl sm:rounded-3xl text-zinc-100 shadow-2xl flex flex-col overflow-hidden"
        dir="rtl"
      >
        {/* Sticky Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#1c1c21]/95 border-b border-zinc-800 flex items-center justify-between shrink-0 sticky top-0 z-20 backdrop-blur-md">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${isPersonalFrozen ? 'bg-blue-500/20 text-blue-400' : 'bg-red-500/20 text-red-400'}`}>
              {isPersonalFrozen ? <Snowflake className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm sm:text-base md:text-lg text-zinc-100 flex items-center gap-1.5 truncate">
                کالبدشکافی {formatPersianDate(log.date, { withWeekday: true })}
              </h2>
              <p className="text-[11px] sm:text-xs text-zinc-400 truncate">
                ثبت علت و پادزهر رفتاری جهت تسویه بدهی و باز شدن قفل اجرا
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition cursor-pointer shrink-0 touch-manipulation"
            aria-label="بستن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Debt Day Switcher Carousel (If user has multiple unresolved debts) */}
        {hasMultipleDebts && (
          <div className="bg-red-950/40 border-b border-red-900/40 px-4 py-2 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5 text-red-300 font-bold">
              <ListOrdered className="w-4 h-4 text-red-400" />
              <span>بدهی {toPersianDigits(currentIndex + 1)} از {toPersianDigits(totalDebts)}:</span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-[60%]">
              {allUnresolvedLogs.map((item, idx) => {
                const isSelected = item.date === log.date;
                return (
                  <button
                    key={item.id || item.date}
                    type="button"
                    onClick={() => onSelectLog(item)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition whitespace-nowrap cursor-pointer ${
                      isSelected
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'bg-[#18181b] text-zinc-400 hover:text-zinc-200 border border-zinc-800'
                    }`}
                  >
                    {formatPersianDate(item.date, { short: true })}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Scrollable Form Body */}
        <form onSubmit={handleSave} className="flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-5 flex-1 overscroll-contain">
            {/* Missed Habits Summary */}
            {missedHabits.length > 0 && (
              <div className="bg-[#18181b] border border-red-500/20 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs text-zinc-400 font-medium shrink-0">پایه‌های اجرا نشده در این روز:</span>
                <div className="flex flex-wrap gap-1.5">
                  {missedHabits.map(h => (
                    <span key={h} className="text-xs bg-red-950/60 text-red-300 border border-red-800/40 px-2.5 py-0.5 rounded-md font-medium">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}

              {/* 1. Failure Reason Selection */}
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-zinc-200 mb-2">
                {toPersianDigits(1)}. دلیل اصلی عدم اجرای فونداسیون (دلیل شکست):
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FAILURE_REASONS.map(r => {
                  const selected = reason === r;
                  const isFrozenOpt = r === 'دلایل شخصی';
                  return (
                    <button
                      type="button"
                      key={r}
                      onClick={() => setReason(r)}
                      className={`min-h-[44px] p-3 rounded-xl text-right text-xs sm:text-sm font-medium border transition-all flex items-center justify-between gap-2 cursor-pointer active:scale-[0.98] ${
                        selected
                          ? (isFrozenOpt 
                              ? 'bg-blue-950/60 border-blue-500 text-blue-200 ring-1 ring-blue-500 shadow-sm' 
                              : 'bg-amber-950/50 border-amber-500 text-amber-200 ring-1 ring-amber-500 shadow-sm')
                          : 'bg-[#18181b] border-zinc-800 hover:bg-zinc-800/80 text-zinc-300'
                      }`}
                    >
                      <span className="leading-relaxed">{r}</span>
                      {selected && <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              {isPersonalFrozen && (
                <p className="mt-2 text-xs text-blue-300/90 bg-blue-950/40 p-2.5 rounded-lg border border-blue-800/40 flex items-center gap-2 leading-relaxed">
                  <Snowflake className="w-4 h-4 shrink-0 text-blue-400" />
                  <span>با انتخاب «دلایل شخصی»، روز به عنوان توقف اضطراری (فریز) ثبت شده و زنجیره بدون جریمه حفظ می‌شود.</span>
                </p>
              )}
            </div>

            {/* 2. Failure Time Selection */}
            {!isPersonalFrozen && (
              <div>
                <label className="block text-xs sm:text-sm font-semibold text-zinc-200 mb-2">
                  {toPersianDigits(2)}. زمان شروع اصطکاک و شکستن دیسیپلین:
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {FAILURE_TIMES.map(t => {
                    const selected = time === t;
                    return (
                      <button
                        type="button"
                        key={t}
                        onClick={() => setTime(t)}
                        className={`min-h-[44px] p-2.5 rounded-xl text-center text-xs sm:text-sm font-medium border transition-all cursor-pointer active:scale-[0.98] flex flex-col items-center justify-center ${
                          selected
                            ? 'bg-red-950/50 border-red-500 text-red-200 ring-1 ring-red-500'
                            : 'bg-[#18181b] border-zinc-800 hover:bg-zinc-800/80 text-zinc-300'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5 mx-auto mb-1 opacity-70 shrink-0" />
                        <span className="whitespace-nowrap leading-none">{t}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Autopsy Trigger */}
            <div className="bg-gradient-to-r from-amber-950/30 to-indigo-950/30 border border-amber-500/20 rounded-2xl p-3.5 sm:p-4 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-amber-400 shrink-0" />
                  <span className="font-semibold text-xs sm:text-sm text-zinc-200">تحلیل هوشمند سنسی بوشیدو</span>
                </div>
                <button
                  type="button"
                  onClick={handleAiAutopsy}
                  disabled={isLoadingAi || !reason}
                  className="min-h-[44px] w-full sm:w-auto bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-black font-bold text-xs px-3.5 py-2.5 rounded-xl flex items-center justify-center gap-1.5 transition-all shadow-lg shadow-amber-500/10 cursor-pointer active:scale-[0.98] whitespace-nowrap"
                >
                  {isLoadingAi ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                      <span className="whitespace-nowrap">در حال کالبدشکافی...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5 shrink-0" />
                      <span className="whitespace-nowrap">کالبدشکافی هوشمند سنسی (آنی و آفلاین)</span>
                    </>
                  )}
                </button>
              </div>
              {aiFeedback ? (
                <div className="mt-2 text-xs text-zinc-300 leading-relaxed bg-[#18181b] p-3 rounded-xl border border-zinc-800 break-words">
                  <p className="font-semibold text-amber-400 mb-1">تشخیص روانی سنسی:</p>
                  {aiFeedback}
                </div>
              ) : (
                <p className="text-[11px] sm:text-xs text-zinc-400 leading-relaxed">
                  برای کشف تله‌های رفتاری پنهان و تدوین خودکار قانون مقابله، دکمه بالا را بزنید.
                </p>
              )}
            </div>

            {/* 3. Notes / Psychological Root Cause */}
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-zinc-200 mb-1">
                {toPersianDigits(3)}. یادداشت ریشه‌یابی و اتفاقات روز:
              </label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="چه محرک‌ها یا توجیه‌های ذهنی باعث رها شدن کار شد؟"
                rows={2}
                className="w-full bg-[#18181b] border border-zinc-800 rounded-xl p-3 text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-rose-500 focus:ring-1 focus:ring-rose-500/30 leading-relaxed"
              />
            </div>

            {/* 4. Countermeasure / Rule for Tomorrow */}
            <div>
              <label className="block text-xs sm:text-sm font-semibold text-zinc-200 mb-1 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{toPersianDigits(4)}. قانون مقابله و استراتژی ضدضربه (Countermeasure):</span>
              </label>
              <input
                type="text"
                value={countermeasure}
                onChange={e => setCountermeasure(e.target.value)}
                placeholder="مثلا: بستن کامل نوتیفیکیشن‌ها تا ساعت ۱۲ ظهر"
                className="w-full min-h-[44px] bg-[#18181b] border border-zinc-800 rounded-xl px-3 py-2.5 text-xs sm:text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Sticky Modal Footer Actions */}
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 bg-[#1c1c21]/95 border-t border-zinc-800 flex items-center justify-end gap-2 sm:gap-3 shrink-0 sticky bottom-0 z-20 backdrop-blur-md">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2.5 rounded-xl text-zinc-400 hover:text-white hover:bg-zinc-800 text-xs sm:text-sm font-medium transition cursor-pointer whitespace-nowrap inline-flex items-center justify-center active:scale-[0.98]"
            >
              انصراف
            </button>
            <button
              type="submit"
              disabled={!reason || (!isPersonalFrozen && !time)}
              className="min-h-[44px] bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs sm:text-sm px-5 sm:px-6 py-2.5 rounded-xl flex items-center justify-center gap-2 transition shadow-lg shadow-emerald-600/20 cursor-pointer whitespace-nowrap active:scale-[0.98]"
            >
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span className="whitespace-nowrap">ثبت کالبدشکافی و تسویه بدهی</span>
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
