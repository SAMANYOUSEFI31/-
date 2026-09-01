import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DailyLog, Cycle, CycleMetrics, CycleVerdict } from '../types';
import { computeDailyProperties } from '../engine/bushidoCalculations';
import { formatPersianDate, getLogicalTodayDate, addDaysToDate, daysBetween } from '../utils/dateUtils';
import { toPersianDigits, toEnglishDigits, normalizeSearchText } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { getDeterministicCourtVerdict } from '../engine/deterministicSensei';
import { 
  Archive, 
  Search, 
  Gavel, 
  Award, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Snowflake, 
  Calendar, 
  Plus, 
  Layers, 
  FileBadge, 
  ChevronLeft, 
  ChevronDown,
  ChevronUp,
  Scroll, 
  ShieldCheck, 
  Check, 
  Clock, 
  Trash2, 
  Lock, 
  Unlock, 
  PackageCheck,
  X
} from 'lucide-react';

interface ArchivesViewProps {
  cycles: Cycle[];
  currentCycle?: Cycle | null;
  logs: DailyLog[];
  metrics?: CycleMetrics | null;
  onSelectCycle?: (cycle: Cycle) => void;
  onUpdateCycle: (updated: Cycle) => void;
  onDeleteCycle?: (cycleId: string) => void;
  onSelectDate: (date: string) => void;
  onOpenAutopsy: (log: DailyLog) => void;
  onCreateNewCycle: (title: string, startDate: string, targetTheme: string) => void;
}

export const ArchivesView: React.FC<ArchivesViewProps> = ({
  cycles,
  currentCycle,
  logs,
  metrics,
  onUpdateCycle,
  onDeleteCycle,
  onSelectDate,
  onOpenAutopsy,
  onCreateNewCycle
}) => {
  const logicalToday = getLogicalTodayDate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [isGeneratingVerdict, setIsGeneratingVerdict] = useState(false);
  const [isCourtDetailsOpen, setIsCourtDetailsOpen] = useState(false);
  const [showAllLogs, setShowAllLogs] = useState(false);
  
  // Modals state
  const [showNewCycleModal, setShowNewCycleModal] = useState(false);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false);
  const [showArchiveConfirmModal, setShowArchiveConfirmModal] = useState(false);
  const [showUnarchiveConfirmModal, setShowUnarchiveConfirmModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newStartDate, setNewStartDate] = useState(logicalToday);
  const [newTheme, setNewTheme] = useState('');
  const [modalOverlapError, setModalOverlapError] = useState<string | null>(null);
  const [archiveNotice, setArchiveNotice] = useState<string | null>(null);

  const handleOpenNewCycleModal = () => {
    soundFX.playCheck();
    setNewTitle(`چرخه نبرد ۹۰ روزه (دوره ${toPersianDigits(cycles.length + 1)})`);
    setNewStartDate(logicalToday);
    setNewTheme('');
    setModalOverlapError(null);
    setShowNewCycleModal(true);
  };

  const handleCreateCycleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newStartDate) return;

    const proposedStart = newStartDate;
    const proposedEnd = addDaysToDate(proposedStart, 89);

    const overlappingCycle = cycles.find(c => {
      const cStart = c.startDate;
      const cEnd = c.endDate || addDaysToDate(c.startDate, 89);
      return proposedStart <= cEnd && proposedEnd >= cStart;
    });

    if (overlappingCycle) {
      soundFX.playWarning();
      setModalOverlapError(
        `تداخل تقویمی: بازه زمانی این چرخه (${formatPersianDate(proposedStart)} تا ${formatPersianDate(proposedEnd)}) با چرخه «${overlappingCycle.title}» (${formatPersianDate(overlappingCycle.startDate)} تا ${formatPersianDate(overlappingCycle.endDate || addDaysToDate(overlappingCycle.startDate, 89))}) تداخل دارد.`
      );
      return;
    }

    onCreateNewCycle(newTitle.trim(), proposedStart, newTheme.trim());
    setShowNewCycleModal(false);
    setModalOverlapError(null);
  };

  // Guard against No Active Cycle / Empty State
  if (!currentCycle || !metrics) {
    return (
      <div className="space-y-6 animate-in fade-in duration-200" dir="rtl">
        <div className="bg-[#121215] border border-zinc-800 rounded-3xl p-8 sm:p-12 text-center space-y-5 max-w-xl mx-auto shadow-2xl">
          <div className="w-16 h-16 rounded-3xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center mx-auto text-amber-400 shadow-inner">
            <Archive className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-zinc-100">
              هیچ چرخه نبردی در سیستم تعریف نشده است
            </h2>
            <p className="text-xs sm:text-sm text-zinc-400 leading-relaxed max-w-md mx-auto">
              جهت ورود به کارزار، ردیابی ۹۰ روزه ارکان دیسیپلین و صدور احکام دادگاه بوشیدو، نخستین چرخه نبرد خود را آغاز کنید.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenNewCycleModal}
            className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black font-black text-sm px-6 py-3 rounded-2xl inline-flex items-center justify-center gap-2 mx-auto shadow-lg shadow-amber-500/25 transition cursor-pointer active:scale-95 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>تعریف چرخه نبرد ۹۰ روزه</span>
          </button>
        </div>

        {/* New Cycle Modal when empty */}
        {showNewCycleModal && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-lg p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
              <h3 className="font-bold text-base sm:text-lg text-zinc-100 flex items-center gap-2">
                <Layers className="w-5 h-5 text-zinc-300" />
                <span>تعریف چرخه ۹۰ روزه جدید</span>
              </h3>

              {modalOverlapError && (
                <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-3 text-xs font-medium flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{modalOverlapError}</span>
                </div>
              )}

              <form onSubmit={handleCreateCycleSubmit} className="space-y-3.5">
                <div>
                  <label className="text-xs text-zinc-300 block mb-1">عنوان چرخه:</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-300 block mb-1">تاریخ شروع (YYYY-MM-DD):</label>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={e => setNewStartDate(e.target.value)}
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-zinc-600 transition"
                  />
                </div>

                <div>
                  <label className="text-xs text-zinc-300 block mb-1">میثاق و تم اصلی چرخه:</label>
                  <textarea
                    value={newTheme}
                    onChange={e => setNewTheme(e.target.value)}
                    rows={2}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setShowNewCycleModal(false)}
                    className="bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-600 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-[0.98]"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black px-5 py-2 rounded-xl text-xs font-black shadow-md shadow-amber-500/20 transition cursor-pointer active:scale-[0.98]"
                  >
                    آغاز چرخه نبرد
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    );
  }

  const verdict = currentCycle.verdict;

  // Bushido Archiving Check:
  const is90DaysFinished = logicalToday > currentCycle.endDate || metrics.elapsedDays >= 90;
  const hasUnresolvedDebts = metrics.unresolvedDebtCount > 0;
  const canArchive = is90DaysFinished && !hasUnresolvedDebts && !!verdict && !currentCycle.isArchived;

  const handleOpenArchiveModal = () => {
    if (!is90DaysFinished) {
      soundFX.playWarning();
      setArchiveNotice('بایگانی فقط پس از اتمام دوره کامل ۹۰ روزه امکان‌پذیر است.');
      setTimeout(() => setArchiveNotice(null), 5000);
      return;
    }
    if (hasUnresolvedDebts) {
      soundFX.playWarning();
      setArchiveNotice(`شما ${toPersianDigits(metrics.unresolvedDebtCount)} روز بدهی باز دارید. ابتدا تمام روزهای سوخته را کالبدشکافی کنید.`);
      setTimeout(() => setArchiveNotice(null), 5000);
      return;
    }
    if (!verdict) {
      soundFX.playWarning();
      setArchiveNotice('پیش از بایگانی نهایی، باید حکم رسمی دادگاه بوشیدو صادر شده باشد.');
      setTimeout(() => setArchiveNotice(null), 5000);
      return;
    }

    setShowArchiveConfirmModal(true);
  };

  const handleConfirmArchive = () => {
    onUpdateCycle({
      ...currentCycle,
      isArchived: true,
      reportRead: true
    });
    soundFX.playStandardDay();
    setShowArchiveConfirmModal(false);
    setArchiveNotice('چرخه با موفقیت به بایگانی رسمی منتقل و قفل شد.');
    setTimeout(() => setArchiveNotice(null), 5000);
  };

  const handleOpenUnarchiveModal = () => {
    setShowUnarchiveConfirmModal(true);
  };

  const handleConfirmUnarchive = () => {
    onUpdateCycle({
      ...currentCycle,
      isArchived: false
    });
    soundFX.playCheck();
    setShowUnarchiveConfirmModal(false);
    setArchiveNotice('چرخه از بایگانی خارج شد و به حالت فعال بازگشت.');
    setTimeout(() => setArchiveNotice(null), 5000);
  };

  const handleDeleteCurrentCycle = () => {
    if (!onDeleteCycle) return;
    setShowDeleteConfirmModal(true);
  };

  const handleConfirmDelete = () => {
    if (!onDeleteCycle) return;
    soundFX.playSlash();
    onDeleteCycle(currentCycle.id);
    setShowDeleteConfirmModal(false);
  };

  const handleGenerateVerdict = async () => {
    setIsGeneratingVerdict(true);
    try {
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

      onUpdateCycle({
        ...currentCycle,
        verdict: newVerdict
      });

      // Automatically reveal the newly generated detailed report
      setIsCourtDetailsOpen(true);

      // Background AI analysis attempt
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
    } catch (e) {
      console.error('Court verdict generation error:', e);
    } finally {
      setIsGeneratingVerdict(false);
    }
  };

  // High-Precision Comprehensive Search Engine for Bushido Daily Logs
  const matchLogWithQuery = (log: DailyLog, computed: ReturnType<typeof computeDailyProperties>, query: string): boolean => {
    if (!query.trim()) return true;
    const rawQ = query.trim();
    const qNorm = normalizeSearchText(rawQ);
    const qDigitsEn = toEnglishDigits(qNorm);
    const qDigitsFa = toPersianDigits(qDigitsEn);

    // 1. Day number calculation within current cycle (e.g., "روز ۱۵", "15", "۱۵", "روز اول")
    const dayNumber = Math.max(1, daysBetween(currentCycle.startDate, log.date) + 1);
    const dayNumberStrEn = String(dayNumber);
    const dayNumberStrFa = toPersianDigits(dayNumber);

    if (
      qDigitsEn === dayNumberStrEn || 
      qNorm === `روز ${dayNumberStrEn}` || 
      qNorm === `روز ${dayNumberStrFa}` ||
      qNorm.includes(`روز ${dayNumberStrEn}`) ||
      qNorm.includes(`روز ${dayNumberStrFa}`)
    ) {
      return true;
    }

    // 2. Dates (Persian full with weekday, short, and ISO Gregorian)
    const persianFull = normalizeSearchText(formatPersianDate(log.date, { withWeekday: true }));
    const persianShort = normalizeSearchText(formatPersianDate(log.date));
    const rawIso = log.date.toLowerCase();

    if (persianFull.includes(qNorm) || persianShort.includes(qNorm) || rawIso.includes(qDigitsEn)) {
      return true;
    }

    // 3. Temporal relative words ("امروز", "دیروز", "روز جاری")
    if (qNorm === 'امروز' || qNorm === 'روز جاری' || qNorm === 'today') {
      if (log.date === logicalToday) return true;
    }
    if (qNorm === 'دیروز' || qNorm === 'yesterday') {
      if (daysBetween(log.date, logicalToday) === 1) return true;
    }

    // 4. Status types & Persian keywords
    if (
      (qNorm.includes('استاندارد') || qNorm.includes('کامل') || qNorm.includes('تعهد') || qNorm.includes('پیروزی') || qNorm.includes('standard')) && 
      (computed.isStandard || computed.statusType === 'standard')
    ) return true;

    if (
      (qNorm.includes('فریز') || qNorm.includes('توقف') || qNorm.includes('freeze') || qNorm.includes('frozen')) && 
      computed.statusType === 'personal_frozen'
    ) return true;

    if (
      (qNorm.includes('بدهی') || qNorm.includes('سوخته') || qNorm.includes('شکست') || qNorm.includes('debt') || qNorm.includes('unresolved')) && 
      computed.statusType === 'burned_unresolved'
    ) return true;

    if (
      (qNorm.includes('کالبدشکافی') || qNorm.includes('حل شده') || qNorm.includes('حل‌') || qNorm.includes('تحلیل') || qNorm.includes('resolved') || qNorm.includes('autopsy')) && 
      computed.statusType === 'burned_resolved'
    ) return true;

    // 5. Score matching (e.g. "۱۰", "10", "امتیاز ۱۰", "۱۰ از ۱۰", "10/10")
    const scoreEn = String(computed.score);
    const scoreFa = toPersianDigits(computed.score);
    if (
      qDigitsEn === scoreEn ||
      qNorm === `امتیاز ${scoreEn}` ||
      qNorm === `امتیاز ${scoreFa}` ||
      qNorm === `${scoreEn} از ۱۰` ||
      qNorm === `${scoreFa} از ۱۰` ||
      qNorm === `${scoreEn}/10` ||
      qNorm === `${scoreFa}/10` ||
      (computed.score === 10 && (qNorm.includes('کمال') || qNorm.includes('شاهکار') || qNorm.includes('۱۰ از ۱۰') || qNorm.includes('10/10')))
    ) {
      return true;
    }

    // 6. Foundation habits & special mission keywords
    if (
      (qNorm.includes('سحر') || qNorm.includes('بیدار') || qNorm.includes('صبح') || qNorm.includes('wakeup')) &&
      log.wakeUp
    ) return true;

    if (
      (qNorm.includes('ورزش') || qNorm.includes('تمرین') || qNorm.includes('باشگاه') || qNorm.includes('workout')) &&
      log.workout
    ) return true;

    if (
      (qNorm.includes('مطالعه') || qNorm.includes('کتاب') || qNorm.includes('study') || qNorm.includes('reading')) &&
      log.study
    ) return true;

    if (
      (qNorm.includes('ژورنال') || qNorm.includes('یادداشت') || qNorm.includes('دفتر') || qNorm.includes('journal')) &&
      log.journal
    ) return true;

    if (
      (qNorm.includes('کار سخت') || qNorm.includes('تسک') || qNorm.includes('عمیق') || qNorm.includes('پروژه') || qNorm.includes('hard')) &&
      log.hardTask
    ) return true;

    if (
      (qNorm.includes('ماموریت') || qNorm.includes('ویژه') || qNorm.includes('special') || qNorm.includes('mission')) &&
      log.specialMission
    ) return true;

    // 7. Textual fields (Notes, Failure reasons, Countermeasures, Failure times, Autopsy notes)
    const normReason = normalizeSearchText(log.failureReason);
    const normNotes = normalizeSearchText(log.notes);
    const normCountermeasure = normalizeSearchText(log.countermeasure);
    const normAutopsy = normalizeSearchText(log.autopsyNotes);
    const normTime = normalizeSearchText(log.failureTime);

    if (
      normReason.includes(qNorm) ||
      normNotes.includes(qNorm) ||
      normCountermeasure.includes(qNorm) ||
      normAutopsy.includes(qNorm) ||
      normTime.includes(qNorm)
    ) {
      return true;
    }

    return false;
  };

  const filteredLogs = logs
    .filter(l => l.cycleId === currentCycle.id || (l.date >= currentCycle.startDate && l.date <= currentCycle.endDate))
    .filter(l => {
      const computed = computeDailyProperties(l, logs, logicalToday);
      if (statusFilter !== 'all' && computed.statusType !== statusFilter) return false;
      return matchLogWithQuery(l, computed, search);
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-200 touch-pan-y w-full max-w-5xl mx-auto select-none" dir="rtl">
      
      {/* 1. Top Section: Bushido Court & Verdict with Progressive Disclosure */}
      <div className="w-full max-w-full bg-[#121215] border border-zinc-800 rounded-2xl sm:rounded-3xl p-3.5 sm:p-6 shadow-xl relative overflow-hidden space-y-3.5 sm:space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 border-b border-zinc-800/80 pb-3.5 sm:pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shadow-md shrink-0">
              <Gavel className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-200" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-zinc-100 truncate">
                  دادگاه بوشیدو و کارنامه چرخه
                </h2>
                {currentCycle.isArchived ? (
                  <span className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] px-2.5 py-0.5 rounded-full font-bold flex items-center gap-1 select-none pointer-events-none cursor-default shrink-0">
                    <Lock className="w-3 h-3 text-zinc-400" />
                    بایگانی‌شده
                  </span>
                ) : verdict ? (
                  <span className="bg-emerald-950/90 border border-emerald-500/50 text-emerald-300 text-[10px] px-2.5 py-0.5 rounded-full font-bold select-none pointer-events-none cursor-default shrink-0">
                    حکم صادر شده
                  </span>
                ) : (
                  <span className="bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] px-2.5 py-0.5 rounded-full font-bold select-none pointer-events-none cursor-default shrink-0">
                    در جریان ارزیابی
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                ارزیابی عملکرد ۹۰ روزه بر مبنای انضباط و ثبات تعهد
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleGenerateVerdict}
              disabled={isGeneratingVerdict || currentCycle.isArchived}
              className="flex-1 sm:flex-initial bg-amber-500 hover:bg-amber-400 active:bg-amber-600 disabled:opacity-40 text-black font-black text-xs px-3.5 py-2 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 transition cursor-pointer active:scale-[0.98] whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-black shrink-0" />
              <span>{verdict ? 'ارزیابی مجدد حکم' : 'صدور حکم دادگاه'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenNewCycleModal}
              className="bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-800 text-zinc-100 text-xs font-bold px-3 py-2 rounded-xl border border-zinc-700 flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.98] whitespace-nowrap shadow-xs"
              title="تعریف چرخه ۹۰ روزه جدید"
            >
              <Plus className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span>تعریف چرخه جدید</span>
            </button>
          </div>
        </div>

        {/* Compact Cycle Management Bar */}
        <div className="w-full bg-[#18181b] border border-zinc-800 rounded-xl sm:rounded-2xl p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-inner">
          <div className="flex items-center gap-2 text-zinc-300 min-w-0">
            <PackageCheck className="w-4 h-4 text-zinc-400 shrink-0" />
            <div className="space-y-0.5 min-w-0">
              <p className="text-[11px] text-zinc-300 truncate">
                {currentCycle.isArchived 
                  ? 'این چرخه در بایگانی رسمی قفل شده است.' 
                  : is90DaysFinished 
                    ? 'دوره ۹۰ روزه تکمیل شده و آماده بایگانی رسمی است.' 
                    : `روز ${toPersianDigits(metrics.elapsedDays)} از ۹۰ روز (${toPersianDigits(metrics.standardDaysCount)} روز استاندارد).`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
            {!currentCycle.isArchived ? (
              <button
                onClick={handleOpenArchiveModal}
                disabled={!canArchive}
                title={!canArchive ? 'شرایط بایگانی: اتمام ۹۰ روز، تسویه بدهی‌ها و صدور حکم دادگاه' : 'بایگانی و قفل رسمی این چرخه'}
                className="bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 border border-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-[0.98] text-[11px] whitespace-nowrap"
              >
                <Archive className="w-3.5 h-3.5 text-zinc-400" />
                <span>بایگانی چرخه</span>
              </button>
            ) : (
              <button
                onClick={handleOpenUnarchiveModal}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 px-3 py-1.5 rounded-lg font-bold flex items-center gap-1.5 transition cursor-pointer active:scale-[0.98] text-[11px] whitespace-nowrap shadow-md"
              >
                <Unlock className="w-3.5 h-3.5 text-zinc-300" />
                <span>خروج از بایگانی</span>
              </button>
            )}

            {onDeleteCycle && (
              <button
                onClick={handleDeleteCurrentCycle}
                className="bg-red-950/30 hover:bg-red-900/50 border border-red-500/30 text-red-400 hover:text-red-300 px-2.5 py-1.5 rounded-lg font-bold flex items-center gap-1 transition cursor-pointer active:scale-[0.98] text-[11px] whitespace-nowrap"
                title="حذف این چرخه"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف</span>
              </button>
            )}
          </div>
        </div>

        {/* Feedback notice if any */}
        {archiveNotice && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-xl p-2.5 text-xs font-medium flex items-center gap-2 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-400" />
            <span>{archiveNotice}</span>
          </div>
        )}

        {/* Verdict Summary & Progressive Accordion */}
        {verdict ? (
          <div className="space-y-3">
            {/* Executive Compact Verdict Strip */}
            <div className="bg-[#09090b]/80 border border-zinc-800/90 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 shadow-sm">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="w-12 h-12 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 flex items-center justify-center shadow-md shadow-amber-500/10 shrink-0 mt-0.5 sm:mt-0">
                  <span className="text-xl sm:text-2xl font-black text-amber-400 font-mono tracking-tighter">
                    {verdict.grade}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="text-xs sm:text-sm font-black text-zinc-100 leading-snug">
                      {verdict.verdict}
                    </h4>
                    <span className="text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 px-2 py-0.5 rounded font-mono shrink-0 whitespace-nowrap">
                      مهر دادگاه بوشیدو
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-zinc-400 leading-relaxed">
                    {verdict.senseiNotes}
                  </p>
                </div>
              </div>

              {/* Toggle Deep Report Button */}
              <button
                type="button"
                onClick={() => setIsCourtDetailsOpen(!isCourtDetailsOpen)}
                className="w-full sm:w-auto h-9 px-3.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-zinc-100 border border-zinc-700 text-xs font-bold inline-flex items-center justify-center gap-2 shrink-0 transition cursor-pointer active:scale-98 whitespace-nowrap shadow-xs"
              >
                <span>{isCourtDetailsOpen ? 'بستن تحلیل' : 'مشاهده گزارش کامل'}</span>
                {isCourtDetailsOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
              </button>
            </div>

            {/* Expandable Deep Analysis (Progressive Disclosure) */}
            <AnimatePresence>
              {isCourtDetailsOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="overflow-hidden space-y-3 pt-1"
                >
                  <div className="bg-[#09090b]/60 border border-zinc-800/80 rounded-2xl p-3.5 space-y-2">
                    <h4 className="text-xs font-bold text-amber-400 flex items-center gap-1.5">
                      <Scroll className="w-3.5 h-3.5" />
                      <span>تحلیل سنسی بوشیدو:</span>
                    </h4>
                    <p className="text-xs text-zinc-300 leading-relaxed">
                      {verdict.senseiNotes}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Strengths */}
                    <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-3.5">
                      <h5 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 mb-2">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>نقاط قوت و پیروزی‌ها</span>
                      </h5>
                      <ul className="space-y-1.5">
                        {verdict.strengths.map((s, idx) => (
                          <li key={idx} className="text-[11px] text-zinc-300 flex items-start gap-1.5">
                            <span className="text-emerald-400 font-bold">•</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Weaknesses */}
                    <div className="bg-red-950/20 border border-red-500/30 rounded-2xl p-3.5">
                      <h5 className="text-xs font-bold text-red-400 flex items-center gap-1.5 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>آسیب‌پذیری‌ها و نقاط شکست</span>
                      </h5>
                      <ul className="space-y-1.5">
                        {verdict.weaknesses.map((w, idx) => (
                          <li key={idx} className="text-[11px] text-zinc-300 flex items-start gap-1.5">
                            <span className="text-red-400 font-bold">•</span>
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {verdict.tacticalPlanForNextCycle && (
                    <div className="bg-[#09090b]/60 border border-zinc-800/80 rounded-2xl p-3.5 flex items-start gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-bold text-zinc-200 block mb-0.5">
                          استراتژی پیشنهادی برای چرخه بعدی:
                        </span>
                        <p className="text-[11px] text-zinc-300 leading-relaxed">
                          {verdict.tacticalPlanForNextCycle}
                        </p>
                      </div>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ) : (
          <div className="bg-[#09090b]/60 border border-dashed border-zinc-800 rounded-2xl p-4 sm:p-5 text-center space-y-1.5">
            <Award className="w-8 h-8 text-zinc-600 mx-auto" />
            <h4 className="text-xs sm:text-sm font-bold text-zinc-200">
              هنوز حکمی برای این چرخه صادر نشده است
            </h4>
            <p className="text-[11px] text-zinc-400 max-w-sm mx-auto">
              با کلیک روی «صدور حکم دادگاه»، کارنامه رسمی و تحلیل نقاط قوت/ضعف چرخه صادر می‌شود.
            </p>
          </div>
        )}
      </div>

      {/* 2. Archives Table & Mobile Card View */}
      <div className="space-y-3 sm:space-y-4">
        {/* Controls: Search & Filter Tabs */}
        <div className="bg-[#121215]/90 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex flex-col md:flex-row items-center justify-between gap-2.5 sm:gap-3 shadow-md">
          {/* Search Box with Clear Button */}
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجو در روز، تاریخ، امتیاز، وضعیت، عادات، علت شکست..."
              className="w-full bg-[#09090b] border border-zinc-800 rounded-xl pr-9 pl-8 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-600 transition"
            />
            {search.length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-2.5 top-2.5 text-zinc-500 hover:text-zinc-300 transition cursor-pointer p-0.5"
                title="پاک کردن جستجو"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 w-full md:w-auto overflow-x-auto pb-1 md:pb-0 no-scrollbar">
            {[
              { id: 'all', label: 'همه' },
              { id: 'standard', label: 'تعهد کامل' },
              { id: 'personal_frozen', label: 'فریز' },
              { id: 'burned_unresolved', label: 'بدهی باز' },
              { id: 'burned_resolved', label: 'کالبدشکافی' }
            ].map(f => {
              const isActive = statusFilter === f.id;
              return (
                <button
                  key={f.id}
                  onClick={() => {
                    soundFX.playCheck();
                    setStatusFilter(f.id);
                  }}
                  className={`text-xs px-2.5 sm:px-3 py-1.5 rounded-xl border whitespace-nowrap transition cursor-pointer active:scale-[0.98] leading-none ${
                    isActive
                      ? 'bg-zinc-800 border-zinc-600 text-zinc-100 font-bold shadow-sm'
                      : 'bg-[#09090b]/60 border-zinc-800/80 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Count summary & 7-Day View Notice */}
        <div className="px-1 text-[11px] text-zinc-400 flex items-center justify-between">
          <span>
            {search.trim() || statusFilter !== 'all' || showAllLogs || filteredLogs.length <= 7
              ? `نمایش ${toPersianDigits(filteredLogs.length)} رکورد در این چرخه`
              : `نمایش ${toPersianDigits(Math.min(7, filteredLogs.length))} روز اخیر از مجموع ${toPersianDigits(filteredLogs.length)} روز`}
          </span>
          {!showAllLogs && !search.trim() && statusFilter === 'all' && filteredLogs.length > 7 && (
            <button
              type="button"
              onClick={() => {
                soundFX.playCheck();
                setShowAllLogs(true);
              }}
              className="text-amber-400 hover:text-amber-300 font-bold inline-flex items-center gap-1 cursor-pointer transition text-[11px]"
            >
              <span>نمایش همه ({toPersianDigits(filteredLogs.length)})</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 1. Mobile Card View (< md) */}
        <div className="block md:hidden space-y-2.5 w-full max-w-full">
          {filteredLogs.length === 0 ? (
            <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-6 text-center text-zinc-500 text-xs">
              هیچ رکوردی مطابق جستجو و فیلتر جاری یافت نشد.
            </div>
          ) : (
            <>
              {(showAllLogs || search.trim() !== '' || statusFilter !== 'all' ? filteredLogs : filteredLogs.slice(0, 7)).map(l => {
                const computed = computeDailyProperties(l, logs, logicalToday);
                const isToday = l.date === logicalToday;

                return (
                  <div
                    key={l.id}
                    className={`bg-[#121215] border rounded-2xl p-3 sm:p-3.5 space-y-2.5 shadow-md transition ${
                      isToday 
                        ? 'border-rose-500/40 bg-rose-500/5' 
                        : 'border-zinc-800'
                    }`}
                  >
                    {/* Top row: Date & Score & Status */}
                    <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                      <button
                        onClick={() => onSelectDate(l.date)}
                        className="flex items-center gap-1.5 font-bold text-xs text-zinc-100 hover:text-amber-400 cursor-pointer text-right transition shrink-0"
                      >
                        <Calendar className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                        <span className="whitespace-nowrap sm:hidden">{formatPersianDate(l.date, { short: true })}</span>
                        <span className="whitespace-nowrap hidden sm:inline">{formatPersianDate(l.date, { withWeekday: true })}</span>
                        {isToday && (
                          <span className="bg-rose-500/20 text-rose-300 text-[10px] px-1.5 py-0.5 rounded font-bold whitespace-nowrap">
                            امروز
                          </span>
                        )}
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`font-bold text-[11px] font-mono bg-[#18181b] px-2 py-0.5 rounded-lg border border-zinc-800 shrink-0 whitespace-nowrap ${
                          computed.score === 10
                            ? 'text-amber-400 font-black'
                            : computed.isStandard
                            ? 'text-emerald-400'
                            : computed.statusType === 'personal_frozen'
                            ? 'text-blue-300'
                            : 'text-zinc-300'
                        }`}>
                          {toPersianDigits(computed.score)} / ۱۰
                        </span>

                        <span className={`h-6 px-2 rounded-lg text-[10px] font-bold border inline-flex items-center gap-1 shadow-sm select-none pointer-events-none cursor-default shrink-0 whitespace-nowrap ${
                          computed.statusType === 'standard'
                            ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300'
                            : computed.statusType === 'personal_frozen'
                            ? 'bg-blue-950/90 border-blue-500/50 text-blue-300'
                            : computed.statusType === 'burned_resolved'
                            ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                            : 'bg-red-950/90 border-red-500/50 text-red-300 animate-pulse'
                        }`}>
                          {computed.statusType === 'standard' && <CheckCircle2 className="w-3 h-3" />}
                          {computed.statusType === 'personal_frozen' && <Snowflake className="w-3 h-3" />}
                          {computed.statusType === 'burned_resolved' && <FileBadge className="w-3 h-3 text-zinc-400" />}
                          {computed.statusType === 'burned_unresolved' && <AlertTriangle className="w-3 h-3" />}
                          <span>
                            {computed.statusType === 'standard' && 'تعهد کامل'}
                            {computed.statusType === 'personal_frozen' && 'فریز'}
                            {computed.statusType === 'burned_resolved' && 'حل‌شده'}
                            {computed.statusType === 'burned_unresolved' && 'بدهی باز'}
                          </span>
                        </span>
                      </div>
                    </div>

                    {/* Habits & Special Mission Row */}
                    <div className="bg-[#18181b] p-2 rounded-xl border border-zinc-800 flex items-center justify-between flex-wrap gap-2">
                      <span className="text-[10px] text-zinc-400 font-bold">۵ پایه و ماموریت:</span>
                      <div className="flex items-center gap-1">
                        {[
                          { k: 'wakeUp', title: 'سحرخیزی', done: l.wakeUp },
                          { k: 'workout', title: 'ورزش', done: l.workout },
                          { k: 'study', title: 'مطالعه', done: l.study },
                          { k: 'journal', title: 'ژورنال', done: l.journal },
                          { k: 'hardTask', title: 'کار سخت', done: l.hardTask }
                        ].map(h => (
                          <div
                            key={h.k}
                            className={`w-5 h-5 rounded flex items-center justify-center text-[9px] font-bold ${
                              h.done
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                                : 'bg-zinc-800 text-zinc-600 border border-zinc-700'
                            }`}
                            title={`${h.title}: ${h.done ? 'انجام شد' : 'انجام نشد'}`}
                          >
                            {h.done ? '✓' : '×'}
                          </div>
                        ))}

                        <span className="w-[1px] h-3.5 bg-zinc-700 mx-0.5"></span>

                        <div
                          className={`w-6 h-5 rounded flex items-center justify-center text-[9px] font-bold ${
                            l.specialMission
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                              : 'bg-zinc-800 text-zinc-600 border border-zinc-700'
                          }`}
                          title={`ماموریت ویژه: ${l.specialMission ? 'انجام شد (+۲ امتیاز)' : 'انجام نشد'}`}
                        >
                          {l.specialMission ? <Check className="w-3 h-3 text-amber-400 stroke-[2.5]" /> : '×'}
                        </div>
                      </div>
                    </div>

                    {/* Failure / Autopsy details (Strict Ghost Elements Cleanse) */}
                    {((l.failureReason && l.failureReason.trim() !== '') || (l.countermeasure && l.countermeasure.trim() !== '') || (l.autopsyNotes && l.autopsyNotes.trim() !== '')) && (
                      <div className="bg-[#18181b] p-2 rounded-xl border border-zinc-800 space-y-1 text-[11px]">
                        {l.failureReason && l.failureReason.trim() !== '' && (
                          <div className="text-red-300">
                            <span className="font-bold text-zinc-400">ریشه شکست: </span>
                            <span>{l.failureReason.trim()}</span>
                            {l.failureTime && l.failureTime.trim() !== '' && (
                              <span className="text-zinc-500 mr-1">({toPersianDigits(l.failureTime.trim())})</span>
                            )}
                          </div>
                        )}
                        {((l.countermeasure && l.countermeasure.trim() !== '') || (l.autopsyNotes && l.autopsyNotes.trim() !== '')) && (
                          <div className="text-zinc-200">
                            <span className="font-bold text-zinc-400">پادزهر: </span>
                            <span>{(l.countermeasure && l.countermeasure.trim() !== '') ? l.countermeasure.trim() : l.autopsyNotes?.trim()}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-start gap-1.5 pt-0.5 flex-wrap">
                      <button
                        onClick={() => onSelectDate(l.date)}
                        className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs px-2.5 py-1 rounded-lg border border-zinc-700 flex items-center gap-1 cursor-pointer active:scale-95 whitespace-nowrap transition"
                      >
                        <span>میدان نبرد</span>
                        <ChevronLeft className="w-3 h-3" />
                      </button>

                      {(computed.needsAutopsy || l.failureReason) && (
                        <button
                          onClick={() => onOpenAutopsy(l)}
                          className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold px-2.5 py-1 rounded-lg border border-zinc-700 cursor-pointer active:scale-95 whitespace-nowrap transition"
                        >
                          کالبدشکافی
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* 1-Click Expand Button on Mobile (< md) */}
              {!showAllLogs && !search.trim() && statusFilter === 'all' && filteredLogs.length > 7 && (
                <button
                  type="button"
                  onClick={() => {
                    soundFX.playCheck();
                    setShowAllLogs(true);
                  }}
                  className="w-full py-3.5 px-4 rounded-2xl bg-[#121215] hover:bg-zinc-800 border border-amber-500/40 hover:border-amber-500/60 text-amber-300 font-bold text-xs flex items-center justify-center gap-2 shadow-lg cursor-pointer active:scale-[0.98] transition"
                >
                  <span>نمایش کامل سوابق ({toPersianDigits(filteredLogs.length - 7)} روز دیگر)</span>
                  <ChevronDown className="w-4 h-4 text-amber-400" />
                </button>
              )}

              {showAllLogs && !search.trim() && statusFilter === 'all' && filteredLogs.length > 7 && (
                <button
                  type="button"
                  onClick={() => {
                    soundFX.playCheck();
                    setShowAllLogs(false);
                  }}
                  className="w-full py-2.5 px-4 rounded-2xl bg-[#121215]/60 hover:bg-[#121215] border border-zinc-800 text-zinc-400 hover:text-zinc-200 font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition"
                >
                  <span>بستن و نمایش ۷ روز اخیر</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* 2. Desktop Table View (>= md) */}
        <div className="hidden md:block bg-[#121215]/90 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-[#09090b] border-b border-zinc-800 text-zinc-400 font-semibold select-none">
                <tr>
                  <th className="p-3.5 whitespace-nowrap min-w-[110px] text-center">تاریخ روز</th>
                  <th className="p-3.5 whitespace-nowrap min-w-[130px] text-center">۵ پایه تعهد</th>
                  <th className="p-3.5 whitespace-nowrap min-w-[90px] text-center">ماموریت ویژه</th>
                  <th className="p-3.5 whitespace-nowrap min-w-[80px] text-center">امتیاز</th>
                  <th className="p-3.5 whitespace-nowrap min-w-[130px] text-center">وضعیت روز</th>
                  <th className="p-3.5 min-w-[220px] text-right">علت و زمان شکست</th>
                  <th className="p-3.5 min-w-[220px] text-right">پادزهر و استراتژی فردا</th>
                  <th className="p-3.5 whitespace-nowrap min-w-[90px] text-center">اقدام</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-zinc-500">
                      هیچ رکوردی مطابق جستجو و فیلتر جاری یافت نشد.
                    </td>
                  </tr>
                ) : (
                  (showAllLogs || search.trim() !== '' || statusFilter !== 'all' ? filteredLogs : filteredLogs.slice(0, 14)).map(l => {
                    const computed = computeDailyProperties(l, logs, logicalToday);
                    const isToday = l.date === logicalToday;

                    return (
                      <tr key={l.id} className={`hover:bg-zinc-800/40 transition ${isToday ? 'bg-rose-500/5 hover:bg-rose-500/10' : ''}`}>
                        <td className="p-3.5 font-mono whitespace-nowrap align-middle text-center">
                          <button
                            onClick={() => onSelectDate(l.date)}
                            className="hover:text-amber-400 font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer text-zinc-100 mx-auto"
                          >
                            <Calendar className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                            <span>{formatPersianDate(l.date, { short: true })}</span>
                            {isToday && (
                              <span className="text-[10px] bg-rose-500/20 text-rose-300 px-1.5 py-0.5 rounded font-sans">
                                امروز
                              </span>
                            )}
                          </button>
                        </td>

                        {/* 5 Habits Badges */}
                        <td className="p-3.5 whitespace-nowrap align-middle text-center">
                          <div className="flex items-center justify-center gap-1">
                            {[
                              { k: 'wakeUp', title: 'سحرخیزی', done: l.wakeUp },
                              { k: 'workout', title: 'ورزش', done: l.workout },
                              { k: 'study', title: 'مطالعه', done: l.study },
                              { k: 'journal', title: 'ژورنال', done: l.journal },
                              { k: 'hardTask', title: 'کار سخت', done: l.hardTask }
                            ].map(h => (
                              <span
                                key={h.k}
                                title={`${h.title}: ${h.done ? 'انجام شد' : 'انجام نشد'}`}
                                className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold ${
                                  h.done 
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' 
                                    : 'bg-zinc-800 text-zinc-600 border border-zinc-700'
                                }`}
                              >
                                {h.done ? '✓' : '×'}
                              </span>
                            ))}
                          </div>
                        </td>

                        {/* Special Mission */}
                        <td className="p-3.5 whitespace-nowrap align-middle text-center">
                          {l.specialMission ? (
                            <span 
                              title="ماموریت ویژه: انجام شد (+۲ امتیاز اضافه)"
                              className="w-5 h-5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 inline-flex items-center justify-center font-bold text-[10px] shadow-sm mx-auto"
                            >
                              ✓
                            </span>
                          ) : (
                            <span 
                              title="ماموریت ویژه: انجام نشد"
                              className="w-5 h-5 rounded-md bg-zinc-800/80 text-zinc-600 border border-zinc-700 inline-flex items-center justify-center text-[10px] font-bold mx-auto"
                            >
                              ×
                            </span>
                          )}
                        </td>

                        {/* Score Column */}
                        <td className={`p-3.5 whitespace-nowrap font-mono align-middle text-center ${
                          computed.score === 10
                            ? 'text-amber-400 font-black'
                            : computed.isStandard
                            ? 'text-emerald-400 font-bold'
                            : computed.statusType === 'personal_frozen'
                            ? 'text-blue-300 font-medium'
                            : 'text-zinc-300 font-medium'
                        }`}>
                          {toPersianDigits(computed.score)} / ۱۰
                        </td>

                        {/* Status Badge */}
                        <td className="p-3.5 whitespace-nowrap align-middle text-center">
                          <div className="flex items-center justify-center">
                            <span className={`w-28 h-7 justify-center px-2 py-0.5 rounded-lg text-[11px] font-bold border inline-flex items-center gap-1.5 shadow-sm text-center select-none pointer-events-none cursor-default ${
                              computed.statusType === 'standard'
                                ? 'bg-emerald-950/80 border-emerald-500/40 text-emerald-300'
                                : computed.statusType === 'personal_frozen'
                                ? 'bg-blue-950/80 border-blue-500/40 text-blue-300'
                                : computed.statusType === 'burned_resolved'
                                ? 'bg-zinc-800 border-zinc-700 text-zinc-300'
                                : 'bg-red-950/80 border-red-500/40 text-red-300 animate-pulse'
                            }`}>
                              {computed.statusType === 'standard' && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {computed.statusType === 'personal_frozen' && <Snowflake className="w-3.5 h-3.5" />}
                              {computed.statusType === 'burned_resolved' && <FileBadge className="w-3.5 h-3.5 text-zinc-400" />}
                              {computed.statusType === 'burned_unresolved' && <AlertTriangle className="w-3.5 h-3.5" />}
                              <span>
                                {computed.statusType === 'standard' && 'تعهد کامل'}
                                {computed.statusType === 'personal_frozen' && 'توقف فریز'}
                                {computed.statusType === 'burned_resolved' && 'حل‌شده'}
                                {computed.statusType === 'burned_unresolved' && 'بدهی باز'}
                              </span>
                            </span>
                          </div>
                        </td>

                        {/* Failure Reason and Time */}
                        <td className="p-3.5 text-xs text-zinc-300 align-middle text-right max-w-[240px]">
                          {l.failureReason && l.failureReason.trim() !== '' ? (
                            <div className="space-y-1 bg-[#09090b]/80 p-2 rounded-xl border border-zinc-800/80">
                              <p className="font-semibold text-zinc-200 leading-snug break-words">
                                {l.failureReason.trim()}
                              </p>
                              {l.failureTime && l.failureTime.trim() !== '' && (
                                <div className="inline-flex items-center gap-1 text-[10px] bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800 text-zinc-400 font-mono">
                                  <Clock className="w-3 h-3 text-zinc-500" />
                                  <span>زمان: {toPersianDigits(l.failureTime.trim())}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-zinc-600 block text-right select-none">—</span>
                          )}
                        </td>

                        {/* Countermeasure / Strategy */}
                        <td className="p-3.5 text-xs text-zinc-300 align-middle text-right max-w-[240px]">
                          {(l.countermeasure && l.countermeasure.trim() !== '') || (l.autopsyNotes && l.autopsyNotes.trim() !== '') ? (
                            <p className="leading-snug text-zinc-300 break-words line-clamp-3 hover:line-clamp-none transition-all">
                              {(l.countermeasure && l.countermeasure.trim() !== '') ? l.countermeasure.trim() : l.autopsyNotes?.trim()}
                            </p>
                          ) : (
                            <span className="text-zinc-600 block text-right select-none">—</span>
                          )}
                        </td>

                        {/* Action Button */}
                        <td className="p-3.5 whitespace-nowrap text-center align-middle">
                          <button
                            onClick={() => onOpenAutopsy(l)}
                            className="text-xs bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-600 text-zinc-200 px-2.5 py-1 rounded-lg border border-zinc-700 transition cursor-pointer active:scale-[0.98]"
                          >
                            کالبدشکافی
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 1-Click Expand Button on Desktop (>= md) */}
          {!showAllLogs && !search.trim() && statusFilter === 'all' && filteredLogs.length > 14 && (
            <div className="p-3 bg-[#09090b] border-t border-zinc-800 text-center">
              <button
                type="button"
                onClick={() => {
                  soundFX.playCheck();
                  setShowAllLogs(true);
                }}
                className="py-2 px-4 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-amber-500/40 text-amber-300 font-bold text-xs inline-flex items-center gap-2 cursor-pointer active:scale-[0.98] transition"
              >
                <span>نمایش کامل همه سوابق جدول ({toPersianDigits(filteredLogs.length)} روز)</span>
                <ChevronDown className="w-3.5 h-3.5 text-amber-400" />
              </button>
            </div>
          )}

          {showAllLogs && !search.trim() && statusFilter === 'all' && filteredLogs.length > 14 && (
            <div className="p-2.5 bg-[#09090b] border-t border-zinc-800 text-center">
              <button
                type="button"
                onClick={() => {
                  soundFX.playCheck();
                  setShowAllLogs(false);
                }}
                className="py-1.5 px-3 rounded-xl bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 text-xs inline-flex items-center gap-1 cursor-pointer active:scale-[0.98] transition"
              >
                <span>محدود کردن به ۱۴ روز اخیر</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* New Cycle Creation Modal */}
      {showNewCycleModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-lg p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <h3 className="font-bold text-base sm:text-lg text-zinc-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-zinc-300" />
              <span>تعریف چرخه ۹۰ روزه جدید</span>
            </h3>

            {modalOverlapError && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-xl p-3 text-xs font-medium flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{modalOverlapError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCycleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs text-zinc-300 block mb-1">عنوان چرخه:</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-300 block mb-1">تاریخ شروع (YYYY-MM-DD):</label>
                <input
                  type="date"
                  value={newStartDate}
                  onChange={e => setNewStartDate(e.target.value)}
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-zinc-600 transition"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-300 block mb-1">میثاق و تم اصلی چرخه:</label>
                <textarea
                  value={newTheme}
                  onChange={e => setNewTheme(e.target.value)}
                  rows={2}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 focus:outline-none focus:border-zinc-600 transition resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowNewCycleModal(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-600 border border-zinc-700 text-zinc-300 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-[0.98]"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-400 active:bg-amber-600 text-black px-5 py-2 rounded-xl text-xs font-black shadow-md shadow-amber-500/20 transition cursor-pointer active:scale-[0.98]"
                >
                  ایجاد و شروع چرخه
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Archive Cycle Confirmation Modal */}
      {showArchiveConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-md p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0">
                <Archive className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-zinc-100">
                  تأیید بایگانی نهایی چرخه
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  قفل سوابق تاریخی در بایگانی بوشیدو
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed bg-[#09090b]/80 border border-zinc-800 rounded-2xl p-3.5">
              آیا از انتقال چرخه <strong className="text-amber-300">«{currentCycle.title}»</strong> به بایگانی رسمی اطمینان دارید؟
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowArchiveConfirmModal(false)}
                className="bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-600 border border-zinc-700 text-zinc-300 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-[0.98]"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                className="bg-zinc-750 hover:bg-zinc-700 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-lg border border-zinc-600 transition cursor-pointer active:scale-[0.98]"
              >
                <Archive className="w-3.5 h-3.5" />
                <span>تأیید بایگانی</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unarchive Cycle Confirmation Modal */}
      {showUnarchiveConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl w-full max-w-md p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0">
                <Unlock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-zinc-100">
                  خروج چرخه از بایگانی
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  بازگرداندن به حالت فعال
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed bg-[#09090b]/80 border border-zinc-800 rounded-2xl p-3.5">
              آیا مایلید چرخه <strong className="text-amber-300">«{currentCycle.title}»</strong> را از حالت بایگانی خارج کنید تا بتوانید مجدداً روزها را ثبت یا ویرایش نمایید؟
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowUnarchiveConfirmModal(false)}
                className="bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-600 border border-zinc-700 text-zinc-300 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-[0.98]"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmUnarchive}
                className="bg-zinc-750 hover:bg-zinc-700 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-lg border border-zinc-600 transition cursor-pointer active:scale-[0.98]"
              >
                <Unlock className="w-3.5 h-3.5" />
                <span>تأیید خروج</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Cycle Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-red-500/40 rounded-3xl w-full max-w-md p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-zinc-100">
                  تأیید حذف دائمی چرخه
                </h3>
                <p className="text-xs text-red-400 mt-0.5">
                  غیرقابل بازگشت
                </p>
              </div>
            </div>

            <p className="text-xs text-zinc-300 leading-relaxed bg-[#09090b]/80 border border-zinc-800 rounded-2xl p-3.5">
              آیا از حذف کامل <strong className="text-amber-300">«{currentCycle.title}»</strong> و تمام لاگ‌ها و سوابق آن اطمینان دارید؟
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirmModal(false)}
                className="bg-zinc-800 hover:bg-zinc-700 hover:border-zinc-600 border border-zinc-700 text-zinc-300 px-3.5 py-2 rounded-xl text-xs font-bold transition cursor-pointer active:scale-[0.98]"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="bg-red-600 hover:bg-red-500 text-white font-bold px-4 py-2 rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-red-600/30 transition cursor-pointer active:scale-[0.98]"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>حذف قطعی</span>
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
