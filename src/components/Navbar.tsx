import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, LayoutGroup, useReducedMotion } from 'motion/react';
import { Cycle, CycleMetrics, SystemSettings, UserProfile } from '../types';
import { toPersianDigits } from '../utils/numberUtils';
import { THEME_PALETTES } from '../utils/themeUtils';
import { haptics } from '../utils/haptics';
import { soundFX } from '../utils/audioEffects';
import { 
  Swords, 
  LayoutDashboard, 
  Archive, 
  Menu, 
  Flame, 
  AlertTriangle, 
  ChevronDown,
  Crown,
  ShieldCheck,
  Plus,
  Trash2
} from 'lucide-react';

interface NavbarProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
  cycles: Cycle[];
  currentCycle: Cycle;
  onSelectCycle: (cycle: Cycle) => void;
  metrics: CycleMetrics;
  unresolvedDebtCount?: number;
  settings: SystemSettings;
  userProfile: UserProfile;
  onOpenPaymentModal: () => void;
  onOpenAuthModal: () => void;
  onOpenDebtAutopsy?: () => void;
  onOpenNewCycleModal?: () => void;
  onDeleteCycle?: (cycleId: string) => void;
}

const NavbarComponent: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  cycles,
  currentCycle,
  onSelectCycle,
  metrics,
  unresolvedDebtCount,
  settings,
  userProfile,
  onOpenPaymentModal,
  onOpenAuthModal,
  onOpenDebtAutopsy,
  onOpenNewCycleModal,
  onDeleteCycle
}) => {
  const displayedDebtCount = unresolvedDebtCount !== undefined ? unresolvedDebtCount : metrics.unresolvedDebtCount;
  const shouldReduceMotion = useReducedMotion();
  const [isCycleDropdownOpen, setIsCycleDropdownOpen] = useState(false);
  const [confirmDeleteCycleId, setConfirmDeleteCycleId] = useState<string | null>(null);
  const cycleDropdownButtonRef = useRef<HTMLButtonElement>(null);
  const cycleDropdownPanelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const currentCycleItemRef = useRef<HTMLButtonElement | null>(null);
  const firstCycleItemRef = useRef<HTMLButtonElement | null>(null);
  const wasDropdownOpenRef = useRef(false);

  // Focus current or first cycle item when dropdown opens, and return focus to trigger on close
  useEffect(() => {
    if (isCycleDropdownOpen) {
      wasDropdownOpenRef.current = true;
      const timer = setTimeout(() => {
        if (currentCycleItemRef.current) {
          currentCycleItemRef.current.focus();
        } else if (firstCycleItemRef.current) {
          firstCycleItemRef.current.focus();
        }
      }, 40);
      return () => clearTimeout(timer);
    } else if (wasDropdownOpenRef.current) {
      wasDropdownOpenRef.current = false;
      cycleDropdownButtonRef.current?.focus();
    }
  }, [isCycleDropdownOpen]);

  // Accessible dismissal on Escape, Tab containment & Native Non-Passive Touch Ghost-Click Prevention
  useEffect(() => {
    if (!isCycleDropdownOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setIsCycleDropdownOpen(false);
        setConfirmDeleteCycleId(null);
        cycleDropdownButtonRef.current?.focus();
        return;
      }

      if (e.key === 'Tab' && cycleDropdownPanelRef.current) {
        const focusable = cycleDropdownPanelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }

      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && cycleDropdownPanelRef.current) {
        const focusable = Array.from(
          cycleDropdownPanelRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )
        );
        if (focusable.length > 0) {
          e.preventDefault();
          const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
          if (e.key === 'ArrowDown') {
            const nextIndex = currentIndex < focusable.length - 1 ? currentIndex + 1 : 0;
            focusable[nextIndex].focus();
          } else {
            const prevIndex = currentIndex > 0 ? currentIndex - 1 : focusable.length - 1;
            focusable[prevIndex].focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    const backdropEl = backdropRef.current;
    if (backdropEl) {
      const handleNativeTouchStart = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };

      const handleNativeTouchEnd = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsCycleDropdownOpen(false);
        setConfirmDeleteCycleId(null);
      };

      const handleNativeClick = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsCycleDropdownOpen(false);
        setConfirmDeleteCycleId(null);
      };

      backdropEl.addEventListener('touchstart', handleNativeTouchStart, { passive: false });
      backdropEl.addEventListener('touchend', handleNativeTouchEnd, { passive: false });
      backdropEl.addEventListener('click', handleNativeClick);

      return () => {
        window.removeEventListener('keydown', handleKeyDown);
        backdropEl.removeEventListener('touchstart', handleNativeTouchStart);
        backdropEl.removeEventListener('touchend', handleNativeTouchEnd);
        backdropEl.removeEventListener('click', handleNativeClick);
      };
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isCycleDropdownOpen]);

  // 3 Primary Canonical Tabs for Maximum Touch Ergonomics & Clean Hierarchy
  const mainTabs = [
    { id: 'battlefield', label: 'میدان نبرد', icon: Swords },
    { id: 'dashboard', label: 'اتاق فرماندهی', icon: LayoutDashboard },
    { id: 'profile', label: 'بیشتر', icon: Menu },
  ];

  const currentTheme = userProfile.accentTheme || settings.accentTheme || 'amber';
  const themeConfig = THEME_PALETTES[currentTheme] || THEME_PALETTES.amber;

  const handleTabClick = (tabId: string) => {
    if (tabId !== activeTab) {
      haptics.lightTap();
      window.scrollTo({ top: 0, behavior: 'instant' });
      onSelectTab(tabId);
    } else {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Mobile Bottom Bar Horizontal Swipe Handler (Ergonomic 1-hand swipe between primary tabs)
  const bottomNavTouchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const handleBottomNavTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (touch) {
      bottomNavTouchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    }
  };

  const handleBottomNavTouchEnd = (e: React.TouchEvent) => {
    if (!bottomNavTouchStartRef.current) return;
    const touch = e.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - bottomNavTouchStartRef.current.x;
    const deltaY = touch.clientY - bottomNavTouchStartRef.current.y;
    const elapsed = Date.now() - bottomNavTouchStartRef.current.time;
    bottomNavTouchStartRef.current = null;

    // Strict intentional threshold for bottom bar swipe:
    // 1. Vector slope: deltaX dominates deltaY (slope > 1.25)
    // 2. Clear movement >= 35px or quick flick >= 25px within 300ms
    const isQuickFlick = elapsed < 300 && Math.abs(deltaX) >= 25;
    const isStandardSwipe = Math.abs(deltaX) >= 35;

    if ((isStandardSwipe || isQuickFlick) && Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      const tabOrder = ['battlefield', 'dashboard', 'profile'];
      const currentCanonicalTab = 
        activeTab === 'cycle' ? 'dashboard' :
        (activeTab === 'settings' || activeTab === 'habits' || activeTab === 'support') ? 'profile' :
        (activeTab === 'court' || activeTab === 'database') ? 'dashboard' :
        activeTab;

      const currentIndex = tabOrder.indexOf(currentCanonicalTab);
      if (currentIndex !== -1) {
        if (deltaX < 0) {
          // Swipe Left -> Next Tab in RTL (battlefield -> dashboard -> profile)
          if (currentIndex < tabOrder.length - 1) {
            handleTabClick(tabOrder[currentIndex + 1]);
          }
        } else {
          // Swipe Right -> Prev Tab in RTL (profile -> dashboard -> battlefield)
          if (currentIndex > 0) {
            handleTabClick(tabOrder[currentIndex - 1]);
          }
        }
      }
    }
  };

  const currentCycleIndex = currentCycle 
    ? cycles.findIndex(c => c.id === currentCycle.id)
    : -1;

  const cycleTitleDisplay = currentCycle 
    ? `چرخه ${toPersianDigits(currentCycleIndex >= 0 ? currentCycleIndex + 1 : 1)}`
    : 'تعریف چرخه';

  const handleDeleteCycleClick = (e: React.MouseEvent, cycleId: string) => {
    e.stopPropagation();
    if (confirmDeleteCycleId === cycleId) {
      soundFX.playSlash();
      if (onDeleteCycle) {
        onDeleteCycle(cycleId);
      }
      setConfirmDeleteCycleId(null);
    } else {
      setConfirmDeleteCycleId(cycleId);
    }
  };

  return (
    <>
      {/* Click-Eater Backdrop: Intercepts all clicks outside the dropdown and prevents unwanted interaction with underlying habits/buttons */}
      {isCycleDropdownOpen && (
        <div 
          ref={backdropRef}
          className="fixed inset-0 z-40 bg-black/25 backdrop-blur-[1px] select-none cursor-default touch-none"
          aria-hidden="true"
        />
      )}

      {/* Top Hub Bar Header with Dynamic Island & PWA Safe-Area Support */}
      <header 
        className="sticky top-0 z-40 surface-z0/95 backdrop-blur-md border-b border-standard transition-all pt-safe shadow-subtle" 
        dir="rtl"
      >
        <div className="max-w-7xl mx-auto px-2.5 sm:px-6 lg:px-8 relative">
          <div className="flex items-center justify-between h-14 sm:h-16 gap-1.5 sm:gap-4">
            
            {/* Brand & Cycle Switcher */}
            <div className="flex items-center gap-2 sm:gap-3.5 min-w-0 shrink">
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="h-8 w-8 sm:h-9 sm:w-9 radius-component flex items-center justify-center text-black font-black shadow-subtle text-sm sm:text-base shrink-0 select-none pointer-events-none"
                  style={{ backgroundColor: themeConfig.colorHex }}
                >
                  武
                </div>
                <div className="hidden sm:block select-none pointer-events-none">
                  <span className="font-black text-xs sm:text-sm text-role-primary tracking-tight block truncate">
                    بوشیدو
                  </span>
                  <span className="text-[9px] text-role-muted font-mono hidden md:block">
                    BUSHIDO OS
                  </span>
                </div>
              </div>

              {/* Cycle Switcher Dropdown */}
              <div className="relative min-w-0 z-50">
                <button 
                  ref={cycleDropdownButtonRef}
                  type="button"
                  onClick={() => setIsCycleDropdownOpen(!isCycleDropdownOpen)}
                  aria-expanded={isCycleDropdownOpen}
                  aria-haspopup="true"
                  aria-label={`انتخاب چرخه، چرخه فعلی: ${currentCycle ? currentCycle.title : 'تعریف نشده'}`}
                  className="h-8 sm:h-9 min-w-[44px] surface-z1 hover:bg-[var(--color-border-subtle)] active:bg-[var(--color-border-hover)] border-standard radius-component px-2 sm:px-2.5 text-xs text-role-primary inline-flex items-center justify-center gap-1 sm:gap-1.5 transition cursor-pointer shrink-0 touch-manipulation relative z-50 focus-ring-tactical"
                >
                  <span className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full shrink-0 ${currentCycle ? 'bg-emerald' : 'bg-amber'}`}></span>
                  <span className="font-bold whitespace-nowrap text-[11px] sm:text-xs">
                    {cycleTitleDisplay}
                  </span>
                  <ChevronDown className="w-3 h-3 text-role-muted shrink-0" />
                </button>

                {isCycleDropdownOpen && (
                  <div 
                    ref={cycleDropdownPanelRef}
                    role="region"
                    aria-label="انتخاب و مدیریت چرخه‌ها"
                    className="absolute right-0 mt-2 w-72 sm:w-80 max-w-[calc(100vw-1.5rem)] surface-z3 border-standard radius-modal shadow-dropdown overflow-hidden z-50 animate-in fade-in zoom-in-95 motion-reduce:animate-none duration-150"
                  >
                    <div className="px-3.5 py-2.5 text-[10px] text-role-secondary font-bold border-b border-standard flex items-center justify-between surface-z2/60">
                      <span>انتخاب و مدیریت چرخه‌های ۹۰ روزه:</span>
                      <span className="text-role-muted font-mono">{toPersianDigits(cycles.length)} چرخه</span>
                    </div>
                    <div className="max-h-60 overflow-y-auto divide-y divide-[var(--color-border-subtle)]/40 p-1">
                      {cycles.length === 0 ? (
                        <div className="p-3 text-center text-xs text-role-secondary">
                          چرخه‌ای تعریف نشده است.
                        </div>
                      ) : (
                        cycles.map((c, idx) => {
                          const isCurrent = currentCycle && c.id === currentCycle.id;
                          const isConfirming = confirmDeleteCycleId === c.id;

                          return (
                            <div
                              key={c.id}
                              className={`w-full p-1 min-h-[44px] flex items-center justify-between gap-1.5 transition radius-component ${
                                isCurrent ? 'surface-z2/60' : 'hover:surface-z2/40'
                              }`}
                            >
                              {/* Native button for Cycle selection */}
                              <button
                                ref={isCurrent ? currentCycleItemRef : (idx === 0 ? firstCycleItemRef : undefined)}
                                type="button"
                                onClick={() => {
                                  onSelectCycle(c);
                                  setIsCycleDropdownOpen(false);
                                  setConfirmDeleteCycleId(null);
                                  cycleDropdownButtonRef.current?.focus();
                                }}
                                aria-current={isCurrent ? 'true' : undefined}
                                className={`flex-1 min-h-[38px] px-2.5 py-1.5 text-xs radius-control flex items-center gap-2 text-right transition cursor-pointer touch-manipulation focus-ring-tactical ${
                                  isCurrent ? 'text-emerald font-bold surface-z2' : 'text-role-secondary hover:text-role-primary'
                                }`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isCurrent ? 'bg-emerald' : 'bg-[var(--color-text-muted)]'}`} />
                                <span className="truncate flex-1">{c.title}</span>
                                {c.isArchived && (
                                  <span className="text-[9px] surface-z1 text-role-muted px-1.5 py-0.5 radius-badge shrink-0 border-standard">
                                    بایگانی
                                  </span>
                                )}
                                {isCurrent && (
                                  <span className="sr-only">(چرخه فعال)</span>
                                )}
                              </button>

                              {/* Separate Delete Action - NOT nested inside Cycle button */}
                              {onDeleteCycle && (
                                <button
                                  type="button"
                                  onClick={(e) => handleDeleteCycleClick(e, c.id)}
                                  className={`p-2 min-h-[38px] min-w-[38px] radius-control text-xs transition shrink-0 cursor-pointer flex items-center justify-center touch-manipulation focus-ring-tactical ${
                                    isConfirming 
                                      ? 'bg-debt hover:bg-red-600 text-white font-black px-2 py-1 shadow-subtle animate-pulse motion-reduce:animate-none' 
                                      : 'text-role-muted hover:text-debt hover:bg-debt-subtle'
                                  }`}
                                  aria-label={isConfirming ? `تایید حذف قطعی چرخه ${c.title}` : `حذف چرخه ${c.title}`}
                                  title={isConfirming ? 'کلیک مجدد برای حذف قطعی' : 'حذف این چرخه'}
                                >
                                  {isConfirming ? (
                                    <span className="text-[10px] whitespace-nowrap leading-none">تایید حذف؟</span>
                                  ) : (
                                    <Trash2 className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                    
                    <div className="p-2.5 border-t border-standard space-y-2 surface-z2/70">
                      {onOpenNewCycleModal && (
                        <button
                          type="button"
                          onClick={() => {
                            setIsCycleDropdownOpen(false);
                            setConfirmDeleteCycleId(null);
                            onOpenNewCycleModal();
                          }}
                          className="w-full py-2.5 min-h-[44px] px-3 bg-amber hover:bg-amber-400 text-zinc-950 radius-component text-xs font-black transition flex items-center justify-center gap-1.5 cursor-pointer shadow-subtle active:scale-[0.98] touch-manipulation focus-ring-tactical"
                        >
                          <Plus className="w-4 h-4" />
                          <span>+ تعریف چرخه جدید ۹۰ روزه</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setIsCycleDropdownOpen(false);
                          setConfirmDeleteCycleId(null);
                          onSelectTab('archives');
                        }}
                        className="w-full py-2.5 min-h-[44px] px-3 surface-z1 hover:bg-[var(--color-border-subtle)] text-role-secondary hover:text-role-primary border-standard radius-component text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer touch-manipulation focus-ring-tactical"
                      >
                        <Archive className="w-3.5 h-3.5 text-role-muted" />
                        <span>کارنامه و بایگانی چرخه‌ها</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Desktop Navigation Tabs */}
            <LayoutGroup id="desktopNavGroup">
              <nav className="hidden lg:flex items-center gap-1 xl:gap-2 h-10" aria-label="ناوبری اصلی">
                {mainTabs.map(tab => {
                  const Icon = tab.icon;
                  const isActive = activeTab === tab.id;
                  const hasDebtAlert = tab.id === 'battlefield' && displayedDebtCount > 0;

                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => handleTabClick(tab.id)}
                      aria-current={isActive ? 'page' : undefined}
                      className={`h-9 px-3.5 radius-component text-xs xl:text-sm font-semibold flex items-center gap-2 transition-colors cursor-pointer relative z-10 select-none touch-manipulation focus-ring-tactical ${
                        isActive
                          ? 'text-role-primary font-bold'
                          : 'text-role-secondary hover:text-role-primary'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId={shouldReduceMotion ? undefined : "desktopActiveTabIndicator"}
                          layout={shouldReduceMotion ? false : "position"}
                          className="absolute inset-0 radius-component -z-10 shadow-subtle border pointer-events-none"
                          style={{
                            backgroundColor: themeConfig.bgSubtle,
                            borderColor: `${themeConfig.colorHex}50`
                          }}
                          transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 450, damping: 35 }}
                        />
                      )}
                      <Icon 
                        className="w-4 h-4 transition-colors shrink-0"
                        style={{ color: isActive ? themeConfig.colorHex : undefined }}
                      />
                      <span className="whitespace-nowrap leading-none">{tab.label}</span>

                      {hasDebtAlert && !isActive && (
                        <>
                          <span 
                            className="w-2 h-2 rounded-full bg-debt animate-ping motion-reduce:animate-none absolute top-1.5 left-1.5" 
                            aria-hidden="true" 
                          />
                          <span className="sr-only">
                            ({toPersianDigits(displayedDebtCount)} بدهی باز نیازمند رسیدگی)
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </nav>
            </LayoutGroup>

            {/* User Tier, Auth & Streak Controls */}
            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              {/* Debt Alert Badge */}
              {displayedDebtCount > 0 && (
                <button 
                  type="button"
                  onClick={() => {
                    if (onOpenDebtAutopsy) {
                      onOpenDebtAutopsy();
                    } else {
                      onSelectTab('battlefield');
                    }
                  }}
                  className="h-8 sm:h-9 min-w-[44px] bg-debt-subtle border border-debt hover:bg-[var(--color-accent-red-bg)] text-debt px-2 sm:px-2.5 radius-component text-[10px] sm:text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer animate-pulse motion-reduce:animate-none shrink-0 shadow-subtle transition touch-manipulation focus-ring-tactical"
                  title="کلیک برای کالبدشکافی و تسویه فوری بدهی"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-debt shrink-0" />
                  <span className="hidden xs:inline">{toPersianDigits(displayedDebtCount)} بدهی باز</span>
                  <span className="xs:hidden">{toPersianDigits(displayedDebtCount)}!</span>
                </button>
              )}

              {/* Pure Streak Flame */}
              <div 
                className="h-8 sm:h-9 bg-rose-subtle border border-rose-subtle text-rose px-2 sm:px-2.5 radius-component inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs font-bold shrink-0 cursor-default select-none pointer-events-none"
                title="تعداد روزهای زنجیره خالص متوالی بدون شکست"
              >
                <Flame className="w-3.5 h-3.5 shrink-0 fill-current text-rose" />
                <span className="whitespace-nowrap font-mono">{toPersianDigits(metrics.pureStreak)} روز</span>
              </div>

              {/* VIP Status Badge */}
              {userProfile.isVip && (
                <button
                  type="button"
                  onClick={onOpenPaymentModal}
                  className="h-8 sm:h-9 min-w-[44px] bg-amber-subtle hover:bg-amber-500/20 border border-amber-subtle hover:border-amber text-amber px-2 sm:px-2.5 radius-component text-[11px] sm:text-xs font-bold inline-flex items-center justify-center gap-1 sm:gap-1.5 cursor-pointer shadow-subtle shrink-0 transition active:scale-95 touch-manipulation focus-ring-tactical"
                  title="حساب سامورایی ویژه فعال است - کلیک برای مدیریت"
                >
                  <Crown className="w-3.5 h-3.5 text-amber shrink-0" />
                  <span className="font-mono">VIP</span>
                </button>
              )}

              {/* Admin Panel Quick Access Button */}
              {userProfile.isAdmin && (
                <button
                  type="button"
                  onClick={() => onSelectTab('admin')}
                  className={`h-8 sm:h-9 min-w-[44px] bg-debt-subtle border border-debt hover:bg-[var(--color-accent-red-bg)] text-debt px-2 sm:px-2.5 radius-component text-[10px] sm:text-xs font-bold inline-flex items-center justify-center gap-1 cursor-pointer transition shrink-0 touch-manipulation focus-ring-tactical ${
                    activeTab === 'admin' ? 'ring-2 ring-[var(--color-accent-red)] bg-debt text-white' : ''
                  }`}
                  title="ورود به پنل مدیریت"
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-debt shrink-0" />
                  <span className="hidden sm:inline">پنل مدیریت</span>
                  <span className="sm:hidden">مدیر</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Bottom Navigation Bar (3 Clean Canonical Tabs with Swipe Support) */}
      <LayoutGroup id="mobileBottomNavGroup">
        <nav 
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 surface-z0/95 border-t border-standard crisp-blur px-2 py-1 pb-safe select-none touch-pan-x"
          dir="rtl"
          aria-label="ناوبری اصلی همراه"
          onTouchStart={handleBottomNavTouchStart}
          onTouchEnd={handleBottomNavTouchEnd}
        >
          <div className="grid grid-cols-3 max-w-md mx-auto relative h-14 items-center">
            {mainTabs.map(tab => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              const hasDebtAlert = tab.id === 'battlefield' && displayedDebtCount > 0;
              const hasMilestoneAlert = tab.id === 'profile' && !userProfile.isVip && (metrics.elapsedDays >= 30 || metrics.pureStreak >= 7);

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => handleTabClick(tab.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`h-full min-h-[44px] min-w-[44px] w-full flex flex-col items-center justify-center relative cursor-pointer z-10 transition-colors touch-manipulation focus-ring-tactical ${
                    isActive
                      ? 'font-bold text-role-primary'
                      : 'text-role-secondary hover:text-role-primary'
                  }`}
                >
                  <div className="relative w-12 h-7 flex items-center justify-center">
                    {isActive && (
                      <motion.div
                        layoutId={shouldReduceMotion ? undefined : "activeTabIndicator"}
                        layout={shouldReduceMotion ? false : "position"}
                        className="absolute inset-0 radius-component border pointer-events-none"
                        style={{
                          backgroundColor: themeConfig.bgSubtle,
                          borderColor: `${themeConfig.colorHex}50`
                        }}
                        transition={shouldReduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 450, damping: 35, mass: 0.7 }}
                      />
                    )}
                    <Icon 
                      className="w-5 h-5 relative z-10 transition-colors motion-fast" 
                      style={{ color: isActive ? themeConfig.colorHex : undefined }}
                    />

                    {hasDebtAlert && !isActive && (
                      <>
                        <span 
                          className="w-2 h-2 rounded-full bg-debt animate-ping motion-reduce:animate-none absolute top-0.5 right-1 z-20" 
                          aria-hidden="true" 
                        />
                        <span className="sr-only">
                          ({toPersianDigits(displayedDebtCount)} بدهی باز)
                        </span>
                      </>
                    )}

                    {hasMilestoneAlert && !isActive && (
                      <>
                        <span 
                          className="w-2 h-2 rounded-full bg-amber animate-pulse motion-reduce:animate-none absolute top-0.5 right-1 z-20 shadow-subtle" 
                          aria-hidden="true" 
                        />
                        <span className="sr-only">
                          (نقطه عطف جدید در دسترس است)
                        </span>
                      </>
                    )}
                  </div>

                  <span 
                    className="h-3.5 text-[10.5px] tracking-tight mt-0.5 leading-none whitespace-nowrap transition-colors motion-fast flex items-center justify-center"
                    style={{ color: isActive ? themeConfig.colorHex : undefined }}
                  >
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </LayoutGroup>
    </>
  );
};

export const Navbar = React.memo(NavbarComponent);
