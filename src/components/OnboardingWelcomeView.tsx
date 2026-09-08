import React from 'react';
import { 
  Target, 
  Sparkles, 
  Flame, 
  BookOpen, 
  Swords, 
  CheckCircle2, 
  Scale, 
  ShieldCheck, 
  Clock, 
  Award,
  ChevronLeft,
  Calendar,
  Layers
} from 'lucide-react';
import { toPersianDigits } from '../utils/numberUtils';

interface OnboardingWelcomeViewProps {
  onOpenCreateCycle: () => void;
  onNavigateToHabitsGuide: () => void;
}

export const OnboardingWelcomeView: React.FC<OnboardingWelcomeViewProps> = ({
  onOpenCreateCycle,
  onNavigateToHabitsGuide
}) => {
  return (
    <div className="max-w-4xl mx-auto py-4 sm:py-8 px-2 sm:px-4 space-y-6 sm:space-y-8 animate-in fade-in duration-300" dir="rtl">
      {/* 1. Hero Header */}
      <div className="surface-z1 border border-amber-subtle radius-card sm:radius-modal p-6 sm:p-10 text-center space-y-4 shadow-subtle relative overflow-hidden">
        <div className="w-16 h-16 sm:w-20 sm:h-20 radius-card bg-amber-subtle border border-amber-subtle flex items-center justify-center text-amber mx-auto shadow-subtle">
          <Swords className="w-8 h-8 sm:w-10 sm:h-10 text-amber" />
        </div>

        <div className="space-y-2 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 radius-capsule bg-amber-subtle border border-amber-subtle text-amber text-xs font-bold font-mono">
            <Sparkles className="w-3.5 h-3.5 text-amber" />
            <span>سیستم عامل انضباط بوشیدو (Bushido OS)</span>
          </div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-role-primary tracking-tight">
            به کارزار فتح اراده و دیسیپلین خوش آمدید
          </h1>
          <p className="text-xs sm:text-sm text-role-secondary leading-relaxed max-w-xl mx-auto">
            سامانه‌ای طراحی‌شده بر اساس اصول بی‌رحمانه انضباط شخصی، ردیابی ۹۰ روزه ارکان فونداسیون، کالبدشکافی شکست‌ها و قضاوت در دادگاه بوشیدو.
          </p>
        </div>

        {/* Action CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
          <button
            type="button"
            onClick={onOpenCreateCycle}
            className="w-full sm:w-auto bg-amber hover:brightness-110 active:brightness-90 text-canvas-root font-black text-xs sm:text-sm px-6 py-3.5 radius-card inline-flex items-center justify-center gap-2 shadow-subtle transition cursor-pointer active:scale-95 focus-ring-tactical"
          >
            <Sparkles className="w-4 h-4 text-canvas-root" />
            <span>تعریف اولین چرخه ۹۰ روزه نبرد</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToHabitsGuide}
            className="w-full sm:w-auto surface-z2 hover:surface-z3 active:surface-z3 text-role-primary font-bold text-xs sm:text-sm px-5 py-3.5 radius-card inline-flex items-center justify-center gap-2 border-standard transition cursor-pointer active:scale-95 focus-ring-tactical"
          >
            <BookOpen className="w-4 h-4 text-role-muted" />
            <span>فلسفه و راهنمای ۵ عادت بوشیدو</span>
          </button>
        </div>
      </div>

      {/* 2. Three Pillars of the Bushido Journey */}
      <div className="space-y-3">
        <h2 className="text-sm sm:text-base font-black text-role-primary px-1 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-role-secondary" />
          <span>مسیر گام‌به‌گام پیروزی در سامانه بوشیدو</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4">
          {/* Step 1 */}
          <div className="surface-z1 border-standard radius-card p-5 space-y-3 flex flex-col justify-between shadow-subtle">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 radius-component bg-amber-subtle border border-amber-subtle text-amber font-black font-mono text-sm flex items-center justify-center">
                  {toPersianDigits(1)}
                </span>
                <span className="text-[11px] text-role-secondary font-bold surface-z2 px-2 py-0.5 radius-control border-standard">
                  دوره‌های ۹۰ روزه
                </span>
              </div>
              <h3 className="text-sm font-bold text-role-primary">
                پایه‌ریزی چرخه تمرکز
              </h3>
              <p className="text-xs text-role-secondary leading-relaxed">
                ذهن انسان در دوره‌های ۹۰ روزه بالاترین توان تغییر ساختاری را دارد. برای هر دوره یک میثاق و تم محوری مشخص می‌کنید.
              </p>
            </div>
            <div className="pt-2 border-t border-standard text-[11px] text-amber font-medium flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5 text-amber" />
              <span>تقویم شمسی با کات‌آف شبانه</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="surface-z1 border-standard radius-card p-5 space-y-3 flex flex-col justify-between shadow-subtle">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 radius-component bg-emerald-subtle border border-emerald-subtle text-emerald font-black font-mono text-sm flex items-center justify-center">
                  {toPersianDigits(2)}
                </span>
                <span className="text-[11px] text-role-secondary font-bold surface-z2 px-2 py-0.5 radius-control border-standard">
                  ۵ رکن فونداسیون
                </span>
              </div>
              <h3 className="text-sm font-bold text-role-primary">
                تعهد روزانه و ساخت استریک
              </h3>
              <p className="text-xs text-role-secondary leading-relaxed">
                سحرخیزی، تمرین فیزیکی، مطالعه، ژورنال و کار عمیق. ثبت کامل = روز استاندارد (۸ از ۱۰) و با ماموریت ویژه = کمال (۱۰ از ۱۰).
              </p>
            </div>
            <div className="pt-2 border-t border-standard text-[11px] text-emerald font-medium flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-rose" />
              <span>حفظ رگه استمرار (Pure Streak)</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="surface-z1 border-standard radius-card p-5 space-y-3 flex flex-col justify-between shadow-subtle">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 radius-component bg-purple-subtle border border-purple-subtle text-purple font-black font-mono text-sm flex items-center justify-center">
                  {toPersianDigits(3)}
                </span>
                <span className="text-[11px] text-role-secondary font-bold surface-z2 px-2 py-0.5 radius-control border-standard">
                  حسابرسی بی‌رحمانه
                </span>
              </div>
              <h3 className="text-sm font-bold text-role-primary">
                کالبدشکافی و دادگاه نهایی
              </h3>
              <p className="text-xs text-role-secondary leading-relaxed">
                شکست بدون کالبدشکافی قفل سیستم است. دلایل شکست را ثبت کنید و در پایان ۹۰ روز حکم قطعی عملکرد و رتبه رزمی دریافت نمایید.
              </p>
            </div>
            <div className="pt-2 border-t border-standard text-[11px] text-purple font-medium flex items-center gap-1">
              <Scale className="w-3.5 h-3.5 text-purple" />
              <span>تسویه بدهی‌ها و دریافت حکم</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
