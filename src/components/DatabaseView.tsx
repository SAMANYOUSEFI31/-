import React, { useState } from 'react';
import { DailyLog, Cycle, CycleMetrics, SystemSettings, UserProfile } from '../types';
import { computeDailyProperties, FOUNDATION_HABITS } from '../engine/bushidoCalculations';
import { formatPersianDate, getLogicalTodayDate } from '../utils/dateUtils';
import { toPersianDigits } from '../utils/numberUtils';
import { soundFX } from '../utils/audioEffects';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { 
  Database, 
  Search, 
  Filter, 
  Download, 
  Upload, 
  RotateCcw, 
  Check, 
  X, 
  AlertTriangle, 
  Snowflake, 
  CheckCircle2, 
  Calendar,
  Layers,
  Sparkles,
  Flame,
  Plus,
  Crown,
  CreditCard,
  ShieldCheck,
  ToggleLeft,
  ToggleRight
} from 'lucide-react';

interface DatabaseViewProps {
  cycles: Cycle[];
  currentCycle: Cycle;
  logs: DailyLog[];
  settings: SystemSettings;
  metrics: CycleMetrics;
  userProfile: UserProfile;
  onUpdateUserProfile: (p: UserProfile) => void;
  onOpenPaymentModal: () => void;
  onSelectDate: (date: string) => void;
  onOpenAutopsy: (log: DailyLog) => void;
  onResetData: () => void;
  onImportData: (dataStr: string) => void;
  onCreateNewCycle: (title: string, startDate: string, targetTheme: string) => void;
}

export const DatabaseView: React.FC<DatabaseViewProps> = ({
  cycles,
  currentCycle,
  logs,
  settings,
  metrics,
  userProfile,
  onUpdateUserProfile,
  onOpenPaymentModal,
  onSelectDate,
  onOpenAutopsy,
  onResetData,
  onImportData,
  onCreateNewCycle
}) => {
  const logicalToday = getLogicalTodayDate();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showNewCycleModal, setShowNewCycleModal] = useState(false);
  const [newTitle, setNewTitle] = useState('چرخه ۲ — ارتقای تمرکز عمیق');
  const [newStartDate, setNewStartDate] = useState(logicalToday);
  const [newTheme, setNewTheme] = useState('۱۵۰ ساعت کار عمیق و حفظ ثبات مطلق');

  useBodyScrollLock(showNewCycleModal);

  const filteredLogs = logs
    .filter(l => l.cycleId === currentCycle.id || (l.date >= currentCycle.startDate && l.date <= currentCycle.endDate))
    .filter(l => {
      const computed = computeDailyProperties(l, logs, logicalToday);
      if (statusFilter !== 'all' && computed.statusType !== statusFilter) return false;
      if (!search) return true;
      return (
        l.date.includes(search) ||
        (l.failureReason && l.failureReason.includes(search)) ||
        (l.notes && l.notes.includes(search)) ||
        (l.countermeasure && l.countermeasure.includes(search))
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const handleExportJSON = () => {
    const data = {
      cycles,
      logs,
      settings,
      userProfile,
      exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bushido-discipline-backup-${logicalToday}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFileImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = evt => {
      const content = evt.target?.result as string;
      if (content) {
        onImportData(content);
      }
    };
    reader.readAsText(file);
  };

  const handleCreateCycleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newStartDate) return;
    onCreateNewCycle(newTitle, newStartDate, newTheme);
    setShowNewCycleModal(false);
  };

  const toggleVipTier = () => {
    const updated: UserProfile = {
      ...userProfile,
      tier: userProfile.isVip ? 'free' : 'vip_samurai',
      isVip: !userProfile.isVip,
      vipExpiresAt: !userProfile.isVip ? new Date(Date.now() + 90 * 86400000).toISOString() : undefined
    };
    onUpdateUserProfile(updated);
    soundFX.playCheck();
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto" dir="rtl">
      {/* 1. Header & Subscription Status Banner */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Database Info */}
        <div className="md:col-span-2 bg-zinc-900 border border-zinc-800 rounded-3xl p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-amber-400" />
              <h2 className="text-lg sm:text-xl font-bold text-zinc-100">
                موتور دیتابیس رابطه‌ای و پشتیبان‌گیری
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              مشاهده کامل فیلدهای ساختاری، لاگ‌های خرد روزانه و خروجی دیتابیس بدون نیاز به اینترنت
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-4">
            <button
              onClick={() => setShowNewCycleModal(true)}
              className="bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold px-3.5 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              تعریف چرخه ۹۰ روزه جدید
            </button>

            <button
              onClick={handleExportJSON}
              className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer border border-zinc-700"
              title="خروجی پشتیبان JSON"
            >
              <Download className="w-3.5 h-3.5" />
              خروجی JSON
            </button>

            <label className="bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer border border-zinc-700">
              <Upload className="w-3.5 h-3.5" />
              بازیابی فایل
              <input type="file" accept=".json" onChange={handleFileImport} className="hidden" />
            </label>

            <button
              onClick={onResetData}
              className="bg-red-950/40 hover:bg-red-900/60 text-red-300 text-xs font-semibold px-3 py-2 rounded-xl flex items-center gap-1.5 transition cursor-pointer border border-red-800/40"
              title="بازنشانی به داده‌های نمونه پیش‌فرض"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              بازنشانی داده‌ها
            </button>
          </div>
        </div>

        {/* Subscription & VIP Status Card */}
        <div className={`rounded-3xl p-6 border flex flex-col justify-between ${
          userProfile.isVip 
            ? 'bg-gradient-to-br from-amber-950/40 to-zinc-900 border-amber-500/40 shadow-xl shadow-amber-950/30' 
            : 'bg-zinc-900 border-zinc-800'
        }`}>
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Crown className={`w-5 h-5 ${userProfile.isVip ? 'text-amber-400' : 'text-zinc-500'}`} />
                <span className="font-bold text-sm text-zinc-100">وضعیت عضویت:</span>
              </div>
              <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full font-mono ${
                userProfile.isVip 
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                  : 'bg-zinc-800 text-zinc-400'
              }`}>
                {userProfile.isVip ? 'VIP SAMURAI' : 'FREE TIER'}
              </span>
            </div>

            <div className="space-y-1">
              <div className="font-black text-base text-zinc-100">
                {userProfile.isVip ? 'سامورایی ویژه (VIP)' : 'کاربر پایه (رزمنده رایگان)'}
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">
                {userProfile.isVip 
                  ? 'دسترسی کامل به چرخه‌های نامحدود، کالبدشکافی عمیق و احکام رسمی دیوان' 
                  : 'امکان ارتقا به حساب سامورایی ویژه با درگاه پرداخت شبیه‌ساز'}
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-zinc-800/80 flex items-center justify-between gap-2">
            {!userProfile.isVip ? (
              <button
                onClick={onOpenPaymentModal}
                className="w-full bg-amber-500 hover:bg-amber-400 text-black font-black text-xs py-2 rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/20 transition cursor-pointer"
              >
                <CreditCard className="w-3.5 h-3.5" />
                خرید اشتراک سامورایی
              </button>
            ) : (
              <div className="text-[11px] text-emerald-400 font-mono flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>اشتراک فعال است (RefID: {userProfile.paymentRefId || 'FREE-TRIAL'})</span>
              </div>
            )}

            {/* Quick Test Switch */}
            <button
              onClick={toggleVipTier}
              className="text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-950 px-2 py-1.5 rounded-lg border border-zinc-800 shrink-0 cursor-pointer"
              title="تغییر وضعیت آزمایشی اشتراک"
            >
              تست وضعیت
            </button>
          </div>
        </div>
      </div>

      {/* 2. Search & Filter Bar */}
      <div className="bg-[#121215]/70 border border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-zinc-400 absolute right-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="جستجو در تاریخ، دلایل شکست، پادزهر..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pr-9 pl-3 py-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-amber-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto pb-1 sm:pb-0">
          <span className="text-xs text-zinc-400 whitespace-nowrap flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> فیلتر وضعیت:
          </span>
          {[
            { id: 'all', label: 'همه' },
            { id: 'standard', label: '🟢 Standard' },
            { id: 'personal_frozen', label: '❄️ فریز' },
            { id: 'burned_unresolved', label: '⚠️ بدهی باز' },
            { id: 'burned_resolved', label: '🔴 کالبدشکافی شده' }
          ].map(f => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`text-xs px-3 py-1.5 rounded-xl border whitespace-nowrap transition cursor-pointer ${
                statusFilter === f.id
                  ? 'bg-amber-500/20 border-amber-500 text-amber-300 font-bold'
                  : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* 3. The Comprehensive Relational Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-right text-xs">
            <thead className="bg-zinc-950 border-b border-zinc-800 text-zinc-400 font-semibold select-none">
              <tr>
                <th className="p-3.5 whitespace-nowrap">تاریخ روز</th>
                <th className="p-3.5 whitespace-nowrap">۵ پایه تعهد</th>
                <th className="p-3.5 whitespace-nowrap">ویژه</th>
                <th className="p-3.5 whitespace-nowrap">روز Standard</th>
                <th className="p-3.5 whitespace-nowrap">امتیاز روز</th>
                <th className="p-3.5 whitespace-nowrap">وضعیت نهایی روز</th>
                <th className="p-3.5 whitespace-nowrap">دلیل و زمان شکست</th>
                <th className="p-3.5 whitespace-nowrap">قانون مقابله / پادزهر</th>
                <th className="p-3.5 whitespace-nowrap text-center">اقدام</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 text-zinc-200">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="p-8 text-center text-zinc-500">
                    هیچ رکوردی مطابق فیلتر یافت نشد.
                  </td>
                </tr>
              ) : (
                filteredLogs.map(l => {
                  const computed = computeDailyProperties(l, logs, logicalToday);
                  const isToday = l.date === logicalToday;

                  return (
                    <tr key={l.id} className={`hover:bg-zinc-800/40 transition ${isToday ? 'bg-amber-500/5' : ''}`}>
                      <td className="p-3.5 font-mono whitespace-nowrap">
                        <button
                          onClick={() => onSelectDate(l.date)}
                          className="hover:text-amber-400 font-bold flex items-center gap-1.5 cursor-pointer"
                        >
                          <Calendar className="w-3.5 h-3.5 text-zinc-500" />
                          <span>{formatPersianDate(l.date, { short: true })}</span>
                          {isToday && (
                            <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-sans">
                              امروز
                            </span>
                          )}
                        </button>
                      </td>

                      {/* 5 Habits Badges */}
                      <td className="p-3.5 whitespace-nowrap">
                        <div className="flex items-center gap-1">
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
                                h.done ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-zinc-800 text-zinc-600 border border-zinc-700'
                              }`}
                            >
                              {h.done ? '✓' : '×'}
                            </span>
                          ))}
                        </div>
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        {l.specialMission ? (
                          <span className="text-amber-400 font-bold bg-amber-950/60 border border-amber-800/60 px-1.5 py-0.5 rounded text-[11px]">
                            +۲
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        {computed.isStandard ? (
                          <span className="text-emerald-400 font-bold flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>استاندارد</span>
                          </span>
                        ) : (
                          <span className="text-zinc-500">غیراستاندارد</span>
                        )}
                      </td>

                      <td className="p-3.5 whitespace-nowrap font-mono font-bold text-amber-400">
                        {toPersianDigits(computed.score)} / ۱۰
                      </td>

                      <td className="p-3.5 whitespace-nowrap">
                        <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border flex items-center gap-1 w-fit ${
                          computed.statusType === 'standard'
                            ? 'bg-emerald-950/70 border-emerald-500/40 text-emerald-300'
                            : computed.statusType === 'personal_frozen'
                            ? 'bg-blue-950/70 border-blue-500/40 text-blue-300'
                            : computed.statusType === 'burned_resolved'
                            ? 'bg-purple-950/70 border-purple-500/40 text-purple-300'
                            : 'bg-red-950/70 border-red-500/40 text-red-300 animate-pulse'
                        }`}>
                          {computed.statusType === 'standard' && '🟢 تعهد کامل'}
                          {computed.statusType === 'personal_frozen' && '❄️ فریز'}
                          {computed.statusType === 'burned_resolved' && '🔴 حل‌شده'}
                          {computed.statusType === 'burned_unresolved' && '⚠️ بدهی باز'}
                        </span>
                      </td>

                      <td className="p-3.5 text-xs text-zinc-300 max-w-[180px] truncate">
                        {l.failureReason ? (
                          <span>
                            {l.failureReason} <span className="text-zinc-500 font-mono">({l.failureTime || '—'})</span>
                          </span>
                        ) : (
                          <span className="text-zinc-600">—</span>
                        )}
                      </td>

                      <td className="p-3.5 text-xs text-zinc-300 max-w-[200px] truncate">
                        {l.countermeasure || l.autopsyNotes || <span className="text-zinc-600">—</span>}
                      </td>

                      <td className="p-3.5 whitespace-nowrap text-center">
                        <button
                          onClick={() => onOpenAutopsy(l)}
                          className="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-2.5 py-1 rounded-lg border border-zinc-700 transition cursor-pointer"
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
      </div>

      {/* New Cycle Creation Modal */}
      {showNewCycleModal && (
        <div className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] overscroll-contain overflow-y-auto max-h-[100dvh]">
          <div className="bg-[#1c1c21] border border-zinc-800 rounded-3xl w-full max-w-lg p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 duration-150 my-auto">
            <h3 className="font-bold text-base sm:text-lg text-zinc-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-zinc-300" />
              <span>تعریف چرخه ۹۰ روزه جدید</span>
            </h3>

            <form onSubmit={handleCreateCycleSubmit} className="space-y-3.5">
              <div>
                <label className="text-xs text-zinc-300 block mb-1">عنوان چرخه:</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  required
                  className="w-full bg-[#18181b] border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-500/60 transition"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-300 block mb-1">تاریخ شروع (YYYY-MM-DD):</label>
                <input
                  type="date"
                  value={newStartDate}
                  onChange={e => setNewStartDate(e.target.value)}
                  required
                  className="w-full bg-[#18181b] border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 font-mono focus:outline-none focus:border-amber-500/60 transition"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-300 block mb-1">تمرکز استراتژیک دوره:</label>
                <input
                  type="text"
                  value={newTheme}
                  onChange={e => setNewTheme(e.target.value)}
                  className="w-full bg-[#18181b] border border-zinc-800 rounded-xl p-2.5 text-xs text-zinc-100 focus:outline-none focus:border-amber-500/60 transition"
                />
              </div>

              <div className="pt-3 flex items-center justify-end gap-2 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setShowNewCycleModal(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer"
                >
                  انصراف
                </button>
                <button
                  type="submit"
                  className="bg-amber-500 hover:bg-amber-400 text-black font-black text-xs px-5 py-2 rounded-xl flex items-center gap-1.5 shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-95"
                >
                  <Layers className="w-4 h-4" />
                  <span>ایجاد چرخه نبرد</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
