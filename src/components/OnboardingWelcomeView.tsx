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
      <div className="bg-gradient-to-b from-[#16161a] to-[#121215] border border-amber-500/30 rounded-3xl p-6 sm:p-10 text-center space-y-4 shadow-2xl relative overflow-hidden">
        <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-amber-500/10 border border-amber-500/40 flex items-center justify-center text-amber-400 mx-auto shadow-xl shadow-amber-500/10">
          <Swords className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>

        <div className="space-y-2 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-bold font-mono">
            <Sparkles className="w-3.5 h-3.5" />
            <span>سیستم عامل انضباط بوشیدو (Bushido OS)</span>
          </div>
          <h1 className="text-xl sm:text-2xl md:text-3xl font-black text-zinc-100 tracking-tight">
            به کارزار فتح اراده و دیسیپلین خوش آمدید
          </h1>
          <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed max-w-xl mx-auto">
            سامانه‌ای طراحی‌شده بر اساس اصول بی‌رحمانه انضباط شخصی، ردیابی ۹۰ روزه ارکان فونداسیون، کالبدشکافی شکست‌ها و قضاوت در دادگاه بوشیدو.
          </p>
        </div>

        {/* Action CTAs */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-3">
          <button
            type="button"
            onClick={onOpenCreateCycle}
            className="w-full sm:w-auto bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-black text-xs sm:text-sm px-6 py-3.5 rounded-2xl inline-flex items-center justify-center gap-2 shadow-xl shadow-amber-500/25 transition cursor-pointer active:scale-95"
          >
            <Sparkles className="w-4 h-4 text-black" />
            <span>تعریف اولین چرخه ۹۰ روزه نبرد</span>
          </button>

          <button
            type="button"
            onClick={onNavigateToHabitsGuide}
            className="w-full sm:w-auto bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-200 font-bold text-xs sm:text-sm px-5 py-3.5 rounded-2xl inline-flex items-center justify-center gap-2 border border-zinc-700 transition cursor-pointer active:scale-95"
          >
            <BookOpen className="w-4 h-4 text-zinc-400" />
            <span>فلسفه و راهنمای ۵ عادت بوشیدو</span>
          </button>
        </div>
      </div>

      {/* 2. Three Pillars of the Bushido Journey */}
      <div className="space-y-3">
        <h2 className="text-sm sm:text-base font-black text-zinc-200 px-1 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>مسیر گام‌به‌گام پیروزی در سامانه بوشیدو</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 sm:gap-4">
          {/* Step 1 */}
          <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between shadow-lg">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-400 font-black font-mono text-sm flex items-center justify-center">
                  {toPersianDigits(1)}
                </span>
                <span className="text-[11px] text-zinc-400 font-bold bg-[#18181b] px-2 py-0.5 rounded-lg border border-zinc-800">
                  دوره‌های ۹۰ روزه
                </span>
              </div>
              <h3 className="text-sm font-bold text-zinc-100">
                پایه‌ریزی چرخه تمرکز
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                ذهن انسان در دوره‌های ۹۰ روزه بالاترین توان تغییر ساختاری را دارد. برای هر دوره یک میثاق و تم محوری مشخص می‌کنید.
              </p>
            </div>
            <div className="pt-2 border-t border-zinc-800/80 text-[11px] text-amber-400/90 font-medium flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>تقویم شمسی با کات‌آف شبانه</span>
            </div>
          </div>

          {/* Step 2 */}
          <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between shadow-lg">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-black font-mono text-sm flex items-center justify-center">
                  {toPersianDigits(2)}
                </span>
                <span className="text-[11px] text-zinc-400 font-bold bg-[#18181b] px-2 py-0.5 rounded-lg border border-zinc-800">
                  ۵ رکن فونداسیون
                </span>
              </div>
              <h3 className="text-sm font-bold text-zinc-100">
                تعهد روزانه و ساخت استریک
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                سحرخیزی، تمرین فیزیکی، مطالعه، ژورنال و کار عمیق. ثبت کامل = روز استاندارد (۸ از ۱۰) و با ماموریت ویژه = کمال (۱۰ از ۱۰).
              </p>
            </div>
            <div className="pt-2 border-t border-zinc-800/80 text-[11px] text-emerald-400/90 font-medium flex items-center gap-1">
              <Flame className="w-3.5 h-3.5 text-rose-400" />
              <span>حفظ رگه استمرار (Pure Streak)</span>
            </div>
          </div>

          {/* Step 3 */}
          <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-5 space-y-3 flex flex-col justify-between shadow-lg">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-xl bg-purple-500/10 border border-purple-500/30 text-purple-400 font-black font-mono text-sm flex items-center justify-center">
                  {toPersianDigits(3)}
                </span>
                <span className="text-[11px] text-zinc-400 font-bold bg-[#18181b] px-2 py-0.5 rounded-lg border border-zinc-800">
                  حسابرسی بی‌رحمانه
                </span>
              </div>
              <h3 className="text-sm font-bold text-zinc-100">
                کالبدشکافی و دادگاه نهایی
              </h3>
              <p className="text-xs text-zinc-400 leading-relaxed">
                شکست بدون کالبدشکافی قفل سیستم است. دلایل شکست را ثبت کنید و در پایان ۹۰ روز حکم قطعی عملکرد و رتبه رزمی دریافت نمایید.
              </p>
            </div>
            <div className="pt-2 border-t border-zinc-800/80 text-[11px] text-purple-400/90 font-medium flex items-center gap-1">
              <Scale className="w-3.5 h-3.5" />
              <span>تسویه بدهی‌ها و دریافت حکم</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
