import React, { useState } from 'react';
import { Cycle, CycleMetrics, DailyLog, CycleVerdict } from '../types';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { toPersianDigits } from '../utils/numberUtils';
import { getDeterministicCourtVerdict } from '../engine/deterministicSensei';
import { 
  Gavel, 
  Award, 
  ShieldCheck, 
  Sparkles, 
  Loader2, 
  CheckCircle2, 
  AlertTriangle, 
  FileBadge, 
  Flame, 
  Lock, 
  Scroll, 
  Calendar,
  Layers
} from 'lucide-react';

interface BushidoCourtViewProps {
  currentCycle?: Cycle | null;
  metrics?: CycleMetrics | null;
  logs: DailyLog[];
  onUpdateCycle?: (updated: Cycle) => void;
}

export const BushidoCourtView: React.FC<BushidoCourtViewProps> = ({
  currentCycle,
  metrics,
  logs,
  onUpdateCycle
}) => {
  const [verdictData, setVerdictData] = useState<CycleVerdict | null>(currentCycle?.verdict || null);
  const [isGenerating, setIsGenerating] = useState(false);

  if (!currentCycle || !metrics) {
    return (
      <div className="space-y-6 max-w-lg mx-auto py-12 px-4 animate-in fade-in duration-200" dir="rtl">
        <div className="bg-[#121215] border border-zinc-800 rounded-3xl p-8 text-center space-y-4 shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400">
            <Gavel className="w-8 h-8" />
          </div>
          <h3 className="text-base sm:text-lg font-black text-zinc-100">
            دیوان قضاوت در انتظار چرخه فعال
          </h3>
          <p className="text-xs text-zinc-400 leading-relaxed">
            جهت بررسی کارنامه ۹۰ روزه، صدور حکم نهایی و پلمپ رسمی چرخه، ابتدا یک چرخه نبرد فعال کنید.
          </p>
        </div>
      </div>
    );
  }

  const handleGenerateVerdict = async () => {
    if (!onUpdateCycle) return;
    setIsGenerating(true);
    try {
      // Deterministic court calculation
      const courtResult = getDeterministicCourtVerdict({
        cycleTitle: currentCycle.title,
        standardDays: metrics.standardDaysCount,
        totalDays: metrics.logsCount || 90,
        maxStreak: metrics.maxPureStreak,
        disciplinePercentage: metrics.disciplinePercentage,
        vulnerableHabits: metrics.vulnerableHabits
      });

      const newVerdict: CycleVerdict = {
        verdict: courtResult.verdict,
        grade: courtResult.grade,
        senseiNotes: courtResult.senseiNotes,
        strengths: courtResult.strengths,
        weaknesses: courtResult.weaknesses,
        bushidoSealDate: new Date().toISOString(),
        tacticalPlanForNextCycle: courtResult.tacticalPlanForNextCycle
      };

      setVerdictData(newVerdict);
      onUpdateCycle({
        ...currentCycle,
        verdict: newVerdict
      });

      // Background sync if online
      const token = localStorage.getItem('bushido_auth_token');
      fetch('/api/ai/verdict', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          cycleTitle: currentCycle.title,
          standardDays: metrics.standardDaysCount,
          totalDays: metrics.logsCount || 90,
          maxStreak: metrics.maxPureStreak,
          disciplinePercentage: metrics.disciplinePercentage,
          vulnerableHabits: metrics.vulnerableHabits
        })
      }).catch(() => {});

      soundFX.playStandardDay();
      haptics.masterySuccess();
    } catch (err) {
      console.error('Error generating verdict:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSealAndArchive = () => {
    const updated: Cycle = {
      ...currentCycle,
      isArchived: true,
      reportRead: true
    };
    onUpdateCycle(updated);
    soundFX.playStandardDay();
  };

  const hasDebt = metrics.unresolvedDebtCount > 0;

  return (
    <div className="space-y-8 max-w-4xl mx-auto" dir="rtl">
      {/* Court Header */}
      <div className="bg-[#121215]/90 border border-zinc-800 rounded-3xl p-6 sm:p-8 backdrop-blur-xl shadow-xl">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-zinc-800 border border-zinc-700 text-zinc-200 flex items-center justify-center shadow-lg shrink-0">
            <Gavel className="w-8 h-8 sm:w-10 sm:h-10 text-zinc-200" />
          </div>

          <div className="text-center sm:text-right space-y-1 flex-1">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <span className="text-xs font-bold bg-zinc-800 border border-zinc-700 text-zinc-300 px-3 py-0.5 rounded-full font-mono">
                قرارگاه عالی بوشیدو
              </span>
              {currentCycle.isArchived && (
                <span className="text-xs bg-zinc-800 border border-zinc-700 text-zinc-300 px-2.5 py-0.5 rounded-full">
                  مهروموم و بایگانی شده
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-zinc-100">
              دیوان داوری و دادگاه پایان چرخه ۹۰ روزه
            </h2>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              ارزیابی پایانی وفاداری به عهدنامه، صدور حکم رسمی سنسی و صدور گواهینامه رزم انضباطی.
            </p>
          </div>

          <button
            onClick={handleGenerateVerdict}
            disabled={isGenerating || hasDebt}
            className="w-full sm:w-auto bg-zinc-100 hover:bg-white active:bg-zinc-200 disabled:opacity-50 text-zinc-950 font-black text-xs sm:text-sm px-6 py-3.5 rounded-2xl flex items-center justify-center gap-2 transition-all shadow-lg cursor-pointer shrink-0 active:scale-[0.98]"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                در حال دادرسی...
              </>
            ) : (
              <>
                <Scroll className="w-4 h-4 text-zinc-900" />
                صدور حکم نهایی دیوان
              </>
            )}
          </button>
        </div>

        {hasDebt && (
          <div className="mt-4 bg-red-950/60 border border-red-500/40 rounded-2xl p-3.5 flex items-center gap-3 text-red-200 text-xs">
            <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
            <span>
              طبق قوانین بوشیدو، دیوان تا زمان تسویه تمامی {toPersianDigits(metrics.unresolvedDebtCount)} بدهی کالبدشکافی معوقه، حکم صادر نخواهد کرد.
            </span>
          </div>
        )}
      </div>

      {/* Official Sealed Certificate / Verdict Card */}
      {verdictData ? (
        <div className="bg-zinc-900 border-2 border-amber-500/40 rounded-3xl p-6 sm:p-8 space-y-6 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 left-0 h-1.5 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-800 pb-4">
            <div className="space-y-1">
              <span className="text-xs text-zinc-400 font-mono">حکم رسمی صادره برای:</span>
              <h3 className="text-xl font-bold text-zinc-100">{currentCycle.title}</h3>
            </div>

            <div className="flex items-center gap-3 justify-center sm:justify-end">
              <div className="text-center px-5 py-2.5 bg-zinc-950 rounded-2xl border border-amber-500/30 min-w-[110px] shadow-inner">
                <span className="text-[10px] text-zinc-400 block font-medium">رتبه نهایی</span>
                <span className="text-3xl font-black font-mono text-amber-400 leading-tight">
                  {verdictData.grade}
                </span>
              </div>
            </div>
          </div>

          {/* Verdict Text */}
          <div className="bg-[#18181b] rounded-2xl p-5 border border-zinc-800 space-y-2">
            <h4 className="font-bold text-sm text-amber-400 flex items-center gap-1.5">
              <FileBadge className="w-4 h-4" />
              بیانیه رسمی دادگاه بوشیدو:
            </h4>
            <p className="text-xs sm:text-sm text-zinc-200 leading-relaxed font-medium">
              {verdictData.verdict}
            </p>
          </div>

          {/* Strengths & Weaknesses */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-4 space-y-2">
              <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                نقاط قوت تثبیت‌شده:
              </span>
              <ul className="space-y-1 text-xs text-zinc-300">
                {verdictData.strengths.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-amber-950/20 border border-amber-500/30 rounded-2xl p-4 space-y-2">
              <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                آسیب‌پذیری‌های کشف‌شده:
              </span>
              <ul className="space-y-1 text-xs text-zinc-300">
                {verdictData.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Next Cycle Tactical Plan */}
          <div className="bg-[#18181b] rounded-2xl p-5 border border-indigo-500/30 space-y-1">
            <h4 className="font-bold text-xs text-indigo-400 flex items-center gap-1.5">
              <Flame className="w-4 h-4" />
              فرمان عملیاتی برای چرخه ۹۰ روزه بعدی:
            </h4>
            <p className="text-xs sm:text-sm text-zinc-300 leading-relaxed">
              {verdictData.tacticalPlanForNextCycle}
            </p>
          </div>

          {/* Archive Seal Action */}
          {!currentCycle.isArchived && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={handleSealAndArchive}
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm px-6 py-2.5 rounded-2xl flex items-center gap-2 transition cursor-pointer shadow-lg shadow-emerald-600/20"
              >
                <CheckCircle2 className="w-4 h-4" />
                تایید گزارش، ممهور کردن و بایگانی چرخه
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="bg-[#121215]/60 border border-zinc-800 rounded-3xl p-12 text-center space-y-3">
          <Award className="w-12 h-12 text-zinc-600 mx-auto" />
          <h3 className="font-bold text-base text-zinc-200">
            دیوان آماده دریافت و ارزیابی گزارش ۹۰ روزه است
          </h3>
          <p className="text-xs text-zinc-400 max-w-md mx-auto">
            با کلیک بر روی دکمه «صدور حکم نهایی دیوان»، سنسی بوشیدو تمام داده‌های ثبت شده در طول دوره را تحلیل و حکم رسمی صادر می‌کند.
          </p>
        </div>
      )}
    </div>
  );
};
