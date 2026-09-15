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
import { useBodyScrollLock } from '../shared/hooks/useBodyScrollLock';
import { useModalAccessibility } from '../shared/hooks/useModalAccessibility';
import { BUSHIDO_HABITS_PHILOSOPHY, BUSHIDO_SYSTEM_RULES, BUSHIDO_SPECIAL_MISSION_GUIDE } from '../data/moreTabData';
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

const RULE_ICONS_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  CheckCircle2,
  Award,
  AlertOctagon,
  Snowflake
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
      className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-md flex flex-col items-center justify-center p-3 sm:p-4 pt-safe overscroll-contain overflow-y-auto modal-overlay-resilient"
      dir="rtl"
    >
      <div 
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="discipline-rules-title"
        aria-describedby="discipline-rules-description"
        tabIndex={-1}
        className="my-auto modal-dialog-resilient w-full max-w-2xl surface-z3 border-standard radius-modal text-role-primary shadow-subtle flex flex-col overflow-hidden focus:outline-none animate-in zoom-in-95 duration-150"
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
            className="btn-contract-ghost w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center radius-component shrink-0 touch-manipulation focus-ring-tactical"
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

          {/* Special Mission Philosophy & 90-Day Goal */}
          <div className="surface-z2 border-standard radius-card p-4 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Target className="w-4 h-4 text-amber shrink-0" />
                <h3 className="text-xs sm:text-sm font-bold text-role-primary">
                  {BUSHIDO_SPECIAL_MISSION_GUIDE.title}
                </h3>
              </div>
              <span className="bg-amber-subtle border border-amber-subtle text-amber text-[10px] sm:text-[11px] font-bold px-2 py-0.5 radius-capsule whitespace-nowrap">
                +{toPersianDigits(2)} امتیاز تسلط
              </span>
            </div>
            <p className="text-xs text-role-secondary leading-relaxed">
              {BUSHIDO_SPECIAL_MISSION_GUIDE.howItWorks}
            </p>
            <div className="surface-z3 p-2.5 radius-component text-[11px] text-role-secondary leading-relaxed">
              <span className="font-bold text-role-primary block mb-0.5">معیار ثبت:</span>
              {BUSHIDO_SPECIAL_MISSION_GUIDE.criteria}
            </div>
          </div>

          {/* 4 System Discipline Laws */}
          <div className="space-y-2.5 pt-1">
            <span className="text-xs font-bold text-role-primary px-1 block">
              قوانین چهارگانه حاکم بر ثبت، امتیاز و زنجیره:
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {BUSHIDO_SYSTEM_RULES.map(rule => {
                const IconComp = RULE_ICONS_MAP[rule.iconName] || ShieldCheck;
                const colorClass = 
                  rule.colorToken === 'emerald' ? 'text-emerald bg-emerald-subtle border-emerald-subtle' :
                  rule.colorToken === 'amber' ? 'text-amber bg-amber-subtle border-amber-subtle' :
                  rule.colorToken === 'debt' ? 'text-debt bg-debt-subtle border-debt' :
                  'text-blue bg-blue-subtle border-blue';
                const iconColor = 
                  rule.colorToken === 'emerald' ? 'text-emerald' :
                  rule.colorToken === 'amber' ? 'text-amber' :
                  rule.colorToken === 'debt' ? 'text-debt' :
                  'text-blue';

                return (
                  <div key={rule.id} className="surface-z2 border-standard radius-card p-3.5 space-y-1.5 flex flex-col justify-between">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <IconComp className={`w-4 h-4 ${iconColor} shrink-0`} />
                          <span className="text-xs font-bold text-role-primary truncate">{rule.title}</span>
                        </div>
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 radius-capsule border whitespace-nowrap shrink-0 ${colorClass}`}>
                          {rule.badge}
                        </span>
                      </div>
                      <p className="text-[11px] text-role-secondary leading-relaxed">
                        {rule.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Sticky Modal Footer */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 surface-z3 border-t border-standard flex items-center justify-end shrink-0 sticky bottom-0 z-20 backdrop-blur-md">
          <button
            type="button"
            onClick={onClose}
            className="btn-contract-primary w-full sm:w-auto min-h-[44px] text-xs sm:text-sm px-6 py-2.5 radius-component flex items-center justify-center gap-2 whitespace-nowrap shadow-subtle focus-ring-tactical"
          >
            <ShieldCheck className="w-4 h-4 shrink-0 text-white" />
            <span>متوجه شدم و پایبندم</span>
          </button>
        </div>
      </div>
    </div>
  );
};
