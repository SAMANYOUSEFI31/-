import React, { useState } from 'react';
import { 
  X, 
  BookMarked, 
  ShieldCheck, 
  Sun, 
  Dumbbell, 
  BookOpen, 
  PenTool, 
  Briefcase, 
  CheckCircle2, 
  Award, 
  AlertOctagon, 
  Snowflake,
  ChevronDown,
  ChevronUp,
  Target,
  Flame
} from 'lucide-react';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { useModalAccessibility } from '../utils/useModalAccessibility';
import { BUSHIDO_HABITS_PHILOSOPHY } from '../data/moreTabData';
import { HabitKey } from '../types';
import { toPersianDigits } from '../utils/numberUtils';

interface DisciplineRulesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const HABIT_ICONS_MAP: Record<HabitKey, React.ComponentType<{ className?: string }>> = {
  wakeUp: Sun,
  workout: Dumbbell,
  study: BookOpen,
  journal: PenTool,
  hardTask: Briefcase
};

export const DisciplineRulesModal: React.FC<DisciplineRulesModalProps> = ({
  isOpen,
  onClose
}) => {
  useBodyScrollLock(isOpen);

  const { containerRef } = useModalAccessibility<HTMLDivElement>({
    isOpen,
    onClose
  });

  const [expandedKey, setExpandedKey] = useState<HabitKey | null>('wakeUp');

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-4 pt-safe pb-safe overscroll-contain overflow-y-auto"
      dir="rtl"
    >
      <div 
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discipline-rules-title"
        aria-describedby="discipline-rules-description"
        tabIndex={-1}
        className="my-auto max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] w-full max-w-2xl surface-z3 border-standard radius-modal text-role-primary shadow-subtle flex flex-col overflow-hidden focus:outline-none animate-in zoom-in-95 duration-150"
      >
        {/* Sticky Modal Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 surface-z3 border-b border-standard flex items-center justify-between shrink-0 sticky top-0 z-20 backdrop-blur-md">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="w-10 h-10 radius-component surface-z2 border-standard flex items-center justify-center text-role-secondary shrink-0">
              <BookMarked className="w-5 h-5 text-role-secondary" />
            </div>
            <div className="min-w-0">
              <h2 id="discipline-rules-title" className="font-bold text-sm sm:text-base md:text-lg text-role-primary flex items-center gap-1.5 truncate">
                آیین‌نامه و ۵ قانون دیسیپلین بوشیدو
              </h2>
              <p id="discipline-rules-description" className="text-[11px] sm:text-xs text-role-secondary truncate">
                استانداردهای غیرقابل مذاکره برای تسلط بر اراده و حفظ زنجیره استمرار
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-role-secondary hover:text-role-primary radius-component hover:surface-z1 transition-colors cursor-pointer shrink-0 touch-manipulation focus-ring-tactical"
            aria-label="بستن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Modal Content */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-5 flex-1 overscroll-contain">
          {/* Core Philosophy Banner */}
          <div className="surface-z2 border-standard radius-card p-4 space-y-2">
            <div className="flex items-center gap-2 text-role-primary font-bold text-xs sm:text-sm">
              <ShieldCheck className="w-4 h-4 text-emerald shrink-0" />
              <span>قانون اساسی: ۵ پایه روزانه برای روز استاندارد ({toPersianDigits(8)} از {toPersianDigits(10)})</span>
            </div>
            <p className="text-xs text-role-secondary leading-relaxed">
              سامانه دیسیپلین بوشیدو بر مبنای توهم انگیزه کار نمی‌کند؛ بلکه بر ساختار اراده و عادات تکرارشونده استوار است. برای حفظ زنجیره استمرار، باید در هر روز نبرد حداقل ۵ تیک پایه ثبت شوند تا به امتیاز استاندارد ۸۰٪ برسید.
            </p>
          </div>

          {/* 5 Pillars Accordion */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold text-role-primary">
                شرح و استانداردهای ۵ پایه انضباطی:
              </span>
              <span className="text-[11px] text-role-muted">
                (روی هر ستون ضربه بزنید)
              </span>
            </div>

            {BUSHIDO_HABITS_PHILOSOPHY.map((item, index) => {
              const IconComp = HABIT_ICONS_MAP[item.key] || Target;
              const isExpanded = expandedKey === item.key;

              return (
                <div 
                  key={item.key}
                  className="surface-z2 border-standard radius-card overflow-hidden transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setExpandedKey(isExpanded ? null : item.key)}
                    className="w-full p-3.5 sm:p-4 flex items-center justify-between gap-3 text-right hover:surface-z1 transition-colors cursor-pointer min-h-[52px] focus-ring-tactical"
                    aria-expanded={isExpanded}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 radius-component surface-z3 border-standard flex items-center justify-center shrink-0 text-role-secondary">
                        <IconComp className="w-4 h-4 text-role-secondary" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] font-mono text-role-muted">#{toPersianDigits(index + 1)}</span>
                          <h3 className="text-xs sm:text-sm font-bold text-role-primary truncate">
                            {item.titleFa}
                          </h3>
                        </div>
                        <p className="text-[11px] text-role-secondary truncate mt-0.5">
                          {item.subtitleFa}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 text-role-muted">
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3.5 sm:px-4 pb-4 pt-1 space-y-3 text-xs border-t border-standard animate-in fade-in motion-reduce:animate-none">
                      {/* Standard */}
                      <div className="surface-z3 p-3 radius-component space-y-1">
                        <span className="font-bold text-emerald text-[11px] block">معیار استاندارد اجرا:</span>
                        <p className="text-role-secondary leading-relaxed">{item.dailyStandard}</p>
                      </div>

                      {/* Why it matters */}
                      <div className="surface-z3 p-3 radius-component space-y-1">
                        <span className="font-bold text-amber text-[11px] block">چرا حیاتی است؟</span>
                        <p className="text-role-secondary leading-relaxed">{item.whyItMatters}</p>
                      </div>

                      {/* Traps and Tactical advice */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                        <div className="surface-z3 p-3 radius-component space-y-1">
                          <span className="font-bold text-rose text-[11px] block">دام‌های رایج:</span>
                          <p className="text-role-secondary leading-relaxed">{item.commonPitfalls}</p>
                        </div>
                        <div className="surface-z3 p-3 radius-component space-y-1">
                          <span className="font-bold text-blue text-[11px] block">قانون تاکتیکی پیروزی:</span>
                          <p className="text-role-secondary leading-relaxed">{item.tacticalAdvice}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* 4 System Discipline Laws */}
          <div className="space-y-2.5 pt-1">
            <span className="text-xs font-bold text-role-primary px-1 block">
              قوانین چهارگانه حاکم بر ثبت، امتیاز و زنجیره:
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {/* Rule 1 */}
              <div className="surface-z2 border-standard radius-card p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald shrink-0" />
                  <span className="text-xs font-bold text-role-primary">قانون روز استاندارد ({toPersianDigits(8)} از {toPersianDigits(10)})</span>
                </div>
                <p className="text-[11px] text-role-secondary leading-relaxed">
                  تکمیل تمام ۵ پایه روزانه معادل ۸ امتیاز است. هر روزی که به این حد نصاب برسد، یک روز موفق محسوب شده و زنجیره پیشروی می‌کند.
                </p>
              </div>

              {/* Rule 2 */}
              <div className="surface-z2 border-standard radius-card p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-amber shrink-0" />
                  <span className="text-xs font-bold text-role-primary">قانون کمال و تسلط ({toPersianDigits(10)} از {toPersianDigits(10)})</span>
                </div>
                <p className="text-[11px] text-role-secondary leading-relaxed">
                  رسیدن به امتیاز کامل نیازمند عملکردی فراتر از روتین است؛ دستیابی به این نشان، برترین رکورد افتخار در تالار سوابق است.
                </p>
              </div>

              {/* Rule 3 */}
              <div className="surface-z2 border-standard radius-card p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <AlertOctagon className="w-4 h-4 text-debt shrink-0" />
                  <span className="text-xs font-bold text-role-primary">قانون کالبدشکافی بدهی (Debt)</span>
                </div>
                <p className="text-[11px] text-role-secondary leading-relaxed">
                  هر روزی که به حد نصاب نرسد، بدهی انضباطی ایجاد می‌کند. تا زمان کالبدشکافی و ثبت پادزهر، سیستم در وضعیت قفل نسبی باقی می‌ماند.
                </p>
              </div>

              {/* Rule 4 */}
              <div className="surface-z2 border-standard radius-card p-3.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Snowflake className="w-4 h-4 text-blue shrink-0" />
                  <span className="text-xs font-bold text-role-primary">قانون توقف موجه (فریز اضطراری)</span>
                </div>
                <p className="text-[11px] text-role-secondary leading-relaxed">
                  در صورت بیماری شدید یا فورس‌ماژور، ثبت «دلایل شخصی» مانع از سوختن زنجیره می‌شود؛ اما امتیازی به روز اختصاص نمی‌یابد.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Sticky Modal Footer */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 surface-z3 border-t border-standard flex items-center justify-end shrink-0 sticky bottom-0 z-20 backdrop-blur-md">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] bg-role-primary text-[var(--color-canvas-root)] font-bold text-xs sm:text-sm px-6 py-2.5 radius-component flex items-center justify-center gap-2 transition-colors shadow-subtle cursor-pointer whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
          >
            <ShieldCheck className="w-4 h-4 shrink-0" />
            <span>متوجه شدم و پایبندم</span>
          </button>
        </div>
      </div>
    </div>
  );
};
