import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { UserProfile, SubscriptionPlan } from '../types';
import { PLANS } from '../config/plans';
import { soundFX } from '../utils/audioEffects';
import { haptics } from '../utils/haptics';
import { useBodyScrollLock } from '../utils/useBodyScrollLock';
import { useModalAccessibility } from '../utils/useModalAccessibility';
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
  FlaskConical
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

  const shouldReduceMotion = useReducedMotion();
  const { containerRef } = useModalAccessibility<HTMLDivElement>({
    isOpen,
    onClose,
    isBusy: isLoading,
    focusKey: step
  });

  if (!isOpen) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (isLoading) return;
    onClose();
  };

  const handlePlanKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault();
      const nextIndex = (index + 1) % PLANS.length;
      setSelectedPlan(PLANS[nextIndex]);
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevIndex = (index - 1 + PLANS.length) % PLANS.length;
      setSelectedPlan(PLANS[prevIndex]);
    }
  };

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
      className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-md flex items-center justify-center p-2.5 sm:p-4 pt-safe overscroll-contain overflow-y-auto modal-overlay-resilient" 
      dir="rtl"
    >
      <div 
        className="fixed inset-0" 
        onClick={handleBackdropClick}
        aria-hidden="true"
      />
      <motion.div 
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-busy={isLoading}
        aria-labelledby={
          step === 'plans'
            ? 'payment-modal-title'
            : step === 'simulator'
            ? 'payment-simulator-title'
            : 'payment-success-title'
        }
        aria-describedby={
          step === 'plans'
            ? 'payment-modal-desc'
            : step === 'simulator'
            ? 'payment-simulator-desc'
            : 'payment-success-desc'
        }
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 15 }}
        animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1, y: 0 }}
        exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95, y: 15 }}
        transition={{ duration: shouldReduceMotion ? 0.01 : 0.2, ease: 'easeOut' }}
        className="relative z-10 surface-z3 border-standard radius-modal w-full max-w-2xl text-role-primary shadow-subtle overflow-hidden flex flex-col modal-dialog-resilient my-auto focus:outline-none"
      >
        {/* STEP 1: PLANS SELECTION */}
        {step === 'plans' && (
          <div className="flex flex-col flex-1 overflow-hidden min-h-0">
            {/* Header */}
            <div className="p-4 sm:p-6 surface-z2 border-b border-standard flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="w-10 h-10 sm:w-12 sm:h-12 radius-component bg-amber-subtle text-amber border border-amber-subtle flex items-center justify-center shadow-subtle shrink-0">
                  <Crown className="w-5 h-5 sm:w-6 sm:h-6" />
                </div>
                <div>
                  <h2 id="payment-modal-title" className="text-sm sm:text-lg md:text-xl font-black text-role-primary flex items-center gap-2">
                    ارتقا به اشتراک «سامورایی ویژه VIP»
                  </h2>
                  <p id="payment-modal-desc" className="text-[10px] sm:text-xs text-role-secondary mt-0.5">
                    فعال‌سازی تمامی ابزارهای مهندسی دیسیپلین، آنالیز و صدور گواهینامه
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={isLoading}
                className="btn-contract-ghost w-11 h-11 min-w-[44px] min-h-[44px] radius-component flex items-center justify-center shrink-0 touch-manipulation focus-ring-tactical"
                aria-label="بستن"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto overscroll-contain flex-1 min-h-0">
              {/* Plan Cards as accessible Radio Group */}
              <div 
                role="radiogroup" 
                aria-label="انتخاب طرح اشتراک"
                className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 sm:gap-4"
              >
                {PLANS.map((plan, index) => {
                  const isSelected = selectedPlan.id === plan.id;
                  return (
                    <button
                      type="button"
                      key={plan.id}
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedPlan(plan)}
                      onKeyDown={(e) => handlePlanKeyDown(e, index)}
                      className={`text-right w-full radius-card p-4 sm:p-5 border transition-colors cursor-pointer relative flex flex-col justify-between focus-ring-tactical touch-manipulation ${
                        isSelected
                          ? 'bg-amber-subtle border-amber shadow-subtle'
                          : 'surface-z2 hover:surface-z3 border-standard'
                      }`}
                    >
                      {plan.isPopular && (
                        <div className="absolute -top-3 left-4 bg-amber text-canvas-root text-[10px] font-black px-2.5 py-0.5 radius-badge shadow-subtle">
                          {plan.badgeFa}
                        </div>
                      )}

                      <div className="space-y-2.5 sm:space-y-3 w-full">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-xs sm:text-sm text-role-primary">{plan.title}</span>
                          <div className={`w-5 h-5 radius-capsule border flex items-center justify-center shrink-0 transition-colors ${
                            isSelected ? 'border-amber bg-amber text-canvas-root' : 'border-standard surface-z3'
                          }`}>
                            {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                          </div>
                        </div>

                        <div className="flex items-baseline gap-1">
                          <span className="text-xl sm:text-3xl font-black font-mono text-amber">
                            {plan.formattedPrice}
                          </span>
                          <span className="text-xs text-role-secondary">تومان</span>
                        </div>

                        <ul className="space-y-1.5 sm:space-y-2 pt-1 text-[11px] sm:text-xs text-role-secondary">
                          {plan.features.map((feat, i) => (
                            <li key={i} className="flex items-start gap-1.5 sm:gap-2">
                              <Check className="w-3.5 h-3.5 text-emerald shrink-0 mt-0.5" />
                              <span>{feat}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Secure Payment Note */}
              <div className="surface-z2 radius-card p-3 sm:p-4 flex items-center justify-between text-xs text-role-secondary">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald shrink-0" aria-hidden="true" />
                  <span className="text-[11px] sm:text-xs">پرداخت امن از طریق درگاه رسمی بانکی</span>
                </div>
                <span className="text-[10px] sm:text-[11px] text-role-muted shrink-0">
                  تضمین اصالت دیوان
                </span>
              </div>

              {paymentError && (
                <div 
                  role="alert" 
                  aria-live="assertive"
                  className="bg-debt-subtle border border-debt-subtle radius-component p-3 text-xs text-debt flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-debt shrink-0" aria-hidden="true" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* Action Button */}
              <div className="flex items-center justify-end gap-2.5 sm:gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isLoading}
                  className="btn-contract-secondary px-4 py-2.5 sm:px-5 sm:py-2.5 min-h-[44px] radius-card text-xs font-semibold touch-manipulation focus-ring-tactical"
                >
                  انصراف
                </button>

                <button
                  type="button"
                  onClick={handleStartPayment}
                  disabled={isLoading}
                  className="btn-contract-mastery text-xs sm:text-sm px-5 py-2.5 sm:px-6 sm:py-3 min-h-[44px] radius-card flex items-center gap-2 shadow-subtle focus-ring-tactical"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2" aria-live="polite">
                      <Loader2 className={`w-4 h-4 ${shouldReduceMotion ? '' : 'animate-spin'}`} aria-hidden="true" />
                      <span>در حال اتصال به درگاه...</span>
                    </span>
                  ) : (
                    <>
                      <CreditCard className="w-4 h-4" aria-hidden="true" />
                      <span>پرداخت آنلاین {selectedPlan.formattedPrice} تومان</span>
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
            <div className="p-4 sm:p-5 surface-z2 border-b border-standard flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 radius-component bg-amber-subtle text-amber border border-amber-subtle flex items-center justify-center shrink-0">
                  <FlaskConical className="w-5 h-5" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 id="payment-simulator-title" className="text-sm sm:base font-bold text-role-primary">
                      شبیه‌ساز پرداخت (محیط توسعه)
                    </h3>
                    <span className="text-[10px] bg-amber-subtle text-amber border border-amber-subtle px-2 py-0.5 radius-badge font-mono">
                      DEV ONLY
                    </span>
                  </div>
                  <p id="payment-simulator-desc" className="text-[11px] text-role-secondary mt-0.5">
                    تست فنی تایید تراکنش و صدور اشتراک، بدون ورود داده‌های حساس بانکی
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setStep('plans')}
                disabled={isLoading}
                className="btn-contract-ghost w-11 h-11 min-w-[44px] min-h-[44px] radius-component flex items-center justify-center focus-ring-tactical touch-manipulation"
                aria-label="بازگشت به پلن‌ها"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Simulator Content */}
            <div className="p-4 sm:p-6 space-y-4 sm:space-y-5 overflow-y-auto flex-1 min-h-0">
              <div className="surface-z2 border-standard radius-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center justify-between text-xs border-b border-standard pb-2.5">
                  <span className="text-role-secondary">بسته انتخابی:</span>
                  <span className="font-bold text-role-primary">{selectedPlan.title}</span>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-standard pb-2.5">
                  <span className="text-role-secondary">مبلغ قابل تایید:</span>
                  <span className="font-bold font-mono text-emerald text-sm">{selectedPlan.formattedPrice} تومان</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-role-secondary">شناسه تراکنش دیوان:</span>
                  <span dir="ltr" className="font-mono text-amber text-[11px] break-all">{authority}</span>
                </div>
              </div>

              <div className="surface-z2 radius-component p-3.5 text-xs text-role-secondary leading-relaxed">
                <p>
                  این شبیه‌ساز تنها در محیط توسعه فعال است و هیچ‌گونه شماره کارت، رمز دوم یا کد اعتبارسنجی بانکی دریافت نمی‌کند. برای تکمیل چرخه و ارسال درخواست تایید به سرور، دکمه زیر را کلیک نمایید.
                </p>
              </div>

              {paymentError && (
                <div 
                  role="alert" 
                  aria-live="assertive"
                  className="bg-debt-subtle border border-debt-subtle radius-component p-3 text-xs text-debt flex items-center gap-2"
                >
                  <AlertCircle className="w-4 h-4 text-debt shrink-0" aria-hidden="true" />
                  <span>{paymentError}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setStep('plans')}
                  disabled={isLoading}
                  className="btn-contract-secondary px-4 py-2.5 min-h-[44px] radius-card text-xs font-semibold focus-ring-tactical touch-manipulation"
                >
                  انصراف و بازگشت
                </button>

                <button
                  type="button"
                  onClick={handleVerifyPayment}
                  disabled={isLoading}
                  className="btn-contract-mastery text-xs sm:text-sm px-6 py-2.5 min-h-[44px] radius-component flex items-center gap-2 shadow-subtle focus-ring-tactical touch-manipulation"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2" aria-live="polite">
                      <Loader2 className={`w-4 h-4 ${shouldReduceMotion ? '' : 'animate-spin'}`} aria-hidden="true" />
                      <span>در حال تایید با سرور...</span>
                    </span>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                      <span>تایید پرداخت شبیه‌سازی‌شده</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: PAYMENT SUCCESS RECEIPT */}
        {step === 'success' && receiptData && (
          <div 
            role="status" 
            aria-live="polite" 
            className="p-6 sm:p-8 text-center space-y-5 sm:space-y-6 overflow-y-auto flex-1"
          >
            <div className="w-16 h-16 sm:w-20 sm:h-20 radius-card bg-emerald-subtle text-emerald border border-emerald-subtle flex items-center justify-center mx-auto shadow-subtle">
              <CheckCircle2 className="w-8 h-8 sm:w-10 sm:h-10" aria-hidden="true" />
            </div>

            <div className="space-y-2">
              <span className="text-xs bg-amber-subtle text-amber border border-amber-subtle px-3 py-1 radius-badge font-bold font-mono">
                👑 سامورایی ویژه (VIP Samurai) فعال شد
              </span>
              <h2 id="payment-success-title" className="text-xl sm:text-2xl font-black text-role-primary">
                پرداخت با موفقیت انجام شد!
              </h2>
              <p id="payment-success-desc" className="text-xs sm:text-sm text-role-secondary max-w-md mx-auto leading-relaxed">
                دیوان عالی بوشیدو ارتقای سطح شما را به رسمیت شناخته و دسترسی نامحدود به تمامی امکانات فعال گردید.
              </p>
            </div>

            {/* Official Digital Receipt */}
            <div className="surface-z2 border-standard radius-card p-4 sm:p-5 max-w-md mx-auto text-xs space-y-3 font-mono text-role-secondary">
              <div className="flex items-center justify-between border-b border-standard pb-2">
                <span className="text-role-muted font-sans">شماره پیگیری تراکنش (RefID):</span>
                <span dir="ltr" className="text-amber font-bold">{receiptData.refId}</span>
              </div>
              <div className="flex items-center justify-between border-b border-standard pb-2">
                <span className="text-role-muted font-sans">طرح اشتراک:</span>
                <span className="text-role-primary font-sans font-bold">{selectedPlan.title}</span>
              </div>
              <div className="flex items-center justify-between border-b border-standard pb-2">
                <span className="text-role-muted font-sans">مبلغ پرداخت شده:</span>
                <span className="text-emerald font-bold">{selectedPlan.formattedPrice} تومان</span>
              </div>
              {receiptData.cardPan && (
                <div className="flex items-center justify-between border-b border-standard pb-2">
                  <span className="text-role-muted font-sans">شماره کارت:</span>
                  <span dir="ltr">{receiptData.cardPan}</span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-role-muted font-sans">زمان ثبت:</span>
                <span dir="ltr">{receiptData.date}</span>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="btn-contract-mastery text-sm px-8 py-3 min-h-[44px] radius-card shadow-subtle focus-ring-tactical touch-manipulation"
            >
              ورود به میدان نبرد با اشتراک ویژه
            </button>
          </div>
        )}

      </motion.div>
    </div>
  );
};

