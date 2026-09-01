import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { UserProfile, SubscriptionPlan } from '../types';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { 
  ShieldCheck, 
  Crown, 
  Sparkles, 
  Check, 
  Lock, 
  CreditCard, 
  ArrowRight, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Loader2, 
  FileBadge, 
  Flame, 
  HelpCircle,
  QrCode
} from 'lucide-react';

interface PaymentModalProps {
  userProfile: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: (updatedProfile: UserProfile) => void;
}

const PLANS: SubscriptionPlan[] = [
  {
    id: 'samurai_90days',
    title: 'فصل ۹۰ روزه سامورایی VIP',
    titleFa: 'اشتراک یک فصل کامل (۹۰ روز)',
    priceToman: 199000,
    formattedPrice: '۱۹۹,۰۰۰',
    durationMonths: 3,
    badgeFa: 'پیشنهاد ویژه دیوان',
    isPopular: true,
    features: [
      'دسترسی نامحدود به کالبدشکافی عمیق شکست‌ها',
      'مشاوره راهبردی نامحدود با سنسی بوشیدو',
      'صدور گواهینامه رسمی دیوان پایان دوره با مهر طلایی',
      'امکان تعریف و بایگانی نامحدود چرخه‌های ۹۰ روزه',
      'نشان اختصاصی سامورایی ویژه در پروفایل کاربری',
      'پشتیبان‌گیری ابری و خروجی دیتابیس بدون محدودیت'
    ]
  },
  {
    id: 'samurai_annual',
    title: 'عضویت سالانه دلاوران بوشیدو',
    titleFa: 'اشتراک سالانه (۴ چرخه ۹۰ روزه)',
    priceToman: 590000,
    formattedPrice: '۵۹۰,۰۰۰',
    durationMonths: 12,
    badgeFa: '۳۰٪ تخفیف طلایی',
    features: [
      'شامل تمام امکانات پلن ۹۰ روزه',
      'دسترسی مادام‌العمر به آرشیو تحلیل‌های شکست',
      'اولویت در دریافت امکانات و ابزارهای جدید',
      'نشان افسانه‌ای جنگجوی برتر (Legendary Warrior)'
    ]
  }
];

export const PaymentModal: React.FC<PaymentModalProps> = ({
  userProfile,
  isOpen,
  onClose,
  onUpgradeSuccess
}) => {
  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(PLANS[0]);
  const [step, setStep] = useState<'plans' | 'gateway' | 'success'>('plans');
  const [isLoading, setIsLoading] = useState(false);
  const [authority, setAuthority] = useState<string>('');
  
  // Gateway Form Simulation State
  const [cardNumber, setCardNumber] = useState('6037 9974 8123 4512');
  const [cvv2, setCvv2] = useState('834');
  const [expMonth, setExpMonth] = useState('08');
  const [expYear, setExpYear] = useState('06');
  const [otpCode, setOtpCode] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpTimer, setOtpTimer] = useState(120);
  const [captchaInput, setCaptchaInput] = useState('8492');
  const [generatedCaptcha, setGeneratedCaptcha] = useState('8492');
  const [paymentError, setPaymentError] = useState('');
  const [receiptData, setReceiptData] = useState<{ refId: string; date: string } | null>(null);

  // OTP Countdown timer
  useEffect(() => {
    let interval: any = null;
    if (otpSent && otpTimer > 0) {
      interval = setInterval(() => {
        setOtpTimer(prev => prev - 1);
      }, 1000);
    } else if (otpTimer === 0) {
      setOtpSent(false);
    }
    return () => clearInterval(interval);
  }, [otpSent, otpTimer]);

  if (!isOpen) return null;

  const handleStartPayment = async () => {
    setIsLoading(true);
    setPaymentError('');
    try {
      const token = localStorage.getItem('bushido_auth_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const res = await fetch('/api/payment/request', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          planId: selectedPlan.id,
          amount: selectedPlan.priceToman,
          description: `ارتقا به ${selectedPlan.title}`,
          userEmail: userProfile.email
        })
      });
      const data = await res.json();
      if (data.status === 100 && data.authority) {
        setAuthority(data.authority);
        setStep('gateway');
        setOtpCode('');
        setOtpSent(false);
        setOtpTimer(120);
        // Refresh mock captcha
        const newCap = Math.floor(1000 + Math.random() * 9000).toString();
        setGeneratedCaptcha(newCap);
        setCaptchaInput(newCap);
      } else {
        setPaymentError('خطا در اتصال به درگاه پرداخت.');
      }
    } catch (err) {
      console.error('Payment request error:', err);
      setPaymentError('عدم دسترسی به سرور پرداخت.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendOtp = () => {
    setOtpSent(true);
    setOtpTimer(120);
    const mockOtp = Math.floor(100000 + Math.random() * 900000).toString();
    setOtpCode(mockOtp);
    soundFX.playCheck();
  };

  const handleVerifyPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode) {
      setPaymentError('لطفاً رمز دوم یکبارمصرف (پویا) را وارد نمایید.');
      return;
    }
    if (captchaInput !== generatedCaptcha) {
      setPaymentError('کد امنیتی تصویر صحیح نیست.');
      return;
    }

    setIsLoading(true);
    setPaymentError('');

    try {
      const res = await fetch('/api/payment/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authority: authority || 'MOCK-AUTH-1234',
          amount: selectedPlan.priceToman
        })
      });
      const data = await res.json();

      if (data.status === 100) {
        const now = new Date();
        const expDate = new Date();
        expDate.setDate(expDate.getDate() + (selectedPlan.durationMonths * 30));

        const updated: UserProfile = {
          ...userProfile,
          tier: 'vip_samurai',
          isVip: true,
          vipSince: now.toISOString(),
          vipExpiresAt: expDate.toISOString(),
          paymentRefId: data.refId,
          activeCycleLimit: 99
        };

        setReceiptData({
          refId: data.refId,
          date: new Intl.DateTimeFormat('fa-IR', { dateStyle: 'long', timeStyle: 'short' }).format(now)
        });

        setStep('success');
        onUpgradeSuccess(updated);
        soundFX.playMastery();
        haptics.masterySuccess();
      } else {
        setPaymentError(data.message || 'پرداخت از طرف بانک تایید نشد.');
        haptics.warningAlert();
      }
    } catch (err) {
      console.error('Verify error:', err);
      setPaymentError('خطا در تایید تراکنش.');
      haptics.warningAlert();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4 pt-[max(0.75rem,calc(env(safe-area-inset-top,0px)+0.5rem))] pb-[max(0.75rem,calc(env(safe-area-inset-bottom,0px)+0.5rem))] overflow-y-auto" 
      dir="rtl"
    >
      <div 
        className="fixed inset-0" 
        onClick={onClose}
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="relative z-10 bg-zinc-900 border border-amber-500/40 rounded-2xl sm:rounded-3xl w-full max-w-2xl text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] my-auto"
      >
        {/* STEP 1: PLANS SELECTION */}
        {step === 'plans' && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            {/* Header */}
            <div className="p-4 sm:p-6 bg-gradient-to-r from-amber-950/60 via-zinc-900 to-zinc-950 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/40 flex items-center justify-center shadow-lg shrink-0">
                  <Crown className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h2 className="text-sm sm:text-lg md:text-xl font-black text-zinc-100 flex items-center gap-2">
                    ارتقا به اشتراک «سامورایی ویژه VIP»
                  </h2>
                  <p className="text-[10px] sm:text-xs text-zinc-400 mt-0.5">
                    فعال‌سازی تمامی ابزارهای مهندسی دیسیپلین، آنالیز و صدور گواهینامه
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition cursor-pointer shrink-0 touch-manipulation"
                aria-label="بستن"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto overscroll-contain flex-1 min-h-0">
              {/* Plan Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4">
                {PLANS.map(plan => {
                  const isSelected = selectedPlan.id === plan.id;
                  return (
                    <div
                      key={plan.id}
                      onClick={() => setSelectedPlan(plan)}
                      className={`rounded-2xl p-4 sm:p-5 border-2 transition-all cursor-pointer relative flex flex-col justify-between ${
                        isSelected
                          ? 'bg-amber-950/30 border-amber-500 shadow-xl shadow-amber-500/10'
                          : 'bg-[#09090b]/70 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      {plan.isPopular && (
                        <div className="absolute -top-3 left-4 bg-amber-500 text-black text-[10px] font-black px-2.5 py-0.5 rounded-full shadow">
                          {plan.badgeFa}
                        </div>
                      )}

                      <div className="space-y-2.5 sm:space-y-3">
                        <div className="flex items-center justify-between">
                          <h3 className="font-bold text-xs sm:text-sm text-zinc-100">{plan.title}</h3>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            isSelected ? 'border-amber-400 bg-amber-400 text-black' : 'border-zinc-600'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>

                        <div className="flex items-baseline gap-1">
                          <span className="text-xl sm:text-3xl font-black font-mono text-amber-400">
                            {plan.formattedPrice}
                          </span>
                          <span className="text-xs text-zinc-400">تومان</span>
                        </div>

                        <ul className="space-y-1.5 sm:space-y-2 pt-2 border-t border-zinc-800/80 text-[11px] sm:text-xs text-zinc-300">
                          {plan.features.map((feat, i) => (
                            <li key={i} className="flex items-start gap-1.5 sm:gap-2">
                              <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                              <span>{feat}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Secure Payment Note */}
              <div className="bg-[#09090b]/80 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex items-center justify-between text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-[11px] sm:text-xs">اتصال امن به درگاه پرداخت شاپرک</span>
                </div>
                <span className="text-[10px] sm:text-[11px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded shrink-0">
                  شبیه‌ساز پرداخت
                </span>
              </div>

              {paymentError && (
                <div className="bg-red-950/60 border border-red-500/40 rounded-xl p-3 text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* Action Button */}
              <div className="flex items-center justify-end gap-2.5 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2.5 sm:px-5 sm:py-2.5 min-h-[44px] rounded-xl text-zinc-400 hover:text-white text-xs font-semibold cursor-pointer touch-manipulation"
                >
                  انصراف
                </button>

                <button
                  type="button"
                  onClick={handleStartPayment}
                  disabled={isLoading}
                  className="bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-black text-xs sm:text-sm px-5 py-2.5 sm:px-6 sm:py-3 rounded-2xl flex items-center gap-2 shadow-lg shadow-amber-500/20 transition cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      در حال اتصال به درگاه...
                    </>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" />
                      پرداخت آنلاین {selectedPlan.formattedPrice} تومان
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: REALISTIC MOCK IRANIAN PAYMENT GATEWAY (ZARINPAL / SHAPARAK) */}
        {step === 'gateway' && (
          <div className="bg-[#f8fafc] text-zinc-900 flex flex-col flex-1 overflow-hidden min-h-0">
            {/* Gateway Navbar */}
            <div className="bg-[#1e293b] text-white px-4 sm:px-6 py-3 flex items-center justify-between border-b border-zinc-700 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 bg-amber-400 rounded-lg flex items-center justify-center text-zinc-900 font-bold text-xs">
                  ZP
                </div>
                <div>
                  <div className="text-xs font-bold">درگاه پرداخت الکترونیک زرین‌پال</div>
                  <div className="text-[9px] text-zinc-400 font-mono">Zarinpal Secure Payment Gateway</div>
                </div>
              </div>

              <div className="flex items-center gap-2 sm:gap-3 text-xs">
                <div className="flex items-center gap-1 text-emerald-400 font-mono text-[10px] sm:text-xs">
                  <Lock className="w-3.5 h-3.5" />
                  <span>SSL 256-bit</span>
                </div>
                <button
                  type="button"
                  onClick={() => setStep('plans')}
                  className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition cursor-pointer touch-manipulation"
                  title="بازگشت به پلن‌ها"
                  aria-label="بازگشت به پلن‌ها"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Merchant Info Bar */}
            <div className="bg-amber-50 border-b border-amber-200 px-4 sm:px-6 py-2 flex items-center justify-between text-xs text-amber-900 shrink-0">
              <div>
                <span className="font-semibold">پذیرنده: </span>
                <span>سامانه دیسیپلین بوشیدو</span>
              </div>
              <div>
                <span className="font-semibold">مبلغ: </span>
                <span className="font-bold font-mono text-emerald-700 text-sm">{selectedPlan.formattedPrice} تومان</span>
              </div>
            </div>

            {/* Gateway Form */}
            <form onSubmit={handleVerifyPayment} className="p-4 sm:p-6 space-y-3.5 sm:space-y-4 overflow-y-auto flex-1 min-h-0">
              {/* Card Number */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  شماره کارت ۱۶ رقمی:
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={cardNumber}
                    onChange={e => setCardNumber(e.target.value)}
                    dir="ltr"
                    className="w-full min-h-[44px] bg-white border border-zinc-300 rounded-xl px-3.5 py-2.5 text-sm font-mono text-zinc-800 tracking-wider text-center focus:outline-none focus:border-amber-500 shadow-xs"
                    required
                  />
                  <CreditCard className="w-4 h-4 text-zinc-400 absolute left-3 top-3.5" />
                </div>
              </div>

              {/* CVV2 & Expiry */}
              <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    کد شناسایی (CVV2):
                  </label>
                  <input
                    type="text"
                    value={cvv2}
                    onChange={e => setCvv2(e.target.value)}
                    maxLength={4}
                    dir="ltr"
                    className="w-full min-h-[44px] bg-white border border-zinc-300 rounded-xl px-3 py-2.5 text-sm font-mono text-center focus:outline-none focus:border-amber-500 shadow-xs"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-zinc-700 mb-1">
                    تاریخ انقضا (ماه / سال):
                  </label>
                  <div className="flex items-center gap-1.5" dir="ltr">
                    <input
                      type="text"
                      value={expMonth}
                      onChange={e => setExpMonth(e.target.value)}
                      maxLength={2}
                      placeholder="ماه"
                      className="w-1/2 min-h-[44px] bg-white border border-zinc-300 rounded-xl px-2 py-2.5 text-sm font-mono text-center focus:outline-none focus:border-amber-500 shadow-xs"
                      required
                    />
                    <span className="text-zinc-400 font-bold">/</span>
                    <input
                      type="text"
                      value={expYear}
                      onChange={e => setExpYear(e.target.value)}
                      maxLength={2}
                      placeholder="سال"
                      className="w-1/2 min-h-[44px] bg-white border border-zinc-300 rounded-xl px-2 py-2.5 text-sm font-mono text-center focus:outline-none focus:border-amber-500 shadow-xs"
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Dynamic OTP */}
              <div>
                <label className="block text-xs font-bold text-zinc-700 mb-1">
                  رمز دوم پویا (OTP):
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={otpCode}
                    onChange={e => setOtpCode(e.target.value)}
                    placeholder="کد پیامک‌شده"
                    dir="ltr"
                    className="flex-1 min-h-[44px] bg-white border border-zinc-300 rounded-xl px-3 py-2 text-sm font-mono text-center focus:outline-none focus:border-amber-500 shadow-xs"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={otpSent}
                    className="min-h-[44px] bg-zinc-800 hover:bg-zinc-700 disabled:bg-zinc-300 text-white disabled:text-zinc-500 text-xs font-bold px-3 sm:px-4 py-2 rounded-xl transition shrink-0 cursor-pointer active:scale-[0.98] whitespace-nowrap inline-flex items-center justify-center"
                  >
                    {otpSent ? `ارسال مجدد (${otpTimer})` : 'دریافت رمز پویا'}
                  </button>
                </div>
                {otpSent && (
                  <p className="text-[11px] text-emerald-600 mt-1 font-mono">
                    ✓ رمز پویای آزمایشی برای شما وارد شد ({otpCode}).
                  </p>
                )}
              </div>

              {/* Captcha */}
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1">
                  <label className="block text-xs font-bold text-zinc-700 mb-1">کد امنیتی:</label>
                  <input
                    type="text"
                    value={captchaInput}
                    onChange={e => setCaptchaInput(e.target.value)}
                    dir="ltr"
                    className="w-full min-h-[44px] bg-white border border-zinc-300 rounded-xl px-3 py-2 text-sm font-mono text-center focus:outline-none focus:border-amber-500"
                    required
                  />
                </div>
                <div className="w-24 min-h-[44px] h-11 bg-zinc-200 border border-zinc-300 rounded-xl flex items-center justify-center font-mono font-bold text-base text-zinc-700 tracking-widest select-none mt-5">
                  {generatedCaptcha}
                </div>
              </div>

              {paymentError && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-2.5 text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* Gateway Actions */}
              <div className="pt-3 border-t border-zinc-200 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setStep('plans')}
                  className="min-h-[44px] bg-zinc-200 hover:bg-zinc-300 text-zinc-700 font-bold text-xs px-4 sm:px-5 py-2.5 rounded-xl transition cursor-pointer active:scale-[0.98] whitespace-nowrap inline-flex items-center justify-center"
                >
                  انصراف و بازگشت
                </button>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="min-h-[44px] bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm px-5 sm:px-7 py-2.5 rounded-xl flex items-center justify-center gap-2 transition shadow-md shadow-emerald-600/30 cursor-pointer active:scale-[0.98] whitespace-nowrap"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                      <span>در حال پردازش...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>تایید و پرداخت ({selectedPlan.formattedPrice} تومان)</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* STEP 3: PAYMENT SUCCESS RECEIPT */}
        {step === 'success' && receiptData && (
          <div className="p-6 sm:p-8 text-center space-y-5 sm:space-y-6 animate-in zoom-in-95 duration-200 overflow-y-auto flex-1">
            <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-3xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 flex items-center justify-center mx-auto shadow-xl shadow-emerald-950">
              <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10" />
            </div>

            <div className="space-y-2">
              <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-3 py-1 rounded-full font-bold font-mono">
                👑 سامورایی ویژه (VIP Samurai) فعال شد
              </span>
              <h2 className="text-xl sm:text-2xl font-black text-zinc-100">
                پرداخت با موفقیت انجام شد!
              </h2>
              <p className="text-xs sm:text-sm text-zinc-300 max-w-md mx-auto leading-relaxed">
                دیوان عالی بوشیدو ارتقای سطح شما را به رسمیت شناخته و دسترسی نامحدود به تمامی امکانات فعال گردید.
              </p>
            </div>

            {/* Official Digital Receipt */}
            <div className="bg-[#09090b]/80 border border-zinc-800 rounded-2xl p-4 sm:p-5 max-w-md mx-auto text-xs space-y-3 font-mono text-zinc-300">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-zinc-400">شماره پیگیری تراکنش (RefID):</span>
                <span className="text-amber-400 font-bold">{receiptData.refId}</span>
              </div>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-zinc-400">طرح اشتراک:</span>
                <span className="text-zinc-100 font-sans font-bold">{selectedPlan.title}</span>
              </div>
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <span className="text-zinc-400">مبلغ پرداخت شده:</span>
                <span className="text-emerald-400 font-bold">{selectedPlan.formattedPrice} تومان</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-zinc-400">زمان ثبت:</span>
                <span>{receiptData.date}</span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="bg-amber-500 hover:bg-amber-400 text-black font-black text-sm px-8 py-3 rounded-2xl transition shadow-lg shadow-amber-500/20 cursor-pointer"
            >
              ورود به میدان نبرد با اشتراک ویژه
            </button>
          </div>
        )}

      </motion.div>
    </div>
  );
};
