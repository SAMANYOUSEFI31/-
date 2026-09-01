import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile } from '../types';
import { toPersianDigits } from '../utils/numberUtils';
import { haptics } from '../utils/haptics';
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

type AuthTab = 'login' | 'register' | 'forgot';

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAuthSuccess,
  onLogout
}) => {
  const [activeTab, setActiveTab] = useState<AuthTab>('login');
  
  // Form fields
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Forgot password OTP fields
  const [forgotStep, setForgotStep] = useState<'request' | 'reset'>('request');
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [debugOtp, setDebugOtp] = useState<string | null>(null);

  // Status state
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  // Hidden secret dev/admin mode state (hidden from public users)
  const [showSecretDev, setShowSecretDev] = useState(false);
  const secretClickCountRef = useRef(0);
  const secretTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage('');
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

  // 1. Direct Login Handler
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const cleanId = identifier.trim();
    if (!cleanId) {
      setErrorMessage('لطفاً شماره موبایل یا ایمیل خود را وارد نمایید.');
      haptics.warningAlert();
      return;
    }

    if (!password) {
      setErrorMessage('لطفاً رمز عبور خود را وارد نمایید.');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanId, password })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ورود به سامانه با خطا مواجه شد.');
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
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Direct Register Handler
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');

    const cleanId = identifier.trim();
    if (!cleanId) {
      setErrorMessage('لطفاً شماره موبایل یا ایمیل خود را وارد نمایید.');
      haptics.warningAlert();
      return;
    }

    if (!password || password.length < 4) {
      setErrorMessage('رمز عبور باید حداقل دارای ۴ نویسه (کاراکتر) باشد.');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: cleanId,
          password,
          name: name.trim() || undefined
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ثبت‌نام با خطا مواجه شد.');
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
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Forgot Password - Request OTP
  const handleForgotRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    setDebugOtp(null);

    const cleanId = identifier.trim();
    if (!cleanId) {
      setErrorMessage('لطفاً شماره موبایل یا ایمیل خود را وارد نمایید.');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: cleanId })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'ارسال کد بازیابی با خطا مواجه شد.');
      }

      setSuccessMessage(data.message || 'کد تایید بازیابی رمز عبور ارسال شد.');
      if (data.debugCode) {
        setDebugOtp(data.debugCode);
        setOtpCode(data.debugCode);
      }
      setForgotStep('reset');
    } catch (err: any) {
      haptics.warningAlert();
      setErrorMessage(err.message || 'خطا در ارسال کد تایید.');
    } finally {
      setIsLoading(false);
    }
  };

  // 4. Forgot Password - Reset with OTP
  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!otpCode.trim()) {
      setErrorMessage('لطفاً کد تایید ۵ رقمی را وارد نمایید.');
      haptics.warningAlert();
      return;
    }

    if (!newPassword || newPassword.length < 4) {
      setErrorMessage('رمز عبور جدید باید حداقل دارای ۴ نویسه باشد.');
      haptics.warningAlert();
      return;
    }

    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: identifier.trim(),
          code: otpCode.trim(),
          newPassword
        })
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'بازنشانی رمز عبور با خطا مواجه شد.');
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
    } finally {
      setIsLoading(false);
    }
  };

  // Quick Login for Dev/Admin
  const handleQuickLogin = async (role: 'admin' | 'test_user') => {
    setIsLoading(true);
    setErrorMessage('');
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
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] overscroll-contain overflow-y-auto max-h-[100dvh]" 
      dir="rtl"
    >
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="bg-zinc-900 border border-zinc-800 rounded-2xl sm:rounded-3xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col max-h-[min(92dvh,calc(100dvh-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px)-1.5rem))] my-auto"
      >
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-[#09090b]/80 shrink-0">
          <div className="flex items-center gap-3">
            {/* 5-click easter egg on KeyRound icon for developer bypass */}
            <button
              type="button"
              onClick={handleSecretIconClick}
              className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-600 flex items-center justify-center text-black font-black shadow-lg shadow-amber-500/20 active:scale-90 transition-transform cursor-pointer focus:outline-none shrink-0"
              title="ورود سامورایی"
            >
              <KeyRound className="w-5 h-5 text-black" />
            </button>
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-black text-white truncate">
                {currentUser?.id ? 'پروفایل و حساب کاربری' : 'مرام‌نامه رزمندگان بوشیدو'}
              </h2>
              <p className="text-[11px] sm:text-xs text-zinc-400 truncate">
                احراز هویت مستقل، ورود مستقیم با رمز عبور و دیتابیس ابری
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-zinc-800/80 hover:bg-zinc-800 text-zinc-400 hover:text-white flex items-center justify-center transition cursor-pointer shrink-0 touch-manipulation"
            aria-label="بستن"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs (Only when not logged in) */}
        {!currentUser?.id && (
          <div className="px-5 sm:px-6 pt-4 pb-2 bg-[#09090b]/50 border-b border-zinc-800/50 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setActiveTab('login');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'login'
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              <span>ورود با رمز</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('register');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'register'
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              <span>ثبت‌نام مستقیم</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActiveTab('forgot');
                setForgotStep('request');
                setErrorMessage('');
                setSuccessMessage('');
              }}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition flex items-center justify-center gap-1.5 cursor-pointer ${
                activeTab === 'forgot'
                  ? 'bg-amber-500 text-black shadow-md shadow-amber-500/20'
                  : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200'
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
              <div className="bg-[#09090b]/80 border border-zinc-800/80 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-amber-400 font-bold">
                      <User className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-bold text-sm text-zinc-100">{currentUser.name}</div>
                      <div className="text-xs text-zinc-400 font-mono">
                        {currentUser.phoneNumber || currentUser.email || `کاربر: ${toPersianDigits(currentUser.id.slice(0, 8))}`}
                      </div>
                    </div>
                  </div>

                  {currentUser.isVip ? (
                    <span className="bg-gradient-to-r from-amber-500/20 to-yellow-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-black px-2.5 py-1 rounded-xl flex items-center gap-1">
                      <Crown className="w-3.5 h-3.5 text-amber-400" />
                      VIP
                    </span>
                  ) : (
                    <span className="bg-zinc-800 text-zinc-400 text-[11px] px-2 py-0.5 rounded-lg">
                      رایگان
                    </span>
                  )}
                </div>

                <div className="pt-2 border-t border-zinc-800/60 grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[#121215]/90 rounded-xl p-2.5 text-center">
                    <span className="text-[10px] text-zinc-400 block mb-0.5">وضعیت داده‌ها</span>
                    <span className="text-emerald-400 font-bold flex items-center justify-center gap-1">
                      <Database className="w-3.5 h-3.5" />
                      دیتابیس ابری
                    </span>
                  </div>
                  <div className="bg-[#121215]/90 rounded-xl p-2.5 text-center">
                    <span className="text-[10px] text-zinc-400 block mb-0.5">سطح دسترسی</span>
                    <span className="text-amber-400 font-bold">
                      {currentUser.isAdmin ? 'فرمانده ارشد (مدیر)' : (currentUser.isVip ? 'سامورایی ویژه VIP' : 'کاربر عادی')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={onLogout}
                  className="w-full bg-red-950/40 hover:bg-red-900/60 text-red-300 border border-red-800/40 font-bold text-sm py-3 rounded-2xl flex items-center justify-center gap-2 transition cursor-pointer"
                >
                  <LogOut className="w-4 h-4" />
                  خروج از حساب کاربری
                </button>
              </div>
            </div>
          ) : (
            /* Auth Forms by Tab */
            <div className="space-y-4">
              {/* TAB 1: DIRECT LOGIN */}
              {activeTab === 'login' && (
                <form onSubmit={handleLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                      شماره موبایل یا ایمیل
                    </label>
                    <div className="relative">
                      <input
                        type="text"
                        value={identifier}
                        onChange={e => setIdentifier(e.target.value)}
                        placeholder="مثال: 09375454050 یا admin@bushido.app"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        dir="ltr"
                        autoFocus
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="block text-xs font-bold text-zinc-300">
                        رمز عبور
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('forgot');
                          setForgotStep('request');
                          setErrorMessage('');
                        }}
                        className="text-[11px] text-amber-400/90 hover:text-amber-300 hover:underline cursor-pointer"
                      >
                        فراموشی رمز عبور؟
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="رمز عبور خود را وارد نمایید"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition p-1"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="bg-red-950/60 border border-red-800/50 rounded-xl p-3 text-xs text-red-300 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black text-sm py-3.5 rounded-2xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    {isLoading ? (
                      <span className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <>
                        <span>ورود به میدان نبرد بوشیدو</span>
                        <ArrowRight className="w-4 h-4 rotate-180" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('register');
                        setErrorMessage('');
                      }}
                      className="text-xs text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                    >
                      حساب کاربری ندارید؟ <span className="font-bold text-amber-400 underline">ثبت‌نام مستقیم کنید</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 2: DIRECT REGISTER */}
              {activeTab === 'register' && (
                <form onSubmit={handleRegister} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                      شماره موبایل یا ایمیل
                    </label>
                    <input
                      type="text"
                      value={identifier}
                      onChange={e => setIdentifier(e.target.value)}
                      placeholder="مثال: 09121234567 یا user@example.com"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                      dir="ltr"
                      autoFocus
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                      نام یا لقب سامورایی (اختیاری)
                    </label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="مثال: رستم، سهراب، یا نام شما"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                      تعیین رمز عبور (حداقل ۴ نویسه)
                    </label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        placeholder="رمز عبور دلخواه خود را تعیین کنید"
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                        dir="ltr"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition p-1"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {errorMessage && (
                    <div className="bg-red-950/60 border border-red-800/50 rounded-xl p-3 text-xs text-red-300 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                      <span>{errorMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black text-sm py-3.5 rounded-2xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                  >
                    {isLoading ? (
                      <span className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
                    ) : (
                      <>
                        <span>ثبت‌نام و ورود مستقیم</span>
                        <ArrowRight className="w-4 h-4 rotate-180" />
                      </>
                    )}
                  </button>

                  <div className="text-center pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('login');
                        setErrorMessage('');
                      }}
                      className="text-xs text-zinc-400 hover:text-amber-400 transition cursor-pointer"
                    >
                      قبلاً ثبت‌نام کرده‌اید؟ <span className="font-bold text-amber-400 underline">وارد شوید</span>
                    </button>
                  </div>
                </form>
              )}

              {/* TAB 3: FORGOT PASSWORD (OTP-BASED RECOVERY) */}
              {activeTab === 'forgot' && (
                <div>
                  {forgotStep === 'request' ? (
                    <form onSubmit={handleForgotRequestOtp} className="space-y-4">
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        جهت بازیابی رمز عبور، شماره موبایل یا ایمیل حساب کاربری خود را وارد کنید تا کد تایید امن برای شما ارسال شود.
                      </p>

                      <div>
                        <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                          شماره موبایل یا ایمیل
                        </label>
                        <input
                          type="text"
                          value={identifier}
                          onChange={e => setIdentifier(e.target.value)}
                          placeholder="مثال: 09121234567 یا user@example.com"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                          dir="ltr"
                          autoFocus
                        />
                      </div>

                      {errorMessage && (
                        <div className="bg-red-950/60 border border-red-800/50 rounded-xl p-3 text-xs text-red-300 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                          <span>{errorMessage}</span>
                        </div>
                      )}

                      <button
                        type="submit"
                        disabled={isLoading}
                        className="w-full bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black text-sm py-3.5 rounded-2xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                      >
                        {isLoading ? (
                          <span className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
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
                            setActiveTab('login');
                            setErrorMessage('');
                          }}
                          className="text-xs text-zinc-400 hover:text-zinc-200 transition cursor-pointer"
                        >
                          بازگشت به <span className="font-bold text-amber-400 underline">صفحه ورود</span>
                        </button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={handleResetPassword} className="space-y-4">
                      <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-3.5 text-xs text-amber-200">
                        <div className="flex items-center gap-2 mb-1">
                          <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                          <span className="font-bold">کد بازیابی ارسال شد به:</span>
                        </div>
                        <span className="font-mono text-amber-300 block text-left" dir="ltr">
                          {identifier}
                        </span>
                        {debugOtp && (
                          <div className="mt-2 pt-2 border-t border-amber-500/20 flex items-center justify-between text-[11px]">
                            <span className="text-amber-400/80">کد تایید آزمایشی:</span>
                            <span className="font-mono font-black text-amber-300 bg-amber-900/60 px-2 py-0.5 rounded-md">
                              {toPersianDigits(debugOtp)}
                            </span>
                          </div>
                        )}
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                          کد تایید ۵ رقمی
                        </label>
                        <input
                          type="text"
                          maxLength={6}
                          value={otpCode}
                          onChange={e => setOtpCode(e.target.value)}
                          placeholder="_____ "
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-center text-lg tracking-[0.4em] font-mono text-amber-400 placeholder:text-zinc-700 focus:outline-none focus:border-amber-500 transition"
                          dir="ltr"
                          autoFocus
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-zinc-300 mb-1.5">
                          رمز عبور جدید
                        </label>
                        <div className="relative">
                          <input
                            type={showNewPassword ? 'text' : 'password'}
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            placeholder="رمز عبور جدید را وارد کنید"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-11 pr-4 py-3 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-amber-500 transition"
                            dir="ltr"
                          />
                          <button
                            type="button"
                            onClick={() => setShowNewPassword(!showNewPassword)}
                            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition p-1"
                          >
                            {showNewPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      {errorMessage && (
                        <div className="bg-red-950/60 border border-red-800/50 rounded-xl p-3 text-xs text-red-300 flex items-center gap-2">
                          <AlertCircle className="w-4 h-4 shrink-0 text-red-400" />
                          <span>{errorMessage}</span>
                        </div>
                      )}

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setForgotStep('request')}
                          className="w-1/3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold py-3.5 rounded-2xl transition cursor-pointer"
                        >
                          تغییر شماره
                        </button>
                        <button
                          type="submit"
                          disabled={isLoading}
                          className="w-2/3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black text-sm py-3.5 rounded-2xl shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2 transition cursor-pointer disabled:opacity-50"
                        >
                          {isLoading ? (
                            <span className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin"></span>
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
                <div className="pt-4 border-t border-amber-500/30 space-y-3 animate-in fade-in zoom-in-95 duration-200">
                  <div className="text-[11px] text-amber-300 font-bold flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Lock className="w-3.5 h-3.5 text-amber-400" />
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
                      className="text-[10px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 px-2 py-0.5 rounded cursor-pointer"
                    >
                      مخفی‌سازی
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => handleQuickLogin('admin')}
                      disabled={isLoading}
                      className="bg-red-950/40 hover:bg-red-900/60 border border-red-500/40 hover:border-red-500/60 text-red-300 rounded-xl p-2.5 text-right transition cursor-pointer text-xs"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-red-300">
                        <ShieldCheck className="w-3.5 h-3.5 text-red-400" />
                        <span>ورود به عنوان مدیر</span>
                      </div>
                      <span className="text-[10px] text-zinc-400 block mt-0.5">فرمانده ارشد (09375454050)</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleQuickLogin('test_user')}
                      disabled={isLoading}
                      className="bg-zinc-800/80 hover:bg-zinc-750 border border-zinc-700 text-zinc-200 rounded-xl p-2.5 text-right transition cursor-pointer text-xs"
                    >
                      <div className="flex items-center gap-1.5 font-bold text-zinc-200">
                        <User className="w-3.5 h-3.5 text-amber-400" />
                        <span>ورود کاربر تستی</span>
                      </div>
                      <span className="text-[10px] text-zinc-400 block mt-0.5">مشاهده از دید کاربر</span>
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
