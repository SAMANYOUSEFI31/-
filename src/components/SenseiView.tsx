import React, { useState } from 'react';
import { Cycle, CycleMetrics, DailyLog } from '../types';
import { soundFX } from '../utils/audioEffects';
import { getDeterministicSenseiAdvice } from '../engine/deterministicSensei';
import { 
  Brain, 
  Sparkles, 
  Send, 
  Loader2, 
  ShieldCheck, 
  Zap, 
  Quote, 
  AlertTriangle, 
  Flame,
  CheckCircle2
} from 'lucide-react';

interface SenseiViewProps {
  currentCycle?: Cycle | null;
  metrics?: CycleMetrics | null;
  logs?: DailyLog[];
}

interface CoachResponse {
  coachVerdict: string;
  keyAdvice: string;
  strategicWarning?: string;
  bushidoQuote?: string;
}

export const SenseiView: React.FC<SenseiViewProps> = ({
  currentCycle,
  metrics
}) => {
  const [coachData, setCoachData] = useState<CoachResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [customAdvice, setCustomAdvice] = useState<string | null>(null);
  const [isQuerying, setIsQuerying] = useState(false);

  if (!currentCycle || !metrics) {
    return (
      <div className="space-y-6 max-w-lg mx-auto py-12 px-4 animate-in fade-in duration-200" dir="rtl">
        <div className="surface-z1 border-standard radius-modal p-8 text-center space-y-4 shadow-subtle">
          <div className="w-16 h-16 radius-card bg-amber-subtle border border-amber-subtle flex items-center justify-center mx-auto text-amber">
            <Brain className="w-8 h-8" />
          </div>
          <h3 className="text-base sm:text-lg font-black text-role-primary">
            سنسی در انتظار آغاز نبرد
          </h3>
          <p className="text-xs text-role-secondary leading-relaxed">
            جهت دریافت ارزیابی‌های تاکتیکی، تحلیل نقاط کور و توصیه‌های استراتژیک مربی بوشیدو، ابتدا یک چرخه نبرد فعال کنید.
          </p>
        </div>
      </div>
    );
  }

  const fetchCoachDebrief = async () => {
    setIsLoading(true);
    try {
      // Instant deterministic evaluation
      const localAdvice = getDeterministicSenseiAdvice({
        cycleTitle: currentCycle.title,
        elapsedDays: metrics.elapsedDays,
        remainingDays: metrics.remainingDays,
        disciplinePercentage: metrics.disciplinePercentage,
        disciplineLevel: metrics.disciplineLevel,
        pureStreak: metrics.pureStreak,
        vulnerableHabits: metrics.vulnerableHabits,
        dominantFailureReason: metrics.dominantFailureReason,
        dominantFailureTime: metrics.dominantFailureTime
      });

      setCoachData(localAdvice);
      soundFX.playCheck();

      // Optional background sync
      const token = localStorage.getItem('bushido_auth_token');
      fetch('/api/ai/coach', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          cycleTitle: currentCycle.title,
          elapsedDays: metrics.elapsedDays,
          remainingDays: metrics.remainingDays,
          disciplinePercentage: metrics.disciplinePercentage,
          disciplineLevel: metrics.disciplineLevel,
          pureStreak: metrics.pureStreak,
          vulnerableHabits: metrics.vulnerableHabits,
          dominantFailureReason: metrics.dominantFailureReason,
          dominantFailureTime: metrics.dominantFailureTime
        })
      }).catch(() => {});
    } catch (err) {
      console.error('Coach debrief error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleAskSensei = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userQuery.trim()) return;

    setIsQuerying(true);
    try {
      const localQueryAdvice = getDeterministicSenseiAdvice({
        cycleTitle: currentCycle.title,
        elapsedDays: metrics.elapsedDays,
        remainingDays: metrics.remainingDays,
        disciplinePercentage: metrics.disciplinePercentage,
        disciplineLevel: metrics.disciplineLevel,
        pureStreak: metrics.pureStreak,
        vulnerableHabits: metrics.vulnerableHabits,
        dominantFailureReason: metrics.dominantFailureReason,
        dominantFailureTime: metrics.dominantFailureTime,
        userQuery: userQuery
      });

      setCustomAdvice(localQueryAdvice.coachVerdict + '\n\n' + localQueryAdvice.keyAdvice);
      setUserQuery('');
      soundFX.playCheck();
    } catch (err) {
      console.error('Ask Sensei error:', err);
    } finally {
      setIsQuerying(false);
    }
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto" dir="rtl">
      {/* Sensei Hero Card */}
      <div className="surface-z1 border-standard radius-modal p-6 sm:p-8 backdrop-blur-xl shadow-subtle">
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className="w-16 h-16 sm:w-20 sm:h-20 radius-modal surface-z2 border-standard flex items-center justify-center text-role-primary shadow-subtle shrink-0">
            <Brain className="w-9 h-9 sm:w-10 sm:h-10 text-role-primary" />
          </div>

          <div className="text-center sm:text-right space-y-1 flex-1">
            <div className="flex items-center justify-center sm:justify-start gap-2">
              <span className="text-xs font-bold surface-z2 border-standard text-role-secondary px-3 py-0.5 radius-badge font-mono">
                موتور تحلیلی و رفتاری بوشیدو
              </span>
              <span className="text-xs text-role-muted font-mono">بدون وابستگی / ۱۰۰٪ آفلاین</span>
            </div>
            <h2 className="text-xl sm:text-2xl font-black text-role-primary">
              سنسی بوشیدو | مربی تاکتیکی و راهبردی دیسیپلین
            </h2>
            <p className="text-xs sm:text-sm text-role-secondary leading-relaxed">
              تحلیل زنده رفتار، ریشه‌یابی اصطکاک‌های ناخودآگاه، و صدور فرامین عملیاتی برای عبور موفق از دوره ۹۰ روزه.
            </p>
          </div>

          <button
            onClick={fetchCoachDebrief}
            disabled={isLoading}
            className="w-full sm:w-auto bg-amber hover:brightness-110 active:scale-[0.98] text-black font-black text-xs sm:text-sm px-6 py-3.5 radius-card flex items-center justify-center gap-2 transition-all shadow-subtle cursor-pointer shrink-0 disabled:opacity-50 focus-ring-tactical"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                در حال ارزیابی...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                دریافت ارزیابی زنده سنسی
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sensei Live Verdict Banner */}
      {coachData && (
        <div className="surface-z1 border-standard radius-modal p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-200 shadow-subtle">
          <div className="flex items-center gap-2 text-role-primary border-b border-standard pb-3">
            <Zap className="w-5 h-5 text-role-secondary" />
            <h3 className="font-bold text-base text-role-primary">
              بیانیه راهبردی سنسی برای وضعیت جاری:
            </h3>
          </div>

          <p className="text-sm sm:text-base text-role-primary leading-relaxed font-medium">
            {coachData.coachVerdict}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="surface-z2 border-standard radius-card p-4">
              <span className="text-xs font-bold text-emerald flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="w-4 h-4 text-emerald" />
                توصیه تاکتیکی ۲۴ ساعت آینده:
              </span>
              <p className="text-xs sm:text-sm text-role-secondary leading-relaxed">
                {coachData.keyAdvice}
              </p>
            </div>

            {coachData.strategicWarning && (
              <div className="surface-z2 border-standard radius-card p-4">
                <span className="text-xs font-bold text-amber flex items-center gap-1.5 mb-1">
                  <AlertTriangle className="w-4 h-4 text-amber" />
                  هشدار راهبردی داده‌ها:
                </span>
                <p className="text-xs sm:text-sm text-role-secondary leading-relaxed">
                  {coachData.strategicWarning}
                </p>
              </div>
            )}
          </div>

          {coachData.bushidoQuote && (
            <div className="surface-z2 border-r-4 border-standard radius-component p-4 flex items-start gap-3">
              <Quote className="w-5 h-5 text-role-muted shrink-0 mt-0.5" />
              <p className="text-xs sm:text-sm text-role-secondary italic font-serif leading-relaxed">
                «{coachData.bushidoQuote}»
              </p>
            </div>
          )}
        </div>
      )}

      {/* Ask Sensei Interactive Prompt Box */}
      <div className="surface-z1 border-standard radius-modal p-6 space-y-4 shadow-subtle">
        <h3 className="font-bold text-base text-role-primary flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-role-secondary" />
          طرح سوال و دریافت پادزهر رفتاری از سنسی:
        </h3>
        <p className="text-xs text-role-secondary">
          درباره هرگونه افت انگیزه، وسوسه شکستن روتین، یا سازماندهی کار سخت از سنسی مشورت بگیرید.
        </p>

        <form onSubmit={handleAskSensei} className="flex gap-2">
          <input
            type="text"
            value={userQuery}
            onChange={e => setUserQuery(e.target.value)}
            placeholder="مثلا: عصرها انرژیم افت می‌کنه و کار سخت رو پشت گوش می‌ندازم، چاره چیه؟"
            className="flex-1 surface-z0 border-standard radius-card px-4 py-3 text-xs sm:text-sm text-role-primary placeholder:text-role-muted focus:outline-hidden focus:border-amber"
          />
          <button
            type="submit"
            disabled={isQuerying || !userQuery.trim()}
            className="bg-amber hover:brightness-110 disabled:opacity-50 text-black font-bold text-xs px-5 py-3 radius-card flex items-center gap-2 transition cursor-pointer shrink-0 focus-ring-tactical"
          >
            {isQuerying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <span>ارسال</span>
                <Send className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        {customAdvice && (
          <div className="mt-4 surface-z2 border-standard radius-card p-5 text-role-primary text-xs sm:text-sm leading-relaxed whitespace-pre-line animate-in fade-in duration-200">
            <div className="font-bold text-role-primary mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald" />
              پاسخ سنسی بوشیدو:
            </div>
            {customAdvice}
          </div>
        )}
      </div>
    </div>
  );
};
