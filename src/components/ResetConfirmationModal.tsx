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
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-md flex flex-col items-start sm:items-center justify-start sm:justify-center p-3 sm:p-4 pt-[max(1.25rem,calc(env(safe-area-inset-top,0px)+0.75rem))] pb-[max(1.25rem,calc(env(safe-area-inset-bottom,0px)+0.75rem))] overscroll-contain overflow-y-auto max-h-[100dvh]"
      dir="rtl"
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-confirmation-title"
        aria-describedby="reset-confirmation-description"
        tabIndex={-1}
        className="bg-[#1c1c21] border border-red-500/40 rounded-3xl w-full max-w-md p-5 sm:p-6 space-y-4 shadow-2xl animate-in zoom-in-95 motion-reduce:animate-none duration-150 my-auto focus:outline-none"
      >
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 shrink-0">
            <RotateCcw className="w-6 h-6" />
          </div>
          <div>
            <h3 id="reset-confirmation-title" className="font-bold text-base text-zinc-100">
              بازنشانی داده‌های سامانه
            </h3>
            <p className="text-xs text-red-400 mt-0.5 flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>بازگشت به مقادیر اولیه سیستم بوشیدو</span>
            </p>
          </div>
        </div>

        <p
          id="reset-confirmation-description"
          className="text-xs text-zinc-300 leading-relaxed bg-[#18181b] border border-zinc-800 rounded-2xl p-4 text-right"
        >
          آیا از بازنشانی کلیه داده‌ها، لاگ‌ها و چرخه‌ها به اطلاعات نمونه اولیه سیستم بوشیدو اطمینان دارید؟ تمام تغییرات ثبت‌شده محلی پاک خواهند شد.
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            ref={cancelButtonRef}
            type="button"
            onClick={onClose}
            className="bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer focus-visible:outline-2 focus-visible:outline-zinc-300"
          >
            انصراف
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="bg-red-600 hover:bg-red-500 text-white font-bold px-5 py-2.5 rounded-xl text-xs flex items-center gap-1.5 shadow-lg shadow-red-600/30 transition cursor-pointer active:scale-95 focus-visible:outline-2 focus-visible:outline-red-400"
          >
            <RotateCcw className="w-4 h-4" />
            <span>بله، بازنشانی داده‌ها</span>
          </button>
        </div>
      </div>
    </div>
  );
};
