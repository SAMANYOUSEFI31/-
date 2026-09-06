import React, { useState } from 'react';
import { motion } from 'motion/react';
import { UserProfile, SubscriptionPlan } from '../types';
import { PLANS } from '../config/plans';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import {
  validateAuthoritativePaymentResponse,
  AuthoritativePaymentReceipt
} from '../utils/paymentValidation';
import { 
  Crown, 
  Check, 
  Lock, 
  CreditCard, 
  CheckCircle2, 
  AlertCircle, 
  X, 
  Loader2, 
  FlaskConical,
  RotateCcw
} from 'lucide-react';

interface PaymentModalProps {
  userProfile: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onUpgradeSuccess: (updatedProfile: UserProfile) => void;
}

export const PaymentModal: React.FC<PaymentModalProps> = ({
  userProfile,
  isOpen,
  onClose,
  onUpgradeSuccess
}) => {
  useBodyScrollLock(isOpen);

  const [selectedPlan, setSelectedPlan] = useState<SubscriptionPlan>(PLANS[0]);
  const [step, setStep] = useState<'plans' | 'simulator' | 'success'>('plans');
  const [isLoading, setIsLoading] = useState(false);
  const [authority, setAuthority] = useState<string>('');
  const [paymentError, setPaymentError] = useState('');
  const [receiptData, setReceiptData] = useState<AuthoritativePaymentReceipt | null>(null);

  if (!isOpen) return null;

  const handleStartPayment = async () => {
    setIsLoading(true);
    setPaymentError('');
    try {
      const token = localStorage.getItem('bushido_auth_token');
      if (!token) {
        setPaymentError('برای ارتقا به VIP، ابتدا باید وارد حساب کاربری خود شوید.');
        setIsLoading(false);
        return;
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

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

      if (res.status === 503 || data.code === 'PAYMENT_UNAVAILABLE') {
        setPaymentError(data.messageFa || 'درگاه پرداخت در حال حاضر در دسترس نیست.');
        return;
      }

      if (data.status === 100 && data.authority) {
        setAuthority(data.authority);

        // If external gateway URL is provided (future live provider), redirect to provider
        if (data.paymentUrl && /^https?:\/\//i.test(data.paymentUrl)) {
          window.location.href = data.paymentUrl;
          return;
        }

        // Isolated development simulator
        if (data.mode === 'provider-simulator-dev') {
          setStep('simulator');
        } else {
          setPaymentError('درگاه پرداخت پیکربندی نشده است.');
        }
      } else {
        setPaymentError(data.messageFa || data.message || 'خطا در برقراری ارتباط با درگاه پرداخت.');
      }
    } catch (err) {
      console.error('Payment request error:', err);
      setPaymentError('عدم دسترسی به سرور پرداخت. لطفاً اتصال اینترنت خود را بررسی فرمایید.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyPayment = async () => {
    if (!authority) {
      setPaymentError('شناسه پرداخت یافت نشد.');
      return;
    }

    setIsLoading(true);
    setPaymentError('');

    try {
      const token = localStorage.getItem('bushido_auth_token');
      if (!token) {
        setPaymentError('نشست کاربری نامعتبر است. لطفاً مجدداً وارد شوید.');
        setIsLoading(false);
        return;
      }
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      };

      const res = await fetch('/api/payment/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          authority
        })
      });
      const data = await res.json();

      // Strict server-authoritative validation (Phase 5A WP1)
      const validation = validateAuthoritativePaymentResponse(
        {
          data,
          currentUserId: userProfile.id,
          expectedAuthority: authority
        },
        userProfile
      );

      if (!validation.valid || !validation.validatedUser || !validation.receipt) {
        setPaymentError(validation.errorMessageFa || 'پاسخ تایید تراکنش نامعتبر است.');
        haptics.warningAlert();
        return;
      }

      // Validated strictly against server authoritative response
      setReceiptData(validation.receipt);
      setStep('success');
      onUpgradeSuccess(validation.validatedUser);
      soundFX.playMastery();
      haptics.masterySuccess();
    } catch (err) {
      console.error('Verify error:', err);
      setPaymentError('خطا در ارتباط با سرور تایید پرداخت. لطفاً دوباره تلاش فرمایید.');
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
        className="relative z-10 bg-[#1c1c21] border border-zinc-800 rounded-2xl sm:rounded-3xl w-full max-w-2xl text-zinc-100 shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] my-auto"
      >
        {/* STEP 1: PLANS SELECTION */}
        {step === 'plans' && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            {/* Header */}
            <div className="p-4 sm:p-6 bg-gradient-to-r from-amber-950/60 via-[#1c1c21] to-[#18181b] border-b border-zinc-800 flex items-center justify-between shrink-0">
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
                          : 'bg-[#18181b] border-zinc-800 hover:border-zinc-700'
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
              <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-3 sm:p-4 flex items-center justify-between text-xs text-zinc-400">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span className="text-[11px] sm:text-xs">پرداخت امن از طریق درگاه رسمی بانکی</span>
                </div>
                <span className="text-[10px] sm:text-[11px] text-zinc-500 shrink-0">
                  تضمین اصالت دیوان
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

        {/* STEP 2: ISOLATED DEV SIMULATOR (Clearly labelled, zero realistic banking inputs) */}
        {step === 'simulator' && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            {/* Simulator Header */}
            <div className="p-4 sm:p-5 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center justify-center shrink-0">
                  <FlaskConical className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm sm:text-base font-bold text-zinc-100">
                      شبیه‌ساز پرداخت (محیط توسعه)
                    </h3>
                    <span className="text-[10px] bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded-full font-mono">
                      DEV ONLY
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    تست فنی تایید تراکنش و صدور اشتراک، بدون ورود داده‌های حساس بانکی
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep('plans')}
                className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-white rounded-xl hover:bg-zinc-800 transition cursor-pointer"
                aria-label="بازگشت به پلن‌ها"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Simulator Content */}
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 min-h-0">
              <div className="bg-[#121215] border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">بسته انتخابی:</span>
                  <span className="font-bold text-zinc-200">{selectedPlan.title}</span>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">مبلغ قابل تایید:</span>
                  <span className="font-bold font-mono text-emerald-400 text-sm">{selectedPlan.formattedPrice} تومان</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">شناسه تراکنش دیوان:</span>
                  <span className="font-mono text-amber-400 text-[11px] break-all">{authority}</span>
                </div>
              </div>

              <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl p-3.5 text-xs text-zinc-400 leading-relaxed">
                <p>
                  این شبیه‌ساز تنها در محیط توسعه فعال است و هیچ‌گونه شماره کارت، رمز دوم یا کد اعتبارسنجی بانکی دریافت نمی‌کند. برای تکمیل چرخه و ارسال درخواست تایید به سرور، دکمه زیر را کلیک نمایید.
                </p>
              </div>

              {paymentError && (
                <div className="bg-red-950/60 border border-red-500/40 rounded-xl p-3 text-xs text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('plans')}
                  className="px-4 py-2.5 min-h-[44px] rounded-xl text-zinc-400 hover:text-white text-xs font-semibold cursor-pointer"
                >
                  انصراف و بازگشت
                </button>

                <button
                  type="button"
                  onClick={handleVerifyPayment}
                  disabled={isLoading}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs sm:text-sm px-6 py-2.5 rounded-xl flex items-center gap-2 shadow-lg shadow-emerald-950 transition cursor-pointer active:scale-[0.98]"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      در حال تایید با سرور...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      تایید پرداخت شبیه‌سازی‌شده
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: PAYMENT SUCCESS RECEIPT */}
        {step === 'success' && receiptData && (
          <div className="p-6 sm:p-8 text-center space-y-5 sm:space-y-6 overflow-y-auto flex-1">
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
            <div className="bg-[#18181b] border border-zinc-800 rounded-2xl p-4 sm:p-5 max-w-md mx-auto text-xs space-y-3 font-mono text-zinc-300">
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
              {receiptData.cardPan && (
                <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                  <span className="text-zinc-400">شماره کارت:</span>
                  <span>{receiptData.cardPan}</span>
                </div>
              )}
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
