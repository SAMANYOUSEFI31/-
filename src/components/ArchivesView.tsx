import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { DailyLog, Cycle, CycleMetrics, CycleVerdict } from '../types';
import { computeDailyProperties } from '../engine/bushidoCalculations';
import { formatPersianDate, getLogicalTodayDate, addDaysToDate, daysBetween } from '../utils/dateUtils';
import { toPersianDigits, toEnglishDigits, normalizeSearchText } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
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

  useBodyScrollLock(showNewCycleModal || showDeleteConfirmModal || showArchiveConfirmModal || showUnarchiveConfirmModal);

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
        <div className="surface-z1 border-standard radius-modal p-8 sm:p-12 text-center space-y-5 max-w-xl mx-auto shadow-subtle">
          <div className="w-16 h-16 radius-card bg-amber-subtle border border-amber-subtle flex items-center justify-center mx-auto text-amber">
            <Archive className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-lg sm:text-xl font-black text-role-primary">
              هیچ چرخه نبردی در سیستم تعریف نشده است
            </h2>
            <p className="text-xs sm:text-sm text-role-secondary leading-relaxed max-w-md mx-auto">
              جهت ورود به کارزار، ردیابی ۹۰ روزه ارکان دیسیپلین و صدور احکام دادگاه بوشیدو، نخستین چرخه نبرد خود را آغاز کنید.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenNewCycleModal}
            className="btn-contract-mastery font-black text-sm px-6 py-3 radius-card inline-flex items-center justify-center gap-2 mx-auto shadow-subtle whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>تعریف چرخه نبرد ۹۰ روزه</span>
          </button>
        </div>

        {/* New Cycle Modal when empty */}
        {showNewCycleModal && (
          <div className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] overscroll-contain overflow-y-auto max-h-[100dvh]">
            <div className="surface-z2 border-standard radius-modal w-full max-w-lg p-5 sm:p-6 space-y-4 shadow-subtle animate-in zoom-in-95 duration-150 my-auto">
              <h3 className="font-bold text-base sm:text-lg text-role-primary flex items-center gap-2">
                <Layers className="w-5 h-5 text-role-secondary" />
                <span>تعریف چرخه ۹۰ روزه جدید</span>
              </h3>

              {modalOverlapError && (
                <div className="bg-debt-subtle border border-debt-subtle text-debt radius-component p-3 text-xs font-medium flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-debt shrink-0 mt-0.5" />
                  <span className="leading-relaxed">{modalOverlapError}</span>
                </div>
              )}

              <form onSubmit={handleCreateCycleSubmit} className="space-y-3.5">
                <div>
                  <label className="text-xs text-role-secondary block mb-1">عنوان چرخه:</label>
                  <input
                    type="text"
                    value={newTitle}
                    onChange={e => setNewTitle(e.target.value)}
                    required
                    className="w-full surface-z0 border-standard radius-component p-2.5 text-xs text-role-primary focus:outline-none focus:border-amber transition"
                  />
                </div>

                <div>
                  <label className="text-xs text-role-secondary block mb-1">تاریخ شروع (YYYY-MM-DD):</label>
                  <input
                    type="date"
                    value={newStartDate}
                    onChange={e => setNewStartDate(e.target.value)}
                    required
                    className="w-full surface-z0 border-standard radius-component p-2.5 text-xs text-role-primary font-mono focus:outline-none focus:border-amber transition"
                  />
                </div>

                <div>
                  <label className="text-xs text-role-secondary block mb-1">میثاق و تم اصلی چرخه:</label>
                  <textarea
                    value={newTheme}
                    onChange={e => setNewTheme(e.target.value)}
                    rows={2}
                    className="w-full surface-z0 border-standard radius-component p-2.5 text-xs text-role-primary focus:outline-none focus:border-amber transition resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-standard">
                  <button
                    type="button"
                    onClick={() => setShowNewCycleModal(false)}
                    className="btn-contract-secondary px-4 py-2 radius-component text-xs font-bold"
                  >
                    انصراف
                  </button>
                  <button
                    type="submit"
                    className="btn-contract-mastery px-5 py-2 radius-component text-xs flex items-center gap-1.5 shadow-subtle"
                  >
                    <Plus className="w-4 h-4" />
                    <span>ایجاد چرخه نبرد</span>
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
      <div className="w-full max-w-full surface-z1 border-standard radius-modal p-3.5 sm:p-6 shadow-subtle relative overflow-hidden space-y-3.5 sm:space-y-5">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 border-b border-standard pb-3.5 sm:pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 sm:w-11 sm:h-11 radius-card surface-z2 border-standard flex items-center justify-center text-role-secondary shadow-subtle shrink-0">
              <Gavel className="w-5 h-5 sm:w-6 sm:h-6 text-role-secondary" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-black text-role-primary truncate">
                  دادگاه بوشیدو و کارنامه چرخه
                </h2>
                {currentCycle.isArchived ? (
                  <span className="surface-z2 border-standard text-role-secondary text-[10px] px-2.5 py-0.5 radius-badge font-bold flex items-center gap-1 select-none pointer-events-none cursor-default shrink-0">
                    <Lock className="w-3 h-3 text-role-muted" />
                    بایگانی‌شده
                  </span>
                ) : verdict ? (
                  <span className="bg-emerald-subtle border border-emerald-subtle text-emerald text-[10px] px-2.5 py-0.5 radius-badge font-bold select-none pointer-events-none cursor-default shrink-0">
                    حکم صادر شده
                  </span>
                ) : (
                  <span className="surface-z2 border-standard text-role-secondary text-[10px] px-2.5 py-0.5 radius-badge font-bold select-none pointer-events-none cursor-default shrink-0">
                    در جریان ارزیابی
                  </span>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-role-secondary mt-0.5 leading-relaxed">
                ارزیابی عملکرد ۹۰ روزه بر مبنای انضباط و ثبات تعهد
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <button
              type="button"
              onClick={handleGenerateVerdict}
              disabled={isGeneratingVerdict || currentCycle.isArchived}
              className="btn-contract-mastery flex-1 sm:flex-initial text-xs px-3.5 py-2 radius-component flex items-center justify-center gap-1.5 shadow-subtle whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5 text-black shrink-0" />
              <span>{verdict ? 'ارزیابی مجدد حکم' : 'صدور حکم دادگاه'}</span>
            </button>

            <button
              type="button"
              onClick={handleOpenNewCycleModal}
              className="btn-contract-secondary text-xs font-bold px-3 py-2 radius-component flex items-center justify-center gap-1.5 whitespace-nowrap shadow-subtle"
              title="تعریف چرخه ۹۰ روزه جدید"
            >
              <Plus className="w-3.5 h-3.5 text-amber shrink-0" />
              <span>تعریف چرخه جدید</span>
            </button>
          </div>
        </div>

        {/* Compact Cycle Management Bar */}
        <div className="w-full surface-z0 border-standard radius-card p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs shadow-inner">
          <div className="flex items-center gap-2 text-role-secondary min-w-0">
            <PackageCheck className="w-4 h-4 text-role-muted shrink-0" />
            <div className="space-y-0.5 min-w-0">
              <p className="text-[11px] text-role-secondary truncate">
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
                className="btn-contract-secondary px-3 py-1.5 radius-control font-bold flex items-center gap-1.5 text-[11px] whitespace-nowrap"
              >
                <Archive className="w-3.5 h-3.5 text-role-muted" />
                <span>بایگانی چرخه</span>
              </button>
            ) : (
              <button
                onClick={handleOpenUnarchiveModal}
                className="btn-contract-secondary px-3 py-1.5 radius-control font-bold flex items-center gap-1.5 text-[11px] whitespace-nowrap shadow-subtle"
              >
                <Unlock className="w-3.5 h-3.5 text-role-secondary" />
                <span>خروج از بایگانی</span>
              </button>
            )}

            {onDeleteCycle && (
              <button
                onClick={handleDeleteCurrentCycle}
                className="btn-contract-danger-subtle px-2.5 py-1.5 radius-control font-bold flex items-center gap-1 text-[11px] whitespace-nowrap focus-ring-tactical"
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
          <div className="bg-amber-subtle border border-amber-subtle text-amber radius-component p-2.5 text-xs font-medium flex items-center gap-2 animate-in fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber" />
            <span>{archiveNotice}</span>
          </div>
        )}

        {/* Verdict Summary & Progressive Accordion */}
        {verdict ? (
          <div className="space-y-3">
            {/* Executive Compact Verdict Strip */}
            <div className="surface-z0 border-standard radius-card p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3.5 shadow-subtle">
              <div className="flex items-start sm:items-center gap-3 min-w-0">
                <div className="w-12 h-12 radius-component border border-amber-subtle bg-amber-subtle flex items-center justify-center shadow-subtle shrink-0 mt-0.5 sm:mt-0">
                  <span className="text-xl sm:text-2xl font-black text-amber font-mono tracking-tighter">
                    {verdict.grade}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h4 className="text-xs sm:text-sm font-black text-role-primary leading-snug">
                      {verdict.verdict}
                    </h4>
                    <span className="text-[10px] bg-amber-subtle text-amber border border-amber-subtle px-2 py-0.5 radius-control font-mono shrink-0 whitespace-nowrap">
                      مهر دادگاه بوشیدو
                    </span>
                  </div>
                  <p className="text-[11px] sm:text-xs text-role-secondary leading-relaxed">
                    {verdict.senseiNotes}
                  </p>
                </div>
              </div>

              {/* Toggle Deep Report Button */}
              <button
                type="button"
                onClick={() => setIsCourtDetailsOpen(!isCourtDetailsOpen)}
                className="btn-contract-secondary w-full sm:w-auto h-9 px-3.5 radius-component text-xs font-bold inline-flex items-center justify-center gap-2 shrink-0 whitespace-nowrap shadow-subtle"
              >
                <span>{isCourtDetailsOpen ? 'بستن تحلیل' : 'مشاهده گزارش کامل'}</span>
                {isCourtDetailsOpen ? <ChevronUp className="w-4 h-4 text-role-muted" /> : <ChevronDown className="w-4 h-4 text-role-muted" />}
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
                  <div className="surface-z0 border-standard radius-card p-3.5 space-y-2">
                    <h4 className="text-xs font-bold text-amber flex items-center gap-1.5">
                      <Scroll className="w-3.5 h-3.5" />
                      <span>تحلیل سنسی بوشیدو:</span>
                    </h4>
                    <p className="text-xs text-role-secondary leading-relaxed">
                      {verdict.senseiNotes}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Strengths */}
                    <div className="bg-emerald-subtle border border-emerald-subtle radius-card p-3.5">
                      <h5 className="text-xs font-bold text-emerald flex items-center gap-1.5 mb-2">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        <span>نقاط قوت و پیروزی‌ها</span>
                      </h5>
                      <ul className="space-y-1.5">
                        {verdict.strengths.map((s, idx) => (
                          <li key={idx} className="text-[11px] text-role-secondary flex items-start gap-1.5">
                            <span className="text-emerald font-bold">•</span>
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    {/* Weaknesses */}
                    <div className="bg-debt-subtle border border-debt-subtle radius-card p-3.5">
                      <h5 className="text-xs font-bold text-debt flex items-center gap-1.5 mb-2">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        <span>آسیب‌پذیری‌ها و نقاط شکست</span>
                      </h5>
                      <ul className="space-y-1.5">
                        {verdict.weaknesses.map((w, idx) => (
                          <li key={idx} className="text-[11px] text-role-secondary flex items-start gap-1.5">
                            <span className="text-debt font-bold">•</span>
                            <span>{w}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {verdict.tacticalPlanForNextCycle && (
                    <div className="surface-z0 border-standard radius-card p-3.5 flex items-start gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-role-muted shrink-0 mt-0.5" />
                      <div>
                        <span className="text-xs font-bold text-role-primary block mb-0.5">
                          استراتژی پیشنهادی برای چرخه بعدی:
                        </span>
                        <p className="text-[11px] text-role-secondary leading-relaxed">
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
          <div className="surface-z0 border border-dashed border-standard radius-card p-4 sm:p-5 text-center space-y-1.5">
            <Award className="w-8 h-8 text-role-muted mx-auto" />
            <h4 className="text-xs sm:text-sm font-bold text-role-primary">
              هنوز حکمی برای این چرخه صادر نشده است
            </h4>
            <p className="text-[11px] text-role-secondary max-w-sm mx-auto">
              با کلیک روی «صدور حکم دادگاه»، کارنامه رسمی و تحلیل نقاط قوت/ضعف چرخه صادر می‌شود.
            </p>
          </div>
        )}
      </div>

      {/* 2. Archives Table & Mobile Card View */}
      <div className="space-y-3 sm:space-y-4">
        {/* Controls: Search & Filter Tabs */}
        <div className="surface-z1 border-standard radius-card p-3 sm:p-4 flex flex-col md:flex-row items-center justify-between gap-2.5 sm:gap-3 shadow-subtle">
          {/* Search Box with Clear Button */}
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-role-muted absolute right-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="جستجو در روز، تاریخ، امتیاز، وضعیت، عادات، علت شکست..."
              className="w-full surface-z0 border-standard radius-component pr-9 pl-8 py-2 text-xs text-role-primary placeholder:text-role-muted focus:outline-none focus:border-[var(--color-border-active)] focus-ring-tactical transition"
            />
            {search.length > 0 && (
              <button
                type="button"
                onClick={() => setSearch('')}
                className="absolute left-2.5 top-2.5 text-role-muted hover:text-role-primary transition cursor-pointer p-0.5"
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
                  className={`text-xs px-2.5 sm:px-3 py-1.5 radius-component border whitespace-nowrap transition cursor-pointer active:scale-[0.98] leading-none ${
                    isActive
                      ? 'surface-z2 border-standard text-role-primary font-bold shadow-subtle'
                      : 'surface-z0 border-standard text-role-secondary hover:text-role-primary hover:border-[var(--color-border-hover)]'
                  }`}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Count summary & 7-Day View Notice */}
        <div className="px-1 text-[11px] text-role-secondary flex items-center justify-between">
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
              className="text-amber hover:brightness-110 font-bold inline-flex items-center gap-1 cursor-pointer transition text-[11px]"
            >
              <span>نمایش همه ({toPersianDigits(filteredLogs.length)})</span>
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* 1. Mobile Card View (< md) */}
        <div className="block md:hidden space-y-2.5 w-full max-w-full">
          {filteredLogs.length === 0 ? (
            <div className="surface-z1 border-standard radius-card p-6 text-center text-role-muted text-xs">
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
                    className={`surface-z1 border radius-card p-3 sm:p-3.5 space-y-2.5 shadow-subtle transition ${
                      isToday 
                        ? 'border-rose-subtle bg-rose-subtle' 
                        : 'border-standard'
                    }`}
                  >
                    {/* Top row: Date & Score & Status */}
                    <div className="flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                      <button
                        onClick={() => onSelectDate(l.date)}
                        className="flex items-center gap-1.5 font-bold text-xs text-role-primary hover:text-amber cursor-pointer text-right transition shrink-0"
                      >
                        <Calendar className="w-3.5 h-3.5 text-role-muted shrink-0" />
                        <span className="whitespace-nowrap sm:hidden">{formatPersianDate(l.date, { short: true })}</span>
                        <span className="whitespace-nowrap hidden sm:inline">{formatPersianDate(l.date, { withWeekday: true })}</span>
                        {isToday && (
                          <span className="bg-rose-subtle text-rose text-[10px] px-1.5 py-0.5 radius-badge font-bold whitespace-nowrap">
                            امروز
                          </span>
                        )}
                      </button>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <span className={`font-bold text-[11px] font-mono surface-z0 px-2 py-0.5 radius-control border-standard shrink-0 whitespace-nowrap ${
                          computed.score === 10
                            ? 'text-amber font-black'
                            : computed.isStandard
                            ? 'text-emerald font-bold'
                            : computed.statusType === 'personal_frozen'
                            ? 'text-blue'
                            : 'text-role-secondary'
                        }`}>
                          {toPersianDigits(computed.score)} / ۱۰
                        </span>

                        <span className={`h-6 px-2 radius-control text-[10px] font-bold border inline-flex items-center gap-1 shadow-subtle select-none pointer-events-none cursor-default shrink-0 whitespace-nowrap ${
                          computed.statusType === 'standard'
                            ? 'bg-emerald-subtle border-emerald-subtle text-emerald'
                            : computed.statusType === 'personal_frozen'
                            ? 'bg-blue-subtle border-blue-subtle text-blue'
                            : computed.statusType === 'burned_resolved'
                            ? 'surface-z2 border-standard text-role-secondary'
                            : 'bg-debt-subtle border-debt-subtle text-debt animate-pulse'
                        }`}>
                          {computed.statusType === 'standard' && <CheckCircle2 className="w-3 h-3" />}
                          {computed.statusType === 'personal_frozen' && <Snowflake className="w-3 h-3" />}
                          {computed.statusType === 'burned_resolved' && <FileBadge className="w-3 h-3 text-role-muted" />}
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
                    <div className="surface-z0 p-2 radius-component border-standard flex items-center justify-between flex-wrap gap-2">
                      <span className="text-[10px] text-role-secondary font-bold">۵ پایه و ماموریت:</span>
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
                            className={`w-5 h-5 radius-control flex items-center justify-center text-[9px] font-bold ${
                              h.done
                                ? 'bg-emerald-subtle text-emerald border border-emerald-subtle'
                                : 'surface-z2 text-role-muted border-standard'
                            }`}
                            title={`${h.title}: ${h.done ? 'انجام شد' : 'انجام نشد'}`}
                          >
                            {h.done ? '✓' : '×'}
                          </div>
                        ))}

                        <span className="w-[1px] h-3.5 surface-z3 mx-0.5"></span>

                        <div
                          className={`w-6 h-5 radius-control flex items-center justify-center text-[9px] font-bold ${
                            l.specialMission
                              ? 'bg-amber-subtle text-amber border border-amber-subtle shadow-subtle'
                              : 'surface-z2 text-role-muted border-standard'
                          }`}
                          title={`ماموریت ویژه: ${l.specialMission ? 'انجام شد (+۲ امتیاز)' : 'انجام نشد'}`}
                        >
                          {l.specialMission ? <Check className="w-3 h-3 text-amber stroke-[2.5]" /> : '×'}
                        </div>
                      </div>
                    </div>

                    {/* Failure / Autopsy details (Strict Ghost Elements Cleanse) */}
                    {((l.failureReason && l.failureReason.trim() !== '') || (l.countermeasure && l.countermeasure.trim() !== '') || (l.autopsyNotes && l.autopsyNotes.trim() !== '')) && (
                      <div className="surface-z0 p-2 radius-component border-standard space-y-1 text-[11px]">
                        {l.failureReason && l.failureReason.trim() !== '' && (
                          <div className="text-debt">
                            <span className="font-bold text-role-secondary">ریشه شکست: </span>
                            <span>{l.failureReason.trim()}</span>
                            {l.failureTime && l.failureTime.trim() !== '' && (
                              <span className="text-role-muted mr-1">({toPersianDigits(l.failureTime.trim())})</span>
                            )}
                          </div>
                        )}
                        {((l.countermeasure && l.countermeasure.trim() !== '') || (l.autopsyNotes && l.autopsyNotes.trim() !== '')) && (
                          <div className="text-role-primary">
                            <span className="font-bold text-role-secondary">پادزهر: </span>
                            <span>{(l.countermeasure && l.countermeasure.trim() !== '') ? l.countermeasure.trim() : l.autopsyNotes?.trim()}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex items-center justify-start gap-1.5 pt-0.5 flex-wrap">
                      <button
                        onClick={() => onSelectDate(l.date)}
                        className="surface-z2 hover:surface-z3 text-role-secondary text-xs px-2.5 py-1 radius-control border-standard flex items-center gap-1 cursor-pointer active:scale-95 whitespace-nowrap transition"
                      >
                        <span>میدان نبرد</span>
                        <ChevronLeft className="w-3 h-3" />
                      </button>

                      {(computed.needsAutopsy || l.failureReason) && (
                        <button
                          onClick={() => onOpenAutopsy(l)}
                          className="btn-contract-secondary text-xs font-bold px-2.5 py-1 radius-control whitespace-nowrap"
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
                  className="w-full py-3.5 px-4 radius-card surface-z1 hover:surface-z2 border border-amber-subtle hover:border-amber text-amber font-bold text-xs flex items-center justify-center gap-2 shadow-subtle cursor-pointer active:scale-[0.98] transition"
                >
                  <span>نمایش کامل سوابق ({toPersianDigits(filteredLogs.length - 7)} روز دیگر)</span>
                  <ChevronDown className="w-4 h-4 text-amber" />
                </button>
              )}

              {showAllLogs && !search.trim() && statusFilter === 'all' && filteredLogs.length > 7 && (
                <button
                  type="button"
                  onClick={() => {
                    soundFX.playCheck();
                    setShowAllLogs(false);
                  }}
                  className="w-full py-2.5 px-4 radius-card surface-z0 hover:surface-z1 border-standard text-role-secondary hover:text-role-primary font-medium text-xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition"
                >
                  <span>بستن و نمایش ۷ روز اخیر</span>
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
              )}
            </>
          )}
        </div>

        {/* 2. Desktop Table View (>= md) */}
        <div className="hidden md:block surface-z1 border-standard radius-modal overflow-hidden shadow-subtle">
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="surface-z0 border-b border-standard text-role-secondary font-semibold select-none">
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
              <tbody className="divide-y divide-standard text-role-primary">
                {filteredLogs.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-role-muted">
                      هیچ رکوردی مطابق جستجو و فیلتر جاری یافت نشد.
                    </td>
                  </tr>
                ) : (
                  (showAllLogs || search.trim() !== '' || statusFilter !== 'all' ? filteredLogs : filteredLogs.slice(0, 14)).map(l => {
                    const computed = computeDailyProperties(l, logs, logicalToday);
                    const isToday = l.date === logicalToday;

                    return (
                      <tr key={l.id} className={`hover:surface-z2 transition ${isToday ? 'bg-rose-subtle hover:bg-rose-subtle' : ''}`}>
                        <td className="p-3.5 font-mono whitespace-nowrap align-middle text-center">
                          <button
                            onClick={() => onSelectDate(l.date)}
                            className="hover:text-amber font-bold inline-flex items-center justify-center gap-1.5 cursor-pointer text-role-primary mx-auto"
                          >
                            <Calendar className="w-3.5 h-3.5 text-role-muted shrink-0" />
                            <span>{formatPersianDate(l.date, { short: true })}</span>
                            {isToday && (
                              <span className="text-[10px] bg-rose-subtle text-rose px-1.5 py-0.5 radius-badge font-sans">
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
                                className={`w-5 h-5 radius-control flex items-center justify-center text-[10px] font-bold ${
                                  h.done 
                                    ? 'bg-emerald-subtle text-emerald border border-emerald-subtle' 
                                    : 'surface-z2 text-role-muted border-standard'
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
                              className="w-5 h-5 radius-control bg-amber-subtle text-amber border border-amber-subtle inline-flex items-center justify-center font-bold text-[10px] shadow-subtle mx-auto"
                            >
                              ✓
                            </span>
                          ) : (
                            <span 
                              title="ماموریت ویژه: انجام نشد"
                              className="w-5 h-5 radius-control surface-z2 text-role-muted border-standard inline-flex items-center justify-center text-[10px] font-bold mx-auto"
                            >
                              ×
                            </span>
                          )}
                        </td>

                        {/* Score Column */}
                        <td className={`p-3.5 whitespace-nowrap font-mono align-middle text-center ${
                          computed.score === 10
                            ? 'text-amber font-black'
                            : computed.isStandard
                            ? 'text-emerald font-bold'
                            : computed.statusType === 'personal_frozen'
                            ? 'text-blue font-medium'
                            : 'text-role-secondary font-medium'
                        }`}>
                          {toPersianDigits(computed.score)} / ۱۰
                        </td>

                        {/* Status Badge */}
                        <td className="p-3.5 whitespace-nowrap align-middle text-center">
                          <div className="flex items-center justify-center">
                            <span className={`w-28 h-7 justify-center px-2 py-0.5 radius-control text-[11px] font-bold border inline-flex items-center gap-1.5 shadow-subtle text-center select-none pointer-events-none cursor-default ${
                              computed.statusType === 'standard'
                                ? 'bg-emerald-subtle border-emerald-subtle text-emerald'
                                : computed.statusType === 'personal_frozen'
                                ? 'bg-blue-subtle border-blue-subtle text-blue'
                                : computed.statusType === 'burned_resolved'
                                ? 'surface-z2 border-standard text-role-secondary'
                                : 'bg-debt-subtle border-debt-subtle text-debt animate-pulse'
                            }`}>
                              {computed.statusType === 'standard' && <CheckCircle2 className="w-3.5 h-3.5" />}
                              {computed.statusType === 'personal_frozen' && <Snowflake className="w-3.5 h-3.5" />}
                              {computed.statusType === 'burned_resolved' && <FileBadge className="w-3.5 h-3.5 text-role-muted" />}
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
                        <td className="p-3.5 text-xs text-role-secondary align-middle text-right max-w-[240px]">
                          {l.failureReason && l.failureReason.trim() !== '' ? (
                            <div className="space-y-1 surface-z0 p-2 radius-component border-standard">
                              <p className="font-semibold text-role-primary leading-snug break-words">
                                {l.failureReason.trim()}
                              </p>
                              {l.failureTime && l.failureTime.trim() !== '' && (
                                <div className="inline-flex items-center gap-1 text-[10px] surface-z1 px-2 py-0.5 radius-badge border-standard text-role-muted font-mono">
                                  <Clock className="w-3 h-3 text-role-muted" />
                                  <span>زمان: {toPersianDigits(l.failureTime.trim())}</span>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span className="text-role-muted block text-right select-none">—</span>
                          )}
                        </td>

                        {/* Countermeasure / Strategy */}
                        <td className="p-3.5 text-xs text-role-secondary align-middle text-right max-w-[240px]">
                          {(l.countermeasure && l.countermeasure.trim() !== '') || (l.autopsyNotes && l.autopsyNotes.trim() !== '') ? (
                            <p className="leading-snug text-role-secondary break-words line-clamp-3 hover:line-clamp-none transition-all">
                              {(l.countermeasure && l.countermeasure.trim() !== '') ? l.countermeasure.trim() : l.autopsyNotes?.trim()}
                            </p>
                          ) : (
                            <span className="text-role-muted block text-right select-none">—</span>
                          )}
                        </td>

                        {/* Action Button */}
                        <td className="p-3.5 whitespace-nowrap text-center align-middle">
                          <button
                            onClick={() => onOpenAutopsy(l)}
                            className="btn-contract-secondary text-xs font-bold px-2.5 py-1 radius-control whitespace-nowrap"
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
            <div className="p-3 surface-z0 border-t border-standard text-center">
              <button
                type="button"
                onClick={() => {
                  soundFX.playCheck();
                  setShowAllLogs(true);
                }}
                className="py-2 px-4 radius-component surface-z1 hover:surface-z2 border border-amber-subtle text-amber font-bold text-xs inline-flex items-center gap-2 cursor-pointer active:scale-[0.98] transition"
              >
                <span>نمایش کامل همه سوابق جدول ({toPersianDigits(filteredLogs.length)} روز)</span>
                <ChevronDown className="w-3.5 h-3.5 text-amber" />
              </button>
            </div>
          )}

          {showAllLogs && !search.trim() && statusFilter === 'all' && filteredLogs.length > 14 && (
            <div className="p-2.5 surface-z0 border-t border-standard text-center">
              <button
                type="button"
                onClick={() => {
                  soundFX.playCheck();
                  setShowAllLogs(false);
                }}
                className="py-1.5 px-3 radius-component surface-z1 hover:surface-z2 border-standard text-role-secondary text-xs inline-flex items-center gap-1 cursor-pointer active:scale-[0.98] transition"
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
        <div className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-sm flex items-center justify-center p-4">
          <div className="surface-z1 border-standard radius-modal w-full max-w-lg p-5 sm:p-6 space-y-4 shadow-subtle animate-in zoom-in-95 duration-150">
            <h3 className="font-bold text-base sm:text-lg text-role-primary flex items-center gap-2">
              <Layers className="w-5 h-5 text-role-secondary" />
              <span>تعریف چرخه ۹۰ روزه جدید</span>
            </h3>

            {modalOverlapError && (
              <div className="bg-debt-subtle border border-debt-subtle text-debt radius-component p-3 text-xs font-medium flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 text-debt shrink-0 mt-0.5" />
                <span className="leading-relaxed">{modalOverlapError}</span>
              </div>
            )}

            <form onSubmit={handleCreateCycleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs text-role-secondary block mb-1">عنوان چرخه:</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  required
                  className="w-full surface-z0 border-standard radius-component p-2.5 text-xs text-role-primary focus:outline-none focus:border-amber transition"
                />
              </div>

              <div>
                <label className="text-xs text-role-secondary block mb-1">تاریخ شروع (YYYY-MM-DD):</label>
                <input
                  type="date"
                  value={newStartDate}
                  onChange={e => setNewStartDate(e.target.value)}
                  required
                  className="w-full surface-z0 border-standard radius-component p-2.5 text-xs text-role-primary font-mono focus:outline-none focus:border-amber transition"
                />
              </div>

              <div>
                <label className="text-xs text-role-secondary block mb-1">میثاق و تم اصلی چرخه:</label>
                <textarea
                  value={newTheme}
                  onChange={e => setNewTheme(e.target.value)}
                  rows={2}
                  className="w-full surface-z0 border-standard radius-component p-2.5 text-xs text-role-primary focus:outline-none focus:border-amber transition resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-standard">
                <button
                  type="button"
                  onClick={() => setShowNewCycleModal(false)}
                  className="btn-contract-secondary px-4 py-2 radius-component text-xs font-bold"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="btn-contract-mastery px-5 py-2 radius-component text-xs font-black shadow-subtle"
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
        <div className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-sm flex items-center justify-center p-4">
          <div className="surface-z1 border-standard radius-modal w-full max-w-md p-5 sm:p-6 space-y-4 shadow-subtle animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 radius-card surface-z2 border-standard flex items-center justify-center text-role-secondary shrink-0">
                <Archive className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-role-primary">
                  تأیید بایگانی نهایی چرخه
                </h3>
                <p className="text-xs text-role-muted mt-0.5">
                  قفل سوابق تاریخی در بایگانی بوشیدو
                </p>
              </div>
            </div>

            <p className="text-xs text-role-secondary leading-relaxed surface-z0 border-standard radius-card p-3.5">
              آیا از انتقال چرخه <strong className="text-amber">«{currentCycle.title}»</strong> به بایگانی رسمی اطمینان دارید؟
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowArchiveConfirmModal(false)}
                className="btn-contract-secondary px-3.5 py-2 radius-component text-xs font-bold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmArchive}
                className="btn-contract-primary font-bold px-4 py-2 radius-component text-xs flex items-center gap-1.5 shadow-subtle"
              >
                <Archive className="w-3.5 h-3.5 text-role-muted" />
                <span>تأیید بایگانی</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Unarchive Cycle Confirmation Modal */}
      {showUnarchiveConfirmModal && (
        <div className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-sm flex items-center justify-center p-4">
          <div className="surface-z1 border-standard radius-modal w-full max-w-md p-5 sm:p-6 space-y-4 shadow-subtle animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 radius-card surface-z2 border-standard flex items-center justify-center text-role-secondary shrink-0">
                <Unlock className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-role-primary">
                  خروج چرخه از بایگانی
                </h3>
                <p className="text-xs text-role-muted mt-0.5">
                  بازگرداندن به حالت فعال
                </p>
              </div>
            </div>

            <p className="text-xs text-role-secondary leading-relaxed surface-z0 border-standard radius-card p-3.5">
              آیا مایلید چرخه <strong className="text-amber">«{currentCycle.title}»</strong> را از حالت بایگانی خارج کنید تا بتوانید مجدداً روزها را ثبت یا ویرایش نمایید؟
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowUnarchiveConfirmModal(false)}
                className="btn-contract-secondary px-3.5 py-2 radius-component text-xs font-bold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmUnarchive}
                className="btn-contract-primary font-bold px-4 py-2 radius-component text-xs flex items-center gap-1.5 shadow-subtle"
              >
                <Unlock className="w-3.5 h-3.5 text-role-muted" />
                <span>تأیید خروج</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Cycle Confirmation Modal */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-sm flex items-center justify-center p-4">
          <div className="surface-z1 border border-debt-subtle radius-modal w-full max-w-md p-5 sm:p-6 space-y-4 shadow-subtle animate-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 radius-card bg-debt-subtle border border-debt-subtle flex items-center justify-center text-debt shrink-0">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="font-bold text-sm sm:text-base text-role-primary">
                  تأیید حذف دائمی چرخه
                </h3>
                <p className="text-xs text-debt mt-0.5">
                  غیرقابل بازگشت
                </p>
              </div>
            </div>

            <p className="text-xs text-role-secondary leading-relaxed surface-z0 border-standard radius-card p-3.5">
              آیا از حذف کامل <strong className="text-amber">«{currentCycle.title}»</strong> و تمام لاگ‌ها و سوابق آن اطمینان دارید؟
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowDeleteConfirmModal(false)}
                className="btn-contract-secondary px-3.5 py-2 radius-component text-xs font-bold"
              >
                انصراف
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                className="btn-contract-danger font-bold px-4 py-2 radius-component text-xs flex items-center gap-1.5 shadow-subtle focus-ring-tactical"
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
