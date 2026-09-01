import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, SystemSettings, HabitKey } from '../types';
import { toPersianDigits } from '../utils/numberUtils';
import { formatPersianDate, daysBetween } from '../utils/dateUtils';
import { BUSHIDO_CRIMSON_THEME } from '../utils/themeUtils';
import { soundFX } from '../utils/audioEffects';
import { ResponsiveSubTabBar, SubTabItem } from './ResponsiveSubTabBar';
import { BUSHIDO_HABITS_PHILOSOPHY, SUPPORT_CONTACT_CHANNELS } from '../data/moreTabData';
import { 
  User, 
  Crown, 
  ShieldCheck, 
  Download, 
  Upload, 
  RotateCcw, 
  Check, 
  LogIn, 
  LogOut, 
  Moon, 
  Database, 
  AlertTriangle, 
  CheckCircle2, 
  Menu, 
  Settings,
  Sliders,
  Sun, 
  Dumbbell, 
  BookOpen, 
  PenTool, 
  Briefcase, 
  Send, 
  Radio, 
  Mail, 
  Headphones, 
  Info, 
  ExternalLink, 
  BookMarked,
  Clock,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface ProfileSettingsViewProps {
  userProfile: UserProfile;
  settings: SystemSettings;
  onUpdateUserProfile: (updated: UserProfile) => void;
  onUpdateSettings: (updated: SystemSettings) => void;
  onOpenPaymentModal: () => void;
  onOpenAuthModal: () => void;
  onQuickLogin?: (role: 'admin' | 'test_user') => void;
  onLogout: () => void;
  onResetData: () => void;
  onImportData: (jsonStr: string) => void;
  onExportData: () => void;
  onNavigateToAdmin: () => void;
}

type SettingsSection = 'account' | 'settings' | 'habits' | 'support';

const HABIT_ICONS_MAP: Record<HabitKey, React.ReactNode> = {
  wakeUp: <Sun className="w-5 h-5" />,
  workout: <Dumbbell className="w-5 h-5" />,
  study: <BookOpen className="w-5 h-5" />,
  journal: <PenTool className="w-5 h-5" />,
  hardTask: <Briefcase className="w-5 h-5" />
};

export const ProfileSettingsView: React.FC<ProfileSettingsViewProps> = ({
  userProfile,
  settings,
  onUpdateUserProfile,
  onUpdateSettings,
  onOpenPaymentModal,
  onOpenAuthModal,
  onQuickLogin,
  onLogout,
  onResetData,
  onImportData,
  onExportData,
  onNavigateToAdmin
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('account');
  const [navDirection, setNavDirection] = useState<number>(0);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [isConfirmResetOpen, setIsConfirmResetOpen] = useState(false);
  const [expandedHabitKey, setExpandedHabitKey] = useState<HabitKey | null>('wakeUp');

  const fileInputRef = useRef<HTMLInputElement>(null);

  const themeConfig = BUSHIDO_CRIMSON_THEME;
  const currentCutoff = userProfile.nightOwlCutoffHour ?? settings.nightOwlCutoffHour ?? 4;

  const SECTIONS_LIST: SettingsSection[] = ['account', 'settings', 'habits', 'support'];

  const switchSection = (newSec: SettingsSection) => {
    const currIdx = SECTIONS_LIST.indexOf(activeSection);
    const nextIdx = SECTIONS_LIST.indexOf(newSec);
    if (currIdx !== nextIdx) {
      setNavDirection(nextIdx > currIdx ? 1 : -1);
      setActiveSection(newSec);
    }
  };

  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('textarea, input, select, [data-no-swipe], [contenteditable="true"]')) {
      touchStartRef.current = null;
      return;
    }
    const touch = e.touches[0];
    if (touch) {
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;

    const deltaX = touch.clientX - touchStartRef.current.x;
    const deltaY = touch.clientY - touchStartRef.current.y;
    const elapsed = Date.now() - touchStartRef.current.time;
    touchStartRef.current = null;

    const isQuickFlick = elapsed < 280 && Math.abs(deltaX) >= 45;
    const isStandardSwipe = Math.abs(deltaX) >= 65;

    if ((isStandardSwipe || isQuickFlick) && Math.abs(deltaX) > Math.abs(deltaY) * 1.8) {
      const currIdx = SECTIONS_LIST.indexOf(activeSection);
      if (deltaX < 0) {
        if (currIdx < SECTIONS_LIST.length - 1) {
          switchSection(SECTIONS_LIST[currIdx + 1]);
        }
      } else {
        if (currIdx > 0) {
          switchSection(SECTIONS_LIST[currIdx - 1]);
        }
      }
    }
  };

  const showNotice = (msg: string) => {
    setSaveSuccessMsg(msg);
    setTimeout(() => setSaveSuccessMsg(null), 3000);
  };

  const handleSelectCutoffHour = (hour: number) => {
    soundFX.playCheck();
    const updatedProfile = { ...userProfile, nightOwlCutoffHour: hour };
    const updatedSettings = { ...settings, nightOwlCutoffHour: hour };
    onUpdateUserProfile(updatedProfile);
    onUpdateSettings(updatedSettings);
    showNotice(`مهلت پایانی شبانه روی ساعت ${toPersianDigits(hour)}:۰۰ بامداد تنظیم شد.`);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      if (content) {
        onImportData(content);
        showNotice('پایگاه داده بوشیدو با موفقیت بازیابی شد.');
      }
    };
    reader.readAsText(file);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const isLoggedIn = !!userProfile.id && userProfile.id !== 'guest' && !!(userProfile.phoneNumber || userProfile.email);

  let vipDaysRemaining = 0;
  if (userProfile.isVip && userProfile.vipExpiresAt) {
    const todayStr = new Date().toISOString().split('T')[0];
    const expiryStr = userProfile.vipExpiresAt.split('T')[0];
    vipDaysRemaining = Math.max(0, daysBetween(todayStr, expiryStr));
  }

  const cutoffHoursList = [
    { hour: 2, label: 'تا ۲:۰۰ بامداد' },
    { hour: 3, label: 'تا ۳:۰۰ بامداد' },
    { hour: 4, label: 'تا ۴:۰۰ بامداد (پیش‌فرض)' },
    { hour: 5, label: 'تا ۵:۰۰ بامداد' },
    { hour: 6, label: 'تا ۶:۰۰ صبح' }
  ];

  const SECTIONS_CONFIG: SubTabItem<SettingsSection>[] = [
    { id: 'account', label: 'حساب', icon: User },
    { id: 'settings', label: 'تنظیمات', icon: Settings },
    { id: 'habits', label: 'راهنما', icon: BookMarked },
    { id: 'support', label: 'پشتیبانی', icon: Headphones },
  ];

  return (
    <div 
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className="space-y-5 sm:space-y-6 animate-in fade-in duration-200 select-none touch-pan-y w-full max-w-5xl mx-auto" 
      dir="rtl"
    >
      {/* Toast Notice */}
      {saveSuccessMsg && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 border border-emerald-500/50 text-emerald-300 px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs sm:text-sm font-bold animate-in slide-in-from-top-4">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Level 1 Hero Section Header */}
      <div className="w-full max-w-full bg-[#121215] border border-zinc-800 rounded-3xl p-4 sm:p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div 
              className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shadow-md shrink-0 select-none pointer-events-none"
            >
              <Menu className="w-5 h-5 sm:w-6 sm:h-6 text-zinc-200" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-black text-zinc-100">
                مرکز تنظیمات و خدمات سامورایی
              </h1>
              <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                مدیریت حساب، اشتراک VIP، راهنمای عادات، پشتیبانی و پایگاه داده
              </p>
            </div>
          </div>

          {/* User Status Chip */}
          {userProfile.isVip ? (
            <span className="bg-amber-500/15 border border-amber-500/40 text-amber-300 px-3 py-1 rounded-xl text-xs font-black flex items-center gap-1.5 shadow-xs whitespace-nowrap shrink-0">
              <Crown className="w-3.5 h-3.5 text-amber-400" />
              <span>VIP</span>
            </span>
          ) : (
            <span className="bg-zinc-800 border border-zinc-700 text-zinc-400 px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap shrink-0">
              طرح استاندارد
            </span>
          )}
        </div>
      </div>

      {/* Progressive Disclosure: Segmented Categorization Bar */}
      <ResponsiveSubTabBar<SettingsSection>
        tabs={SECTIONS_CONFIG}
        activeTab={activeSection}
        onSelectTab={switchSection}
        layoutId="activeSettingsSectionIndicator"
      />

      {/* Animated Swipeable Sections Container */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={activeSection}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="space-y-4"
        >
          {/* Section 1: Account & VIP Membership */}
          {activeSection === 'account' && (
            <div className="space-y-4">
              <div className="bg-[#121215] border border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0 shadow-inner">
                    <User className="w-5 h-5 text-zinc-200" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-zinc-100">
                      پروفایل و اشتراک سامورایی
                    </h3>
                    <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      مشخصات هویتی و وضعیت فعال بودن قابلیت‌های ویژه
                    </p>
                  </div>
                </div>

                {/* Identity Card */}
                <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-400">نام / شناسه کاربری:</span>
                    <span className="font-bold text-zinc-200">
                      {userProfile.name || 'سامورایی بوشیدو'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800">
                    <span className="text-zinc-400">شماره موبایل / ایمیل:</span>
                    <span className="font-mono text-zinc-300 font-bold" dir="ltr">
                      {userProfile.phoneNumber || userProfile.email || 'حساب کاربری مهمان (لوکال)'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800">
                    <span className="text-zinc-400">سطح دسترسی سامانه:</span>
                    <span className={`font-bold flex items-center gap-1.5 ${
                      userProfile.isVip ? 'text-amber-400' : 'text-zinc-400'
                    }`}>
                      {userProfile.isVip ? (
                        <>
                          <Crown className="w-3.5 h-3.5" />
                          <span>اشتراک سامورایی ویژه (VIP)</span>
                        </>
                      ) : (
                        <span>طرح استاندارد (پایه)</span>
                      )}
                    </span>
                  </div>

                  {userProfile.isVip && (
                    <>
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800">
                        <span className="text-zinc-400">تاریخ انقضای اشتراک:</span>
                        <span className="font-mono text-zinc-300">
                          {userProfile.vipExpiresAt ? formatPersianDate(userProfile.vipExpiresAt.split('T')[0]) : 'نامحدود'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800">
                        <span className="text-zinc-400">اعتبار باقی‌مانده:</span>
                        <span className="font-black text-emerald-400">
                          {toPersianDigits(vipDaysRemaining)} روز
                        </span>
                      </div>
                    </>
                  )}

                  {!userProfile.isVip && (
                    <p className="text-[11px] text-zinc-400 leading-relaxed bg-[#121215] p-3 rounded-xl border border-zinc-800 text-right">
                      با فعال‌سازی اشتراک VIP، امکان ایجاد چرخه‌های نامحدود و دسترسی به تحلیل‌های سنتسی فعال می‌شود.
                    </p>
                  )}
                </div>

                {/* Account Actions & Subscriptions */}
                <div className="pt-4 border-t border-zinc-800 space-y-2.5 relative z-10">
                  {/* VIP CTA */}
                  {userProfile.isVip ? (
                    <button
                      type="button"
                      onClick={onOpenPaymentModal}
                      className="w-full bg-zinc-800 hover:bg-zinc-700 hover:border-amber-500/50 border border-amber-500/30 text-amber-300 font-bold text-xs py-3 rounded-2xl flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98] shadow-md whitespace-nowrap"
                    >
                      <Crown className="w-4 h-4 text-amber-400" />
                      <span>تمدید اشتراک سامورایی ویژه (VIP)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onOpenPaymentModal}
                      className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-black text-xs py-3 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 transition cursor-pointer active:scale-[0.98] whitespace-nowrap"
                    >
                      <Crown className="w-4 h-4" />
                      <span>ارتقا به حساب سامورایی ویژه (VIP)</span>
                    </button>
                  )}

                  {/* Auth Action */}
                  {isLoggedIn ? (
                    <div className="space-y-2 pt-1">
                      {userProfile.isAdmin === true && (
                        <button
                          type="button"
                          onClick={() => {
                            soundFX.playCheck();
                            onNavigateToAdmin();
                          }}
                          className="w-full bg-red-950/50 hover:bg-red-900/70 border border-red-500/50 hover:border-red-500/80 text-red-200 text-xs font-bold py-3 rounded-2xl flex items-center justify-center gap-2 transition cursor-pointer active:scale-[0.98] whitespace-nowrap shadow-sm"
                        >
                          <ShieldCheck className="w-4 h-4 text-red-400" />
                          <span>پنل مدیریت سامانه (/admin)</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          soundFX.playSlash();
                          onLogout();
                        }}
                        className="w-full bg-red-950/20 hover:bg-red-900/40 hover:text-red-300 hover:border-red-500/40 border border-zinc-800 text-zinc-400 text-xs font-bold py-2.5 rounded-2xl flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.98] whitespace-nowrap"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        <span>خروج از حساب کاربری</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <button
                        type="button"
                        onClick={onOpenAuthModal}
                        className="w-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-black py-3 rounded-2xl flex items-center justify-center gap-1.5 transition cursor-pointer active:scale-[0.98] whitespace-nowrap shadow-md shadow-amber-500/20"
                      >
                        <LogIn className="w-4 h-4" />
                        <span>ورود یا ایجاد حساب کاربری</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Section 2: System Settings & Database Vault (Unified Master Card) */}
          {activeSection === 'settings' && (
            <div className="space-y-4">
              <div className="bg-[#121215] border border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-6">
                {/* Master Header */}
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0 shadow-inner">
                    <Settings className="w-5 h-5 text-zinc-200" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-zinc-100">
                      تنظیمات و پیکربندی سامانه
                    </h3>
                    <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      شخصی‌سازی مهلت کات‌آف شبانه، نسخه پشتیبان فایل و نگهداری پایگاه داده
                    </p>
                  </div>
                </div>

                {/* Sub-Card 1: Cutoff Hour Configuration */}
                <div className="bg-[#09090b]/80 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 space-y-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0">
                      <Moon className="w-4 h-4 text-zinc-300" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-zinc-200">
                        مهلت پایانی شبانه (مرز کات‌آف)
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        ثبت عادات تا پیش از این ساعت برای روز قبل محاسبه می‌شود.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-1">
                    {cutoffHoursList.map(item => {
                      const isSelected = currentCutoff === item.hour;
                      return (
                        <button
                          key={item.hour}
                          type="button"
                          onClick={() => handleSelectCutoffHour(item.hour)}
                          className={`px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between border transition cursor-pointer active:scale-[0.98] ${
                            isSelected
                              ? 'bg-zinc-800 border-zinc-600 text-zinc-100 shadow-sm'
                              : 'bg-[#121215] border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                          }`}
                        >
                          <span className="whitespace-nowrap">{item.label}</span>
                          {isSelected && <Check className="w-3.5 h-3.5 text-zinc-200 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Sub-Card 2: Backup & Database Vault */}
                <div className="bg-[#09090b]/80 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 space-y-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 shrink-0">
                      <Database className="w-4 h-4 text-zinc-300" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-zinc-200">
                        پشتیبان‌گیری و بازیابی پایگاه داده
                      </h4>
                      <p className="text-[11px] text-zinc-400 mt-0.5">
                        خروجی استاندارد JSON برای حفظ داده‌ها در حافظه آفلاین
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                    {/* Export JSON Card */}
                    <button
                      type="button"
                      onClick={() => {
                        soundFX.playCheck();
                        onExportData();
                        showNotice('فایل پشتیبان داده‌های بوشیدو ذخیره شد.');
                      }}
                      className="bg-[#121215] hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 text-zinc-200 p-3.5 rounded-xl flex items-start gap-3 text-right transition cursor-pointer active:scale-[0.98] group"
                    >
                      <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 group-hover:text-zinc-100 transition shrink-0">
                        <Download className="w-4 h-4" />
                      </div>
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <span className="font-bold text-xs sm:text-sm text-zinc-100 block">خروجی پشتیبان (JSON)</span>
                        <p className="text-[11px] text-zinc-400 leading-relaxed text-right">
                          دریافت نسخه کامل چرخه‌ها و لاگ‌ها
                        </p>
                      </div>
                    </button>

                    {/* Import JSON Card */}
                    <label className="bg-[#121215] hover:bg-zinc-800/80 border border-zinc-800 hover:border-zinc-700 text-zinc-200 p-3.5 rounded-xl flex items-start gap-3 text-right transition cursor-pointer active:scale-[0.98] group">
                      <div className="w-9 h-9 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-300 group-hover:text-zinc-100 transition shrink-0">
                        <Upload className="w-4 h-4" />
                      </div>
                      <div className="space-y-0.5 min-w-0 flex-1">
                        <span className="font-bold text-xs sm:text-sm text-zinc-100 block">بازیابی نسخه پشتیبان</span>
                        <p className="text-[11px] text-zinc-400 leading-relaxed text-right">
                          بارگذاری فایل JSON و بازیابی
                        </p>
                      </div>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".json"
                        onChange={handleFileChange}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Sub-Card 3: Danger Zone */}
                <div className="bg-red-950/20 border border-red-500/30 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-red-500/15 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                      <AlertTriangle className="w-4.5 h-4.5" />
                    </div>
                    <div className="space-y-0.5 text-right">
                      <h4 className="font-bold text-xs sm:text-sm text-red-200">
                        بازنشانی کل داده‌های سامانه
                      </h4>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        تمام لاگ‌ها و سوابق پاک شده و سامانه به وضعیت اولیه بازمی‌گردد.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setIsConfirmResetOpen(true);
                    }}
                    className="bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 hover:border-red-500/60 text-red-300 font-bold px-3.5 py-2.5 rounded-xl text-xs flex items-center justify-center gap-2 cursor-pointer active:scale-[0.98] transition whitespace-nowrap shrink-0 shadow-sm"
                  >
                    <RotateCcw className="w-4 h-4" />
                    <span>بازنشانی به وضعیت اولیه</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Section 3: Habit Philosophies & Guidelines */}
          {activeSection === 'habits' && (
            <div className="space-y-4">
              <div className="bg-[#121215] border border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0 shadow-inner">
                    <BookMarked className="w-5 h-5 text-zinc-200" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-zinc-100">
                      فلسفه و استانداردهای ۵ پایه انضباطی
                    </h3>
                    <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      راهنمای دقیق منظور سیستم از هر عادت، دام‌های رایج و تاکتیک‌های پیروزی
                    </p>
                  </div>
                </div>

                <div className="bg-[#18181b] p-3.5 rounded-2xl border border-zinc-800 text-xs text-zinc-300 leading-relaxed text-right">
                  ۵ پایه بوشیدو بر اساس روانشناسی رفتار و ایجاد مقاومت ذهنی طراحی شده‌اند. برای مشاهده جزئیات هر عادت، روی آن ضربه بزنید:
                </div>

                {/* Habit Cards Accordion */}
                <div className="space-y-2.5 pt-1">
                  {BUSHIDO_HABITS_PHILOSOPHY.map(item => {
                    const isExpanded = expandedHabitKey === item.key;
                    return (
                      <div
                        key={item.key}
                        className="bg-[#18181b] border border-zinc-800 rounded-2xl overflow-hidden transition"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedHabitKey(isExpanded ? null : item.key);
                          }}
                          className="w-full p-4 flex items-center justify-between gap-3 text-right hover:bg-zinc-800/40 transition cursor-pointer group"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border transition ${
                              isExpanded
                                ? 'bg-zinc-700/60 border-zinc-600 text-white'
                                : 'bg-zinc-800 border-zinc-700 text-zinc-300 group-hover:text-zinc-100'
                            }`}>
                              {HABIT_ICONS_MAP[item.key]}
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs sm:text-sm font-bold text-zinc-100">
                                {item.titleFa}
                              </h4>
                              <p className="text-[11px] text-zinc-400 leading-relaxed">
                                {item.subtitleFa}
                              </p>
                            </div>
                          </div>

                          <div className="shrink-0 text-zinc-500">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 space-y-3 text-xs border-t border-zinc-800/70">
                            <div className="bg-[#121215] p-3 rounded-xl border border-zinc-800/80 space-y-1">
                              <span className="font-bold text-amber-400 text-[11px] block">چرا حیاتی است؟</span>
                              <p className="text-zinc-300 leading-relaxed text-right">{item.whyItMatters}</p>
                            </div>

                            <div className="bg-[#121215] p-3 rounded-xl border border-zinc-800/80 space-y-1">
                              <span className="font-bold text-emerald-400 text-[11px] block">معیار استاندارد اجرا:</span>
                              <p className="text-zinc-300 leading-relaxed text-right">{item.dailyStandard}</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <div className="bg-[#121215] p-3 rounded-xl border border-zinc-800/80 space-y-1">
                                <span className="font-bold text-rose-400 text-[11px] block">دام‌های رایج:</span>
                                <p className="text-zinc-400 leading-relaxed text-right">{item.commonPitfalls}</p>
                              </div>

                              <div className="bg-[#121215] p-3 rounded-xl border border-zinc-800/80 space-y-1">
                                <span className="font-bold text-blue-400 text-[11px] block">تاکتیک و راهکار:</span>
                                <p className="text-zinc-300 leading-relaxed text-right">{item.tacticalAdvice}</p>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Section 4: Support & Contact Channels */}
          {activeSection === 'support' && (
            <div className="space-y-4">
              <div className="bg-[#121215] border border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-xl space-y-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200 shrink-0 shadow-inner">
                    <Headphones className="w-5 h-5 text-zinc-200" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-zinc-100">
                      ارتباط با پشتیبانی و جامعه بوشیدو
                    </h3>
                    <p className="text-[11px] sm:text-xs text-zinc-400 mt-0.5 leading-relaxed">
                      دریافت راهنمایی، گزارش مشکلات یا ارتباط مستقیم با تیم توسعه
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {SUPPORT_CONTACT_CHANNELS.map(ch => (
                    <div
                      key={ch.channel}
                      className="bg-[#18181b] border border-zinc-800 rounded-2xl p-4 flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-2.5">
                        {/* RTL Header: Right=Brand Icon + Title, Left=Channel Badge */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0">
                              {ch.iconName === 'Send' && (
                                <div className="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shadow-xs">
                                  <Send className="w-4 h-4" />
                                </div>
                              )}
                              {ch.iconName === 'Radio' && (
                                <div className="w-8 h-8 rounded-xl bg-rose-500/15 border border-rose-500/30 flex items-center justify-center text-rose-400 shadow-xs">
                                  <Radio className="w-4 h-4" />
                                </div>
                              )}
                              {ch.iconName === 'Mail' && (
                                <div className="w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-xs">
                                  <Mail className="w-4 h-4" />
                                </div>
                              )}
                            </div>
                            <h4 className="text-xs sm:text-sm font-bold text-zinc-100 truncate">
                              {ch.title}
                            </h4>
                          </div>

                          <span className="text-[10px] font-mono text-zinc-400 bg-zinc-800/90 border border-zinc-700/60 px-2 py-0.5 rounded-md shrink-0 select-none pointer-events-none">
                            {ch.channel}
                          </span>
                        </div>

                        <p className="text-[11px] text-zinc-400 leading-relaxed text-right">
                          {ch.description}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-zinc-800 space-y-2">
                        <div className="text-xs font-mono font-bold text-zinc-300 text-left" dir="ltr">
                          {ch.value}
                        </div>
                        {ch.link && (
                          <a
                            href={ch.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 hover:text-white rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer"
                          >
                            <span>{ch.actionLabel}</span>
                            <ExternalLink className="w-3 h-3 text-zinc-400" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="bg-[#18181b] p-4 rounded-2xl border border-zinc-800 flex items-start gap-3">
                  <Info className="w-4 h-4 text-zinc-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-zinc-400 leading-relaxed text-right">
                    زمان پاسخ‌گویی پشتیبانی معمولاً در کمتر از ۲ ساعت کاری است. همچنین می‌توانید با ذخیره خروجی پشتیبان، داده‌های خود را همیشه در امان نگه دارید.
                  </p>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Confirmation Modal for Reset Factory Data */}
      <AnimatePresence>
        {isConfirmResetOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in">
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-[#121215] border-2 border-red-500/50 rounded-3xl p-5 sm:p-6 max-w-md w-full shadow-2xl space-y-4 text-right"
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-black text-white">تایید بازنشانی داده‌ها</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">آیا از پاک‌سازی کامل تمام چرخه‌ها و لاگ‌ها اطمینان دارید؟</p>
                </div>
              </div>

              <p className="text-xs text-zinc-300 bg-red-950/20 border border-red-500/30 p-3 rounded-xl leading-relaxed">
                این عملیات غیرقابل بازگشت است و تمام رکوردهای استریک، عادات ثبت‌شده و احکام دادگاه بوشیدو حذف خواهند شد.
              </p>

              <div className="flex items-center gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    soundFX.playSlash();
                    setIsConfirmResetOpen(false);
                    onResetData();
                    showNotice('داده‌های سامانه به حالت اولیه بازنشانی شد.');
                  }}
                  className="flex-1 bg-red-600 hover:bg-red-500 text-white font-black text-xs py-3 rounded-xl transition cursor-pointer active:scale-95 shadow-md shadow-red-600/30"
                >
                  بله، بازنشانی کامل شود
                </button>
                <button
                  type="button"
                  onClick={() => setIsConfirmResetOpen(false)}
                  className="px-5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold text-xs py-3 rounded-xl transition cursor-pointer active:scale-95"
                >
                  انصراف
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
