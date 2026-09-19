import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Share, X, Check } from 'lucide-react';
import {
  isIosTipDismissed,
  markIosTipDismissed,
  hasFirstValueAchieved,
  isIOSDevice,
  isPwaStandalone
} from '../../../sync/storageUtils';

export interface IosInstallTipProps {
  ownerId?: string | null;
  hasSessionFirstValue?: boolean;
  isTourOpen?: boolean;
}

/**
 * Bushido Discipline OS — Phase 3B: In-app iOS Add-to-Home-Screen (A2HS) Honest Tip.
 *
 * CONTEXT & GOVERNANCE:
 * 1. On iOS every browser uses WebKit; beforeinstallprompt is generally unavailable.
 * 2. Do not fake an Android-style install button or prompt.
 * 3. Detect iOS/iPadOS AND not running in standalone mode.
 * 4. Show only AFTER first value (at least one habit tick in this or prior session).
 * 5. Show at most once until dismissed (persisted in localStorage scoped per owner).
 * 6. Action is strictly «متوجه شدم» / dismiss.
 * 7. Non-blocking floating card at the bottom of the main shell, never covering habit toggles.
 */
export const IosInstallTip: React.FC<IosInstallTipProps> = ({
  ownerId,
  hasSessionFirstValue = false,
  isTourOpen = false
}) => {
  const [isDismissed, setIsDismissed] = useState<boolean>(() => isIosTipDismissed(ownerId));
  const [hasElapsedGracePeriod, setHasElapsedGracePeriod] = useState<boolean>(false);

  // Sync dismissal state on owner switch
  useEffect(() => {
    setIsDismissed(isIosTipDismissed(ownerId));
  }, [ownerId]);

  // Grace period timer: Avoid popping immediately upon first paint
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasElapsedGracePeriod(true);
    }, 3500);
    return () => clearTimeout(timer);
  }, []);

  // Check iOS environment & standalone display mode
  const isEligiblePlatform = useMemo(() => {
    return isIOSDevice() && !isPwaStandalone();
  }, []);

  // Check first value: either ticked in current session or recorded previously
  const hasFirstValue = useMemo(() => {
    return hasSessionFirstValue || hasFirstValueAchieved(ownerId);
  }, [hasSessionFirstValue, ownerId]);

  // Determine whether tip should be shown
  const shouldShow = (
    isEligiblePlatform &&
    !isDismissed &&
    hasFirstValue &&
    hasElapsedGracePeriod &&
    !isTourOpen
  );

  const handleDismiss = useCallback(() => {
    markIosTipDismissed(ownerId);
    setIsDismissed(true);
  }, [ownerId]);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.aside
          id="ios-install-tip"
          role="region"
          aria-label="راهنمای افزودن به صفحه اصلی در آیفون"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-20 sm:bottom-24 lg:bottom-6 right-3 left-3 sm:right-6 sm:left-auto sm:max-w-md z-40 surface-z1 border-standard radius-card p-3.5 sm:p-4 shadow-xl shadow-black/60 pointer-events-auto select-none"
          dir="rtl"
        >
          <div className="flex items-start gap-3">
            {/* Level 4 Neutral Icon Container */}
            <div className="w-9 h-9 shrink-0 radius-component surface-z2 border-standard flex items-center justify-center text-role-secondary">
              <Share className="w-4 h-4 text-role-secondary" aria-hidden="true" />
            </div>

            {/* Content Area */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-role-primary leading-tight">
                  افزودن بوشیدو به صفحه اصلی (iOS)
                </h4>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="text-role-muted hover:text-role-primary hover:surface-z2 w-11 h-11 min-w-[44px] min-h-[44px] -my-2.5 -ml-2.5 inline-flex items-center justify-center radius-control transition-colors focus-ring-tactical cursor-pointer touch-manipulation"
                  aria-label="بستن راهنما"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              {/* Short Persian Steps (honest guidance, not a fake install prompt) */}
              <div className="mt-2 space-y-1.5 text-[11px] sm:text-xs text-role-secondary leading-relaxed text-right">
                <p className="text-role-muted">
                  برای استفاده تمام‌صفحه و دسترسی بدون حاشیه مرورگر:
                </p>
                <ol className="space-y-1 text-role-secondary list-none p-0 m-0">
                  <li className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted shrink-0" aria-hidden="true" />
                    <span>در صورت لزوم، سامانه را در مرورگر <strong className="text-role-primary font-semibold">Safari</strong> باز کنید.</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted shrink-0" aria-hidden="true" />
                    <span>دکمه <strong className="text-role-primary font-semibold">اشتراک‌گذاری (Share)</strong> در نوار ابزار را لمس کنید.</span>
                  </li>
                  <li className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-text-muted shrink-0" aria-hidden="true" />
                    <span>گزینه <strong className="text-role-primary font-semibold">«افزودن به صفحه اصلی» (Add to Home Screen)</strong> را بزنید.</span>
                  </li>
                </ol>
              </div>

              {/* Action Button: Dismiss only - NO fake install */}
              <div className="flex items-center justify-end gap-2 mt-3.5 pt-1">
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="btn-contract-primary font-bold text-xs px-4 py-1.5 whitespace-nowrap inline-flex items-center justify-center gap-1.5 focus-ring-tactical shadow-subtle touch-manipulation"
                >
                  <Check className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>متوجه شدم</span>
                </button>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
