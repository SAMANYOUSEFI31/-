import React, { useRef } from 'react';
import { useModalAccessibility } from '../utils/useModalAccessibility';
import { RotateCcw, AlertTriangle } from 'lucide-react';

export interface ResetConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

/**
 * Accessible Reset Confirmation Modal for Bushido Discipline OS.
 * Enforces Phase 6.5A/B accessibility contracts:
 * - Semantic role="dialog" with aria-modal="true"
 * - Linked visible title (aria-labelledby) and warning description (aria-describedby)
 * - Initial focus placed safely on Cancel action (not destructive Reset action)
 * - Tab/Shift+Tab focus containment
 * - Escape key dismissal with focus return to opener control
 * - Explicit confirmation protection (backdrop and escape cannot trigger destructive reset)
 * - Reduced-motion support
 */
export const ResetConfirmationModal: React.FC<ResetConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm
}) => {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  const { containerRef } = useModalAccessibility<HTMLDivElement>({
    isOpen,
    onClose,
    initialFocusRef: cancelButtonRef,
    autoFocusFirst: false
  });

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 surface-backdrop-modal backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-safe pb-safe overscroll-contain overflow-y-auto max-h-[100dvh]"
      dir="rtl"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-confirmation-title"
        aria-describedby="reset-confirmation-description"
        tabIndex={-1}
        className="surface-z3 border border-debt-subtle/40 radius-modal w-full max-w-md p-5 sm:p-6 space-y-4 shadow-subtle animate-in zoom-in-95 motion-reduce:animate-none motion-fast my-auto focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 radius-component bg-debt-subtle border border-debt-subtle flex items-center justify-center text-debt shrink-0">
            <RotateCcw className="w-6 h-6" />
          </div>
          <div>
            <h3 id="reset-confirmation-title" className="font-bold text-base text-role-primary">
              بازنشانی داده‌های سامانه
            </h3>
            <p className="text-xs text-debt mt-0.5 flex items-center gap-1 font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>بازگشت به مقادیر اولیه سیستم بوشیدو</span>
            </p>
          </div>
        </div>

        <p
          id="reset-confirmation-description"
          className="text-xs text-role-secondary leading-relaxed surface-z2 border-standard radius-card p-4 text-right"
        >
          آیا از بازنشانی کلیه داده‌ها، لاگ‌ها و چرخه‌ها به اطلاعات نمونه اولیه سیستم بوشیدو اطمینان دارید؟ تمام تغییرات ثبت‌شده محلی پاک خواهند شد.
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            className="surface-z2 hover:surface-z3 text-role-secondary hover:text-role-primary border-standard px-4 py-2.5 min-h-[44px] radius-component text-xs font-bold transition-colors cursor-pointer focus-ring-tactical touch-manipulation"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="bg-debt hover:brightness-110 text-white font-bold px-5 py-2.5 min-h-[44px] radius-component text-xs flex items-center gap-1.5 shadow-subtle transition-colors cursor-pointer active:scale-[0.98] motion-reduce:transform-none focus-ring-tactical touch-manipulation"
          >
            <RotateCcw className="w-4 h-4" />
            <span>بله، بازنشانی داده‌ها</span>
          </button>
        </div>
      </div>
    </div>
  );
};
