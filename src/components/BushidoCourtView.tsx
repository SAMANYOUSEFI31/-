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
        <div className="surface-z1 border-standard radius-modal p-8 text-center space-y-4 shadow-subtle">
          <div className="w-16 h-16 radius-card bg-amber-subtle border border-amber-subtle flex items-center justify-center mx-auto text-amber">
            <Gavel className="w-8 h-8" />
          </div>
          <h3 className="text-base sm:text-lg font-black text-role-primary">
            دیوان قضاوت در انتظار چرخه فعال
          </h3>
          <p className="text-xs text-role-secondary leading-relaxed">
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
      <div className="surface-z1 border-standard radius-modal p-6 sm:p-8 backdrop-blur-xl shadow-subtle">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-16 h-16 sm:w-20 sm:h-20 radius-modal surface-z2 border-standard text-role-primary flex items-center justify-center shadow-subtle shrink-0">
            <Gavel className="w-8 h-8 sm:w-10 sm:h-10 text-role-primary" />
          </div>

          <div className="text-center sm:text-right space-y-1 flex-1">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <span className="text-xs font-bold surface-z2 border-standard text-role-secondary px-3 py-0.5 radius-badge font-mono">
                قرارگاه عالی بوشیدو
              </span>
              {currentCycle.isArchived && (
                <span className="text-xs surface-z2 border-standard text-role-secondary px-2.5 py-0.5 radius-badge">
                  مهروموم و بایگانی شده
                </span>
              )}
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-role-primary">
              دیوان داوری و دادگاه پایان چرخه ۹۰ روزه
            </h2>
            <p className="text-xs sm:text-sm text-role-secondary leading-relaxed">
              ارزیابی پایانی وفاداری به عهدنامه، صدور حکم رسمی سنسی و صدور گواهینامه رزم انضباطی.
            </p>
          </div>

          <button
            onClick={handleGenerateVerdict}
            disabled={isGenerating || hasDebt}
            className="w-full sm:w-auto bg-amber hover:brightness-110 active:scale-[0.98] disabled:opacity-50 text-black font-black text-xs sm:text-sm px-6 py-3.5 radius-card flex items-center justify-center gap-2 transition-all shadow-subtle cursor-pointer shrink-0 focus-ring-tactical"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                در حال دادرسی...
              </>
            ) : (
              <>
                <Scroll className="w-4 h-4 text-black" />
                صدور حکم نهایی دیوان
              </>
            )}
          </button>
        </div>

        {hasDebt && (
          <div className="mt-4 bg-debt-subtle border border-debt-subtle radius-card p-3.5 flex items-center gap-3 text-debt text-xs">
            <AlertTriangle className="w-5 h-5 text-debt shrink-0" />
            <span>
              طبق قوانین بوشیدو، دیوان تا زمان تسویه تمامی {toPersianDigits(metrics.unresolvedDebtCount)} بدهی کالبدشکافی معوقه، حکم صادر نخواهد کرد.
            </span>
          </div>
        )}
      </div>

      {/* Official Sealed Certificate / Verdict Card */}
      {verdictData ? (
        <div className="surface-z1 border-2 border-amber/40 radius-modal p-6 sm:p-8 space-y-6 shadow-subtle relative overflow-hidden">
          <div className="absolute top-0 right-0 left-0 h-1.5 bg-amber" />
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-standard pb-4">
            <div className="space-y-1">
              <span className="text-xs text-role-muted font-mono">حکم رسمی صادره برای:</span>
              <h3 className="text-xl font-bold text-role-primary">{currentCycle.title}</h3>
            </div>

            <div className="flex items-center gap-3 justify-center sm:justify-end">
              <div className="text-center px-5 py-2.5 surface-z0 radius-card border border-amber/30 min-w-[110px] shadow-subtle">
                <span className="text-[10px] text-role-muted block font-medium">رتبه نهایی</span>
                <span className="text-3xl font-black font-mono text-amber leading-tight">
                  {verdictData.grade}
                </span>
              </div>
            </div>
          </div>

          {/* Verdict Text */}
          <div className="surface-z2 radius-card p-5 border-standard space-y-2">
            <h4 className="font-bold text-sm text-amber flex items-center gap-1.5">
              <FileBadge className="w-4 h-4" />
              بیانیه رسمی دادگاه بوشیدو:
            </h4>
            <p className="text-xs sm:text-sm text-role-primary leading-relaxed font-medium">
              {verdictData.verdict}
            </p>
          </div>

          {/* Strengths & Weaknesses */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-emerald-subtle border border-emerald-subtle radius-card p-4 space-y-2">
              <span className="text-xs font-bold text-emerald flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4" />
                نقاط قوت تثبیت‌شده:
              </span>
              <ul className="space-y-1 text-xs text-role-secondary">
                {verdictData.strengths.map((s, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald"></span>
                    {s}
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-amber-subtle border border-amber-subtle radius-card p-4 space-y-2">
              <span className="text-xs font-bold text-amber flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" />
                آسیب‌پذیری‌های کشف‌شده:
              </span>
              <ul className="space-y-1 text-xs text-role-secondary">
                {verdictData.weaknesses.map((w, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber"></span>
                    {w}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Next Cycle Tactical Plan */}
          <div className="surface-z2 radius-card p-5 border border-autopsy-subtle space-y-1">
            <h4 className="font-bold text-xs text-autopsy flex items-center gap-1.5">
              <Flame className="w-4 h-4" />
              فرمان عملیاتی برای چرخه ۹۰ روزه بعدی:
            </h4>
            <p className="text-xs sm:text-sm text-role-secondary leading-relaxed">
              {verdictData.tacticalPlanForNextCycle}
            </p>
          </div>

          {/* Archive Seal Action */}
          {!currentCycle.isArchived && (
            <div className="pt-2 flex justify-end">
              <button
                onClick={handleSealAndArchive}
                className="bg-emerald hover:brightness-110 text-black font-bold text-xs sm:text-sm px-6 py-2.5 radius-card flex items-center gap-2 transition cursor-pointer shadow-subtle focus-ring-tactical"
              >
                <CheckCircle2 className="w-4 h-4 text-black" />
                تایید گزارش، ممهور کردن و بایگانی چرخه
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="surface-z1 border-standard radius-modal p-12 text-center space-y-3">
          <Award className="w-12 h-12 text-role-muted mx-auto" />
          <h3 className="font-bold text-base text-role-primary">
            دیوان آماده دریافت و ارزیابی گزارش ۹۰ روزه است
          </h3>
          <p className="text-xs text-role-secondary max-w-md mx-auto">
            با کلیک بر روی دکمه «صدور حکم نهایی دیوان»، سنسی بوشیدو تمام داده‌های ثبت شده در طول دوره را تحلیل و حکم رسمی صادر می‌کند.
          </p>
        </div>
      )}
    </div>
  );
};
