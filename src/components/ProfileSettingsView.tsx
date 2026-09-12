import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, SystemSettings, HabitKey } from '../types';
import { toPersianDigits } from '../utils/numberUtils';
import { formatPersianDate, daysBetween } from '../utils/dateUtils';
import { BUSHIDO_CRIMSON_THEME } from '../utils/themeUtils';
import { soundFX } from '../utils/audioEffects';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { ResponsiveSubTabBar, SubTabItem } from './ResponsiveSubTabBar';
import { BUSHIDO_HABITS_PHILOSOPHY, SUPPORT_CONTACT_CHANNELS } from '../data/moreTabData';
import { 
  User, 
  Crown, 
  ShieldCheck, 
  Download, 
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
  onExportData: () => void;
  onNavigateToAdmin: () => void;
}

type SettingsSection = 'account' | 'settings' | 'habits' | 'support';

const HABIT_ICONS_MAP: Record<HabitKey, React.ComponentType<{ className?: string }>> = {
  wakeUp: Sun,
  workout: Dumbbell,
  study: BookOpen,
  journal: PenTool,
  hardTask: Briefcase
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
  onExportData,
  onNavigateToAdmin
}) => {
  const [activeSection, setActiveSection] = useState<SettingsSection>('account');
  const [navDirection, setNavDirection] = useState<number>(0);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const [expandedHabitKey, setExpandedHabitKey] = useState<HabitKey | null>('wakeUp');

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

  const isLoggedIn = !!userProfile.id && userProfile.id !== 'guest' && !!(userProfile.phoneNumber || userProfile.email);

  let vipDaysRemaining = 0;
  if (userProfile.isVip && userProfile.vipExpiresAt) {
    const todayStr = new Date().toISOString().split('T')[0];
    const expiryStr = userProfile.vipExpiresAt.split('T')[0];
    vipDaysRemaining = Math.max(0, daysBetween(todayStr, expiryStr));
  }

  const cutoffHoursList = [
    { hour: 2, label: `تا ${toPersianDigits(2)}:۰۰ بامداد` },
    { hour: 3, label: `تا ${toPersianDigits(3)}:۰۰ بامداد` },
    { hour: 4, label: `تا ${toPersianDigits(4)}:۰۰ بامداد (پیش‌فرض)` },
    { hour: 5, label: `تا ${toPersianDigits(5)}:۰۰ بامداد` },
    { hour: 6, label: `تا ${toPersianDigits(6)}:۰۰ صبح` }
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
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 surface-z1 border border-emerald-subtle text-emerald px-5 py-3 radius-modal shadow-subtle flex items-center gap-2.5 text-xs sm:text-sm font-bold animate-in slide-in-from-top-4">
          <CheckCircle2 className="w-5 h-5 text-emerald shrink-0" />
          <span>{saveSuccessMsg}</span>
        </div>
      )}

      {/* Level 1 Hero Section Header */}
      <div className="w-full max-w-full surface-z1 border-standard radius-modal p-4 sm:p-5 shadow-subtle">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div 
              className="w-11 h-11 sm:w-12 sm:h-12 radius-card surface-z2 flex items-center justify-center text-role-secondary shadow-xs shrink-0 select-none pointer-events-none"
            >
              <Menu className="w-5 h-5 sm:w-6 sm:h-6 text-role-secondary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base sm:text-lg font-black text-role-primary">
                مرکز تنظیمات و خدمات سامورایی
              </h1>
              <p className="text-[11px] sm:text-xs text-role-secondary mt-0.5 leading-relaxed">
                مدیریت حساب، اشتراک VIP، راهنمای عادات، پشتیبانی و پایگاه داده
              </p>
            </div>
          </div>

          {/* User Status Chip */}
          {userProfile.isVip ? (
            <span className="bg-amber-subtle border border-amber-subtle text-amber px-3 py-1 radius-capsule text-xs font-black flex items-center gap-1.5 shadow-xs whitespace-nowrap shrink-0">
              <Crown className="w-3.5 h-3.5 text-amber" />
              <span>VIP</span>
            </span>
          ) : (
            <span className="surface-z2 text-role-muted px-2.5 py-1 radius-capsule text-xs font-bold whitespace-nowrap shrink-0">
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
              <div className="surface-z1 border-standard radius-modal p-5 sm:p-6 shadow-subtle space-y-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 radius-card surface-z2 flex items-center justify-center text-role-secondary shrink-0">
                    <User className="w-5 h-5 text-role-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-role-primary">
                      پروفایل و اشتراک سامورایی
                    </h3>
                    <p className="text-[11px] sm:text-xs text-role-secondary mt-0.5 leading-relaxed">
                      مشخصات هویتی و وضعیت فعال بودن قابلیت‌های ویژه
                    </p>
                  </div>
                </div>

                {/* Identity Card */}
                <div className="surface-z2 border-standard radius-card p-4 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-role-secondary">نام / شناسه کاربری:</span>
                    <span className="font-bold text-role-primary">
                      {userProfile.name || 'سامورایی بوشیدو'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-role-secondary">شماره موبایل / ایمیل:</span>
                    <span className="font-mono text-role-primary font-bold" dir="ltr">
                      {userProfile.phoneNumber || userProfile.email || 'حساب کاربری مهمان (لوکال)'}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-xs">
                    <span className="text-role-secondary">سطح دسترسی سامانه:</span>
                    <span className={`font-bold flex items-center gap-1.5 ${
                      userProfile.isVip ? 'text-amber' : 'text-role-muted'
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
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-role-secondary">تاریخ انقضای اشتراک:</span>
                        <span className="font-mono text-role-primary">
                          {userProfile.vipExpiresAt ? formatPersianDate(userProfile.vipExpiresAt.split('T')[0]) : 'نامحدود'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-role-secondary">اعتبار باقی‌مانده:</span>
                        <span className="font-black text-emerald">
                          {toPersianDigits(vipDaysRemaining)} روز
                        </span>
                      </div>
                    </>
                  )}

                  {!userProfile.isVip && (
                    <p className="text-[11px] text-role-secondary leading-relaxed surface-z3 p-3 radius-component text-right mt-2">
                      با فعال‌سازی اشتراک VIP، امکان ایجاد چرخه‌های نامحدود و دسترسی به تحلیل‌های سنتسی فعال می‌شود.
                    </p>
                  )}
                </div>

                {/* Account Actions & Subscriptions */}
                <div className="pt-2 space-y-2.5 relative z-10">
                  {/* VIP CTA */}
                  {userProfile.isVip ? (
                    <button
                      type="button"
                      onClick={onOpenPaymentModal}
                      className="btn-contract-mastery w-full font-bold text-xs py-3 radius-card flex items-center justify-center gap-2 shadow-subtle whitespace-nowrap focus-ring-tactical"
                    >
                      <Crown className="w-4 h-4 text-canvas-root" />
                      <span>تمدید اشتراک سامورایی ویژه (VIP)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={onOpenPaymentModal}
                      className="btn-contract-mastery w-full font-black text-xs py-3 radius-card flex items-center justify-center gap-2 shadow-subtle whitespace-nowrap focus-ring-tactical"
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
                          className="btn-contract-primary w-full text-xs font-bold py-3 radius-card flex items-center justify-center gap-2 whitespace-nowrap shadow-xs focus-ring-tactical"
                        >
                          <ShieldCheck className="w-4 h-4 text-white" />
                          <span>پنل مدیریت سامانه (/admin)</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          soundFX.playSlash();
                          onLogout();
                        }}
                        className="btn-contract-secondary w-full text-role-muted hover:text-role-primary text-xs font-bold py-2.5 radius-card flex items-center justify-center gap-1.5 whitespace-nowrap focus-ring-tactical"
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
                        className="btn-contract-mastery w-full text-xs font-black py-3 radius-card flex items-center justify-center gap-1.5 whitespace-nowrap shadow-subtle focus-ring-tactical"
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
              <div className="surface-z1 border-standard radius-modal p-5 sm:p-6 shadow-subtle space-y-6">
                {/* Master Header */}
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 radius-card surface-z2 flex items-center justify-center text-role-secondary shrink-0">
                    <Settings className="w-5 h-5 text-role-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-role-primary">
                      تنظیمات و پیکربندی سامانه
                    </h3>
                    <p className="text-[11px] sm:text-xs text-role-secondary mt-0.5 leading-relaxed">
                      شخصی‌سازی مهلت کات‌آف شبانه، خروجی داده‌ها و نگهداری پایگاه داده
                    </p>
                  </div>
                </div>

                {/* Sub-Card 1: Cutoff Hour Configuration */}
                <div className="surface-z2 border-standard radius-card p-4 sm:p-5 space-y-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 radius-component surface-z3 flex items-center justify-center text-role-secondary shrink-0">
                      <Moon className="w-4 h-4 text-role-secondary" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-role-primary">
                        مهلت پایانی شبانه (مرز کات‌آف)
                      </h4>
                      <p className="text-[11px] text-role-secondary mt-0.5">
                        ثبت عادات تا پیش از این ساعت برای روز قبل محاسبه می‌شود.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 pt-1">
                    {cutoffHoursList.map(item => {
                      const isSelected = currentCutoff === item.hour;
                      return (
                        <button
                          key={item.hour}
                          type="button"
                          onClick={() => handleSelectCutoffHour(item.hour)}
                          className={`px-3.5 py-2.5 min-h-[44px] radius-component text-xs font-bold flex items-center justify-between border transition-colors cursor-pointer active:scale-[0.98] ${
                            isSelected
                              ? 'bg-rose-subtle border-rose text-role-primary shadow-xs'
                              : 'surface-z1 hover:surface-z3 border-standard text-role-secondary hover:text-role-primary'
                          }`}
                        >
                          <span className="whitespace-nowrap">{item.label}</span>
                          {isSelected ? (
                            <span className="w-4 h-4 radius-capsule bg-rose flex items-center justify-center text-white shrink-0">
                              <Check className="w-2.5 h-2.5 stroke-[3]" />
                            </span>
                          ) : (
                            <span className="w-4 h-4 radius-capsule border border-standard surface-z3 shrink-0" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Sub-Card 2: Data Export & Backup Vault */}
                <div className="surface-z2 border-standard radius-card p-4 sm:p-5 space-y-3.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 radius-component surface-z3 flex items-center justify-center text-role-secondary shrink-0">
                      <Database className="w-4 h-4 text-role-secondary" />
                    </div>
                    <div>
                      <h4 className="text-xs sm:text-sm font-bold text-role-primary">
                        خروجی و نگهداری داده‌ها
                      </h4>
                      <p className="text-[11px] text-role-secondary mt-0.5">
                        دریافت خروجی استاندارد JSON برای نگهداری نسخه شخصی و انتقال داده‌ها
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 pt-1">
                    {/* Export JSON Action Row */}
                    <button
                      type="button"
                      onClick={() => {
                        soundFX.playCheck();
                        onExportData();
                        showNotice('فایل خروجی داده‌های شخصی بوشیدو ذخیره شد.');
                      }}
                      className="surface-z1 hover:surface-z3 border-standard text-role-primary p-3.5 sm:p-4 radius-component flex items-center justify-between gap-3.5 text-right transition-colors cursor-pointer active:scale-[0.98] group min-h-[52px]"
                    >
                      <div className="flex items-center gap-3.5 min-w-0 flex-1">
                        <div className="w-10 h-10 radius-component surface-z2 flex items-center justify-center text-role-secondary group-hover:text-role-primary transition-colors shrink-0">
                          <Download className="w-4.5 h-4.5" />
                        </div>
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <span className="font-bold text-xs sm:text-sm text-role-primary block">دریافت خروجی داده‌ها (JSON)</span>
                          <p className="text-[11px] text-role-secondary leading-relaxed text-right">
                            دریافت نسخه پشتیبان و خروجی ساختاریافته از سوابق، چرخه‌ها و لاگ‌های نبرد
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-mono surface-z2 px-2.5 py-1 radius-capsule text-role-muted group-hover:text-role-secondary transition-colors shrink-0 select-none pointer-events-none">
                        JSON
                      </span>
                    </button>
                  </div>
                </div>

                {/* Sub-Card 3: Danger Zone */}
                <div className="surface-z2 border border-debt-subtle/40 radius-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3">
                    <div className="w-9 h-9 radius-card bg-debt-subtle border border-debt-subtle flex items-center justify-center text-debt shrink-0">
                      <AlertTriangle className="w-4.5 h-4.5" />
                    </div>
                    <div className="space-y-0.5 text-right">
                      <h4 className="font-bold text-xs sm:text-sm text-debt">
                        بازنشانی کل داده‌های سامانه
                      </h4>
                      <p className="text-[11px] text-role-secondary leading-relaxed">
                        تمام لاگ‌ها و سوابق پاک شده و سامانه به وضعیت اولیه بازمی‌گردد.
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={onResetData}
                    className="btn-contract-primary font-bold px-4 py-2.5 radius-card text-xs flex items-center justify-center gap-2 whitespace-nowrap shrink-0 shadow-xs min-h-[44px] focus-ring-tactical"
                  >
                    <RotateCcw className="w-4 h-4 text-white" />
                    <span>بازنشانی به وضعیت اولیه</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Section 3: Habit Philosophies & Guidelines */}
          {activeSection === 'habits' && (
            <div className="space-y-4">
              <div className="surface-z1 border-standard radius-modal p-5 sm:p-6 shadow-subtle space-y-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 radius-card surface-z2 flex items-center justify-center text-role-secondary shrink-0">
                    <BookMarked className="w-5 h-5 text-role-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-role-primary">
                      فلسفه و استانداردهای ۵ پایه انضباطی
                    </h3>
                    <p className="text-[11px] sm:text-xs text-role-secondary mt-0.5 leading-relaxed">
                      راهنمای دقیق منظور سیستم از هر عادت، دام‌های رایج و تاکتیک‌های پیروزی
                    </p>
                  </div>
                </div>

                <div className="surface-z2 p-3.5 radius-card border-standard text-xs text-role-secondary leading-relaxed text-right">
                  ۵ پایه بوشیدو بر اساس روانشناسی رفتار و ایجاد مقاومت ذهنی طراحی شده‌اند. برای مشاهده جزئیات هر عادت، روی آن ضربه بزنید:
                </div>

                {/* Habit Cards Accordion */}
                <div className="space-y-2.5 pt-1">
                  {BUSHIDO_HABITS_PHILOSOPHY.map(item => {
                    const isExpanded = expandedHabitKey === item.key;
                    return (
                      <div
                        key={item.key}
                        className="surface-z2 border-standard radius-card overflow-hidden transition"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            setExpandedHabitKey(isExpanded ? null : item.key);
                          }}
                          className="w-full p-4 flex items-center justify-between gap-3 text-right hover:surface-z3 transition cursor-pointer group min-h-[44px]"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-9 h-9 radius-component flex items-center justify-center shrink-0 border transition ${
                              isExpanded
                                ? 'surface-z3 border-standard text-role-primary'
                                : 'surface-z2 border-standard text-role-secondary group-hover:text-role-primary'
                            }`}>
                              {React.createElement(HABIT_ICONS_MAP[item.key], { className: "w-5 h-5" })}
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-xs sm:text-sm font-bold text-role-primary">
                                {item.titleFa}
                              </h4>
                              <p className="text-[11px] text-role-secondary leading-relaxed">
                                {item.subtitleFa}
                              </p>
                            </div>
                          </div>

                          <div className="shrink-0 text-role-muted">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="px-4 pb-4 pt-1 space-y-3 text-xs border-t border-subtle">
                            <div className="surface-z3 p-3 radius-component space-y-1">
                              <span className="font-bold text-amber text-[11px] block">چرا حیاتی است؟</span>
                              <p className="text-role-secondary leading-relaxed text-right">{item.whyItMatters}</p>
                            </div>

                            <div className="surface-z3 p-3 radius-component space-y-1">
                              <span className="font-bold text-emerald text-[11px] block">معیار استاندارد اجرا:</span>
                              <p className="text-role-secondary leading-relaxed text-right">{item.dailyStandard}</p>
                            </div>

                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                              <div className="surface-z3 p-3 radius-component space-y-1">
                                <span className="font-bold text-rose text-[11px] block">دام‌های رایج:</span>
                                <p className="text-role-secondary leading-relaxed text-right">{item.commonPitfalls}</p>
                              </div>

                              <div className="surface-z3 p-3 radius-component space-y-1">
                                <span className="font-bold text-blue text-[11px] block">تاکتیک و راهکار:</span>
                                <p className="text-role-secondary leading-relaxed text-right">{item.tacticalAdvice}</p>
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
              <div className="surface-z1 border-standard radius-modal p-5 sm:p-6 shadow-subtle space-y-5">
                <div className="flex items-center gap-3.5">
                  <div className="w-10 h-10 radius-card surface-z2 flex items-center justify-center text-role-secondary shrink-0">
                    <Headphones className="w-5 h-5 text-role-secondary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm sm:text-base font-bold text-role-primary">
                      ارتباط با پشتیبانی و جامعه بوشیدو
                    </h3>
                    <p className="text-[11px] sm:text-xs text-role-secondary mt-0.5 leading-relaxed">
                      دریافت راهنمایی، گزارش مشکلات یا ارتباط مستقیم با تیم توسعه
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {SUPPORT_CONTACT_CHANNELS.map(ch => (
                    <div
                      key={ch.channel}
                      className="surface-z2 border-standard radius-card p-4 flex flex-col justify-between space-y-3"
                    >
                      <div className="space-y-2.5">
                        {/* RTL Header: Right=Brand Icon + Title, Left=Channel Badge */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div className="w-8 h-8 radius-component flex items-center justify-center shrink-0">
                              {ch.iconName === 'Send' && (
                                <div className="w-8 h-8 radius-component bg-blue-subtle border border-blue-subtle flex items-center justify-center text-blue shadow-xs">
                                  <Send className="w-4 h-4" />
                                </div>
                              )}
                              {ch.iconName === 'Radio' && (
                                <div className="w-8 h-8 radius-component bg-rose-subtle border border-rose-subtle flex items-center justify-center text-rose shadow-xs">
                                  <Radio className="w-4 h-4" />
                                </div>
                              )}
                              {ch.iconName === 'Mail' && (
                                <div className="w-8 h-8 radius-component bg-amber-subtle border border-amber-subtle flex items-center justify-center text-amber shadow-xs">
                                  <Mail className="w-4 h-4" />
                                </div>
                              )}
                            </div>
                            <h4 className="text-xs sm:text-sm font-bold text-role-primary truncate">
                              {ch.title}
                            </h4>
                          </div>

                          <span className="text-[10px] font-mono text-role-muted surface-z3 px-2.5 py-0.5 radius-capsule shrink-0 select-none pointer-events-none">
                            {ch.channel}
                          </span>
                        </div>

                        <p className="text-[11px] text-role-secondary leading-relaxed text-right">
                          {ch.description}
                        </p>
                      </div>

                      <div className="pt-2 border-t border-subtle space-y-2">
                        <div className="text-xs font-mono font-bold text-role-primary text-left" dir="ltr">
                          {ch.value}
                        </div>
                        {ch.link && (
                          <a
                            href={ch.link}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="btn-contract-secondary w-full py-2.5 min-h-[44px] radius-card text-xs font-bold flex items-center justify-center gap-1.5 focus-ring-tactical"
                          >
                            <span>{ch.actionLabel}</span>
                            <ExternalLink className="w-3 h-3 text-role-muted" />
                          </a>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="surface-z2 p-4 radius-card border-standard flex items-start gap-3">
                  <Info className="w-4 h-4 text-role-muted shrink-0 mt-0.5" />
                  <p className="text-xs text-role-secondary leading-relaxed text-right">
                    زمان پاسخ‌گویی پشتیبانی معمولاً در کمتر از ۲ ساعت کاری است. همچنین می‌توانید با ذخیره خروجی پشتیبان، داده‌های خود را همیشه در امان نگه دارید.
                  </p>
                </div>
              </div>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
