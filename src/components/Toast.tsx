import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { CheckCircle2, AlertTriangle, AlertOctagon, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  message: string;
  type?: ToastType;
  duration?: number;
}

interface ToastProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export const Toast: React.FC<ToastProps> = ({ toasts, onDismiss }) => {
  return (
    <div 
      className="fixed bottom-20 md:bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none w-full max-w-sm px-4 select-none"
      dir="rtl"
    >
      <AnimatePresence mode="sync">
        {toasts.map(toast => {
          const type = toast.type || 'success';
          
          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 16, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 450, damping: 32 }}
              className={`pointer-events-auto w-full p-3.5 radius-card border backdrop-blur-xl shadow-subtle flex items-center justify-between gap-3 text-xs sm:text-sm font-bold ${
                type === 'error'
                  ? 'bg-debt-subtle border-debt-subtle text-role-primary'
                  : type === 'warning'
                  ? 'bg-amber-subtle border-amber-subtle text-role-primary'
                  : type === 'info'
                  ? 'bg-blue-subtle border-blue-subtle text-role-primary'
                  : 'surface-z1 border-emerald-subtle text-role-primary'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {type === 'error' && (
                  <div className="w-7 h-7 radius-component bg-debt-subtle border border-debt-subtle flex items-center justify-center shrink-0 text-debt">
                    <AlertOctagon className="w-4 h-4" />
                  </div>
                )}
                {type === 'warning' && (
                  <div className="w-7 h-7 radius-component bg-amber-subtle border border-amber-subtle flex items-center justify-center shrink-0 text-amber">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                )}
                {type === 'info' && (
                  <div className="w-7 h-7 radius-component bg-blue-subtle border border-blue-subtle flex items-center justify-center shrink-0 text-blue">
                    <Info className="w-4 h-4" />
                  </div>
                )}
                {type === 'success' && (
                  <div className="w-7 h-7 radius-component bg-emerald-subtle border border-emerald-subtle flex items-center justify-center shrink-0 text-emerald">
                    <CheckCircle2 className="w-4 h-4" />
                  </div>
                )}
                
                <span className="leading-snug break-words text-role-primary">
                  {toast.message}
                </span>
              </div>

              <button
                type="button"
                onClick={() => onDismiss(toast.id)}
                className="w-8 h-8 sm:w-11 sm:h-11 min-w-[36px] min-h-[36px] radius-control surface-z2 hover:surface-z3 text-role-secondary hover:text-role-primary flex items-center justify-center shrink-0 transition cursor-pointer touch-manipulation focus-ring-tactical"
                title="بستن اعلان"
                aria-label="بستن اعلان"
              >
                <X className="w-4 h-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
};
