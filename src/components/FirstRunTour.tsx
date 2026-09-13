import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Swords, 
  Award, 
  Target, 
  LayoutDashboard, 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  X 
} from 'lucide-react';
import { toPersianDigits } from '../utils/numberUtils';

export interface TourStep {
  id: string;
  targetId: string;
  title: string;
  description: string;
  badge: string;
  icon: React.ComponentType<{ className?: string }>;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: 'step-foundations',
    targetId: 'battlefield-foundation-section',
    title: 'ارکان پنج‌گانه بنیادین',
    badge: '۸ امتیاز پایه',
    description: 'سنگ‌بنای انضباط روزانه شما. ثبت هر ۵ رکن، ۸ امتیاز به همراه دارد و زنجیره استمرار شما را به پیش می‌راند.',
    icon: Swords
  },
  {
    id: 'step-score',
    targetId: 'battlefield-score-card',
    title: 'ارزش روز و روز استاندارد',
    badge: 'حد نصاب ۸ از ۱۰',
    description: 'کسب حداقل ۸ از ۱۰ شرط ثبت «روز استاندارد» است. عدم دستیابی به این نمره موجب ثبت بدهی انضباطی می‌شود.',
    icon: Award
  },
  {
    id: 'step-special-mission',
    targetId: 'battlefield-special-mission-card',
    title: 'ماموریت ویژه چرخه ۹۰ روزه',
    badge: '+۲ امتیاز تسلط',
    description: 'اقدام روزانه در راستای هدف کلیدی چرخه. ثبت این اقدام، امتیاز روز را به ۱۰ از ۱۰ (کمال تعهد) می‌رساند.',
    icon: Target
  },
  {
    id: 'step-command-hub',
    targetId: 'top-hub-bar',
    title: 'مرکز فرماندهی و ناوبری',
    badge: 'فرماندهی',
    description: 'مدیریت چرخه‌ها، بررسی زنجیره استمرار و ناوبری زمانی تا موعد کات‌آف شبانه (۴ بامداد).',
    icon: LayoutDashboard
  }
];

interface TargetRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FirstRunTourProps {
  isOpen: boolean;
  onComplete: () => void;
  onSkip: () => void;
}

export const FirstRunTour: React.FC<FirstRunTourProps> = ({
  isOpen,
  onComplete,
  onSkip
}) => {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const nextBtnRef = useRef<HTMLButtonElement>(null);

  const step = TOUR_STEPS[currentStepIndex];

  // Measure active target bounding box
  const updateTargetRect = useCallback(() => {
    if (!isOpen || !step) return;
    const el = document.getElementById(step.targetId);
    if (el) {
      const rect = el.getBoundingClientRect();
      setTargetRect({
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height
      });
    } else {
      setTargetRect(null);
    }
  }, [isOpen, step]);

  // Scroll target into view & update rect on step change
  useEffect(() => {
    if (!isOpen || !step) return;

    // Small delay to ensure any tab/dom layout is stabilized
    const timer = setTimeout(() => {
      const el = document.getElementById(step.targetId);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        // Measure after scroll start
        const innerTimer = setTimeout(updateTargetRect, 250);
        return () => clearTimeout(innerTimer);
      } else {
        updateTargetRect();
      }
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, step, updateTargetRect]);

  // Track window resize and scroll events
  useEffect(() => {
    if (!isOpen) return;

    const handleUpdate = () => {
      updateTargetRect();
    };

    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, { passive: true });

    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate);
    };
  }, [isOpen, updateTargetRect]);

  // Light focus trap and Esc key accessibility
  useEffect(() => {
    if (!isOpen) return;

    // Auto focus next button for keyboard speed
    const focusTimer = setTimeout(() => {
      nextBtnRef.current?.focus();
    }, 100);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
        return;
      }

      if (e.key === 'Tab' && cardRef.current) {
        const focusable = cardRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [tabindex]:not([tabindex="-1"])'
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
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, currentStepIndex, onSkip]);

  if (!isOpen || !step) return null;

  const isLastStep = currentStepIndex === TOUR_STEPS.length - 1;
  const StepIcon = step.icon;

  const handleNext = () => {
    if (isLastStep) {
      onComplete();
    } else {
      setCurrentStepIndex(prev => prev + 1);
    }
  };

  const handlePrev = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex(prev => prev - 1);
    }
  };

  // Card Positioning logic
  let cardPositionStyle: React.CSSProperties = {};
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 640;

  if (targetRect && !isMobile) {
    const spaceBelow = window.innerHeight - (targetRect.top + targetRect.height);
    const spaceAbove = targetRect.top;
    const cardHeightEst = 220;
    const cardWidthEst = 400;

    let calculatedTop: number | undefined;
    let calculatedBottom: number | undefined;

    if (spaceBelow >= cardHeightEst + 20) {
      calculatedTop = Math.max(16, targetRect.top + targetRect.height + 12);
    } else if (spaceAbove >= cardHeightEst + 20) {
      calculatedBottom = Math.max(16, window.innerHeight - targetRect.top + 12);
    } else {
      calculatedBottom = 24;
    }

    // Horizontal centering over target
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const calculatedLeft = Math.max(
      16,
      Math.min(window.innerWidth - cardWidthEst - 16, targetCenterX - cardWidthEst / 2)
    );

    cardPositionStyle = {
      position: 'fixed',
      left: `${calculatedLeft}px`,
      width: `${cardWidthEst}px`,
      ...(calculatedTop !== undefined ? { top: `${calculatedTop}px` } : {}),
      ...(calculatedBottom !== undefined ? { bottom: `${calculatedBottom}px` } : {})
    };
  } else {
    // Mobile or no rect: dock cleanly above bottom bar
    cardPositionStyle = {
      position: 'fixed',
      bottom: '5.5rem',
      left: '0.75rem',
      right: '0.75rem',
      maxWidth: '28rem',
      margin: '0 auto'
    };
  }

  return (
    <div 
      id="first-run-tour-container"
      className="fixed inset-0 z-50 pointer-events-none select-none"
      dir="rtl"
      aria-label="راهنمای شروع نبرد بوشیدو"
      role="region"
    >
      {/* 
        Spotlight Backdrop SVG:
        Uses pointer-events-none throughout so clicking habits or elements is NEVER blocked.
        Provides a dignified martial ambient vignette around the active step.
      */}
      {targetRect && (
        <svg 
          className="fixed inset-0 w-full h-full pointer-events-none z-40 transition-opacity duration-300"
          aria-hidden="true"
        >
          <defs>
            <mask id="tour-spotlight-mask">
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              <rect
                x={Math.max(0, targetRect.left - 6)}
                y={Math.max(0, targetRect.top - 6)}
                width={targetRect.width + 12}
                height={targetRect.height + 12}
                rx={14}
                ry={14}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            x="0"
            y="0"
            width="100%"
            height="100%"
            fill="rgba(0, 0, 0, 0.45)"
            mask="url(#tour-spotlight-mask)"
          />
        </svg>
      )}

      {/* Spotlight Target Highlight Frame (Visual ring, non-blocking) */}
      {targetRect && (
        <div
          id="first-run-tour-spotlight"
          style={{
            position: 'fixed',
            top: `${Math.max(0, targetRect.top - 6)}px`,
            left: `${Math.max(0, targetRect.left - 6)}px`,
            width: `${targetRect.width + 12}px`,
            height: `${targetRect.height + 12}px`,
          }}
          className="pointer-events-none z-45 border-2 border-amber/70 radius-modal shadow-[0_0_25px_rgba(251,191,36,0.18)] transition-all duration-300 ease-out"
          aria-hidden="true"
        />
      )}

      {/* Coach-mark Card */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step.id}
          id="first-run-tour-card"
          ref={cardRef}
          style={cardPositionStyle}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="pointer-events-auto z-50 surface-z1 border-standard radius-modal p-4 sm:p-5 shadow-elevated space-y-3.5"
          role="dialog"
          aria-modal="false"
          aria-labelledby="first-run-tour-title"
          aria-describedby="first-run-tour-description"
        >
          {/* Card Header */}
          <div className="flex items-center justify-between gap-2.5">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 radius-component surface-z2 border-standard flex items-center justify-center text-amber shrink-0">
                <StepIcon className="w-4 h-4 text-amber" />
              </div>
              <div className="min-w-0">
                <h3 id="first-run-tour-title" className="text-xs sm:text-sm font-bold text-role-primary truncate">
                  {step.title}
                </h3>
                <span className="text-[10px] text-amber font-mono font-bold bg-amber-subtle border border-amber-subtle px-1.5 py-0.2 radius-capsule inline-block mt-0.5">
                  {step.badge}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <span className="text-[10px] sm:text-[11px] font-mono text-role-muted px-1">
                {toPersianDigits(currentStepIndex + 1)} از {toPersianDigits(TOUR_STEPS.length)}
              </span>
              <button
                id="first-run-tour-close-btn"
                type="button"
                onClick={onSkip}
                className="w-6 h-6 radius-component flex items-center justify-center text-role-muted hover:text-role-primary hover:surface-z2 transition-colors cursor-pointer"
                title="بستن راهنما"
                aria-label="بستن راهنما"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Card Description */}
          <p id="first-run-tour-description" className="text-xs text-role-secondary leading-relaxed text-right">
            {step.description}
          </p>

          {/* Card Footer & Controls */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-standard/50">
            <button
              id="first-run-tour-skip-btn"
              type="button"
              onClick={onSkip}
              className="text-xs font-medium text-role-secondary hover:text-role-primary px-2 py-1.5 radius-component cursor-pointer transition-colors whitespace-nowrap"
            >
              رد شدن
            </button>

            {/* Step Dots */}
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {TOUR_STEPS.map((_, idx) => (
                <div
                  key={idx}
                  className={`radius-capsule transition-all duration-300 ${
                    idx === currentStepIndex 
                      ? 'w-4 h-1.5 bg-amber' 
                      : 'w-1.5 h-1.5 surface-z3 border-standard'
                  }`}
                />
              ))}
            </div>

            {/* Navigation buttons */}
            <div className="flex items-center gap-1.5">
              {currentStepIndex > 0 && (
                <button
                  id="first-run-tour-prev-btn"
                  type="button"
                  onClick={handlePrev}
                  className="surface-z2 border-standard text-role-secondary hover:text-role-primary px-2.5 py-1.5 radius-component text-xs font-medium cursor-pointer transition-colors whitespace-nowrap"
                >
                  قبلی
                </button>
              )}

              <button
                ref={nextBtnRef}
                id="first-run-tour-next-btn"
                type="button"
                onClick={handleNext}
                className="bg-crimson hover:brightness-110 text-role-primary font-bold radius-component px-3.5 py-1.5 text-xs sm:text-sm active:scale-95 transition-all shadow-subtle cursor-pointer whitespace-nowrap focus-ring-tactical inline-flex items-center gap-1.5"
              >
                {isLastStep ? (
                  <>
                    <span>شروع نبرد</span>
                    <Check className="w-3.5 h-3.5" />
                  </>
                ) : (
                  <>
                    <span>بعدی</span>
                    <ArrowLeft className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
};
