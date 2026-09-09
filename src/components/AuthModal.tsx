import React, { useState, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { UserProfile } from '../types';
import { toPersianDigits } from '../utils/numberUtils';
import { haptics } from '../utils/haptics';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { useModalAccessibility } from '../utils/useModalAccessibility';
import { handleTabListKeyDown, AuthTab } from '../utils/authTabNavigation';
import { 
  ShieldCheck, 
  Smartphone, 
  Mail, 
  KeyRound, 
  User, 
  LogOut, 
  Crown, 
  X, 
  CheckCircle2, 
  AlertCircle,
  ArrowRight,
  Database,
  Lock,
  Eye,
  EyeOff,
  UserPlus,
  LogIn,
  RotateCcw
} from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: UserProfile | null;
  onAuthSuccess: (token: string, user: UserProfile) => void;
  onLogout: () => void;
}

type AuthErrorField = 'phone' | 'password' | 'otp' | 'newPassword' | null;

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAuthSuccess,
  onLogout
}) => {
  useBodyScrollLock(isOpen);

  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  
  // Phone-First form fields
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Two-step Registration state
  const [registerStep, setRegisterStep] = useState<'request' | 'verify'>('request');

  // Forgot password OTP fields
  const [forgotStep, setForgotStep] = useState<'request' | 'reset'>('request');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [debugOtp, setDebugOtp] = useState<string | null>(null);

  // Resend cooldown timer in seconds
  const [resendCooldown, setResendCooldown] = useState<number>(0);

  // Status state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorField, setErrorField] = useState<AuthErrorField>(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Hidden secret dev/admin mode state (hidden from public users)
  const [showSecretDev, setShowSecretDev] = useState(false);
  const secretClickCountRef = useRef(0);
  const secretTimerRef = useRef<NodeJS.Timeout | null>(null);

  const switchTab = (newTab: AuthTab) => {
    setActiveTab(newTab);
    if (newTab === 'register') setRegisterStep('request');
    if (newTab === 'forgot') setForgotStep('request');
    setErrorMessage('');
    setErrorField(null);
    setSuccessMessage('');
    setTimeout(() => {
      document.getElementById(`auth-tab-${newTab}`)?.focus();
    }, 0);
  };

  const handleTabKeyDown = (e: React.KeyboardEvent) => {
    const nextTab = handleTabListKeyDown(e.key, activeTab, true);
    if (nextTab) {
      e.preventDefault();
      switchTab(nextTab);
    }
  };

  const shouldReduceMotion = useReducedMotion();
  const { containerRef } = useModalAccessibility<HTMLDivElement>({
    isOpen,
    onClose,
    isBusy: isLoading,
    focusKey: `${activeTab}-${registerStep}-${forgotStep}`
  });

  // Cooldown countdown interval
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const interval = setInterval(() => {
      setResendCooldown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [resendCooldown]);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
      setErrorField(null);
      setSuccessMessage('');
      try {
        const isSecretUnlocked = localStorage.getItem('bushido_secret_dev_mode') === 'true';
        setShowSecretDev(isSecretUnlocked);
      } catch {
        setShowSecretDev(false);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSecretIconClick = () => {
    secretClickCountRef.current += 1;
    if (secretTimerRef.current) clearTimeout(secretTimerRef.current);

    if (secretClickCountRef.current >= 5) {
      secretClickCountRef.current = 0;
      const nextVal = !showSecretDev;
      setShowSecretDev(nextVal);
      try {
        localStorage.setItem('bushido_secret_dev_mode', nextVal.toString());
      } catch {}
      return;
    }

    secretTimerRef.current = setTimeout(() => {
      secretClickCountRef.current = 0;
    }, 2000);
  };

  // 1. Phone-First Direct Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setErrorField(null);
    setSuccessMessage('');

    const cleanPhone = phoneNumber.trim();
    if (!cleanPhone) {
      setErrorMessage('لطفاً شماره موبایل خود را وارد نمایید.');
      setErrorField('phone');
      haptics.warningAlert();
      return;
    }

    if (!password) {
      setErrorMessage('لطفاً رمز عبور خود را وارد نمایید.');
      setErrorField('password');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanPhone, password })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.messageFa || data.error || 'ورود به سامانه با خطا مواجه شد.');
      }

      const userProfile: UserProfile = {
        id: data.user.id,
        name: data.user.name || 'سامورایی دیسیپلین',
        email: data.user.email || undefined,
        phoneNumber: data.user.phoneNumber || undefined,
        tier: data.user.tier || (data.user.isVip ? 'vip_samurai' : 'free'),
        isVip: Boolean(data.user.isVip),
        isAdmin: Boolean(data.user.isAdmin),
        vipSince: data.user.vipSince,
        vipExpiresAt: data.user.vipExpiresAt,
        paymentRefId: data.user.paymentRefId,
        activeCycleLimit: data.user.isVip ? 999 : 1
      };

      haptics.standardDaySuccess();
      onAuthSuccess(data.token, userProfile);
      onClose();
    } catch (err: any) {
      haptics.warningAlert();
      setErrorMessage(err.message || 'خطا در ورود به حساب.');
      setErrorField(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Phone-First Registration: Step 1 - Request OTP
  const handleRegisterRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage('');
    setErrorField(null);
    setSuccessMessage('');
    setDebugOtp(null);

    const cleanPhone = phoneNumber.trim();
    if (!cleanPhone) {
      setErrorMessage('لطفاً شماره موبایل خود را وارد نمایید.');
      setErrorField('phone');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register/request-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanPhone })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.retryAfterSeconds) {
          setResendCooldown(data.retryAfterSeconds);
        }
        throw new Error(data.messageFa || data.error || 'ارسال کد تایید پیامکی با خطا مواجه شد.');
      }

      setSuccessMessage(data.messageFa || 'کد تایید ۵ رقمی برای شماره شما ارسال شد.');
      setResendCooldown(data.cooldownSeconds || 60);
      if (data.debugCode) {
        setDebugOtp(data.debugCode);
        setOtpCode(data.debugCode);
      }
      setRegisterStep('verify');
    } catch (err: any) {
      haptics.warningAlert();
      setErrorMessage(err.message || 'خطا در ارسال کد تایید.');
      setErrorField(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Phone-First Registration: Step 2 - Verify OTP & Set Password
  const handleRegisterVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setErrorField(null);
    setSuccessMessage('');

    if (!otpCode.trim()) {
      setErrorMessage('لطفاً کد تایید ۵ رقمی پیامک‌شده را وارد نمایید.');
      setErrorField('otp');
      haptics.warningAlert();
      return;
    }

    if (!password || password.length < 8) {
      setErrorMessage('رمز عبور باید حداقل دارای ۸ نویسه (کاراکتر) باشد.');
      setErrorField('password');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
          code: otpCode.trim(),
          password,
          name: name.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.messageFa || data.error || 'ثبت‌نام با خطا مواجه شد.');
      }

      const userProfile: UserProfile = {
        id: data.user.id,
        name: data.user.name || 'سامورایی دیسیپلین',
        email: data.user.email || undefined,
        phoneNumber: data.user.phoneNumber || undefined,
        tier: data.user.tier || (data.user.isVip ? 'vip_samurai' : 'free'),
        isVip: Boolean(data.user.isVip),
        isAdmin: Boolean(data.user.isAdmin),
        vipSince: data.user.vipSince,
        vipExpiresAt: data.user.vipExpiresAt,
        paymentRefId: data.user.paymentRefId,
        activeCycleLimit: data.user.isVip ? 999 : 1
      };

      haptics.standardDaySuccess();
      onAuthSuccess(data.token, userProfile);
      onClose();
    } catch (err: any) {
      haptics.warningAlert();
      setErrorMessage(err.message || 'خطا در ثبت‌نام کاربر.');
      setErrorField(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Password Recovery: Step 1 - Request OTP
  const handleForgotRequestOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMessage('');
    setErrorField(null);
    setSuccessMessage('');
    setDebugOtp(null);

    const cleanPhone = phoneNumber.trim();
    if (!cleanPhone) {
      setErrorMessage('لطفاً شماره موبایل خود را وارد نمایید.');
      setErrorField('phone');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber: cleanPhone })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        if (data.retryAfterSeconds) {
          setResendCooldown(data.retryAfterSeconds);
        }
        throw new Error(data.messageFa || data.error || 'ارسال کد بازیابی با خطا مواجه شد.');
      }

      setSuccessMessage(data.messageFa || 'کد تایید بازیابی رمز عبور ارسال شد.');
      setResendCooldown(data.cooldownSeconds || 60);
      if (data.debugCode) {
        setDebugOtp(data.debugCode);
        setOtpCode(data.debugCode);
      }
      setForgotStep('reset');
    } catch (err: any) {
      haptics.warningAlert();
      setErrorMessage(err.message || 'خطا در ارسال کد تایید.');
      setErrorField(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Password Recovery: Step 2 - Reset with OTP
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setErrorField(null);

    if (!otpCode.trim()) {
      setErrorMessage('لطفاً کد تایید ۵ رقمی را وارد نمایید.');
      setErrorField('otp');
      haptics.warningAlert();
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setErrorMessage('رمز عبور جدید باید حداقل دارای ۸ نویسه باشد.');
      setErrorField('newPassword');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phoneNumber: phoneNumber.trim(),
          code: otpCode.trim(),
          newPassword
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.messageFa || data.error || 'بازنشانی رمز عبور با خطا مواجه شد.');
      }

      const userProfile: UserProfile = {
        id: data.user.id,
        name: data.user.name || 'سامورایی دیسیپلین',
        email: data.user.email || undefined,
        phoneNumber: data.user.phoneNumber || undefined,
        tier: data.user.tier || (data.user.isVip ? 'vip_samurai' : 'free'),
        isVip: Boolean(data.user.isVip),
        isAdmin: Boolean(data.user.isAdmin),
        vipSince: data.user.vipSince,
        vipExpiresAt: data.user.vipExpiresAt,
        paymentRefId: data.user.paymentRefId,
        activeCycleLimit: data.user.isVip ? 999 : 1
      };

      haptics.standardDaySuccess();
      onAuthSuccess(data.token, userProfile);
      onClose();
    } catch (err: any) {
      haptics.warningAlert();
      setErrorMessage(err.message || 'خطا در تغییر رمز عبور.');
      setErrorField(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Quick Login for Dev/Admin
  const handleQuickLogin = async (role: 'admin' | 'test_user') => {
    setIsLoading(true);
    setErrorMessage('');
    setErrorField(null);
    try {
      const res = await fetch('/api/auth/quick-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role })
      });

      const data = await res.json();
      if (res.ok && data.user && data.token) {
        const userProfile: UserProfile = {
          id: data.user.id,
          name: data.user.name || (role === 'admin' ? 'فرمانده ارشد سامورایی (مدیر ارشد)' : 'کاربر آزمایشی'),
          email: data.user.email,
          phoneNumber: data.user.phoneNumber,
          tier: data.user.tier || (data.user.isVip ? 'vip_samurai' : 'free'),
          isVip: Boolean(data.user.isVip),
          isAdmin: Boolean(data.user.isAdmin),
          vipSince: data.user.vipSince,
          vipExpiresAt: data.user.vipExpiresAt,
          paymentRefId: data.user.paymentRefId,
          activeCycleLimit: data.user.isVip ? 999 : 1
        };

        onAuthSuccess(data.token, userProfile);
        onClose();
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'خطا در ورود سریع.');
      setErrorField(null);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-safe pb-safe overscroll-contain overflow-y-auto max-h-[100dvh]" 
      dir="rtl"
    >
      <motion.div 
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        aria-describedby="auth-description"
        aria-busy={isLoading}
        tabIndex={-1}
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 15 }}
        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: shouldReduceMotion ? 0.05 : 0.2, ease: 'easeOut' }}
        className="surface-z3 border-standard radius-modal w-full max-w-md shadow-subtle overflow-hidden flex flex-col max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] my-auto focus:outline-none"
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-standard flex items-center justify-between surface-z3 shrink-0">
          <div className="flex items-center gap-3">
            {/* 5-click easter egg on KeyRound icon for developer bypass */}
            <button
              type="button"
              onClick={handleSecretIconClick}
              className="w-10 h-10 radius-component bg-amber flex items-center justify-center text-[var(--color-canvas-root)] font-black shadow-subtle active:scale-90 motion-reduce:transform-none transition-transform cursor-pointer focus-ring-tactical shrink-0"
              title="ورود سامورایی"
            >
              <Smartphone className="w-5 h-5 text-[var(--color-canvas-root)]" />
            </button>
            <div className="min-w-0">
              <h2 id="auth-title" className="text-sm sm:text-base font-black text-role-primary truncate">
                {currentUser?.id ? 'پروفایل و حساب کاربری' : 'مرام‌نامه رزمندگان بوشیدو'}
              </h2>
              <p id="auth-description" className="text-[11px] sm:text-xs text-role-secondary truncate">
                احراز هویت پیامکی امن، ورود با شماره موبایل و رمز عبور
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 min-w-[44px] min-h-[44px] radius-capsule surface-z1 hover:surface-z2 text-role-secondary hover:text-role-primary border-standard flex items-center justify-center transition cursor-pointer shrink-0 touch-manipulation focus-ring-tactical"
            aria-label="بستن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs (Only when not logged in) */}
        {!currentUser?.id && (
          <div role="tablist" aria-label="شیوه‌های احراز هویت" className="px-5 sm:px-6 pt-4 pb-2 surface-z2 border-b border-standard flex gap-2">
            <button
              id="auth-tab-login"
              type="button"
              role="tab"
              aria-selected={activeTab === 'login'}
              aria-controls="auth-panel-login"
              tabIndex={activeTab === 'login' ? 0 : -1}
              onKeyDown={handleTabKeyDown}
              onClick={() => switchTab('login')}
              className={`flex-1 min-h-[44px] py-2 radius-component text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap focus-ring-tactical ${
                activeTab === 'login'
                  ? 'bg-amber text-canvas-root shadow-subtle'
                  : 'surface-z1 hover:surface-z3 text-role-secondary hover:text-role-primary border-standard'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>ورود با شماره</span>
            </button>

            <button
              id="auth-tab-register"
              type="button"
              role="tab"
              aria-selected={activeTab === 'register'}
              aria-controls="auth-panel-register"
              tabIndex={activeTab === 'register' ? 0 : -1}
              onKeyDown={handleTabKeyDown}
              onClick={() => switchTab('register')}
              className={`flex-1 min-h-[44px] py-2 radius-component text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap focus-ring-tactical ${
                activeTab === 'register'
                  ? 'bg-amber text-canvas-root shadow-subtle'
                  : 'surface-z1 hover:surface-z3 text-role-secondary hover:text-role-primary border-standard'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>ثبت‌نام پیامکی</span>
            </button>

            <button
              id="auth-tab-forgot"
              type="button"
              role="tab"
              aria-selected={activeTab === 'forgot'}
              aria-controls="auth-panel-forgot"
              tabIndex={activeTab === 'forgot' ? 0 : -1}
              onKeyDown={handleTabKeyDown}
              onClick={() => switchTab('forgot')}
              className={`flex-1 min-h-[44px] py-2 radius-component text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap focus-ring-tactical ${
                activeTab === 'forgot'
                  ? 'bg-amber text-canvas-root shadow-subtle'
                  : 'surface-z1 hover:surface-z3 text-role-secondary hover:text-role-primary border-standard'
              }`}
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>بازیابی رمز</span>
            </button>
          </div>
        )}

        {/* Scrollable Content Body */}
        <div className="p-5 sm:p-6 overflow-y-auto overscroll-contain flex-1 min-h-0">
          {currentUser?.id ? (
            /* Logged in state */
            <div className="space-y-5">
              <div className="surface-z2 border-standard radius-card p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 radius-component surface-z3 flex items-center justify-center text-amber font-bold">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-role-primary">{currentUser.name}</div>
                      <div className="text-xs text-role-secondary font-mono" dir="ltr">
                        {currentUser.phoneNumber ? toPersianDigits(currentUser.phoneNumber) : (currentUser.email || `شناسه: ${toPersianDigits(currentUser.id.slice(0, 8))}`)}
                      </div>
                    </div>
                  </div>

                  {currentUser.isVip ? (
                    <span className="bg-amber-subtle text-amber text-[11px] font-black px-2.5 py-1 radius-component flex items-center gap-1">
                      <Crown className="w-3.5 h-3.5 text-amber" />
                      VIP
                    </span>
                  ) : (
                    <span className="surface-z3 text-role-secondary text-[11px] px-2.5 py-1 radius-control">
                      رایگان
                    </span>
                  )}
                </div>

                <div className="pt-2 border-t border-subtle grid grid-cols-2 gap-2 text-xs">
                  <div className="surface-z3 radius-component p-2.5 text-center">
                    <span className="text-[10px] text-role-muted block mb-0.5">وضعیت پایگاه داده</span>
                    <span className="text-emerald font-bold flex items-center justify-center gap-1">
                      <Database className="w-3.5 h-3.5 text-emerald" />
                      دیتابیس ابری
                    </span>
                  </div>
                  <div className="surface-z3 radius-component p-2.5 text-center">
                    <span className="text-[10px] text-role-muted block mb-0.5">سطح دسترسی</span>
                    <span className="text-amber font-bold">
                      {currentUser.isAdmin ? 'فرمانده ارشد (مدیر)' : (currentUser.isVip ? 'سامورایی ویژه VIP' : 'کاربر عادی')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full min-h-[44px] bg-debt-subtle hover:bg-debt/20 text-role-primary border border-debt-subtle font-bold text-sm py-3 radius-card flex items-center justify-center gap-2 transition cursor-pointer whitespace-nowrap focus-ring-tactical"
                >
                  <LogOut className="w-4 h-4 text-debt" />
                  خروج از حساب کاربری
                </button>
              </div>
            </div>
          ) : (
            /* Auth Forms by Tab */
            <div className="space-y-4">
              {/* TAB 1: PHONE-FIRST LOGIN */}
              {activeTab === 'login' && (
                <div role="tabpanel" id="auth-panel-login" aria-labelledby="auth-tab-login">
                  <form onSubmit={handleLogin} className="space-y-4">
                    <div>
                      <label htmlFor="auth-login-phone" className="block text-xs font-bold text-role-secondary mb-1.5">
                        شماره موبایل
                      </label>
                      <div className="relative">
                        <input
                          id="auth-login-phone"
                          type="tel"
                          value={phoneNumber}
                          onChange={e => setPhoneNumber(e.target.value)}
                          placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                          aria-invalid={errorField === 'phone'}
                          aria-describedby={errorMessage ? "auth-login-error" : undefined}
                          className="w-full surface-z2 border-standard radius-card px-4 py-3 text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-amber transition tracking-wider text-left font-mono"
                          dir="ltr"
                          autoFocus
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label htmlFor="auth-login-password" className="block text-xs font-bold text-role-secondary">
                          رمز عبور
                        </label>
                        <button
                          type="button"
                          onClick={() => {
                            switchTab('forgot');
                            setForgotStep('request');
                          }}
                          className="text-[11px] text-amber hover:underline cursor-pointer whitespace-nowrap"
                        >
                          فراموشی رمز عبور؟
                        </button>
                      </div>
                      <div className="relative">
                        <input
                          id="auth-login-password"
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={e => setPassword(e.target.value)}
                          placeholder="رمز عبور خود را وارد نمایید"
                          aria-invalid={errorField === 'password'}
                          aria-describedby={errorMessage ? "auth-login-error" : undefined}
                          className="w-full surface-z2 border-standard radius-card pl-11 pr-4 py-3 text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-amber transition"
                          dir="ltr"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                          title={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                          aria-pressed={showPassword}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-role-muted hover:text-role-primary transition p-1"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {errorMessage && (
                      <div id="auth-login-error" role="alert" aria-live="assertive" className="bg-debt-subtle border border-debt-subtle radius-component p-3 text-xs text-role-primary flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 text-debt" />
                        <span>{errorMessage}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isLoading}
                      className="w-full min-h-[44px] bg-amber hover:brightness-110 text-[var(--color-canvas-root)] font-black text-sm py-3.5 radius-card shadow-subtle flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
                    >
                      {isLoading ? (
                        <span className="w-5 h-5 border-2 border-[var(--color-canvas-root)] border-t-transparent radius-capsule animate-spin motion-reduce:animate-none"></span>
                      ) : (
                        <>
                          <span>ورود به سامانه</span>
                          <ArrowRight className="w-4 h-4 rotate-180" />
                        </>
                      )}
                    </button>

                    <div className="text-center pt-2">
                      <button
                        type="button"
                        onClick={() => {
                          switchTab('register');
                          setRegisterStep('request');
                        }}
                        className="text-xs text-role-secondary hover:text-amber transition cursor-pointer"
                      >
                        حساب کاربری ندارید؟ <span className="font-bold text-amber underline">ثبت‌نام پیامکی کنید</span>
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* TAB 2: PHONE-FIRST REGISTER (TWO-STEP: REQUEST OTP -> VERIFY & SET PASSWORD) */}
              {activeTab === 'register' && (
                <div role="tabpanel" id="auth-panel-register" aria-labelledby="auth-tab-register">
                  {registerStep === 'request' ? (
                    <form onSubmit={handleRegisterRequestOtp} className="space-y-4">
                      <div>
                        <label htmlFor="auth-register-phone" className="block text-xs font-bold text-role-secondary mb-1.5">
                          شماره موبایل (جهت دریافت کد تایید)
                        </label>
                        <input
                          id="auth-register-phone"
                          type="tel"
                          value={phoneNumber}
                          onChange={e => setPhoneNumber(e.target.value)}
                          placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                          aria-invalid={errorField === 'phone'}
                          aria-describedby={errorMessage ? "auth-register-error" : undefined}
                          className="w-full surface-z2 border-standard radius-card px-4 py-3 text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-amber transition tracking-wider text-left font-mono"
                          dir="ltr"
                          autoFocus
                        />
                        <p className="text-[11px] text-role-muted mt-1 leading-relaxed">
                          مالکیت شماره از طریق کد پیامکی ۵ رقمی راستی‌آزمایی خواهد شد.
                        </p>
                      </div>

                      <div>
                        <label htmlFor="auth-register-name" className="block text-xs font-bold text-role-secondary mb-1.5">
                          نام یا لقب سامورایی (اختیاری)
                        </label>
                        <input
                          id="auth-register-name"
                          type="text"
                          value={name}
                          onChange={e => setName(e.target.value)}
                          placeholder="مثال: سهراب یا نام شما"
                          className="w-full surface-z2 border-standard radius-card px-4 py-3 text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-amber transition"
                        />
                      </div>

                      {errorMessage && (
                        <div id="auth-register-error" role="alert" aria-live="assertive" className="bg-debt-subtle border border-debt-subtle radius-component p-3 text-xs text-role-primary flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-debt" />
                          <span>{errorMessage}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full min-h-[44px] bg-amber hover:brightness-110 text-[var(--color-canvas-root)] font-black text-sm py-3.5 radius-card shadow-subtle flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
                      >
                        {isLoading ? (
                          <span className="w-5 h-5 border-2 border-[var(--color-canvas-root)] border-t-transparent radius-capsule animate-spin motion-reduce:animate-none"></span>
                        ) : (
                          <>
                            <span>دریافت کد تایید پیامکی</span>
                            <ArrowRight className="w-4 h-4 rotate-180" />
                          </>
                        )}
                      </button>

                      <div className="text-center pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            switchTab('login');
                          }}
                          className="text-xs text-role-secondary hover:text-amber transition cursor-pointer"
                        >
                          قبلاً ثبت‌نام کرده‌اید؟ <span className="font-bold text-amber underline">وارد شوید</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={handleRegisterVerifyOtp} className="space-y-4">
                      <div role="status" aria-live="polite" className="bg-amber-subtle border border-amber-subtle radius-card p-3.5 text-xs text-amber">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-amber shrink-0" />
                            <span className="font-bold">ارسال کد تایید به شماره:</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setRegisterStep('request');
                              setErrorMessage('');
                              setErrorField(null);
                            }}
                            className="text-[11px] text-amber underline hover:brightness-110 cursor-pointer whitespace-nowrap"
                          >
                            تغییر شماره
                          </button>
                        </div>
                        <span className="font-mono text-amber block text-left" dir="ltr">
                          {toPersianDigits(phoneNumber)}
                        </span>
                        {debugOtp && (
                          <div className="mt-2 pt-2 border-t border-amber-subtle flex items-center justify-between text-[11px]">
                            <span className="text-amber/80">کد تایید پیامکی (محیط آزمایشی):</span>
                            <span className="font-mono font-black text-amber surface-z2 px-2 py-0.5 radius-badge">
                              {toPersianDigits(debugOtp)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="auth-register-otp" className="block text-xs font-bold text-role-secondary">
                            کد تایید ۵ رقمی
                          </label>
                          {resendCooldown > 0 ? (
                            <span role="status" aria-live="polite" className="text-[11px] text-role-muted font-mono">
                              ارسال مجدد تا {toPersianDigits(resendCooldown)} ثانیه
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRegisterRequestOtp()}
                              disabled={isLoading}
                              className="text-[11px] text-amber hover:underline cursor-pointer whitespace-nowrap"
                            >
                              ارسال مجدد کد
                            </button>
                          )}
                        </div>
                        <input
                          id="auth-register-otp"
                          type="text"
                          maxLength={6}
                          value={otpCode}
                          onChange={e => setOtpCode(e.target.value)}
                          placeholder="_____ "
                          aria-invalid={errorField === 'otp'}
                          aria-describedby={errorMessage ? "auth-register-verify-error" : undefined}
                          className="w-full surface-z2 border-standard radius-card px-4 py-3 text-center text-lg tracking-[0.4em] font-mono text-amber placeholder:text-role-muted focus:outline-none focus:border-amber transition"
                          dir="ltr"
                          autoFocus
                        />
                      </div>

                      <div>
                        <label htmlFor="auth-register-password" className="block text-xs font-bold text-role-secondary mb-1.5">
                          تعیین رمز عبور (حداقل ۸ نویسه)
                        </label>
                        <div className="relative">
                          <input
                            id="auth-register-password"
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="رمز عبور دلخواه خود را تعیین کنید"
                            aria-invalid={errorField === 'password'}
                            aria-describedby={errorMessage ? "auth-register-verify-error" : undefined}
                            className="w-full surface-z2 border-standard radius-card pl-11 pr-4 py-3 text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-amber transition"
                            dir="ltr"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            aria-label={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                            title={showPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                            aria-pressed={showPassword}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-role-muted hover:text-role-primary transition p-1"
                          >
                            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {errorMessage && (
                        <div id="auth-register-verify-error" role="alert" aria-live="assertive" className="bg-debt-subtle border border-debt-subtle radius-component p-3 text-xs text-role-primary flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-debt" />
                          <span>{errorMessage}</span>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setRegisterStep('request');
                            setErrorField(null);
                            setErrorMessage('');
                          }}
                          className="w-1/3 min-h-[44px] surface-z2 hover:surface-z3 border-standard text-role-secondary text-xs font-bold py-3.5 radius-card transition cursor-pointer whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
                        >
                          تغییر شماره
                        </button>
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="w-2/3 min-h-[44px] bg-amber hover:brightness-110 text-[var(--color-canvas-root)] font-black text-sm py-3.5 radius-card shadow-subtle flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
                        >
                          {isLoading ? (
                            <span className="w-5 h-5 border-2 border-[var(--color-canvas-root)] border-t-transparent radius-capsule animate-spin motion-reduce:animate-none"></span>
                          ) : (
                            <span>تکمیل ثبت‌نام و ورود</span>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* TAB 3: FORGOT PASSWORD (OTP-BASED RECOVERY) */}
              {activeTab === 'forgot' && (
                <div role="tabpanel" id="auth-panel-forgot" aria-labelledby="auth-tab-forgot">
                  {forgotStep === 'request' ? (
                    <form onSubmit={handleForgotRequestOtp} className="space-y-4">
                      <p className="text-xs text-role-secondary leading-relaxed">
                        جهت بازیابی رمز عبور، شماره موبایل ثبت‌نام‌شده در سامانه را وارد کنید تا کد تایید امن برای شما پیامک شود.
                      </p>

                      <div>
                        <label htmlFor="auth-forgot-phone" className="block text-xs font-bold text-role-secondary mb-1.5">
                          شماره موبایل
                        </label>
                        <input
                          id="auth-forgot-phone"
                          type="tel"
                          value={phoneNumber}
                          onChange={e => setPhoneNumber(e.target.value)}
                          placeholder="۰۹۱۲۳۴۵۶۷۸۹"
                          aria-invalid={errorField === 'phone'}
                          aria-describedby={errorMessage ? "auth-forgot-error" : undefined}
                          className="w-full surface-z2 border-standard radius-card px-4 py-3 text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-amber transition tracking-wider text-left font-mono"
                          dir="ltr"
                          autoFocus
                        />
                      </div>

                      {errorMessage && (
                        <div id="auth-forgot-error" role="alert" aria-live="assertive" className="bg-debt-subtle border border-debt-subtle radius-component p-3 text-xs text-role-primary flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-debt" />
                          <span>{errorMessage}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full min-h-[44px] bg-amber hover:brightness-110 text-[var(--color-canvas-root)] font-black text-sm py-3.5 radius-card shadow-subtle flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
                      >
                        {isLoading ? (
                          <span className="w-5 h-5 border-2 border-[var(--color-canvas-root)] border-t-transparent radius-capsule animate-spin motion-reduce:animate-none"></span>
                        ) : (
                          <>
                            <span>ارسال کد تایید بازیابی</span>
                            <ArrowRight className="w-4 h-4 rotate-180" />
                          </>
                        )}
                      </button>

                      <div className="text-center pt-2">
                        <button
                          type="button"
                          onClick={() => {
                            switchTab('login');
                          }}
                          className="text-xs text-role-secondary hover:text-role-primary transition cursor-pointer"
                        >
                          بازگشت به <span className="font-bold text-amber underline">صفحه ورود</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={handleResetPassword} className="space-y-4">
                      <div role="status" aria-live="polite" className="bg-amber-subtle border border-amber-subtle radius-card p-3.5 text-xs text-amber">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4 text-amber shrink-0" />
                            <span className="font-bold">کد بازیابی ارسال شد به:</span>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setForgotStep('request');
                              setErrorField(null);
                              setErrorMessage('');
                            }}
                            className="text-[11px] text-amber underline hover:brightness-110 cursor-pointer whitespace-nowrap"
                          >
                            تغییر شماره
                          </button>
                        </div>
                        <span className="font-mono text-amber block text-left" dir="ltr">
                          {toPersianDigits(phoneNumber)}
                        </span>
                        {debugOtp && (
                          <div className="mt-2 pt-2 border-t border-amber-subtle flex items-center justify-between text-[11px]">
                            <span className="text-amber/80">کد تایید آزمایشی:</span>
                            <span className="font-mono font-black text-amber surface-z2 px-2 py-0.5 radius-badge">
                              {toPersianDigits(debugOtp)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <label htmlFor="auth-forgot-otp" className="block text-xs font-bold text-role-secondary">
                            کد تایید ۵ رقمی
                          </label>
                          {resendCooldown > 0 ? (
                            <span role="status" aria-live="polite" className="text-[11px] text-role-muted font-mono">
                              ارسال مجدد تا {toPersianDigits(resendCooldown)} ثانیه
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleForgotRequestOtp()}
                              disabled={isLoading}
                              className="text-[11px] text-amber hover:underline cursor-pointer whitespace-nowrap"
                            >
                              ارسال مجدد کد
                            </button>
                          )}
                        </div>
                        <input
                          id="auth-forgot-otp"
                          type="text"
                          maxLength={6}
                          value={otpCode}
                          onChange={e => setOtpCode(e.target.value)}
                          placeholder="_____ "
                          aria-invalid={errorField === 'otp'}
                          aria-describedby={errorMessage ? "auth-forgot-reset-error" : undefined}
                          className="w-full surface-z2 border-standard radius-card px-4 py-3 text-center text-lg tracking-[0.4em] font-mono text-amber placeholder:text-role-muted focus:outline-none focus:border-amber transition"
                          dir="ltr"
                          autoFocus
                        />
                      </div>

                      <div>
                        <label htmlFor="auth-forgot-new-password" className="block text-xs font-bold text-role-secondary mb-1.5">
                          رمز عبور جدید (حداقل ۸ نویسه)
                        </label>
                        <div className="relative">
                          <input
                            id="auth-forgot-new-password"
                            type={showNewPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            placeholder="رمز عبور جدید را وارد کنید"
                            aria-invalid={errorField === 'newPassword'}
                            aria-describedby={errorMessage ? "auth-forgot-reset-error" : undefined}
                            className="w-full surface-z2 border-standard radius-card pl-11 pr-4 py-3 text-sm text-role-primary placeholder:text-role-muted focus:outline-none focus:border-amber transition"
                            dir="ltr"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            aria-label={showNewPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                            title={showNewPassword ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور'}
                            aria-pressed={showNewPassword}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-role-muted hover:text-role-primary transition p-1"
                          >
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {errorMessage && (
                        <div id="auth-forgot-reset-error" role="alert" aria-live="assertive" className="bg-debt-subtle border border-debt-subtle radius-component p-3 text-xs text-role-primary flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-debt" />
                          <span>{errorMessage}</span>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setForgotStep('request')}
                          className="w-1/3 min-h-[44px] surface-z2 hover:surface-z3 border-standard text-role-secondary text-xs font-bold py-3.5 radius-card transition cursor-pointer whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
                        >
                          تغییر شماره
                        </button>
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="w-2/3 min-h-[44px] bg-amber hover:brightness-110 text-[var(--color-canvas-root)] font-black text-sm py-3.5 radius-card shadow-subtle flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical"
                        >
                          {isLoading ? (
                            <span className="w-5 h-5 border-2 border-[var(--color-canvas-root)] border-t-transparent radius-capsule animate-spin motion-reduce:animate-none"></span>
                          ) : (
                            <span>تغییر رمز و ورود</span>
                          )}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}

              {/* Secret Admin/Dev Mode: Only visible if unlocked via 5-click easter egg & passcode */}
              {showSecretDev && (
                <div className="pt-4 border-t border-amber-subtle space-y-3 animate-in fade-in zoom-in-95 duration-200">
                  <div className="text-[11px] text-amber font-bold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber" />
                      دسترسی مدیریت و توسعه:
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setShowSecretDev(false);
                        try {
                          localStorage.setItem('bushido_secret_dev_mode', 'false');
                        } catch {}
                      }}
                      className="text-[10px] text-role-secondary hover:text-role-primary surface-z2 px-2 py-0.5 radius-badge border-standard cursor-pointer whitespace-nowrap"
                    >
                      مخفی‌سازی
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickLogin('admin')}
                      disabled={isLoading}
                      className="bg-debt-subtle hover:bg-debt/20 border border-debt-subtle text-role-primary radius-component p-2.5 text-right transition cursor-pointer text-xs focus-ring-tactical"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-debt">
                        <ShieldCheck className="w-3.5 h-3.5 text-debt" />
                        <span>ورود به عنوان مدیر</span>
                      </div>
                      <span className="text-[10px] text-role-muted block mt-0.5">فرمانده ارشد (09375454050)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickLogin('test_user')}
                      disabled={isLoading}
                      className="surface-z2 hover:surface-z3 border-standard text-role-primary radius-component p-2.5 text-right transition cursor-pointer text-xs focus-ring-tactical"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-role-primary">
                        <User className="w-3.5 h-3.5 text-amber" />
                        <span>ورود کاربر تستی</span>
                      </div>
                      <span className="text-[10px] text-role-muted block mt-0.5">مشاهده از دید کاربر</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
