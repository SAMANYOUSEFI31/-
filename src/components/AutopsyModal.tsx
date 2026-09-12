import React, { useState, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { DailyLog, FailureReason, FailureTime } from '../types';
import { formatPersianDate } from '../utils/dateUtils';
import { FOUNDATION_HABITS } from '../engine/bushidoCalculations';
import { getDeterministicAutopsy } from '../engine/deterministicSensei';
import { toPersianDigits } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { useModalAccessibility } from '../utils/useModalAccessibility';
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
  ListOrdered,
  Check,
  ShieldCheck
} from 'lucide-react';

interface AutopsyModalProps {
  log: DailyLog;
  cycleTheme?: string;
  allUnresolvedLogs?: DailyLog[];
  onSelectLog?: (log: DailyLog) => void;
  onSave: (updatedLog: DailyLog) => void;
  onClose: () => void;
}

const FAILURE_REASONS: { key: FailureReason; label: string; desc: string }[] = [
  { key: 'وقتم رو به خوبی مدیریت نکردم', label: 'وقتم رو به خوبی مدیریت نکردم', desc: 'اتلاف وقت در شبکه‌های اجتماعی یا کارهای فرعی' },
  { key: 'بی‌برنامه بودم', label: 'بی‌برنامه بودم', desc: 'ندانستن اولویت‌ها و تسک بعدی' },
  { key: 'نیمه‌کاره رها کردم', label: 'نیمه‌کاره رها کردم', desc: 'خستگی یا کمال‌گرایی منفی در میانه کار' },
  { key: 'دلایل شخصی', label: 'دلایل شخصی', desc: 'رویداد اضطراری غیرقابل پیش‌بینی / فریز موجه' }
];

const FAILURE_TIMES: { key: FailureTime; label: string; desc: string }[] = [
  { key: 'اول روز', label: 'اول روز', desc: 'اینرسی و شروع دیرهنگام' },
  { key: 'وسط روز', label: 'وسط روز', desc: 'افت انرژی بعدازظهر' },
  { key: 'آخر روز', label: 'آخر روز', desc: 'به تعویق انداختن به شب' }
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

  const shouldReduceMotion = useReducedMotion();
  const { containerRef } = useModalAccessibility<HTMLDivElement>({
    isOpen: true,
    onClose,
    isBusy: isLoadingAi,
    focusKey: log.id
  });

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
      className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-safe overscroll-contain overflow-y-auto modal-overlay-resilient"
    >
      <motion.div 
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="autopsy-title"
        aria-describedby="autopsy-description"
        aria-busy={isLoadingAi}
        tabIndex={-1}
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 15 }}
        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: shouldReduceMotion ? 0.05 : 0.2, ease: 'easeOut' }}
        className="my-auto modal-dialog-resilient w-full max-w-2xl surface-z3 border-standard radius-modal text-role-primary shadow-subtle flex flex-col overflow-hidden focus:outline-none"
        dir="rtl"
      >
        {/* Sticky Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 surface-z3 border-b border-standard flex items-center justify-between shrink-0 sticky top-0 z-20 backdrop-blur-md">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className={`w-10 h-10 radius-component flex items-center justify-center shrink-0 ${isPersonalFrozen ? 'bg-blue-subtle text-blue border border-blue-subtle' : 'bg-debt-subtle text-debt border border-debt-subtle'}`}>
              {isPersonalFrozen ? <Snowflake className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h2 id="autopsy-title" className="font-bold text-sm sm:text-base md:text-lg text-role-primary flex items-center gap-1.5 truncate">
                کالبدشکافی ریشه‌ای شکست و افت روزانه — {formatPersianDate(log.date, { withWeekday: true })}
              </h2>
              <p id="autopsy-description" className="text-[11px] sm:text-xs text-role-secondary truncate">
                روزی که گذشت به حد نصاب ۵ پایه نرسید. با حقیقت عریان روبرو شوید و علت را ثبت کنید.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-contract-ghost w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center radius-component shrink-0 touch-manipulation focus-ring-tactical"
            aria-label="بستن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Debt Day Switcher Carousel (If user has multiple unresolved debts) */}
        {hasMultipleDebts && (
          <div className="bg-debt-subtle border-b border-debt-subtle px-4 py-2 flex items-center justify-between gap-2 text-xs" role="region" aria-label="انتخاب روزهای بدهی">
            <div className="flex items-center gap-1.5 text-debt font-bold">
              <ListOrdered className="w-4 h-4 text-debt" />
              <span>بدهی {toPersianDigits(currentIndex + 1)} از {toPersianDigits(totalDebts)}:</span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 max-w-[60%]">
              {allUnresolvedLogs.map((item) => {
                const isSelected = item.date === log.date;
                return (
                  <button
                    key={item.id || item.date}
                    type="button"
                    onClick={() => onSelectLog(item)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`min-h-[36px] px-3 py-1.5 radius-control text-[11px] font-bold transition-colors whitespace-nowrap cursor-pointer inline-flex items-center justify-center focus-ring-tactical ${
                      isSelected
                        ? 'bg-debt text-role-primary shadow-subtle'
                        : 'surface-z1 text-role-secondary hover:text-role-primary border-standard'
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
              <div className="surface-z2 border border-debt-subtle radius-component p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <span className="text-xs text-role-muted font-medium shrink-0">عادت‌های بر زمین مانده:</span>
                <div className="flex flex-wrap gap-1.5">
                  {missedHabits.map(h => (
                    <span key={h} className="text-xs bg-debt-subtle text-role-primary border border-debt-subtle px-2.5 py-0.5 radius-badge font-medium select-none pointer-events-none">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 1. Failure Reason Selection */}
            <div role="group" aria-labelledby="autopsy-reason-group-label">
              <span id="autopsy-reason-group-label" className="block text-xs sm:text-sm font-semibold text-role-primary mb-2">
                {toPersianDigits(1)}. علت اصلی عدم اجرای تعهد چه بود؟
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FAILURE_REASONS.map(r => {
                  const selected = reason === r.key;
                  const isFrozenOpt = r.key === 'دلایل شخصی';
                  return (
                    <button
                      type="button"
                      key={r.key}
                      onClick={() => setReason(r.key)}
                      aria-pressed={selected}
                      className={`min-h-[52px] p-3 radius-component text-right text-xs sm:text-sm font-medium border transition-colors flex items-start justify-between gap-2.5 cursor-pointer active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical ${
                        selected
                          ? (isFrozenOpt 
                              ? 'bg-blue-subtle border-blue text-blue shadow-subtle' 
                              : 'bg-debt-subtle border-debt text-debt shadow-subtle')
                          : 'surface-z2 border-standard hover:surface-z1 text-role-secondary hover:text-role-primary'
                      }`}
                    >
                      <div className="flex flex-col gap-0.5 text-right min-w-0 flex-1">
                        <span className={`font-semibold leading-tight ${selected ? (isFrozenOpt ? 'text-blue' : 'text-debt') : 'text-role-primary'}`}>{r.label}</span>
                        <span className="text-[11px] text-role-muted leading-tight">{r.desc}</span>
                      </div>
                      {selected ? (
                        <span className={`w-4 h-4 radius-capsule flex items-center justify-center shrink-0 mt-0.5 ${isFrozenOpt ? 'bg-blue text-white' : 'bg-debt text-white'}`}>
                          <Check className="w-2.5 h-2.5 stroke-[3]" />
                        </span>
                      ) : (
                        <span className="w-4 h-4 radius-capsule border border-standard surface-z3 shrink-0 mt-0.5" />
                      )}
                    </button>
                  );
                })}
              </div>
              {isPersonalFrozen && (
                <p className="mt-2 text-xs text-blue bg-blue-subtle p-2.5 radius-control border border-blue-subtle flex items-center gap-2 leading-relaxed select-none pointer-events-none">
                  <Snowflake className="w-4 h-4 shrink-0 text-blue" />
                  <span>با انتخاب «دلایل شخصی»، روز به عنوان توقف اضطراری (فریز) ثبت شده و زنجیره بدون جریمه حفظ می‌شود.</span>
                </p>
              )}
            </div>

            {/* 2. Failure Time Selection */}
            {!isPersonalFrozen && (
              <div role="group" aria-labelledby="autopsy-time-group-label">
                <span id="autopsy-time-group-label" className="block text-xs sm:text-sm font-semibold text-role-primary mb-2">
                  {toPersianDigits(2)}. این افت در چه بازه‌ای از روز کلید خورد؟
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {FAILURE_TIMES.map(t => {
                    const selected = time === t.key;
                    return (
                      <button
                        type="button"
                        key={t.key}
                        onClick={() => setTime(t.key)}
                        aria-pressed={selected}
                        className={`min-h-[56px] p-2.5 radius-component text-center text-xs font-medium border transition-colors cursor-pointer active:scale-[0.98] motion-reduce:transform-none flex flex-col items-center justify-center gap-1 focus-ring-tactical ${
                          selected
                            ? 'bg-debt-subtle border-debt text-debt shadow-subtle'
                            : 'surface-z2 border-standard hover:surface-z1 text-role-secondary hover:text-role-primary'
                        }`}
                      >
                        <Clock className="w-3.5 h-3.5 mx-auto opacity-70 shrink-0" />
                        <span className="whitespace-nowrap font-semibold leading-none">{t.label}</span>
                        <span className="text-[10px] text-role-muted leading-none hidden sm:inline">{t.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* AI Autopsy Trigger */}
            <div className="bg-amber-subtle border border-amber-subtle radius-card p-3.5 sm:p-4 space-y-2">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <Brain className="w-5 h-5 text-amber shrink-0" />
                  <span className="font-semibold text-xs sm:text-sm text-role-primary">تحلیل هوشمند سنسی بوشیدو</span>
                </div>
                <button
                  type="button"
                  onClick={handleAiAutopsy}
                  disabled={isLoadingAi || !reason}
                  aria-busy={isLoadingAi}
                  className="btn-contract-mastery min-h-[44px] w-full sm:w-auto font-bold text-xs px-3.5 py-2.5 radius-component flex items-center justify-center gap-1.5 shadow-subtle whitespace-nowrap focus-ring-tactical"
                >
                  {isLoadingAi ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin motion-reduce:animate-none shrink-0" />
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

              {/* Polite Live Status for AI */}
              <div role="status" aria-live="polite" className="sr-only">
                {isLoadingAi ? 'در حال کالبدشکافی هوشمند و تحلیل وضعیت روز...' : (aiFeedback ? 'تحلیل هوشمند سنسی ثبت شد.' : '')}
              </div>

              {aiFeedback ? (
                <div className="mt-2 text-xs text-role-secondary leading-relaxed surface-z2 p-3 radius-component border-standard break-words">
                  <p className="font-semibold text-amber mb-1">تشخیص روانی سنسی:</p>
                  {aiFeedback}
                </div>
              ) : (
                <p className="text-[11px] sm:text-xs text-role-muted leading-relaxed">
                  برای کشف تله‌های رفتاری پنهان و تدوین خودکار قانون مقابله، دکمه بالا را بزنید.
                </p>
              )}
            </div>

            {/* 3. Notes / Psychological Root Cause */}
            <div>
              <label htmlFor="autopsy-notes-input" className="block text-xs sm:text-sm font-semibold text-role-primary mb-1">
                {toPersianDigits(3)}. یادداشت و مشاهدات شما از ریشه این لغزش:
              </label>
              <textarea
                id="autopsy-notes-input"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="دقیقاً چه حسی یا چه محرکی باعث شد فرمان از دست خارج شود؟ بدون توجیه بنویسید..."
                rows={2}
                className="w-full surface-z2 border-standard radius-component p-3 text-xs sm:text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-[var(--color-input-border-focus)] focus-ring-neutral transition-colors leading-relaxed"
              />
            </div>

            {/* 4. Countermeasure / Rule for Tomorrow */}
            <div>
              <label htmlFor="autopsy-countermeasure-input" className="block text-xs sm:text-sm font-semibold text-role-primary mb-1 flex items-center gap-1.5">
                <Target className="w-4 h-4 text-emerald shrink-0" />
                <span>{toPersianDigits(4)}. اقدام مشخص و عملیاتی برای فردا صبح (Countermeasure):</span>
              </label>
              <input
                id="autopsy-countermeasure-input"
                type="text"
                value={countermeasure}
                onChange={e => setCountermeasure(e.target.value)}
                placeholder="برای اینکه این شکست فردا تکرار نشود، چه مانعی را امشب حذف می‌کنید؟"
                className="w-full min-h-[44px] surface-z2 border-standard radius-component px-3 py-2.5 text-xs sm:text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-[var(--color-input-border-focus)] focus-ring-neutral transition-colors"
              />
            </div>
          </div>

          {/* Sticky Modal Footer Actions */}
          <div className="px-4 sm:px-6 py-3.5 sm:py-4 surface-z3 border-t border-standard flex items-center justify-end gap-2 sm:gap-3 shrink-0 sticky bottom-0 z-20 backdrop-blur-md">
            <button
              type="button"
              onClick={onClose}
              className="btn-contract-ghost min-h-[44px] px-4 py-2.5 radius-component text-xs sm:text-sm font-medium whitespace-nowrap inline-flex items-center justify-center focus-ring-tactical"
            >
              انصراف
            </button>
            {isPersonalFrozen ? (
              <button
                type="submit"
                disabled={!reason}
                className="btn-contract-secondary min-h-[44px] text-blue font-bold text-xs sm:text-sm px-5 sm:px-6 py-2.5 radius-component flex items-center justify-center gap-2 shadow-subtle whitespace-nowrap focus-ring-tactical"
              >
                <Snowflake className="w-4 h-4 shrink-0 text-blue" />
                <span className="whitespace-nowrap">تأیید توقف اضطراری و حفظ زنجیره</span>
              </button>
            ) : (
              <button
                type="submit"
                disabled={!reason || !time}
                className="btn-contract-primary min-h-[44px] font-bold text-xs sm:text-sm px-5 sm:px-6 py-2.5 radius-component flex items-center justify-center gap-2 shadow-subtle whitespace-nowrap focus-ring-tactical"
              >
                <ShieldCheck className="w-4 h-4 shrink-0 text-white" />
                <span className="whitespace-nowrap">ممهور کردن کالبدشکافی و رفع قفل نبرد</span>
              </button>
            )}
          </div>
        </form>
      </motion.div>
    </div>
  );
};
