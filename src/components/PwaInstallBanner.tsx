import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Smartphone, Download, X } from 'lucide-react';
import {
  isPwaDismissed,
  markPwaDismissed,
  isPwaInstalled,
  markPwaInstalled,
  hasFirstValueAchieved,
  isIOSDevice,
  isPwaStandalone
} from '../utils/storageUtils';

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaInstallBannerProps {
  ownerId?: string | null;
  hasSessionFirstValue?: boolean;
  isTourOpen?: boolean;
}

/**
 * Bushido Discipline OS — Phase 3A: Mild Add-to-Home-Screen (A2HS) Banner.
 *
 * GOVERNANCE RULES:
 * 1. Listen for beforeinstallprompt; preventDefault; keep deferredPrompt.
 * 2. If beforeinstallprompt never fires (typical iOS, desktop unsupported, or already installed):
 *    DO NOT show this banner (iOS is Phase 3B).
 * 3. Never block first paint or habit ticking (no modal backdrop, non-blocking floating card).
 * 4. Show only AFTER first value (at least one successful habit tick in this or prior session).
 * 5. Never on the first second of first visit (enforces mount grace period).
 * 6. Stoic, non-nagging Persian UI: short line + primary "نصب / افزودن به صفحه اصلی" + dismiss.
 * 7. Persist dismiss & install in localStorage scoped per owner.
 * 8. Never show if running in (display-mode: standalone) or installed mode.
 */
export const PwaInstallBanner: React.FC<PwaInstallBannerProps> = ({
  ownerId,
  hasSessionFirstValue = false,
  isTourOpen = false
}) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(() => isPwaDismissed(ownerId));
  const [isInstalled, setIsInstalled] = useState<boolean>(() => isPwaStandalone() || isPwaInstalled(ownerId));
  const [hasElapsedGracePeriod, setHasElapsedGracePeriod] = useState<boolean>(false);

  // Sync dismissal & installation state when ownerId changes
  useEffect(() => {
    setIsDismissed(isPwaDismissed(ownerId));
    setIsInstalled(isPwaStandalone() || isPwaInstalled(ownerId));
  }, [ownerId]);

  // Grace period timer: Never show during first 3.5 seconds of mount
  useEffect(() => {
    const timer = setTimeout(() => {
      setHasElapsedGracePeriod(true);
    }, 3500);
    return () => clearTimeout(timer);
  }, []);

  // Listen for beforeinstallprompt & appinstalled events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleBeforeInstallPrompt = (e: Event) => {
      // Prevent browser mini-infobar from appearing on mobile
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      markPwaInstalled(ownerId);
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, [ownerId]);

  // Check first value: either ticked in current session or recorded previously
  const hasFirstValue = useMemo(() => {
    return hasSessionFirstValue || hasFirstValueAchieved(ownerId);
  }, [hasSessionFirstValue, ownerId]);

  // Determine whether banner should be displayed (strictly non-iOS; iOS uses IosInstallTip)
  const shouldShow = (
    !isIOSDevice() &&
    Boolean(deferredPrompt) &&
    !isDismissed &&
    !isInstalled &&
    hasFirstValue &&
    hasElapsedGracePeriod &&
    !isTourOpen
  );

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;

    try {
      await deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;

      if (choiceResult && choiceResult.outcome === 'accepted') {
        markPwaInstalled(ownerId);
        setIsInstalled(true);
      } else {
        // User cancelled in native prompt: dismiss quietly to respect stoic ergonomics
        markPwaDismissed(ownerId);
        setIsDismissed(true);
      }
    } catch (err) {
      console.warn('[PWA A2HS] Error executing install prompt:', err);
    } finally {
      setDeferredPrompt(null);
    }
  }, [deferredPrompt, ownerId]);

  const handleDismiss = useCallback(() => {
    markPwaDismissed(ownerId);
    setIsDismissed(true);
  }, [ownerId]);

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.aside
          id="pwa-install-banner"
          role="region"
          aria-label="نصب برنامه بوشیدو"
          initial={{ opacity: 0, y: 20, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.98 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-20 sm:bottom-24 lg:bottom-6 right-3 left-3 sm:right-6 sm:left-auto sm:max-w-md z-40 bg-[#121215] border border-zinc-800 radius-card p-3.5 sm:p-4 shadow-xl shadow-black/60 pointer-events-auto select-none"
          dir="rtl"
        >
          <div className="flex items-start gap-3">
            {/* Level 4 Neutral Icon Container */}
            <div className="w-9 h-9 shrink-0 radius-component bg-zinc-800/80 border border-zinc-700/50 flex items-center justify-center text-zinc-200">
              <Smartphone className="w-4 h-4 text-zinc-200" aria-hidden="true" />
            </div>

            {/* Content Area */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-xs sm:text-sm font-bold text-zinc-100 leading-tight">
                  افزودن به صفحه اصلی
                </h4>
                <button
                  type="button"
                  onClick={handleDismiss}
                  className="text-zinc-400 hover:text-zinc-200 p-1 radius-control transition-colors focus-ring-tactical"
                  aria-label="بستن پیام نصب"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>

              <p className="text-[11px] sm:text-xs text-zinc-400 leading-relaxed mt-1 text-right">
                برای تمرکز پیوسته، عملکرد سریع‌تر و دسترسی مستقیم به میدان نبرد، بوشیدو را نصب کنید.
              </p>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={handleInstall}
                  className="btn-contract-primary font-bold text-xs px-3.5 py-1.5 whitespace-nowrap inline-flex items-center justify-center gap-1.5 focus-ring-tactical shadow-subtle touch-manipulation"
                >
                  <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>نصب / افزودن به صفحه اصلی</span>
                </button>

                <button
                  type="button"
                  onClick={handleDismiss}
                  className="btn-contract-ghost text-xs px-3 py-1.5 text-zinc-400 hover:text-zinc-200 whitespace-nowrap inline-flex items-center justify-center focus-ring-tactical touch-manipulation"
                >
                  بعداً
                </button>
              </div>
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
};
